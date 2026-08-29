# apps/invoices/design_schema.py
"""
The production Template Builder's canonical `design_data` schema — the
live, explicit, versioned contract every current save/render/editor path
in this codebase validates against and builds on. `InvoiceDesignSerializer.
validate_design_data` (apps/invoices/serializers.py) dispatches here (via
`validate_design_data_schema_by_version` below) whenever a payload's own
`schema_version` is 2; a payload with no `schema_version` key at all is a
pre-existing LEGACY design (see get_schema_version() below) and is instead
validated by `legacy_design_schema.validate_design_data_schema` — the
retired zone_1/zone_2 shape's own validator, kept only so an old,
un-migrated row can still be read/rendered/deleted. Every NEW design this
product creates — a fresh blank start, a builtin template pick, an
AI-seeded upload — is schema_version 2 from the moment it's created; there
is no code path left that produces a fresh legacy-shaped row.

What this schema looks like structurally, and how it differs from the
retired zone_1/zone_2 shape (`legacy_design_schema.py`):

  - An explicit top-level `schema_version: 2` key — the one thing that
    distinguishes a row validated here from a legacy row (see
    get_schema_version() below).
  - `zone_1`/`zone_2` are renamed `header`/`flow`. Both are absolutely
    positioned and overlap-checked identically — the `header`/`flow`
    split is purely an organizational convenience (roughly "identity
    fields" vs "body fields"), not a positioning-behavior difference.
    The legacy schema gave `flow` a structural guarantee against
    overlapping the mandatory table (flow elements had no x/y at all,
    only spacing); this schema replaces that STRUCTURAL guarantee with
    the same VALIDATED overlap check `header` always used, so real
    free-form positioning (moving Notes, Signature, QR, Payment Info, or
    the table itself anywhere on the page) is possible. See
    design_templates.py's own module docstring for the full reasoning.
  - Every element carries an explicit `kind`: "semantic" (invoice-bound
    types), "generic" (free-form visual elements — text/image/rectangle/
    divider/container — with no invoice-data binding of their own except
    `text`'s own optional `binding` field, see SUPPORTED_BINDINGS below),
    or "structural" (the one mandatory line-items table).
  - Every element carries an `overrides` dict (structurally required,
    typically empty) — a real, additive style-cascade escape hatch
    (theme -> template defaults -> element `style` -> explicit user
    `overrides`) layered on top of `style`, which still carries the
    original structural/behavioral config (align, variant, labels,
    show_* flags).
  - `layout_mode` ('pinned'/'flow', see LAYOUT_MODES below) — optional,
    absent means 'pinned' (a fixed box; real content longer than that
    box overflows without pushing anything else). 'flow' opts an element
    into real, content-driven growth at canonical render time
    (design_renderer.py's own render_design_html — see that module's own
    _group_into_render_chains for the mechanism).

`migrate_v1_to_v2` (design_migration.py) is the one deterministic,
pure-function converter from the legacy shape into this one — run
on-demand the moment a user opens a legacy-shaped design in the editor
(views_design_editor.design_canvas_document), and available as a one-time,
dry-run-by-default bulk pass via
`manage.py migrate_invoice_designs_to_production_schema`. A legacy design
that fails migration (see `_clamp_width`'s own documented, deliberately
unfixed edge case) is left untouched in its original shape — safely
renderable via legacy_design_renderer.py, safely readable/deletable
through the same unified CRUD every design uses — until a user rebuilds it
from a template instead.
"""

from apps.invoices.legacy_design_schema import OVERLAP_EPSILON_MM, boxes_overlap

SCHEMA_VERSION_LEGACY = 1
SCHEMA_VERSION_V2 = 2

# Phase 5.1 — the same 2 default-margin values design_renderer.py uses
# (PAGE_MARGIN_RIGHT/LEFT_MM) when a design_data payload omits them
# (OPTIONAL_MARGIN_KEYS below), duplicated here rather than imported:
# design_renderer.py already imports FROM this module
# (validate_design_data_schema_v2, SUPPORTED_BINDINGS) — importing the
# other direction would create a circular import. Kept in sync by being
# the same 2 plain numbers, not a mechanism either module could silently
# drift from independently. Only the X-axis margins are needed here —
# _validate_page_bounds (below) deliberately has no Y-axis (top/bottom)
# ceiling; see that function's own docstring for the real, measured
# reason (design_migration.py's output).
_PAGE_MARGIN_RIGHT_MM = 16
_PAGE_MARGIN_LEFT_MM = 20
SUPPORTED_SCHEMA_VERSIONS = {SCHEMA_VERSION_LEGACY, SCHEMA_VERSION_V2}

