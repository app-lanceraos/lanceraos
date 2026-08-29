# apps/invoices/legacy_design_renderer.py
"""
Production cutover — LanceraOS Template Builder is now the one production
template system (apps/invoices/design_renderer.py, design_schema.py,
design_templates.py, design_canvas.py). This module is what's left of the
PRE-CUTOVER design system's own dynamic renderer: kept ONLY as a
read-compatibility path for any InvoiceDesign row that still holds
legacy-shape (`zone_1`/`zone_2`) design_data after the one-time production
migration (`python manage.py migrate_invoice_designs_to_production_schema
--apply`) — a row is left in this shape only when the migration mapper
itself couldn't safely convert it (see that command's own output for
which rows, and why), never by choice. `pdf_generator.render_html_for_design`
is the only real caller: for anything still in this shape, it renders
through `render_dynamic_design_html` below (if the design has genuinely
been customized) or falls through to one of the 3 static templates
otherwise — exactly the same behavior this module has always had, simply
no longer described as "the current system," just its safety net.

Nothing about the render logic below changed in this cutover — only its
role. The editor-specific functions that used to live here
(`render_editor_canvas_html`, `render_editor_element_html`,
`prepare_editor_zone1_elements`, `prepare_editor_zone2_elements`, and the
`editor_canvas.html` template they rendered) were deleted outright: the
legacy canvas editor UI and its own backend endpoints
(`design_editor_canvas`/`design_editor_element`, views.py) are retired —
nothing edits a legacy-shape design anymore. Opening ANY design for
editing now always goes through the one production editor, which
migrates a legacy design in-memory on open (see `views.py`'s
`design_detail`/the editor's own load path) — a legacy design is only
ever ugpraded to real v2 storage the moment its owner actually saves it.

Two-zone model, per `legacy_design_schema.py`:
- Zone 1 (logo/business_info/client_info/dates): absolutely positioned
  CSS built from each element's real x/y/width/height (mm) plus whatever
  font/color/align/etc. its style dict carries — UNLESS style.sidebar is
  true, in which case it renders inside a fixed, full-height sidebar
  container (modern.html's own technique, replicated exactly: position:
  fixed; 42mm wide; repeats on every generated page).
- Zone 2 (totals/notes/signature/payment_info, plus the mandatory
  line-items table): rendered in real document flow, each element's
  spacing_after_previous becoming real margin-top CSS. Exactly two
  elements may be marked paired_side_by_side and render as one real
  two-column row.
"""
from django.template.loader import render_to_string

from .design_seeds import BUILTIN_DESIGNS

DYNAMIC_TEMPLATE_NAME = 'invoices/dynamic_design.html'

SIDEBAR_WIDTH_MM = 42  # matches modern.html's own .sidebar { width: 42mm; } exactly

DEFAULT_TOTALS_ROWS = ['subtotal', 'tax', 'discount']


def design_has_real_custom_data(design):
    """
    Whether this legacy-shape design counts as "custom enough to render
    dynamically" — its design_data is a real, structurally complete
    two-zone payload that is NOT byte-identical to the pure, unmodified
    seed for its own base_template. `source` alone doesn't reliably
    distinguish "opened and edited" from "picked and never touched" (a
    builtin design a user edited stays `source='builtin'` forever), so
    this compares actual content instead.
    """
    data = design.design_data
    if not isinstance(data, dict) or not data:
        return False
    if 'zone_1' not in data or 'zone_2' not in data:
        return False

    seed = BUILTIN_DESIGNS.get(design.base_template)
    if seed is not None and data == seed:
        return False

    return True


def should_render_dynamic_design(invoice):
    """Does this invoice's (legacy-shape) design warrant the dynamic renderer, or should it fall through to the 3 static templates?"""
    return bool(invoice.design_id) and design_has_real_custom_data(invoice.design)


def _num(value):
    """JSON numbers may be int or float — mm values render cleanest without a trailing '.0' for whole numbers."""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def _zone1_element_css(element, absolute=True):
    style = element.get('style') or {}
    parts = []
    if absolute:
        parts.append('position:absolute')
        parts.append(f"left:{_num(element['x'])}mm")
        parts.append(f"top:{_num(element['y'])}mm")
    parts.append(f"width:{_num(element['width'])}mm")
    parts.append(f"height:{_num(element['height'])}mm")
    if style.get('align'):
        parts.append(f"text-align:{style['align']}")
    if style.get('font'):
        parts.append(f"font-family:'{style['font']}'")
    if style.get('font_size_pt'):
        parts.append(f"font-size:{_num(style['font_size_pt'])}pt")
    if style.get('color'):
        parts.append(f"color:{style['color']}")
    if element.get('type') == 'logo' and style.get('border_radius_mm'):
        parts.append(f"border-radius:{_num(style['border_radius_mm'])}mm")
    return '; '.join(parts) + ';'


def _prepare_zone1_elements(zone_1):
    """Splits zone_1 elements into (page_elements, sidebar_elements) — style.sidebar:true is modern.html's own compromise, replicated as a real fixed-position container rather than literal x/y placement."""
    page_elements, sidebar_elements = [], []
    for raw in zone_1.get('elements', []):
        style = raw.get('style') or {}
        prepped = {**raw, 'style': style, 'css': _zone1_element_css(raw, absolute=not style.get('sidebar'))}
        if style.get('sidebar'):
            sidebar_elements.append(prepped)
        else:
            page_elements.append(prepped)
    return page_elements, sidebar_elements


