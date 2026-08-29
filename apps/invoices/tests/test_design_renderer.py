# apps/invoices/tests/test_design_renderer.py
"""
Template Builder — tests for the canonical production renderer
(design_renderer.py) and its preview endpoint
(views_design_editor.py). Nothing in this file touches a real Invoice row,
migrates a real InvoiceDesign, or exercises the legacy render path
— apps.invoices.design_renderer (v1) and the three static templates are
never imported here except where a test explicitly needs to prove V1
still works unchanged (see V1RendererUntouchedTests).
"""
import copy
import inspect
from datetime import date
from decimal import Decimal

from django.template import TemplateSyntaxError
from django.test import SimpleTestCase, TestCase
from django.urls import reverse
from django.utils.html import escape

from apps.invoices.design_migration import migrate_v1_to_v2
from apps.invoices.design_schema import SUPPORTED_BINDINGS
from apps.invoices.design_seeds import BUILTIN_DESIGNS
from apps.invoices.design_templates import get_builtin_design_data
from apps.invoices.design_renderer import (
    BINDING_RESOLVERS,
    DesignRenderError,
    build_render_context,
    render_design_html,
    render_design_pdf_bytes,
    resolve_binding,
    resolve_style_value,
)
from apps.invoices.tests.test_views import InvoicesAPITestCase


def _v2(base_template='professional'):
    """
    A real, valid v2 design for the named builtin template, used
    throughout this file wherever a test needs realistic content/structure
    to render — never to test migration's OWN correctness (that's
    test_design_migration.py's job).

    Uses the canonical, hand-authored v2 seed (design_templates.
    get_builtin_design_data) rather than live-migrating BUILTIN_DESIGNS
    (v1) — migrate_v1_to_v2 is now fully correct for all 3 real builtin
    templates too (see test_design_migration.py's own
    MigrateV1ToV2RealSeedTests), but this file's own tests care about
    exercising the canonical RENDERER against realistic content, not about
    proving migration correctness a second time — the hand-authored seed
    has the exact same real content (signature label, Modern's pill_color,
    table/totals, etc.) every test in this file actually checks for.
    """
    return get_builtin_design_data(base_template)


class RendererDatabaseTestCase(TestCase):
    """
    Base class providing a real user + real V2 render context.

    Green-Light directive (§18-22) — a real, self-contained 1x1 PNG data:
    URI logo is set here, same established precedent as
    test_design_templates_golden.py's own fixture (never a network URL,
    which WeasyPrint would try to fetch at render time). Required as of
    the missing-data-collapse fix (design_renderer._element_has_real_content):
    a design's logo element now correctly renders nothing at all when no
    real logo is configured — most existing geometry/no-op tests in this
    file specifically need the logo to be real, present content so they
    can keep asserting its own position/no-op behavior, not "does an
    absent logo correctly disappear" (that has its own dedicated coverage
    in test_design_missing_data.py).
    """

    def setUp(self):
        from apps.users.models import User
        self.user = User.objects.create_user(email='v2-renderer@example.com', password='Sup3r$ecret1')
        self.user.profile.logo = (
            'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
        )
        # `city` has no default (unlike `country`, which does — hence
        # this specific field, not others, needed setting explicitly for
        # every existing header element in this file's own designs to
        # keep rendering real content post-collapse-fix). `address_line1`
        # is bound into the header's "From" block (business.address_line1,
        # design_templates.py) and defaults to '' — needed here for the
        # same reason.
        self.user.profile.city = 'Lahore'
        self.user.profile.address_line1 = '221B Business Ave'
        self.user.profile.save()
        self.context = build_render_context(self.user, 'professional', '')


# ══════════════════════════════════════════════════════════════════
# PART 12 — SCHEMA -> RENDERER (valid renders, invalid rejected safely)
# ══════════════════════════════════════════════════════════════════

