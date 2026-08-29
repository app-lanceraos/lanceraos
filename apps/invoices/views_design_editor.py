# apps/invoices/views_design_editor.py
"""
The production Template Builder's own editor-support endpoints: the
template gallery data (design_templates_list/design_template_data), the
canvas document/element content the real GrapesJS editor loads
(design_canvas_document/design_canvas_element — the on-demand legacy-
design migration also lives in design_canvas_document, see
design_migration.migrate_v1_to_v2), a render-preview endpoint used by the
editor's own Preview toggle (design_render_preview), and Template Health
validation (design_validate, see design_validation.py).

None of these write to a real Invoice row or its rendered output — they
build/preview/validate design_data against build_render_context's real-
sample-data mechanism (the same one the design gallery's own preview
cards use), or read/write a real, owned InvoiceDesign row through the
standard ownership boundary (IsAuthenticated, scoped to the requesting
user). The actual invoice PDF/portal/preview-as-client render paths
(apps/invoices/views.py, views_portal.py) call pdf_generator.py directly,
which dispatches to design_renderer.py — not through this module.
"""
import logging

from django.http import HttpResponse
from django.views.decorators.clickjacking import xframe_options_exempt
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.invoices.design_canvas import build_canvas_document, render_canvas_element_content
from apps.invoices.design_migration import migrate_v1_to_v2
from apps.invoices.design_renderer import (
    DesignRenderError,
    build_render_context,
    render_design_html,
    render_design_pdf_bytes,
)
from apps.invoices.design_schema import ELEMENT_KINDS, SCHEMA_VERSION_V2, get_schema_version
from apps.invoices.design_templates import BUILTIN_DESIGNS, get_blank_design_data, get_builtin_design_data
from apps.invoices.design_validation import run_validation
from apps.invoices.views import _check_moderate_rate_limit, _too_many_requests

