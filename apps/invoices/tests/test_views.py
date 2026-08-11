# apps/invoices/tests/test_views.py
import json
from datetime import date, timedelta
from decimal import Decimal

from django.core.cache import cache
from django.test import Client as DjangoTestClient
from django.test import RequestFactory, TestCase
from django.middleware.csrf import get_token
from django.urls import reverse
from django.utils import timezone

from apps.clients.models import Client as ClientModel
from apps.invoices.models import Invoice, InvoiceItem, InvoicePartialPayment, InvoicePreset
from apps.invoices.tests.test_models import make_invoice
from apps.users.models import User


class InvoicesAPITestCase(TestCase):
    """Shared login/CSRF plumbing — identical pattern to apps/clients/tests/test_views.py's ClientsAPITestCase."""

    def setUp(self):
        cache.clear()
        self.rf = RequestFactory()
        self.client = DjangoTestClient(enforce_csrf_checks=True)
        self.user = User.objects.create_user(email='freelancer@example.com', password='Sup3r$ecret1')
        self.user.is_email_verified = True
        self.user.is_active = True
        self.user.save()
        self._login()

    def _csrf_token(self):
        dummy = self.rf.get('/')
        token = get_token(dummy)
        self.client.cookies['csrftoken'] = dummy.META['CSRF_COOKIE']
        return token

    def _login(self, email='freelancer@example.com', password='Sup3r$ecret1'):
        csrf_token = self._csrf_token()
        resp = self.client.post(reverse('users:login'), data=json.dumps({
            'login': email, 'password': password,
        }), content_type='application/json', HTTP_X_CSRFTOKEN=csrf_token)
        assert resp.status_code == 200, resp.content

    def _get(self, url):
        return self.client.get(url)

    def _post(self, url, data=None):
        csrf_token = self._csrf_token()
        return self.client.post(
            url, data=json.dumps(data or {}), content_type='application/json', HTTP_X_CSRFTOKEN=csrf_token,
        )

    def _put(self, url, data=None):
        csrf_token = self._csrf_token()
        return self.client.put(
            url, data=json.dumps(data or {}), content_type='application/json', HTTP_X_CSRFTOKEN=csrf_token,
        )

    def _delete(self, url, data=None):
        csrf_token = self._csrf_token()
        kwargs = {'HTTP_X_CSRFTOKEN': csrf_token}
        if data is not None:
            kwargs['data'] = json.dumps(data)
            kwargs['content_type'] = 'application/json'
        return self.client.delete(url, **kwargs)

    def _invoice(self, **overrides):
        return make_invoice(self.user, **overrides)


# ══════════════════════════════════════════════════════════════════
# CRUD + SERIALIZER ALLOWLIST
# ══════════════════════════════════════════════════════════════════

class InvoiceCRUDTests(InvoicesAPITestCase):
    def test_create_draft_invoice(self):
        resp = self._post(reverse('invoices:invoice_list'), {
            'client_name': 'Acme Co', 'client_email': 'acme@example.com', 'currency': 'USD',
        })
        self.assertEqual(resp.status_code, 201)
        body = resp.json()
        self.assertEqual(body['status'], 'draft')
        self.assertIsNone(body['invoice_number'])  # unassigned until finalise
        self.assertTrue(body['view_token'])
        self.assertTrue(body['is_editable'])

    def test_create_allows_bare_empty_draft(self):
        """
        Step 6 rework — Gmail-compose-style autosave: opening "New Invoice"
        must create a real, minimal record with a bare POST, before the
        user has typed anything. Superseded the old
        test_create_requires_client_name, which asserted the opposite
        (blank client_name rejected) — that was the exact restriction this
        rework removes.
        """
        resp = self._post(reverse('invoices:invoice_list'), {})
        self.assertEqual(resp.status_code, 201)
        body = resp.json()
        self.assertEqual(body['status'], 'draft')
        self.assertEqual(body['client_name'], '')
        self.assertEqual(body['client_email'], '')
        self.assertEqual(body['items'], [])

    def test_update_allows_clearing_client_name_back_to_blank(self):
        """A permissive draft save state includes clearing a field back to blank, not just filling it in."""
        invoice = self._invoice(client_name='Had A Name', client_email='had@example.com', status='draft')
        resp = self._put(reverse('invoices:invoice_detail', kwargs={'pk': invoice.pk}), {
            'client_name': '', 'client_email': '',
        })
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['client_name'], '')

    def test_finalise_does_not_require_client_name(self):
        """Documents the real, currently-unchanged finalise validation gap — see invoice_finalise's own docstring."""
        invoice = self._invoice(client_name='', client_email='', status='draft')
        InvoiceItem.objects.create(invoice=invoice, description='Item', quantity=1, unit_price=Decimal('10'))
        resp = self._post(reverse('invoices:invoice_finalise', kwargs={'pk': invoice.pk}))
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['status'], 'created')

    def test_create_with_items(self):
        resp = self._post(reverse('invoices:invoice_list'), {
            'client_name': 'Acme', 'client_email': 'acme@example.com',
            'items': [{'description': 'Design work', 'quantity': '2', 'unit_price': '50.00'}],
        })
        self.assertEqual(resp.status_code, 201)
        body = resp.json()
        self.assertEqual(len(body['items']), 1)
        self.assertEqual(Decimal(body['subtotal']), Decimal('100.00'))

    def test_mass_assignment_of_user_field_is_ignored(self):
        """Same category of test as Step 2's client mass-assignment regression."""
        other_user = User.objects.create_user(email='victim@example.com', password='Sup3r$ecret1')
        resp = self._post(reverse('invoices:invoice_list'), {
            'client_name': 'Acme', 'client_email': 'acme@example.com', 'user': str(other_user.pk),
        })
        self.assertEqual(resp.status_code, 201)
        created = Invoice.objects.get(pk=resp.json()['id'])
        self.assertEqual(created.user, self.user)

    def test_cannot_set_lifecycle_fields_directly_through_create(self):
        """status/invoice_number/sent_via_platform/pdf_url/refunded_amount aren't on the write serializer at all."""
        resp = self._post(reverse('invoices:invoice_list'), {
            'client_name': 'Acme', 'client_email': 'acme@example.com',
            'status': 'paid', 'invoice_number': 'INV-2020-9999', 'sent_via_platform': True,
            'pdf_url': 'https://evil.example.com/fake.pdf', 'refunded_amount': '9999.00',
        })
        self.assertEqual(resp.status_code, 201)
        created = Invoice.objects.get(pk=resp.json()['id'])
        self.assertEqual(created.status, 'draft')
        self.assertIsNone(created.invoice_number)
        self.assertFalse(created.sent_via_platform)
        self.assertEqual(created.pdf_url, '')
        self.assertEqual(created.refunded_amount, Decimal('0'))

    def test_cannot_attach_another_users_client(self):
        other_user = User.objects.create_user(email='other@example.com', password='Sup3r$ecret1')
        their_client = ClientModel.objects.create(user=other_user, name='Theirs', email='theirs@example.com')
        resp = self._post(reverse('invoices:invoice_list'), {
            'client_name': 'Acme', 'client_email': 'acme@example.com', 'client': str(their_client.pk),
        })
        self.assertEqual(resp.status_code, 400)
        self.assertIn('client', resp.json())

    def test_can_attach_own_client(self):
        my_client = ClientModel.objects.create(user=self.user, name='Mine', email='mine@example.com')
        resp = self._post(reverse('invoices:invoice_list'), {
            'client_name': 'Mine', 'client_email': 'mine@example.com', 'client': str(my_client.pk),
        })
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.json()['client'], str(my_client.pk))

    def test_list_and_detail(self):
        invoice = self._invoice()
        resp = self._get(reverse('invoices:invoice_list'))
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['total'], 1)

        resp = self._get(reverse('invoices:invoice_detail', kwargs={'pk': invoice.pk}))
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['id'], str(invoice.pk))

    def test_cannot_view_another_users_invoice(self):
        other_user = User.objects.create_user(email='other2@example.com', password='Sup3r$ecret1')
        their_invoice = make_invoice(other_user)
        resp = self._get(reverse('invoices:invoice_detail', kwargs={'pk': their_invoice.pk}))
        self.assertEqual(resp.status_code, 404)

    def test_filter_by_status(self):
        self._invoice(status='draft')
        self._invoice(status='sent', sent_at=timezone.now())
        resp = self._get(reverse('invoices:invoice_list') + '?status=sent')
        self.assertEqual(resp.json()['total'], 1)

    def test_filter_by_client(self):
        my_client = ClientModel.objects.create(user=self.user, name='Mine', email='mine@example.com')
        self._invoice(client=my_client)
        self._invoice()
        resp = self._get(reverse('invoices:invoice_list') + f'?client={my_client.pk}')
        self.assertEqual(resp.json()['total'], 1)

    def test_search_by_invoice_number(self):
        self._invoice(invoice_number='INV-2026-0042')
        self._invoice(invoice_number='INV-2026-0099')
        resp = self._get(reverse('invoices:invoice_list') + '?search=0042')
        self.assertEqual(resp.json()['total'], 1)

    def test_overdue_filter(self):
        self._invoice(status='sent', sent_at=timezone.now(), due_date=date(2020, 1, 1))
        self._invoice(status='draft', due_date=date(2020, 1, 1))
        resp = self._get(reverse('invoices:invoice_list') + '?overdue=true')
        self.assertEqual(resp.json()['total'], 1)