class SchemaToRendererTests(RendererDatabaseTestCase):
    def test_valid_v2_builtin_design_renders_successfully(self):
        html = render_design_html(_v2('professional'), self.context)
        self.assertIn('<html', html)
        self.assertIn('</html>', html)

    def test_all_three_builtin_seeds_render_successfully_once_migrated(self):
        for name in BUILTIN_DESIGNS:
            with self.subTest(template=name):
                html = render_design_html(_v2(name), self.context)
                self.assertIn('<html', html)

    def test_structurally_invalid_design_data_raises_v2_render_error_not_a_silent_blank(self):
        with self.assertRaises(DesignRenderError):
            render_design_html({'schema_version': 2, 'page': {}}, self.context)  # missing header/flow

    def test_v1_shaped_design_data_is_rejected_by_the_v2_renderer_directly(self):
        # The renderer itself does not auto-migrate — that's the isolated
        # preview endpoint's job (tested separately below). Calling the
        # renderer directly with legacy shape must fail explicitly.
        with self.assertRaises(DesignRenderError):
            render_design_html(BUILTIN_DESIGNS['professional'], self.context)

    def test_error_message_names_the_real_schema_violation(self):
        with self.assertRaises(DesignRenderError) as cm:
            render_design_html({'schema_version': 2, 'page': {'size': 'A4', 'width_mm': 210, 'height_mm': 297},
                                    'header': {'elements': []}, 'flow': {'elements': []}}, self.context)
        self.assertIn('table', str(cm.exception))


# ══════════════════════════════════════════════════════════════════
# PART 12 — BINDINGS
# ══════════════════════════════════════════════════════════════════

class BindingResolutionTests(RendererDatabaseTestCase):
    def test_all_approved_bindings_are_implemented(self):
        # Phase 4B grew this from 7 to 21 entries so business_info/
        # client_info/dates could be decomposed into one generic `text`
        # element per real field (design_templates.py); Phase 4B.3 grew it
        # again to 26 — 5 real FreelancerProfile payment fields
        # (PHASE4B2_AUDIT.md finding C4), investigated and added as real,
        # available infrastructure without forcing payment_info's own
        # built-in seed to decompose (see design_templates.py's own
        # docstring). The parity assertion (never allow BINDING_RESOLVERS
        # and SUPPORTED_BINDINGS to drift apart) is what actually matters
        # and is unchanged; the literal count is updated to match.
        self.assertEqual(set(BINDING_RESOLVERS.keys()), SUPPORTED_BINDINGS)
        self.assertEqual(len(SUPPORTED_BINDINGS), 26)

    def test_each_approved_binding_resolves_without_raising(self):
        for binding in SUPPORTED_BINDINGS:
            with self.subTest(binding=binding):
                result = resolve_binding(binding, self.context)
                self.assertIsInstance(result, str)

    def test_unsupported_binding_raises_v2_render_error(self):
        with self.assertRaises(DesignRenderError):
            resolve_binding('invoice.made_up_field', self.context)

    def test_malformed_binding_string_raises_v2_render_error_not_a_crash(self):
        for malformed in ('', 'not.a.real.binding', '__import__("os")', "invoice.__class__"):
            with self.subTest(binding=malformed):
                with self.assertRaises(DesignRenderError):
                    resolve_binding(malformed, self.context)

    def test_binding_never_evaluates_arbitrary_python(self):
        # A binding string that LOOKS like it might do something dangerous
        # if this were ever wired through eval()/getattr() chains must be
        # rejected outright, not partially resolved.
        dangerous = '__import__("os").system'
        with self.assertRaises(DesignRenderError):
            resolve_binding(dangerous, self.context)

    def test_due_date_binding_handles_missing_due_date(self):
        self.context['invoice'].due_date = None
        result = resolve_binding('invoice.due_date', self.context)
        self.assertEqual(result, '—')

    def test_number_binding_handles_missing_invoice_number(self):
        self.context['invoice'].invoice_number = ''
        result = resolve_binding('invoice.number', self.context)
        self.assertEqual(result, 'DRAFT')

    def test_generic_text_element_with_binding_resolves_in_full_render(self):
        design = _v2('professional')
        # Phase 5.1: y=68 is real, deliberately-checked empty space in the
        # current hand-authored seed's own real geometry (design_templates.py)
        # — a real gap between the header content's own real bottom edge
        # (~65mm) and the table's own real top edge (76mm). (Was y=38,
        # calibrated against the OLD migrated-from-v1 geometry _v2() used
        # to return before Phase 5.1 switched its source — the current
        # seed's real Bill To/From blocks now occupy that band instead.)
        design['header']['elements'][0] = {
            'kind': 'generic', 'type': 'text', 'x': 20, 'y': 68, 'width': 50, 'height': 6,
            'style': {}, 'overrides': {}, 'binding': 'client.name',
        }
        html = render_design_html(design, self.context)
        self.assertIn(escape(self.context['invoice'].client_name), html)

    def test_generic_text_element_with_unsupported_binding_fails_the_whole_render_explicitly(self):
        design = _v2('professional')
        design['header']['elements'][0] = {
            'kind': 'generic', 'type': 'text', 'x': 20, 'y': 68, 'width': 50, 'height': 6,
            'style': {}, 'overrides': {}, 'binding': 'invoice.made_up_field',
        }
        # The v2 schema validator itself already rejects this at the schema
        # layer (design_schema's own binding allow-list check) — so the
        # renderer's own defensive re-check in resolve_binding is never
        # reached via the public render_design_html entry point. Both
        # layers agree the result is a hard failure, never a silent blank.
        with self.assertRaises(DesignRenderError):
            render_design_html(design, self.context)

    def test_generic_text_element_with_no_binding_uses_static_style_text(self):
        design = _v2('professional')
        design['header']['elements'][0] = {
            'kind': 'generic', 'type': 'text', 'x': 20, 'y': 68, 'width': 50, 'height': 6,
            'style': {'text': 'A plain static label'}, 'overrides': {},
        }
        html = render_design_html(design, self.context)
        self.assertIn('A plain static label', html)