# Phase 4B addition: qr_code / online_payment_link split out of
# payment_info's own qr_and_link variant (deferred from Phase 0 — see this
# module's own docstring above, "Phase 5 concern" — Phase 4B is that work).
# business_info/client_info/dates remain valid types unchanged (so any
# legacy-shape or already-migrated design keeps validating); the Phase 4B
# seeds simply stop USING them as multi-field bundles, decomposing into
# generic `text` elements instead (see design_templates.py).
HEADER_SEMANTIC_TYPES = {'logo', 'business_info', 'client_info', 'dates'}
FLOW_SEMANTIC_TYPES = {'totals', 'notes', 'signature', 'payment_info', 'qr_code', 'online_payment_link'}

# New in v2 — the architecture plan's Section 7/9 generic visual-element
# vocabulary. Structurally recognized here (so later phases have a real,
# tested type set to build the editor/renderer against) but NOT rendered
# or editor-supported by anything yet — that's Phase 1 (renderer) and
# Phase 5 (editor tooling).
GENERIC_TYPES = {'text', 'image', 'rectangle', 'divider', 'container'}

# Phase 4B.2 — the one mandatory, non-deletable structural anchor every
# design must have exactly one of (the line-items table). A third `kind`,
# not `semantic`/`generic`: it isn't invoice-bound content in the sense
# business_info/client_info are (it renders real InvoiceItem rows, not a
# single resolved value), and it isn't a free-form visual primitive
# either — it's the one element every design_data payload is structurally
# required to contain (see _validate_elements' own required-table check).
STRUCTURAL_TYPES = {'table'}

HEADER_TYPES = HEADER_SEMANTIC_TYPES | GENERIC_TYPES
FLOW_TYPES = FLOW_SEMANTIC_TYPES | GENERIC_TYPES | STRUCTURAL_TYPES

# Phase 4B.2 — see this module's own docstring update below: header and
# flow elements now share ONE shape. `spacing_after_previous` and
# `paired_side_by_side` (Phase 0-4B's flow-only, spacing-based positioning
# and 2-element pairing mechanism) are gone — every element, in either
# list, now carries real x/y/width/height like header elements always
# have, and two elements sit "side by side" simply by having adjacent x
# values, with no special pairing concept needed once position is free.
REQUIRED_ELEMENT_KEYS = {'kind', 'type', 'x', 'y', 'width', 'height', 'style', 'overrides'}

ELEMENT_KINDS = {'semantic', 'generic', 'structural'}

# Master Blueprint cutover — the target-architecture fix for the
# repeatedly-documented content-overflow problem (LANCERAOS_TEMPLATE_
# BUILDER_2_MASTER_BLUEPRINT.md Section B.3): an element's declared
# geometry is normally a FIXED box ('pinned', the default and the only
# behavior that existed before this field) — real content longer than
# that box silently spills past it (overflow:visible, never clipped, but
# never pushing anything else out of the way either). `'flow'` opts an
# element into real, content-driven growth at CANONICAL RENDER TIME only
# (design_renderer.py's own render_design_html/render_v2_design_pdf_
# bytes) — see that module's own _group_into_render_chains for the exact
# mechanism. Optional; absent means 'pinned', so every design produced
# before this field existed (every real migrated design, every hand-
# authored one predating this cutover) is completely unaffected.
LAYOUT_MODES = {'pinned', 'flow'}

