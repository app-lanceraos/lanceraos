# apps/invoices/design_validation.py
"""
Template Builder 2.0 — Phase 0 foundation only: the structured-finding
validation framework LANCERAOS_TEMPLATE_BUILDER_2_ARCHITECTURE_PLAN.md's
Section 12 describes (schema / layout / semantic / renderability layers,
each returning {code, severity, category, component_id, message}
findings rather than the plain string list apps.invoices.design_schema's
validator returns).

This module is NOT called from InvoiceDesignSerializer, any view, or any
save/publish path in this phase. InvoiceDesignSerializer.validate_design_data
continues to call apps.invoices.design_schema.validate_design_data_schema
directly and unconditionally, exactly as before — Save behavior is
completely unchanged by this file existing.

Green-Light directive ("Complete validation Layers A/B/C/D with a
user-friendly Template Health UI") — Layers C and D are now real for v2
designs; both this module's own reasoning here and the tests were
updated to match. Kept scoped to schema_version==2 only: v1's split
static/dynamic renderer is being phased out, not extended, so neither
new layer runs against a legacy design (they return `[]` for one,
exactly like Phase 0 did — not a new gap, the same deliberate v1/v2
boundary every other Phase 1+ module in this codebase already draws).

  - Layer A (schema): real, unchanged — delegates to the existing,
    already-tested per-version structural validators (design_schema.py
    for v1, design_schema.py for v2).
  - Layer B (layout): re-verified, still a genuine no-op — Phase 5.1's
    own `_validate_page_bounds`/`_validate_overlap` (design_schema.py)
    already closed the one real layout risk this layer's Phase 0
    docstring named (off-page bounds), as part of Layer A itself. There
    is still no functional gap for this layer to fill without inventing
    an arbitrary heuristic — left as a named, empty seam rather than
    manufacturing a check just to have one.
  - Layer C (semantic): real for v2. Catches TB-004 (no element shows
    the invoice number) plus 3 siblings in the same spirit (no due date,
    no client identity, a totals block that never actually includes the
    grand total row) — a conservative, concrete set chosen from what
    SUPPORTED_BINDINGS/the mandatory-totals-element rule already make
    checkable without inventing a new required-field policy; every
    finding is a WARNING (this system draws no Draft/Publish line, so
    nothing here ever blocks a save — see DECISIONS.md).
  - Layer D (renderability): real for v2, given a real `invoice_context`
    (whatever `build_render_context` already produces). A genuine
    dry-run through `render_design_html`, output discarded, catching
    any `DesignRenderError` a structurally-valid-but-unrenderable design
    could still raise (e.g. a binding resolver hitting missing context).
    Only attempted once Layer A itself finds the design schema-valid —
    running a dry-render against already-broken structure would just
    re-report the same problem, or crash on it, neither useful.
"""
import copy

from apps.invoices.legacy_design_schema import validate_design_data_schema
from apps.invoices.design_schema import (
    SCHEMA_VERSION_LEGACY,
    SCHEMA_VERSION_V2,
    get_schema_version,
    validate_design_data_schema_v2,
)

SEVERITY_ERROR = 'error'
SEVERITY_WARNING = 'warning'
SEVERITIES = {SEVERITY_ERROR, SEVERITY_WARNING}

CATEGORY_SCHEMA = 'schema'
CATEGORY_LAYOUT = 'layout'
CATEGORY_SEMANTIC = 'semantic'
CATEGORY_RENDERABILITY = 'renderability'

ALL_LAYERS = ('schema', 'layout', 'semantic', 'renderability')