# ══════════════════════════════════════════════════════════════════
# IS_EDITABLE ENFORCEMENT — second most important regression category
# ══════════════════════════════════════════════════════════════════

class IsEditableEnforcementTests(InvoicesAPITestCase):
    def test_put_allowed_on_draft(self):
        invoice = self._invoice(status='draft')
        resp = self._put(reverse('invoices:invoice_detail', kwargs={'pk': invoice.pk}), {
            'client_name': 'Renamed', 'client_email': invoice.client_email,
        })
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['client_name'], 'Renamed')

    def test_put_rejected_once_created(self):
        invoice = self._invoice(status='created')
        resp = self._put(reverse('invoices:invoice_detail', kwargs={'pk': invoice.pk}), {
            'client_name': 'Should Not Apply', 'client_email': invoice.client_email,
        })
        self.assertEqual(resp.status_code, 403)
        invoice.refresh_from_db()
        self.assertNotEqual(invoice.client_name, 'Should Not Apply')

    def test_put_rejected_for_every_non_draft_status(self):
        for status_value in ('created', 'sent', 'viewed', 'partially_paid', 'paid', 'cancelled', 'refunded', 'bad_debt'):
            invoice = self._invoice(status=status_value)
            resp = self._put(reverse('invoices:invoice_detail', kwargs={'pk': invoice.pk}), {
                'client_name': 'X', 'client_email': invoice.client_email,
            })
            self.assertEqual(resp.status_code, 403, f'status={status_value} should reject PUT')

    def test_delete_allowed_on_draft_and_created(self):
        for status_value in ('draft', 'created'):
            invoice = self._invoice(status=status_value)
            resp = self._delete(reverse('invoices:invoice_detail', kwargs={'pk': invoice.pk}))
            self.assertEqual(resp.status_code, 204, f'status={status_value} should allow delete')

    def test_delete_rejected_once_sent_or_beyond(self):
        for status_value in ('sent', 'viewed', 'partially_paid', 'paid', 'cancelled', 'refunded', 'bad_debt'):
            invoice = self._invoice(status=status_value)
            resp = self._delete(reverse('invoices:invoice_detail', kwargs={'pk': invoice.pk}))
            self.assertEqual(resp.status_code, 403, f'status={status_value} should reject delete')
            self.assertTrue(Invoice.objects.filter(pk=invoice.pk).exists())


# ══════════════════════════════════════════════════════════════════
# FINALISE
# ══════════════════════════════════════════════════════════════════

class FinaliseTests(InvoicesAPITestCase):
    def test_finalise_assigns_invoice_number_when_unassigned(self):
        invoice = self._invoice(status='draft', invoice_number=None)
        InvoiceItem.objects.create(invoice=invoice, description='Work', quantity=Decimal('1'), unit_price=Decimal('100'))
        resp = self._post(reverse('invoices:invoice_finalise', kwargs={'pk': invoice.pk}))
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body['status'], 'created')
        self.assertIsNotNone(body['invoice_number'])
        self.assertTrue(body['invoice_number'].startswith('INV-'))

    def test_finalise_does_not_reassign_an_existing_number(self):
        invoice = self._invoice(status='draft', invoice_number='INV-2026-0007')
        InvoiceItem.objects.create(invoice=invoice, description='Work', quantity=Decimal('1'), unit_price=Decimal('100'))
        resp = self._post(reverse('invoices:invoice_finalise', kwargs={'pk': invoice.pk}))
        self.assertEqual(resp.json()['invoice_number'], 'INV-2026-0007')

    def test_finalise_requires_at_least_one_item(self):
        invoice = self._invoice(status='draft', invoice_number=None)
        resp = self._post(reverse('invoices:invoice_finalise', kwargs={'pk': invoice.pk}))
        self.assertEqual(resp.status_code, 400)

    def test_finalise_only_from_draft(self):
        invoice = self._invoice(status='created')
        resp = self._post(reverse('invoices:invoice_finalise', kwargs={'pk': invoice.pk}))
        self.assertEqual(resp.status_code, 400)

    def test_finalise_locks_exchange_rate_for_non_usd(self):
        from apps.payments.models import ExchangeRateSnapshot
        ExchangeRateSnapshot.objects.create(
            date=timezone.now().date(), rates_to_usd={'USD': 1.0, 'EUR': 1.08},
            source='test', fetched_at=timezone.now(),
        )
        invoice = self._invoice(status='draft', invoice_number=None, currency='EUR')
        InvoiceItem.objects.create(invoice=invoice, description='Work', quantity=Decimal('1'), unit_price=Decimal('100'))
        self._post(reverse('invoices:invoice_finalise', kwargs={'pk': invoice.pk}))
        invoice.refresh_from_db()
        self.assertIsNotNone(invoice.rate_to_usd_at_issue)
        self.assertIsNotNone(invoice.exchange_rate_snapshot)

    def test_finalise_forces_reminders_disabled_regardless_of_starting_value(self):
        """
        Real, deliberate lifecycle rule (this pass): the wizard's own
        creation-time default for reminders_enabled is True (a user
        creating an invoice sees the toggle on by default, and their
        explicit choice through creation/autosave is respected up to
        this point) — but invoice_finalise unconditionally overrides it
        to False the moment an invoice leaves draft, since finalise never
        sets sent_via_platform=True and reminders are structurally inert
        (Invoice.sent_via_platform's own field help_text: "gates
        reminders only") until a real send happens. Proven against BOTH
        possible starting values, not just the one that happens to match
        the unrelated model field default.
        """
        for starting_value in (True, False):
            with self.subTest(starting_value=starting_value):
                invoice = self._invoice(status='draft', invoice_number=None, reminders_enabled=starting_value)
                InvoiceItem.objects.create(invoice=invoice, description='Work', quantity=Decimal('1'), unit_price=Decimal('100'))
                resp = self._post(reverse('invoices:invoice_finalise', kwargs={'pk': invoice.pk}))
                self.assertEqual(resp.status_code, 200)
                self.assertFalse(resp.json()['reminders_enabled'])
                invoice.refresh_from_db()
                self.assertFalse(invoice.reminders_enabled)

    def test_finalise_via_mark_sent_from_draft_still_forces_reminders_false_before_mark_sents_own_choice_applies(self):
        """
        invoice_mark_sent calls _finalise_invoice first when invoked
        directly on a draft (skipping a separate Finalise click) — this
        confirms the forced-False override happens there too, and that
        mark-sent's OWN send_reminders choice (applied immediately after,
        in the same request) still correctly wins as the final stored
        value — the two rules are not in conflict, they just apply in
        sequence.
        """
        invoice = self._invoice(status='draft', invoice_number=None, reminders_enabled=True)
        InvoiceItem.objects.create(invoice=invoice, description='Work', quantity=Decimal('1'), unit_price=Decimal('100'))
        resp = self._post(reverse('invoices:invoice_mark_sent', kwargs={'pk': invoice.pk}), {
            'confirm': True, 'send_reminders': True,
        })
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['status'], 'sent')
        # mark_sent's own send_reminders=True is what's actually stored —
        # not left at _finalise_invoice's intermediate False.
        self.assertTrue(resp.json()['reminders_enabled'])


# ══════════════════════════════════════════════════════════════════
# MARK SENT — sent_via_platform must NEVER be set here
# ══════════════════════════════════════════════════════════════════

