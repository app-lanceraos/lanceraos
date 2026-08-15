# apps/invoices/tests/test_analytics.py
"""
Step 18 — Analytics. Covers: month-over-month invoiced/collected trends
(real grouping, currency-converted via core.money.Money), top clients by
revenue (a real ORM ranking, reusing Client.payment_stats only for the
reliability-score half), the anchor-currency-unified USD total in the
currency breakdown, the ?months= window, and the weekly stale-draft
digest task (apps/invoices/tasks.py's notify_stale_drafts).
"""
from datetime import date, timedelta
from decimal import Decimal
from unittest.mock import patch

from django.urls import reverse
from django.utils import timezone

from apps.clients.models import Client as ClientModel
from apps.invoices.models import Invoice, InvoiceItem, InvoicePartialPayment
from apps.invoices.tests.test_models import make_invoice
from apps.invoices.tests.test_views import InvoicesAPITestCase
from apps.users.models import User
from core.models import AuditLog


def _finalised_invoice(user, **overrides):
    defaults = {
        'status': 'created', 'currency': 'USD', 'total': Decimal('100.00'),
        'rate_to_usd_at_issue': Decimal('1'), 'finalised_at': timezone.now(),
    }
    defaults.update(overrides)
    invoice = make_invoice(user, **defaults)
    InvoiceItem.objects.create(invoice=invoice, description='Work', quantity=Decimal('1'), unit_price=Decimal('100'))
    return invoice


class MonthlyTrendTests(InvoicesAPITestCase):
    def test_invoiced_bucketed_by_finalised_month_and_converted_to_usd(self):
        # Relative to "now" (not a hardcoded literal date) — the default
        # 6-month window is anchored to the real current date, so a
        # fixed past date could silently fall outside it depending on
        # when this test actually runs.
        finalised_at = timezone.now()
        _finalised_invoice(
            self.user, currency='PKR', total=Decimal('28000.00'), rate_to_usd_at_issue=Decimal('0.0036'),
            finalised_at=finalised_at,
        )
        resp = self._get(reverse('invoices:invoice_analytics') + '?months=6')
        self.assertEqual(resp.status_code, 200)
        trend = {row['month']: row for row in resp.json()['monthly_trend']}
        key = finalised_at.strftime('%Y-%m')
        self.assertIn(key, trend)
        # 28000 * 0.0036 = 100.80
        self.assertEqual(Decimal(trend[key]['invoiced']), Decimal('100.80'))

    def test_collected_bucketed_by_payment_date_and_converted_to_usd(self):
        invoice = _finalised_invoice(self.user, currency='USD', rate_to_usd_at_issue=Decimal('1'))
        payment_date = timezone.now().date()
        InvoicePartialPayment.objects.create(
            invoice=invoice, amount=Decimal('50.00'), currency='USD', rate_to_usd=Decimal('1'),
            source='bank', payment_date=payment_date,
        )
        resp = self._get(reverse('invoices:invoice_analytics') + '?months=6')
        trend = {row['month']: row for row in resp.json()['monthly_trend']}
        key = payment_date.strftime('%Y-%m')
        self.assertEqual(Decimal(trend[key]['collected']), Decimal('50.00'))

    def test_rows_with_no_captured_rate_are_skipped_not_guessed(self):
        _finalised_invoice(self.user, currency='EUR', total=Decimal('90.00'), rate_to_usd_at_issue=None)
        resp = self._get(reverse('invoices:invoice_analytics') + '?months=6')
        trend = resp.json()['monthly_trend']
        self.assertTrue(all(Decimal(row['invoiced']) == Decimal('0') for row in trend))

    def test_draft_invoices_excluded_from_invoiced(self):
        make_invoice(self.user, status='draft', total=Decimal('500.00'))
        resp = self._get(reverse('invoices:invoice_analytics') + '?months=6')
        trend = resp.json()['monthly_trend']
        self.assertTrue(all(Decimal(row['invoiced']) == Decimal('0') for row in trend))

    def test_cancelled_and_refunded_excluded_from_invoiced(self):
        _finalised_invoice(self.user, status='cancelled', total=Decimal('500.00'))
        _finalised_invoice(self.user, status='refunded', total=Decimal('500.00'))
        resp = self._get(reverse('invoices:invoice_analytics') + '?months=6')
        trend = resp.json()['monthly_trend']
        self.assertTrue(all(Decimal(row['invoiced']) == Decimal('0') for row in trend))

    def test_months_window_defaults_to_6_and_seeds_every_month_even_if_zero(self):
        resp = self._get(reverse('invoices:invoice_analytics'))
        self.assertEqual(len(resp.json()['monthly_trend']), 6)

    def test_months_param_clamped_to_24(self):
        resp = self._get(reverse('invoices:invoice_analytics') + '?months=999')
        self.assertEqual(len(resp.json()['monthly_trend']), 24)

    def test_months_param_rejects_non_integer(self):
        resp = self._get(reverse('invoices:invoice_analytics') + '?months=abc')
        self.assertEqual(resp.status_code, 400)

    def test_scoped_to_the_requesting_user_only(self):
        other = User.objects.create_user(email='other@example.com', password='Sup3r$ecret1')
        _finalised_invoice(other, total=Decimal('999.00'), finalised_at=timezone.now())
        resp = self._get(reverse('invoices:invoice_analytics') + '?months=6')
        trend = resp.json()['monthly_trend']
        self.assertTrue(all(Decimal(row['invoiced']) == Decimal('0') for row in trend))


