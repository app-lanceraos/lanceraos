# apps/invoices/tests/test_acknowledgment.py
"""
Step 15 — Client Acknowledgment. Covers: idempotent double-acknowledge
(200, existing timestamp, no error), the one-time-client view_token path,
the freelancer-preview-guard rejection (the fifth real call site for
is_freelancer_previewing_portal), rate limiting, the notification (bell +
immediate email to the freelancer, since the client triggered it), and
the timeline entry.
"""
import json
from decimal import Decimal
from unittest.mock import patch

from django.core.cache import cache
from django.middleware.csrf import get_token
from django.test import Client as DjangoTestClient
from django.test import RequestFactory, TestCase
from django.urls import reverse

from apps.clients.cookies import PORTAL_SESSION_COOKIE_NAME
from apps.clients.models import Client as ClientModel
from apps.clients.models import ClientPortalSession
from apps.invoices.models import Invoice, InvoiceItem
from apps.invoices.tests.test_models import make_invoice
from apps.users.models import User
from core.models import AuditLog


def make_client(user, **overrides):
    data = {'name': 'Acme Co', 'email': 'acme@example.com'}
    data.update(overrides)
    return ClientModel.objects.create(user=user, **data)


class AcknowledgmentAPITestCaseBase(TestCase):
    def setUp(self):
        cache.clear()
        self.rf = RequestFactory()
        self.client = DjangoTestClient(enforce_csrf_checks=True)
        self.user = User.objects.create_user(email='freelancer@example.com', password='Sup3r$ecret1')
        self.user.is_email_verified = True
        self.user.is_active = True
        self.user.save()
        self.portal_client = make_client(self.user)
        self.invoice = make_invoice(
            self.user, client=self.portal_client, status='sent', sent_at='2026-01-01T00:00:00Z',
        )
        InvoiceItem.objects.create(invoice=self.invoice, description='Work', quantity=Decimal('1'), unit_price=Decimal('100'))

    def _csrf_token(self):
        dummy = self.rf.get('/')
        token = get_token(dummy)
        self.client.cookies['csrftoken'] = dummy.META['CSRF_COOKIE']
        return token

    def _login_as_freelancer(self):
        csrf_token = self._csrf_token()
        resp = self.client.post(reverse('users:login'), data=json.dumps({
            'login': self.user.email, 'password': 'Sup3r$ecret1',
        }), content_type='application/json', HTTP_X_CSRFTOKEN=csrf_token)
        assert resp.status_code == 200, resp.content

    def _post_json(self, url, data=None):
        csrf_token = self._csrf_token()
        return self.client.post(url, data=json.dumps(data or {}), content_type='application/json', HTTP_X_CSRFTOKEN=csrf_token)

    def _set_portal_session(self, raw_token='raw-tok'):
        ClientPortalSession.create_for_client(self.portal_client, raw_token, device_name='', ip_address=None, user_agent='')
        self.client.cookies[PORTAL_SESSION_COOKIE_NAME] = raw_token
        return raw_token


