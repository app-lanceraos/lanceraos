# apps/invoices/tests/test_design_phase3a_extensions.py
"""
Phase 3a (07 September 2026, editor capability parity) — schema and
canonical-renderer coverage for the 5 additive design_data capabilities
this phase introduced, closing gaps found while adapting the standalone
invoice-editor project onto the production schema (see CLAUDE.md's own
07 September 2026 entries and DECISIONS.md for the full before/after):

  1. Font theming (design_data.theme + the 'theme_heading_font'/
     'theme_body_font' sentinels on style.font/style.font_weight).
  2. Rectangle/container corner radius (style.border_radius_mm).
  3. Table styling — per-column alignment (style.column_alignments),
     alternating-row shading (style.zebra_enabled/zebra_color), and
     configurable cell padding (style.cell_padding_mm).
  4. Image border + corner radius (style.border_color/border_width_mm/
     border_radius_mm).
  5. Two new bindings — invoice.client_currency_conversion and
     invoice.tax_rate.

Every case here was checked against a real WeasyPrint render (not just
schema validation) before being written down as a permanent test — see
this module's own RENDERER test classes below.
"""
import copy
from types import SimpleNamespace

from django.test import SimpleTestCase

from apps.invoices.design_renderer import (
    BINDING_RESOLVERS,
    build_render_context,
    prepare_element,
    render_design_html,
    render_design_pdf_bytes,
    resolve_table_columns,
    row_cell_css,
    thead_cell_css,
)
from apps.invoices.design_schema import SUPPORTED_BINDINGS, validate_design_data_schema_v2
from apps.invoices.tests.test_views import InvoicesAPITestCase

MINIMAL_TABLE = {'kind': 'structural', 'type': 'table', 'x': 0, 'y': 100, 'width': 174, 'height': 30, 'style': {}, 'overrides': {}}
MINIMAL_TOTALS = {'kind': 'semantic', 'type': 'totals', 'x': 0, 'y': 140, 'width': 174, 'height': 20, 'style': {}, 'overrides': {}}


def base_design():
    return {
        'schema_version': 2,
        'page': {'size': 'A4', 'width_mm': 210, 'height_mm': 297},
        'header': {'elements': []},
        'flow': {'elements': [copy.deepcopy(MINIMAL_TABLE), copy.deepcopy(MINIMAL_TOTALS)]},
    }


def _context_with_theme(context, design_data):
    """
    The exact theme->context injection render_design_html itself performs
    (see design_renderer.py's own render_design_html docstring/body) —
    duplicated here (not the module under test) purely so
    ThemeFontRendersInHtmlTests can call prepare_element directly and
    inspect its pre-HTML-escaping `css` string, without going through a
    real Django template's auto-escaping. This used to go through
    design_canvas.py's build_canvas_document instead, which performed the
    identical injection for the same reason; that module was removed
    along with the GrapesJS editor it served (see DECISIONS.md's removal
    entry) — prepare_element itself is untouched and still exactly what
    render_design_html calls per element.
    """
    theme = design_data.get('theme') or {}
    return {
        **context,
        'theme_heading_font_family': theme.get('heading_font_family'),
        'theme_heading_font_weight': theme.get('heading_font_weight'),
        'theme_body_font_family': theme.get('body_font_family'),
        'theme_body_font_weight': theme.get('body_font_weight'),
    }


# ══════════════════════════════════════════════════════════════════
# FONT THEMING — schema validation
# ══════════════════════════════════════════════════════════════════

class ThemeSchemaTests(SimpleTestCase):
    def test_theme_absent_is_valid(self):
        self.assertEqual(validate_design_data_schema_v2(base_design()), [])

    def test_empty_theme_object_is_valid(self):
        d = base_design()
        d['theme'] = {}
        self.assertEqual(validate_design_data_schema_v2(d), [])

    def test_valid_theme_is_accepted(self):
        d = base_design()
        d['theme'] = {
            'heading_font_family': 'Space Grotesk', 'heading_font_weight': 700,
            'body_font_family': 'IBM Plex Sans', 'body_font_weight': 400,
        }
        self.assertEqual(validate_design_data_schema_v2(d), [])

    def test_theme_non_object_rejected(self):
        d = base_design()
        d['theme'] = 'not an object'
        errors = validate_design_data_schema_v2(d)
        self.assertTrue(any('design_data.theme, if present, must be an object' in e for e in errors), errors)

    def test_theme_empty_string_family_rejected(self):
        d = base_design()
        d['theme'] = {'heading_font_family': ''}
        errors = validate_design_data_schema_v2(d)
        self.assertTrue(any('heading_font_family' in e for e in errors), errors)

    def test_theme_non_numeric_weight_rejected(self):
        d = base_design()
        d['theme'] = {'body_font_weight': 'bold'}
        errors = validate_design_data_schema_v2(d)
        self.assertTrue(any('body_font_weight' in e for e in errors), errors)


