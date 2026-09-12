# apps/invoices/legacy_design_schema.py
"""
RETIRED (production cutover) — the original zone_1/zone_2 design_data
contract, superseded by design_schema.py's header/flow schema
(schema_version 2) for every design created from this cutover onward.
Kept, unmodified, for exactly one reason: some pre-existing InvoiceDesign
rows still hold data in this shape and haven't been (or couldn't be)
migrated — this module is what still lets those rows validate, and
legacy_design_renderer.py is what still lets them render. No save path
produces this shape anymore; see design_migration.py for the one-way
converter into the production shape, and design_schema.py's own
get_schema_version() for how a row's shape is detected.

Historical note: written directly from the task's own schema description
plus the real structure of the 3 built templates
(apps/invoices/templates/invoices/*.html).

Two-zone model:

- zone_1 (fixed, above the line-items table): a list of absolutely
  positioned elements. Valid because Zone 1's total height is always
  known ahead of render time — nothing above the table can grow
  unpredictably.
  Element shape: {"type", "x", "y", "width", "height", "style"}
  (x/y/width/height in mm, style a free-form dict — Step 8b's own style
  panel defines exactly what's editable inside it, not this step).

- zone_2 (the table and everything after it): the table has a start
  position but deliberately no fixed height, since the number of line
  items is not knowable in advance. Everything after the table is
  therefore stored as a flow, not a set of independent coordinates —
  {"type", "spacing_after_previous", "style"} — so an element can never
  overlap something that might grow. The line-items table itself and
  the totals block are structurally mandatory (validated below, not
  left to editor-side convention).
  The only positioning exception: exactly two zone_2 elements may be
  marked paired_side_by_side: true, and only if both are from the
  fixed-height, non-reflowing set (signature, payment_info) — validated
  explicitly, not left to convention.
"""

ZONE_1_TYPES = {'logo', 'business_info', 'client_info', 'dates'}
ZONE_2_TYPES = {'totals', 'notes', 'signature', 'payment_info'}
PAIRABLE_ZONE_2_TYPES = {'signature', 'payment_info'}

REQUIRED_ZONE_1_ELEMENT_KEYS = {'type', 'x', 'y', 'width', 'height', 'style'}
REQUIRED_ZONE_2_ELEMENT_KEYS = {'type', 'spacing_after_previous', 'style'}


def _is_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _validate_zone_1_element(element, index, errors):
    label = f'zone_1.elements[{index}]'
    if not isinstance(element, dict):
        errors.append(f'{label} must be an object.')
        return None

    missing = REQUIRED_ZONE_1_ELEMENT_KEYS - element.keys()
    if missing:
        errors.append(f'{label} is missing required key(s): {", ".join(sorted(missing))}.')
        return None

    element_type = element.get('type')
    if element_type not in ZONE_1_TYPES:
        errors.append(f'{label} has invalid type "{element_type}" — must be one of {sorted(ZONE_1_TYPES)}.')

    for field in ('x', 'y', 'width', 'height'):
        if not _is_number(element.get(field)):
            errors.append(f'{label}.{field} must be a number.')
    if _is_number(element.get('width')) and element['width'] <= 0:
        errors.append(f'{label}.width must be greater than zero.')
    if _is_number(element.get('height')) and element['height'] <= 0:
        errors.append(f'{label}.height must be greater than zero.')

    if not isinstance(element.get('style'), dict):
        errors.append(f'{label}.style must be an object.')

    return element


## Template Builder 2.0, Phase 4B.2 — a real, confirmed false-positive found via
# this phase's own live-browser verification: two elements placed exactly
# edge-to-edge (zero gap) in a design's own source geometry — a completely
# normal, common layout pattern (e.g. a label stacked directly above a value)
# — can pick up a razor-thin (a few hundredths of a mm) apparent overlap
# purely from the canvas's mandatory mm -> px -> mm round-trip (Phase 3's own
# coordinate-conversion boundary): `y` and `height` each round independently
# at the canvas's own px granularity, so their SUM (the bottom edge) can drift
# by a tiny fraction of a mm relative to a sibling's own independently-rounded
# top edge, even though neither value was ever touched by a real edit.
# Confirmed directly: `client.name` (y=46mm, height=5mm in the seed) and
# `client.company` (y=51mm) — exactly touching, zero gap, in
# design_templates.py — round-tripped through the real canvas to
# y=46.04/height=5.03 (bottom=51.07) and y=51.06, a genuine 0.01mm overlap by
# the letter of the math, and were rejected by validation on a save that never
# touched either element. Left unfixed, this would make an otherwise-true
# no-op save (open a design, edit something unrelated, save) fail outright
# whenever ANY pair of elements happens to sit edge-to-edge — a real
# regression risk against the "no-op save never changes/breaks anything"
# guarantee this whole schema exists to protect. `OVERLAP_EPSILON_MM` absorbs
# exactly this class of round-trip noise (comfortably larger than the ~0.13mm
# per-value worst case at this canvas's own mm<->px granularity) without
# masking a real, meaningfully-sized collision between two actually-distinct
# elements.
OVERLAP_EPSILON_MM = 0.3