class TopClientsTests(InvoicesAPITestCase):
    def _client(self, **overrides):
        data = {'name': 'Acme Co', 'email': 'acme@example.com'}
        data.update(overrides)
        return ClientModel.objects.create(user=self.user, **data)

    def test_ranked_by_usd_converted_amount_paid_descending(self):
        big = self._client(name='Big Client', email='big@example.com')
        small = self._client(name='Small Client', email='small@example.com')
        _finalised_invoice(self.user, client=big, currency='USD', total=Decimal('1000'), amount_paid=Decimal('1000'), rate_to_usd_at_issue=Decimal('1'))
        _finalised_invoice(self.user, client=small, currency='USD', total=Decimal('100'), amount_paid=Decimal('100'), rate_to_usd_at_issue=Decimal('1'))

        resp = self._get(reverse('invoices:invoice_analytics'))
        names = [c['name'] for c in resp.json()['top_clients']]
        self.assertEqual(names[0], 'Big Client')
        self.assertIn('Small Client', names)

    def test_reuses_payment_stats_for_reliability_score_not_reimplemented(self):
        client = self._client()
        invoice = _finalised_invoice(
            self.user, client=client, status='paid', currency='USD',
            total=Decimal('100'), amount_paid=Decimal('100'), rate_to_usd_at_issue=Decimal('1'),
            paid_date=date(2026, 1, 1), due_date=date(2026, 1, 1),
        )
        expected = client.payment_stats['reliability_score']
        resp = self._get(reverse('invoices:invoice_analytics'))
        top = resp.json()['top_clients'][0]
        self.assertEqual(top['reliability_score'], expected)

    def test_currency_converts_via_money_across_clients(self):
        pkr_client = self._client(name='PKR Client', email='pkr@example.com')
        _finalised_invoice(
            self.user, client=pkr_client, currency='PKR', total=Decimal('28000'),
            amount_paid=Decimal('28000'), rate_to_usd_at_issue=Decimal('0.0036'),
        )
        resp = self._get(reverse('invoices:invoice_analytics'))
        top = resp.json()['top_clients'][0]
        self.assertEqual(Decimal(top['total_paid_usd']), Decimal('100.80'))

    def test_one_time_clients_excluded_no_client_fk(self):
        _finalised_invoice(self.user, client=None, is_one_time_client=True, amount_paid=Decimal('500'), currency='USD', rate_to_usd_at_issue=Decimal('1'))
        resp = self._get(reverse('invoices:invoice_analytics'))
        self.assertEqual(resp.json()['top_clients'], [])

    def test_limited_to_top_5(self):
        for i in range(7):
            c = self._client(name=f'Client {i}', email=f'c{i}@example.com')
            _finalised_invoice(self.user, client=c, currency='USD', total=Decimal('10'), amount_paid=Decimal('10'), rate_to_usd_at_issue=Decimal('1'))
        resp = self._get(reverse('invoices:invoice_analytics'))
        self.assertEqual(len(resp.json()['top_clients']), 5)