class ThemeFontRendersInHtmlTests(InvoicesAPITestCase):
    """
    Calls prepare_element directly rather than inspecting the final
    rendered HTML string: canonical.html renders `el.css` through Django's
    default auto-escaping (`{{ el.css }}`, no `|safe`), which HTML-entity-
    encodes the literal single quotes a `font-family:'X'` declaration
    carries (browsers decode this back to a real quote before CSS parsing
    — this is not a bug, just why a raw-HTML substring match on a quoted
    value is the wrong tool). prepare_element's own `css` field is the
    pre-escaping string — the exact same function render_design_html
    itself calls per element, just invoked here directly (with the same
    theme->context injection render_design_html performs, replicated in
    _context_with_theme above) so the test can see it before templating.
    """

    def test_theme_heading_font_sentinel_resolves_to_the_real_theme_value(self):
        context = build_render_context(self.user, 'professional', '')
        d = base_design()
        d['theme'] = {'heading_font_family': 'Space Grotesk', 'heading_font_weight': 800}
        element = {
            'kind': 'generic', 'type': 'text', 'x': 0, 'y': 0, 'width': 50, 'height': 10,
            'style': {'text': 'Hello', 'font': 'theme_heading_font', 'font_weight': 'theme_heading_font'},
            'overrides': {}, 'binding': None,
        }
        el = prepare_element(element, _context_with_theme(context, d))
        self.assertIn("font-family:'Space Grotesk'", el['css'])
        self.assertIn('font-weight:800', el['css'])

    def test_missing_theme_means_the_sentinel_resolves_to_nothing(self):
        context = build_render_context(self.user, 'professional', '')
        d = base_design()
        element = {
            'kind': 'generic', 'type': 'text', 'x': 0, 'y': 0, 'width': 50, 'height': 10,
            'style': {'text': 'Hello', 'font': 'theme_body_font'},
            'overrides': {}, 'binding': None,
        }
        el = prepare_element(element, _context_with_theme(context, d))
        # No design_data.theme at all -> the sentinel resolves to None ->
        # no font-family declared for this element (falls back to the
        # body's own default, exactly like every pre-existing design).
        self.assertNotIn('font-family', el['css'])

    def test_literal_font_value_is_unaffected_by_theme_resolution(self):
        # A no-op guarantee: an element using a real, literal font name
        # (every existing design) must render identically whether or not
        # design_data.theme is present.
        context = build_render_context(self.user, 'professional', '')
        d = base_design()
        d['theme'] = {'heading_font_family': 'Space Grotesk'}
        element = {
            'kind': 'generic', 'type': 'text', 'x': 0, 'y': 0, 'width': 50, 'height': 10,
            'style': {'text': 'Hello', 'font': 'IBM Plex Mono'},
            'overrides': {}, 'binding': None,
        }
        el = prepare_element(element, _context_with_theme(context, d))
        self.assertIn("font-family:'IBM Plex Mono'", el['css'])


# ══════════════════════════════════════════════════════════════════
# RECTANGLE / CONTAINER CORNER RADIUS
# ══════════════════════════════════════════════════════════════════

class RectangleBorderRadiusRendersTests(InvoicesAPITestCase):
    def test_rectangle_border_radius_mm_emits_real_css(self):
        context = build_render_context(self.user, 'professional', '')
        d = base_design()
        d['header']['elements'].append({
            'kind': 'generic', 'type': 'rectangle', 'x': 0, 'y': 0, 'width': 30, 'height': 15,
            'style': {'background_color': '#123456', 'border_radius_mm': 3}, 'overrides': {},
        })
        html = render_design_html(d, context, for_pdf=True)
        self.assertIn('border-radius:3mm', html)

    def test_rectangle_with_no_border_radius_emits_none(self):
        # Scoped to THIS element's own shape_css (via prepare_element
        # directly) rather than the full rendered document — the shared
        # stylesheet (_page_styles.html) already has its own unrelated
        # `border-radius: 3mm;` rule (.v2-total-pill), so a whole-document
        # substring check would false-positive on that pre-existing,
        # unrelated CSS.
        context = build_render_context(self.user, 'professional', '')
        element = {
            'kind': 'generic', 'type': 'rectangle', 'x': 0, 'y': 0, 'width': 30, 'height': 15,
            'style': {'background_color': '#123456'}, 'overrides': {},
        }
        prepared = prepare_element(element, context)
        self.assertNotIn('border-radius', prepared['shape_css'])

    def test_ellipse_forced_50pct_radius_still_wins_over_a_stray_border_radius_mm(self):
        context = build_render_context(self.user, 'professional', '')
        d = base_design()
        d['header']['elements'].append({
            'kind': 'generic', 'type': 'ellipse', 'x': 0, 'y': 0, 'width': 30, 'height': 15,
            'style': {'background_color': '#123456', 'border_radius_mm': 3}, 'overrides': {},
        })
        html = render_design_html(d, context, for_pdf=True)
        self.assertIn('border-radius:50%', html)
        # The forced ellipse rule is declared AFTER border_radius_mm's own
        # CSS in the same style string, so it is the one that wins under
        # CSS's "last declaration of the same property" rule.
        radius_3mm_index = html.find('border-radius:3mm')
        radius_50pct_index = html.find('border-radius:50%')
        self.assertGreater(radius_50pct_index, radius_3mm_index)