class MarkSentTests(InvoicesAPITestCase):
    def test_requires_explicit_confirm(self):
        invoice = self._invoice(status='created')
        resp = self._post(reverse('invoices:invoice_mark_sent', kwargs={'pk': invoice.pk}), {'send_reminders': True})
        self.assertEqual(resp.status_code, 400)

    def test_mark_sent_never_sets_sent_via_platform(self):
        """Direct assertion, not inference — the single most important check on this endpoint."""
        invoice = self._invoice(status='created')
        resp = self._post(reverse('invoices:invoice_mark_sent', kwargs={'pk': invoice.pk}), {
            'confirm': True, 'send_reminders': True,
        })
        self.assertEqual(resp.status_code, 200)
        invoice.refresh_from_db()
        self.assertFalse(invoice.sent_via_platform)
        self.assertEqual(invoice.status, 'sent')

    def test_send_reminders_false_disables_reminders(self):
        invoice = self._invoice(status='created', reminders_enabled=True)
        self._post(reverse('invoices:invoice_mark_sent', kwargs={'pk': invoice.pk}), {
            'confirm': True, 'send_reminders': False,
        })
        invoice.refresh_from_db()
        self.assertFalse(invoice.reminders_enabled)

    def test_mark_sent_assigns_invoice_number_from_draft(self):
        """Mark as Sent from draft finalises implicitly first (see FinalisePdfStoreTests) — needs a real item, same as an explicit Finalise would."""
        invoice = self._invoice(status='draft', invoice_number=None)
        InvoiceItem.objects.create(invoice=invoice, description='Work', quantity=Decimal('1'), unit_price=Decimal('100'))
        self._post(reverse('invoices:invoice_mark_sent', kwargs={'pk': invoice.pk}), {'confirm': True})
        invoice.refresh_from_db()
        self.assertIsNotNone(invoice.invoice_number)

    def test_mark_sent_only_from_draft_or_created(self):
        invoice = self._invoice(status='paid')
        resp = self._post(reverse('invoices:invoice_mark_sent', kwargs={'pk': invoice.pk}), {'confirm': True})
        self.assertEqual(resp.status_code, 400)


# ══════════════════════════════════════════════════════════════════
# MARK PAID / ADD PAYMENT / UNDO
# ══════════════════════════════════════════════════════════════════

class MarkPaidTests(InvoicesAPITestCase):
    def test_mark_paid_creates_a_real_payment_record(self):
        invoice = self._invoice(status='sent', sent_at=timezone.now(), total=Decimal('100.00'))
        resp = self._post(reverse('invoices:invoice_mark_paid', kwargs={'pk': invoice.pk}), {'source': 'wise'})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['status'], 'paid')
        self.assertEqual(InvoicePartialPayment.objects.filter(invoice=invoice).count(), 1)
        payment = InvoicePartialPayment.objects.get(invoice=invoice)
        self.assertEqual(payment.amount, Decimal('100.00'))
        self.assertEqual(payment.source, 'wise')

    def test_mark_paid_rejected_with_no_outstanding_balance(self):
        invoice = self._invoice(status='sent', sent_at=timezone.now(), total=Decimal('100.00'), amount_paid=Decimal('100.00'))
        resp = self._post(reverse('invoices:invoice_mark_paid', kwargs={'pk': invoice.pk}))
        self.assertEqual(resp.status_code, 400)

    def test_mark_paid_rejected_for_draft(self):
        invoice = self._invoice(status='draft')
        resp = self._post(reverse('invoices:invoice_mark_paid', kwargs={'pk': invoice.pk}))
        self.assertEqual(resp.status_code, 400)


class AddPaymentTests(InvoicesAPITestCase):
    def test_add_partial_payment(self):
        invoice = self._invoice(status='created', total=Decimal('100.00'))
        resp = self._post(reverse('invoices:invoice_add_payment', kwargs={'pk': invoice.pk}), {
            'amount': '40.00', 'currency': 'USD', 'source': 'bank', 'payment_date': str(date.today()),
        })
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.json()['status'], 'partially_paid')

    def test_add_payment_rejects_zero_amount(self):
        invoice = self._invoice(status='created', total=Decimal('100.00'))
        resp = self._post(reverse('invoices:invoice_add_payment', kwargs={'pk': invoice.pk}), {
            'amount': '0', 'payment_date': str(date.today()),
        })
        self.assertEqual(resp.status_code, 400)

    def test_add_payment_rejected_on_cancelled_invoice(self):
        invoice = self._invoice(status='cancelled', total=Decimal('100.00'))
        resp = self._post(reverse('invoices:invoice_add_payment', kwargs={'pk': invoice.pk}), {
            'amount': '40.00', 'payment_date': str(date.today()),
        })
        self.assertEqual(resp.status_code, 400)

    def test_add_payment_rejects_amount_exceeding_outstanding_balance(self):
        """Real bug fixed this pass: invoice_add_payment previously allowed
        an amount greater than outstanding_amount (total - amount_paid),
        letting amount_paid exceed total. The error must state the actual
        remaining amount, not a generic rejection."""
        invoice = self._invoice(status='created', total=Decimal('100.00'))
        resp = self._post(reverse('invoices:invoice_add_payment', kwargs={'pk': invoice.pk}), {
            'amount': '150.00', 'payment_date': str(date.today()),
        })
        self.assertEqual(resp.status_code, 400)
        self.assertIn('100', str(resp.json()))
        invoice.refresh_from_db()
        self.assertEqual(invoice.amount_paid, Decimal('0'))

    def test_add_payment_rejects_amount_exceeding_remaining_after_a_prior_payment(self):
        invoice = self._invoice(status='created', total=Decimal('100.00'))
        first = self._post(reverse('invoices:invoice_add_payment', kwargs={'pk': invoice.pk}), {
            'amount': '60.00', 'payment_date': str(date.today()),
        })
        self.assertEqual(first.status_code, 201)
        # Only 40 remains outstanding — 41 must be rejected.
        second = self._post(reverse('invoices:invoice_add_payment', kwargs={'pk': invoice.pk}), {
            'amount': '41.00', 'payment_date': str(date.today()),
        })
        self.assertEqual(second.status_code, 400)
        invoice.refresh_from_db()
        self.assertEqual(invoice.amount_paid, Decimal('60.00'))

    def test_add_payment_accepts_amount_exactly_equal_to_outstanding_balance(self):
        invoice = self._invoice(status='created', total=Decimal('100.00'))
        resp = self._post(reverse('invoices:invoice_add_payment', kwargs={'pk': invoice.pk}), {
            'amount': '100.00', 'payment_date': str(date.today()),
        })
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.json()['status'], 'paid')