def make_finding(code, severity, category, message, component_id=None):
    """
    A plain, JSON-native structured finding — no new class hierarchy,
    matching this codebase's existing preference for simple dict/list
    return shapes (apps.invoices.design_schema.validate_design_data_schema
    already returns a plain list[str]; this is the same philosophy,
    extended with the extra fields the architecture plan's Section 12
    calls for so a UI can eventually group by severity/category and
    jump directly to a specific component).
    """
    if severity not in SEVERITIES:
        raise ValueError(f'severity must be one of {sorted(SEVERITIES)}, got {severity!r}.')
    return {
        'code': code,
        'severity': severity,
        'category': category,
        'component_id': component_id,
        'message': message,
    }


def _validate_schema_layer(design_data):
    """Layer A — real. Delegates to the correct per-version structural validator."""
    try:
        version = get_schema_version(design_data)
    except ValueError as exc:
        return [make_finding('SCHEMA_VERSION_INVALID', SEVERITY_ERROR, CATEGORY_SCHEMA, str(exc))]

    if version == SCHEMA_VERSION_LEGACY:
        raw_errors = validate_design_data_schema(design_data)
    elif version == SCHEMA_VERSION_V2:
        raw_errors = validate_design_data_schema_v2(design_data)
    else:
        return [make_finding(
            'SCHEMA_VERSION_UNSUPPORTED', SEVERITY_ERROR, CATEGORY_SCHEMA,
            f'schema_version {version} is not supported by this validator.',
        )]

    return [make_finding('SCHEMA_STRUCTURAL_ERROR', SEVERITY_ERROR, CATEGORY_SCHEMA, msg) for msg in raw_errors]


def _validate_layout_layer(design_data):
    """Layer B — genuinely empty; see module docstring for why."""
    return []


def _v2_schema_valid_elements(design_data):
    """
    Shared guard for Layers C/D: returns the design's real
    header+flow element list ONLY when `design_data` is both a real v2
    document and already schema-valid — otherwise `None`. Neither layer
    duplicates Layer A's own errors or attempts to inspect/render a
    document Layer A has already rejected.
    """
    try:
        version = get_schema_version(design_data)
    except (ValueError, TypeError):
        return None
    if version != SCHEMA_VERSION_V2:
        return None
    if validate_design_data_schema_v2(design_data):
        return None
    return design_data['header']['elements'] + design_data['flow']['elements']


def _validate_semantic_layer(design_data, invoice_context=None):
    """
    Layer C — real for v2 (see module docstring). Every finding is a
    WARNING: this is guidance ("a client may struggle to reference this
    invoice"), never a hard block — no Draft/Publish distinction exists
    in this system for it to gate.
    """
    elements = _v2_schema_valid_elements(design_data)
    if elements is None:
        return []

    def has_binding(binding_name):
        return any(
            el.get('kind') == 'generic' and el.get('type') == 'text' and el.get('binding') == binding_name
            for el in elements
        )

    def has_semantic_type(type_name):
        return any(el.get('kind') == 'semantic' and el.get('type') == type_name for el in elements)

    findings = []
    if not has_binding('invoice.number'):
        findings.append(make_finding(
            'MISSING_INVOICE_NUMBER', SEVERITY_WARNING, CATEGORY_SEMANTIC,
            'No element on this design shows the invoice number — clients may have trouble referencing it.',
        ))
    if not has_binding('invoice.due_date'):
        findings.append(make_finding(
            'MISSING_DUE_DATE', SEVERITY_WARNING, CATEGORY_SEMANTIC,
            'No element on this design shows the due date.',
        ))
    if not (has_binding('client.name') or has_semantic_type('client_info')):
        findings.append(make_finding(
            'MISSING_CLIENT_NAME', SEVERITY_WARNING, CATEGORY_SEMANTIC,
            'No element on this design shows who the invoice is billed to.',
        ))

    # The mandatory totals element (Layer A already guarantees exactly
    # one exists) can still be configured to show only Subtotal/Tax/
    # Discount rows without ever including the actual grand total —
    # that's a real, distinct gap Layer A's "does a totals element
    # exist" check doesn't cover.
    totals_elements = [el for el in elements if el.get('kind') == 'semantic' and el.get('type') == 'totals']
    shows_grand_total = any('total' in ((el.get('style') or {}).get('rows') or []) for el in totals_elements)
    if totals_elements and not shows_grand_total:
        findings.append(make_finding(
            'MISSING_GRAND_TOTAL', SEVERITY_WARNING, CATEGORY_SEMANTIC,
            'The totals block on this design never shows the final grand total row.',
        ))
    return findings


