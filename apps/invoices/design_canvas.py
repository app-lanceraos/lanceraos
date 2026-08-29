# apps/invoices/design_canvas.py
"""
The production canvas adapter — the ONE, deliberate boundary where
canonical design_data (always mm, always schema-shaped exactly like
design_renderer.py reads it) is turned into JSON the real Template
Builder canvas (frontend/src/pages/design-editor/DesignEditor.jsx,
GrapesJS-based) builds its selectable/movable components from. It is
explicitly an ADAPTER, not a second renderer:

  - Every geometry computation (per-element CSS positioning, sidebar
    split, style resolution) is the exact same real function
    design_renderer.py's own canonical HTML/PDF output calls —
    prepare_element, is_sidebar_element, resolve_style_value,
    attach_generic_content. This module imports and calls them; it does
    not reimplement a single one. If the canonical renderer's own
    geometry logic ever changes, this module inherits that change
    automatically — there is no parallel copy to drift out of sync.
  - Every element's real content HTML — including the table's, as of
    Phase 4B.2 (see design_schema.py's own docstring: the table is
    now a real positioned element, not a special key) — comes from the
    exact same `invoices/canonical/_element_content.html` partial the
    canonical renderer itself includes, rendered here once per element,
    never reimplemented as a second HTML-generation path.
  - The one thing this module adds that the canonical renderer doesn't
    need is JSON-friendly structure (flat, indexed element lists so the
    frontend's serializer can map each rendered box back to its exact
    position in design_data.header.elements / design_data.flow.elements
    on save) and the per-element `css` string surfaced as data rather
    than baked directly into a `<div style="...">` — the canvas applies
    that exact same CSS string to its own DOM nodes, in real mm units,
    converting to px only at the browser's own CSS boundary (Phase 3's
    own "V2 mm -> canvas conversion -> CSS px" rule). Nothing here
    computes or stores px anywhere; every numeric geometry field this
    module returns (x/y/width/height) is the same real mm value
    design_data itself holds.

Not imported by InvoiceDesignSerializer, design_duplicate, or
pdf_generator.py — this module builds canvas JSON, never a real invoice
render. Its call sites are views_design_editor.py's real canvas endpoints
(design_canvas_document/design_canvas_element), which apply the standard
ownership boundary every design endpoint uses (IsAuthenticated;
design_data always comes from the request's own body or the requesting
user's own InvoiceDesign row, never fetched by id from another user's).
"""
from django.template.loader import render_to_string

from apps.invoices.design_renderer import (
    PAGE_MARGIN_BOTTOM_MM,
    PAGE_MARGIN_LEFT_MM,
    PAGE_MARGIN_RIGHT_MM,
    PAGE_MARGIN_TOP_MM,
    DesignRenderError,
    attach_generic_content,
    is_sidebar_element,
    prepare_element,
    resolve_style_value,
    resolve_theme_color,
)
from apps.invoices.design_schema import (
    FLOW_SEMANTIC_TYPES,
    HEADER_SEMANTIC_TYPES,
    GENERIC_TYPES,
    STRUCTURAL_TYPES,
    validate_design_data_schema_v2,
)

ELEMENT_CONTENT_TEMPLATE = 'invoices/canonical/_element_content.html'
PAGE_STYLES_TEMPLATE = 'invoices/canonical/_page_styles.html'

CANVAS_ELEMENT_TYPES = HEADER_SEMANTIC_TYPES | FLOW_SEMANTIC_TYPES | GENERIC_TYPES | STRUCTURAL_TYPES


def _render_element_content(prepared_element, context):
    """
    Renders exactly one element's real content fragment through the same
    partial the canonical renderer itself includes for every element —
    the direct reuse this module's own docstring requires, not a second
    HTML-generation path. This is also, as of Phase 4B.2, how the table's
    own real markup (head + rows) reaches the canvas — no separate
    table-content code path exists in this module anymore.
    """
    return render_to_string(ELEMENT_CONTENT_TEMPLATE, {**context, 'el': prepared_element})


