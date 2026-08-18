# apps/invoices/tests/test_claims.py
"""
Step 14 — PaymentClaim: portal submission (saved client via session, and
one-time client via its own view_token), freelancer list/confirm/reject,
confirm reusing the exact same InvoicePartialPaymentSerializer +
update_paid_status() path invoice_add_payment/invoice_mark_paid already
use, reject requiring a real reason with zero financial effect, the
freelancer-preview-mode rejection, rate limiting, and both notification
tiers (payment_claim_submitted to the freelancer, payment_claim_confirmed
to the client).
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
from apps.invoices.models import Invoice, InvoiceItem, PaymentClaim
from apps.invoices.tests.test_models import make_invoice
from apps.users.models import User
from core.models import AuditLog


def make_client(user, **overrides):
    data = {'name': 'Acme Co', 'email': 'acme@example.com'}
    data.update(overrides)
    return ClientModel.objects.create(user=user, **data)


class ClaimsAPITestCaseBase(TestCase):
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

    def _one_time_invoice(self):
        return make_invoice(
            self.user, client=None, is_one_time_client=True, status='sent', sent_at='2026-01-01T00:00:00Z',
            client_name='One-Timer', client_email='onetime@example.com',
        )


class PortalClaimSubmissionTests(ClaimsAPITestCaseBase):
    def _submit(self, data=None):
        payload = {
            'payment_source': 'wise', 'amount_claimed': '100.00', 'currency': 'USD',
            'payment_date': '2026-01-15', 'client_note': 'Paid via Wise.',
        }
        if data:
            payload.update(data)
        return self._post_json(reverse('invoices:portal_invoice_claims', kwargs={'pk': self.invoice.pk}), payload)

    def test_requires_a_valid_session_or_matching_view_token(self):
        resp = self._submit()
        self.assertEqual(resp.status_code, 401)

    @patch('core.email.send_email')
    def test_saved_client_with_a_valid_session_can_submit(self, mock_send):
        self._set_portal_session()
        resp = self._submit()
        self.assertEqual(resp.status_code, 201)
        body = resp.json()
        self.assertEqual(body['status'], 'pending')
        self.assertEqual(Decimal(body['amount_claimed']), Decimal('100.00'))

        claim = PaymentClaim.objects.get(invoice=self.invoice)
        self.assertEqual(claim.client_name, self.portal_client.name)
        self.assertEqual(claim.client_email, self.portal_client.email)
        self.assertEqual(claim.status, 'pending')

    def test_client_supplied_status_and_review_fields_are_ignored(self):
        self._set_portal_session()
        resp = self._submit({'status': 'confirmed', 'review_note': 'spoofed'})
        self.assertEqual(resp.status_code, 201)
        claim = PaymentClaim.objects.get(invoice=self.invoice)
        self.assertEqual(claim.status, 'pending')  # never overridden by the request body
        self.assertEqual(claim.review_note, '')

    def test_scoped_to_the_resolved_clients_own_invoices_only_real_404(self):
        other_client = make_client(self.user, name='Beta Co', email='beta@example.com')
        their_invoice = make_invoice(self.user, client=other_client, client_name='Beta Co', status='sent', sent_at='2026-01-01T00:00:00Z')
        self._set_portal_session()
        resp = self._post_json(reverse('invoices:portal_invoice_claims', kwargs={'pk': their_invoice.pk}), {
            'payment_source': 'wise', 'amount_claimed': '50', 'currency': 'USD', 'payment_date': '2026-01-15',
        })
        self.assertEqual(resp.status_code, 404)

    def test_negative_or_zero_amount_is_rejected(self):
        self._set_portal_session()
        resp = self._submit({'amount_claimed': '0'})
        self.assertEqual(resp.status_code, 400)

    # ── Cap at outstanding_amount (item 5 of the 16 August 2026 second
    #    verification pass) — self.invoice's real total is 100.00 with no
    #    payments recorded, so outstanding_amount is exactly 100.00. ──

    def test_amount_exactly_equal_to_outstanding_is_accepted(self):
        self._set_portal_session()
        resp = self._submit({'amount_claimed': '100.00'})
        self.assertEqual(resp.status_code, 201)

    def test_amount_one_cent_over_outstanding_is_rejected_with_a_real_error(self):
        """
        FIXED (real, confirmed bug this pass — see DECISIONS.md): the
        view used to return DRF's raw serializer.errors shape
        ({'amount_claimed': [...]})  — but ClientPortal.jsx's ClaimModal
        only ever reads a flat top-level `error` key, so this real,
        specific message never actually reached the client at all,
        silently falling back to a generic "Could not submit" instead.
        Now surfaced under that same top-level key.
        """
        self._set_portal_session()
        resp = self._submit({'amount_claimed': '100.01'})
        self.assertEqual(resp.status_code, 400)
        self.assertIn('outstanding balance', resp.json()['error'])
        self.assertEqual(PaymentClaim.objects.filter(invoice=self.invoice).count(), 0)  # never silently accepted

    def test_amount_far_over_outstanding_is_rejected(self):
        self._set_portal_session()
        resp = self._submit({'amount_claimed': '999.00'})
        self.assertEqual(resp.status_code, 400)

    def test_cap_accounts_for_a_partial_payment_already_recorded(self):
        """The cap is against the REAL current outstanding_amount, not the invoice's original total."""
        self.invoice.amount_paid = Decimal('60.00')
        self.invoice.status = 'partially_paid'
        self.invoice.save(update_fields=['amount_paid', 'status'])
        self._set_portal_session()

        resp = self._submit({'amount_claimed': '40.01'})  # outstanding is 40.00
        self.assertEqual(resp.status_code, 400)

        resp = self._submit({'amount_claimed': '40.00'})
        self.assertEqual(resp.status_code, 201)

    # ── Real bugs fixed this pass — see DECISIONS.md ──

    def test_a_second_claim_is_rejected_while_one_is_still_pending(self):
        self._set_portal_session()
        first = self._submit({'amount_claimed': '40.00'})
        self.assertEqual(first.status_code, 201)

        second = self._submit({'amount_claimed': '30.00'})
        self.assertEqual(second.status_code, 400)
        self.assertIn('already being reviewed', second.json()['error'])
        self.assertEqual(PaymentClaim.objects.filter(invoice=self.invoice).count(), 1)  # the second was never created

    def test_a_new_claim_is_allowed_again_once_the_pending_one_is_rejected(self):
        self._set_portal_session()
        first = self._submit({'amount_claimed': '40.00'})
        claim_id = first.json()['id']
        claim = PaymentClaim.objects.get(pk=claim_id)
        claim.status = 'rejected'
        claim.review_note = 'Not found in our records.'
        claim.save(update_fields=['status', 'review_note'])

        second = self._submit({'amount_claimed': '40.00'})
        self.assertEqual(second.status_code, 201)  # no longer blocked — the earlier one is resolved, not pending

    def test_rejected_with_a_specific_message_once_the_invoice_is_already_fully_paid(self):
        """
        FIXED (real, confirmed gap this pass — see DECISIONS.md): this
        case was already rejected by the existing outstanding-amount cap
        (Step 14), but only with the generic "cannot exceed the
        outstanding balance of 0.00 USD" message, which — like every
        other field-keyed serializer error — never actually reached the
        client (ClientPortal.jsx only reads a top-level `error` key).
        Now caught explicitly, before the serializer even runs, with its
        own clear message.
        """
        self.invoice.amount_paid = Decimal('100.00')
        self.invoice.status = 'paid'
        self.invoice.save(update_fields=['amount_paid', 'status'])
        self.assertEqual(self.invoice.outstanding_amount, Decimal('0.00'))
        self._set_portal_session()

        resp = self._submit({'amount_claimed': '10.00'})
        self.assertEqual(resp.status_code, 400)
        self.assertIn('already been paid in full', resp.json()['error'])
        self.assertEqual(PaymentClaim.objects.count(), 0)

    def test_rate_limited_after_5_submissions_in_an_hour(self):
        """
        One real claim per invoice (rather than 6 against self.invoice)
        — otherwise the 2nd submission alone would already be rejected
        by this pass's own new duplicate-pending-claim check, never
        reaching the rate limiter at all. Rate limiting is keyed by
        client.pk (_resolve_portal_write_access), not per-invoice, so 6
        distinct invoices for the SAME client still share one counter —
        this isolates "rate limited" from "duplicate pending" as the two
        real, independent things they are.
        """
        self._set_portal_session()
        for _ in range(5):
            invoice = make_invoice(self.user, client=self.portal_client, status='sent', sent_at='2026-01-01T00:00:00Z')
            InvoiceItem.objects.create(invoice=invoice, description='Work', quantity=Decimal('1'), unit_price=Decimal('100'))
            resp = self._post_json(reverse('invoices:portal_invoice_claims', kwargs={'pk': invoice.pk}), {
                'payment_source': 'wise', 'amount_claimed': '100.00', 'currency': 'USD',
                'payment_date': '2026-01-15', 'client_note': 'Paid via Wise.',
            })
            self.assertEqual(resp.status_code, 201)

        sixth_invoice = make_invoice(self.user, client=self.portal_client, status='sent', sent_at='2026-01-01T00:00:00Z')
        InvoiceItem.objects.create(invoice=sixth_invoice, description='Work', quantity=Decimal('1'), unit_price=Decimal('100'))
        resp = self._post_json(reverse('invoices:portal_invoice_claims', kwargs={'pk': sixth_invoice.pk}), {
            'payment_source': 'wise', 'amount_claimed': '100.00', 'currency': 'USD',
            'payment_date': '2026-01-15', 'client_note': 'Paid via Wise.',
        })
        self.assertEqual(resp.status_code, 429)

    def test_freelancer_previewing_own_portal_is_rejected(self):
        """Both a real freelancer session AND a real portal session present at once — the preview-mode scenario. The submission must be rejected, not silently attributed to the client."""
        self._login_as_freelancer()
        self._set_portal_session()
        resp = self._submit()
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(PaymentClaim.objects.count(), 0)

    # ── One-time client, via view_token ──
    def test_one_time_client_can_submit_with_a_matching_view_token(self):
        invoice = self._one_time_invoice()
        resp = self._post_json(reverse('invoices:portal_invoice_claims', kwargs={'pk': invoice.pk}), {
            'payment_source': 'bank', 'amount_claimed': '75', 'currency': 'USD',
            'payment_date': '2026-01-20', 'view_token': invoice.view_token,
        })
        self.assertEqual(resp.status_code, 201)
        claim = PaymentClaim.objects.get(invoice=invoice)
        self.assertEqual(claim.client_name, 'One-Timer')
        self.assertEqual(claim.client_email, 'onetime@example.com')

    def test_one_time_client_with_no_or_wrong_token_is_rejected(self):
        invoice = self._one_time_invoice()
        url = reverse('invoices:portal_invoice_claims', kwargs={'pk': invoice.pk})
        resp = self._post_json(url, {'payment_source': 'bank', 'amount_claimed': '75', 'currency': 'USD', 'payment_date': '2026-01-20'})
        self.assertEqual(resp.status_code, 401)
        resp2 = self._post_json(url, {
            'payment_source': 'bank', 'amount_claimed': '75', 'currency': 'USD',
            'payment_date': '2026-01-20', 'view_token': 'not-the-real-token',
        })
        self.assertEqual(resp2.status_code, 401)
        self.assertEqual(PaymentClaim.objects.count(), 0)