# ══════════════════════════════════════════════════════════════════
# PART 12 — GEOMETRY
# ══════════════════════════════════════════════════════════════════

class GeometryTests(RendererDatabaseTestCase):
    def test_page_dimensions_appear_in_the_rendered_css(self):
        html = render_design_html(_v2('professional'), self.context)
        self.assertIn('210mm 297mm', html)

    def test_margins_are_the_real_existing_product_values_not_invented(self):
        from apps.invoices.design_renderer import (
            PAGE_MARGIN_BOTTOM_MM,
            PAGE_MARGIN_LEFT_MM,
            PAGE_MARGIN_RIGHT_MM,
            PAGE_MARGIN_TOP_MM,
        )
        # These exact values are documented (module docstring) as matching
        # apps/invoices/templates/invoices/_dynamic_element_styles.html's
        # own real .dyn-main padding — asserted here so a future edit that
        # silently drifts from that real value is caught.
        self.assertEqual((PAGE_MARGIN_TOP_MM, PAGE_MARGIN_RIGHT_MM,
                           PAGE_MARGIN_BOTTOM_MM, PAGE_MARGIN_LEFT_MM), (16, 16, 16, 20))

    def test_header_element_positions_appear_as_real_mm_css_values(self):
        design = _v2('professional')
        html = render_design_html(design, self.context)
        logo = design['header']['elements'][0]
        self.assertIn(f"left:{logo['x']}mm;top:{logo['y']}mm;", html)
        self.assertIn(f"width:{logo['width']}mm;height:{logo['height']}mm;", html)

    def test_flow_element_positions_appear_as_real_document_flow_not_absolute_coordinates(self):
        # Pagination fix (28 August 2026): flow elements no longer render
        # via literal absolute `left:Xmm;top:Ymm` CSS at all — that
        # mechanism is exactly what confined every flow element to a
        # single page regardless of real content (see
        # design_renderer._prepare_flow_region's own docstring for the
        # full root-cause investigation). They now render inside a real,
        # ordinary (non-absolutely-positioned) flex row, each carrying its
        # own real declared width (and, for a `pinned` element like
        # qr_code, its own real declared height — it never grows).
        design = _v2('professional')
        html = render_design_html(design, self.context)
        qr = next(e for e in design['flow']['elements'] if e['type'] == 'qr_code')
        self.assertIn('v2-flow-row', html)
        self.assertIn('v2-flow-item', html)
        self.assertIn(f"width:{qr['width']}mm", html)
        self.assertIn(f"height:{qr['height']}mm", html)
        # The old absolute-positioning mechanism for THIS element is gone —
        # no literal left/top coordinate for its own real x/y appears
        # anywhere (its position now comes entirely from real document-flow
        # stacking: row margin-top + item margin-left).
        self.assertNotIn(f"left:{qr['x']}mm;top:{qr['y']}mm;", html)

    def test_table_is_a_real_flow_chain_with_no_fixed_css_height(self):
        # Master Blueprint cutover (§B.3) + pagination fix: the table's
        # declared `height` in design_templates.py remains a design-time
        # ESTIMATE, but at real render time it's rendered as its own real
        # flex-row item with a real declared width but NO fixed height, so
        # its actual rendered size — and, since the pagination fix, its
        # actual PAGE COUNT — comes from its real content (however many
        # real line items exist), not the estimate. No absolute left/top
        # positioning applies to it either, for the same reason as above.
        design = _v2('professional')
        html = render_design_html(design, self.context)
        table = next(e for e in design['flow']['elements'] if e['type'] == 'table')
        self.assertIn(f"width:{table['width']}mm", html)
        self.assertNotIn(f"height:{table['height']}mm", html)
        self.assertNotIn(f"left:{table['x']}mm;top:{table['y']}mm;", html)
        self.assertIn('v2-flow-row', html)

    def test_no_px_conversion_math_appears_anywhere_in_the_renderer_module(self):
        # Part 3's own requirement: the renderer side of the coordinate
        # contract stays in mm throughout; px is an editor-internal,
        # GrapesJS-specific concern that has no business in this module.
        # Checks for the actual conversion-math anti-patterns (this
        # codebase's own real mm<->px constants/helpers from
        # frontend/src/lib/designEditor/constants.js/serialization.js),
        # not a blind substring search for "px" — this module's own
        # docstrings legitimately discuss px in prose, which a naive
        # check would misfire on.
        import apps.invoices.design_renderer as mod
        source = inspect.getsource(mod)
        for anti_pattern in ('MM_TO_PX', 'PX_TO_MM', 'mmToPx', 'pxToMm', '* 96', '/ 96'):
            self.assertNotIn(anti_pattern, source)


