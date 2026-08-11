# apps/invoices/tests/test_send.py
"""
Step 10 — the real /send/ action, the custom-SMTP-vs-Resend routing
chain (apps/invoices/email_service.py), and the reminder Celery task
(apps/invoices/tasks.py). All real email sends and Cloudinary fetches
are mocked here — core/test_runner.py's SafeTestRunner already patches
requests.post suite-wide (Resend), but requests.get (Cloudinary PDF
fetch) and Django's SMTP backend are NOT covered by that net and are
mocked directly in every test that touches them, per this project's own
convention.
"""
import json
from datetime import date, timedelta
from decimal import Decimal
from unittest.mock import MagicMock, patch

from django.core.cache import cache
from django.urls import reverse
from django.utils import timezone

from core.encryption import encrypt_field
from core.models import AuditLog

from apps.invoices.models import Invoice, InvoiceItem, InvoiceReminder
from apps.invoices.tests.test_models import make_invoice
from apps.invoices.tests.test_views import InvoicesAPITestCase

FAKE_PDF_URL = 'https://res.cloudinary.com/lanceraos-test/invoice_fake.pdf'
FAKE_PDF_BYTES = b'%PDF-1.4 fake pdf content for tests'


def _mock_pdf_fetch_response():
    resp = MagicMock(status_code=200, content=FAKE_PDF_BYTES)
    resp.raise_for_status = MagicMock()
    return resp


def _sendable_invoice(user, **overrides):
    """A finalised, not-yet-sent invoice with a real pdf_url — the exact
    precondition invoice_send requires."""
    defaults = {'status': 'created', 'pdf_url': FAKE_PDF_URL, 'client_email': 'client@example.com'}
    defaults.update(overrides)
    invoice = make_invoice(user, **defaults)
    InvoiceItem.objects.create(invoice=invoice, description='Work', quantity=Decimal('1'), unit_price=Decimal('100'))
    return invoice


class InvoiceSendGatingTests(InvoicesAPITestCase):
    def test_requires_confirm(self):
        invoice = _sendable_invoice(self.user)
        resp = self._post(reverse('invoices:invoice_send', kwargs={'pk': invoice.pk}), {})
        self.assertEqual(resp.status_code, 400)

    def test_only_from_created_status(self):
        for bad_status in ('draft', 'sent', 'paid', 'cancelled'):
            with self.subTest(status=bad_status):
                invoice = _sendable_invoice(self.user, status=bad_status)
                resp = self._post(reverse('invoices:invoice_send', kwargs={'pk': invoice.pk}), {'confirm': True})
                self.assertEqual(resp.status_code, 400)

    def test_requires_a_pdf_url(self):
        invoice = _sendable_invoice(self.user, pdf_url='')
        resp = self._post(reverse('invoices:invoice_send', kwargs={'pk': invoice.pk}), {'confirm': True})
        self.assertEqual(resp.status_code, 400)

    @patch('apps.invoices.email_service.requests.get')
    def test_pdf_fetch_failure_returns_502_and_does_not_change_status(self, mock_get):
        import requests
        mock_get.side_effect = requests.RequestException('connection reset')
        invoice = _sendable_invoice(self.user)
        resp = self._post(reverse('invoices:invoice_send', kwargs={'pk': invoice.pk}), {'confirm': True})
        self.assertEqual(resp.status_code, 502)
        invoice.refresh_from_db()
        self.assertEqual(invoice.status, 'created')
        self.assertFalse(invoice.sent_via_platform)

    @patch('apps.invoices.email_service.requests.get')
    def test_never_re_renders_or_re_stores_the_pdf(self, mock_get):
        """
        The PDF is already frozen by _finalise_invoice — invoice_send must
        only fetch the existing pdf_url's bytes, never call
        render_invoice_pdf/store_invoice_pdf again.
        """
        mock_get.return_value = _mock_pdf_fetch_response()
        invoice = _sendable_invoice(self.user)
        with patch('apps.invoices.views.render_invoice_pdf') as mock_render, \
             patch('apps.invoices.views.store_invoice_pdf') as mock_store:
            resp = self._post(reverse('invoices:invoice_send', kwargs={'pk': invoice.pk}), {'confirm': True})
            self.assertEqual(resp.status_code, 200)
            mock_render.assert_not_called()
            mock_store.assert_not_called()
        invoice.refresh_from_db()
        self.assertEqual(invoice.pdf_url, FAKE_PDF_URL)


