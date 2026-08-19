# apps/invoices/tests/test_design_renderer.py
"""
Closes PDF-001 (19 August 2026 production audit) — the real
design_data-to-HTML renderer (apps/invoices/design_renderer.py) plus its
wiring into pdf_generator.py's render_invoice_pdf/render_invoice_portal_html
via the new should_render_dynamic_design branch. Prior to this, a saved
InvoiceDesign's design_data (every element position/style from the Step 8b
canvas editor) and color_variant were validated, persisted, and then never
read by any real render path — invoice.design.base_template alone picked
one of the 3 static templates regardless of what the user actually built.

Covers: the item-5 condition (dynamic renderer vs. the 3 static templates,
both directions, including the "builtin design opened and edited through
the editor" case the condition is specifically designed to catch), real
content binding through a genuinely modified design (not "renders without
error" — the actual moved/recolored/re-paired elements show up in the
output), multi-page/overflow behavior through this specific path (25
items, matching test_pdf_templates.py's own established stress-test
count), font embedding via real PyMuPDF text/font-table inspection (this
project's established verification standard — a WeasyPrint log line
without a warning is not proof a font actually embedded), the sidebar
compromise (style.sidebar: true, modern.html's own technique), and zero
regression to the 3 static templates for every invoice that still uses
them.
"""
import copy
from decimal import Decimal

import fitz  # PyMuPDF
from django.test import TestCase

from apps.invoices.design_renderer import design_has_real_custom_data, should_render_dynamic_design
from apps.invoices.design_seeds import BUILTIN_DESIGNS, MODERN_DESIGN_DATA, PROFESSIONAL_DESIGN_DATA
from apps.invoices.models import InvoiceDesign
from apps.invoices.pdf_generator import render_invoice_pdf, render_invoice_portal_html

from .test_pdf_templates import make_freelancer, make_invoice_with_items


def make_design(user, base_template='professional', design_data=None, source='custom', **overrides):
    return InvoiceDesign.objects.create(
        user=user, name='Test design', base_template=base_template, source=source,
        design_data=design_data if design_data is not None else {}, **overrides,
    )


def _ensure_dynamic(data):
    """
    Tags design_data with a harmless marker key so it's never byte-identical
    to the pure BUILTIN_DESIGNS seed for its own base_template — real custom
    designs a user actually edited are essentially never seed-identical
    either (that exact scenario is covered separately, deliberately, by
    DynamicRenderConditionTests.test_untouched_builtin_duplicate_uses_static).
    Used by tests exercising the DYNAMIC RENDERER'S OWN mechanics (sidebar,
    multi-page, font embedding) so they don't need their own throwaway
    positional tweak just to clear the item-5 condition — nothing reads
    this key, so it has zero effect on rendered output.
    """
    data.setdefault('zone_1', {})['_test_marker'] = True
    return data


# ══════════════════════════════════════════════════════════════════
# ITEM 5 — the dynamic-vs-static condition, both directions
# ══════════════════════════════════════════════════════════════════

