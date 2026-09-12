# apps/invoices/tests/test_design_renderer_phase3_2.py
"""
Template Builder 2.0, Phase 3.2 — regression tests for the canonical
fidelity fixes made in response to LANCERAOS_TEMPLATE_BUILDER_2_PHASE3_1.md:

- Finding 1: style.font/font_size_pt/font_weight/color were never applied
  to header elements at all.
- Finding 2: .v2-content had no explicit page width in the on-screen HTML
  output.
- Finding 4: table.style's header/row color keys were never consumed by
  the canonical renderer.

Finding 3 (Minimal seed geometry) is deliberately NOT "fixed" here — see
LANCERAOS_TEMPLATE_BUILDER_2_PHASE3_2.md's own investigation: the original
y=42 value is correct; Phase 3.1's own measurement was itself contaminated
by an uncontrolled, externally-fetched logo image. No seed change, no new
test needed beyond what test_design_templates_golden.py already covers
(and which continues to pass unchanged).

Nothing in this file touches a real Invoice row, a real InvoiceDesign row,
or any v1 render/editor path.
"""
from django.test import TestCase

from apps.invoices.design_renderer import (
    build_render_context,
    render_design_html,
    row_cell_css,
    thead_cell_css,
)
from apps.invoices.design_templates import get_builtin_design_data
from apps.users.models import User