# ══════════════════════════════════════════════════════════════════
# TABLE STYLING — per-column alignment
# ══════════════════════════════════════════════════════════════════

class TableColumnAlignmentTests(SimpleTestCase):
    def test_no_column_alignments_means_every_column_align_is_none(self):
        columns = resolve_table_columns({})
        self.assertTrue(all(c['align'] is None for c in columns))

    def test_column_alignments_shorter_than_columns_cycles(self):
        columns = resolve_table_columns({'column_alignments': ['center', 'left']})
        self.assertEqual([c['align'] for c in columns], ['center', 'left', 'center', 'left'])

    def test_column_alignments_longer_than_columns_uses_only_the_needed_prefix(self):
        columns = resolve_table_columns({
            'columns': ['description', 'total'],
            'column_alignments': ['right', 'center', 'left', 'left', 'left'],
        })
        self.assertEqual([c['key'] for c in columns], ['description', 'total'])
        self.assertEqual([c['align'] for c in columns], ['right', 'center'])

    def test_empty_column_alignments_list_behaves_like_absent(self):
        columns = resolve_table_columns({'column_alignments': []})
        self.assertTrue(all(c['align'] is None for c in columns))


class TableColumnAlignmentRendersTests(InvoicesAPITestCase):
    def test_column_align_emits_inline_text_align_on_th_and_td(self):
        context = build_render_context(self.user, 'professional', '')
        d = base_design()
        d['flow']['elements'][0]['style'] = {
            'columns': ['description', 'quantity'],
            'column_alignments': ['center', 'left'],
        }
        html = render_design_html(d, context, for_pdf=True)
        self.assertIn('text-align:center', html)
        self.assertIn('text-align:left', html)

    def test_no_column_alignments_leaves_existing_class_driven_default_unchanged(self):
        context = build_render_context(self.user, 'professional', '')
        html = render_design_html(base_design(), context, for_pdf=True)
        # No inline text-align override anywhere near the table head/rows
        # -> the pre-existing .v2-num-col CSS class rule is the only thing
        # deciding alignment, exactly as before this phase.
        self.assertNotIn('text-align:center', html)


# ══════════════════════════════════════════════════════════════════
# TABLE STYLING — alternating-row shading + cell padding
# ══════════════════════════════════════════════════════════════════

class TableZebraAndPaddingTests(InvoicesAPITestCase):
    def _design_with_items(self, table_style):
        # build_render_context's own sample invoice (design_preview.
        # _build_sample_invoice) already carries 3 real SAMPLE_ITEMS via
        # its duck-typed _ItemsManager — reused directly rather than
        # creating real InvoiceItem rows this SimpleTestCase-adjacent
        # sample invoice can't actually accept (`.items` has no `.create`,
        # only `.all()`, by design — see design_preview.py's own
        # docstring: no database writes happen anywhere in that module).
        context = build_render_context(self.user, 'professional', '')
        d = base_design()
        d['flow']['elements'][0]['style'] = table_style
        return context, d

    def test_zebra_disabled_emits_no_row_background(self):
        context, d = self._design_with_items({})
        html = render_design_html(d, context, for_pdf=True)
        self.assertNotIn('background:#f5f3ee', html)

    def test_zebra_enabled_shades_alternate_rows(self):
        context, d = self._design_with_items({'zebra_enabled': True, 'zebra_color': '#eeeeee'})
        html = render_design_html(d, context, for_pdf=True)
        self.assertIn('background:#eeeeee', html)
        # 3 real rows, alternating starting with "" on row 1 -> exactly
        # one shaded row (row 2) out of the 3 — but `row_bg` is applied
        # per-CELL (each of the 4 default columns gets its own `<td>`
        # style), not once per `<tr>`, so the real occurrence count is
        # 1 row * 4 columns = 4, not 1.
        self.assertEqual(html.count('background:#eeeeee'), 4)

    def test_zebra_default_color_is_used_when_zebra_color_omitted(self):
        context, d = self._design_with_items({'zebra_enabled': True})
        html = render_design_html(d, context, for_pdf=True)
        self.assertIn('background:#f5f3ee', html)

    def test_cell_padding_mm_applied_to_head_and_row_cells(self):
        context, d = self._design_with_items({'cell_padding_mm': 5})
        html = render_design_html(d, context, for_pdf=True)
        self.assertIn('padding:5mm', html)

    def test_no_cell_padding_mm_emits_no_padding_override(self):
        context, d = self._design_with_items({})
        html = render_design_html(d, context, for_pdf=True)
        self.assertNotIn('padding:', html.split('<table', 1)[1].split('</table>', 1)[0])