class InvoiceSendResendPathTests(InvoicesAPITestCase):
    """Default path — no custom SMTP configured at all."""

    @patch('apps.invoices.email_service.requests.get')
    def test_send_success_sets_status_and_sent_via_platform(self, mock_get):
        mock_get.return_value = _mock_pdf_fetch_response()
        invoice = _sendable_invoice(self.user)
        resp = self._post(reverse('invoices:invoice_send', kwargs={'pk': invoice.pk}), {'confirm': True})
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body['status'], 'sent')
        self.assertTrue(body['sent_via_platform'])  # the one thing mark-sent never sets
        invoice.refresh_from_db()
        self.assertEqual(invoice.status, 'sent')
        self.assertTrue(invoice.sent_via_platform)
        self.assertIsNotNone(invoice.sent_at)

    @patch('apps.invoices.email_service.requests.get')
    def test_send_reaches_resend_with_pdf_attached_cc_and_reply_to(self, mock_get):
        """
        Real assertion on the actual Resend HTTP payload — not just that
        *a* request happened. Overrides the suite-wide requests.post mock
        locally to inspect what was actually sent.
        """
        mock_get.return_value = _mock_pdf_fetch_response()
        invoice = _sendable_invoice(self.user)

        fake_resend_response = MagicMock(status_code=200, text='')
        fake_resend_response.json.return_value = {'id': 'resend-msg-123'}
        with patch('requests.post', return_value=fake_resend_response) as mock_post:
            resp = self._post(reverse('invoices:invoice_send', kwargs={'pk': invoice.pk}), {'confirm': True})
            self.assertEqual(resp.status_code, 200)
            mock_post.assert_called_once()
            payload = json.loads(mock_post.call_args.kwargs['json']) if isinstance(mock_post.call_args.kwargs.get('json'), str) else mock_post.call_args.kwargs['json']

        self.assertEqual(payload['to'], [invoice.client_email])
        self.assertEqual(payload['cc'], [self.user.email])
        self.assertIn('reply_to', payload)
        self.assertTrue(payload['reply_to'].startswith('reply+'))
        self.assertTrue(payload['reply_to'].endswith('@lanceraos.com'))
        self.assertIn(invoice.view_token, payload['reply_to'])
        self.assertIn('attachments', payload)
        self.assertEqual(len(payload['attachments']), 1)
        self.assertTrue(payload['attachments'][0]['filename'].endswith('.pdf'))
        self.assertTrue(len(payload['attachments'][0]['content']) > 0)  # base64 content present

    @patch('apps.invoices.email_service.requests.get')
    def test_send_failure_from_resend_returns_502_and_leaves_invoice_unsent(self, mock_get):
        mock_get.return_value = _mock_pdf_fetch_response()
        invoice = _sendable_invoice(self.user)
        failing_response = MagicMock(status_code=500, text='internal error')
        with patch('requests.post', return_value=failing_response):
            resp = self._post(reverse('invoices:invoice_send', kwargs={'pk': invoice.pk}), {'confirm': True})
        self.assertEqual(resp.status_code, 502)
        invoice.refresh_from_db()
        self.assertEqual(invoice.status, 'created')
        self.assertFalse(invoice.sent_via_platform)

    @patch('apps.invoices.email_service.requests.get')
    def test_reminders_enabled_value_is_left_untouched_by_send(self, mock_get):
        mock_get.return_value = _mock_pdf_fetch_response()
        for starting_value in (True, False):
            with self.subTest(starting_value=starting_value):
                invoice = _sendable_invoice(self.user, reminders_enabled=starting_value)
                self._post(reverse('invoices:invoice_send', kwargs={'pk': invoice.pk}), {'confirm': True})
                invoice.refresh_from_db()
                self.assertEqual(invoice.reminders_enabled, starting_value)