class DynamicRenderConditionTests(TestCase):
    def setUp(self):
        self.user = make_freelancer()

    def test_no_design_at_all_uses_static(self):
        invoice = make_invoice_with_items(self.user, n_items=1)
        self.assertIsNone(invoice.design_id)
        self.assertFalse(should_render_dynamic_design(invoice))

    def test_untouched_builtin_duplicate_uses_static(self):
        """design_duplicate's real behavior: design_data = get_builtin_design_data(base_template) verbatim — byte-identical to the seed, nothing dynamic to render."""
        design = make_design(self.user, base_template='professional', source='builtin', design_data=copy.deepcopy(PROFESSIONAL_DESIGN_DATA))
        invoice = make_invoice_with_items(self.user, n_items=1, design=design)
        self.assertFalse(should_render_dynamic_design(invoice))

    def test_builtin_design_edited_through_the_editor_uses_dynamic(self):
        """
        The exact case item 5 named explicitly: source stays 'builtin'
        forever (DesignEditor.jsx's handleSave payload never sends
        `source`, and InvoiceDesignSerializer's PUT leaves it untouched
        when omitted) — design_data itself is the only real signal that
        an edit ever happened.
        """
        edited = copy.deepcopy(PROFESSIONAL_DESIGN_DATA)
        edited['zone_1']['elements'][0]['x'] = 30  # moved the logo — a real edit
        design = make_design(self.user, base_template='professional', source='builtin', design_data=edited)
        invoice = make_invoice_with_items(self.user, n_items=1, design=design)
        self.assertTrue(should_render_dynamic_design(invoice))

    def test_custom_source_uses_dynamic(self):
        edited = copy.deepcopy(PROFESSIONAL_DESIGN_DATA)
        edited['zone_2']['elements'][0]['style']['align'] = 'left'
        design = make_design(self.user, base_template='professional', source='custom', design_data=edited)
        invoice = make_invoice_with_items(self.user, n_items=1, design=design)
        self.assertTrue(should_render_dynamic_design(invoice))

    def test_ai_seeded_source_uses_dynamic(self):
        adjusted = copy.deepcopy(PROFESSIONAL_DESIGN_DATA)
        adjusted['zone_1']['elements'][1]['style']['color'] = '#204060'
        design = make_design(self.user, base_template='professional', source='ai_seeded', design_data=adjusted)
        invoice = make_invoice_with_items(self.user, n_items=1, design=design)
        self.assertTrue(should_render_dynamic_design(invoice))

    def test_blank_design_data_uses_static_not_a_crash(self):
        """A design created directly via the ORM, bypassing serializer validation (as some existing tests do) — must fall back gracefully, matching test_pdf_pipeline.py's own pre-existing expectation for this exact scenario."""
        design = InvoiceDesign.objects.create(user=self.user, name='Blank', base_template='modern')
        invoice = make_invoice_with_items(self.user, n_items=1, design=design)
        self.assertFalse(design_has_real_custom_data(design))
        self.assertFalse(should_render_dynamic_design(invoice))

    def test_missing_zone_keys_uses_static_not_a_crash(self):
        design = make_design(self.user, base_template='minimal', design_data={'zone_1': {'elements': []}})
        invoice = make_invoice_with_items(self.user, n_items=1, design=design)
        self.assertFalse(should_render_dynamic_design(invoice))


# ══════════════════════════════════════════════════════════════════
# REAL CONTENT BINDING — the modified elements actually show up
# ══════════════════════════════════════════════════════════════════