def _prepare_list(elements_raw, context, content_mode):
    """One list (header.elements or flow.elements) -> the JSON-friendly, indexed shape the frontend consumes."""
    out = []
    for index, element in enumerate(elements_raw):
        prepared = prepare_element(element, context, content_mode)
        out.append({
            'index': index,
            'kind': element.get('kind'),
            'type': element.get('type'),
            'x': element['x'], 'y': element['y'], 'width': element['width'], 'height': element['height'],
            'style': element.get('style') or {},
            'overrides': element.get('overrides') or {},
            'binding': element.get('binding'),
            'sidebar': is_sidebar_element(element),
            # Green-Light directive — the Layers panel's lock/hide toggles.
            # Passed through verbatim (both default False when absent, same
            # as design_schema's own optional-boolean contract) so
            # reloading a design that was already hidden/locked preserves
            # that state in the canvas rather than silently resetting it.
            'hidden': bool(element.get('hidden')),
            'locked': bool(element.get('locked')),
            'css': prepared['css'],
            'content_html': _render_element_content(prepared, context),
        })
    return out


def build_canvas_document(design_data, context, content_mode='alias'):
    """
    The canvas's own initial-load payload — real page geometry, real
    per-element positions/CSS (mm, never px), and real rendered content
    for every header and flow element (the table included, as one more
    element — see this module's own docstring), indexed to match
    design_data's own array positions exactly (data-el-index in the
    frontend serializer reads this index back on save, the same
    convention v1's own editor_canvas.html already established for its
    zone_1/zone_2 lists).

    `content_mode` (Phase 4B, default 'alias' — the correct default for a
    design environment, see design_renderer.py's own comment on
    ALIAS_BINDING_LABELS): 'alias' shows semantic field labels ("Client
    Name") instead of real/sample data; 'real' shows genuine invoice/
    profile data (useful for a "preview with real data" toggle). This
    parameter only ever reaches this adapter and render_v2_canvas_element_
    content below — render_design_html (real PDF/portal output) has no
    code path that accepts it at all.

    Raises the same DesignRenderError the canonical renderer raises for a
    schema-invalid payload — the canvas must never attempt to display a
    document that isn't valid V2 design_data, matching Part 21's implicit
    "the canvas cannot diverge from the canonical shape" requirement.
    """
    errors = validate_design_data_schema_v2(design_data)
    if errors:
        raise DesignRenderError('design_data failed v2 schema validation: ' + '; '.join(errors))

    page = design_data['page']

    # Identical fallback chain to render_design_html — the canvas must
    # never silently assume different margin/sidebar defaults than the
    # renderer it's supposed to visually match.
    margin_top_mm = page.get('margin_top_mm', PAGE_MARGIN_TOP_MM)
    margin_right_mm = page.get('margin_right_mm', PAGE_MARGIN_RIGHT_MM)
    margin_bottom_mm = page.get('margin_bottom_mm', PAGE_MARGIN_BOTTOM_MM)
    margin_left_mm = page.get('margin_left_mm', PAGE_MARGIN_LEFT_MM)
    sidebar = page.get('sidebar')
    sidebar_width_mm = sidebar['width_mm'] if sidebar else 0
    effective_margin_left_mm = margin_left_mm + sidebar_width_mm
    content_width_mm = page['width_mm'] - effective_margin_left_mm - margin_right_mm

    header_out = _prepare_list(design_data['header']['elements'], context, content_mode)
    flow_out = _prepare_list(design_data['flow']['elements'], context, content_mode)

    # Real @font-face declarations (real font URLs, PORTAL_FONT_CONTEXT's
    # /static/ variant, resolved via build_render_context exactly like
    # every other real render path) plus the canonical renderer's own real
    # typography/color CSS rules — the SAME partial canonical.html
    # itself includes, rendered once here and shipped to the canvas so it
    # can inject it into its own iframe <head>. Found and fixed during
    # this phase's own real-browser verification (Part 22): without this,
    # the canvas silently fell back to the browser's default serif font
    # for every element — a real, confirmed Phase 3 fidelity bug, not a
    # theoretical one (Part 8 explicitly forbids exactly this).
    css = render_to_string(PAGE_STYLES_TEMPLATE, context)

    return {
        'schema_version': design_data.get('schema_version'),
        'css': css,
        'page': {
            'size': page.get('size'),
            'width_mm': page['width_mm'],
            'height_mm': page['height_mm'],
            'margin_top_mm': margin_top_mm,
            'margin_right_mm': margin_right_mm,
            'margin_bottom_mm': margin_bottom_mm,
            'margin_left_mm': margin_left_mm,
            'effective_margin_left_mm': effective_margin_left_mm,
            'content_width_mm': content_width_mm,
            'sidebar': sidebar,
        },
        'header_elements': header_out,
        'flow_elements': flow_out,
        'design_primary_color': context.get('design_primary_color'),
        'design_secondary_color': context.get('design_secondary_color'),
        'fonts': {k: v for k, v in context.items() if k.startswith('font_')},
    }