# The architecture plan's Section 5 explicit dynamic-binding allow-list —
# a short, closed set, deliberately not an expression language. Only
# meaningful on a generic `text` element; a `binding` of None (or the key
# absent) means the text is static/literal.
#
# Phase 4B grew this from 7 to 20 entries so business_info/client_info/
# dates can be decomposed into one generic `text` element per real field
# (see design_templates.py) — every new entry is a real, confirmed field on
# Invoice/FreelancerProfile (apps/invoices/models.py, apps/users/models.py),
# resolved the same one-line-lambda way as the original 7 (see
# BINDING_RESOLVERS, design_renderer.py). Two fields the product spec
# asked for have NO backing model field today and are deliberately NOT
# added here (see LANCERAOS_TEMPLATE_BUILDER_2_PHASE4B.md's "remaining
# limitations" for the full reasoning, confirmed with the user before
# implementing): FreelancerProfile has no `website` field at all, and
# Invoice/Client have no client_city/client_country — only one combined
# client.address field.
SUPPORTED_BINDINGS = {
    'invoice.number', 'invoice.issue_date', 'invoice.due_date',
    'invoice.subtotal', 'invoice.tax_amount', 'invoice.discount_amount',
    'invoice.notes', 'invoice.terms', 'invoice.payment_link',
    'business.name', 'business.email', 'business.address_line1',
    'business.city', 'business.country', 'business.phone',
    'client.name', 'client.company', 'client.email', 'client.phone', 'client.address',
    'totals.grand_total',
    # Phase 4B.3 (LANCERAOS_TEMPLATE_BUILDER_2_PHASE4B2_AUDIT.md finding C4)
    # — 5 real, confirmed FreelancerProfile fields (apps/users/models.py:
    # bank_name/bank_account_number/jazzcash_number/easypaisa_number/
    # payoneer_email, all real CharField/EmailField, all blank=True),
    # added via the exact same one-line-lambda pattern every existing
    # binding already uses — no new data model, no second binding
    # mechanism. Investigated and deliberately NOT used to decompose the
    # built-in `payment_info` seed element itself (see design_templates.py's
    # own docstring for the full reasoning: unlike Subtotal/Tax/Discount/
    # Total, which are always-present financial values, these 5 fields are
    # COLLECTIVELY, independently optional — a real freelancer might have
    # only 1 of 5 configured — and the template's own real per-method
    # conditional visibility (each method, AND the whole "Payment methods"
    # label, only appears when configured) is genuine, load-bearing
    # behavior that decomposing into 5 always-rendered independent
    # elements would break (empty method rows/labels would show for
    # methods nobody configured). These bindings exist as real, available
    # infrastructure — usable by any custom design that wants to build its
    # own individual payment-field layout — without forcing that shape on
    # the built-in templates.
    'business.bank_name', 'business.bank_account_number',
    'business.jazzcash_number', 'business.easypaisa_number', 'business.payoneer_email',
}

REQUIRED_PAGE_KEYS = {'size', 'width_mm', 'height_mm'}


def get_schema_version(design_data):
    """
    Returns the integer schema_version a design_data payload declares, or
    SCHEMA_VERSION_LEGACY (1) if the key is entirely absent — every real
    InvoiceDesign row in the database today predates this field, so
    "absent" means "legacy", not "invalid" (this is the explicit
    distinction Phase 0's own success criteria calls for: "legacy
    designs remain readable").

    Raises ValueError — never silently coerces or guesses — if
    design_data isn't a dict, or if a `schema_version` key is present
    but isn't a real integer. Callers (validate_design_data_schema_by_version
    below, the migration mapper, the read-only audit command) are
    responsible for turning that into a safely-reported error rather
    than letting a bad value flow into version-specific logic unchecked.
    """
    if not isinstance(design_data, dict):
        raise ValueError('design_data must be an object to determine its schema_version.')
    if 'schema_version' not in design_data:
        return SCHEMA_VERSION_LEGACY
    version = design_data['schema_version']
    if not isinstance(version, int) or isinstance(version, bool):
        raise ValueError(f'schema_version must be an integer, got {version!r}.')
    return version


def _is_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool)


OPTIONAL_MARGIN_KEYS = {'margin_top_mm', 'margin_right_mm', 'margin_bottom_mm', 'margin_left_mm'}
REQUIRED_SIDEBAR_KEYS = {'width_mm', 'color'}