class PortalClaimStatusVisibilityTests(ClaimsAPITestCaseBase):
    """
    Item 5 of the 16 August 2026 second verification pass — real,
    confirmed gap: a client had no way to see whether their own submitted
    claim was confirmed/rejected. GET /invoices/portal/{id}/claims/ closes
    it, reusing PaymentClaimSerializer directly (the same freelancer-
    facing read representation — none of its fields are sensitive to the
    client who submitted them).
    """
    def test_saved_client_sees_their_own_pending_claim(self):
        self._set_portal_session()
        claim = PaymentClaim.objects.create(
            invoice=self.invoice, client_name='Acme Co', client_email='acme@example.com',
            payment_source='wise', amount_claimed=Decimal('50'), currency='USD', payment_date='2026-01-15',
        )
        resp = self.client.get(reverse('invoices:portal_invoice_claims', kwargs={'pk': self.invoice.pk}))
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(len(body), 1)
        self.assertEqual(body[0]['id'], str(claim.pk))
        self.assertEqual(body[0]['status'], 'pending')

    def test_saved_client_sees_confirmed_status(self):
        self._set_portal_session()
        claim = PaymentClaim.objects.create(
            invoice=self.invoice, client_name='Acme Co', client_email='acme@example.com',
            payment_source='wise', amount_claimed=Decimal('50'), currency='USD', payment_date='2026-01-15',
            status='confirmed',
        )
        resp = self.client.get(reverse('invoices:portal_invoice_claims', kwargs={'pk': self.invoice.pk}))
        self.assertEqual(resp.json()[0]['status'], 'confirmed')
        self.assertEqual(resp.json()[0]['id'], str(claim.pk))

    def test_saved_client_sees_the_freelancers_rejection_reason(self):
        self._set_portal_session()
        PaymentClaim.objects.create(
            invoice=self.invoice, client_name='Acme Co', client_email='acme@example.com',
            payment_source='wise', amount_claimed=Decimal('50'), currency='USD', payment_date='2026-01-15',
            status='rejected', review_note='Amount does not match our records.',
        )
        resp = self.client.get(reverse('invoices:portal_invoice_claims', kwargs={'pk': self.invoice.pk}))
        self.assertEqual(resp.json()[0]['review_note'], 'Amount does not match our records.')

    def test_requires_a_valid_session_or_matching_view_token(self):
        resp = self.client.get(reverse('invoices:portal_invoice_claims', kwargs={'pk': self.invoice.pk}))
        self.assertEqual(resp.status_code, 401)

    def test_scoped_to_the_resolved_clients_own_invoices_only(self):
        other_client = make_client(self.user, name='Beta Co', email='beta@example.com')
        their_invoice = make_invoice(self.user, client=other_client, client_name='Beta Co', status='sent', sent_at='2026-01-01T00:00:00Z')
        self._set_portal_session()
        resp = self.client.get(reverse('invoices:portal_invoice_claims', kwargs={'pk': their_invoice.pk}))
        self.assertEqual(resp.status_code, 404)

    def test_one_time_client_reads_via_its_own_view_token_in_the_query_string(self):
        invoice = self._one_time_invoice()
        PaymentClaim.objects.create(
            invoice=invoice, client_name='One-Timer', client_email='onetime@example.com',
            payment_source='bank', amount_claimed=Decimal('75'), currency='USD', payment_date='2026-01-20',
        )
        url = reverse('invoices:portal_invoice_claims', kwargs={'pk': invoice.pk}) + f'?view_token={invoice.view_token}'
        resp = self.client.get(url)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.json()), 1)

    def test_one_time_client_with_no_or_wrong_token_is_rejected_on_read_too(self):
        invoice = self._one_time_invoice()
        resp = self.client.get(reverse('invoices:portal_invoice_claims', kwargs={'pk': invoice.pk}))
        self.assertEqual(resp.status_code, 401)