class CurrencyBreakdownTests(InvoicesAPITestCase):
    def test_per_currency_silos_plus_one_unified_usd_total(self):
        _finalised_invoice(self.user, currency='USD', total=Decimal('100'), rate_to_usd_at_issue=Decimal('1'))
        _finalised_invoice(self.user, currency='PKR', total=Decimal('28000'), rate_to_usd_at_issue=Decimal('0.0036'))

        resp = self._get(reverse('invoices:invoice_analytics'))
        breakdown = resp.json()['currency_breakdown']
        self.assertEqual(breakdown['by_currency']['USD']['count'], 1)
        self.assertEqual(Decimal(breakdown['by_currency']['USD']['total']), Decimal('100'))
        self.assertEqual(breakdown['by_currency']['PKR']['count'], 1)
        self.assertEqual(Decimal(breakdown['unified_total_usd']), Decimal('200.80'))  # 100 + 100.80
        self.assertEqual(breakdown['unconverted_count'], 0)

    def test_unconverted_invoices_surfaced_honestly_not_silently_dropped(self):
        _finalised_invoice(self.user, currency='EUR', total=Decimal('50'), rate_to_usd_at_issue=None)
        resp = self._get(reverse('invoices:invoice_analytics'))
        breakdown = resp.json()['currency_breakdown']
        self.assertEqual(breakdown['unconverted_count'], 1)
        self.assertEqual(Decimal(breakdown['unified_total_usd']), Decimal('0'))
        self.assertEqual(breakdown['by_currency']['EUR']['count'], 1)  # still counted in the per-currency silo


class RateToUsdCapturedOnPaymentTests(InvoicesAPITestCase):
    """The real, found gap this step fixes: InvoicePartialPayment.rate_to_usd was never populated anywhere before now."""

    def test_add_payment_captures_a_real_rate_to_usd_for_usd(self):
        invoice = self._invoice(status='sent', sent_at='2026-01-01T00:00:00Z', currency='USD', total=Decimal('100'))
        resp = self._post(reverse('invoices:invoice_add_payment', kwargs={'pk': invoice.pk}), {
            'amount': '50', 'currency': 'USD', 'source': 'bank', 'payment_date': '2026-01-15',
        })
        self.assertEqual(resp.status_code, 201)
        payment = invoice.partial_payments.first()
        self.assertEqual(payment.rate_to_usd, Decimal('1'))

    def test_add_payment_captures_a_real_rate_to_usd_for_a_non_usd_currency(self):
        from apps.payments.models import ExchangeRateSnapshot
        ExchangeRateSnapshot.objects.create(
            date=date.today(), rates_to_usd={'USD': 1.0, 'PKR': 0.0036}, source='test', fetched_at=timezone.now(),
        )
        invoice = self._invoice(status='sent', sent_at='2026-01-01T00:00:00Z', currency='PKR', total=Decimal('28000'))
        resp = self._post(reverse('invoices:invoice_add_payment', kwargs={'pk': invoice.pk}), {
            'amount': '28000', 'currency': 'PKR', 'source': 'bank', 'payment_date': '2026-01-15',
        })
        self.assertEqual(resp.status_code, 201)
        payment = invoice.partial_payments.first()
        self.assertEqual(payment.rate_to_usd, Decimal('0.0036'))

    def test_mark_paid_captures_a_real_rate_to_usd(self):
        invoice = self._invoice(status='sent', sent_at='2026-01-01T00:00:00Z', currency='USD', total=Decimal('100'))
        resp = self._post(reverse('invoices:invoice_mark_paid', kwargs={'pk': invoice.pk}))
        self.assertEqual(resp.status_code, 200)
        payment = invoice.partial_payments.first()
        self.assertEqual(payment.rate_to_usd, Decimal('1'))

    def test_lookup_returns_none_when_no_snapshot_exists_never_raises(self):
        """
        Direct unit test of the lookup function's own contract — not
        reachable through the HTTP endpoints for a non-USD currency
        today, since InvoicePartialPaymentSerializer's currency
        validation (apps.clients.serializers.validate_currency_code)
        already requires a snapshot containing that currency to exist
        before the request gets this far. Still a real, defensive
        guarantee worth its own test: _lookup_rate_to_usd must never
        raise or return a guessed value when a snapshot genuinely
        doesn't exist.
        """
        from apps.invoices.views import _lookup_rate_to_usd
        self.assertIsNone(_lookup_rate_to_usd('PKR'))
        self.assertEqual(_lookup_rate_to_usd('USD'), Decimal('1'))  # USD never needs a snapshot at all