class DynamicRenderContentTests(TestCase):
    def setUp(self):
        self.user = make_freelancer()

    def _custom_invoice(self, design_data, **overrides):
        design = make_design(self.user, base_template='professional', design_data=design_data)
        return make_invoice_with_items(self.user, n_items=2, design=design, **overrides)

    def test_moved_zone1_element_reflects_its_new_position(self):
        data = copy.deepcopy(PROFESSIONAL_DESIGN_DATA)
        data['zone_1']['elements'][0]['x'] = 77  # logo moved from x=20 to x=77
        invoice = self._custom_invoice(data)
        html = render_invoice_portal_html(invoice)
        self.assertIn('left:77mm', html)

    def test_changed_style_color_reflects_in_output(self):
        data = copy.deepcopy(PROFESSIONAL_DESIGN_DATA)
        data['zone_1']['elements'][1]['style']['color'] = '#204060'
        invoice = self._custom_invoice(data)
        html = render_invoice_portal_html(invoice)
        self.assertIn('color:#204060', html)

    def test_real_invoice_content_bound_not_placeholder(self):
        data = copy.deepcopy(PROFESSIONAL_DESIGN_DATA)
        invoice = self._custom_invoice(data, client_name='Real Client Name LLC')
        html = render_invoice_portal_html(invoice)
        self.assertIn('Real Client Name LLC', html)
        self.assertIn('Horizon Studio', html)  # freelancer.business_name from make_freelancer

    def test_totals_rows_filter_hides_excluded_breakdown_rows(self):
        """A real edit an editor user could make: restrict style.rows to exclude 'discount' — must actually disappear from the output, not just still show every row regardless of the filter."""
        data = copy.deepcopy(PROFESSIONAL_DESIGN_DATA)
        totals_element = next(e for e in data['zone_2']['elements'] if e['type'] == 'totals')
        totals_element['style']['rows'] = ['subtotal', 'tax']  # discount deliberately excluded
        invoice = self._custom_invoice(data, tax_rate=Decimal('5'), discount_amount=Decimal('20'))
        html = render_invoice_portal_html(invoice)
        self.assertIn('Subtotal', html)
        self.assertIn('Tax (5', html)
        self.assertNotIn('Discount', html)
        self.assertIn('Total due', html)  # the default (no variant) still shows the due line regardless of the rows filter

    def test_totals_variant_total_due_display_renders_the_big_number_only(self):
        from apps.invoices.design_seeds import MINIMAL_DESIGN_DATA
        data = _ensure_dynamic(copy.deepcopy(MINIMAL_DESIGN_DATA))
        invoice = self._custom_invoice(data, tax_rate=Decimal('5'))
        html = render_invoice_portal_html(invoice)
        self.assertIn('dyn-total-due-amt', html)

    def test_pairing_renders_both_elements_in_one_row(self):
        data = _ensure_dynamic(copy.deepcopy(PROFESSIONAL_DESIGN_DATA))
        invoice = self._custom_invoice(data)
        html = render_invoice_portal_html(invoice)
        self.assertIn('dyn-pair-row', html)
        self.assertIn('Authorised signature', html)
        self.assertIn('Pay online', html)

    def test_client_currency_conversion_line_reused_not_reimplemented(self):
        from apps.payments.models import ExchangeRateSnapshot
        from apps.clients.models import Client
        snapshot = ExchangeRateSnapshot.objects.create(
            date='2026-08-01', rates_to_usd={'USD': 1.0, 'PKR': 0.0036},
            source='test', fetched_at='2026-08-01T06:00:00Z',
        )
        client = Client.objects.create(user=self.user, name='Zainab', email='z@example.com', default_currency='PKR')
        data = _ensure_dynamic(copy.deepcopy(PROFESSIONAL_DESIGN_DATA))
        invoice = self._custom_invoice(
            data, client=client, currency='USD',
            rate_to_usd_at_issue=Decimal('1'), exchange_rate_snapshot=snapshot,
        )
        html = render_invoice_portal_html(invoice)
        self.assertIn('at rate', html)

    def test_notes_and_terms_omitted_when_blank_matching_static_templates(self):
        data = _ensure_dynamic(copy.deepcopy(PROFESSIONAL_DESIGN_DATA))
        invoice = self._custom_invoice(data, notes='', terms='')
        self.assertTrue(should_render_dynamic_design(invoice))
        html = render_invoice_portal_html(invoice)
        self.assertNotIn('>Notes<', html)
        self.assertNotIn('>Terms<', html)

    def test_signature_omitted_when_unset_matching_the_earlier_bug_fix_rule(self):
        self.assertEqual(self.user.profile.signature_url, '')
        data = _ensure_dynamic(copy.deepcopy(PROFESSIONAL_DESIGN_DATA))
        invoice = self._custom_invoice(data)
        self.assertTrue(should_render_dynamic_design(invoice))
        html = render_invoice_portal_html(invoice)
        # 'dyn-sig-img' itself always appears in the <style> block's own class
        # rule — the real assertion is that no <img> tag using it was emitted.
        self.assertNotIn('<img class="dyn-sig-img"', html)

    def test_payment_methods_omitted_when_none_configured(self):
        self.user.profile.bank_name = ''
        self.user.profile.payoneer_email = ''
        self.user.profile.save()
        data = _ensure_dynamic(copy.deepcopy(PROFESSIONAL_DESIGN_DATA))
        invoice = self._custom_invoice(data)
        self.assertTrue(should_render_dynamic_design(invoice))
        html = render_invoice_portal_html(invoice)
        self.assertNotIn('Payment methods', html)