class InvoiceSendCustomSmtpPathTests(InvoicesAPITestCase):
    def _enable_verified_custom_smtp(self, host='smtp.gmail.com'):
        profile = self.user.profile
        profile.custom_smtp_enabled = True
        profile.custom_smtp_verified = True
        profile.custom_smtp_host = host
        profile.custom_smtp_port = 587
        profile.custom_smtp_username = 'me@mybusiness.com'
        profile.custom_smtp_password = encrypt_field('app-password-123')
        profile.custom_smtp_use_tls = True
        profile.custom_smtp_use_ssl = False
        profile.custom_smtp_from_name = 'Ali — Web Dev'
        profile.save()
        return profile

    @patch('apps.invoices.email_service.requests.get')
    @patch('django.core.mail.backends.smtp.EmailBackend.send_messages', return_value=1)
    def test_enabled_and_verified_sends_via_custom_smtp_never_touches_resend(self, mock_smtp_send, mock_get):
        mock_get.return_value = _mock_pdf_fetch_response()
        self._enable_verified_custom_smtp()
        invoice = _sendable_invoice(self.user)

        with patch('requests.post') as mock_resend_post:
            resp = self._post(reverse('invoices:invoice_send', kwargs={'pk': invoice.pk}), {'confirm': True})
            self.assertEqual(resp.status_code, 200)
            mock_resend_post.assert_not_called()  # never fell back — no reason to

        mock_smtp_send.assert_called_once()
        invoice.refresh_from_db()
        self.assertEqual(invoice.status, 'sent')
        self.assertTrue(invoice.sent_via_platform)

    @patch('apps.invoices.email_service.requests.get')
    @patch('django.core.mail.backends.smtp.EmailBackend.send_messages', return_value=1)
    def test_custom_smtp_message_uses_the_users_own_from_address(self, mock_smtp_send, mock_get):
        mock_get.return_value = _mock_pdf_fetch_response()
        self._enable_verified_custom_smtp()
        invoice = _sendable_invoice(self.user)

        self._post(reverse('invoices:invoice_send', kwargs={'pk': invoice.pk}), {'confirm': True})

        mock_smtp_send.assert_called_once()
        # Whether the mock's call captured a bound `self` as the first
        # positional arg depends on mock's own method-binding behavior for
        # a plain (non-autospec) replacement — the message list itself is
        # always the LAST positional arg regardless, so anchor on that
        # instead of assuming a fixed arg count.
        email_messages = mock_smtp_send.call_args.args[-1]
        msg = email_messages[0]
        self.assertIn('me@mybusiness.com', msg.from_email)
        self.assertIn('Ali — Web Dev', msg.from_email)
        self.assertEqual(msg.to, [invoice.client_email])
        self.assertEqual(msg.cc, [self.user.email])
        self.assertTrue(any(a[0].endswith('.pdf') for a in msg.attachments))

    @patch('apps.invoices.email_service.requests.get')
    @patch('django.core.mail.backends.smtp.EmailBackend.send_messages', side_effect=OSError('Connection refused'))
    def test_custom_smtp_failure_falls_back_to_resend_immediately(self, mock_smtp_send, mock_get):
        mock_get.return_value = _mock_pdf_fetch_response()
        self._enable_verified_custom_smtp(host='smtp.badhost.example.com')
        invoice = _sendable_invoice(self.user)

        fake_resend_response = MagicMock(status_code=200, text='')
        fake_resend_response.json.return_value = {'id': 'resend-fallback-1'}
        with patch('requests.post', return_value=fake_resend_response) as mock_post:
            resp = self._post(reverse('invoices:invoice_send', kwargs={'pk': invoice.pk}), {'confirm': True})
            self.assertEqual(resp.status_code, 200)
            mock_post.assert_called_once()  # fell back to Resend

        invoice.refresh_from_db()
        self.assertEqual(invoice.status, 'sent')
        self.assertTrue(invoice.sent_via_platform)

    @patch('apps.invoices.email_service.requests.get')
    @patch('django.core.mail.backends.smtp.EmailBackend.send_messages', side_effect=OSError('Connection refused'))
    def test_custom_smtp_failure_the_client_facing_email_is_identical_either_way(self, mock_smtp_send, mock_get):
        """
        CLAUDE.md rule 4: the client must never be told a fallback
        happened — the Resend payload sent on fallback must carry the
        exact same subject/recipient/attachment as a normal send.
        """
        mock_get.return_value = _mock_pdf_fetch_response()
        self._enable_verified_custom_smtp()
        invoice = _sendable_invoice(self.user)

        fake_resend_response = MagicMock(status_code=200, text='')
        fake_resend_response.json.return_value = {'id': 'x'}
        with patch('requests.post', return_value=fake_resend_response) as mock_post:
            self._post(reverse('invoices:invoice_send', kwargs={'pk': invoice.pk}), {'confirm': True})
            payload = mock_post.call_args.kwargs['json']

        self.assertEqual(payload['to'], [invoice.client_email])
        self.assertIn('attachments', payload)
        self.assertNotIn('fallback', payload['subject'].lower())
        self.assertNotIn('smtp', payload['html'].lower())

    @patch('apps.invoices.email_service.requests.get')
    @patch('django.core.mail.backends.smtp.EmailBackend.send_messages', side_effect=OSError('Auth failed: bad credentials'))
    def test_custom_smtp_failure_writes_the_exact_in_app_notification_copy(self, mock_smtp_send, mock_get):
        mock_get.return_value = _mock_pdf_fetch_response()
        self._enable_verified_custom_smtp(host='smtp.mybusiness.com')
        invoice = _sendable_invoice(self.user, client_name='Acme Corp')

        fake_resend_response = MagicMock(status_code=200, text='')
        fake_resend_response.json.return_value = {'id': 'x'}
        with patch('requests.post', return_value=fake_resend_response):
            self._post(reverse('invoices:invoice_send', kwargs={'pk': invoice.pk}), {'confirm': True})

        log = AuditLog.objects.filter(user=self.user, event='custom_smtp_failed').latest('created_at')
        self.assertEqual(log.metadata['smtp_host'], 'smtp.mybusiness.com')
        self.assertIn('Auth failed', log.metadata['error_message'])
        self.assertTrue(log.metadata['fallback_used'])
        self.assertEqual(log.metadata['client_name'], 'Acme Corp')
        self.assertIsNotNone(log.created_at)  # the timestamp CLAUDE.md rule 4 requires

        # The exact copy from core/notifications.py's _describe(), via
        # the real bell-list endpoint — not just the raw AuditLog row.
        from core.notifications import _describe
        message = _describe(log)
        self.assertEqual(
            message,
            'Your email to Acme Corp was sent from noreply@lanceraos.com '
            'because your custom email failed. Check your SMTP settings.',
        )

    @patch('apps.invoices.email_service.requests.get')
    @patch('django.core.mail.backends.smtp.EmailBackend.send_messages', side_effect=OSError('boom'))
    def test_custom_smtp_failed_appears_in_the_real_notification_bell_endpoint(self, mock_smtp_send, mock_get):
        mock_get.return_value = _mock_pdf_fetch_response()
        self._enable_verified_custom_smtp()
        invoice = _sendable_invoice(self.user, client_name='Beta LLC')
        fake_resend_response = MagicMock(status_code=200, text='')
        fake_resend_response.json.return_value = {'id': 'x'}
        with patch('requests.post', return_value=fake_resend_response):
            self._post(reverse('invoices:invoice_send', kwargs={'pk': invoice.pk}), {'confirm': True})

        resp = self._get(reverse('notifications_list'))
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        matches = [n for n in body['notifications'] if n['type'] == 'custom_smtp_failed']
        self.assertEqual(len(matches), 1)
        self.assertIn('Beta LLC', matches[0]['message'])
        self.assertEqual(matches[0]['action_url'], '/settings?tab=smtp')

    def test_disabled_custom_smtp_uses_resend(self):
        # custom_smtp_enabled defaults False — never explicitly enabled here.
        with patch('apps.invoices.email_service.requests.get') as mock_get, patch('requests.post') as mock_post:
            mock_get.return_value = _mock_pdf_fetch_response()
            fake_resp = MagicMock(status_code=200, text='')
            fake_resp.json.return_value = {'id': 'x'}
            mock_post.return_value = fake_resp
            invoice = _sendable_invoice(self.user)
            resp = self._post(reverse('invoices:invoice_send', kwargs={'pk': invoice.pk}), {'confirm': True})
            self.assertEqual(resp.status_code, 200)
            mock_post.assert_called_once()

    @patch('apps.invoices.email_service.requests.get')
    def test_enabled_but_not_yet_verified_uses_resend_not_custom_smtp(self, mock_get):
        """
        custom_smtp_enabled=True alone is not enough — verified must also
        be True (matches save_custom_smtp's own invariant: enabled and
        verified are always set together, never enabled-without-verified
        through the real save flow — but this endpoint must not assume
        that invariant can never be violated by, say, a future bug
        elsewhere, so it checks both explicitly).
        """
        mock_get.return_value = _mock_pdf_fetch_response()
        profile = self.user.profile
        profile.custom_smtp_enabled = True
        profile.custom_smtp_verified = False
        profile.custom_smtp_host = 'smtp.example.com'
        profile.save()
        invoice = _sendable_invoice(self.user)

        with patch('django.core.mail.backends.smtp.EmailBackend.send_messages') as mock_smtp, \
             patch('requests.post') as mock_post:
            fake_resp = MagicMock(status_code=200, text='')
            fake_resp.json.return_value = {'id': 'x'}
            mock_post.return_value = fake_resp
            self._post(reverse('invoices:invoice_send', kwargs={'pk': invoice.pk}), {'confirm': True})
            mock_smtp.assert_not_called()
            mock_post.assert_called_once()