class UndoPaymentTests(InvoicesAPITestCase):
    def test_undo_removes_most_recent_payment(self):
        invoice = self._invoice(status='created', total=Decimal('100.00'))
        InvoicePartialPayment.objects.create(invoice=invoice, amount=Decimal('40.00'), payment_date=date.today())
        invoice.update_paid_status()

        resp = self._delete(reverse('invoices:invoice_undo_payment', kwargs={'pk': invoice.pk}))
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(InvoicePartialPayment.objects.filter(invoice=invoice).count(), 0)
        self.assertEqual(resp.json()['status'], 'created')

    def test_repeatable_walk_back_through_multiple_payments(self):
        invoice = self._invoice(status='created', total=Decimal('100.00'))
        for amount in ('20.00', '30.00', '50.00'):
            InvoicePartialPayment.objects.create(invoice=invoice, amount=Decimal(amount), payment_date=date.today())
            invoice.update_paid_status()
        invoice.refresh_from_db()
        self.assertEqual(invoice.status, 'paid')

        # Undo #1: back to partially_paid with 50 outstanding.
        resp = self._delete(reverse('invoices:invoice_undo_payment', kwargs={'pk': invoice.pk}))
        self.assertEqual(resp.json()['status'], 'partially_paid')
        self.assertEqual(Decimal(resp.json()['amount_paid']), Decimal('50.00'))

        # Undo #2.
        resp = self._delete(reverse('invoices:invoice_undo_payment', kwargs={'pk': invoice.pk}))
        self.assertEqual(Decimal(resp.json()['amount_paid']), Decimal('20.00'))

        # Undo #3 — back to the original pre-payment status.
        resp = self._delete(reverse('invoices:invoice_undo_payment', kwargs={'pk': invoice.pk}))
        self.assertEqual(resp.json()['status'], 'created')
        self.assertEqual(Decimal(resp.json()['amount_paid']), Decimal('0'))

    def test_undo_with_no_payments_rejected(self):
        invoice = self._invoice(status='created')
        resp = self._delete(reverse('invoices:invoice_undo_payment', kwargs={'pk': invoice.pk}))
        self.assertEqual(resp.status_code, 400)

    def test_undo_recent_payment_does_not_require_confirmation(self):
        invoice = self._invoice(status='created', total=Decimal('100.00'))
        payment = InvoicePartialPayment.objects.create(invoice=invoice, amount=Decimal('40.00'), payment_date=date.today())
        invoice.update_paid_status()
        resp = self._delete(reverse('invoices:invoice_undo_payment', kwargs={'pk': invoice.pk}))
        self.assertEqual(resp.status_code, 200)

    def test_undo_old_payment_requires_confirmation(self):
        """The >7-day gate — this endpoint's own judgment call (see DECISIONS.md)."""
        invoice = self._invoice(status='created', total=Decimal('100.00'))
        payment = InvoicePartialPayment.objects.create(invoice=invoice, amount=Decimal('40.00'), payment_date=date.today())
        invoice.update_paid_status()
        payment.recorded_at = timezone.now() - timedelta(days=8)
        payment.save(update_fields=['recorded_at'])

        resp = self._delete(reverse('invoices:invoice_undo_payment', kwargs={'pk': invoice.pk}))
        self.assertEqual(resp.status_code, 400)
        self.assertTrue(resp.json().get('requires_confirmation'))
        self.assertEqual(InvoicePartialPayment.objects.filter(invoice=invoice).count(), 1)

        resp = self._delete(reverse('invoices:invoice_undo_payment', kwargs={'pk': invoice.pk}), {'confirmed_old': True})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(InvoicePartialPayment.objects.filter(invoice=invoice).count(), 0)

    def test_undo_just_under_seven_days_old_does_not_require_confirmation(self):
        """
        A one-minute safety margin under the 7-day line, not exactly 7
        days — real wall-clock time elapses between setting recorded_at
        and the view computing `timezone.now() - recorded_at`, so an
        "exactly 7 days" fixture would nondeterministically land a few
        milliseconds on the wrong side of `age > 7 days` depending on
        test execution speed. This margin tests the same boundary
        meaningfully without that flakiness.
        """
        invoice = self._invoice(status='created', total=Decimal('100.00'))
        payment = InvoicePartialPayment.objects.create(invoice=invoice, amount=Decimal('40.00'), payment_date=date.today())
        invoice.update_paid_status()
        payment.recorded_at = timezone.now() - timedelta(days=7) + timedelta(minutes=1)
        payment.save(update_fields=['recorded_at'])

        resp = self._delete(reverse('invoices:invoice_undo_payment', kwargs={'pk': invoice.pk}))
        self.assertEqual(resp.status_code, 200)


# ══════════════════════════════════════════════════════════════════
# CANCEL / REFUND / BAD DEBT
# ══════════════════════════════════════════════════════════════════

class CancelRefundBadDebtTests(InvoicesAPITestCase):
    def test_cancel_from_sent(self):
        invoice = self._invoice(status='sent', sent_at=timezone.now())
        resp = self._post(reverse('invoices:invoice_cancel', kwargs={'pk': invoice.pk}))
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['status'], 'cancelled')

    def test_cancel_preserves_existing_payments(self):
        invoice = self._invoice(status='partially_paid', total=Decimal('100.00'), amount_paid=Decimal('40.00'))
        InvoicePartialPayment.objects.create(invoice=invoice, amount=Decimal('40.00'), payment_date=date.today())
        self._post(reverse('invoices:invoice_cancel', kwargs={'pk': invoice.pk}))
        self.assertEqual(InvoicePartialPayment.objects.filter(invoice=invoice).count(), 1)

    def test_cancel_rejected_from_draft(self):
        invoice = self._invoice(status='draft')
        resp = self._post(reverse('invoices:invoice_cancel', kwargs={'pk': invoice.pk}))
        self.assertEqual(resp.status_code, 400)

    def test_cancel_rejected_from_paid(self):
        invoice = self._invoice(status='paid')
        resp = self._post(reverse('invoices:invoice_cancel', kwargs={'pk': invoice.pk}))
        self.assertEqual(resp.status_code, 400)

    def test_refund_requires_amount(self):
        invoice = self._invoice(status='paid', amount_paid=Decimal('100.00'))
        resp = self._post(reverse('invoices:invoice_refund', kwargs={'pk': invoice.pk}), {})
        self.assertEqual(resp.status_code, 400)

    def test_refund_partial(self):
        invoice = self._invoice(status='paid', total=Decimal('100.00'), amount_paid=Decimal('100.00'))
        resp = self._post(reverse('invoices:invoice_refund', kwargs={'pk': invoice.pk}), {'amount': '30.00'})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['status'], 'refunded')

    def test_refund_persists_refunded_amount(self):
        """The actual fix — previously this amount only existed in the emitted event's payload."""
        invoice = self._invoice(status='paid', total=Decimal('100.00'), amount_paid=Decimal('100.00'))
        resp = self._post(reverse('invoices:invoice_refund', kwargs={'pk': invoice.pk}), {'amount': '30.00'})
        self.assertEqual(Decimal(resp.json()['refunded_amount']), Decimal('30.00'))
        invoice.refresh_from_db()
        self.assertEqual(invoice.refunded_amount, Decimal('30.00'))

    def test_refund_rejects_amount_exceeding_amount_paid(self):
        invoice = self._invoice(status='paid', amount_paid=Decimal('50.00'))
        resp = self._post(reverse('invoices:invoice_refund', kwargs={'pk': invoice.pk}), {'amount': '999.00'})
        self.assertEqual(resp.status_code, 400)

    def test_refund_only_from_paid_or_partially_paid(self):
        invoice = self._invoice(status='sent', sent_at=timezone.now())
        resp = self._post(reverse('invoices:invoice_refund', kwargs={'pk': invoice.pk}), {'amount': '10.00'})
        self.assertEqual(resp.status_code, 400)

    def test_second_refund_call_rejected_once_already_refunded(self):
        """
        The accumulate-vs-reject judgment call: refund is one-shot and
        terminal, matching invoice_cancel/invoice_mark_bad_debt. A second
        call gets a specific, explicit "already refunded" message, not
        just an incidental fallthrough to the generic status-eligibility
        rejection.
        """
        invoice = self._invoice(status='paid', total=Decimal('100.00'), amount_paid=Decimal('100.00'))
        first = self._post(reverse('invoices:invoice_refund', kwargs={'pk': invoice.pk}), {'amount': '30.00'})
        self.assertEqual(first.status_code, 200)

        second = self._post(reverse('invoices:invoice_refund', kwargs={'pk': invoice.pk}), {'amount': '20.00'})
        self.assertEqual(second.status_code, 400)
        self.assertIn('already been refunded', second.json()['error'])

        invoice.refresh_from_db()
        self.assertEqual(invoice.refunded_amount, Decimal('30.00'))  # unchanged by the rejected second call

    def test_mark_bad_debt(self):
        invoice = self._invoice(status='partially_paid')
        resp = self._post(reverse('invoices:invoice_mark_bad_debt', kwargs={'pk': invoice.pk}))
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['status'], 'bad_debt')

    def test_mark_bad_debt_rejected_from_draft(self):
        invoice = self._invoice(status='draft')
        resp = self._post(reverse('invoices:invoice_mark_bad_debt', kwargs={'pk': invoice.pk}))
        self.assertEqual(resp.status_code, 400)


# ══════════════════════════════════════════════════════════════════
# DUPLICATE / TOGGLE REMINDERS / RECURRING
# ══════════════════════════════════════════════════════════════════

class DuplicateTests(InvoicesAPITestCase):
    def test_duplicate_resets_lifecycle_fields(self):
        original = self._invoice(
            status='sent', sent_at=timezone.now(), sent_via_platform=True,
            pdf_url='https://example.com/x.pdf', pdf_generated_at=timezone.now(),
        )
        InvoiceItem.objects.create(invoice=original, description='Work', quantity=Decimal('1'), unit_price=Decimal('100'))

        resp = self._post(reverse('invoices:invoice_duplicate', kwargs={'pk': original.pk}))
        self.assertEqual(resp.status_code, 201)
        body = resp.json()

        self.assertEqual(body['status'], 'draft')
        self.assertIsNone(body['invoice_number'])
        self.assertEqual(body['pdf_url'], '')
        self.assertIsNone(body['pdf_generated_at'])
        self.assertFalse(body['sent_via_platform'])
        self.assertNotEqual(body['view_token'], original.view_token)
        self.assertEqual(len(body['items']), 1)

    def test_duplicate_copies_client_snapshot(self):
        original = self._invoice(client_name='Copy Me', client_email='copy@example.com')
        resp = self._post(reverse('invoices:invoice_duplicate', kwargs={'pk': original.pk}))
        self.assertEqual(resp.json()['client_name'], 'Copy Me')


