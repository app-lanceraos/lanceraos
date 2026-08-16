# apps/invoices/tests/test_comments.py
"""
Step 13 — InvoiceComment endpoints, attachment validation, the inbound
email-reply webhook, notification wiring, and the unread-batched-email
task. Covers: dual-entry (portal POST + webhook both land in the same
thread, correctly tagged by source), no edit/delete endpoint exists at
all, attachment content-validation, the unread-batched-email fires once
per unread state (not per comment, not repeatedly), the webhook's
untrusted-input rejection cases, and rate limiting on the portal
endpoint. WebSocket-layer tests live separately in test_consumers.py
(Channels' own testing utilities, not HTTP-layer tooling).
"""
import io
import json
from datetime import timedelta
from decimal import Decimal
from unittest.mock import MagicMock, patch

from django.core.cache import cache
from django.middleware.csrf import get_token
from django.test import Client as DjangoTestClient
from django.test import RequestFactory, TestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from PIL import Image

from apps.clients.cookies import PORTAL_SESSION_COOKIE_NAME
from apps.clients.models import Client as ClientModel
from apps.clients.models import ClientPortalSession
from apps.invoices.models import Invoice, InvoiceComment, InvoiceItem
from apps.invoices.tests.test_models import make_invoice
from apps.users.models import User


def make_client(user, **overrides):
    data = {'name': 'Acme Co', 'email': 'acme@example.com'}
    data.update(overrides)
    return ClientModel.objects.create(user=user, **data)


def make_test_image_bytes():
    buf = io.BytesIO()
    Image.new('RGB', (4, 4), color='red').save(buf, format='PNG')
    buf.seek(0)
    return buf.read()


def make_test_pdf_bytes():
    import fitz  # PyMuPDF — same real dependency apps/invoices/comments.py validates PDF attachments with
    doc = fitz.open()
    doc.new_page()
    pdf_bytes = doc.tobytes()
    doc.close()
    return pdf_bytes


