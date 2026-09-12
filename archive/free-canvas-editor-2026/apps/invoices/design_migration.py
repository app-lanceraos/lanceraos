# apps/invoices/design_migration.py
"""
Template Builder 2.0 — Phase 0 foundation only: a pure, deterministic
legacy (schema_version 1) -> canonical v2 design_data converter.

NEVER called against real database records by anything in this phase.
See apps/invoices/management/commands/audit_template_design_migration.py
(a read-only report that calls this function per-row but never saves
anything) and export_invoice_designs_backup.py (a read-only backup of
the current, unmigrated data). Actually migrating real InvoiceDesign
rows is a deliberately separate, future, explicitly-approved step — see
LANCERAOS_TEMPLATE_BUILDER_2_ARCHITECTURE_PLAN.md Section 20.

Deliberately narrow scope for this phase: migrate_v1_to_v2() performs a
pure STRUCTURAL transform — zone_1 -> header, zone_2 -> flow, every
element wrapped with an explicit kind/overrides envelope — and nothing
more. It does NOT attempt the style/overrides theme-cascade split the
architecture plan's Section 10 (and Phase 6) call for: deciding which
literal style values in an existing design are "really" theme defaults
versus genuine, intentional user overrides is a real product judgment
call, not a mechanical shape transform. Doing that split here, unreviewed,
in a foundation phase explicitly scoped to NOT implement the complete
editor schema, would be exactly the kind of premature scope this phase's
own instructions warn against. Every v1 `style` dict is therefore carried
into v2 verbatim, with a structurally-required but empty `overrides: {}`
— Phase 6 is where those two are actually reconciled, informed by the
real per-template default values design_seeds.py already documents.
This scoping choice is called out explicitly in
LANCERAOS_TEMPLATE_BUILDER_2_PHASE0.md as worth a second look before
Phase 6, not something this module claims is obviously correct forever.
"""
import copy

from apps.invoices.legacy_design_renderer import SIDEBAR_WIDTH_MM
from apps.invoices.legacy_design_schema import validate_design_data_schema
from apps.invoices.design_renderer import PAGE_MARGIN_LEFT_MM, PAGE_MARGIN_RIGHT_MM
from apps.invoices.design_schema import (
    SCHEMA_VERSION_LEGACY,
    SCHEMA_VERSION_V2,
    get_schema_version,
    validate_design_data_schema_v2,
)

# A hardcoded A4 default — every real design in this database today is
# implicitly A4 (WeasyPrint's own @page CSS, unchanged by this phase).
# Multi-page-size support is a named future requirement (architecture
# plan Section 11), not built now; this default just makes the new
# `page` key's presence a real, valid value rather than a placeholder.
DEFAULT_PAGE = {'size': 'A4', 'width_mm': 210, 'height_mm': 297}

# Phase 4B.2 — this mapper has no font/invoice/context access at all (a
# pure, offline structural transform), so it cannot compute a real
# rendered height for a flow element the way design_templates.py's own
# hand-calibrated seeds do. These are generic, reasonable design-time
# defaults per real element type — good enough for the isolated preview
# endpoint this mapper feeds (never a real invoice render path) — not a
# claim of pixel-accurate fidelity to any specific golden template.
DEFAULT_FLOW_ELEMENT_HEIGHTS_MM = {
    'totals': 35, 'notes': 24, 'payment_info': 27, 'signature': 8,
    'qr_code': 20, 'online_payment_link': 12, 'divider': 2, 'text': 6,
    'image': 20, 'rectangle': 10, 'container': 10,
}
DEFAULT_FLOW_ELEMENT_HEIGHT_FALLBACK_MM = 15
# The real, fixed gap v1's own `.pair-row`-equivalent flex layout used
# between two paired elements sharing one row.
PAIRED_ELEMENT_GAP_MM = 4
DEFAULT_TABLE_SPACING_BEFORE_MM = 10
# Same real, documented design-time estimate design_templates.py's own
# `_TABLE_HEIGHT_ESTIMATE_MM` uses (3-sample-row convention) — this
# mapper defines its own local copy rather than importing that seed
# module's private constant, since the two are conceptually independent
# (one is a hand-calibrated golden reconstruction, the other a generic
# fallback for arbitrary migrated input) even though the real number
# happens to match today.
DEFAULT_TABLE_HEIGHT_MM = 45