class ToggleAndRecurringTests(InvoicesAPITestCase):
    def test_toggle_reminders(self):
        invoice = self._invoice(reminders_enabled=True)
        resp = self._post(reverse('invoices:invoice_toggle_reminders', kwargs={'pk': invoice.pk}))
        self.assertFalse(resp.json()['reminders_enabled'])
        resp = self._post(reverse('invoices:invoice_toggle_reminders', kwargs={'pk': invoice.pk}))
        self.assertTrue(resp.json()['reminders_enabled'])

    def test_toggle_reminders_on_created_status_specifically(self):
        """
        invoice_toggle_reminders has no status restriction at all, but a
        real invoice reaching 'created' only via the real finalise flow
        (not a bare fixture status= override) is what actually exercises
        the full real path end to end — this is the specific status the
        task called out to verify, not just 'sent'.
        """
        # Starts True — the wizard's own creation-time default (this
        # pass) — specifically to prove _finalise_invoice's override
        # forces it back to False regardless of the submitted value, not
        # because it coincidentally already matched the model's own bare
        # field default (also False, but for an unrelated reason — see
        # test_finalise_forces_reminders_disabled_regardless_of_starting_value
        # below for the dedicated test of that exact rule).
        invoice = self._invoice(status='draft', reminders_enabled=True)
        InvoiceItem.objects.create(invoice=invoice, description='Work', quantity=Decimal('1'), unit_price=Decimal('100'))
        self._post(reverse('invoices:invoice_finalise', kwargs={'pk': invoice.pk}), {})
        invoice.refresh_from_db()
        self.assertEqual(invoice.status, 'created')
        self.assertFalse(invoice.reminders_enabled)  # forced False by _finalise_invoice, not the model default

        resp = self._post(reverse('invoices:invoice_toggle_reminders', kwargs={'pk': invoice.pk}))
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['status'], 'created')  # unaffected by the toggle
        self.assertTrue(resp.json()['reminders_enabled'])  # False -> True
        invoice.refresh_from_db()
        self.assertTrue(invoice.reminders_enabled)

        resp = self._post(reverse('invoices:invoice_toggle_reminders', kwargs={'pk': invoice.pk}))
        self.assertFalse(resp.json()['reminders_enabled'])  # True -> False

    def test_pause_and_resume_recurring(self):
        invoice = self._invoice(is_recurring=True, recurring_interval_days=30)
        resp = self._post(reverse('invoices:invoice_pause_recurring', kwargs={'pk': invoice.pk}))
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()['recurring_paused'])

        resp = self._post(reverse('invoices:invoice_resume_recurring', kwargs={'pk': invoice.pk}))
        self.assertFalse(resp.json()['recurring_paused'])

    def test_pause_recurring_rejected_for_non_recurring_invoice(self):
        invoice = self._invoice(is_recurring=False)
        resp = self._post(reverse('invoices:invoice_pause_recurring', kwargs={'pk': invoice.pk}))
        self.assertEqual(resp.status_code, 400)


# ══════════════════════════════════════════════════════════════════
# TIMELINE
# ══════════════════════════════════════════════════════════════════

class TimelineTests(InvoicesAPITestCase):
    def test_timeline_includes_views_reminders_and_payments(self):
        from apps.invoices.models import InvoiceReminder, InvoiceViewEvent

        invoice = self._invoice(status='partially_paid', total=Decimal('100.00'))
        InvoiceViewEvent.objects.create(invoice=invoice, source='link_click')
        InvoiceReminder.objects.create(invoice=invoice, reminder_number=1, template_used='reminder_1')
        InvoicePartialPayment.objects.create(invoice=invoice, amount=Decimal('40.00'), payment_date=date.today())

        resp = self._get(reverse('invoices:invoice_timeline', kwargs={'pk': invoice.pk}))
        self.assertEqual(resp.status_code, 200)
        types = {entry['type'] for entry in resp.json()['results']}
        # 'created' is always present now (this pass — every invoice has a
        # real created_at) — see test_timeline_always_includes_created below
        # for that behavior specifically; this test's own focus is the 3
        # event-sourced types still all showing up together.
        self.assertEqual(types, {'created', 'view', 'reminder', 'payment'})

    def test_timeline_only_has_created_for_a_fresh_draft(self):
        """
        Real lifecycle events (created/finalised/sent) were invisible
        before this pass even though the invoice already carried their
        real timestamps — a fresh draft now shows exactly one entry
        (created), not zero, and finalised/sent are correctly absent since
        neither has happened yet.
        """
        invoice = self._invoice(status='draft')
        resp = self._get(reverse('invoices:invoice_timeline', kwargs={'pk': invoice.pk}))
        results = resp.json()['results']
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]['type'], 'created')

    def test_timeline_includes_finalised_and_sent_with_real_timestamps(self):
        invoice = self._invoice(status='draft')
        InvoiceItem.objects.create(invoice=invoice, description='Work', quantity=Decimal('1'), unit_price=Decimal('100'))
        self._post(reverse('invoices:invoice_finalise', kwargs={'pk': invoice.pk}), {})
        self._post(reverse('invoices:invoice_mark_sent', kwargs={'pk': invoice.pk}), {'confirm': True})

        resp = self._get(reverse('invoices:invoice_timeline', kwargs={'pk': invoice.pk}))
        results = resp.json()['results']
        types = [e['type'] for e in results]
        self.assertEqual(types, ['created', 'finalised', 'sent'])  # sorted by timestamp, oldest first
        finalised_entry = next(e for e in results if e['type'] == 'finalised')
        sent_entry = next(e for e in results if e['type'] == 'sent')
        self.assertTrue(finalised_entry['invoice_number'])
        self.assertEqual(sent_entry['via'], 'manual')


# ══════════════════════════════════════════════════════════════════
# DASHBOARD RULES MATRIX — one test per rule, per the prompt's request
# ══════════════════════════════════════════════════════════════════