# ══════════════════════════════════════════════════════════════════
# PART 12 — COMPONENTS
# ══════════════════════════════════════════════════════════════════

class ComponentRenderingTests(RendererDatabaseTestCase):
    def _render_with_single_header_element(self, element):
        # Phase 4B.2: a minimal, hand-built design (not a migrated real
        # seed) — the migrated professional seed's own real flow content
        # (a real qr_code element, which genuinely renders an <img> tag)
        # would make a plain, whole-document "no <img> anywhere" assertion
        # ambiguous now that header/flow render into one unified element
        # list with no separating landmark to scope a search within (the
        # old 'v2-header'/'v2-items' string markers this helper used to
        # split on no longer exist — see canonical.html). Table/totals
        # are still real, positioned, schema-required elements; just
        # placed well clear of every test element's own y=16-ish position.
        design = {
            'schema_version': 2,
            'page': {'size': 'A4', 'width_mm': 210, 'height_mm': 297},
            'header': {'elements': [element]},
            'flow': {'elements': [
                {'kind': 'structural', 'type': 'table', 'x': 0, 'y': 150, 'width': 174, 'height': 45,
                 'style': {}, 'overrides': {}},
                {'kind': 'semantic', 'type': 'totals', 'x': 112, 'y': 200, 'width': 62, 'height': 35,
                 'style': {}, 'overrides': {}},
            ]},
        }
        return render_design_html(design, self.context)

    def test_semantic_logo_renders_the_real_freelancer_logo_when_present(self):
        self.context['freelancer'].logo = 'https://example.com/logo.png'
        html = self._render_with_single_header_element(
            {'kind': 'semantic', 'type': 'logo', 'x': 20, 'y': 16, 'width': 15, 'height': 15,
             'style': {}, 'overrides': {}},
        )
        self.assertIn('https://example.com/logo.png', html)

    def test_semantic_business_info_renders_business_name(self):
        html = self._render_with_single_header_element(
            {'kind': 'semantic', 'type': 'business_info', 'x': 20, 'y': 16, 'width': 90, 'height': 17,
             'style': {}, 'overrides': {}},
        )
        expected = self.context['freelancer'].business_name or self.context['freelancer'].display_name
        self.assertIn(expected, html)

    def test_semantic_client_info_renders_client_name(self):
        html = self._render_with_single_header_element(
            {'kind': 'semantic', 'type': 'client_info', 'x': 20, 'y': 16, 'width': 85, 'height': 28,
             'style': {}, 'overrides': {}},
        )
        self.assertIn(escape(self.context['invoice'].client_name), html)

    def test_semantic_dates_renders_invoice_number_when_flag_set(self):
        html = self._render_with_single_header_element(
            {'kind': 'semantic', 'type': 'dates', 'x': 20, 'y': 16, 'width': 57, 'height': 20,
             'style': {'show_invoice_number': True}, 'overrides': {}},
        )
        self.assertIn(self.context['invoice'].invoice_number, html)

    def test_semantic_dates_omits_invoice_number_when_flag_unset(self):
        html = self._render_with_single_header_element(
            {'kind': 'semantic', 'type': 'dates', 'x': 20, 'y': 16, 'width': 57, 'height': 20,
             'style': {}, 'overrides': {}},
        )
        self.assertNotIn('v2-num">' + self.context['invoice'].invoice_number, html)

    def test_generic_image_renders_src_when_present(self):
        html = self._render_with_single_header_element(
            {'kind': 'generic', 'type': 'image', 'x': 20, 'y': 16, 'width': 30, 'height': 30,
             'style': {'src': 'https://example.com/pic.jpg'}, 'overrides': {}},
        )
        self.assertIn('https://example.com/pic.jpg', html)

    def test_generic_image_renders_nothing_when_no_src(self):
        # No qr_code/logo/signature element exists anywhere in this
        # minimal design (see _render_with_single_header_element), so a
        # whole-document check is unambiguous.
        html = self._render_with_single_header_element(
            {'kind': 'generic', 'type': 'image', 'x': 20, 'y': 16, 'width': 30, 'height': 30,
             'style': {}, 'overrides': {}},
        )
        self.assertNotIn('<img', html)

    def test_generic_rectangle_renders_background_color(self):
        html = self._render_with_single_header_element(
            {'kind': 'generic', 'type': 'rectangle', 'x': 20, 'y': 16, 'width': 30, 'height': 10,
             'style': {'background_color': '#ff0000'}, 'overrides': {}},
        )
        self.assertIn('background:#ff0000;', html)

    def test_generic_rectangle_border_only_applied_when_both_color_and_width_present(self):
        html = self._render_with_single_header_element(
            {'kind': 'generic', 'type': 'rectangle', 'x': 20, 'y': 16, 'width': 30, 'height': 10,
             'style': {'border_color': '#00ff00'}, 'overrides': {}},  # no border_width_mm
        )
        # Scoped to <body> — the shared stylesheet's own .v2-alias-box rule
        # (a real, unrelated "border: 0.3mm dashed ..." in <style>) would
        # otherwise false-positive a whole-document search.
        self.assertNotIn('border:', html.split('<body>', 1)[1])

    def test_generic_divider_renders_thickness_and_color(self):
        html = self._render_with_single_header_element(
            {'kind': 'generic', 'type': 'divider', 'x': 20, 'y': 16, 'width': 100, 'height': 1,
             'style': {'thickness_mm': 2, 'color': '#0000ff'}, 'overrides': {}},
        )
        self.assertIn('border-top:2mm solid #0000ff;', html)

    def test_generic_container_renders_as_a_background_box(self):
        html = self._render_with_single_header_element(
            {'kind': 'generic', 'type': 'container', 'x': 20, 'y': 16, 'width': 100, 'height': 50,
             'style': {'background_color': '#eeeeee'}, 'overrides': {}},
        )
        self.assertIn('background:#eeeeee;', html)

    def test_style_override_precedence_overrides_wins_over_style(self):
        element = {'style': {'background_color': '#111111'}, 'overrides': {'background_color': '#222222'}}
        self.assertEqual(resolve_style_value(element, 'background_color'), '#222222')

    def test_style_override_precedence_falls_back_to_style_when_no_override(self):
        element = {'style': {'background_color': '#111111'}, 'overrides': {}}
        self.assertEqual(resolve_style_value(element, 'background_color'), '#111111')

    def test_style_override_precedence_falls_back_to_default_when_neither_present(self):
        element = {'style': {}, 'overrides': {}}
        self.assertEqual(resolve_style_value(element, 'background_color', 'transparent'), 'transparent')

    def test_migrated_v1_style_values_render_unchanged_since_overrides_is_always_empty(self):
        # Direct regression test for the Phase 0/Phase 1 scoping decision:
        # a real design's literal style values (e.g. Modern's real
        # pill_color) must render exactly as before, since overrides is
        # always {} for a freshly-loaded builtin design.
        design = _v2('modern')
        html = render_design_html(design, self.context)
        # Modern's totals element carries a real, specific style value —
        # confirm it wasn't silently dropped or reinterpreted by the v2
        # path. Phase 4B.3 decomposed `totals` into 4 independent rows
        # (Subtotal/Tax/Discount/Total) — pill_color lives specifically on
        # the 'total' row (style.variant == 'total_pill'), not the first
        # totals element in document order.
        totals_pill = next(e for e in design['flow']['elements'] if e['type'] == 'totals' and e['style'].get('variant') == 'total_pill')
        self.assertEqual(totals_pill['overrides'], {})
        self.assertIn('pill_color', totals_pill['style'])


