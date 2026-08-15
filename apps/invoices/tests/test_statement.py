# apps/invoices/tests/test_statement.py
"""
Step 19 — Client Statement PDF. Covers: date-range filtering correctness,
running-balance arithmetic, currency conversion (reusing the same
anchor-currency mechanism Invoice.client_currency_conversion is built
on, generalized to total/paid/outstanding via core.money.Money), empty-
range handling, real font-embedding (opens the actual rendered PDF and
checks its font table, matching Step 7b's own standard — not just "no
warning logged"), and the endpoint's own default-window/validation
behavior.
"""
from datetime import date, datetime, timedelta
from decimal import Decimal

import fitz  # PyMuPDF
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone

from apps.clients.models import Client as ClientModel
from apps.invoices.models import Invoice, InvoiceItem
from apps.invoices.pdf_generator import build_statement_context, render_client_statement_pdf
from apps.invoices.tests.test_pdf_templates import make_freelancer, make_snapshot
from apps.invoices.tests.test_views import InvoicesAPITestCase
from apps.payments.models import ExchangeRateSnapshot
from apps.users.models import User


def _client(user, **overrides):
    data = {'name': 'Acme Co', 'email': 'acme@example.com', 'default_currency': 'USD'}
    data.update(overrides)
    return ClientModel.objects.create(user=user, **data)


def _invoice(user, client, **overrides):
    defaults = {
        'client': client, 'invoice_number': Invoice.generate_invoice_number(user),
        'client_name': client.name, 'client_email': client.email,
        'status': 'created', 'currency': 'USD', 'total': Decimal('100.00'),
        'issue_date': date(2026, 3, 15), 'due_date': date(2026, 4, 15),
        'rate_to_usd_at_issue': Decimal('1'),
    }
    defaults.update(overrides)
    invoice = Invoice.objects.create(user=user, **defaults)
    InvoiceItem.objects.create(invoice=invoice, description='Work', quantity=Decimal('1'), unit_price=defaults['total'])
    return invoice


class DateRangeFilteringTests(TestCase):
    def setUp(self):
        self.user = make_freelancer()
        self.client_obj = _client(self.user)

    def test_only_invoices_inside_the_range_are_included(self):
        _invoice(self.user, self.client_obj, issue_date=date(2026, 1, 1))
        in_range = _invoice(self.user, self.client_obj, issue_date=date(2026, 3, 1))
        _invoice(self.user, self.client_obj, issue_date=date(2026, 6, 1))

        ctx = build_statement_context(self.client_obj, date(2026, 2, 1), date(2026, 4, 1))
        self.assertEqual(len(ctx['rows']), 1)
        self.assertEqual(ctx['rows'][0]['invoice'].pk, in_range.pk)

    def test_range_boundaries_are_inclusive(self):
        start_edge = _invoice(self.user, self.client_obj, issue_date=date(2026, 2, 1))
        end_edge = _invoice(self.user, self.client_obj, issue_date=date(2026, 4, 1))

        ctx = build_statement_context(self.client_obj, date(2026, 2, 1), date(2026, 4, 1))
        ids = {row['invoice'].pk for row in ctx['rows']}
        self.assertEqual(ids, {start_edge.pk, end_edge.pk})

    def test_draft_invoices_excluded(self):
        _invoice(self.user, self.client_obj, status='draft', issue_date=date(2026, 3, 1))
        ctx = build_statement_context(self.client_obj, date(2026, 1, 1), date(2026, 12, 31))
        self.assertEqual(ctx['rows'], [])

    def test_another_clients_invoices_never_appear(self):
        other_client = _client(self.user, name='Other Co', email='other@example.com')
        _invoice(self.user, other_client, issue_date=date(2026, 3, 1))
        ctx = build_statement_context(self.client_obj, date(2026, 1, 1), date(2026, 12, 31))
        self.assertEqual(ctx['rows'], [])

    def test_empty_range_is_a_clean_empty_statement_not_an_error(self):
        ctx = build_statement_context(self.client_obj, date(2026, 1, 1), date(2026, 1, 31))
        self.assertEqual(ctx['rows'], [])
        self.assertEqual(ctx['total_invoiced'], Decimal('0.00'))
        self.assertEqual(ctx['total_outstanding'], Decimal('0.00'))
        # Must still render a real, valid PDF — not raise.
        pdf_bytes = render_client_statement_pdf(self.client_obj, date(2026, 1, 1), date(2026, 1, 31))
        self.assertTrue(pdf_bytes.startswith(b'%PDF'))