class TableCellCssFunctionsTests(SimpleTestCase):
    def test_thead_cell_css_with_padding(self):
        # cell_padding_mm is thead_cell_css/row_cell_css's own explicit
        # 3rd parameter (the real call site, prepare_element, extracts it
        # from table_style itself before calling) — not a table_style dict
        # key these functions read internally.
        css = thead_cell_css({}, {}, 4)
        self.assertIn('padding:4mm', css)

    def test_row_cell_css_with_padding_and_border(self):
        css = row_cell_css({'row_border_color': '#e5e1d6'}, {}, 4)
        self.assertIn('padding:4mm', css)
        self.assertIn('border-bottom:0.25mm solid #e5e1d6', css)

    def test_row_cell_css_matches_original_output_when_padding_absent(self):
        # Byte-for-byte no-op guarantee for every existing design.
        css = row_cell_css({'row_border_color': '#e5e1d6'}, {})
        self.assertEqual(css, 'border-bottom:0.25mm solid #e5e1d6;')

    def test_row_cell_css_empty_when_nothing_set(self):
        self.assertEqual(row_cell_css({}, {}), '')


# ══════════════════════════════════════════════════════════════════
# IMAGE BORDER + CORNER RADIUS
# ══════════════════════════════════════════════════════════════════

class ImageBorderAndRadiusRendersTests(InvoicesAPITestCase):
    def test_uncropped_image_gets_border_and_radius_inline(self):
        context = build_render_context(self.user, 'professional', '')
        d = base_design()
        d['header']['elements'].append({
            'kind': 'generic', 'type': 'image', 'x': 10, 'y': 10, 'width': 40, 'height': 40,
            'style': {'src': 'data:image/png;base64,x', 'border_color': '#000000', 'border_width_mm': 0.5, 'border_radius_mm': 2},
            'overrides': {},
        })
        html = render_design_html(d, context, for_pdf=True)
        self.assertIn('border:0.5mm solid #000000', html)
        self.assertIn('border-radius:2mm', html)
        self.assertIn('object-fit:contain', html)

    def test_cropped_image_gets_border_and_radius_on_the_overflow_hidden_wrapper(self):
        context = build_render_context(self.user, 'professional', '')
        d = base_design()
        d['header']['elements'].append({
            'kind': 'generic', 'type': 'image', 'x': 10, 'y': 10, 'width': 40, 'height': 40,
            'style': {'src': 'data:image/png;base64,x', 'border_radius_mm': 2},
            'crop': {'x': 0, 'y': 0, 'width': 0.5, 'height': 0.5}, 'overrides': {},
        })
        html = render_design_html(d, context, for_pdf=True)
        wrapper_start = html.index('overflow:hidden')
        wrapper_style_segment = html[wrapper_start:wrapper_start + 200]
        self.assertIn('border-radius:2mm', wrapper_style_segment)

    def test_image_with_no_border_or_radius_is_unchanged(self):
        # Scoped to THIS element's own image_frame_css (via prepare_element
        # directly) — the shared stylesheet already has its own unrelated
        # `border-radius: 3mm;` rule (.v2-total-pill), so a whole-document
        # substring check would false-positive on that pre-existing CSS.
        context = build_render_context(self.user, 'professional', '')
        element = {
            'kind': 'generic', 'type': 'image', 'x': 10, 'y': 10, 'width': 40, 'height': 40,
            'style': {'src': 'data:image/png;base64,x'}, 'overrides': {},
        }
        prepared = prepare_element(element, context)
        self.assertEqual(prepared['image_frame_css'], '')