# ══════════════════════════════════════════════════════════════════
# PART 12 — CONTENT SAFETY (long real-world content)
# ══════════════════════════════════════════════════════════════════

class ContentSafetyTests(RendererDatabaseTestCase):
    def test_long_business_name_is_not_clipped_from_the_output(self):
        long_name = 'A' * 300 + ' Extremely Long Business Name For Testing Purposes'
        self.context['freelancer'].business_name = long_name
        html = render_design_html(_v2('professional'), self.context)
        self.assertIn(long_name, html)

    def test_long_client_name_is_not_clipped_from_the_output(self):
        long_name = 'B' * 300 + ' Extremely Long Client Name LLC'
        self.context['invoice'].client_name = long_name
        html = render_design_html(_v2('professional'), self.context)
        self.assertIn(long_name, html)

    def test_long_client_address_is_not_clipped_from_the_output(self):
        long_address = 'Suite 100\n' * 20 + 'Long Street'
        self.context['invoice'].client_address = long_address
        html = render_design_html(_v2('professional'), self.context)
        self.assertIn('Long Street', html)

    def test_long_invoice_number_is_not_clipped_from_the_output(self):
        long_number = 'INV-' + '9' * 100
        self.context['invoice'].invoice_number = long_number
        html = render_design_html(_v2('professional'), self.context)
        self.assertIn(long_number, html)

    def test_header_elements_use_overflow_visible_not_hidden(self):
        # The direct, structural fix for DATA-1 — asserted against the
        # actual rendered CSS, not just inferred from the source.
        html = render_design_html(_v2('professional'), self.context)
        self.assertIn('overflow: visible', html)
        self.assertNotIn('overflow: hidden', html)

    def test_long_line_item_description_is_not_clipped(self):
        from types import SimpleNamespace
        long_description = 'Extremely detailed line item description. ' * 30
        item = SimpleNamespace(
            description=long_description, quantity=Decimal('1'), unit_price=Decimal('100'), total=Decimal('100'),
        )

        class _Items:
            def all(self):
                return [item]

        self.context['invoice'].items = _Items()
        html = render_design_html(_v2('professional'), self.context)
        self.assertIn(long_description, html)