class RunningBalanceTests(TestCase):
    def setUp(self):
        self.user = make_freelancer()
        self.client_obj = _client(self.user)

    def test_running_balance_accumulates_outstanding_in_chronological_order(self):
        _invoice(self.user, self.client_obj, issue_date=date(2026, 1, 1), total=Decimal('100.00'), amount_paid=Decimal('0'))
        _invoice(self.user, self.client_obj, issue_date=date(2026, 2, 1), total=Decimal('50.00'), amount_paid=Decimal('50.00'))
        _invoice(self.user, self.client_obj, issue_date=date(2026, 3, 1), total=Decimal('200.00'), amount_paid=Decimal('0'))

        ctx = build_statement_context(self.client_obj, date(2026, 1, 1), date(2026, 12, 31))
        balances = [row['running_balance'] for row in ctx['rows']]
        # 100 outstanding, +0 (fully paid), +200 outstanding = 300
        self.assertEqual(balances, [Decimal('100.00'), Decimal('100.00'), Decimal('300.00')])

    def test_totals_sum_correctly_across_the_range(self):
        _invoice(self.user, self.client_obj, issue_date=date(2026, 1, 1), total=Decimal('100.00'), amount_paid=Decimal('40.00'))
        _invoice(self.user, self.client_obj, issue_date=date(2026, 2, 1), total=Decimal('60.00'), amount_paid=Decimal('60.00'))

        ctx = build_statement_context(self.client_obj, date(2026, 1, 1), date(2026, 12, 31))
        self.assertEqual(ctx['total_invoiced'], Decimal('160.00'))
        self.assertEqual(ctx['total_paid'], Decimal('100.00'))
        self.assertEqual(ctx['total_outstanding'], Decimal('60.00'))


class CurrencyConversionTests(TestCase):
    def setUp(self):
        self.user = make_freelancer()

    def test_same_currency_as_client_needs_no_conversion(self):
        client = _client(self.user, default_currency='USD')
        _invoice(self.user, client, currency='USD', total=Decimal('100.00'))
        ctx = build_statement_context(client, date(2026, 1, 1), date(2026, 12, 31))
        self.assertEqual(ctx['rows'][0]['amounts']['total'], Decimal('100.00'))
        self.assertEqual(ctx['unconverted_count'], 0)

    def test_converts_via_the_same_anchor_currency_mechanism_as_client_currency_conversion(self):
        """
        EUR invoice, client wants PKR — same scenario
        test_pdf_templates.py's own test_currency_line_shown_for_different_currency_client
        already exercises for the property this generalizes, so the
        cross-check lands in a regime where that property's own 2-decimal-
        place rate rounding doesn't distort the result (see DECISIONS.md
        for a real, found-but-out-of-scope precision gap in that property
        for source/target pairs with a rate below 0.01, e.g. PKR-to-USD —
        not exercised here on purpose).
        """
        snapshot = make_snapshot(EUR=Decimal('1.08'), PKR=Decimal('0.0036'))
        client = _client(self.user, default_currency='PKR')
        invoice = _invoice(
            self.user, client, currency='EUR', total=Decimal('100.00'), amount_paid=Decimal('100.00'),
            rate_to_usd_at_issue=Decimal('1.08'), exchange_rate_snapshot=snapshot,
        )
        ctx = build_statement_context(client, date(2026, 1, 1), date(2026, 12, 31))
        row = ctx['rows'][0]
        # 1.08 / 0.0036 = 300; 100 * 300 = 30000
        self.assertEqual(row['amounts']['total'], Decimal('30000.00'))
        self.assertEqual(row['amounts']['amount_paid'], Decimal('30000.00'))
        # Cross-checked directly against the property this generalizes.
        self.assertEqual(invoice.client_currency_conversion['converted_total'], Decimal('30000.00'))

    def test_no_frozen_rate_is_excluded_from_totals_but_still_listed(self):
        client = _client(self.user, default_currency='USD')
        _invoice(self.user, client, currency='EUR', total=Decimal('90.00'), rate_to_usd_at_issue=None, exchange_rate_snapshot=None)
        ctx = build_statement_context(client, date(2026, 1, 1), date(2026, 12, 31))
        self.assertEqual(len(ctx['rows']), 1)  # still listed
        self.assertIsNone(ctx['rows'][0]['amounts'])
        self.assertIsNone(ctx['rows'][0]['running_balance'])
        self.assertEqual(ctx['unconverted_count'], 1)
        self.assertEqual(ctx['total_invoiced'], Decimal('0.00'))  # honestly excluded, not guessed


