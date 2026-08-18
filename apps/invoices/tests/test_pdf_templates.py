# apps/invoices/tests/test_pdf_templates.py
"""
Step 7 — standalone template-render tests for the three PDF templates
(professional/minimal/modern.html), using Django's own template engine
only (render_to_string). Deliberately does NOT invoke WeasyPrint — the
actual HTML->PDF render call/endpoint is Step 7b's job, and WeasyPrint
isn't a project dependency yet (see requirements.txt's own comment).
This only proves the *data wiring* is correct: real fields bind where
placeholders used to be, the line-items loop holds up for few and many
items, and the client-currency-conversion line shows/hides correctly.

A separate, throwaway WeasyPrint-based render (multi-page stress test,
repeating header/sidebar, the new @page footer on professional.html) was
run manually against these same fixtures during this step's build — see
DECISIONS.md for what that confirmed. Not committed here on purpose.
"""
from datetime import date, datetime
from decimal import Decimal

from django.template.loader import render_to_string
from django.test import TestCase

from apps.clients.models import Client
from apps.invoices.models import Invoice, InvoiceItem
from apps.payments.models import ExchangeRateSnapshot
from apps.users.models import User

TEMPLATES = ['invoices/professional.html', 'invoices/minimal.html', 'invoices/modern.html']


def make_freelancer(email='freelancer@example.com'):
    user = User.objects.create_user(email=email, password='Sup3r$ecret1')
    profile = user.profile
    profile.display_name = 'Fahad Ali'
    profile.business_name = 'Horizon Studio'
    profile.profession = 'Brand & Product Design'
    profile.city = 'Lahore'
    profile.country = 'Pakistan'
    profile.logo = 'https://res.cloudinary.com/demo/image/upload/logo.png'
    profile.bank_name = 'Meezan Bank'
    profile.bank_account_number = '0110109887'
    profile.payoneer_email = 'hello@horizonstudio.pk'
    profile.save()
    return user


def make_snapshot(**rates):
    # rates_to_usd is a plain JSON dict of floats (see ExchangeRateSnapshot's
    # own help_text) — capture_issue_rate() and client_currency_conversion
    # both do Decimal(str(rate)) on the way out, not on the way in.
    base = {'USD': 1.0}
    base.update({k: float(v) for k, v in rates.items()})
    return ExchangeRateSnapshot.objects.create(
        date=date(2026, 8, 1), rates_to_usd=base,
        source='test', fetched_at=datetime(2026, 8, 1, 6, 0, 0),
    )


def make_invoice_with_items(user, n_items=3, **overrides):
    defaults = {
        'user': user, 'invoice_number': None, 'status': 'created',
        'client_name': 'Callahan & Reyes LLP', 'client_email': 'accounts@callahanreyes.com',
        'client_address': '412 Marlowe Ave, Suite 6\nAustin, TX, United States',
        'currency': 'USD', 'due_date': date(2026, 8, 19), 'notes': 'Thanks for the business.',
        'terms': 'Due within 14 days.', 'tax_rate': Decimal('5'),
    }
    defaults.update(overrides)
    invoice = Invoice.objects.create(**defaults)
    for i in range(n_items):
        InvoiceItem.objects.create(
            invoice=invoice, description=f'Line item {i + 1}',
            quantity=Decimal('1'), unit_price=Decimal('100.00'), sort_order=i + 1,
        )
    invoice.recalculate_totals()
    invoice.save()
    return invoice