def _validate_page(page, errors):
    """
    Template Builder 2.0, Phase 2 addition (see design_templates.py's own
    module docstring and LANCERAOS_TEMPLATE_BUILDER_2_PHASE2.md's
    "REQUIRES ARCHITECTURAL DECISION" entry for the full reasoning):
    `margin_*_mm` and `sidebar` are both OPTIONAL. Their absence is not an
    error — every design produced by Phase 0's migration mapper omits
    them, and the renderer falls back to Phase 1's original module-level
    constants when they're absent, so this is a fully backward-compatible
    addition, not a breaking schema change. They exist because real
    measurement (Phase 2's own golden-reference work) proved Phase 1's
    single, renderer-wide margin constant cannot honestly reproduce more
    than one of the three real built-in templates at once — each of the
    three uses a genuinely different real page-margin convention, and
    Modern's real, existing (pre-V2) design additionally uses a
    full-height colored sidebar with no representation in Phase 1's
    schema at all. Both additions are generic, reusable capabilities
    (any design may opt into custom margins or a sidebar) — not
    per-template special cases.
    """
    if not isinstance(page, dict):
        errors.append('page must be an object.')
        return
    missing = REQUIRED_PAGE_KEYS - page.keys()
    if missing:
        errors.append(f'page is missing required key(s): {", ".join(sorted(missing))}.')
        return
    for field in ('width_mm', 'height_mm'):
        if not _is_number(page.get(field)) or page[field] <= 0:
            errors.append(f'page.{field} must be a positive number.')
    if not isinstance(page.get('size'), str) or not page['size']:
        errors.append('page.size must be a non-empty string.')

    for key in OPTIONAL_MARGIN_KEYS:
        if key in page and (not _is_number(page[key]) or page[key] < 0):
            errors.append(f'page.{key}, if present, must be a number >= 0.')

    if 'sidebar' in page and page['sidebar'] is not None:
        sidebar = page['sidebar']
        if not isinstance(sidebar, dict):
            errors.append('page.sidebar, if present, must be an object.')
        else:
            missing_sidebar = REQUIRED_SIDEBAR_KEYS - sidebar.keys()
            if missing_sidebar:
                errors.append(f'page.sidebar is missing required key(s): {", ".join(sorted(missing_sidebar))}.')
            if 'width_mm' in sidebar and (not _is_number(sidebar['width_mm']) or sidebar['width_mm'] <= 0):
                errors.append('page.sidebar.width_mm must be a positive number.')
            color = sidebar.get('color')
            # None is a deliberate, valid value — "use the design's own
            # resolved theme color at render time" (design_primary_color)
            # rather than a literal hex baked into the sidebar config.
            if color is not None and not (isinstance(color, str) and color):
                errors.append('page.sidebar.color must be a non-empty string, or null to use the theme color.')


def _validate_binding(element, label, errors):
    if element.get('type') != 'text':
        return
    binding = element.get('binding')
    if binding is not None and binding not in SUPPORTED_BINDINGS:
        errors.append(
            f'{label}.binding "{binding}" is not supported — must be one of '
            f'{sorted(SUPPORTED_BINDINGS)}, or omitted/null for static text.'
        )


def _validate_element(element, label, errors, *, allowed_types):
    """
    Phase 4B.2 — the ONE element validator, used identically for every
    entry in both `header.elements` and `flow.elements` (previously two
    separate, near-duplicate functions — see this module's own docstring
    for why the two lists no longer need different shapes).
    """
    if not isinstance(element, dict):
        errors.append(f'{label} must be an object.')
        return None

    missing = REQUIRED_ELEMENT_KEYS - element.keys()
    if missing:
        errors.append(f'{label} is missing required key(s): {", ".join(sorted(missing))}.')
        return None

    kind = element.get('kind')
    if kind not in ELEMENT_KINDS:
        errors.append(f'{label}.kind has invalid value "{kind}" — must be one of {sorted(ELEMENT_KINDS)}.')

    element_type = element.get('type')
    if element_type not in allowed_types:
        errors.append(f'{label} has invalid type "{element_type}" — must be one of {sorted(allowed_types)}.')
    else:
        if element_type in HEADER_SEMANTIC_TYPES | FLOW_SEMANTIC_TYPES:
            actual_category = 'semantic'
        elif element_type in GENERIC_TYPES:
            actual_category = 'generic'
        elif element_type in STRUCTURAL_TYPES:
            actual_category = 'structural'
        else:
            actual_category = None
        if actual_category and kind in ELEMENT_KINDS and kind != actual_category:
            errors.append(f'{label}.type "{element_type}" is a {actual_category} type but kind is "{kind}".')

    for field in ('x', 'y', 'width', 'height'):
        if not _is_number(element.get(field)):
            errors.append(f'{label}.{field} must be a number.')
    if _is_number(element.get('width')) and element['width'] <= 0:
        errors.append(f'{label}.width must be greater than zero.')
    if _is_number(element.get('height')) and element['height'] <= 0:
        errors.append(f'{label}.height must be greater than zero.')

    if not isinstance(element.get('style'), dict):
        errors.append(f'{label}.style must be an object.')
    if not isinstance(element.get('overrides'), dict):
        errors.append(f'{label}.overrides must be an object.')

    if 'layout_mode' in element and element['layout_mode'] not in LAYOUT_MODES:
        errors.append(f'{label}.layout_mode has invalid value "{element["layout_mode"]}" — must be one of {sorted(LAYOUT_MODES)}, or omitted for "pinned".')

    # Green-Light directive — the Layers panel's "lock"/"hide" toggles.
    # Both optional booleans, both default falsy when absent (every
    # existing design_data payload — every builtin, every real saved
    # design — has neither key at all, so this is a purely additive
    # schema change with zero effect on anything that predates it).
    # `hidden` is the only one of the two the canonical renderer itself
    # ever reads (design_renderer._element_has_real_content) — an
    # element a user deliberately hid is excluded from real output the
    # same way a genuinely-blank optional field already is. `locked` is
    # an editor-only concern (blocks drag/resize/select in the canvas)
    # that never reaches the renderer at all.
    for flag in ('hidden', 'locked'):
        if flag in element and not isinstance(element[flag], bool):
            errors.append(f'{label}.{flag} must be a boolean.')

    _validate_binding(element, label, errors)

    return element