class DashboardSummaryRulesTests(InvoicesAPITestCase):
    """
    One test per rule from the real decisions-document Section 6, supplied
    explicitly in the Step 5 review — not the guessed, unconditional
    version this endpoint originally shipped with.
    """
    def _summary(self):
        return self._get(reverse('invoices:invoice_summary')).json()

    # ── Outstanding: sent_via_platform=True AND status in ACTIVE_STATUSES ──

    def test_outstanding_requires_sent_via_platform_true(self):
        """The core correction: a sent-but-not-platform-sent invoice must NOT count."""
        self._invoice(status='sent', sent_via_platform=False, sent_at=timezone.now(), total=Decimal('100'))
        self.assertEqual(self._summary()['outstanding']['count'], 0)

    def test_outstanding_counts_sent_via_platform_true_invoices(self):
        self._invoice(status='sent', sent_via_platform=True, sent_at=timezone.now(), total=Decimal('100'))
        summary = self._summary()
        self.assertEqual(summary['outstanding']['count'], 1)
        self.assertEqual(Decimal(summary['outstanding']['total']), Decimal('100'))

    def test_outstanding_counts_remaining_balance_not_full_total(self):
        self._invoice(
            status='partially_paid', sent_via_platform=True, total=Decimal('100'), amount_paid=Decimal('40'),
        )
        summary = self._summary()
        self.assertEqual(Decimal(summary['outstanding']['total']), Decimal('60'))

    def test_outstanding_excludes_draft(self):
        self._invoice(status='draft', sent_via_platform=True, total=Decimal('100'))
        self.assertEqual(self._summary()['outstanding']['count'], 0)

    def test_outstanding_excludes_created(self):
        self._invoice(status='created', sent_via_platform=True, total=Decimal('100'))
        self.assertEqual(self._summary()['outstanding']['count'], 0)

    def test_outstanding_excludes_paid(self):
        self._invoice(status='paid', sent_via_platform=True, total=Decimal('100'), amount_paid=Decimal('100'))
        self.assertEqual(self._summary()['outstanding']['count'], 0)

    def test_outstanding_excludes_cancelled(self):
        """Cancelled has no remaining balance owed, even with sent_via_platform=True."""
        self._invoice(status='cancelled', sent_via_platform=True, total=Decimal('100'))
        self.assertEqual(self._summary()['outstanding']['count'], 0)

    def test_outstanding_excludes_bad_debt(self):
        """Identical treatment to cancelled, per the restated rules."""
        self._invoice(status='bad_debt', sent_via_platform=True, total=Decimal('100'))
        self.assertEqual(self._summary()['outstanding']['count'], 0)

    def test_outstanding_excludes_refunded(self):
        self._invoice(status='refunded', sent_via_platform=True, total=Decimal('100'), amount_paid=Decimal('100'))
        self.assertEqual(self._summary()['outstanding']['count'], 0)

    # ── Total Paid: sum(amount_paid) all invoices (any sent_via_platform), minus sum(refunded_amount) ──

    def test_total_paid_counts_regardless_of_sent_via_platform(self):
        self._invoice(status='paid', sent_via_platform=False, total=Decimal('100'), amount_paid=Decimal('100'))
        summary = self._summary()
        self.assertEqual(Decimal(summary['total_paid']['total']), Decimal('100'))

    def test_total_paid_subtracts_refunded_amount(self):
        self._invoice(
            status='refunded', total=Decimal('100'), amount_paid=Decimal('100'), refunded_amount=Decimal('30'),
        )
        summary = self._summary()
        self.assertEqual(Decimal(summary['total_paid']['total']), Decimal('70'))

    def test_total_paid_includes_cancelled_invoices_amount_paid(self):
        """Money already received isn't erased by a later cancellation."""
        self._invoice(status='cancelled', total=Decimal('100'), amount_paid=Decimal('40'))
        summary = self._summary()
        self.assertEqual(Decimal(summary['total_paid']['total']), Decimal('40'))

    def test_total_paid_includes_bad_debt_invoices_amount_paid(self):
        self._invoice(status='bad_debt', total=Decimal('100'), amount_paid=Decimal('25'))
        summary = self._summary()
        self.assertEqual(Decimal(summary['total_paid']['total']), Decimal('25'))

    def test_total_paid_excludes_draft_and_created(self):
        self._invoice(status='draft', amount_paid=Decimal('0'))
        self._invoice(status='created', amount_paid=Decimal('0'))
        summary = self._summary()
        self.assertEqual(Decimal(summary['total_paid']['total']), Decimal('0'))

    def test_total_paid_sums_across_multiple_invoices(self):
        self._invoice(status='paid', total=Decimal('100'), amount_paid=Decimal('100'))
        self._invoice(status='partially_paid', total=Decimal('50'), amount_paid=Decimal('20'))
        summary = self._summary()
        self.assertEqual(Decimal(summary['total_paid']['total']), Decimal('120'))

    # ── Past-Due Amount: same filter as Outstanding, further filtered to days_overdue > 0 ──

    def test_past_due_requires_sent_via_platform_true(self):
        self._invoice(
            status='sent', sent_via_platform=False, sent_at=timezone.now(),
            due_date=date(2020, 1, 1), total=Decimal('100'),
        )
        self.assertEqual(self._summary()['past_due']['count'], 0)

    def test_past_due_counts_sent_via_platform_true_and_overdue(self):
        self._invoice(
            status='sent', sent_via_platform=True, sent_at=timezone.now(),
            due_date=date(2020, 1, 1), total=Decimal('100'),
        )
        summary = self._summary()
        self.assertEqual(summary['past_due']['count'], 1)
        self.assertEqual(Decimal(summary['past_due']['total']), Decimal('100'))

    def test_past_due_excludes_not_yet_due(self):
        future = timezone.now().date() + timedelta(days=10)
        self._invoice(status='sent', sent_via_platform=True, sent_at=timezone.now(), due_date=future, total=Decimal('100'))
        self.assertEqual(self._summary()['past_due']['count'], 0)

    def test_past_due_excludes_paid_even_with_a_past_due_date(self):
        self._invoice(
            status='paid', sent_via_platform=True, due_date=date(2020, 1, 1),
            total=Decimal('100'), amount_paid=Decimal('100'),
        )
        self.assertEqual(self._summary()['past_due']['count'], 0)

    # ── Draft/Created excluded from every figure, unconditionally ──

    def test_draft_excluded_from_every_figure(self):
        self._invoice(status='draft', sent_via_platform=True, total=Decimal('100'), due_date=date(2020, 1, 1))
        summary = self._summary()
        self.assertEqual(summary['outstanding']['count'], 0)
        self.assertEqual(Decimal(summary['total_paid']['total']), Decimal('0'))
        self.assertEqual(summary['past_due']['count'], 0)

    def test_created_excluded_from_every_figure(self):
        self._invoice(status='created', sent_via_platform=True, total=Decimal('100'), due_date=date(2020, 1, 1))
        summary = self._summary()
        self.assertEqual(summary['outstanding']['count'], 0)
        self.assertEqual(Decimal(summary['total_paid']['total']), Decimal('0'))
        self.assertEqual(summary['past_due']['count'], 0)


# ══════════════════════════════════════════════════════════════════
# AGING REPORT — boundary-day tests
# ══════════════════════════════════════════════════════════════════

class AgingReportTests(InvoicesAPITestCase):
    def _report(self):
        return self._get(reverse('invoices:invoice_aging_report')).json()

    def _overdue_invoice(self, days_overdue, total=Decimal('100')):
        due_date = timezone.now().date() - timedelta(days=days_overdue)
        return self._invoice(status='sent', sent_at=timezone.now(), due_date=due_date, total=total)

    def test_not_yet_due_is_current(self):
        self._overdue_invoice(-5)
        self.assertEqual(self._report()['current']['count'], 1)

    def test_exactly_zero_days_is_current(self):
        self._overdue_invoice(0)
        self.assertEqual(self._report()['current']['count'], 1)

    def test_one_day_overdue_is_1_30_bucket(self):
        self._overdue_invoice(1)
        self.assertEqual(self._report()['1_30']['count'], 1)

    def test_exactly_30_days_is_1_30_bucket(self):
        self._overdue_invoice(30)
        self.assertEqual(self._report()['1_30']['count'], 1)

    def test_exactly_31_days_is_31_60_bucket(self):
        self._overdue_invoice(31)
        self.assertEqual(self._report()['31_60']['count'], 1)

    def test_exactly_60_days_is_31_60_bucket(self):
        self._overdue_invoice(60)
        self.assertEqual(self._report()['31_60']['count'], 1)

    def test_exactly_61_days_is_61_90_bucket(self):
        self._overdue_invoice(61)
        self.assertEqual(self._report()['61_90']['count'], 1)

    def test_exactly_90_days_is_61_90_bucket(self):
        self._overdue_invoice(90)
        self.assertEqual(self._report()['61_90']['count'], 1)

    def test_exactly_91_days_is_over_90_bucket(self):
        self._overdue_invoice(91)
        self.assertEqual(self._report()['over_90']['count'], 1)

    def test_draft_excluded_entirely_from_aging_report(self):
        self._invoice(status='draft', due_date=date(2020, 1, 1))
        report = self._report()
        total_count = sum(bucket['count'] for bucket in report.values())
        self.assertEqual(total_count, 0)

    def test_bucket_totals_use_outstanding_amount_not_full_total(self):
        invoice = self._overdue_invoice(1, total=Decimal('100'))
        invoice.amount_paid = Decimal('30')
        invoice.status = 'partially_paid'
        invoice.save()
        report = self._report()
        self.assertEqual(Decimal(report['1_30']['total']), Decimal('70'))


# ══════════════════════════════════════════════════════════════════
# EXCHANGE RATE LOOKUP
# ══════════════════════════════════════════════════════════════════