class FreelancerCommentsAPITestCase(TestCase):
    def setUp(self):
        cache.clear()
        self.rf = RequestFactory()
        self.client = DjangoTestClient(enforce_csrf_checks=True)
        self.user = User.objects.create_user(email='freelancer@example.com', password='Sup3r$ecret1')
        self.user.is_email_verified = True
        self.user.is_active = True
        self.user.save()
        self._login()
        self.portal_client = make_client(self.user)
        self.invoice = make_invoice(self.user, client=self.portal_client)
        InvoiceItem.objects.create(invoice=self.invoice, description='Work', quantity=Decimal('1'), unit_price=Decimal('100'))

    def _csrf_token(self):
        dummy = self.rf.get('/')
        token = get_token(dummy)
        self.client.cookies['csrftoken'] = dummy.META['CSRF_COOKIE']
        return token

    def _login(self):
        csrf_token = self._csrf_token()
        resp = self.client.post(reverse('users:login'), data=json.dumps({
            'login': self.user.email, 'password': 'Sup3r$ecret1',
        }), content_type='application/json', HTTP_X_CSRFTOKEN=csrf_token)
        assert resp.status_code == 200, resp.content

    def _get(self, url):
        return self.client.get(url)

    def _post_json(self, url, data=None):
        csrf_token = self._csrf_token()
        return self.client.post(url, data=json.dumps(data or {}), content_type='application/json', HTTP_X_CSRFTOKEN=csrf_token)

    def _post_multipart(self, url, data):
        csrf_token = self._csrf_token()
        return self.client.post(url, data, HTTP_X_CSRFTOKEN=csrf_token)

    def test_post_creates_a_real_freelancer_comment(self):
        resp = self._post_json(reverse('invoices:invoice_comments', kwargs={'pk': self.invoice.pk}), {'body_text': 'Hi there'})
        self.assertEqual(resp.status_code, 201)
        body = resp.json()
        self.assertEqual(body['author_type'], 'freelancer')
        self.assertEqual(body['source'], 'app')
        self.assertEqual(body['body_text'], 'Hi there')

        comment = InvoiceComment.objects.get(invoice=self.invoice)
        self.assertEqual(comment.author_user_id, self.user.pk)
        self.assertEqual(comment.author_type, 'freelancer')
        self.assertEqual(comment.source, 'app')

    def test_empty_body_is_rejected(self):
        resp = self._post_json(reverse('invoices:invoice_comments', kwargs={'pk': self.invoice.pk}), {'body_text': '   '})
        self.assertEqual(resp.status_code, 400)

    def test_client_supplied_author_type_and_author_user_are_ignored(self):
        """Explicit-fields discipline — the serializer only ever writes body_text; extra keys in the request body are simply ignored, not honored."""
        resp = self._post_json(reverse('invoices:invoice_comments', kwargs={'pk': self.invoice.pk}), {
            'body_text': 'trying to spoof', 'author_type': 'client', 'client_name': 'Fake Name', 'source': 'portal',
        })
        self.assertEqual(resp.status_code, 201)
        comment = InvoiceComment.objects.get(invoice=self.invoice)
        self.assertEqual(comment.author_type, 'freelancer')  # not overridden by the request body
        self.assertEqual(comment.source, 'app')

    def test_get_marks_unread_client_comments_read_by_freelancer_and_not_own_comments(self):
        client_comment = InvoiceComment.objects.create(
            invoice=self.invoice, author_type='client', client_name='Acme Co', client_email='acme@example.com',
            source='portal', body_text='client message',
        )
        own_comment = InvoiceComment.objects.create(
            invoice=self.invoice, author_type='freelancer', author_user=self.user, source='app', body_text='my own message',
        )
        resp = self._get(reverse('invoices:invoice_comments', kwargs={'pk': self.invoice.pk}))
        self.assertEqual(resp.status_code, 200)

        client_comment.refresh_from_db()
        own_comment.refresh_from_db()
        self.assertIsNotNone(client_comment.read_by_freelancer_at)
        self.assertIsNone(own_comment.read_by_freelancer_at)  # never touched for the freelancer's own comment

    def test_no_edit_or_delete_endpoint_exists(self):
        """
        CSRF is enforced for PUT/DELETE/PATCH on this freelancer-auth
        path (CookieJWTAuthentication.enforce_csrf no-ops only for safe
        methods) — a real token is included so these calls reach DRF's
        own method dispatch and correctly 405, rather than failing CSRF
        first and returning a 403 that would prove nothing about whether
        an edit/delete handler exists.
        """
        url = reverse('invoices:invoice_comments', kwargs={'pk': self.invoice.pk})
        self.assertEqual(self.client.put(url, data=json.dumps({}), content_type='application/json', HTTP_X_CSRFTOKEN=self._csrf_token()).status_code, 405)
        self.assertEqual(self.client.delete(url, HTTP_X_CSRFTOKEN=self._csrf_token()).status_code, 405)
        self.assertEqual(self.client.patch(url, data=json.dumps({}), content_type='application/json', HTTP_X_CSRFTOKEN=self._csrf_token()).status_code, 405)

    def test_never_reachable_for_another_freelancers_invoice(self):
        other_user = User.objects.create_user(email='other@example.com', password='Sup3r$ecret1')
        their_invoice = make_invoice(other_user)
        resp = self._get(reverse('invoices:invoice_comments', kwargs={'pk': their_invoice.pk}))
        self.assertEqual(resp.status_code, 404)

    def test_attachment_rejects_non_image_extension(self):
        fake_file = io.BytesIO(b'not an image')
        fake_file.name = 'malware.exe'
        resp = self._post_multipart(reverse('invoices:invoice_comments', kwargs={'pk': self.invoice.pk}), {
            'body_text': 'see attached', 'attachment': fake_file,
        })
        self.assertEqual(resp.status_code, 400)

    def test_attachment_rejects_content_that_is_not_really_an_image(self):
        fake_file = io.BytesIO(b'this is definitely not a real png')
        fake_file.name = 'fake.png'
        resp = self._post_multipart(reverse('invoices:invoice_comments', kwargs={'pk': self.invoice.pk}), {
            'body_text': 'see attached', 'attachment': fake_file,
        })
        self.assertEqual(resp.status_code, 400)

    @patch('cloudinary.uploader.upload')
    def test_attachment_uploads_a_real_image_and_sets_attachment_url(self, mock_upload):
        mock_upload.return_value = {'secure_url': 'https://res.cloudinary.com/demo/image/upload/comment.png', 'public_id': 'x'}
        real_image = io.BytesIO(make_test_image_bytes())
        real_image.name = 'photo.png'
        resp = self._post_multipart(reverse('invoices:invoice_comments', kwargs={'pk': self.invoice.pk}), {
            'body_text': 'see attached', 'attachment': real_image,
        })
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.json()['attachment_url'], 'https://res.cloudinary.com/demo/image/upload/comment.png')
        mock_upload.assert_called_once()

    # ── PDF attachments (item 9 of the verification pass) ──────────

    @patch('cloudinary.uploader.upload')
    def test_attachment_uploads_a_real_pdf_and_sets_attachment_url(self, mock_upload):
        mock_upload.return_value = {'secure_url': 'https://res.cloudinary.com/demo/raw/upload/comment.pdf', 'public_id': 'x'}
        real_pdf = io.BytesIO(make_test_pdf_bytes())
        real_pdf.name = 'receipt.pdf'
        resp = self._post_multipart(reverse('invoices:invoice_comments', kwargs={'pk': self.invoice.pk}), {
            'body_text': 'see attached receipt', 'attachment': real_pdf,
        })
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.json()['attachment_url'], 'https://res.cloudinary.com/demo/raw/upload/comment.pdf')
        mock_upload.assert_called_once()
        self.assertEqual(mock_upload.call_args.kwargs.get('resource_type'), 'raw')

    def test_attachment_rejects_content_that_is_not_really_a_pdf(self):
        fake_file = io.BytesIO(b'this is definitely not a real pdf')
        fake_file.name = 'fake.pdf'
        resp = self._post_multipart(reverse('invoices:invoice_comments', kwargs={'pk': self.invoice.pk}), {
            'body_text': 'see attached', 'attachment': fake_file,
        })
        self.assertEqual(resp.status_code, 400)
        self.assertIn('pdf', resp.json()['error'].lower())