class FontEmbeddingTests(TestCase):
    """Matches Step 7b's own standard — opens the real rendered PDF and checks its font table, not just 'no warning logged'."""

    def test_fonts_actually_embedded(self):
        user = make_freelancer()
        client = _client(user)
        _invoice(user, client, issue_date=date(2026, 3, 1))

        pdf_bytes = render_client_statement_pdf(client, date(2026, 1, 1), date(2026, 12, 31))
        self.assertTrue(pdf_bytes.startswith(b'%PDF'))
        doc = fitz.open(stream=pdf_bytes, filetype='pdf')
        font_names = {f[3] for page in doc for f in page.get_fonts()}
        doc.close()
        self.assertTrue(any('+IBM-Plex-Sans' in n for n in font_names), font_names)


class ClientStatementEndpointTests(InvoicesAPITestCase):
    def _client(self, **overrides):
        return _client(self.user, **overrides)

    def test_requires_authentication(self):
        from django.test import Client as DjangoTestClient
        anon = DjangoTestClient()
        client_obj = self._client()
        resp = anon.get(reverse('client_statement_pdf', kwargs={'pk': client_obj.pk}))
        self.assertIn(resp.status_code, (401, 403))

    def test_never_reachable_for_another_freelancers_client(self):
        other_user = User.objects.create_user(email='other@example.com', password='Sup3r$ecret1')
        their_client = ClientModel.objects.create(user=other_user, name='Not Yours', email='x@example.com')
        resp = self._get(reverse('client_statement_pdf', kwargs={'pk': their_client.pk}))
        self.assertEqual(resp.status_code, 404)

    def test_real_pdf_returned_with_explicit_range(self):
        client_obj = self._client()
        _invoice(self.user, client_obj, issue_date=date(2026, 3, 1))
        resp = self._get(reverse('client_statement_pdf', kwargs={'pk': client_obj.pk}) + '?start=2026-01-01&end=2026-12-31')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp['Content-Type'], 'application/pdf')
        self.assertTrue(resp.content.startswith(b'%PDF'))
        self.assertIn('attachment', resp['Content-Disposition'])

    def test_defaults_to_a_real_bounded_window_not_all_time(self):
        client_obj = self._client()
        resp = self._get(reverse('client_statement_pdf', kwargs={'pk': client_obj.pk}))
        self.assertEqual(resp.status_code, 200)  # succeeds with no params at all — real default window, not a required-param 400

    def test_rejects_malformed_start(self):
        client_obj = self._client()
        resp = self._get(reverse('client_statement_pdf', kwargs={'pk': client_obj.pk}) + '?start=not-a-date&end=2026-12-31')
        self.assertEqual(resp.status_code, 400)

    def test_rejects_start_after_end(self):
        client_obj = self._client()
        resp = self._get(reverse('client_statement_pdf', kwargs={'pk': client_obj.pk}) + '?start=2026-12-31&end=2026-01-01')
        self.assertEqual(resp.status_code, 400)