class ExchangeRateLookupTests(InvoicesAPITestCase):
    def test_latest_snapshot(self):
        from apps.payments.models import ExchangeRateSnapshot
        ExchangeRateSnapshot.objects.create(
            date=timezone.now().date(), rates_to_usd={'USD': 1.0, 'EUR': 1.08},
            source='test', fetched_at=timezone.now(),
        )
        resp = self._get(reverse('invoices:exchange_rate_lookup'))
        self.assertEqual(resp.status_code, 200)
        self.assertIn('EUR', resp.json()['rates_to_usd'])

    def test_no_snapshots_returns_404(self):
        resp = self._get(reverse('invoices:exchange_rate_lookup'))
        self.assertEqual(resp.status_code, 404)

    def test_specific_date_lookup(self):
        from apps.payments.models import ExchangeRateSnapshot
        target_date = date(2026, 1, 1)
        ExchangeRateSnapshot.objects.create(
            date=target_date, rates_to_usd={'USD': 1.0}, source='test', fetched_at=timezone.now(),
        )
        resp = self._get(reverse('invoices:exchange_rate_lookup') + '?date=2026-01-01')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['date'], '2026-01-01')

    def test_invalid_date_param_rejected(self):
        resp = self._get(reverse('invoices:exchange_rate_lookup') + '?date=not-a-date')
        self.assertEqual(resp.status_code, 400)


# ══════════════════════════════════════════════════════════════════
# PRESETS
# ══════════════════════════════════════════════════════════════════

class PresetTests(InvoicesAPITestCase):
    def test_create_and_list_preset(self):
        resp = self._post(reverse('invoices:preset_list'), {
            'name': 'Web Dev', 'currency': 'USD', 'payment_terms': 14,
            'items': [{'description': 'Design', 'unit_price': '500.00'}],
        })
        self.assertEqual(resp.status_code, 201)
        resp = self._get(reverse('invoices:preset_list'))
        self.assertEqual(len(resp.json()), 1)

    def test_preset_requires_name(self):
        resp = self._post(reverse('invoices:preset_list'), {'name': '  '})
        self.assertEqual(resp.status_code, 400)

    def test_update_preset(self):
        preset = InvoicePreset.objects.create(user=self.user, name='Original')
        resp = self._put(reverse('invoices:preset_detail', kwargs={'pk': preset.pk}), {'name': 'Renamed'})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['name'], 'Renamed')

    def test_delete_preset(self):
        preset = InvoicePreset.objects.create(user=self.user, name='Gone')
        resp = self._delete(reverse('invoices:preset_detail', kwargs={'pk': preset.pk}))
        self.assertEqual(resp.status_code, 204)
        self.assertFalse(InvoicePreset.objects.filter(pk=preset.pk).exists())

    def test_set_default_unsets_previous_default(self):
        first = InvoicePreset.objects.create(user=self.user, name='First', is_default=True)
        second = InvoicePreset.objects.create(user=self.user, name='Second')
        resp = self._post(reverse('invoices:preset_set_default', kwargs={'pk': second.pk}))
        self.assertEqual(resp.status_code, 200)
        first.refresh_from_db()
        self.assertFalse(first.is_default)
        self.assertTrue(resp.json()['is_default'])

    def test_create_invoice_from_preset(self):
        preset = InvoicePreset.objects.create(
            user=self.user, name='Web Dev', currency='USD', tax_rate=Decimal('10'), payment_terms=14,
            client_name='Preset Client', client_email='preset@example.com',
        )
        from apps.invoices.models import InvoicePresetItem
        InvoicePresetItem.objects.create(preset=preset, description='Design', quantity=Decimal('1'), unit_price=Decimal('500.00'))

        resp = self._post(reverse('invoices:preset_create_invoice', kwargs={'pk': preset.pk}))
        self.assertEqual(resp.status_code, 201)
        body = resp.json()
        self.assertEqual(body['status'], 'draft')
        self.assertEqual(body['client_name'], 'Preset Client')
        self.assertEqual(len(body['items']), 1)
        self.assertEqual(Decimal(body['subtotal']), Decimal('500.00'))
        self.assertEqual(Decimal(body['total']), Decimal('550.00'))

    def test_cannot_access_another_users_preset(self):
        other_user = User.objects.create_user(email='other3@example.com', password='Sup3r$ecret1')
        theirs = InvoicePreset.objects.create(user=other_user, name='Theirs')
        resp = self._get(reverse('invoices:preset_detail', kwargs={'pk': theirs.pk}))
        self.assertEqual(resp.status_code, 404)


# ══════════════════════════════════════════════════════════════════
# RATE LIMITING — every mutating endpoint
# ══════════════════════════════════════════════════════════════════

class RateLimitTests(InvoicesAPITestCase):
    """
    invoice_create is exercised with the full, real 30-request ramp-up
    (matching apps.clients' established precedent) to prove the counter
    itself actually increments correctly end to end. Every other mutating
    endpoint pre-sets the same cache key _check_moderate_rate_limit reads
    (count=30) and makes exactly one real request — still a real
    end-to-end check that each endpoint's specific action-key string is
    actually wired to the shared helper, just without repeating the
    30-request ramp-up 19 more times.
    """

    def test_create_rate_limited_after_thirty_per_hour(self):
        for i in range(30):
            resp = self._post(reverse('invoices:invoice_list'), {
                'client_name': f'Client {i}', 'client_email': f'c{i}@example.com',
            })
            self.assertEqual(resp.status_code, 201)
        resp = self._post(reverse('invoices:invoice_list'), {'client_name': 'X', 'client_email': 'x@example.com'})
        self.assertEqual(resp.status_code, 429)

    def _drain(self, action_key):
        cache.set(f'ratelimit_invoices_{action_key}_{self.user.pk}', 30, timeout=3600)

    def test_update_rate_limited(self):
        invoice = self._invoice(status='draft')
        self._drain('update')
        resp = self._put(reverse('invoices:invoice_detail', kwargs={'pk': invoice.pk}), {
            'client_name': 'X', 'client_email': invoice.client_email,
        })
        self.assertEqual(resp.status_code, 429)

    def test_delete_rate_limited(self):
        invoice = self._invoice(status='draft')
        self._drain('delete')
        resp = self._delete(reverse('invoices:invoice_detail', kwargs={'pk': invoice.pk}))
        self.assertEqual(resp.status_code, 429)

    def test_finalise_rate_limited(self):
        invoice = self._invoice(status='draft')
        self._drain('finalise')
        resp = self._post(reverse('invoices:invoice_finalise', kwargs={'pk': invoice.pk}))
        self.assertEqual(resp.status_code, 429)

    def test_mark_sent_rate_limited(self):
        invoice = self._invoice(status='created')
        self._drain('mark_sent')
        resp = self._post(reverse('invoices:invoice_mark_sent', kwargs={'pk': invoice.pk}), {'confirm': True})
        self.assertEqual(resp.status_code, 429)

    def test_mark_paid_rate_limited(self):
        invoice = self._invoice(status='sent', sent_at=timezone.now())
        self._drain('mark_paid')
        resp = self._post(reverse('invoices:invoice_mark_paid', kwargs={'pk': invoice.pk}))
        self.assertEqual(resp.status_code, 429)

    def test_add_payment_rate_limited(self):
        invoice = self._invoice(status='created')
        self._drain('add_payment')
        resp = self._post(reverse('invoices:invoice_add_payment', kwargs={'pk': invoice.pk}), {
            'amount': '10.00', 'payment_date': str(date.today()),
        })
        self.assertEqual(resp.status_code, 429)

    def test_undo_payment_rate_limited(self):
        invoice = self._invoice(status='created')
        InvoicePartialPayment.objects.create(invoice=invoice, amount=Decimal('10.00'), payment_date=date.today())
        self._drain('undo_payment')
        resp = self._delete(reverse('invoices:invoice_undo_payment', kwargs={'pk': invoice.pk}))
        self.assertEqual(resp.status_code, 429)

    def test_cancel_rate_limited(self):
        invoice = self._invoice(status='sent', sent_at=timezone.now())
        self._drain('cancel')
        resp = self._post(reverse('invoices:invoice_cancel', kwargs={'pk': invoice.pk}))
        self.assertEqual(resp.status_code, 429)

    def test_refund_rate_limited(self):
        invoice = self._invoice(status='paid', amount_paid=Decimal('50'))
        self._drain('refund')
        resp = self._post(reverse('invoices:invoice_refund', kwargs={'pk': invoice.pk}), {'amount': '10'})
        self.assertEqual(resp.status_code, 429)

    def test_bad_debt_rate_limited(self):
        invoice = self._invoice(status='sent', sent_at=timezone.now())
        self._drain('bad_debt')
        resp = self._post(reverse('invoices:invoice_mark_bad_debt', kwargs={'pk': invoice.pk}))
        self.assertEqual(resp.status_code, 429)

    def test_duplicate_rate_limited(self):
        invoice = self._invoice(status='draft')
        self._drain('duplicate')
        resp = self._post(reverse('invoices:invoice_duplicate', kwargs={'pk': invoice.pk}))
        self.assertEqual(resp.status_code, 429)

    def test_toggle_reminders_rate_limited(self):
        invoice = self._invoice(status='draft')
        self._drain('toggle_reminders')
        resp = self._post(reverse('invoices:invoice_toggle_reminders', kwargs={'pk': invoice.pk}))
        self.assertEqual(resp.status_code, 429)

    def test_pause_recurring_rate_limited(self):
        invoice = self._invoice(status='draft', is_recurring=True, recurring_interval_days=30)
        self._drain('pause_recurring')
        resp = self._post(reverse('invoices:invoice_pause_recurring', kwargs={'pk': invoice.pk}))
        self.assertEqual(resp.status_code, 429)

    def test_resume_recurring_rate_limited(self):
        invoice = self._invoice(status='draft', is_recurring=True, recurring_interval_days=30, recurring_paused=True)
        self._drain('resume_recurring')
        resp = self._post(reverse('invoices:invoice_resume_recurring', kwargs={'pk': invoice.pk}))
        self.assertEqual(resp.status_code, 429)

    def test_preset_create_rate_limited(self):
        self._drain('preset_create')
        resp = self._post(reverse('invoices:preset_list'), {'name': 'X'})
        self.assertEqual(resp.status_code, 429)

    def test_preset_update_rate_limited(self):
        preset = InvoicePreset.objects.create(user=self.user, name='X')
        self._drain('preset_update')
        resp = self._put(reverse('invoices:preset_detail', kwargs={'pk': preset.pk}), {'name': 'Y'})
        self.assertEqual(resp.status_code, 429)

    def test_preset_delete_rate_limited(self):
        preset = InvoicePreset.objects.create(user=self.user, name='X')
        self._drain('preset_delete')
        resp = self._delete(reverse('invoices:preset_detail', kwargs={'pk': preset.pk}))
        self.assertEqual(resp.status_code, 429)

    def test_preset_set_default_rate_limited(self):
        preset = InvoicePreset.objects.create(user=self.user, name='X')
        self._drain('preset_set_default')
        resp = self._post(reverse('invoices:preset_set_default', kwargs={'pk': preset.pk}))
        self.assertEqual(resp.status_code, 429)

    def test_preset_create_invoice_rate_limited(self):
        preset = InvoicePreset.objects.create(user=self.user, name='X')
        self._drain('preset_create_invoice')
        resp = self._post(reverse('invoices:preset_create_invoice', kwargs={'pk': preset.pk}))
        self.assertEqual(resp.status_code, 429)