# ══════════════════════════════════════════════════════════════════
# NEW BINDINGS — invoice.client_currency_conversion / invoice.tax_rate
# ══════════════════════════════════════════════════════════════════

class NewBindingResolverTests(SimpleTestCase):
    def test_both_new_bindings_are_in_the_supported_allow_list(self):
        self.assertIn('invoice.client_currency_conversion', SUPPORTED_BINDINGS)
        self.assertIn('invoice.tax_rate', SUPPORTED_BINDINGS)

    def test_every_supported_binding_has_a_real_resolver(self):
        # The same drift-prevention guarantee test_design_renderer.py's
        # own BindingResolversMatchAllowListTests already establishes for
        # the original 7 — re-verified here for the 2 new entries too.
        self.assertEqual(set(BINDING_RESOLVERS.keys()), SUPPORTED_BINDINGS)

    def test_client_currency_conversion_formats_the_real_dict(self):
        ctx = {'invoice': SimpleNamespace(client_currency_conversion={
            'currency': 'PKR', 'symbol': 'Rs.', 'converted_total': 27850.00, 'rate': 278.5,
        })}
        result = BINDING_RESOLVERS['invoice.client_currency_conversion'](ctx)
        self.assertEqual(result, '≈ Rs.27,850.00 at rate 278.5')

    def test_client_currency_conversion_none_resolves_to_empty_string(self):
        ctx = {'invoice': SimpleNamespace(client_currency_conversion=None)}
        result = BINDING_RESOLVERS['invoice.client_currency_conversion'](ctx)
        self.assertEqual(result, '')

    def test_tax_rate_formats_a_whole_percentage_without_trailing_zeros(self):
        ctx = {'invoice': SimpleNamespace(tax_rate=10)}
        self.assertEqual(BINDING_RESOLVERS['invoice.tax_rate'](ctx), '10%')

    def test_tax_rate_formats_a_fractional_percentage(self):
        ctx = {'invoice': SimpleNamespace(tax_rate=17.5)}
        self.assertEqual(BINDING_RESOLVERS['invoice.tax_rate'](ctx), '17.5%')

    def test_tax_rate_zero(self):
        ctx = {'invoice': SimpleNamespace(tax_rate=0)}
        self.assertEqual(BINDING_RESOLVERS['invoice.tax_rate'](ctx), '0%')


class NewBindingRendersInRealPdfTests(InvoicesAPITestCase):
    def test_client_currency_conversion_binding_collapses_when_none(self):
        # build_render_context's own sample invoice (design_preview.
        # build_preview_context) has client_currency_conversion=None —
        # the element must not render at all (matches the 3 static
        # templates' own {% if %} gate, and _element_has_real_content's
        # existing blank-bound-text collapse rule).
        context = build_render_context(self.user, 'professional', '')
        d = base_design()
        d['header']['elements'].append({
            'kind': 'generic', 'type': 'text', 'x': 0, 'y': 0, 'width': 80, 'height': 6,
            'style': {}, 'overrides': {}, 'binding': 'invoice.client_currency_conversion',
        })
        html = render_design_html(d, context, for_pdf=True)
        self.assertNotIn('at rate', html)

    def test_tax_rate_binding_renders_real_value(self):
        context = build_render_context(self.user, 'professional', '')
        context['invoice'].tax_rate = 12
        d = base_design()
        d['header']['elements'].append({
            'kind': 'generic', 'type': 'text', 'x': 0, 'y': 0, 'width': 80, 'height': 6,
            'style': {}, 'overrides': {}, 'binding': 'invoice.tax_rate',
        })
        html = render_design_html(d, context, for_pdf=True)
        self.assertIn('12%', html)


# ══════════════════════════════════════════════════════════════════
# BACKWARD COMPATIBILITY — every pre-existing builtin still renders a
# real PDF and validates cleanly after every change in this phase.
# ══════════════════════════════════════════════════════════════════

class ExistingBuiltinsUnaffectedTests(InvoicesAPITestCase):
    def test_all_three_builtin_templates_still_render_a_real_pdf(self):
        from apps.invoices.design_templates import BUILTIN_DESIGNS
        for base_template, design_data in BUILTIN_DESIGNS.items():
            with self.subTest(base_template=base_template):
                self.assertEqual(validate_design_data_schema_v2(design_data), [])
                context = build_render_context(self.user, base_template, '')
                pdf_bytes = render_design_pdf_bytes(copy.deepcopy(design_data), context)
                self.assertTrue(pdf_bytes.startswith(b'%PDF'))