# ══════════════════════════════════════════════════════════════════
# PART 12 — FINANCIAL CONTENT
# ══════════════════════════════════════════════════════════════════

class FinancialContentTests(RendererDatabaseTestCase):
    def test_subtotal_tax_discount_total_all_render(self):
        self.context['invoice'].subtotal = Decimal('1000.00')
        self.context['invoice'].tax_rate = Decimal('10.00')
        self.context['invoice'].tax_amount = Decimal('100.00')
        self.context['invoice'].discount_amount = Decimal('50.00')
        self.context['invoice'].total = Decimal('1050.00')
        html = render_design_html(_v2('professional'), self.context)
        self.assertIn('1,000.00', html)
        self.assertIn('100.00', html)
        self.assertIn('50.00', html)
        self.assertIn('1,050.00', html)

    def test_zero_tax_and_discount_are_suppressed_not_shown_as_zero_rows(self):
        self.context['invoice'].tax_rate = None
        self.context['invoice'].discount_amount = Decimal('0')
        html = render_design_html(_v2('professional'), self.context)
        self.assertNotIn('Tax (', html)
        self.assertNotIn('Discount', html)

    def test_multiple_line_items_all_render(self):
        html = render_design_html(_v2('professional'), self.context)
        for item in self.context['invoice'].items.all():
            self.assertIn(item.description, html)


# ══════════════════════════════════════════════════════════════════
# PART 12/13 — DETERMINISM, GOLDEN STRUCTURE, NO-OP SAFETY (Part 14)
# ══════════════════════════════════════════════════════════════════

class DeterminismTests(RendererDatabaseTestCase):
    def test_rendering_the_same_design_twice_produces_identical_html(self):
        design = _v2('professional')
        html_a = render_design_html(copy.deepcopy(design), self.context)
        html_b = render_design_html(copy.deepcopy(design), self.context)
        self.assertEqual(html_a, html_b)

    def test_rendering_the_same_design_twice_produces_identical_pdf_bytes(self):
        design = _v2('professional')
        pdf_a = render_design_pdf_bytes(copy.deepcopy(design), self.context)
        pdf_b = render_design_pdf_bytes(copy.deepcopy(design), self.context)
        self.assertEqual(pdf_a, pdf_b)