class RendererDatabaseTestCase(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(email='phase3-2-fixes@example.com', password='Sup3r$ecret1')


# ══════════════════════════════════════════════════════════════════
# FINDING 1 — FONT APPLICATION
# ══════════════════════════════════════════════════════════════════

class FontApplicationTests(RendererDatabaseTestCase):
    def test_professional_business_name_gets_its_real_serif_font(self):
        context = build_render_context(self.user, 'professional', '')
        html = render_design_html(get_builtin_design_data('professional'), context)
        # The business_info element's own wrapping div must carry the
        # real font-family from its own style.font, not fall through to
        # the generic body font. Django's autoescape renders the CSS
        # string's single quotes as &#x27; — a real, valid HTML entity a
        # browser resolves back to ' when parsing (confirmed directly via
        # this phase's own live browser verification), so the assertion
        # checks for the escaped form actually present in the response.
        self.assertIn('font-family:&#x27;Source Serif 4&#x27;;', html)
        self.assertIn('font-size:21pt;', html)

    def test_professional_and_minimal_bizname_get_their_own_real_font_size(self):
        """
        Follow-up to the .v2-num CSS-specificity fix: the identical
        conflict exists for .v2-bizname (its own class rule hardcodes
        font-size:18pt, always winning over an ancestor's inherited
        value) — found via a real live-browser check showing Minimal's
        masthead still at the generic 18pt after the wrapper-level fix
        alone. Professional's real value is 21pt, Minimal's is 19pt —
        genuinely different, so a shared class default can never satisfy
        both.

        Phase 4B: business_info's masthead instance no longer exists in
        either seed (decomposed into a generic `text` element bound to
        `business.name` — see design_templates.py's own module docstring),
        so there is no more dedicated `.v2-bizname` class to check — the
        font-size now applies via prepare_header_element's own generic
        `font_size_pt` CSS (same mechanism this test's own sibling
        `.v2-num` fix already established), directly on the element's
        `.v2-header-el` wrapper. `font-size:21pt`/`19pt` are each unique
        to exactly one element in their respective seed (the masthead
        business.name binding — every other font_size_pt in either seed
        is a different real value), so a substring check remains a real,
        specific, non-coincidental assertion.
        """
        ctx_professional = build_render_context(self.user, 'professional', '')
        html_professional = render_design_html(get_builtin_design_data('professional'), ctx_professional)
        self.assertIn('font-size:21pt;', html_professional)

        ctx_minimal = build_render_context(self.user, 'minimal', '')
        html_minimal = render_design_html(get_builtin_design_data('minimal'), ctx_minimal)
        self.assertIn('font-size:19pt;', html_minimal)

    def test_modern_masthead_gets_its_real_font_and_weight(self):
        context = build_render_context(self.user, 'modern', '')
        html = render_design_html(get_builtin_design_data('modern'), context)
        self.assertIn('font-family:&#x27;Space Grotesk&#x27;;', html)
        # font_weight is applied on the wrapping .v2-header-el (Finding 1's
        # own new resolve_style_value(element, 'font_weight') call).
        self.assertIn('font-weight:700;', html)
        # font_size_pt is applied directly on the inner .v2-num div (the
        # CSS-specificity follow-up fix — see _v2_element_content.html).
        self.assertIn('font-size:22pt;', html)

    def test_minimal_invoice_number_gets_its_real_smaller_font_size(self):
        context = build_render_context(self.user, 'minimal', '')
        html = render_design_html(get_builtin_design_data('minimal'), context)
        self.assertIn('font-size:10pt;', html)

    def test_professional_logo_gets_its_real_border_radius(self):
        """
        Found during this same Finding-1 investigation — the identical
        class of bug (a real v1 convention, `_zone1_element_css`'s
        border_radius_mm handling, never ported to V2). Applied to the
        <img> itself, not the wrapper (see _v2_element_content.html's own
        comment on why overflow:visible makes the wrapper the wrong place).
        """
        import copy

        design_data = copy.deepcopy(get_builtin_design_data('professional'))
        self.user.profile.logo = 'https://example.com/logo.png'
        self.user.profile.save(update_fields=['logo'])
        context = build_render_context(self.user, 'professional', '')
        html = render_design_html(design_data, context)
        self.assertIn('border-radius:2.5mm;', html)

    def test_no_template_name_branching_was_introduced(self):
        """Structural guard: the fix must be fully generic."""
        import inspect

        from apps.invoices import design_renderer

        source = inspect.getsource(design_renderer.prepare_element)
        for forbidden in ("== 'professional'", "== 'minimal'", "== 'modern'"):
            self.assertNotIn(forbidden, source)


# ══════════════════════════════════════════════════════════════════
# FINDING 2 — CONTENT WIDTH
# ══════════════════════════════════════════════════════════════════

class ContentWidthTests(RendererDatabaseTestCase):
    # 09 September 2026 footer fix (see design_templates.py's own entry) —
    # the real Professional builtin now carries `page.footer: {}`, so
    # `.v2-content`'s own min-height genuinely shrinks by
    # FOOTER_MARGIN_BOX_HEIGHT_MM (16mm) to reserve real page space for the
    # footer margin box: 297mm -> 281mm. These 3 tests assert against
    # get_builtin_design_data('professional') directly, so this is the one
    # real, correct behavior change flowing through them, not a
    # coincidental breakage — updated to the new real value rather than
    # stripping the footer back out of the fixture under test.
    def test_v2_content_has_an_explicit_width_matching_the_page(self):
        context = build_render_context(self.user, 'professional', '')
        html = render_design_html(get_builtin_design_data('professional'), context)
        self.assertIn('width:210mm;min-height:281mm;padding:', html)

    def test_content_width_is_derived_from_real_page_dimensions_not_hardcoded(self):
        """A different page width_mm must flow straight through to .v2-content's own width."""
        import copy

        design_data = copy.deepcopy(get_builtin_design_data('professional'))
        design_data['page']['width_mm'] = 250
        context = build_render_context(self.user, 'professional', '')
        html = render_design_html(design_data, context)
        self.assertIn('width:250mm;min-height:281mm;padding:', html)

    def test_right_aligned_totals_box_pushes_to_the_true_right_edge_regardless_of_container(self):
        """
        The original regression this protected against (a right-aligned,
        width-constrained flow box positioned via `margin-left:auto`,
        computed relative to whatever width `.v2-content` resolved to) no
        longer applies structurally, for a second reason as of the
        pagination fix (28 August 2026): totals rows are `layout_mode:
        'flow'` and render inside a real document-flow row (see
        design_renderer._prepare_flow_region), never via a computed
        `margin-left:auto` OR a literal absolute `left`. This test now
        verifies the successor guarantee — the totals box's own real,
        explicit declared `width` (from design_data, not computed) appears
        verbatim, alongside `.v2-content`'s own explicit width, proving
        both share one deterministic mm coordinate space, and that
        right-alignment (`text-align:right`) is still applied regardless
        of how the box itself is positioned.
        """
        design = get_builtin_design_data('professional')
        totals = next(e for e in design['flow']['elements'] if e['type'] == 'totals')
        context = build_render_context(self.user, 'professional', '')
        html = render_design_html(design, context)
        self.assertIn('width:210mm;min-height:281mm;padding:', html)
        self.assertIn(f"width:{totals['width']}mm", html)
        self.assertIn('text-align:right;', html)


# ══════════════════════════════════════════════════════════════════
# FINDING 4 — TABLE HEADER/ROW COLORS
# ══════════════════════════════════════════════════════════════════

class TableColorTests(RendererDatabaseTestCase):
    def test_professional_table_header_shows_its_real_amber_border(self):
        context = build_render_context(self.user, 'professional', '')
        html = render_design_html(get_builtin_design_data('professional'), context)
        self.assertIn('#a8813c', html)  # real header_border_color from the seed
        self.assertIn('border-bottom:0.5mm solid #a8813c', html)

    def test_professional_table_rows_show_their_real_border_color(self):
        context = build_render_context(self.user, 'professional', '')
        html = render_design_html(get_builtin_design_data('professional'), context)
        self.assertIn('border-bottom:0.25mm solid #e5e1d6;', html)

    def test_modern_table_header_shows_its_real_background_and_text_color(self):
        context = build_render_context(self.user, 'modern', '')
        html = render_design_html(get_builtin_design_data('modern'), context)
        self.assertIn('background:#2d2a6e', html)
        self.assertIn('color:#ffffff', html)

    def test_modern_totals_pill_still_shows_its_real_default_color_end_to_end(self):
        # Phase 6 zero-regression check: Modern's real, unedited, default-
        # variant design must still render byte-identically to before this
        # fix — the seed's own pill_color literal became a 'theme_secondary'
        # sentinel, but resolving it for the DEFAULT variant must produce
        # the exact same real hex the static template/pre-fix seed used.
        context = build_render_context(self.user, 'modern', '')
        html = render_design_html(get_builtin_design_data('modern'), context)
        self.assertIn('background:#d4e157', html)

    def test_all_nine_real_variants_render_table_colors_without_error(self):
        from apps.invoices.design_seeds import COLOR_VARIANTS
        from apps.invoices.design_templates import BUILTIN_DESIGNS

        count = 0
        for template in BUILTIN_DESIGNS:
            for variant in COLOR_VARIANTS[template]:
                context = build_render_context(self.user, template, variant['key'])
                html = render_design_html(get_builtin_design_data(template), context)
                self.assertIn('<table', html)
                count += 1
        self.assertEqual(count, 9)

    def test_thead_and_row_cell_css_are_generic_functions_not_hardcoded_per_template(self):
        # Phase 4B.2: the table's own style dict now lives on the real
        # table element within flow.elements (kind='structural',
        # type='table') — no more special flow.table key.
        #
        # Phase 6 (style/theme cascade) update: thead_cell_css/row_cell_css
        # now require a real `context` (to resolve the 'theme_primary'/
        # 'theme_secondary' sentinels Professional's/Minimal's own real
        # seed values now use — see design_templates.py's own comments on
        # this exact change). Each template's own DEFAULT-variant context
        # is used here so the resolved hex values are unchanged from
        # before this fix — this test still verifies the same real
        # per-template distinctness, just via the now-real resolution path
        # rather than a literal already baked into the style dict.
        def _table_style(base_template):
            design = get_builtin_design_data(base_template)
            table = next(e for e in design['flow']['elements'] if e['type'] == 'table')
            return table['style']

        professional_style = _table_style('professional')
        minimal_style = _table_style('minimal')
        professional_context = build_render_context(self.user, 'professional', '')
        minimal_context = build_render_context(self.user, 'minimal', '')
        self.assertNotEqual(
            thead_cell_css(professional_style, professional_context),
            thead_cell_css(minimal_style, minimal_context),
        )
        self.assertIn('#a8813c', thead_cell_css(professional_style, professional_context))
        self.assertIn('#171614', thead_cell_css(minimal_style, minimal_context))
        self.assertNotEqual(
            row_cell_css(professional_style, professional_context),
            row_cell_css(minimal_style, minimal_context),
        )

    def test_empty_table_style_produces_empty_css_not_an_error(self):
        context = build_render_context(self.user, 'professional', '')
        self.assertEqual(thead_cell_css({}, context), '')
        self.assertEqual(row_cell_css({}, context), '')

    def test_table_header_border_color_actually_changes_on_a_non_default_variant(self):
        # Phase 6 — the architecture plan's own named TB-001 regression
        # case ("edit a design, select a non-default variant, assert
        # every themed color actually changes"), applied to the real,
        # confirmed instance found in this pass: Professional's table
        # header border color was a literal '#a8813c' (its own DEFAULT
        # variant's primary color) until this fix — proving it now tracks
        # a real, non-default variant instead of staying frozen.
        table_style = next(
            e for e in get_builtin_design_data('professional')['flow']['elements'] if e['type'] == 'table'
        )['style']
        default_context = build_render_context(self.user, 'professional', '')
        forest_context = build_render_context(self.user, 'professional', 'forest')
        default_css = thead_cell_css(table_style, default_context)
        forest_css = thead_cell_css(table_style, forest_context)
        self.assertIn('#a8813c', default_css)
        self.assertIn('#4a7c59', forest_css)  # professional/forest's real primary color
        self.assertNotEqual(default_css, forest_css)

# CanvasInheritsCanonicalFixesTests (Part 6 — "the canvas must inherit
# these fixes with zero canvas-only special-casing") removed: it tested
# design_canvas.py's build_canvas_document exclusively, which was removed
# along with the GrapesJS editor it served (see DECISIONS.md's removal
# entry) — there is no canvas adapter left for these fixes to need to
# stay in sync with.