class StaleDraftsDigestTaskTests(InvoicesAPITestCase):
    def _old_draft(self, **overrides):
        defaults = {'status': 'draft', 'total': Decimal('100.00'), 'currency': 'USD'}
        defaults.update(overrides)
        invoice = make_invoice(self.user, **defaults)
        Invoice.objects.filter(pk=invoice.pk).update(created_at=timezone.now() - timedelta(days=10))
        return Invoice.objects.get(pk=invoice.pk)

    @patch('core.email.send_email')
    def test_fires_once_per_user_not_per_draft(self, mock_send):
        mock_send.return_value = True
        from apps.invoices.tasks import notify_stale_drafts
        self._old_draft()
        self._old_draft()

        result = notify_stale_drafts()
        self.assertEqual(result['notified'], 1)
        mock_send.assert_called_once()

    @patch('core.email.send_email')
    def test_recent_draft_not_included(self, mock_send):
        from apps.invoices.tasks import notify_stale_drafts
        make_invoice(self.user, status='draft', total=Decimal('50.00'))  # created just now
        result = notify_stale_drafts()
        self.assertEqual(result['notified'], 0)
        mock_send.assert_not_called()

    @patch('core.email.send_email')
    def test_writes_a_bell_entry_with_the_real_draft_count(self, mock_send):
        mock_send.return_value = True
        from apps.invoices.tasks import notify_stale_drafts
        self._old_draft()
        self._old_draft()
        self._old_draft()

        notify_stale_drafts()
        log = AuditLog.objects.get(user=self.user, event='stale_drafts_digest')
        self.assertEqual(log.metadata['draft_count'], 3)

    @patch('core.email.send_email')
    def test_respects_notif_invoice_events_opt_out(self, mock_send):
        self.user.profile.notif_invoice_events = False
        self.user.profile.save(update_fields=['notif_invoice_events'])
        from apps.invoices.tasks import notify_stale_drafts
        self._old_draft()
        notify_stale_drafts()
        mock_send.assert_not_called()
        self.assertFalse(AuditLog.objects.filter(user=self.user, event='stale_drafts_digest').exists())

    @patch('core.email.send_email')
    def test_mixed_currency_drafts_kept_as_separate_totals_not_summed(self, mock_send):
        mock_send.return_value = True
        from apps.invoices.tasks import notify_stale_drafts
        self._old_draft(currency='USD', total=Decimal('100.00'))
        self._old_draft(currency='PKR', total=Decimal('5000.00'))

        notify_stale_drafts()
        log = AuditLog.objects.get(user=self.user, event='stale_drafts_digest')
        self.assertEqual(set(log.metadata['breakdown'].keys()), {'USD', 'PKR'})