# ══════════════════════════════════════════════════════════════════
# INVOICE NUMBERING — per-user isolation under genuinely interleaved
# real finalise calls (not the model-method-level test already in
# test_models.py's InvoiceNumberingTests — this goes through the real
# `invoice_finalise` endpoint, the one real call site, to catch a
# regression in WHEN numbering happens, not just the per-user filter
# logic itself). Raised because the previous pass's freeze-point-at-
# finalise change touched this same call site — verified here rather
# than assumed to still be correct.
# ══════════════════════════════════════════════════════════════════

class InvoiceNumberingInterleavedIsolationTests(TestCase):
    def setUp(self):
        cache.clear()
        self.rf = RequestFactory()
        self.user_a = User.objects.create_user(email='freelancer-a@example.com', password='Sup3r$ecret1')
        self.user_a.is_email_verified = True; self.user_a.is_active = True; self.user_a.save()
        self.user_b = User.objects.create_user(email='freelancer-b@example.com', password='Sup3r$ecret1')
        self.user_b.is_email_verified = True; self.user_b.is_active = True; self.user_b.save()
        # Two independent sessions — genuinely two different logged-in
        # users, not one client re-authenticating between calls.
        self.client_a = self._new_authed_client('freelancer-a@example.com')
        self.client_b = self._new_authed_client('freelancer-b@example.com')

    def _new_authed_client(self, email):
        client = DjangoTestClient(enforce_csrf_checks=True)
        dummy = self.rf.get('/')
        csrf_token = get_token(dummy)
        client.cookies['csrftoken'] = dummy.META['CSRF_COOKIE']
        resp = client.post(reverse('users:login'), data=json.dumps({
            'login': email, 'password': 'Sup3r$ecret1',
        }), content_type='application/json', HTTP_X_CSRFTOKEN=csrf_token)
        assert resp.status_code == 200, resp.content
        return client

    def _finalise(self, client, invoice):
        dummy = self.rf.get('/')
        csrf_token = get_token(dummy)
        client.cookies['csrftoken'] = dummy.META['CSRF_COOKIE']
        resp = client.post(
            reverse('invoices:invoice_finalise', kwargs={'pk': invoice.pk}),
            content_type='application/json', HTTP_X_CSRFTOKEN=csrf_token,
        )
        assert resp.status_code == 200, resp.content
        return resp.json()['invoice_number']

    def test_two_users_finalising_in_genuinely_interleaved_order_stay_isolated(self):
        year = timezone.now().year
        # 3 draft invoices per user, each with a real line item (finalise
        # requires one) — created upfront so numbering is assigned only at
        # the interleaved finalise calls below, not at draft-creation time.
        drafts_a = [make_invoice(self.user_a, status='draft', invoice_number=None) for _ in range(3)]
        drafts_b = [make_invoice(self.user_b, status='draft', invoice_number=None) for _ in range(3)]
        for inv in drafts_a + drafts_b:
            InvoiceItem.objects.create(invoice=inv, description='Work', quantity=Decimal('1'), unit_price=Decimal('100'))

        # Every draft starts genuinely unnumbered — confirms numbering
        # hasn't shifted to draft-creation time.
        for inv in drafts_a + drafts_b:
            self.assertIn(inv.invoice_number, (None, ''))

        # Interleaved, not sequential: A, B, A, B, A, B — simulates two
        # freelancers finalising invoices around the same time, neither
        # ever waiting for the other to finish a whole batch first.
        numbers_a, numbers_b = [], []
        for i in range(3):
            numbers_a.append(self._finalise(self.client_a, drafts_a[i]))
            numbers_b.append(self._finalise(self.client_b, drafts_b[i]))

        self.assertEqual(numbers_a, [f'INV-{year}-0001', f'INV-{year}-0002', f'INV-{year}-0003'])
        self.assertEqual(numbers_b, [f'INV-{year}-0001', f'INV-{year}-0002', f'INV-{year}-0003'])

    def test_two_users_finalising_in_reverse_interleave_still_isolated(self):
        """Same as above with the interleave order flipped (B, A, B, A, B, A) — confirms this isn't order-dependent."""
        year = timezone.now().year
        drafts_a = [make_invoice(self.user_a, status='draft', invoice_number=None) for _ in range(3)]
        drafts_b = [make_invoice(self.user_b, status='draft', invoice_number=None) for _ in range(3)]
        for inv in drafts_a + drafts_b:
            InvoiceItem.objects.create(invoice=inv, description='Work', quantity=Decimal('1'), unit_price=Decimal('100'))

        numbers_a, numbers_b = [], []
        for i in range(3):
            numbers_b.append(self._finalise(self.client_b, drafts_b[i]))
            numbers_a.append(self._finalise(self.client_a, drafts_a[i]))

        self.assertEqual(numbers_a, [f'INV-{year}-0001', f'INV-{year}-0002', f'INV-{year}-0003'])
        self.assertEqual(numbers_b, [f'INV-{year}-0001', f'INV-{year}-0002', f'INV-{year}-0003'])

    def test_number_extends_past_9999_without_truncation_or_collision(self):
        """
        zfill(4) pads UP TO 4 digits but never truncates beyond it — a
        real 5-digit invoice number must come out as -10000, not wrap,
        truncate to -0000, or collide with an earlier number. Verified
        empirically rather than trusted from the format string alone.
        """
        year = timezone.now().year
        make_invoice(self.user_a, invoice_number=f'INV-{year}-9999')
        self.assertEqual(Invoice.generate_invoice_number(self.user_a), f'INV-{year}-10000')

        draft = make_invoice(self.user_a, status='draft', invoice_number=None)
        InvoiceItem.objects.create(invoice=draft, description='Work', quantity=Decimal('1'), unit_price=Decimal('100'))
        number = self._finalise(self.client_a, draft)
        self.assertEqual(number, f'INV-{year}-10000')