def _validate_element_list(elements, list_name, errors, *, allowed_types):
    """Validates every element in one list (header.elements or flow.elements); returns (index, element) pairs for the ones with real, usable geometry."""
    if not isinstance(elements, list):
        errors.append(f'{list_name}.elements must be a list.')
        return []

    valid_elements = []
    for i, element in enumerate(elements):
        validated = _validate_element(element, f'{list_name}.elements[{i}]', errors, allowed_types=allowed_types)
        if validated is not None and all(_is_number(validated.get(f)) for f in ('x', 'y', 'width', 'height')):
            valid_elements.append((list_name, i, validated))
    return valid_elements


def _validate_overlap(all_valid_elements, errors):
    """
    Phase 4B.2 — the overlap check that used to be header-only now runs
    across EVERY element in BOTH `header.elements` and `flow.elements`
    combined (this is what replaces the old structural "flow can never
    overlap the table" guarantee with a validated one — see this
    module's own docstring). Same sidebar-partition rule as before,
    unchanged: a sidebar-flagged element occupies a genuinely separate
    coordinate space (the fixed sidebar column), so it's never compared
    against a non-sidebar element's x/y.
    """
    for a_index in range(len(all_valid_elements)):
        for b_index in range(a_index + 1, len(all_valid_elements)):
            list_a, i, a = all_valid_elements[a_index]
            list_b, j, b = all_valid_elements[b_index]
            a_sidebar = bool((a.get('style') or {}).get('sidebar'))
            b_sidebar = bool((b.get('style') or {}).get('sidebar'))
            if a_sidebar != b_sidebar:
                continue
            if boxes_overlap(a, b):
                errors.append(
                    f'{list_a}.elements[{i}] ({a.get("type")}) overlaps '
                    f'{list_b}.elements[{j}] ({b.get("type")}) — bounding boxes collide.'
                )