class InvoiceSendEventsAndAuditTests(InvoicesAPITestCase):
    @patch('apps.invoices.email_service.requests.get')
    def test_invoice_sent_event_recorded_with_via_platform(self, mock_get):
        mock_get.return_value = _mock_pdf_fetch_response()
        invoice = _sendable_invoice(self.user)
        self._post(reverse('invoices:invoice_send', kwargs={'pk': invoice.pk}), {'confirm': True})

        log = AuditLog.objects.filter(user=self.user, event='invoice_sent').latest('created_at')
        self.assertEqual(log.metadata['via'], 'platform')
        self.assertEqual(log.metadata['invoice_id'], str(invoice.pk))

    @patch('apps.invoices.email_service.requests.get')
    def test_timeline_shows_sent_by_lanceraos_for_a_real_send(self, mock_get):
        mock_get.return_value = _mock_pdf_fetch_response()
        invoice = _sendable_invoice(self.user)
        self._post(reverse('invoices:invoice_send', kwargs={'pk': invoice.pk}), {'confirm': True})

        resp = self._get(reverse('invoices:invoice_timeline', kwargs={'pk': invoice.pk}))
        entries = resp.json()['results']
        sent_entry = next(e for e in entries if e['type'] == 'sent')
        self.assertEqual(sent_entry['via'], 'platform')