def _validate_renderability_layer(design_data, invoice_context=None):
    """
    Layer D — real for v2, only when a real `invoice_context` is
    supplied (whatever `build_render_context` already produces —
    callers with nothing real to render against simply don't get this
    layer's coverage, the same "no context, no check" precedent Layer C
    already sets for its own `invoice_context` parameter).
    """
    if invoice_context is None:
        return []
    elements = _v2_schema_valid_elements(design_data)
    if elements is None:
        return []
    from apps.invoices.design_renderer import DesignRenderError, render_design_html

    try:
        render_design_html(copy.deepcopy(design_data), invoice_context)
    except DesignRenderError as exc:
        return [make_finding('RENDER_FAILED', SEVERITY_ERROR, CATEGORY_RENDERABILITY, str(exc))]
    except (KeyError, AttributeError, TypeError) as exc:
        # A real, confirmed gap this layer's own writing surfaced: unlike
        # `resolve_binding` (which deliberately converts a missing-context
        # KeyError/AttributeError into DesignRenderError),
        # `_element_has_real_content`'s own `context['freelancer']`/
        # similar direct lookups do not — an incomplete `invoice_context`
        # raises the raw exception instead. Layer D's entire purpose is to
        # report a rendering problem as a finding, never crash the caller,
        # so it catches the same exception classes `resolve_binding`
        # already treats as "missing required context" here too, rather
        # than letting this one specific code path bypass that contract.
        return [make_finding(
            'RENDER_FAILED', SEVERITY_ERROR, CATEGORY_RENDERABILITY,
            f'Could not render this design against the supplied context: {exc}',
        )]
    return []


def run_validation(design_data, invoice_context=None, layers=None):
    """
    Runs the requested validation layers (default: all four) against
    design_data and returns:
        {"valid": bool, "errors": [...], "warnings": [...]}
    where every entry is a make_finding()-shaped dict. `valid` is True
    iff there are zero severity=="error" findings across every layer
    run — warnings never affect `valid` (matching the architecture
    plan's Save-Draft-vs-Publish distinction: a design should be able to
    save with warnings, never silently swallowed, but not blocked by them).

    `invoice_context` (Green-Light directive — was unused in Phase 0):
    whatever `build_render_context(user, base_template, color_variant,
    invoice=...)` already produces. Layer C's client/due-date/total
    checks run regardless; Layer D's real dry-run render only runs when
    this is supplied (see that layer's own docstring).

    Called for real now (Green-Light directive) by
    `apps.invoices.views_design_editor`'s Template Health endpoint — still
    never wired into InvoiceDesignSerializer's own save-time validation,
    by design: every finding here is advisory (WARNING severity, or an
    ERROR only for Layer D's genuine render failure), never a save-time
    block, since this system draws no Draft/Publish line for it to gate.
    """
    if layers is None:
        layers = ALL_LAYERS

    findings = []
    if 'schema' in layers:
        findings.extend(_validate_schema_layer(design_data))
    if 'layout' in layers:
        findings.extend(_validate_layout_layer(design_data))
    if 'semantic' in layers:
        findings.extend(_validate_semantic_layer(design_data, invoice_context))
    if 'renderability' in layers:
        findings.extend(_validate_renderability_layer(design_data, invoice_context))

    errors = [f for f in findings if f['severity'] == SEVERITY_ERROR]
    warnings = [f for f in findings if f['severity'] == SEVERITY_WARNING]
    return {'valid': not errors, 'errors': errors, 'warnings': warnings}