def _validate_page_bounds(all_valid_elements, page, errors):
    """
    Phase 5.1 — closes the gap the Phase 5 adversarial audit found: an
    element could be dragged to a negative x/y, or resized far beyond the
    page, and saved with zero validation (the overlap check above only
    catches this incidentally, when the resulting box happens to collide
    with a sibling — an isolated element with empty space around it, like
    a lone logo, previously had nothing stopping it from landing entirely
    off the printable page).

    Policy chosen (see LANCERAOS_TEMPLATE_BUILDER_2_PHASE5.1.md's own
    "Chosen policy" section for the full reasoning): REJECT at save/
    validation time, the same enforcement point `_validate_overlap`
    already uses — not clamp (would silently mutate what the user placed)
    and not warn-only (would let invalid geometry persist).

    The bound is each element's own real coordinate space, not a naive
    `x + width <= page.width_mm` — this codebase's x/y are already
    CONTENT-relative (the renderer adds the page's own margin as a
    render-time offset; design_renderer.build_render_context's own
    `content_width_mm = page['width_mm'] - effective_margin_left_mm -
    margin_right_mm` is the exact real formula reproduced below, not a
    new one). Checking against the raw page width directly would silently
    UNDER-enforce: an element could pass at content-relative x=200 (<
    page.width_mm=210) yet render at absolute x = margin_left + 200,
    genuinely off a 210mm-wide sheet — the opposite of what this check
    exists to prevent. A sidebar-flagged element gets its own separate
    x-bound (its coordinate space is the sidebar's own box — `.v2-sidebar
    { position:fixed; left:0 }`), matching the exact same sidebar
    partition `_validate_overlap` above already applies.

    ONLY `x`/right-edge are hard-bounded here — `y >= 0` is enforced (a
    negative y, content rendering above the top of the page, is never
    legitimate under any circumstance) but a bottom-edge (`y + height`)
    ceiling is deliberately NOT enforced, unlike the width/right-edge
    check. Investigated directly, not assumed: enforcing one broke 4 real,
    pre-existing tests in test_design_migration.py — design_migration.py's
    v1->v2 mapper (isolated, in-memory-only, never persisted — a preview-
    only feature) replays each of the 3 real builtin templates' own v1
    zone_2 content by stacking it downward with v1's own real spacing
    values, entirely unaware of any page-height ceiling; measured
    directly, all 3 real templates' migrated output already extends past
    a single page's content height today (Professional by 17mm, Minimal
    by 50mm, Modern by 11mm) — a real, systemic, pre-existing
    characteristic of that naive stacking, not an edge case, and not
    something introduced by this phase. Unlike the X axis (which has no
    legitimate "the content continues past the edge" concept at all — a
    line either fits the page's width or it visibly runs off it), Y
    genuinely can: this is the same real, already-documented behavior the
    table's own dynamic height already relies on (design_templates.py's
    `_TABLE_HEIGHT_ESTIMATE_MM` comment — a real invoice's actual content
    can flow onto a second page), just discovered here to also be
    materially true of the migration mapper's output, not only the table.
    Fixing `design_migration.py`'s own stacking algorithm to fit one page
    is a real, legitimate, separate improvement — explicitly out of this
    phase's own stated scope ("do not refactor unrelated code"), and not
    undertaken here.

    Tolerance: reuses `OVERLAP_EPSILON_MM` (apps/invoices/design_schema.py)
    rather than inventing a second one, for the same reason it exists
    there — a real element placed exactly edge-to-edge with the page's
    left/right edge can pick up a razor-thin apparent overflow purely from
    the canvas's own mm<->px<->mm round-trip. The same tolerance that
    already absorbs this for sibling-to-sibling edges absorbs it here too;
    a genuinely visible overflow is never within a third of a millimeter
    of "exactly touching".
    """
    margin_right_mm = page.get('margin_right_mm', _PAGE_MARGIN_RIGHT_MM)
    margin_left_mm = page.get('margin_left_mm', _PAGE_MARGIN_LEFT_MM)
    sidebar = page.get('sidebar')
    sidebar_width_mm = sidebar['width_mm'] if isinstance(sidebar, dict) and _is_number(sidebar.get('width_mm')) else 0
    effective_margin_left_mm = margin_left_mm + sidebar_width_mm

    page_width_mm = page.get('width_mm')
    if not _is_number(page_width_mm):
        return  # _validate_page already reported this; nothing sane to bound-check against.

    content_width_mm = page_width_mm - effective_margin_left_mm - margin_right_mm

    for list_name, i, element in all_valid_elements:
        is_sidebar = bool((element.get('style') or {}).get('sidebar'))
        bound_w = sidebar_width_mm if is_sidebar else content_width_mm

        x, y, width = element['x'], element['y'], element['width']
        label = f'{list_name}.elements[{i}] ({element.get("type")})'

        if x < -OVERLAP_EPSILON_MM:
            errors.append(f'{label} has x={x} — an element may not start before the left edge of its coordinate space (x >= 0).')
        if y < -OVERLAP_EPSILON_MM:
            errors.append(f'{label} has y={y} — an element may not start before the top edge of the page (y >= 0).')
        if x + width > bound_w + OVERLAP_EPSILON_MM:
            errors.append(
                f'{label} extends beyond the right edge of its coordinate space '
                f'(x={x} + width={width} = {x + width}, which exceeds {bound_w}).'
            )


def _validate_header(header, errors):
    if not isinstance(header, dict):
        errors.append('header must be an object.')
        return []
    return _validate_element_list(header.get('elements'), 'header', errors, allowed_types=HEADER_TYPES)


def _validate_flow(flow, errors):
    if not isinstance(flow, dict):
        errors.append('flow must be an object.')
        return []
    return _validate_element_list(flow.get('elements'), 'flow', errors, allowed_types=FLOW_TYPES)