class FreelancerClaimsAPITestCase(ClaimsAPITestCaseBase):
    def setUp(self):
        super().setUp()
        self._login_as_freelancer()

    def _make_claim(self, **overrides):
        defaults = {
            'invoice': self.invoice, 'client_email': self.portal_client.email, 'client_name': self.portal_client.name,
            'amount_claimed': Decimal('100.00'), 'currency': 'USD', 'payment_source': 'wise', 'payment_date': '2026-01-15',
        }
        defaults.update(overrides)
        return PaymentClaim.objects.create(**defaults)

    def test_list_returns_claims_for_this_invoice(self):
        self._make_claim()
        resp = self.client.get(reverse('invoices:invoice_claims', kwargs={'pk': self.invoice.pk}))
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.json()), 1)

    def test_never_reachable_for_another_freelancers_invoice(self):
        other_user = User.objects.create_user(email='other@example.com', password='Sup3r$ecret1')
        their_invoice = make_invoice(other_user)
        resp = self.client.get(reverse('invoices:invoice_claims', kwargs={'pk': their_invoice.pk}))
        self.assertEqual(resp.status_code, 404)

    @patch('core.email.send_client_facing_email')
    def test_confirm_requires_confirm_true(self, mock_send):
        claim = self._make_claim()
        resp = self._post_json(reverse('invoices:invoice_claim_confirm', kwargs={'pk': self.invoice.pk, 'claim_id': claim.pk}), {})
        self.assertEqual(resp.status_code, 400)
        claim.refresh_from_db()
        self.assertEqual(claim.status, 'pending')
        mock_send.assert_not_called()

    @patch('core.email.send_client_facing_email')
    def test_confirm_creates_a_real_payment_via_the_shared_path_and_updates_status(self, mock_send):
        mock_send.return_value = {'sent': True, 'sent_via': 'resend', 'smtp_host': None, 'provider_message_id': 'x', 'fallback_used': False, 'error': None}
        claim = self._make_claim(amount_claimed=Decimal('100.00'))
        resp = self._post_json(
            reverse('invoices:invoice_claim_confirm', kwargs={'pk': self.invoice.pk, 'claim_id': claim.pk}),
            {'confirm': True},
        )
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body['claim']['status'], 'confirmed')
        self.assertEqual(body['invoice']['status'], 'paid')  # 100.00 claimed == full outstanding balance

        claim.refresh_from_db()
        self.assertEqual(claim.status, 'confirmed')
        self.assertIsNotNone(claim.reviewed_at)

        self.invoice.refresh_from_db()
        self.assertEqual(self.invoice.status, 'paid')
        self.assertEqual(self.invoice.amount_paid, Decimal('100.00'))
        self.assertEqual(self.invoice.partial_payments.count(), 1)
        payment = self.invoice.partial_payments.first()
        self.assertEqual(payment.amount, Decimal('100.00'))
        self.assertEqual(payment.source, 'wise')

        mock_send.assert_called_once()  # payment_claim_confirmed -> client email

    def test_confirm_rejects_a_claim_that_no_longer_fits_the_outstanding_balance(self):
        """Someone already paid the invoice off another way in the meantime — confirming a stale claim must fail with a real error, not silently over-credit."""
        self.invoice.partial_payments.create(amount=Decimal('100.00'), currency='USD', source='bank', payment_date='2026-01-10')
        self.invoice.update_paid_status()

        claim = self._make_claim(amount_claimed=Decimal('100.00'))
        resp = self._post_json(
            reverse('invoices:invoice_claim_confirm', kwargs={'pk': self.invoice.pk, 'claim_id': claim.pk}),
            {'confirm': True},
        )
        self.assertEqual(resp.status_code, 400)
        claim.refresh_from_db()
        self.assertEqual(claim.status, 'pending')  # never flipped — the confirm genuinely failed

    def test_reject_requires_a_reason(self):
        claim = self._make_claim()
        resp = self._post_json(
            reverse('invoices:invoice_claim_reject', kwargs={'pk': self.invoice.pk, 'claim_id': claim.pk}),
            {'confirm': True},
        )
        self.assertEqual(resp.status_code, 400)
        claim.refresh_from_db()
        self.assertEqual(claim.status, 'pending')

    def test_reject_has_zero_financial_effect(self):
        claim = self._make_claim()
        resp = self._post_json(
            reverse('invoices:invoice_claim_reject', kwargs={'pk': self.invoice.pk, 'claim_id': claim.pk}),
            {'confirm': True, 'review_note': "Amount doesn't match our records."},
        )
        self.assertEqual(resp.status_code, 200)
        claim.refresh_from_db()
        self.assertEqual(claim.status, 'rejected')
        self.assertEqual(claim.review_note, "Amount doesn't match our records.")

        self.invoice.refresh_from_db()
        self.assertEqual(self.invoice.amount_paid, Decimal('0.00'))
        self.assertEqual(self.invoice.partial_payments.count(), 0)

    def test_cannot_confirm_or_reject_an_already_reviewed_claim(self):
        claim = self._make_claim(status='confirmed')
        resp = self._post_json(
            reverse('invoices:invoice_claim_reject', kwargs={'pk': self.invoice.pk, 'claim_id': claim.pk}),
            {'confirm': True, 'review_note': 'too late'},
        )
        self.assertEqual(resp.status_code, 400)