class SendBannerConditionTests(InvoicesAPITestCase):
    """
    The banner's third case (sent_via_platform=True -> no warning at
    all) had no real data to exercise it until this step — confirming
    directly against the real backend response now that one exists.
    """
    @patch('apps.invoices.email_service.requests.get')
    def test_real_send_response_has_sent_via_platform_true(self, mock_get):
        mock_get.return_value = _mock_pdf_fetch_response()
        invoice = _sendable_invoice(self.user)
        resp = self._post(reverse('invoices:invoice_send', kwargs={'pk': invoice.pk}), {'confirm': True})
        # This is exactly the field frontend/src/pages/invoiceHelpers.js's
        # getSendBannerCopy() checks first, unconditionally, to suppress
        # the banner — confirming the real backend now genuinely produces
        # True here (not just that the frontend condition exists).
        self.assertTrue(resp.json()['sent_via_platform'])

    def test_mark_sent_never_produces_sent_via_platform_true(self):
        """Contrast case — the manual flip must never trip this condition."""
        invoice = _sendable_invoice(self.user, status='draft', pdf_url='')
        resp = self._post(reverse('invoices:invoice_mark_sent', kwargs={'pk': invoice.pk}), {'confirm': True, 'send_reminders': True})
        self.assertFalse(resp.json()['sent_via_platform'])


class RateLimitTests(InvoicesAPITestCase):
    def test_send_is_rate_limited(self):
        cache.clear()
        with patch('apps.invoices.email_service.requests.get') as mock_get, patch('requests.post') as mock_post:
            mock_get.return_value = _mock_pdf_fetch_response()
            fake_resp = MagicMock(status_code=200, text='')
            fake_resp.json.return_value = {'id': 'x'}
            mock_post.return_value = fake_resp
            for _ in range(30):
                invoice = _sendable_invoice(self.user)
                self._post(reverse('invoices:invoice_send', kwargs={'pk': invoice.pk}), {'confirm': True})
            invoice = _sendable_invoice(self.user)
            resp = self._post(reverse('invoices:invoice_send', kwargs={'pk': invoice.pk}), {'confirm': True})
            self.assertEqual(resp.status_code, 429)