def render_canvas_element_content(kind, el_type, style, overrides, context, content_mode='alias', binding=None):
    """
    Single-element refresh — the live style-panel-driven repaint, mirroring
    apps/invoices/design_renderer.py's own real render_editor_element_html
    exactly (same purpose: re-render ONE element's content fragment without
    touching any other element's live position). Uses the exact same
    attach_generic_content/resolve_style_value helpers the canonical
    renderer's own per-element preparation calls, so a generic element's
    resolved_text/image_src/shape_css is computed identically here and in
    the whole-document render — never a second, parallel computation.

    Phase 4B: this is the StylePanel's own real repaint call — every style/
    overrides change debounces into this function so the label/alias-vs-
    real content precedence (resolved_label, resolved_notes_label/
    resolved_terms_label, content_mode) stays byte-identical to the
    whole-document load path (build_canvas_document above), not a
    second, independently-computed version of the same logic.

    Phase 4B.2: the table (kind='structural', type='table') goes through
    this exact same function now too — its real x/y/width aren't needed
    here (this endpoint only ever re-renders CONTENT, never geometry),
    but its style-driven fields (table_columns/thead_cell_css/row_cell_css/
    table_rows) need a real `context['invoice']` to resolve against,
    which this function already receives.

    Phase 4B.3 real bug fix (LANCERAOS_TEMPLATE_BUILDER_2_PHASE4B2_AUDIT.md
    finding C1): `binding` — previously silently dropped, so a bound
    generic text element's own real/alias value could never be resolved
    here, and any style edit blanked its canvas content. Passed straight
    into the constructed `element` dict, exactly where
    `attach_generic_content` already expects to find it (unchanged there
    — this fixes the caller's own omission, not a gap in that function).
    """
    if el_type not in CANVAS_ELEMENT_TYPES:
        raise DesignRenderError(f'Unknown element type "{el_type}" — must be one of {sorted(CANVAS_ELEMENT_TYPES)}.')

    kind_for_type = 'structural' if el_type in STRUCTURAL_TYPES else kind
    element = {
        'kind': kind_for_type, 'type': el_type, 'style': style or {}, 'overrides': overrides or {},
        'binding': binding,
    }
    prepared = dict(element)
    prepared['content_mode'] = content_mode
    prepared['resolved_label'] = resolve_style_value(element, 'label')
    if kind_for_type == 'semantic' and el_type == 'totals':
        prepared['totals_rows'] = resolve_style_value(element, 'rows', ['subtotal', 'tax', 'discount', 'total'])
        # Phase 6 (style/theme cascade) fix — see design_renderer.py's
        # own prepare_element for the full reasoning (the same real,
        # reachable bug: overrides.pill_color and the 'theme_primary'/
        # 'theme_secondary' sentinels were both silently ignored). This
        # endpoint is the StylePanel's own live-refresh call — the one
        # place a user's real pill-color edit actually needs to take
        # effect for the first time.
        prepared['resolved_pill_color'] = resolve_theme_color(resolve_style_value(element, 'pill_color'), context)
    if kind_for_type == 'semantic' and el_type == 'notes':
        prepared['resolved_notes_label'] = resolve_style_value(element, 'notes_label', 'Notes')
        prepared['resolved_terms_label'] = resolve_style_value(element, 'terms_label', 'Terms')
        prepared['notes_sections'] = resolve_style_value(element, 'sections', ['notes', 'terms'])
    if kind_for_type == 'structural' and el_type == 'table':
        from apps.invoices.design_renderer import ALIAS_SAMPLE_TABLE_ITEMS, resolve_table_columns, row_cell_css, thead_cell_css
        table_style = style or {}
        prepared['table_columns'] = resolve_table_columns(table_style)
        prepared['thead_cell_css'] = thead_cell_css(table_style, context)
        prepared['row_cell_css'] = row_cell_css(table_style, context)
        prepared['table_rows'] = ALIAS_SAMPLE_TABLE_ITEMS if content_mode == 'alias' else list(context['invoice'].items.all())
    attach_generic_content(prepared, element, context, content_mode)
    return _render_element_content(prepared, context)