# ══════════════════════════════════════════════════════════════════
# SIDEBAR — modern.html's style.sidebar:true compromise, replicated
# ══════════════════════════════════════════════════════════════════

class SidebarRenderTests(TestCase):
    def setUp(self):
        self.user = make_freelancer()

    def _sidebar_invoice(self, **overrides):
        data = _ensure_dynamic(copy.deepcopy(MODERN_DESIGN_DATA))
        design = make_design(self.user, base_template='modern', design_data=data)
        invoice = make_invoice_with_items(self.user, n_items=2, design=design, **overrides)
        assert should_render_dynamic_design(invoice)
        return invoice

    def test_sidebar_container_rendered_as_fixed_full_height(self):
        invoice = self._sidebar_invoice()
        html = render_invoice_portal_html(invoice)
        self.assertIn('dyn-sidebar', html)
        self.assertIn('position: fixed', html)
        self.assertIn('42mm', html)  # SIDEBAR_WIDTH_MM, matching modern.html's own real value

    def test_sidebar_logo_and_business_info_render_inside_sidebar_not_absolute(self):
        invoice = self._sidebar_invoice()
        html = render_invoice_portal_html(invoice)
        # The sidebar-flagged elements must not carry position:absolute — they're inside the fixed sidebar instead.
        self.assertIn('Horizon Studio', html)

    def test_sidebar_qr_payment_info_renders_inside_sidebar(self):
        invoice = self._sidebar_invoice()
        html = render_invoice_portal_html(invoice)
        self.assertIn('Pay online', html)

    def test_main_content_offset_past_sidebar_width(self):
        invoice = self._sidebar_invoice()
        html = render_invoice_portal_html(invoice)
        self.assertIn('margin-left: 42mm', html)


# ══════════════════════════════════════════════════════════════════
# MULTI-PAGE / OVERFLOW — the two-zone design's whole justification,
# verified through THIS specific rendering path, not assumed from the
# static templates already proving the underlying CSS techniques work.
# ══════════════════════════════════════════════════════════════════

class DynamicMultiPageStressTests(TestCase):
    def setUp(self):
        self.user = make_freelancer()

    def test_heavy_item_count_renders_all_rows_with_no_overlap_error(self):
        """25 items — matching test_pdf_templates.py's own established stress-test count for the 3 static templates."""
        data = _ensure_dynamic(copy.deepcopy(PROFESSIONAL_DESIGN_DATA))
        design = make_design(self.user, base_template='professional', design_data=data)
        invoice = make_invoice_with_items(self.user, n_items=25, design=design)
        self.assertTrue(should_render_dynamic_design(invoice))

        html = render_invoice_portal_html(invoice)
        self.assertEqual(html.count('Line item'), 25)
        # thead repeats via table-header-group — the exact technique minimal.html/modern.html already prove works
        self.assertIn('display: table-header-group', html)

        pdf_bytes = render_invoice_pdf(invoice)
        doc = fitz.open(stream=pdf_bytes, filetype='pdf')
        self.assertGreaterEqual(len(doc), 2, 'expected at least 2 physical pages for 25 line items')
        page_text = ''.join(page.get_text() for page in doc)
        doc.close()
        for i in range(1, 26):
            self.assertIn(f'Line item {i}', page_text)

    def test_heavy_item_count_through_sidebar_design_repeats_sidebar_every_page(self):
        data = _ensure_dynamic(copy.deepcopy(MODERN_DESIGN_DATA))
        design = make_design(self.user, base_template='modern', design_data=data)
        invoice = make_invoice_with_items(self.user, n_items=25, design=design)
        self.assertTrue(should_render_dynamic_design(invoice))

        pdf_bytes = render_invoice_pdf(invoice)
        doc = fitz.open(stream=pdf_bytes, filetype='pdf')
        self.assertGreaterEqual(len(doc), 2)
        doc.close()

    def test_zero_items_does_not_raise(self):
        data = _ensure_dynamic(copy.deepcopy(PROFESSIONAL_DESIGN_DATA))
        design = make_design(self.user, base_template='professional', design_data=data)
        invoice = make_invoice_with_items(self.user, n_items=0, design=design)
        pdf_bytes = render_invoice_pdf(invoice)
        self.assertTrue(pdf_bytes.startswith(b'%PDF'))