# ══════════════════════════════════════════════════════════════════
# REMINDER TASK
# ══════════════════════════════════════════════════════════════════

class ReminderTaskTests(InvoicesAPITestCase):
    def _overdue_sent_invoice(self, days_overdue, **overrides):
        defaults = {
            'status': 'sent', 'sent_via_platform': True, 'reminders_enabled': True,
            'due_date': timezone.now().date() - timedelta(days=days_overdue),
        }
        defaults.update(overrides)
        return make_invoice(self.user, **defaults)

    @patch('apps.invoices.tasks.send_invoice_related_email')
    def test_reminder_fires_at_day_3_for_eligible_invoice(self, mock_send):
        mock_send.return_value = {'sent': True, 'sent_via': 'resend', 'smtp_host': None, 'provider_message_id': 'x', 'fallback_used': False, 'error': None}
        from apps.invoices.tasks import send_invoice_reminders
        invoice = self._overdue_sent_invoice(3)

        result = send_invoice_reminders()

        self.assertEqual(result['sent'], 1)
        mock_send.assert_called_once()
        self.assertTrue(InvoiceReminder.objects.filter(invoice=invoice, reminder_number=1).exists())
        invoice.refresh_from_db()
        self.assertEqual(invoice.reminder_count, 1)
        self.assertIsNotNone(invoice.last_reminder_sent_at)

    @patch('apps.invoices.tasks.send_invoice_related_email')
    def test_reminder_never_fires_when_sent_via_platform_is_false(self, mock_send):
        """
        The exact rule Step 10 makes real for the first time — a manually
        mark-sent invoice, however overdue, is never reminded.
        """
        from apps.invoices.tasks import send_invoice_reminders
        self._overdue_sent_invoice(10, sent_via_platform=False)

        result = send_invoice_reminders()

        self.assertEqual(result['sent'], 0)
        mock_send.assert_not_called()

    @patch('apps.invoices.tasks.send_invoice_related_email')
    def test_reminder_never_fires_when_reminders_disabled(self, mock_send):
        from apps.invoices.tasks import send_invoice_reminders
        self._overdue_sent_invoice(10, reminders_enabled=False)

        result = send_invoice_reminders()

        self.assertEqual(result['sent'], 0)
        mock_send.assert_not_called()

    @patch('apps.invoices.tasks.send_invoice_related_email')
    def test_reminder_never_duplicates_a_level_already_sent(self, mock_send):
        mock_send.return_value = {'sent': True, 'sent_via': 'resend', 'smtp_host': None, 'provider_message_id': 'x', 'fallback_used': False, 'error': None}
        from apps.invoices.tasks import send_invoice_reminders
        invoice = self._overdue_sent_invoice(5)
        InvoiceReminder.objects.create(invoice=invoice, reminder_number=1, template_used='reminder_1', days_overdue_at_send=3)

        result = send_invoice_reminders()

        self.assertEqual(result['sent'], 0)  # day 5 -> level 1 already sent, level 2 needs 7 days
        mock_send.assert_not_called()

    @patch('apps.invoices.tasks.send_invoice_related_email')
    def test_final_reminder_sets_escalation_required(self, mock_send):
        """
        Levels are processed ascending and stop at the first unsent one —
        so reaching level 4 requires 1/2/3 already sent (a brand-new
        invoice at 31 days overdue would fire level 1 first, not 4;
        confirmed directly, not assumed, by test_reminder_fires_at_day_3
        already covering that ascending-order behavior separately).
        """
        mock_send.return_value = {'sent': True, 'sent_via': 'resend', 'smtp_host': None, 'provider_message_id': 'x', 'fallback_used': False, 'error': None}
        from apps.invoices.tasks import send_invoice_reminders
        invoice = self._overdue_sent_invoice(31)
        for level in (1, 2, 3):
            InvoiceReminder.objects.create(invoice=invoice, reminder_number=level, template_used=f'reminder_{level}', days_overdue_at_send=level)

        result = send_invoice_reminders()

        self.assertEqual(result['sent'], 1)
        invoice.refresh_from_db()
        self.assertTrue(invoice.escalation_required)
        self.assertTrue(InvoiceReminder.objects.filter(invoice=invoice, reminder_number=4).exists())

    @patch('apps.invoices.tasks.send_invoice_related_email')
    def test_only_one_reminder_level_per_invoice_per_run(self, mock_send):
        """35 days overdue is eligible for levels 1/2/3/4 all at once — only the first unsent one fires."""
        mock_send.return_value = {'sent': True, 'sent_via': 'resend', 'smtp_host': None, 'provider_message_id': 'x', 'fallback_used': False, 'error': None}
        from apps.invoices.tasks import send_invoice_reminders
        self._overdue_sent_invoice(35)

        result = send_invoice_reminders()

        self.assertEqual(result['sent'], 1)
        mock_send.assert_called_once()

    @patch('apps.invoices.tasks.send_invoice_related_email')
    def test_uses_the_shared_routing_function_not_a_duplicated_chain(self, mock_send):
        """
        Confirms the task calls send_invoice_related_email (the SAME
        function invoice_send uses) rather than re-implementing its own
        custom-SMTP-vs-Resend decision — the actual point of factoring it
        out. Verified by call signature, not just presence of a mock.
        """
        mock_send.return_value = {'sent': True, 'sent_via': 'resend', 'smtp_host': None, 'provider_message_id': 'x', 'fallback_used': False, 'error': None}
        from apps.invoices.tasks import send_invoice_reminders
        invoice = self._overdue_sent_invoice(3)

        send_invoice_reminders()

        call_args = mock_send.call_args
        self.assertEqual(call_args[0][0], invoice)
        # Reminders never attach a PDF (v1 doesn't either, confirmed directly).
        self.assertNotIn('pdf_bytes', call_args.kwargs)

    def test_not_yet_due_invoice_is_not_eligible(self):
        from apps.invoices.tasks import send_invoice_reminders
        make_invoice(
            self.user, status='sent', sent_via_platform=True, reminders_enabled=True,
            due_date=timezone.now().date() + timedelta(days=5),
        )
        result = send_invoice_reminders()
        self.assertEqual(result['sent'], 0)

    def test_paid_invoice_is_not_eligible_even_if_technically_past_due_date(self):
        from apps.invoices.tasks import send_invoice_reminders
        make_invoice(
            self.user, status='paid', sent_via_platform=True, reminders_enabled=True,
            due_date=timezone.now().date() - timedelta(days=10),
        )
        result = send_invoice_reminders()
        self.assertEqual(result['sent'], 0)