def _zone1_content_height_mm(page_elements):
    if not page_elements:
        return 0
    return max(el['y'] + el['height'] for el in page_elements)


def _zone2_element_css(element):
    style = element.get('style') or {}
    parts = [f"margin-top:{_num(element.get('spacing_after_previous', 0))}mm"]
    if style.get('width'):
        parts.append(f"width:{_num(style['width'])}mm")
    if style.get('align'):
        parts.append(f"text-align:{style['align']}")
    return '; '.join(parts) + ';'


def _table_style_css(table_style):
    parts = []
    if table_style.get('font'):
        parts.append(f"font-family:'{table_style['font']}'")
    return '; '.join(parts)


def _thead_cell_css(table_style):
    parts = []
    if table_style.get('header_bg'):
        parts.append(f"background:{table_style['header_bg']}")
    if table_style.get('header_color'):
        parts.append(f"color:{table_style['header_color']}")
    border_color = table_style.get('header_border_color')
    if border_color:
        parts.append(f"border-bottom:0.5mm solid {border_color}")
    return '; '.join(parts)


def _row_cell_css(table_style):
    color = table_style.get('row_border_color')
    return f"border-bottom:0.25mm solid {color};" if color else ''


def _annotate_zone2_element(element):
    """Computes css/rows/variant onto a zone_2 element in place. Returns the same dict for convenient chaining."""
    style = element.get('style') or {}
    element['style'] = style
    element['css'] = _zone2_element_css(element)
    if element.get('type') == 'totals':
        element['rows'] = style.get('rows') or DEFAULT_TOTALS_ROWS
        element['variant'] = style.get('variant', '')
    if element.get('type') == 'payment_info':
        element['variant'] = style.get('variant', 'bank_methods')
    return element


def _prepare_zone2_rows(zone_2_elements):
    """
    Groups zone_2 elements into render rows — a plain single-element row
    for everything, except the (schema-guaranteed 0-or-2) paired pair,
    which becomes one combined two-column row inserted at the position
    of the earlier-indexed element. Excludes sidebar-flagged elements
    entirely — those render inside the sidebar container instead.
    """
    flow_elements = [_annotate_zone2_element(e) for e in zone_2_elements if not (e.get('style') or {}).get('sidebar')]

    paired_idx = [i for i, e in enumerate(flow_elements) if e.get('paired_side_by_side')]

    rows = []
    consumed = set(paired_idx) if len(paired_idx) == 2 else set()
    for i, element in enumerate(flow_elements):
        if i in consumed:
            continue
        rows.append({'kind': 'single', 'elements': [element]})

    if len(paired_idx) == 2:
        i1, i2 = paired_idx
        pair_row = {'kind': 'pair', 'elements': [flow_elements[i1], flow_elements[i2]]}
        insert_at = sum(1 for i in range(i1) if i not in consumed)
        rows.insert(insert_at, pair_row)

    return rows


def _prepare_zone2_sidebar_elements(zone_2_elements):
    sidebar = []
    for element in zone_2_elements:
        style = element.get('style') or {}
        if not style.get('sidebar'):
            continue
        prepped = {**element, 'style': style}
        if prepped.get('type') == 'payment_info':
            prepped['variant'] = style.get('variant', 'bank_methods')
        sidebar.append(prepped)
    return sidebar


def render_dynamic_design_html(design, base_context):
    """
    `base_context` is exactly what build_pdf_context/build_portal_context
    (or, for a gallery preview render, design_preview.build_preview_context)
    already produce (invoice/freelancer/qr_code_data_uri/signature_url/
    font/color variables) — this function only adds the preprocessed zone
    structures design_data needs. Deliberately takes `design` alone, not
    `invoice` — lets a gallery preview call this identically with no real
    Invoice in scope at all.
    """
    design_data = design.design_data
    zone_1 = design_data.get('zone_1') or {}
    zone_2 = design_data.get('zone_2') or {}

    page_elements, zone1_sidebar_elements = _prepare_zone1_elements(zone_1)
    zone2_rows = _prepare_zone2_rows(zone_2.get('elements', []))
    zone2_sidebar_elements = _prepare_zone2_sidebar_elements(zone_2.get('elements', []))
    sidebar_elements = zone1_sidebar_elements + zone2_sidebar_elements

    table_style = (zone_2.get('table') or {}).get('style') or {}

    context = {
        **base_context,
        'zone1_page_elements': page_elements,
        'zone1_content_height_mm': _zone1_content_height_mm(page_elements),
        'sidebar_elements': sidebar_elements,
        'has_sidebar': bool(sidebar_elements),
        'sidebar_width_mm': SIDEBAR_WIDTH_MM,
        'zone2_rows': zone2_rows,
        'table_css': _table_style_css(table_style),
        'thead_cell_css': _thead_cell_css(table_style),
        'row_cell_css': _row_cell_css(table_style),
    }
    return render_to_string(DYNAMIC_TEMPLATE_NAME, context)