class ClaimsTimelineTests(ClaimsAPITestCaseBase):
    def setUp(self):
        super().setUp()
        self._login_as_freelancer()

    def test_claim_appears_in_the_timeline(self):
        PaymentClaim.objects.create(
            invoice=self.invoice, client_email='acme@example.com', client_name='Acme Co',
            amount_claimed=Decimal('100.00'), currency='USD', payment_source='wise', payment_date='2026-01-15',
        )
        resp = self.client.get(reverse('invoices:invoice_timeline', kwargs={'pk': self.invoice.pk}))
        self.assertEqual(resp.status_code, 200)
        types = [e['type'] for e in resp.json()['results']]
        self.assertIn('claim', types)


class NotificationTests(ClaimsAPITestCaseBase):
    """PaymentClaimSubmitted (bell + immediate email to freelancer) and PaymentClaimConfirmed (email to client only, no bell)."""

    @patch('core.email.send_email')
    def test_submission_writes_a_bell_entry_and_emails_the_freelancer(self, mock_send):
        mock_send.return_value = True
        self._set_portal_session()
        resp = self._post_json(reverse('invoices:portal_invoice_claims', kwargs={'pk': self.invoice.pk}), {
            'payment_source': 'wise', 'amount_claimed': '100.00', 'currency': 'USD', 'payment_date': '2026-01-15',
        })
        self.assertEqual(resp.status_code, 201)

        log = AuditLog.objects.get(user=self.user, event='payment_claim_submitted')
        self.assertEqual(log.metadata['invoice_id'], str(self.invoice.pk))
        mock_send.assert_called_once()
        self.assertEqual(mock_send.call_args.args[0], self.user.email)

    @patch('core.email.send_email')
    def test_submission_respects_notif_payments_opt_out(self, mock_send):
        self.user.profile.notif_payments = False
        self.user.profile.save(update_fields=['notif_payments'])
        self._set_portal_session()
        resp = self._post_json(reverse('invoices:portal_invoice_claims', kwargs={'pk': self.invoice.pk}), {
            'payment_source': 'wise', 'amount_claimed': '100.00', 'currency': 'USD', 'payment_date': '2026-01-15',
        })
        self.assertEqual(resp.status_code, 201)
        self.assertFalse(AuditLog.objects.filter(user=self.user, event='payment_claim_submitted').exists())
        mock_send.assert_not_called()

    @patch('core.email.send_client_facing_email')
    def test_confirm_emails_the_client_with_no_bell_entry(self, mock_send):
        mock_send.return_value = {'sent': True, 'sent_via': 'resend', 'smtp_host': None, 'provider_message_id': 'x', 'fallback_used': False, 'error': None}
        self._login_as_freelancer()
        claim = PaymentClaim.objects.create(
            invoice=self.invoice, client_email=self.portal_client.email, client_name=self.portal_client.name,
            amount_claimed=Decimal('100.00'), currency='USD', payment_source='wise', payment_date='2026-01-15',
        )
        resp = self._post_json(
            reverse('invoices:invoice_claim_confirm', kwargs={'pk': self.invoice.pk, 'claim_id': claim.pk}),
            {'confirm': True},
        )
        self.assertEqual(resp.status_code, 200)
        mock_send.assert_called_once()
        self.assertEqual(mock_send.call_args.args[1], self.invoice.client_email)  # `to` positional arg
        self.assertFalse(AuditLog.objects.filter(event='payment_claim_confirmed').exists())