# ══════════════════════════════════════════════════════════════════
# core/email.py — attachments/cc/reply_to/message_id extensions
# ══════════════════════════════════════════════════════════════════

class SendEmailDetailedTests(InvoicesAPITestCase):
    def test_send_email_detailed_returns_provider_message_id(self):
        from core.email import send_email_detailed
        fake_resp = MagicMock(status_code=200, text='')
        fake_resp.json.return_value = {'id': 'resend-abc-123'}
        with patch('requests.post', return_value=fake_resp):
            result = send_email_detailed('client@example.com', 'Subject', '<p>hi</p>')
        self.assertTrue(result['sent'])
        self.assertEqual(result['provider_message_id'], 'resend-abc-123')

    def test_send_email_detailed_survives_a_response_with_no_json_body(self):
        """A malformed success response must never turn a delivered email into a reported failure."""
        from core.email import send_email_detailed
        fake_resp = MagicMock(status_code=200, text='')
        fake_resp.json.side_effect = ValueError('not json')
        with patch('requests.post', return_value=fake_resp):
            result = send_email_detailed('client@example.com', 'Subject', '<p>hi</p>')
        self.assertTrue(result['sent'])
        self.assertIsNone(result['provider_message_id'])

    def test_send_email_bool_contract_unchanged_for_existing_callers(self):
        """apps/users/emails.py callers must keep getting a plain bool."""
        from core.email import send_email
        fake_resp = MagicMock(status_code=200, text='')
        fake_resp.json.return_value = {'id': 'x'}
        with patch('requests.post', return_value=fake_resp):
            result = send_email('user@example.com', 'Subject', '<p>hi</p>')
        self.assertIs(result, True)

    def test_attachments_and_cc_reach_the_real_payload(self):
        from core.email import send_email_detailed
        fake_resp = MagicMock(status_code=200, text='')
        fake_resp.json.return_value = {'id': 'x'}
        with patch('requests.post', return_value=fake_resp) as mock_post:
            send_email_detailed(
                'client@example.com', 'Subject', '<p>hi</p>', cc=['freelancer@example.com'],
                reply_to='reply+abc@lanceraos.com',
                attachments=[{'filename': 'invoice.pdf', 'content_base64': 'YWJj'}],
            )
        payload = mock_post.call_args.kwargs['json']
        self.assertEqual(payload['cc'], ['freelancer@example.com'])
        self.assertEqual(payload['reply_to'], 'reply+abc@lanceraos.com')
        self.assertEqual(payload['attachments'], [{'filename': 'invoice.pdf', 'content': 'YWJj'}])