class PortalCommentsAPITestCase(TestCase):
    def setUp(self):
        cache.clear()
        self.rf = RequestFactory()
        self.client = DjangoTestClient(enforce_csrf_checks=True)
        self.user = User.objects.create_user(email='freelancer@example.com', password='Sup3r$ecret1')
        self.portal_client = make_client(self.user)
        self.invoice = make_invoice(self.user, client=self.portal_client)
        InvoiceItem.objects.create(invoice=self.invoice, description='Work', quantity=Decimal('1'), unit_price=Decimal('100'))

    def _get(self, url):
        return self.client.get(url)

    def _csrf_token(self):
        dummy = self.rf.get('/')
        token = get_token(dummy)
        self.client.cookies['csrftoken'] = dummy.META['CSRF_COOKIE']
        return token

    def _post_json(self, url, data=None):
        csrf_token = self._csrf_token()
        return self.client.post(url, data=json.dumps(data or {}), content_type='application/json', HTTP_X_CSRFTOKEN=csrf_token)

    def _set_portal_session(self, raw_token='raw-tok'):
        ClientPortalSession.create_for_client(self.portal_client, raw_token, device_name='', ip_address=None, user_agent='')
        self.client.cookies[PORTAL_SESSION_COOKIE_NAME] = raw_token
        return raw_token

    def test_requires_a_valid_session(self):
        resp = self._get(reverse('invoices:portal_invoice_comments', kwargs={'pk': self.invoice.pk}))
        self.assertEqual(resp.status_code, 401)

    def test_post_creates_a_real_client_comment_with_snapshotted_identity(self):
        self._set_portal_session()
        resp = self._post_json(reverse('invoices:portal_invoice_comments', kwargs={'pk': self.invoice.pk}), {'body_text': 'When is this due?'})
        self.assertEqual(resp.status_code, 201)
        body = resp.json()
        self.assertEqual(body['author_type'], 'client')
        self.assertEqual(body['source'], 'portal')

        comment = InvoiceComment.objects.get(invoice=self.invoice)
        self.assertEqual(comment.client_name, self.portal_client.name)
        self.assertEqual(comment.client_email, self.portal_client.email)
        self.assertEqual(comment.author_type, 'client')

    def test_scoped_to_the_resolved_clients_own_invoices_only_real_404(self):
        other_client = make_client(self.user, name='Beta Co', email='beta@example.com')
        their_invoice = make_invoice(self.user, client=other_client, client_name='Beta Co')
        self._set_portal_session()
        resp = self._get(reverse('invoices:portal_invoice_comments', kwargs={'pk': their_invoice.pk}))
        self.assertEqual(resp.status_code, 404)

    def test_get_marks_unread_freelancer_comments_read_by_client(self):
        freelancer_comment = InvoiceComment.objects.create(
            invoice=self.invoice, author_type='freelancer', author_user=self.user, source='app', body_text='reply from freelancer',
        )
        self._set_portal_session()
        resp = self._get(reverse('invoices:portal_invoice_comments', kwargs={'pk': self.invoice.pk}))
        self.assertEqual(resp.status_code, 200)
        freelancer_comment.refresh_from_db()
        self.assertIsNotNone(freelancer_comment.read_by_client_at)

    def test_no_edit_or_delete_endpoint_exists(self):
        self._set_portal_session()
        url = reverse('invoices:portal_invoice_comments', kwargs={'pk': self.invoice.pk})
        self.assertEqual(self.client.put(url, data=json.dumps({}), content_type='application/json').status_code, 405)
        self.assertEqual(self.client.delete(url).status_code, 405)

    def test_rate_limited_after_15_posts_in_an_hour(self):
        self._set_portal_session()
        url = reverse('invoices:portal_invoice_comments', kwargs={'pk': self.invoice.pk})
        for _ in range(15):
            resp = self._post_json(url, {'body_text': 'msg'})
            self.assertEqual(resp.status_code, 201)
        resp = self._post_json(url, {'body_text': 'one too many'})
        self.assertEqual(resp.status_code, 429)