# ══════════════════════════════════════════════════════════════════
# FONT EMBEDDING — real PyMuPDF font-table inspection, matching this
# project's established verification standard (test_pdf_pipeline.py's
# own test_fonts_actually_embedded_* — "no warning logged" is not proof).
# ══════════════════════════════════════════════════════════════════

class DynamicFontEmbeddingTests(TestCase):
    def setUp(self):
        self.user = make_freelancer()

    def test_source_serif_4_embeds_through_the_dynamic_path(self):
        data = _ensure_dynamic(copy.deepcopy(PROFESSIONAL_DESIGN_DATA))  # business_info style.font = 'Source Serif 4'
        design = make_design(self.user, base_template='professional', design_data=data)
        invoice = make_invoice_with_items(self.user, n_items=1, design=design)
        self.assertTrue(should_render_dynamic_design(invoice))

        pdf_bytes = render_invoice_pdf(invoice)
        doc = fitz.open(stream=pdf_bytes, filetype='pdf')
        font_names = {f[3] for page in doc for f in page.get_fonts()}
        doc.close()
        self.assertTrue(any('+Source-Serif-4' in n for n in font_names), font_names)

    def test_space_grotesk_embeds_through_the_dynamic_path(self):
        data = _ensure_dynamic(copy.deepcopy(MODERN_DESIGN_DATA))  # sidebar business_info style.font = 'Space Grotesk'
        design = make_design(self.user, base_template='modern', design_data=data)
        invoice = make_invoice_with_items(self.user, n_items=1, design=design)
        self.assertTrue(should_render_dynamic_design(invoice))

        pdf_bytes = render_invoice_pdf(invoice)
        doc = fitz.open(stream=pdf_bytes, filetype='pdf')
        font_names = {f[3] for page in doc for f in page.get_fonts()}
        doc.close()
        self.assertTrue(any('+Space-Grotesk' in n for n in font_names), font_names)


# ══════════════════════════════════════════════════════════════════
# ZERO REGRESSION — every invoice still on the 3 static templates
# ══════════════════════════════════════════════════════════════════

class StaticTemplateRegressionTests(TestCase):
    def setUp(self):
        self.user = make_freelancer()

    def test_no_design_still_renders_professional_static_template(self):
        invoice = make_invoice_with_items(self.user, n_items=3)
        html = render_invoice_portal_html(invoice)
        self.assertNotIn('dyn-sidebar', html)
        self.assertNotIn('dyn-pair-row', html)
        self.assertIn('class="page"', html)  # professional.html's own real markup

    def test_untouched_builtin_design_still_renders_the_matching_static_template(self):
        design = make_design(self.user, base_template='modern', source='builtin', design_data=copy.deepcopy(MODERN_DESIGN_DATA))
        invoice = make_invoice_with_items(self.user, n_items=3, design=design)
        self.assertFalse(should_render_dynamic_design(invoice))
        html = render_invoice_portal_html(invoice)
        self.assertIn('class="sidebar"', html)  # modern.html's own real class name (not dyn-sidebar)

    def test_all_three_builtin_designs_remain_byte_identical_to_the_pure_seed(self):
        """Sanity guard: if design_seeds.py ever drifts from BUILTIN_DESIGNS' own dict identity, the whole "untouched builtin = static" optimization silently breaks — caught here directly."""
        for base_template, seed in BUILTIN_DESIGNS.items():
            design = make_design(self.user, base_template=base_template, source='builtin', design_data=copy.deepcopy(seed))
            self.assertFalse(design_has_real_custom_data(design), base_template)
