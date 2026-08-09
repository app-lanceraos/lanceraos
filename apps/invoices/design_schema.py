# apps/invoices/design_schema.py
"""
Step 8 — the design_data JSON contract for InvoiceDesign, shared between
this step's save-time validation and Step 8b's canvas editor. Not
documented anywhere as a literal "Section 9/10" in this repo (checked
INVOICES_CLIENTS_TECHNICAL_SPEC.md, DECISIONS.md, DATABASE.md,
INVOICES_MODULE_KICKOFF.md, DESIGN.md — all reference "decisions doc
Section 9/10" but no such numbered section exists anywhere; see
DECISIONS.md for this gap being flagged rather than silently assumed).
This module IS that contract now, written directly from the task's own
schema description plus the real structure of the 3 built templates
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


def _boxes_overlap(a, b):
    """Simple axis-aligned rectangle collision — the save-time overlap check the spec calls for."""
    return not (
        a['x'] + a['width'] <= b['x']
        or b['x'] + b['width'] <= a['x']
        or a['y'] + a['height'] <= b['y']
        or b['y'] + b['height'] <= a['y']
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
            if _boxes_overlap(a, b):
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