def boxes_overlap(a, b):
    """
    Simple axis-aligned rectangle collision — the save-time overlap check the spec calls for.
    Public (not `_boxes_overlap`, its original name) as of Template Builder 2.0 Phase 0 — the v2
    schema scaffold (design_schema.py) reuses this exact function for its own header-zone
    overlap check rather than redefining the same 4-line rectangle-collision test a second time,
    per STANDARDS.md's single-source-of-truth rule. Purely a visibility rename; behavior and every
    existing call site within this file are unchanged.

    Phase 4B.2: a small epsilon (see OVERLAP_EPSILON_MM above) is subtracted
    from each "no overlap" gap check, so two boxes separated by less than
    that tolerance — including a genuine zero-gap, edge-to-edge placement
    that has merely round-tripped through mm<->px conversion — are still
    treated as non-overlapping. This makes the check very slightly more
    permissive than pure axis-aligned collision, deliberately: a real,
    meaningfully-sized overlap (the actual thing this function exists to
    catch) is never within a third of a millimeter of "just touching".
    """
    return not (
        a['x'] + a['width'] <= b['x'] + OVERLAP_EPSILON_MM
        or b['x'] + b['width'] <= a['x'] + OVERLAP_EPSILON_MM
        or a['y'] + a['height'] <= b['y'] + OVERLAP_EPSILON_MM
        or b['y'] + b['height'] <= a['y'] + OVERLAP_EPSILON_MM
    )


def _validate_zone_1(zone_1, errors):
    if not isinstance(zone_1, dict):
        errors.append('zone_1 must be an object.')
        return

    elements = zone_1.get('elements')
    if not isinstance(elements, list):
        errors.append('zone_1.elements must be a list.')
        return

    valid_elements = []
    for i, element in enumerate(elements):
        validated = _validate_zone_1_element(element, i, errors)
        if validated is not None and all(_is_number(validated.get(f)) for f in ('x', 'y', 'width', 'height')):
            valid_elements.append((i, validated))

    # Overlap check only applies within zone_1 — zone_2 elements are
    # structurally incapable of overlapping by construction (spacing-flow,
    # not independent coordinates), so there's nothing to check there.
    for a_index in range(len(valid_elements)):
        for b_index in range(a_index + 1, len(valid_elements)):
            i, a = valid_elements[a_index]
            j, b = valid_elements[b_index]
            if boxes_overlap(a, b):
                errors.append(
                    f'zone_1.elements[{i}] ({a.get("type")}) overlaps '
                    f'zone_1.elements[{j}] ({b.get("type")}) — bounding boxes collide.'
                )


def _validate_zone_2_element(element, index, errors):
    label = f'zone_2.elements[{index}]'
    if not isinstance(element, dict):
        errors.append(f'{label} must be an object.')
        return None

    missing = REQUIRED_ZONE_2_ELEMENT_KEYS - element.keys()
    if missing:
        errors.append(f'{label} is missing required key(s): {", ".join(sorted(missing))}.')
        return None

    element_type = element.get('type')
    if element_type not in ZONE_2_TYPES:
        errors.append(f'{label} has invalid type "{element_type}" — must be one of {sorted(ZONE_2_TYPES)}.')

    spacing = element.get('spacing_after_previous')
    if not _is_number(spacing) or spacing < 0:
        errors.append(f'{label}.spacing_after_previous must be a number >= 0.')

    if not isinstance(element.get('style'), dict):
        errors.append(f'{label}.style must be an object.')

    if 'paired_side_by_side' in element and not isinstance(element['paired_side_by_side'], bool):
        errors.append(f'{label}.paired_side_by_side must be a boolean.')

    return element


def _validate_pairing_rule(elements, errors):
    paired = [(i, e) for i, e in enumerate(elements) if isinstance(e, dict) and e.get('paired_side_by_side') is True]

    if not paired:
        return
    if len(paired) != 2:
        indices = ', '.join(str(i) for i, _ in paired)
        errors.append(
            f'paired_side_by_side must be set on exactly two zone_2 elements when used at all '
            f'(found {len(paired)}: index/indices {indices}).'
        )
        return

    for i, element in paired:
        element_type = element.get('type')
        if element_type not in PAIRABLE_ZONE_2_TYPES:
            errors.append(
                f'zone_2.elements[{i}] has paired_side_by_side=true but type "{element_type}" is not '
                f'pairable — only {sorted(PAIRABLE_ZONE_2_TYPES)} may be paired side-by-side.'
            )


def _validate_zone_2(zone_2, errors):
    if not isinstance(zone_2, dict):
        errors.append('zone_2 must be an object.')
        return

    # The line-items table — structurally mandatory. No x/y: the spec
    # deliberately gives it a start position but no fixed height, so it
    # carries only style, never coordinates.
    table = zone_2.get('table')
    if table is None:
        errors.append('zone_2.table (the line-items table) is required and cannot be omitted.')
    elif not isinstance(table, dict):
        errors.append('zone_2.table must be an object.')
    elif not isinstance(table.get('style'), dict):
        errors.append('zone_2.table.style must be an object.')

    elements = zone_2.get('elements')
    if not isinstance(elements, list):
        errors.append('zone_2.elements must be a list.')
        return

    valid_elements = []
    for i, element in enumerate(elements):
        validated = _validate_zone_2_element(element, i, errors)
        valid_elements.append(validated)

    if not any(isinstance(e, dict) and e.get('type') == 'totals' for e in valid_elements):
        errors.append('zone_2.elements is missing the mandatory totals block (an element with type="totals").')

    _validate_pairing_rule(valid_elements, errors)


def validate_design_data_schema(data):
    """
    Returns a list of specific, human-readable violation messages — empty
    if `data` is a fully valid design_data payload. Never raises; callers
    (the serializer, and this step's own tests dogfooding the seed data)
    decide what to do with the list.
    """
    errors = []

    if not isinstance(data, dict):
        return ['design_data must be an object with "zone_1" and "zone_2" keys.']

    if 'zone_1' not in data:
        errors.append('design_data.zone_1 is required.')
    else:
        _validate_zone_1(data['zone_1'], errors)

    if 'zone_2' not in data:
        errors.append('design_data.zone_2 is required.')
    else:
        _validate_zone_2(data['zone_2'], errors)

    return errors
