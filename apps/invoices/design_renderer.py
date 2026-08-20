# apps/invoices/design_renderer.py
"""
Closes PDF-001 (19 August 2026 production audit): InvoiceDesign.design_data
— every element position/size/style a user builds in Step 8b's canvas
editor — was validated, saved, and then never read by any real render
path. build_pdf_context/build_portal_context/_select_template_name
(pdf_generator.py) only ever looked at invoice.design.base_template (one
of 3 fixed strings) to pick a static Jinja/Django template; design_data
itself and color_variant were dead weight on every real invoice. This
module is the renderer that actually reads design_data and produces real
HTML from it — a real, second render path alongside (not replacing) the
3 static templates.

Two-zone model, per design_schema.py, rendered as:
- Zone 1 (logo/business_info/client_info/dates): absolutely positioned
  CSS built from each element's real x/y/width/height (mm) plus whatever
  font/color/align/etc. its style dict carries — UNLESS style.sidebar is
  true, in which case it renders inside a fixed, full-height sidebar
  container (modern.html's own technique, replicated exactly: position:
  fixed; 42mm wide; repeats on every generated page — see
  design_seeds.py's own comment on why this compromise exists).
- Zone 2 (totals/notes/signature/payment_info, plus the mandatory
  line-items table): rendered in real document flow, each element's
  spacing_after_previous becoming real margin-top CSS — never absolute
  positioning here, since this is the load-bearing property the whole
  two-zone design depends on for staying overlap-safe under a variable
  item count. Exactly two elements may be marked paired_side_by_side
  (schema-enforced already) and render as one real two-column row.

Content bindings mirror the 3 static templates' own real Django
template variables/conditionals exactly (same invoice.*/freelancer.*
fields, same omit-when-unset rules for signature/payment methods/QR) —
this is not a second, disconnected reimplementation of what those
fields mean, just a data-driven layout around them.

Font/asset handling is NOT duplicated a third time: this module accepts
whatever font-URL context (FONT_CONTEXT for WeasyPrint file:// URIs,
PORTAL_FONT_CONTEXT for browser-fetchable /static/ URLs) the caller
already built via build_pdf_context/build_portal_context, exactly like
the 3 static templates do — @font-face declarations here reference the
same {{ font_* }} variable names.
"""
from django.template.loader import render_to_string

from .design_seeds import BUILTIN_DESIGNS

DYNAMIC_TEMPLATE_NAME = 'invoices/dynamic_design.html'

SIDEBAR_WIDTH_MM = 42  # matches modern.html's own .sidebar { width: 42mm; } exactly

DEFAULT_TOTALS_ROWS = ['subtotal', 'tax', 'discount']


def design_has_real_custom_data(design):
    """
    The item-5 condition, decided from InvoiceDesign's real persisted
    fields rather than `source` alone — `source` turns out NOT to
    reliably distinguish "opened and edited through the editor" from
    "picked and never touched": DesignEditor.jsx's own save payload
    (handleSave, frontend/src/pages/design-editor/DesignEditor.jsx) never
    includes `source` at all, and InvoiceDesignSerializer's PUT is a full
    (non-partial) update where `source` is optional (the model's own
    default makes DRF treat it as not-required) — so a builtin duplicate
    a user edits and saves stays source='builtin' forever. What DOES
    change is design_data itself the moment a real edit happens.

    So the real, evidence-based rule: a design counts as "custom enough
    to render dynamically" when its design_data is a real, structurally
    complete two-zone payload that is NOT byte-identical to the pure,
    unmodified seed for its own base_template. This covers every real
    case correctly:
      - source='custom' (started blank or from a duplicated+modified
        seed) — differs from any pure seed almost by construction.
      - source='ai_seeded' — Step 9's own adjustment (a uniform scale
        transform applied to a seed copy) always produces something
        different from the pure seed.
      - source='builtin' via design_duplicate, untouched — design_data
        is `get_builtin_design_data(base_template)` verbatim (see
        _instantiate_design_from_builtin, views.py) — identical to the
        seed, so this returns False and the faster static template
        renders instead. Visually correct either way, since the content
        IS the seed's content, but skips this renderer's extra work for
        the overwhelmingly common "picked a builtin, never opened the
        editor" case.
      - source='builtin' via design_duplicate, then actually edited and
        saved through the editor (still tagged 'builtin', per the
        `source` finding above) — design_data now differs from the pure
        seed, so this returns True. This is exactly "a builtin design
        the user has actually opened and saved through the editor," the
        case item 5 named explicitly.
      - A design with blank/malformed design_data (e.g. created directly
        via the ORM bypassing the serializer's validation, as some
        existing tests do) — missing zone_1/zone_2 keys — returns False,
        falling back to the static template by base_template alone
        rather than crashing this renderer on an incomplete payload.
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
    """The real branch _select_template_name-adjacent callers need: does this invoice's design warrant the dynamic renderer, or should it fall through to the 3 static templates?"""
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
    """Splits zone_1 elements into (page_elements, sidebar_elements) — style.sidebar:true is modern.html's own compromise (see design_seeds.py), replicated as a real fixed-position container rather than literal x/y placement."""
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


def _prepare_zone2_rows(zone_2_elements):
    """
    Groups zone_2 elements into render rows — a plain single-element row
    for everything, except the (schema-guaranteed 0-or-2) paired pair,
    which becomes one combined two-column row inserted at the position
    of the earlier-indexed element. Excludes sidebar-flagged elements
    (modern.html's qr_and_link payment_info) entirely — those render
    inside the sidebar container instead, never in this flow.
    """
    flow_elements = [e for e in zone_2_elements if not (e.get('style') or {}).get('sidebar')]

    for element in flow_elements:
        style = element.get('style') or {}
        element['style'] = style
        element['css'] = _zone2_element_css(element)
        if element.get('type') == 'totals':
            element['rows'] = style.get('rows') or DEFAULT_TOTALS_ROWS
            element['variant'] = style.get('variant', '')
        if element.get('type') == 'payment_info':
            element['variant'] = style.get('variant', 'bank_methods')

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
    structures design_data needs, never re-derives anything base_context
    already has. Deliberately takes `design` alone, not `invoice` — an
    earlier version accepted both but never actually used the `invoice`
    parameter (dead per STANDARDS.md's own convention), and dropping it
    is what lets a gallery preview call this identically with no real
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