class DualEntryTests(TestCase):
    """Portal POST and the email webhook both land in the same real thread, correctly tagged by source."""
    def setUp(self):
        cache.clear()
        self.client = DjangoTestClient(enforce_csrf_checks=True)
        self.user = User.objects.create_user(email='freelancer@example.com', password='Sup3r$ecret1')
        self.portal_client = make_client(self.user)
        self.invoice = make_invoice(self.user, client=self.portal_client, client_email='acme@example.com')
        InvoiceItem.objects.create(invoice=self.invoice, description='Work', quantity=Decimal('1'), unit_price=Decimal('100'))

    @override_settings(CLOUDFLARE_WEBHOOK_SECRET='test-secret')
    def test_portal_post_and_webhook_reply_both_land_in_the_same_thread(self):
        # Portal side
        raw_token = 'dual-entry-tok'
        ClientPortalSession.create_for_client(self.portal_client, raw_token, device_name='', ip_address=None, user_agent='')
        self.client.cookies[PORTAL_SESSION_COOKIE_NAME] = raw_token
        rf = RequestFactory()
        dummy = rf.get('/')
        csrf_token = get_token(dummy)
        self.client.cookies['csrftoken'] = dummy.META['CSRF_COOKIE']
        portal_resp = self.client.post(
            reverse('invoices:portal_invoice_comments', kwargs={'pk': self.invoice.pk}),
            data=json.dumps({'body_text': 'portal message'}), content_type='application/json', HTTP_X_CSRFTOKEN=csrf_token,
        )
        self.assertEqual(portal_resp.status_code, 201)

        # Webhook side — the client replying by email
        webhook_resp = self.client.post(
            reverse('invoices:email_incoming_webhook'),
            data=json.dumps({
                'from': 'acme@example.com', 'to': f'reply+{self.invoice.view_token}@lanceraos.com',
                'text': 'email reply message',
            }),
            content_type='application/json', HTTP_X_WEBHOOK_SECRET='test-secret',
        )
        self.assertEqual(webhook_resp.status_code, 201)

        comments = InvoiceComment.objects.filter(invoice=self.invoice).order_by('created_at')
        self.assertEqual(comments.count(), 2)
        self.assertEqual([c.source for c in comments], ['portal', 'email_reply'])
        self.assertTrue(all(c.author_type == 'client' for c in comments))


class EmailWebhookTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(email='freelancer@example.com', password='Sup3r$ecret1')
        self.portal_client = make_client(self.user, email='acme@example.com')
        self.invoice = make_invoice(self.user, client=self.portal_client, client_email='acme@example.com')
        self.client_django = DjangoTestClient()
        self.url = reverse('invoices:email_incoming_webhook')

    def _post(self, payload, secret='test-secret'):
        headers = {'HTTP_X_WEBHOOK_SECRET': secret} if secret is not None else {}
        return self.client_django.post(self.url, data=json.dumps(payload), content_type='application/json', **headers)

    @override_settings(CLOUDFLARE_WEBHOOK_SECRET='test-secret')
    def test_client_reply_creates_a_client_authored_comment(self):
        resp = self._post({'from': 'acme@example.com', 'to': f'reply+{self.invoice.view_token}@lanceraos.com', 'text': 'hi'})
        self.assertEqual(resp.status_code, 201)
        comment = InvoiceComment.objects.get(invoice=self.invoice)
        self.assertEqual(comment.author_type, 'client')
        self.assertEqual(comment.source, 'email_reply')

    @override_settings(CLOUDFLARE_WEBHOOK_SECRET='test-secret')
    def test_freelancer_reply_creates_a_freelancer_authored_comment(self):
        resp = self._post({'from': 'freelancer@example.com', 'to': f'reply+{self.invoice.view_token}@lanceraos.com', 'text': 'hi back'})
        self.assertEqual(resp.status_code, 201)
        comment = InvoiceComment.objects.get(invoice=self.invoice)
        self.assertEqual(comment.author_type, 'freelancer')
        self.assertEqual(comment.author_user_id, self.user.pk)

    @override_settings(CLOUDFLARE_WEBHOOK_SECRET='test-secret')
    def test_missing_secret_is_rejected(self):
        resp = self._post({'from': 'acme@example.com', 'to': f'reply+{self.invoice.view_token}@lanceraos.com', 'text': 'hi'}, secret=None)
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(InvoiceComment.objects.count(), 0)

    @override_settings(CLOUDFLARE_WEBHOOK_SECRET='test-secret')
    def test_wrong_secret_is_rejected(self):
        resp = self._post({'from': 'acme@example.com', 'to': f'reply+{self.invoice.view_token}@lanceraos.com', 'text': 'hi'}, secret='wrong')
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(InvoiceComment.objects.count(), 0)

    @override_settings(CLOUDFLARE_WEBHOOK_SECRET='')
    def test_unset_secret_rejects_every_request_fails_closed(self):
        resp = self._post({'from': 'acme@example.com', 'to': f'reply+{self.invoice.view_token}@lanceraos.com', 'text': 'hi'}, secret='anything')
        self.assertEqual(resp.status_code, 403)

    @override_settings(CLOUDFLARE_WEBHOOK_SECRET='test-secret')
    def test_recipient_not_matching_reply_pattern_is_rejected(self):
        resp = self._post({'from': 'acme@example.com', 'to': 'not-a-reply-address@lanceraos.com', 'text': 'hi'})
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(InvoiceComment.objects.count(), 0)

    @override_settings(CLOUDFLARE_WEBHOOK_SECRET='test-secret')
    def test_unknown_token_is_rejected_with_404(self):
        resp = self._post({'from': 'acme@example.com', 'to': 'reply+doesnotexist12345@lanceraos.com', 'text': 'hi'})
        self.assertEqual(resp.status_code, 404)
        self.assertEqual(InvoiceComment.objects.count(), 0)

    @override_settings(CLOUDFLARE_WEBHOOK_SECRET='test-secret')
    def test_stranger_sender_is_rejected(self):
        resp = self._post({'from': 'stranger@example.com', 'to': f'reply+{self.invoice.view_token}@lanceraos.com', 'text': 'hi'})
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(InvoiceComment.objects.count(), 0)

    @override_settings(CLOUDFLARE_WEBHOOK_SECRET='test-secret')
    def test_empty_body_is_rejected(self):
        resp = self._post({'from': 'acme@example.com', 'to': f'reply+{self.invoice.view_token}@lanceraos.com', 'text': '   ', 'html': ''})
        self.assertEqual(resp.status_code, 400)

    @override_settings(CLOUDFLARE_WEBHOOK_SECRET='test-secret')
    def test_html_only_body_falls_back_to_stripped_text(self):
        resp = self._post({
            'from': 'acme@example.com', 'to': f'reply+{self.invoice.view_token}@lanceraos.com',
            'text': '', 'html': '<p>hello <strong>world</strong></p>',
        })
        self.assertEqual(resp.status_code, 201)
        comment = InvoiceComment.objects.get(invoice=self.invoice)
        self.assertIn('hello', comment.body_text)
        self.assertIn('world', comment.body_text)
        self.assertNotIn('<p>', comment.body_text)


class UnreadBatchTaskTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(email='freelancer@example.com', password='Sup3r$ecret1')
        self.portal_client = make_client(self.user, email='acme@example.com')
        self.invoice = make_invoice(self.user, client=self.portal_client, client_email='acme@example.com')

    def _old_client_comment(self, **overrides):
        defaults = {
            'invoice': self.invoice, 'author_type': 'client', 'client_name': 'Acme Co', 'client_email': 'acme@example.com',
            'source': 'portal', 'body_text': 'old unread message',
        }
        defaults.update(overrides)
        comment = InvoiceComment.objects.create(**defaults)
        InvoiceComment.objects.filter(pk=comment.pk).update(created_at=timezone.now() - timedelta(hours=2))
        return InvoiceComment.objects.get(pk=comment.pk)

    @patch('apps.invoices.tasks.send_email')
    def test_fires_once_for_an_old_unread_client_comment(self, mock_send):
        mock_send.return_value = True
        from apps.invoices.tasks import notify_unread_comments
        comment = self._old_client_comment()

        result = notify_unread_comments()
        self.assertEqual(result['notified'], 1)
        mock_send.assert_called_once()

        comment.refresh_from_db()
        self.assertIsNotNone(comment.unread_reminder_sent_at)

    @patch('apps.invoices.tasks.send_email')
    def test_does_not_fire_twice_for_the_same_unread_state(self, mock_send):
        mock_send.return_value = True
        from apps.invoices.tasks import notify_unread_comments
        self._old_client_comment()

        notify_unread_comments()
        mock_send.reset_mock()
        result = notify_unread_comments()  # a second run, comment already marked unread_reminder_sent_at
        self.assertEqual(result['notified'], 0)
        mock_send.assert_not_called()

    @patch('apps.invoices.tasks.send_email')
    def test_batches_multiple_unread_comments_on_the_same_invoice_into_one_email(self, mock_send):
        mock_send.return_value = True
        from apps.invoices.tasks import notify_unread_comments
        self._old_client_comment(body_text='first')
        self._old_client_comment(body_text='second')

        result = notify_unread_comments()
        self.assertEqual(result['notified'], 2)
        mock_send.assert_called_once()  # ONE email, not two

    @patch('apps.invoices.tasks.send_email')
    def test_does_not_fire_for_a_recent_unread_comment(self, mock_send):
        from apps.invoices.tasks import notify_unread_comments
        InvoiceComment.objects.create(
            invoice=self.invoice, author_type='client', client_name='Acme Co', client_email='acme@example.com',
            source='portal', body_text='just now',
        )
        result = notify_unread_comments()
        self.assertEqual(result['notified'], 0)
        mock_send.assert_not_called()

    @patch('apps.invoices.tasks.send_email')
    def test_does_not_fire_for_an_already_read_comment(self, mock_send):
        from apps.invoices.tasks import notify_unread_comments
        comment = self._old_client_comment()
        comment.read_by_freelancer_at = timezone.now()
        comment.save(update_fields=['read_by_freelancer_at'])

        result = notify_unread_comments()
        self.assertEqual(result['notified'], 0)
        mock_send.assert_not_called()

    @patch('apps.invoices.tasks.send_client_facing_email')
    def test_fires_for_an_old_unread_freelancer_comment_via_the_client_facing_chain(self, mock_send):
        mock_send.return_value = {'sent': True, 'sent_via': 'resend', 'smtp_host': None, 'provider_message_id': 'x', 'fallback_used': False, 'error': None}
        from apps.invoices.tasks import notify_unread_comments
        comment = InvoiceComment.objects.create(
            invoice=self.invoice, author_type='freelancer', author_user=self.user, source='app', body_text='old freelancer reply',
        )
        InvoiceComment.objects.filter(pk=comment.pk).update(created_at=timezone.now() - timedelta(hours=2))

        result = notify_unread_comments()
        self.assertEqual(result['notified'], 1)
        mock_send.assert_called_once()
        call_kwargs = mock_send.call_args
        self.assertEqual(call_kwargs.args[0].pk, self.user.pk)  # `user` positional arg — routes AS the freelancer
        self.assertEqual(call_kwargs.args[1], self.invoice.client_email)  # `to` positional arg