class PdfTemplateRenderTests(TestCase):
    """Every template must render, for every currency-line scenario, without raising."""

    def setUp(self):
        self.user = make_freelancer()

    def render_all(self, invoice):
        return {t: render_to_string(t, {'invoice': invoice, 'freelancer': self.user.profile}) for t in TEMPLATES}

    def test_renders_with_few_items(self):
        invoice = make_invoice_with_items(self.user, n_items=2)
        outputs = self.render_all(invoice)
        for template, html in outputs.items():
            self.assertIn('Line item 1', html, template)
            self.assertIn('Line item 2', html, template)
            self.assertEqual(html.count('Line item'), 2, f'{template}: expected exactly 2 item rows')

    def test_renders_with_many_items(self):
        """The whole point of the two-zone design (handoff notes) is that this must hold up at any count."""
        invoice = make_invoice_with_items(self.user, n_items=25)
        outputs = self.render_all(invoice)
        for template, html in outputs.items():
            self.assertEqual(html.count('Line item'), 25, f'{template}: expected exactly 25 item rows')

    def test_renders_with_zero_items(self):
        """A draft with no items yet is a valid, permissive state — must not raise."""
        invoice = make_invoice_with_items(self.user, n_items=0)
        outputs = self.render_all(invoice)
        for template, html in outputs.items():
            self.assertNotIn('Line item', html, template)

    def test_client_name_falls_back_when_blank(self):
        invoice = make_invoice_with_items(self.user, n_items=1, client_name='', client_email='')
        outputs = self.render_all(invoice)
        for template, html in outputs.items():
            self.assertIn('No client yet', html, template)

    # ── Currency conversion line — the part that must actually be exercised ──

    def test_currency_line_shown_for_different_currency_client(self):
        snapshot = make_snapshot(EUR=Decimal('1.08'), PKR=Decimal('0.0036'))
        client = Client.objects.create(user=self.user, name='Callahan', email='c@example.com', default_currency='PKR')
        invoice = make_invoice_with_items(
            self.user, n_items=1, client=client, currency='EUR',
            rate_to_usd_at_issue=Decimal('1.08'), exchange_rate_snapshot=snapshot,
        )
        conversion = invoice.client_currency_conversion
        self.assertIsNotNone(conversion)
        self.assertEqual(conversion['currency'], 'PKR')
        # 1.08 / 0.0036 = 300.00
        self.assertEqual(conversion['rate'], Decimal('300.00'))
        outputs = self.render_all(invoice)
        for template, html in outputs.items():
            self.assertIn('at rate 300.00', html, template)

    def test_currency_line_omitted_for_same_currency_client(self):
        snapshot = make_snapshot(PKR=Decimal('0.0036'))
        client = Client.objects.create(user=self.user, name='Callahan', email='c@example.com', default_currency='USD')
        invoice = make_invoice_with_items(
            self.user, n_items=1, client=client, currency='USD',
            rate_to_usd_at_issue=Decimal('1'), exchange_rate_snapshot=snapshot,
        )
        self.assertIsNone(invoice.client_currency_conversion)
        outputs = self.render_all(invoice)
        for template, html in outputs.items():
            self.assertNotIn('at rate', html, template)

    def test_currency_line_omitted_for_one_time_client(self):
        """No Client record at all — Invoice has no client-currency snapshot field to fall back to, so omit entirely."""
        snapshot = make_snapshot(PKR=Decimal('0.0036'))
        invoice = make_invoice_with_items(
            self.user, n_items=1, client=None, is_one_time_client=True, currency='EUR',
            rate_to_usd_at_issue=Decimal('1.08'), exchange_rate_snapshot=snapshot,
        )
        self.assertIsNone(invoice.client_currency_conversion)
        outputs = self.render_all(invoice)
        for template, html in outputs.items():
            self.assertNotIn('at rate', html, template)

    def test_capture_issue_rate_attaches_snapshot_for_usd_invoices_too(self):
        """
        Closes the real gap Step 7a found and pinned (see DECISIONS.md,
        09 August 2026): capture_issue_rate() used to return early for a
        USD invoice without ever setting exchange_rate_snapshot, so a USD
        invoice could never source a *different* currency's rate for the
        client-currency-conversion line, even when the client's currency
        genuinely differed. Fixed in Step 7b — this test asserts the fix
        directly, not just the property's own None-handling, by calling
        the real method (not hand-setting exchange_rate_snapshot on the
        fixture the way the other tests in this file do).
        """
        snapshot = make_snapshot(PKR=Decimal('0.0036'))
        client = Client.objects.create(user=self.user, name='Callahan', email='c@example.com', default_currency='PKR')
        invoice = make_invoice_with_items(self.user, n_items=1, client=client, currency='USD')
        invoice.capture_issue_rate()
        invoice.save()
        self.assertEqual(invoice.rate_to_usd_at_issue, Decimal('1'))
        self.assertEqual(invoice.exchange_rate_snapshot_id, snapshot.pk)
        conversion = invoice.client_currency_conversion
        self.assertIsNotNone(conversion)
        # 1 / 0.0036 = 277.7778 -> quantized to 277.78
        self.assertEqual(conversion['rate'], Decimal('277.78'))
        outputs = self.render_all(invoice)
        for template, html in outputs.items():
            self.assertIn('at rate 277.78', html, template)

    def test_capture_issue_rate_still_sets_rate_1_for_usd_with_no_snapshot_available(self):
        """No ExchangeRateSnapshot exists at all yet — capture_issue_rate() must still set rate_to_usd_at_issue=1 for USD, not raise."""
        invoice = make_invoice_with_items(self.user, n_items=1, currency='USD')
        invoice.capture_issue_rate()
        self.assertEqual(invoice.rate_to_usd_at_issue, Decimal('1'))
        self.assertIsNone(invoice.exchange_rate_snapshot)

    def test_currency_line_omitted_when_client_currency_missing_from_snapshot(self):
        """Defensive: the day's fetch didn't happen to include the client's currency."""
        snapshot = make_snapshot(EUR=Decimal('1.08'))  # no PKR key
        client = Client.objects.create(user=self.user, name='Callahan', email='c@example.com', default_currency='PKR')
        invoice = make_invoice_with_items(
            self.user, n_items=1, client=client, currency='EUR',
            rate_to_usd_at_issue=Decimal('1.08'), exchange_rate_snapshot=snapshot,
        )
        self.assertIsNone(invoice.client_currency_conversion)

    def test_currency_symbol_property(self):
        invoice = make_invoice_with_items(self.user, n_items=1, currency='PKR')
        self.assertEqual(invoice.currency_symbol, 'Rs. ')
        invoice2 = make_invoice_with_items(self.user, n_items=1, currency='AUD')
        self.assertEqual(invoice2.currency_symbol, 'AUD ')

    def test_payment_page_url_property(self):
        """
        FIXED (item 11 of the verification pass): payment_page_url used
        to point at a dead /pay/<token> frontend route that never existed
        — it now IS portal_view_url, the real, live-rendered portal page
        (payment methods + Report-a-Payment claim form), since v2 has no
        payment gateway to build a dedicated pay flow around.
        """
        invoice = make_invoice_with_items(self.user, n_items=1)
        self.assertEqual(invoice.payment_page_url, invoice.portal_view_url)
        # portal_view_url (and therefore payment_page_url, and therefore
        # the PDF's own QR code) now points at the frontend's real
        # /invoice/:token page, not the raw backend host — see
        # DECISIONS.md's real-frontend-domain-invoice-view-page entry.
        self.assertIn(f'/invoice/{invoice.view_token}/', invoice.payment_page_url)

    def test_logo_and_signature_and_qr_slots_are_conditional_not_hardcoded(self):
        """No template should reference the old local test asset filenames anymore."""
        invoice = make_invoice_with_items(self.user, n_items=1)
        outputs = self.render_all(invoice)
        for template, html in outputs.items():
            self.assertNotIn('logo_placeholder.png', html, template)
            self.assertNotIn('logo_on_dark.png', html, template)
            self.assertNotIn('payment_qr.png', html, template)
            self.assertNotIn('signature_clean.png', html, template)

    def test_logo_renders_when_present(self):
        invoice = make_invoice_with_items(self.user, n_items=1)
        outputs = self.render_all(invoice)
        for template, html in outputs.items():
            self.assertIn(self.user.profile.logo, html, template)

    def test_signature_omitted_when_context_has_no_signature_url(self):
        """
        This file only exercises Django's render_to_string directly with a
        hand-built context (no pdf_generator.py involved) — signature_url
        now exists on FreelancerProfile (Step 7b), but this test still
        renders without passing a top-level `signature_url` key at all, so
        the template must keep degrading gracefully. The real round-trip
        through build_pdf_context (set vs blank) is covered in
        test_pdf_pipeline.py, added once the field actually existed.
        """
        invoice = make_invoice_with_items(self.user, n_items=1)
        html = render_to_string('invoices/minimal.html', {'invoice': invoice, 'freelancer': self.user.profile})
        self.assertNotIn('class="sig"', html)

    def test_signature_renders_on_every_template_including_professional_when_set(self):
        """
        Real, found gap (item 7 of the verification pass): professional.html
        was the one template of the three that never rendered
        signature_url at all — CLAUDE.md's own module notes claimed
        "signature_url ... rendering when set" for all three, but only
        minimal.html/modern.html actually did. Fixed to match the other
        two exactly (a conditional <img class="sig">, never a bare
        "Authorised signature" line pretending a signature was provided).
        """
        invoice = make_invoice_with_items(self.user, n_items=1)
        context = {'invoice': invoice, 'freelancer': self.user.profile, 'signature_url': 'https://res.cloudinary.com/demo/image/upload/sig.png'}
        for template in TEMPLATES:
            html = render_to_string(template, context)
            self.assertIn('class="sig"', html, template)
            self.assertIn('sig.png', html, template)

    def test_tax_row_omitted_when_tax_rate_is_zero(self):
        """
        Real, found gap (item 7): every template unconditionally showed a
        "Tax (0%) — $0.00" row even when no tax applied at all, unlike
        discount (already conditional). Confirmed against real data with
        tax_rate genuinely unset (0), not just displaying as zero.
        """
        invoice = make_invoice_with_items(self.user, n_items=1, tax_rate=Decimal('0'))
        outputs = self.render_all(invoice)
        for template, html in outputs.items():
            self.assertNotIn('Tax (', html, template)

    def test_tax_row_shown_when_tax_rate_is_set(self):
        invoice = make_invoice_with_items(self.user, n_items=1, tax_rate=Decimal('7.5'))
        outputs = self.render_all(invoice)
        for template, html in outputs.items():
            self.assertIn('Tax (', html, template)

    def test_payment_methods_section_omitted_when_none_configured(self):
        """
        Real, found gap (item 7): "Payment methods" showed as a bare
        section header with nothing under it whenever the freelancer had
        configured none — the label itself must be conditional on at
        least one method existing, not just each row independently.
        """
        user = User.objects.create_user(email='no-payment-methods@example.com', password='Sup3r$ecret1')
        invoice = make_invoice_with_items(user, n_items=1)
        outputs = {t: render_to_string(t, {'invoice': invoice, 'freelancer': user.profile}) for t in TEMPLATES}
        for template, html in outputs.items():
            self.assertNotIn('Payment methods', html, template)

    def test_payment_methods_section_shown_when_at_least_one_configured(self):
        invoice = make_invoice_with_items(self.user, n_items=1)  # make_freelancer sets bank_name + payoneer_email
        outputs = self.render_all(invoice)
        for template, html in outputs.items():
            self.assertIn('Payment methods', html, template)