class PortalAcknowledgeTests(AcknowledgmentAPITestCaseBase):
    def _ack_url(self, invoice=None):
        return reverse('invoices:portal_invoice_acknowledge', kwargs={'pk': (invoice or self.invoice).pk})

    def test_requires_a_valid_session_or_matching_view_token(self):
        resp = self._post_json(self._ack_url())
        self.assertEqual(resp.status_code, 401)

    @patch('core.email.send_email')
    def test_saved_client_can_acknowledge(self, mock_send):
        self._set_portal_session()
        resp = self._post_json(self._ack_url())
        self.assertEqual(resp.status_code, 201)
        body = resp.json()
        self.assertTrue(body['client_acknowledged'])
        self.assertIsNotNone(body['client_acknowledged_at'])

        self.invoice.refresh_from_db()
        self.assertTrue(self.invoice.client_acknowledged)
        self.assertIsNotNone(self.invoice.client_acknowledged_at)

    @patch('core.email.send_email')
    def test_double_acknowledge_is_idempotent_returns_existing_timestamp(self, mock_send):
        self._set_portal_session()
        first = self._post_json(self._ack_url())
        self.assertEqual(first.status_code, 201)
        first_timestamp = first.json()['client_acknowledged_at']

        second = self._post_json(self._ack_url())
        self.assertEqual(second.status_code, 200)  # not an error
        self.assertEqual(second.json()['client_acknowledged_at'], first_timestamp)  # same timestamp, not re-set

        mock_send.assert_called_once()  # the notification only fires once, on the real first acknowledgment

    def test_scoped_to_the_resolved_clients_own_invoices_only_real_404(self):
        other_client = make_client(self.user, name='Beta Co', email='beta@example.com')
        their_invoice = make_invoice(self.user, client=other_client, client_name='Beta Co', status='sent', sent_at='2026-01-01T00:00:00Z')
        self._set_portal_session()
        resp = self._post_json(self._ack_url(their_invoice))
        self.assertEqual(resp.status_code, 404)

    @patch('core.email.send_email')
    def test_rate_limited_after_5_attempts_in_an_hour(self, mock_send):
        """
        Keyed by client.pk, shared across every invoice that same client
        acknowledges — 5 DIFFERENT, freshly-unacknowledged invoices in a
        row exhausts it (idempotent re-acknowledgment of an ALREADY-
        acknowledged invoice never consumes budget at all, since that
        short-circuits before the rate-limit check — this test uses a
        fresh invoice each time specifically to exercise the real path).
        """
        self._set_portal_session()
        for _ in range(5):
            invoice = make_invoice(self.user, client=self.portal_client, status='sent', sent_at='2026-01-01T00:00:00Z')
            resp = self._post_json(self._ack_url(invoice))
            self.assertEqual(resp.status_code, 201)
        extra_invoice = make_invoice(self.user, client=self.portal_client, status='sent', sent_at='2026-01-01T00:00:00Z')
        resp = self._post_json(self._ack_url(extra_invoice))
        self.assertEqual(resp.status_code, 429)

    def test_one_time_client_can_acknowledge_with_a_matching_view_token(self):
        invoice = make_invoice(
            self.user, client=None, is_one_time_client=True, status='sent', sent_at='2026-01-01T00:00:00Z',
            client_name='One-Timer', client_email='onetime@example.com',
        )
        resp = self._post_json(self._ack_url(invoice), {'view_token': invoice.view_token})
        self.assertEqual(resp.status_code, 201)
        invoice.refresh_from_db()
        self.assertTrue(invoice.client_acknowledged)

    def test_one_time_client_with_wrong_token_is_rejected(self):
        invoice = make_invoice(
            self.user, client=None, is_one_time_client=True, status='sent', sent_at='2026-01-01T00:00:00Z',
            client_name='One-Timer', client_email='onetime@example.com',
        )
        resp = self._post_json(self._ack_url(invoice), {'view_token': 'not-the-real-token'})
        self.assertEqual(resp.status_code, 401)
        invoice.refresh_from_db()
        self.assertFalse(invoice.client_acknowledged)

    def test_freelancer_previewing_own_portal_is_rejected(self):
        self._login_as_freelancer()
        self._set_portal_session()
        resp = self._post_json(self._ack_url())
        self.assertEqual(resp.status_code, 403)
        self.invoice.refresh_from_db()
        self.assertFalse(self.invoice.client_acknowledged)

    def test_no_unacknowledge_path_exists(self):
        self._set_portal_session()
        self._post_json(self._ack_url())
        url = self._ack_url()
        self.assertEqual(self.client.delete(url, HTTP_X_CSRFTOKEN=self._csrf_token()).status_code, 405)
        self.assertEqual(self.client.put(url, data=json.dumps({}), content_type='application/json', HTTP_X_CSRFTOKEN=self._csrf_token()).status_code, 405)


class AcknowledgmentNotificationTests(AcknowledgmentAPITestCaseBase):
    @patch('core.email.send_email')
    def test_acknowledgment_writes_a_bell_entry_and_emails_the_freelancer(self, mock_send):
        mock_send.return_value = True
        self._set_portal_session()
        resp = self._post_json(reverse('invoices:portal_invoice_acknowledge', kwargs={'pk': self.invoice.pk}))
        self.assertEqual(resp.status_code, 201)

        log = AuditLog.objects.get(user=self.user, event='invoice_acknowledged')
        self.assertEqual(log.metadata['invoice_id'], str(self.invoice.pk))
        mock_send.assert_called_once()
        self.assertEqual(mock_send.call_args.args[0], self.user.email)

    @patch('core.email.send_email')
    def test_respects_notif_invoice_events_opt_out(self, mock_send):
        self.user.profile.notif_invoice_events = False
        self.user.profile.save(update_fields=['notif_invoice_events'])
        self._set_portal_session()
        resp = self._post_json(reverse('invoices:portal_invoice_acknowledge', kwargs={'pk': self.invoice.pk}))
        self.assertEqual(resp.status_code, 201)
        self.assertFalse(AuditLog.objects.filter(user=self.user, event='invoice_acknowledged').exists())
        mock_send.assert_not_called()


class AcknowledgmentTimelineTests(AcknowledgmentAPITestCaseBase):
    @patch('core.email.send_email')
    def test_acknowledgment_appears_in_the_timeline(self, mock_send):
        # Acknowledge via the portal session FIRST — logging in as the
        # freelancer before this would trip is_freelancer_previewing_portal
        # (both cookies present at once) and the acknowledgment would be
        # rejected, exactly like AcknowledgmentAPITestCaseBase's own guard
        # test. Login happens after, only to read the timeline back.
        self._set_portal_session()
        resp = self._post_json(reverse('invoices:portal_invoice_acknowledge', kwargs={'pk': self.invoice.pk}))
        self.assertEqual(resp.status_code, 201)

        self.client.cookies.clear()
        self._login_as_freelancer()
        resp = self.client.get(reverse('invoices:invoice_timeline', kwargs={'pk': self.invoice.pk}))
        self.assertEqual(resp.status_code, 200)
        types = [e['type'] for e in resp.json()['results']]
        self.assertIn('acknowledged', types)