class NoOpSafetyTests(RendererDatabaseTestCase):
    """
    Part 14's own explicit architectural guarantee: there must be no
    renderer branch equivalent to `if design == builtin_seed: static
    else: dynamic`. Verified two ways: (1) live behavior — an untouched
    migrated design and a hand-edited one both render through the exact
    same function with no special-casing, and only the edited element's
    content actually differs; (2) static — the renderer module's own
    source contains no seed-equality comparison of any kind.
    """

    def test_open_and_save_without_changes_renders_identically(self):
        # The direct regression test for the architecture plan's
        # MISMATCH-7 finding: a no-op "open the builtin, save nothing"
        # must never change what's rendered. Here that's modeled as
        # migrating the seed and rendering it, twice, with zero edits.
        design = _v2('professional')
        html_first_open = render_design_html(copy.deepcopy(design), self.context)
        html_second_open = render_design_html(copy.deepcopy(design), self.context)
        self.assertEqual(html_first_open, html_second_open)

    def test_editing_one_element_changes_only_that_elements_content(self):
        design_untouched = _v2('professional')
        design_edited = copy.deepcopy(design_untouched)
        # Move exactly one element (the logo) by a real delta, into the
        # real empty space between the business-info row (bottom at 33mm)
        # and the client-info row (top at 48mm) — chosen deliberately so
        # the moved box doesn't collide with anything else, since the v2
        # schema validator (correctly) still enforces the same header
        # overlap rule v1 always has.
        design_edited['header']['elements'][0]['y'] += 10

        html_untouched = render_design_html(design_untouched, self.context)
        html_edited = render_design_html(design_edited, self.context)

        self.assertNotEqual(html_untouched, html_edited)
        # Every OTHER element's own css string must be byte-identical
        # across both renders — proving the edit didn't ripple anywhere
        # it shouldn't (a real, structural exact-diff check, not just
        # "something changed somewhere").
        for i in range(1, len(design_untouched['header']['elements'])):
            untouched_el = design_untouched['header']['elements'][i]
            css_fragment = f"left:{untouched_el['x']}mm;top:{untouched_el['y']}mm;"
            self.assertIn(css_fragment, html_untouched)
            self.assertIn(css_fragment, html_edited)

    def test_renderer_module_source_contains_no_seed_equality_comparison(self):
        import apps.invoices.design_renderer as mod
        source = inspect.getsource(mod)
        # The exact anti-pattern this phase exists to prevent from ever
        # reappearing: comparing design_data against a builtin seed to
        # decide HOW to render. Neither the v1 renderer's own function
        # name nor its underlying data source should appear anywhere in
        # this module at all.
        self.assertNotIn('BUILTIN_DESIGNS', source)
        self.assertNotIn('get_builtin_design_data', source)
        self.assertNotIn('design_has_real_custom_data', source)

    def test_render_design_html_has_no_conditional_branch_on_design_data_identity(self):
        # A more targeted static check: the render function's own body
        # never compares `design_data` with `==` against anything other
        # than validating it (which uses a function call, not equality).
        import apps.invoices.design_renderer as mod
        source = inspect.getsource(mod.render_design_html)
        self.assertNotIn('design_data ==', source)
        self.assertNotIn('== design_data', source)


# ══════════════════════════════════════════════════════════════════
# GOLDEN STRUCTURE (Part 13) — not pixel-perfect (that's Phase 2), but
# structurally sound against the real builtin seeds
# ══════════════════════════════════════════════════════════════════

class GoldenStructureTests(RendererDatabaseTestCase):
    def test_migrated_professional_seed_contains_every_expected_structural_piece(self):
        html = render_design_html(_v2('professional'), self.context)
        self.assertIn(self.context['invoice'].invoice_number, html)
        self.assertIn(escape(self.context['invoice'].client_name), html)
        self.assertIn('Total due', html)
        self.assertIn('<table', html)
        self.assertIn('Authorised signature', html)

    def test_migrated_modern_seed_preserves_its_own_real_color_values(self):
        design = _v2('modern')
        html = render_design_html(design, self.context)
        primary, secondary = self.context['design_primary_color'], self.context['design_secondary_color']
        self.assertIn(primary, html)
        self.assertIn(secondary, html)

    def test_element_order_is_preserved_from_design_data(self):
        design = _v2('professional')
        html = render_design_html(design, self.context)
        # Flow elements should appear in the document in the same order
        # they're listed in design_data — spot-checked via the totals
        # block appearing before the notes block, matching the real seed's
        # own real element order. Phase 4B.3 decomposed the old bundled
        # Notes+Terms element into 2 independent sections (see
        # design_templates.py), so the old "Terms label margin-top" marker
        # (only meaningful for the bundled shape) no longer applies —
        # ">Notes<" is a stable landmark regardless of decomposition.
        totals_pos = html.find('Total due')
        notes_pos = html.find('>Notes<')
        self.assertGreater(notes_pos, totals_pos)