logger = logging.getLogger(__name__)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@xframe_options_exempt
def design_render_preview(request):
    """
    Isolated Phase 1 test surface for the canonical V2 renderer.

    POST {"design_data": {...}, "base_template": "professional", "color_variant": ""}
    — design_data may be legacy (v1) or v2 shape; a legacy payload is
    migrated IN MEMORY ONLY (apps.invoices.design_migration.migrate_v1_to_v2)
    and never persisted, so this endpoint also doubles as a real, live way
    to see how an existing real design would look through the V2 renderer
    without touching that design's own stored row at all.

    ?output=pdf returns a real PDF (application/pdf); otherwise HTML
    (never `?format=`, deliberately — that query parameter name is
    reserved by DRF's own content-negotiation mechanism and using it
    for anything else causes DRF to 404 the request before it ever
    reaches this view, confirmed directly during this phase's own testing)
    (text/html, @xframe_options_exempt — matches every other real preview
    endpoint's own convention, e.g. design_builtin_preview/design_preview
    in views.py, since this is meant to be embeddable the same way).
    """
    design_data = request.data.get('design_data')
    if not isinstance(design_data, dict):
        return Response({'error': 'design_data is required and must be an object.'}, status=400)

    try:
        version = get_schema_version(design_data)
    except ValueError as exc:
        return Response({'error': str(exc)}, status=400)

    if version != SCHEMA_VERSION_V2:
        migration = migrate_v1_to_v2(design_data)
        if not migration['success']:
            return Response(
                {'error': 'Could not convert design_data to v2 for preview.', 'details': migration['errors']},
                status=400,
            )
        design_data = migration['design_data']

    base_template = request.data.get('base_template', 'professional')
    color_variant = request.data.get('color_variant', '')

    try:
        context = build_render_context(request.user, base_template, color_variant)
        if request.query_params.get('output') == 'pdf':
            pdf_bytes = render_design_pdf_bytes(design_data, context)
            return HttpResponse(pdf_bytes, content_type='application/pdf')
        html = render_design_html(design_data, context)
        return HttpResponse(html, content_type='text/html')
    except DesignRenderError as exc:
        logger.info('[INVOICES] V2 preview rendering failed: %s', exc)
        return Response({'error': str(exc)}, status=422)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def design_templates_list(request):
    """
    A real, read-only inventory of the production builtin templates
    (design_templates.py) — never a database query, never touches a real
    InvoiceDesign row. Mirrors design_seeds.COLOR_VARIANTS' own real
    inventory (imported, not duplicated) so this list can never silently
    drift from what actually exists.

    `variants` (bare keys, e.g. `["default", "forest", "burgundy"]`) is
    the editor's own template-picker shape. `variant_details` (the full
    `{key, label, primary, secondary}` objects) is additive — the Design
    Gallery's own color-swatch cards need the real label/hex values, not
    just which keys exist.
    """
    from apps.invoices.design_seeds import COLOR_VARIANTS

    return Response({
        'templates': sorted(BUILTIN_DESIGNS.keys()),
        'variants': {
            template: [variant['key'] for variant in variants] for template, variants in COLOR_VARIANTS.items()
        },
        'variant_details': COLOR_VARIANTS,
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def design_template_data(request):
    """
    Returns exactly one real, measured V2 builtin reconstruction's
    design_data — a deep copy, so nothing the caller does to the response
    can ever mutate design_templates.py's own module-level constants. Never
    reads or writes a database row. `color_variant` is accepted (and
    validated against the real inventory) purely so the isolated test page
    can pass it straight through to the canvas-document endpoint below —
    geometry itself never varies by color (see Phase 2's own "geometry
    does not change between variants" finding), only the resolved
    primary/secondary color pair does, which build_render_context
    already resolves from base_template+color_variant, not from
    design_data itself.
    Green-Light directive: `?blank=true` returns the OTHER first-class
    starting mode instead — the same real page geometry for this
    base_template, with zero pre-arranged header content and only the two
    structurally mandatory anchors (design_templates.get_blank_design_data).
    """
    base_template = request.query_params.get('base_template', '')
    if base_template not in BUILTIN_DESIGNS:
        return Response({'error': f'base_template must be one of {sorted(BUILTIN_DESIGNS.keys())}.'}, status=400)
    if request.query_params.get('blank') == 'true':
        return Response({'design_data': get_blank_design_data(base_template)})
    return Response({'design_data': get_builtin_design_data(base_template)})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def design_canvas_document(request):
    """
    The editor canvas's own initial-load payload.

    POST {"design_data": {...}, "base_template": "professional", "color_variant": ""}

    Production cutover: `design_data` may be a real production (v2) shape
    OR a legacy (pre-cutover) shape — a legacy payload is migrated IN
    MEMORY ONLY (design_migration.migrate_v1_to_v2, same real mapper the
    one-time production migration command uses) before building the
    canvas document, never persisted here. This is what lets "Edit" on
    ANY saved design — including the rare one the one-time migration
    couldn't safely convert — open in the one production editor; the
    migrated shape only ever becomes real, saved v2 data the moment the
    user explicitly saves.

    Read-only in every sense that matters: design_data always comes from
    the request's own body (never fetched by id from another user's
    InvoiceDesign row), and nothing here is ever persisted. Rate-limited
    like every other moderate-cost design-editor action in this app —
    same 30/hour-per-user shared helper, not a separately invented limit.
    """
    if _check_moderate_rate_limit('design_canvas_document', request.user):
        return _too_many_requests('Too many actions. Please try again later.')

    design_data = request.data.get('design_data')
    if not isinstance(design_data, dict):
        return Response({'design_data': 'design_data is required and must be an object.'}, status=400)

    try:
        version = get_schema_version(design_data)
    except ValueError as exc:
        return Response({'design_data': str(exc)}, status=400)

    if version != SCHEMA_VERSION_V2:
        migration = migrate_v1_to_v2(design_data)
        if not migration['success']:
            return Response(
                {'design_data': 'This design uses an older format that could not be automatically converted. '
                                'Please duplicate a ready-made template and rebuild it instead.',
                 'details': migration['errors']},
                status=422,
            )
        design_data = migration['design_data']

    base_template = request.data.get('base_template', 'professional')
    color_variant = request.data.get('color_variant', '') or ''
    # Phase 4B: default 'alias' — a design environment shows what a field
    # REPRESENTS ("Client Name"), not today's test-account data, and never
    # collapses to zero size just because real data happens to be blank.
    # Never affects real invoice rendering — render_design_html has no
    # code path that accepts this at all.
    content_mode = request.data.get('content_mode', 'alias')
    if content_mode not in ('real', 'alias'):
        return Response({'content_mode': "Must be 'real' or 'alias'."}, status=400)

    try:
        context = build_render_context(request.user, base_template, color_variant)
        document = build_canvas_document(design_data, context, content_mode)
        return Response(document)
    except DesignRenderError as exc:
        logger.info('[INVOICES] V2 canvas document build failed: %s', exc)
        return Response({'error': str(exc)}, status=422)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def design_canvas_element(request):
    """
    The canvas's live per-element content refresh — the V2 analog of
    apps/invoices/views.py's own design_editor_element, same purpose
    (re-render just one element's content fragment on a style-panel
    change, without touching any other element's live position).
    """
    if _check_moderate_rate_limit('design_canvas_element', request.user):
        return _too_many_requests('Too many actions. Please try again later.')

    kind = request.data.get('kind')
    el_type = request.data.get('el_type')
    style = request.data.get('style')
    overrides = request.data.get('overrides')
    base_template = request.data.get('base_template', 'professional')
    color_variant = request.data.get('color_variant', '') or ''
    content_mode = request.data.get('content_mode', 'alias')
    # Phase 4B.3 real bug fix (LANCERAOS_TEMPLATE_BUILDER_2_PHASE4B2_AUDIT.md
    # finding C1): this endpoint had no way to resolve a bound generic text
    # element's real/alias value without its own `binding` — every style
    # edit on a bound field silently blanked the canvas until a full
    # reload. Optional (None for a static/unbound text element or any
    # semantic type — every one of those ignores it, same as before);
    # validated against the same SUPPORTED_BINDINGS allow-list
    # resolve_binding itself already enforces, so a malformed value fails
    # loudly (a real DesignRenderError below) rather than silently resolving
    # to nothing.
    binding = request.data.get('binding') or None

    if kind not in ELEMENT_KINDS:
        return Response({'kind': f'Must be one of {sorted(ELEMENT_KINDS)}.'}, status=400)
    if not isinstance(style, dict):
        return Response({'style': 'style must be an object.'}, status=400)
    if overrides is not None and not isinstance(overrides, dict):
        return Response({'overrides': 'overrides must be an object.'}, status=400)
    if base_template not in BUILTIN_DESIGNS:
        return Response({'base_template': f'Must be one of {sorted(BUILTIN_DESIGNS.keys())}.'}, status=400)
    if content_mode not in ('real', 'alias'):
        return Response({'content_mode': "Must be 'real' or 'alias'."}, status=400)
    if binding is not None and not isinstance(binding, str):
        return Response({'binding': 'binding, if present, must be a string.'}, status=400)

    try:
        context = build_render_context(request.user, base_template, color_variant)
        html = render_canvas_element_content(kind, el_type, style, overrides, context, content_mode, binding=binding)
        return Response({'html': html})
    except DesignRenderError as exc:
        logger.info('[INVOICES] V2 canvas element render failed: %s', exc)
        return Response({'error': str(exc)}, status=422)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def design_validate(request):
    """
    Green-Light directive — the Template Health endpoint. Runs every real
    validation layer (apps.invoices.design_validation.run_validation) —
    Layer A (schema), Layer C (semantic: TB-004 and its 3 siblings), and
    Layer D (a genuine dry-run render against a real invoice_context,
    output discarded) — against whatever design_data the editor currently
    holds, live, on demand. Layer B stays a documented no-op (see
    design_validation.py's own module docstring — no functional gap for
    it to fill).

    POST {"design_data": {...v2 shape...}, "base_template": "professional", "color_variant": ""}

    Never persists anything and never touches a real Invoice/InvoiceDesign
    row — same isolated-test-surface contract every other view in this
    module already follows; `invoice_context` is built the exact same way
    design_render_preview's own context is (real freelancer profile, sample
    invoice content), so Layer D's dry-run exercises real data, never a
    second synthetic fixture invented just for this endpoint.
    """
    if _check_moderate_rate_limit('design_validate', request.user):
        return _too_many_requests('Too many actions. Please try again later.')

    design_data = request.data.get('design_data')
    if not isinstance(design_data, dict):
        return Response({'error': 'design_data is required and must be an object.'}, status=400)

    base_template = request.data.get('base_template', 'professional')
    color_variant = request.data.get('color_variant', '') or ''

    context = build_render_context(request.user, base_template, color_variant)
    result = run_validation(design_data, invoice_context=context)
    return Response(result)
