# apps/invoices/tests/test_models.py
from datetime import date, timedelta
from decimal import Decimal
from unittest.mock import patch

from django.db import IntegrityError, transaction
from django.test import TestCase
from django.utils import timezone

from apps.clients.models import Client
from apps.invoices.models import (
    Invoice, InvoiceItem, InvoicePartialPayment, InvoiceReminder, InvoiceViewEvent,
)
from apps.users.models import User


def make_invoice(user, **overrides):
    defaults = {
        'user': user,
        'invoice_number': Invoice.generate_invoice_number(user),
        'client_name': 'Acme Co',
        'client_email': 'acme@example.com',
        'currency': 'USD',
        'subtotal': Decimal('100.00'),
        'total': Decimal('100.00'),
        'due_date': date(2026, 1, 31),
    }
    defaults.update(overrides)
    return Invoice.objects.create(**defaults)


class NeverOverdueRegressionTests(TestCase):
    """
    The single most important behavioral test in this step. v1 could leak
    'overdue' into status via the pre_payment_status restore path (see
    v1-reference's _RESTORABLE_STATUSES, which included 'overdue') —
    v2 must never do this, under any transition update_paid_status() can
    reach, and 'overdue' must not even exist as a valid status choice.
    """
    def setUp(self):
        self.user = User.objects.create_user(email='freelancer@example.com', password='Sup3r$ecret1')

    def test_overdue_is_not_a_valid_status_choice(self):
        choices = dict(Invoice._meta.get_field('status').choices)
        self.assertNotIn('overdue', choices)

    def test_full_payment_lifecycle_never_produces_overdue_status(self):
        invoice = make_invoice(
            self.user, status='sent', sent_at=timezone.now(), due_date=date(2020, 1, 1), total=Decimal('100.00'),
        )
        seen_statuses = {invoice.status}

        pp1 = InvoicePartialPayment.objects.create(invoice=invoice, amount=Decimal('40.00'), payment_date=date.today())
        invoice.update_paid_status()
        invoice.refresh_from_db()
        seen_statuses.add(invoice.status)

        pp2 = InvoicePartialPayment.objects.create(invoice=invoice, amount=Decimal('60.00'), payment_date=date.today())
        invoice.update_paid_status()
        invoice.refresh_from_db()
        seen_statuses.add(invoice.status)

        pp2.delete()
        invoice.update_paid_status()
        invoice.refresh_from_db()
        seen_statuses.add(invoice.status)

        pp1.delete()
        invoice.update_paid_status()
        invoice.refresh_from_db()
        seen_statuses.add(invoice.status)

        self.assertNotIn('overdue', seen_statuses)

    def test_stale_overdue_in_pre_payment_status_is_ignored_not_restored(self):
        """
        Belt-and-suspenders: even if something external ever wrote the
        literal string 'overdue' directly into pre_payment_status (a bug,
        a bad migration), _RESTORABLE_STATUSES no longer contains it, so
        it's ignored rather than restored into status.
        """
        invoice = make_invoice(self.user, status='partially_paid', pre_payment_status='overdue', total=Decimal('100.00'))
        InvoicePartialPayment.objects.create(invoice=invoice, amount=Decimal('40.00'), payment_date=date.today()).delete()

        invoice.update_paid_status()
        invoice.refresh_from_db()

        self.assertNotEqual(invoice.status, 'overdue')
        self.assertEqual(invoice.status, 'created')  # no sent_at, so falls through to 'created'


class InvoiceNumberingTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(email='freelancer@example.com', password='Sup3r$ecret1')
        self.other_user = User.objects.create_user(email='other@example.com', password='Sup3r$ecret1')

    def test_first_invoice_number_for_user_is_0001(self):
        year = timezone.now().year
        self.assertEqual(Invoice.generate_invoice_number(self.user), f'INV-{year}-0001')

    def test_sequential_numbering_increments(self):
        year = timezone.now().year
        make_invoice(self.user, invoice_number=f'INV-{year}-0001')
        make_invoice(self.user, invoice_number=f'INV-{year}-0002')
        self.assertEqual(Invoice.generate_invoice_number(self.user), f'INV-{year}-0003')

    def test_numbering_is_independent_per_user(self):
        year = timezone.now().year
        make_invoice(self.user, invoice_number=f'INV-{year}-0001')
        make_invoice(self.user, invoice_number=f'INV-{year}-0002')
        # A second, different user's numbering must start fresh at 0001,
        # completely unaffected by self.user's existing invoices — not a
        # literal-thread race test, but the real "two users concurrently"
        # concern: per-user prefixes never interact with each other.
        self.assertEqual(Invoice.generate_invoice_number(self.other_user), f'INV-{year}-0001')
        make_invoice(self.other_user, invoice_number=f'INV-{year}-0001')
        self.assertEqual(Invoice.generate_invoice_number(self.other_user), f'INV-{year}-0002')
        # self.user's own sequence is unaffected by other_user's activity.
        self.assertEqual(Invoice.generate_invoice_number(self.user), f'INV-{year}-0003')

    def test_numbering_resets_across_a_year_boundary(self):
        make_invoice(self.user, invoice_number='INV-2025-0009')
        with patch('apps.invoices.models.timezone') as mock_timezone:
            mock_timezone.now.return_value = timezone.datetime(2026, 1, 1, 12, 0, 0)
            number = Invoice.generate_invoice_number(self.user)
        self.assertEqual(number, 'INV-2026-0001')

    def test_year_boundary_does_not_see_previous_years_invoices(self):
        make_invoice(self.user, invoice_number='INV-2025-9999')
        with patch('apps.invoices.models.timezone') as mock_timezone:
            mock_timezone.now.return_value = timezone.datetime(2026, 3, 1, 12, 0, 0)
            make_invoice(self.user, invoice_number=Invoice.generate_invoice_number(self.user))
            second = Invoice.generate_invoice_number(self.user)
        self.assertEqual(second, 'INV-2026-0002')


class UpdatePaidStatusTransitionTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(email='freelancer@example.com', password='Sup3r$ecret1')

    def test_created_to_partially_paid(self):
        invoice = make_invoice(self.user, status='created', total=Decimal('100.00'))
        InvoicePartialPayment.objects.create(invoice=invoice, amount=Decimal('40.00'), payment_date=date.today())
        invoice.update_paid_status()
        invoice.refresh_from_db()
        self.assertEqual(invoice.status, 'partially_paid')
        self.assertEqual(invoice.amount_paid, Decimal('40.00'))
        self.assertEqual(invoice.pre_payment_status, 'created')

    def test_partially_paid_to_paid(self):
        invoice = make_invoice(self.user, status='created', total=Decimal('100.00'))
        InvoicePartialPayment.objects.create(invoice=invoice, amount=Decimal('40.00'), payment_date=date.today())
        invoice.update_paid_status()
        InvoicePartialPayment.objects.create(invoice=invoice, amount=Decimal('60.00'), payment_date=date.today())
        invoice.update_paid_status()
        invoice.refresh_from_db()
        self.assertEqual(invoice.status, 'paid')
        self.assertEqual(invoice.amount_paid, Decimal('100.00'))
        self.assertIsNotNone(invoice.paid_date)
        self.assertEqual(invoice.pre_payment_status, '')

    def test_overpayment_still_counts_as_paid(self):
        invoice = make_invoice(self.user, status='created', total=Decimal('100.00'))
        InvoicePartialPayment.objects.create(invoice=invoice, amount=Decimal('120.00'), payment_date=date.today())
        invoice.update_paid_status()
        invoice.refresh_from_db()
        self.assertEqual(invoice.status, 'paid')

    def test_undo_restores_pre_payment_status_created(self):
        invoice = make_invoice(self.user, status='created', total=Decimal('100.00'))
        pp = InvoicePartialPayment.objects.create(invoice=invoice, amount=Decimal('40.00'), payment_date=date.today())
        invoice.update_paid_status()
        pp.delete()
        invoice.update_paid_status()
        invoice.refresh_from_db()
        self.assertEqual(invoice.status, 'created')
        self.assertEqual(invoice.pre_payment_status, '')

    def test_undo_restores_to_sent_when_no_views_recorded(self):
        invoice = make_invoice(self.user, status='sent', sent_at=timezone.now(), total=Decimal('100.00'))
        pp = InvoicePartialPayment.objects.create(invoice=invoice, amount=Decimal('40.00'), payment_date=date.today())
        invoice.update_paid_status()
        self.assertEqual(invoice.pre_payment_status, 'sent')
        pp.delete()
        invoice.update_paid_status()
        invoice.refresh_from_db()
        self.assertEqual(invoice.status, 'sent')

    def test_undo_restores_to_viewed_when_a_view_event_exists(self):
        invoice = make_invoice(self.user, status='viewed', sent_at=timezone.now(), total=Decimal('100.00'))
        InvoiceViewEvent.objects.create(invoice=invoice)
        pp = InvoicePartialPayment.objects.create(invoice=invoice, amount=Decimal('40.00'), payment_date=date.today())
        invoice.update_paid_status()
        self.assertEqual(invoice.pre_payment_status, 'viewed')
        pp.delete()
        invoice.update_paid_status()
        invoice.refresh_from_db()
        self.assertEqual(invoice.status, 'viewed')

    def test_paying_from_sent_without_sent_at_stamps_it(self):
        invoice = make_invoice(self.user, status='sent', sent_at=None, total=Decimal('100.00'))
        InvoicePartialPayment.objects.create(invoice=invoice, amount=Decimal('40.00'), payment_date=date.today())
        invoice.update_paid_status()
        invoice.refresh_from_db()
        self.assertIsNotNone(invoice.sent_at)

    def test_paying_from_created_does_not_stamp_sent_at(self):
        invoice = make_invoice(self.user, status='created', sent_at=None, total=Decimal('100.00'))
        InvoicePartialPayment.objects.create(invoice=invoice, amount=Decimal('40.00'), payment_date=date.today())
        invoice.update_paid_status()
        invoice.refresh_from_db()
        self.assertIsNone(invoice.sent_at)

    def test_cancelled_invoice_never_flips_to_paid(self):
        invoice = make_invoice(self.user, status='cancelled', total=Decimal('100.00'))
        InvoicePartialPayment.objects.create(invoice=invoice, amount=Decimal('100.00'), payment_date=date.today())
        invoice.update_paid_status()
        invoice.refresh_from_db()
        self.assertEqual(invoice.status, 'cancelled')

    def test_bad_debt_invoice_never_flips_to_partially_paid(self):
        invoice = make_invoice(self.user, status='bad_debt', total=Decimal('100.00'))
        InvoicePartialPayment.objects.create(invoice=invoice, amount=Decimal('40.00'), payment_date=date.today())
        invoice.update_paid_status()
        invoice.refresh_from_db()
        self.assertEqual(invoice.status, 'bad_debt')

    def test_refunded_invoice_never_flips_to_paid(self):
        """
        'refunded' is a genuinely new terminal status the spec adds (v1
        had no equivalent) — this guard is a deliberate extension of v1's
        cancelled/bad_debt protection, not a port of existing v1 behavior.
        """
        invoice = make_invoice(self.user, status='refunded', total=Decimal('100.00'))
        InvoicePartialPayment.objects.create(invoice=invoice, amount=Decimal('100.00'), payment_date=date.today())
        invoice.update_paid_status()
        invoice.refresh_from_db()
        self.assertEqual(invoice.status, 'refunded')

    def test_refunded_invoice_not_restored_on_payment_removal(self):
        invoice = make_invoice(self.user, status='refunded', pre_payment_status='created', total=Decimal('100.00'))
        invoice.update_paid_status()
        invoice.refresh_from_db()
        self.assertEqual(invoice.status, 'refunded')


class RecalculateTotalsTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(email='freelancer@example.com', password='Sup3r$ecret1')

    def test_basic_arithmetic(self):
        invoice = make_invoice(self.user, tax_rate=Decimal('10.00'), discount_amount=Decimal('5.00'))
        invoice.save()
        InvoiceItem.objects.create(invoice=invoice, description='Item A', quantity=Decimal('2'), unit_price=Decimal('50.00'), sort_order=1)
        invoice.recalculate_totals()
        self.assertEqual(invoice.subtotal, Decimal('100.00'))
        self.assertEqual(invoice.tax_amount, Decimal('10.00'))
        self.assertEqual(invoice.total, Decimal('105.00'))

    def test_zero_items_keeps_the_existing_subtotal(self):
        """v1 only overwrites subtotal when item_total > 0 (line 367) — ported directly, unchanged."""
        invoice = make_invoice(self.user, subtotal=Decimal('50.00'), tax_rate=Decimal('0'))
        invoice.save()
        invoice.recalculate_totals()
        self.assertEqual(invoice.subtotal, Decimal('50.00'))
        self.assertEqual(invoice.total, Decimal('50.00'))

    def test_zero_tax_rate(self):
        invoice = make_invoice(self.user, tax_rate=Decimal('0'))
        invoice.save()
        InvoiceItem.objects.create(invoice=invoice, description='Item', quantity=Decimal('1'), unit_price=Decimal('80.00'))
        invoice.recalculate_totals()
        self.assertEqual(invoice.tax_amount, Decimal('0.00'))
        self.assertEqual(invoice.total, Decimal('80.00'))

    def test_discount_exceeding_subtotal_plus_tax_clamps_total_to_zero(self):
        """
        Not a gap this step had to fill — v1 already handles this (lines
        371-372: `if self.total < 0: self.total = 0`), ported directly.
        """
        invoice = make_invoice(self.user, discount_amount=Decimal('500.00'), tax_rate=Decimal('0'))
        invoice.save()
        InvoiceItem.objects.create(invoice=invoice, description='Item', quantity=Decimal('1'), unit_price=Decimal('100.00'))
        invoice.recalculate_totals()
        self.assertEqual(invoice.total, Decimal('0.00'))

    def test_multiple_items_sum_correctly(self):
        invoice = make_invoice(self.user, tax_rate=Decimal('0'), discount_amount=Decimal('0'))
        invoice.save()
        InvoiceItem.objects.create(invoice=invoice, description='A', quantity=Decimal('3'), unit_price=Decimal('10.00'), sort_order=1)
        InvoiceItem.objects.create(invoice=invoice, description='B', quantity=Decimal('1'), unit_price=Decimal('25.50'), sort_order=2)
        invoice.recalculate_totals()
        self.assertEqual(invoice.subtotal, Decimal('55.50'))
        self.assertEqual(invoice.total, Decimal('55.50'))


class ComputedPropertyTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(email='freelancer@example.com', password='Sup3r$ecret1')

    def test_outstanding_amount(self):
        invoice = make_invoice(self.user, total=Decimal('100.00'), amount_paid=Decimal('30.00'))
        self.assertEqual(invoice.outstanding_amount, Decimal('70.00'))

    def test_outstanding_amount_never_negative(self):
        invoice = make_invoice(self.user, total=Decimal('100.00'), amount_paid=Decimal('150.00'))
        self.assertEqual(invoice.outstanding_amount, Decimal('0'))

    def test_days_overdue_zero_for_every_terminal_or_not_yet_sent_status(self):
        for status in ('paid', 'cancelled', 'refunded', 'draft', 'created', 'bad_debt'):
            invoice = make_invoice(self.user, status=status, due_date=date(2020, 1, 1))
            self.assertEqual(invoice.days_overdue, 0, f'status={status}')

    def test_days_overdue_positive_for_sent_past_due_date(self):
        invoice = make_invoice(self.user, status='sent', due_date=date(2020, 1, 1))
        self.assertGreater(invoice.days_overdue, 0)

    def test_days_overdue_zero_when_not_yet_due(self):
        future = timezone.now().date() + timedelta(days=10)
        invoice = make_invoice(self.user, status='sent', due_date=future)
        self.assertEqual(invoice.days_overdue, 0)

    def test_days_overdue_zero_without_a_due_date(self):
        invoice = make_invoice(self.user, status='sent', due_date=None)
        self.assertEqual(invoice.days_overdue, 0)

    def test_is_editable_true_only_for_draft(self):
        self.assertTrue(make_invoice(self.user, status='draft').is_editable)
        self.assertFalse(make_invoice(self.user, status='created').is_editable)


class PartialPaymentAndReminderTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(email='freelancer@example.com', password='Sup3r$ecret1')
        self.invoice = make_invoice(self.user, total=Decimal('100.00'))

    def test_create_and_query_partial_payment(self):
        pp = InvoicePartialPayment.objects.create(
            invoice=self.invoice, amount=Decimal('25.00'), currency='USD', payment_date=date.today(), source='wise',
        )
        self.assertEqual(self.invoice.partial_payments.count(), 1)
        self.assertEqual(pp.invoice, self.invoice)

    def test_deleting_invoice_cascades_to_its_partial_payments(self):
        InvoicePartialPayment.objects.create(invoice=self.invoice, amount=Decimal('25.00'), payment_date=date.today())
        invoice_id = self.invoice.pk
        self.invoice.delete()
        self.assertEqual(InvoicePartialPayment.objects.filter(invoice_id=invoice_id).count(), 0)

    def test_create_reminder(self):
        reminder = InvoiceReminder.objects.create(
            invoice=self.invoice, reminder_number=1, template_used='reminder_1', days_overdue_at_send=3,
        )
        self.assertEqual(self.invoice.reminders.count(), 1)
        self.assertTrue(reminder.delivered)

    def test_duplicate_reminder_number_for_same_invoice_violates_unique_together(self):
        InvoiceReminder.objects.create(invoice=self.invoice, reminder_number=1, template_used='reminder_1')
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                InvoiceReminder.objects.create(invoice=self.invoice, reminder_number=1, template_used='reminder_2')

    def test_same_reminder_number_allowed_across_different_invoices(self):
        other_invoice = make_invoice(self.user)
        InvoiceReminder.objects.create(invoice=self.invoice, reminder_number=1, template_used='reminder_1')
        # Should not raise — unique_together is scoped per-invoice.
        InvoiceReminder.objects.create(invoice=other_invoice, reminder_number=1, template_used='reminder_1')

    def test_deleting_invoice_cascades_to_its_reminders(self):
        InvoiceReminder.objects.create(invoice=self.invoice, reminder_number=1, template_used='reminder_1')
        invoice_id = self.invoice.pk
        self.invoice.delete()
        self.assertEqual(InvoiceReminder.objects.filter(invoice_id=invoice_id).count(), 0)


class ForeignKeyConstraintTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(email='freelancer@example.com', password='Sup3r$ecret1')

    def test_deleting_client_sets_invoice_client_to_null_not_cascade(self):
        client = Client.objects.create(user=self.user, name='Acme', email='acme@example.com')
        invoice = make_invoice(self.user, client=client)
        invoice_id = invoice.pk

        client.delete()
        invoice.refresh_from_db()

        self.assertIsNone(invoice.client_id)
        self.assertTrue(Invoice.objects.filter(pk=invoice_id).exists())

    def test_invoice_client_related_name_activates_client_payment_stats(self):
        """
        Confirms Invoice.client's related_name='invoices' really does
        activate apps.clients.Client._invoices_for_scoring(), which
        returned None (safely) before this step — this is the actual
        cross-app integration point Step 2 was built ahead of.
        """
        client = Client.objects.create(user=self.user, name='Acme', email='acme@example.com')
        make_invoice(
            self.user, client=client, status='paid', paid_date=date.today(), due_date=date.today(), total=Decimal('100.00'),
        )
        stats = client.payment_stats
        self.assertEqual(stats['invoice_count'], 1)
        self.assertEqual(stats['reliability_score'], 5)

    def test_deleting_user_cascades_to_their_invoices(self):
        invoice = make_invoice(self.user)
        invoice_id = invoice.pk
        self.user.delete()
        self.assertFalse(Invoice.objects.filter(pk=invoice_id).exists())