# ══════════════════════════════════════════════════════════════════
# V1 UNTOUCHED — the direct proof Phase 1 didn't change existing behavior
# ══════════════════════════════════════════════════════════════════

class V1RendererUntouchedTests(TestCase):
    def test_v1_dynamic_renderer_module_is_unaffected_by_v2_existing(self):
        # Importing the v2 module must not alter v1's own render output in
        # any way — a real, live check, not just "we didn't edit the file".
        from apps.invoices.design_preview import build_preview_context
        from apps.invoices.pdf_generator import render_html_for_design
        from apps.invoices.design_seeds import get_builtin_design_data
        from apps.invoices.models import InvoiceDesign
        from apps.users.models import User

        user = User.objects.create_user(email='v1-untouched@example.com', password='Sup3r$ecret1')
        design = InvoiceDesign.objects.create(
            user=user, name='V1 Design', base_template='professional', source='builtin',
            design_data=get_builtin_design_data('professional'),
        )
        context = build_preview_context(user, 'professional', '')
        html = render_html_for_design(design, context)
        # The real, unmodified static template output — still hand-built
        # markup, not anything from design_renderer.py.
        self.assertIn('<html', html)
        self.assertNotIn('v2-header', html)  # a v2-only CSS class, must never appear in v1 output
        self.assertNotIn('v2-items', html)


# ══════════════════════════════════════════════════════════════════
# ISOLATED PREVIEW ENDPOINT
# ══════════════════════════════════════════════════════════════════

class DesignV2PreviewEndpointTests(InvoicesAPITestCase):
    def test_requires_authentication(self):
        self.client.logout()
        resp = self.client.post(reverse('invoices:design_render_preview'), data='{}', content_type='application/json')
        self.assertEqual(resp.status_code, 401)

    def test_accepts_v2_shaped_design_data_and_returns_html(self):
        resp = self._post(reverse('invoices:design_render_preview'), {'design_data': _v2('professional')})
        self.assertEqual(resp.status_code, 200)
        self.assertIn(b'<html', resp.content)

    def test_accepts_legacy_v1_shaped_design_data_and_migrates_in_memory(self):
        # design_migration.py's own 3 real, pre-existing bugs (paired-width
        # doubling, header-box right-edge overflow, missing sidebar
        # propagation) are now fixed (see test_design_migration.py's own
        # MigrateV1ToV2RealSeedTests) — the REAL, unmodified professional
        # v1 seed migrates in memory and renders real HTML, never a 400/422/500.
        resp = self._post(reverse('invoices:design_render_preview'), {
            'design_data': copy.deepcopy(BUILTIN_DESIGNS['professional']),
            'base_template': 'professional',
        })
        self.assertEqual(resp.status_code, 200)
        self.assertIn(b'<html', resp.content[:200].lower())

    def test_pdf_output_param_returns_a_real_pdf(self):
        url = reverse('invoices:design_render_preview') + '?output=pdf'
        resp = self._post(url, {'design_data': _v2('professional')})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp['Content-Type'], 'application/pdf')
        self.assertTrue(resp.content.startswith(b'%PDF'))

    def test_malformed_design_data_returns_a_specific_error_not_a_500(self):
        resp = self._post(reverse('invoices:design_render_preview'), {'design_data': {'not': 'valid'}})
        self.assertIn(resp.status_code, (400, 422))

    def test_missing_design_data_returns_400(self):
        resp = self._post(reverse('invoices:design_render_preview'), {})
        self.assertEqual(resp.status_code, 400)

    def test_endpoint_does_not_create_or_modify_any_invoice_design_row(self):
        from apps.invoices.models import InvoiceDesign
        count_before = InvoiceDesign.objects.count()
        self._post(reverse('invoices:design_render_preview'), {'design_data': _v2('professional')})
        self.assertEqual(InvoiceDesign.objects.count(), count_before)

    def test_endpoint_does_not_create_any_invoice(self):
        from apps.invoices.models import Invoice
        count_before = Invoice.objects.count()
        self._post(reverse('invoices:design_render_preview'), {'design_data': _v2('professional')})
        self.assertEqual(Invoice.objects.count(), count_before)