def _group_into_rows(zone2_elements):
    """
    Groups zone_2 elements into rows — a run of 2+ consecutive elements
    each flagged `paired_side_by_side` is one row (matching the real v1
    fixture shape: BOTH members of a real pair carry the flag, not just
    the second); anything else is its own, single-element row. Returns a
    list of (row_elements, spacing_after_previous) — the spacing value is
    always taken from the FIRST element of the row, since a real v1 pair's
    second member's own `spacing_after_previous` is meaningless (it never
    starts a new row, so nothing ever reads it).
    """
    rows = []
    for el in zone2_elements:
        if el.get('paired_side_by_side') and rows and rows[-1][0][-1].get('paired_side_by_side'):
            rows[-1][0].append(el)
        else:
            rows.append(([el], el.get('spacing_after_previous', 0)))
    return rows


def _row_widths(row_elements, content_width_mm):
    """
    Real bug fix (found and documented by Phase 5.1, left unfixed there;
    fixed here): a v1 `paired_side_by_side` element almost never states an
    explicit `style.width` — v1's own CSS flexbox (`.pair-row { display:
    flex }`) gives each member half the row for free, so the DATA never
    needed to say so. The pre-fix mapper's fallback default,
    `style.get('width', content_width_mm)`, gave the FULL content width to
    BOTH members of a real pair, doubling up on the same row (confirmed:
    professional/minimal's real `signature` ended up positioned at
    x=178, width=174 — a content area only 174mm wide to begin with).

    Fix: any element in the row that DOES state an explicit `style.width`
    keeps it (an intentional, real v1 authoring choice — never overridden);
    the total width explicit elements didn't claim, minus the real gap
    between every pair of siblings in the row, is split evenly among
    whichever elements left it unstated — this is the closest real
    equivalent of what v1's own flexbox row actually did visually (equal
    shares of the remaining space), computed once, at migration time,
    since v2 has no flexbox-equivalent auto-sizing left to defer to.
    """
    explicit = [copy.deepcopy(el.get('style', {})).get('width') for el in row_elements]
    n = len(row_elements)
    gap_total = PAIRED_ELEMENT_GAP_MM * max(0, n - 1)
    claimed = sum(w for w in explicit if w is not None)
    unstated_count = sum(1 for w in explicit if w is None)
    if unstated_count:
        share = max(0.0, content_width_mm - gap_total - claimed) / unstated_count
    else:
        share = 0.0
    return [w if w is not None else share for w in explicit]


def _position_flow_elements(zone2_elements, content_width_mm, start_bottom_mm):
    """
    Phase 4B.2 — the real v1 `spacing_after_previous`/`paired_side_by_side`
    stacking convention, replayed once into real, explicit x/y (the new
    unified element shape has no stacking mechanism left to defer to at
    render time — see design_schema.py's own docstring). Rows are
    grouped by _group_into_rows above; each row's own real width split is
    computed once by _row_widths (the real fix for the width-doubling bug
    documented there) before any element in it is positioned.
    """
    flow_out = []
    cursor_bottom = start_bottom_mm
    for row_elements, spacing_after_previous in _group_into_rows(zone2_elements):
        widths = _row_widths(row_elements, content_width_mm)
        y = cursor_bottom + spacing_after_previous
        x = 0.0
        for el, width in zip(row_elements, widths):
            style = copy.deepcopy(el.get('style', {}))
            height = DEFAULT_FLOW_ELEMENT_HEIGHTS_MM.get(el['type'], DEFAULT_FLOW_ELEMENT_HEIGHT_FALLBACK_MM)
            flow_out.append({
                'kind': 'semantic', 'type': el['type'], 'x': x, 'y': y, 'width': width, 'height': height,
                'style': style, 'overrides': {}, 'binding': None,
            })
            cursor_bottom = max(cursor_bottom, y + height)
            x += width + PAIRED_ELEMENT_GAP_MM
    return flow_out


def _empty_result():
    errors = []
    warnings = []
    return {'success': False, 'design_data': None, 'errors': errors, 'warnings': warnings}