# ══════════════════════════════════════════════════════════════════
# InvoiceSerializer — the exclude->fields "conversion" was investigated
# directly before writing this test and found to be a false premise:
# InvoiceSerializer (apps/invoices/serializers.py) already uses an
# explicit Meta.fields allowlist, not Meta.exclude — confirmed by
# reading the file directly, and by grepping the whole apps/invoices +
# apps/clients tree for "exclude" (only non-serializer matches: queryset
# .exclude() calls, docstring prose). There is nothing to convert. This
# test still does the mechanical safety-pin the task asked for — it
# locks in the CURRENT, correct fields/read_only_fields shape against
# an accidental future regression, which is the part of the ask that's
# genuinely still valuable regardless of the premise mismatch. See
# DECISIONS.md for the full note on this discrepancy.
# ══════════════════════════════════════════════════════════════════

class InvoiceSerializerFieldSafetyTests(InvoicesAPITestCase):
    EXPECTED_FIELDS = {
        'id', 'client', 'client_name', 'client_email', 'client_company', 'client_address',
        'client_phone', 'currency', 'tax_rate', 'discount_amount', 'due_date', 'notes', 'terms',
        'reminders_enabled', 'late_fee_enabled', 'late_fee_rate', 'is_recurring',
        'recurring_interval_days', 'recurring_auto_send', 'is_one_time_client', 'items',
    }
    EXPECTED_READ_ONLY = {'id'}

    def test_fields_allowlist_is_explicit_not_exclude(self):
        from apps.invoices.serializers import InvoiceSerializer
        self.assertIsNone(getattr(InvoiceSerializer.Meta, 'exclude', None))
        self.assertIsNotNone(InvoiceSerializer.Meta.fields)

    def test_exact_field_set_unchanged(self):
        from apps.invoices.serializers import InvoiceSerializer
        self.assertEqual(set(InvoiceSerializer.Meta.fields), self.EXPECTED_FIELDS)

    def test_exact_read_only_set_unchanged(self):
        from apps.invoices.serializers import InvoiceSerializer
        self.assertEqual(set(InvoiceSerializer.Meta.read_only_fields), self.EXPECTED_READ_ONLY)

    def test_lifecycle_and_derived_fields_are_not_writable_through_this_serializer(self):
        """
        The exact vulnerability class this whole convention exists to
        prevent (per apps/clients/serializers.py's own docstring) — none
        of these can be mass-assigned through InvoiceSerializer, since
        they're simply absent from Meta.fields entirely.
        """
        from apps.invoices.serializers import InvoiceSerializer
        forbidden = {
            'status', 'invoice_number', 'view_token', 'pdf_url', 'pdf_generated_at',
            'sent_via_platform', 'sent_at', 'finalised_at', 'amount_paid', 'refunded_amount',
            'user', 'reminder_count', 'last_reminder_sent_at', 'escalation_required',
        }
        self.assertEqual(forbidden & set(InvoiceSerializer.Meta.fields), set())

    def test_serializer_actually_rejects_a_status_override_attempt(self):
        """Behavioral proof, not just a field-list inspection — POSTing
        status directly must have no effect on the created row."""
        resp = self._post(reverse('invoices:invoice_list'), {
            'client_name': 'Acme', 'client_email': 'acme@example.com', 'status': 'paid',
        })
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.json()['status'], 'draft')  # status ignored, real default holds