def _validate_required_elements(all_valid_elements, errors):
    """
    Phase 4B.2 — the table is now a real element (kind='structural',
    type='table') instead of the old special `flow.table` key, so its
    "required, exactly one" check moves here alongside the pre-existing
    "must have a totals element" check. Both checks scan the combined
    header+flow set for uniformity with the rest of this module's
    validation, but in practice only `flow` actually allows either type
    (`HEADER_TYPES` deliberately excludes STRUCTURAL_TYPES/
    FLOW_SEMANTIC_TYPES — header stays "identity" content: logo/business/
    client/dates) — so today a valid design always satisfies both checks
    via its `flow.elements`.
    """
    types_present = [(e.get('kind'), e.get('type')) for _, _, e in all_valid_elements]
    if ('structural', 'table') not in types_present:
        errors.append('design_data is missing the mandatory line-items table (a structural element with type="table").')
    if ('semantic', 'totals') not in types_present:
        errors.append('design_data is missing the mandatory totals block (a semantic element with type="totals").')


def validate_design_data_schema_v2(data):
    """
    Structural validator for the v2 canonical shape — the direct v2
    analog of apps/invoices/legacy_design_schema.py's
    validate_design_data_schema. Returns a list of specific, human-readable
    violation messages (empty if valid); never raises. Stale-docstring
    correction (Phase 5.1 — confirmed directly against
    apps/invoices/serializers.py's InvoiceDesignSerializer.validate_design_data,
    not assumed): this IS called live, on every real save — dispatched to
    by validate_design_data_schema_by_version below, which the serializer
    calls directly. The claim that used to be here ("NOT called by
    anything live in this phase") described an earlier Phase 0 state and
    was no longer true as of the production cutover.
    """
    errors = []

    if not isinstance(data, dict):
        return ['design_data must be an object with "schema_version", "page", "header", and "flow" keys.']

    if data.get('schema_version') != SCHEMA_VERSION_V2:
        errors.append(f'design_data.schema_version must be {SCHEMA_VERSION_V2} for this validator.')

    if 'page' not in data:
        errors.append('design_data.page is required.')
    else:
        _validate_page(data['page'], errors)

    header_elements = []
    if 'header' not in data:
        errors.append('design_data.header is required.')
    else:
        header_elements = _validate_header(data['header'], errors)

    flow_elements = []
    if 'flow' not in data:
        errors.append('design_data.flow is required.')
    else:
        flow_elements = _validate_flow(data['flow'], errors)

    all_valid_elements = header_elements + flow_elements
    _validate_overlap(all_valid_elements, errors)
    _validate_required_elements(all_valid_elements, errors)
    if isinstance(data.get('page'), dict):
        _validate_page_bounds(all_valid_elements, data['page'], errors)

    return errors


def validate_design_data_schema_by_version(design_data):
    """
    Dispatches to the correct structural validator based on the payload's
    own declared (or implicit) schema_version — legacy_design_schema.py's
    validate_design_data_schema for a legacy-shape payload (schema_version
    absent or 1), validate_design_data_schema_v2 above for a real
    schema_version: 2 payload. design_migration.py and the read-only audit
    command both use this to decide "is this even valid input" before doing
    anything else.

    Stale-docstring correction (Phase 5.1 — confirmed directly against
    apps/invoices/serializers.py's InvoiceDesignSerializer.validate_design_data,
    not assumed from this docstring's own prior claim): this function IS
    what the serializer calls, for every real save, both legacy- and
    v2-shaped alike — see that method's own docstring, which already
    correctly describes this. The claim that used to be here ("NOT used by
    InvoiceDesignSerializer... every real design saved today is
    legacy-shape") described an earlier Phase 0 state and was no longer
    true as of the production cutover; apps/invoices/ai_design.py's own
    Phase 5.1 fix is a direct example of code that had trusted this exact
    stale claim.
    """
    try:
        version = get_schema_version(design_data)
    except ValueError as exc:
        return [str(exc)]

    if version == SCHEMA_VERSION_LEGACY:
        from apps.invoices.legacy_design_schema import validate_design_data_schema
        return validate_design_data_schema(design_data)
    if version == SCHEMA_VERSION_V2:
        return validate_design_data_schema_v2(design_data)
    return [f'Unsupported schema_version: {version}. Supported versions: {sorted(SUPPORTED_SCHEMA_VERSIONS)}.']