def migrate_v1_to_v2(design_data):
    """
    Deterministic, pure function — given the same v1 design_data input,
    always returns the same v2 output. Never raises, never mutates the
    input (deep-copies throughout), never touches the database or any
    other global state.

    Returns:
        {
            "success": bool,
            "design_data": dict | None,   # the migrated v2 payload, or None on failure
            "errors": [str, ...],          # non-empty only when success is False
            "warnings": [str, ...],        # informational; can be non-empty even on success
        }

    Behavior by input shape:
      - Already schema_version 2: passed through unchanged (deep-copied),
        success=True, with a warning noting no migration was needed.
      - schema_version absent, or explicitly 1 (legacy): validated against
        the existing, live v1 structural validator first — a structurally
        invalid v1 payload is refused with success=False and the v1
        validator's own specific error messages, never guessed at.
      - Any other schema_version: refused with success=False — this
        function only ever converts version 1 to version 2.
    """
    result = _empty_result()

    try:
        version = get_schema_version(design_data)
    except ValueError as exc:
        result['errors'].append(str(exc))
        return result

    if version == SCHEMA_VERSION_V2:
        result['warnings'].append('design_data already declares schema_version 2 — no migration performed.')
        result['success'] = True
        result['design_data'] = copy.deepcopy(design_data)
        return result

    if version != SCHEMA_VERSION_LEGACY:
        result['errors'].append(
            f'Cannot migrate from schema_version {version} — this converter only handles '
            f'legacy (version {SCHEMA_VERSION_LEGACY}) input to v2 (version {SCHEMA_VERSION_V2}) output.'
        )
        return result

    v1_errors = validate_design_data_schema(design_data)
    if v1_errors:
        result['errors'].append('Input is not a structurally valid legacy design_data payload:')
        result['errors'].extend(v1_errors)
        return result

    # Real bug fix #3 (found and documented by Phase 5.1, left unfixed
    # there; fixed here): a v1 design's `style.sidebar: True` elements
    # (Modern's real, live convention — apps/invoices/design_seeds.py)
    # survived migration with that flag intact, but the mapper's own
    # `page` never carried a `sidebar` key at all — so
    # `_validate_page_bounds` correctly computed a 0-wide sidebar bound
    # for content that was always meant to render in a real 42mm sidebar
    # column. `SIDEBAR_WIDTH_MM` is the same fixed, real constant v1's own
    # dynamic renderer already uses for this (design_renderer.py) — not a
    # new invented value, and not something per-design v1 data ever
    # states (v1 has no per-design sidebar-width concept; it's a single,
    # global template constant, same as v2's own design_templates.py
    # Modern seed uses).
    zone1_source = design_data['zone_1']['elements']
    zone2_source = design_data['zone_2']['elements']
    has_sidebar = any((el.get('style') or {}).get('sidebar') for el in zone1_source + zone2_source)
    sidebar_width_mm = SIDEBAR_WIDTH_MM if has_sidebar else 0

    # Same effective-left-margin formula design_renderer.render_design_html
    # uses for a real sidebar (margin_left + sidebar width) — content_width_mm
    # must account for it too, or every non-sidebar flow element (the table
    # included) would be sized against a content area 42mm too wide whenever
    # a sidebar is actually present.
    effective_margin_left_mm = PAGE_MARGIN_LEFT_MM + sidebar_width_mm
    content_width_mm = DEFAULT_PAGE['width_mm'] - effective_margin_left_mm - PAGE_MARGIN_RIGHT_MM

    # Real bug fix #2 (found and documented by Phase 5.1, left unfixed
    # there; fixed here): v1 never enforced any page-boundary invariant of
    # its own (design_schema.py has no such check), and at least one real
    # header box per template (professional/minimal's own `dates`/
    # `business_info`) verbatim-copies to an x+width that runs past v2's
    # own (newer, stricter) content-width bound — v1 tolerated this
    # because the box is wider than its own right-aligned text ever
    # actually renders, never because the box itself was meant to extend
    # there. Clamping width down to fit within its own real coordinate
    # space (main content, or the sidebar's own narrower one) is the
    # minimal, always-safe correction: it only ever shrinks a box that
    # would otherwise fail v2's bound check, never moves x/y, and never
    # touches a box that already fits (verbatim fidelity is preserved for
    # every element that doesn't need this).
    def _clamp_width(x, width, bound):
        if width > 0 and 0 <= x < bound and x + width > bound:
            return bound - x
        return width

    header_elements = []
    for el in zone1_source:
        is_sidebar_el = bool((el.get('style') or {}).get('sidebar'))
        bound = sidebar_width_mm if is_sidebar_el else content_width_mm
        header_elements.append({
            'kind': 'semantic',
            'type': el['type'],
            'x': el['x'], 'y': el['y'],
            'width': _clamp_width(el['x'], el['width'], bound),
            'height': el['height'],
            'style': copy.deepcopy(el.get('style', {})),
            'overrides': {},
        })

    # Phase 4B.2 — the table is now a real, positioned structural element
    # within flow.elements (no more special flow.table key — see
    # design_schema.py's own docstring), and every flow element gets
    # real x/y/width/height in place of the old spacing_after_previous/
    # paired_side_by_side stacking mechanism, replayed once by
    # _position_flow_elements above. The table itself is never
    # sidebar-flagged (v1 has no concept of a sidebar table either), so
    # its own header_bottom_mm anchor is computed from non-sidebar header
    # elements only — a real sidebar's own header content (logo/business
    # name) sits in a visually separate column and has no bearing on
    # where the main table starts.
    non_sidebar_header_bottoms = [
        el['y'] + el['height'] for el in header_elements
        if not (el.get('style') or {}).get('sidebar')
    ]
    header_bottom_mm = max(non_sidebar_header_bottoms, default=0.0)

    table_style = copy.deepcopy(design_data['zone_2'].get('table', {}).get('style', {}))
    table_y = header_bottom_mm + table_style.get('spacing_before_mm', DEFAULT_TABLE_SPACING_BEFORE_MM)
    table_element = {
        'kind': 'structural', 'type': 'table', 'x': 0.0, 'y': table_y,
        'width': content_width_mm, 'height': DEFAULT_TABLE_HEIGHT_MM,
        'style': table_style, 'overrides': {}, 'binding': None,
    }
    table_bottom_mm = table_y + DEFAULT_TABLE_HEIGHT_MM

    # Sidebar-flagged flow elements (e.g. Modern's real "Pay online"
    # payment_info) are positioned independently, within the sidebar's own
    # narrower width and starting below the sidebar's OWN header content
    # (not the main table, which they never visually stack against) — the
    # same real column-separation the canonical v2 renderer/design_templates.py
    # already establish for sidebar content.
    sidebar_source = [el for el in zone2_source if (el.get('style') or {}).get('sidebar')]
    main_source = [el for el in zone2_source if not (el.get('style') or {}).get('sidebar')]
    sidebar_header_bottoms = [
        el['y'] + el['height'] for el in header_elements
        if (el.get('style') or {}).get('sidebar')
    ]
    sidebar_start_bottom_mm = max(sidebar_header_bottoms, default=0.0)

    flow_elements = (
        [table_element]
        + _position_flow_elements(main_source, content_width_mm, table_bottom_mm)
        + _position_flow_elements(sidebar_source, sidebar_width_mm, sidebar_start_bottom_mm)
    )

    page = dict(DEFAULT_PAGE)
    if has_sidebar:
        page['sidebar'] = {'width_mm': sidebar_width_mm, 'color': None}

    v2_design_data = {
        'schema_version': SCHEMA_VERSION_V2,
        'page': page,
        'header': {'elements': header_elements},
        'flow': {'elements': flow_elements},
    }

    # Belt-and-suspenders: the mapping above is a structure-preserving
    # transform of an input we already know is v1-valid, so this should
    # be unreachable — but a migration tool that trusts its own output
    # without checking is exactly the kind of silent-corruption risk
    # this whole phase exists to avoid introducing.
    v2_errors = validate_design_data_schema_v2(v2_design_data)
    if v2_errors:
        result['errors'].append(
            'Migrated output failed v2 structural validation — this indicates a real bug in the '
            'mapper itself, not a problem with the input:'
        )
        result['errors'].extend(v2_errors)
        return result

    result['success'] = True
    result['design_data'] = v2_design_data
    return result
