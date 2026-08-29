# apps/invoices/ai_design.py
"""
Step 9, Path 3 — AI-seeded designs. CLASSIFY-only: one Groq vision call
extracts a design-spec narrow enough to map directly onto
design_schema.py's real production (schema_version: 2) header/flow
vocabulary (closest base_template + a couple of real colors + a coarse
layout-density choice), then that spec adjusts one of design_templates.py's
own 3 production BUILTIN_DESIGNS seeds programmatically — Phase 5.1 fix:
this module previously (incorrectly) adjusted design_seeds.py's own
RETIRED zone_1/zone_2-shaped seeds instead, saving every real AI-seeded
design in the legacy shape; see apply_ai_adjustments' own docstring and
DECISIONS.md for the full before/after. Deliberately NOT full HTML
generation with an iterative "nudge and regenerate" loop —
that was a real, separate proof of concept
(~/Downloads/invoice_template_poc/backend/main.py), evaluated and rejected
for this system specifically (see DECISIONS.md for the full reasoning: it
would produce a disconnected one-off HTML blob nothing else in the
InvoiceDesign system could edit/reuse, and full-HTML-under-token-constraints
was already shown to be fragile — the POC's own generation prompt spends
several paragraphs defensively working around overlap bugs it kept
producing).

What DOES carry over from that POC, ported directly rather than reinvented,
because it's genuinely good and orthogonal to classify-vs-generate:
image compression before the API call (compress_image), <think>-tag/
markdown-fence stripping (core.ai.strip_model_reply_wrapper), and 429
retry-with-backoff (core.ai.call_groq).
"""
import base64
import copy
import io
import json
import logging

from PIL import Image
from django.conf import settings

from core.ai import call_groq, strip_model_reply_wrapper
from .design_schema import validate_design_data_schema_by_version
from .design_templates import BUILTIN_DESIGNS, get_builtin_design_data
from .design_renderer import PAGE_MARGIN_LEFT_MM, PAGE_MARGIN_RIGHT_MM

logger = logging.getLogger(__name__)

# Phase 5.1 fix (production cutover correction — this module previously
# imported BUILTIN_DESIGNS/get_builtin_design_data from the RETIRED
# .design_seeds and validated with the RETIRED .legacy_design_schema's
# validate_design_data_schema, confirmed directly by reading views.py's
# design_duplicate — the "Use this template" backend — which imports
# BUILTIN_DESIGNS/get_builtin_design_data from .design_templates, the real
# production source; every AI-seeded design was silently being saved in
# the legacy zone_1/zone_2 shape as a result, never the production schema
# design_duplicate/blank creation already use. validate_design_data_schema_by_version
# is confirmed directly (not assumed from either function's own docstring
# — both currently describe a stale, pre-cutover "not used by anything
# live" state that is simply no longer true) to be the exact function
# InvoiceDesignSerializer.validate_design_data calls for every real save —
# see apps/invoices/serializers.py's validate_design_data. Using it here
# means this module's defense-in-depth check is genuinely the same gate a
# real save goes through, not a different, weaker one.
#
# PAGE_MARGIN_LEFT_MM/PAGE_MARGIN_RIGHT_MM imported directly from
# design_renderer.py (their real, canonical, public source — confirmed by
# reading it directly) rather than duplicated as raw numbers: an initial
# version of this fix DID hardcode a raw page-width clamp (210mm) here,
# and it was too LENIENT — real-tested at 'spacious' density, professional
# template, several header elements scaled past design_schema.py's real
# content_width_mm bound (174mm, page width minus real margins) while
# still sitting comfortably under 210mm, so this module's own "defensive"
# clamp let the *actual* validator at the end of this pipeline reject the
# whole design instead of the clamp doing its job. _content_width_mm below
# reproduces design_schema.py's/design_canvas.py's own exact margin+sidebar
# formula so this stays correct even for a template with custom margins or
# a sidebar (Modern), never silently drifting from the real bound.

DEFAULT_COMPRESS_MAX_WIDTH = 700
DEFAULT_COMPRESS_QUALITY = 78

# Discrete, fixed choices rather than letting the model return an arbitrary
# float — more robust against a flaky/creative model reply, and each value
# is small enough that, combined with the seeds' own existing margins, the
# uniform-scale-from-origin transform below can never push an element past
# the fixed canvas even before the defensive clamp runs (verified directly
# per template in this module's own test suite, not just asserted here).
LAYOUT_SCALE_BY_DENSITY = {'compact': 0.92, 'balanced': 1.0, 'spacious': 1.08}

# Which style-dict keys on zone_2.table carry this template's (primary,
# secondary) brand color — real keys taken directly from design_seeds.py,
# not guessed. Every one of the 3 seeds has a table.style dict with at
# least one real hex-color-valued key, so this mapping always has
# somewhere real and visible (the table header) to apply extracted color.
TABLE_COLOR_SLOTS = {
    'professional': ('header_border_color', 'row_border_color'),
    'minimal': ('header_border_color', 'row_border_color'),
    'modern': ('header_bg', 'header_color'),
}

CLASSIFY_SPEC_SCHEMA = """{
  "base_template": "one of: professional, minimal, modern",
  "primary_color": "#hex",
  "secondary_color": "#hex",
  "layout_density": "one of: compact, balanced, spacious",
  "reasoning": "one short sentence"
}"""


def compress_image(raw_bytes, max_width=DEFAULT_COMPRESS_MAX_WIDTH, quality=DEFAULT_COMPRESS_QUALITY):
    """
    Downscale + re-encode as JPEG before sending to Groq — ported directly
    from the POC's compress_image(). Vision token cost scales with
    resolution far more than with extraction quality for a style-classify
    task like this one; 700px-wide is the POC's own real-tested default
    (kept here, verified again directly in this module's tests against
    real images rather than re-trusted blindly).
    Returns (base64_str, media_type).
    """
    img = Image.open(io.BytesIO(raw_bytes)).convert('RGB')
    w, h = img.size
    if w > max_width:
        scale = max_width / w
        img = img.resize((max_width, max(1, int(h * scale))))
    buf = io.BytesIO()
    img.save(buf, format='JPEG', quality=quality)
    return base64.b64encode(buf.getvalue()).decode('utf-8'), 'image/jpeg'


def _build_classify_prompt():
    return (
        'You are analyzing a reference invoice/document design image to help seed a NEW '
        'invoice design that starts from one of exactly 3 fixed templates and gets adjusted '
        'to roughly match what you see.\n\n'
        'Return ONLY a JSON object, no markdown fences, no prose, matching exactly this shape:\n'
        f'{CLASSIFY_SPEC_SCHEMA}\n\n'
        'base_template must be whichever of "professional" (serif/formal, warm amber-on-navy '
        'accents), "minimal" (clean sans-serif, mostly grayscale, generous whitespace), or '
        '"modern" (bold sans-serif, a colored full-height sidebar or banner) the reference most '
        'resembles overall — pick the closest one, never anything outside those 3 exact strings.\n'
        'primary_color/secondary_color must be real hex colors you actually observe being used '
        'prominently in the reference (e.g. a header/table accent and a secondary text/border '
        'color) — do not invent colors that aren\'t there.\n'
        'layout_density must reflect how tightly packed the reference\'s header/info area looks: '
        '"compact" if elements sit close together with little margin, "spacious" if there\'s a '
        'lot of open whitespace around each element, "balanced" otherwise.'
    )


def classify_design_image(raw_bytes):
    """
    One Groq vision call: compressed reference image + the classify prompt,
    together in a single request/message (the POC's own genuinely good
    insight — a text-only pass loses graphic detail the model can still see
    directly in the image). Returns the parsed classify dict.

    Raises ValueError with a specific, user-facing-safe message on any
    failure (bad JSON back, base_template outside the real 3, or whatever
    core.ai.call_groq itself raised for a Groq-side failure) — the caller
    (the ai-seed view) is responsible for turning that into a clear response
    that still leaves the user a path to Path 1/Path 2, never a dead end.
    """
    b64, media_type = compress_image(raw_bytes)

    messages = [{
        'role': 'user',
        'content': [
            {'type': 'text', 'text': _build_classify_prompt()},
            {'type': 'image_url', 'image_url': {'url': f'data:{media_type};base64,{b64}'}},
        ],
    }]

    try:
        # 2000, not a tight budget matching this schema's own tiny output —
        # a real live-API test against qwen/qwen3.6-27b (a "thinking" model)
        # showed its <think> reasoning block alone burns through several
        # hundred tokens before it ever reaches the actual JSON answer;
        # max_tokens=500 truncated mid-thought, before any real output,
        # every time. The POC's own analyze_design call used 4000 for the
        # same reason (a much bigger output schema, but the same thinking-
        # budget problem) — 2000 comfortably covers this schema's own much
        # smaller final answer plus the model's real reasoning overhead,
        # confirmed directly against the live API, not assumed.
        raw_reply = call_groq(messages, settings.GROQ_MODEL_VISION, max_tokens=2000)
    except RuntimeError as exc:
        raise ValueError(f'The AI design service is unavailable right now: {exc}') from exc

    cleaned = strip_model_reply_wrapper(raw_reply)
    try:
        spec = json.loads(cleaned)
    except json.JSONDecodeError as exc:
        logger.error('AI design classify returned non-JSON reply: %s', cleaned[:400])
        raise ValueError('The AI design service returned an unexpected response. Please try again.') from exc

    if not isinstance(spec, dict) or spec.get('base_template') not in BUILTIN_DESIGNS:
        logger.error('AI design classify returned an invalid base_template: %r', spec.get('base_template') if isinstance(spec, dict) else spec)
        raise ValueError('The AI design service could not match this image to a template. Please try again or pick one manually.')

    return spec


PAGE_HEIGHT_MM_FALLBACK = 297  # A4 — only used if a seed's flow ever had zero non-sidebar elements (never true today; the mandatory table always is one)


def _is_sidebar_element(el):
    return bool((el.get('style') or {}).get('sidebar'))


def _flow_start_y_mm(flow_elements):
    """
    Phase 5.1 port of the pre-cutover _clamp_zone1_bounds' ZONE_1_HEIGHT_MM
    ceiling — v1's zone_1/zone_2 were architecturally separate, fixed-height
    regions (zone_1 capped at a single global 100mm for every template); v2
    unified header/flow into one shared absolute coordinate space with no
    such fixed boundary (Phase 4B.2), so there is no single constant to
    reuse. Instead, this reads the REAL per-template boundary directly off
    the current seed's own flow.elements — the topmost y among its
    non-sidebar members (always the mandatory table's own y, for all 3 real
    templates today) — so a future change to any template's own header/flow
    spacing is automatically respected here too, rather than silently
    drifting from a stale hardcoded number the way the old constant would
    have. Sidebar-flagged flow elements (Modern's own qr_code/
    online_payment_link) are deliberately excluded — they live in the
    sidebar's own separate, fixed-width coordinate space (see
    design_schema.py's _validate_page_bounds' own sidebar carve-out),
    entirely unrelated to the main content header's vertical extent.
    """
    non_sidebar_ys = [el['y'] for el in flow_elements if not _is_sidebar_element(el)]
    return min(non_sidebar_ys) if non_sidebar_ys else PAGE_HEIGHT_MM_FALLBACK


def _content_width_mm(page):
    """
    Reproduces design_schema.py's own _validate_page_bounds (and
    design_canvas.py's build_canvas_document) margin+sidebar formula
    exactly — the real bound scaled header elements must fit inside, not
    the raw page width. A first version of this fix used the raw
    page.width_mm (210mm) directly, and real-tested 'spacious' density
    against the professional template proved that too lenient: several
    header elements scaled past the real ~174mm content width while still
    sitting under 210mm, silently making it to the final validator instead
    of being caught (and corrected) here.
    """
    margin_right_mm = page.get('margin_right_mm', PAGE_MARGIN_RIGHT_MM)
    margin_left_mm = page.get('margin_left_mm', PAGE_MARGIN_LEFT_MM)
    sidebar = page.get('sidebar')
    sidebar_width_mm = sidebar['width_mm'] if sidebar else 0
    effective_margin_left_mm = margin_left_mm + sidebar_width_mm
    return page['width_mm'] - effective_margin_left_mm - margin_right_mm


def _safe_uniform_scale(elements, requested_scale, content_width_mm, flow_start_y_mm):
    """
    Real bug found and fixed while porting this to v2 (not present in the
    original v1 port, which relied on a hard, architecturally-separate
    zone_1 ceiling instead): an EARLIER version of this function scaled
    every element uniformly and then independently clamped whichever ones
    happened to overflow content_width_mm/flow_start_y_mm afterward.
    Real-tested against 'spacious' density on the professional template,
    that produced two brand-new overlaps between originally-adjacent,
    non-overlapping sibling elements — because clamping only SOME elements
    (the ones that happened to hit the edge) independently repositions
    them relative to their untouched siblings, which is exactly the
    "naive independent nudge" overlap risk apply_ai_adjustments' own
    docstring already warns uniform scaling is meant to avoid.

    The correct fix: never reposition an element independently after
    scaling. Instead, find the LARGEST scale <= requested_scale that
    keeps every element's scaled right/bottom edge within bounds, then
    apply that one (possibly smaller) scale uniformly to the whole set —
    preserving the exact same overlap-safety guarantee (one scale, one
    origin, every relative position preserved) while still respecting the
    real content-width/flow-start bound. Only ever relevant for
    requested_scale > 1.0 (a scale-down can never introduce a new bound
    violation, since every seed already fits at scale=1 by construction —
    guaranteed by validate_design_data_schema_by_version already passing
    on the unscaled seed).
    """
    if requested_scale <= 1.0:
        return requested_scale
    safe_scale = requested_scale
    for el in elements:
        right_edge = el['x'] + el['width']
        if right_edge > 0:
            safe_scale = min(safe_scale, content_width_mm / right_edge)
        bottom_edge = el['y'] + el['height']
        if bottom_edge > 0:
            safe_scale = min(safe_scale, flow_start_y_mm / bottom_edge)
    return max(safe_scale, 0)


def apply_ai_adjustments(design_data, classify):
    """
    Adjusts a real builtin seed's design_data per the classify result.
    Provably overlap-safe by construction, not just hopefully-safe:

    - Colors only ever touch style-dict values (the mandatory table
      element's own real color keys, found in flow.elements by
      `type == 'table'`, and every header text element bound to
      `business.name`, found by `type == 'text' and binding ==
      'business.name'` — the real v2 equivalent of v1's single bundled
      business_info element; Phase 4B's field-level decomposition split
      that into individual generic text elements, so this may now color
      more than one real element for a template like Modern, which
      repeats business.name in both its main content and its sidebar —
      a strictly MORE thorough application of the same intent, not a
      behavior change) — a color change can never cause a bounding-box
      overlap.
    - Proportions apply a SINGLE uniform scale factor to every NON-SIDEBAR
      header element's x/y/width/height together, from the shared origin
      (0,0). This is the actual overlap-safety argument, not just an
      assumption: the axis-aligned overlap test (`a.x + a.width <= b.x`
      etc., see design_schema.py's _validate_overlap/boxes_overlap) is a
      linear inequality, and multiplying every term in it by the same
      positive constant preserves its direction — so if the seed had no
      overlaps AMONG THE SCALED SET (guaranteed, since every seed already
      passes validate_design_data_schema_by_version), scaling every
      element in that same set by the same factor from the same origin
      cannot introduce a NEW overlap within it. A per-element independent
      nudge (the "naive" approach this deliberately avoids) has no such
      guarantee at all. Sidebar-flagged header elements (Modern's own
      logo/business.name/business.city/business.country in its sidebar
      column) are deliberately excluded from scaling — they live in a
      separate, fixed-width coordinate space with no comparable "density"
      concept, and the classify prompt itself only ever describes
      "how tightly packed the reference's header/info area looks" (main
      content), not the sidebar. `_safe_uniform_scale` is the second half
      of the safety argument: rather than scaling then independently
      clamping whichever elements happen to overflow afterward (a real,
      confirmed bug an earlier version of this fix had — see that
      function's own docstring for exactly how it broke the overlap
      guarantee), it finds the largest single scale <= the requested one
      that keeps the WHOLE set within content_width_mm/flow_start_y_mm,
      then applies that one scale uniformly — preserving the same
      one-scale-one-origin guarantee the paragraph above relies on, never
      repositioning any element independently of its siblings.
    """
    data = copy.deepcopy(design_data)
    base_template = classify.get('base_template')
    primary = classify.get('primary_color')
    secondary = classify.get('secondary_color')

    slots = TABLE_COLOR_SLOTS.get(base_template)
    table_el = next((el for el in data['flow']['elements'] if el.get('type') == 'table'), None)
    if table_el is not None:
        table_style = table_el.setdefault('style', {})
        if slots and primary:
            table_style[slots[0]] = primary
        if slots and secondary:
            table_style[slots[1]] = secondary

    if secondary:
        for el in data['header']['elements']:
            if el.get('type') == 'text' and el.get('binding') == 'business.name':
                el.setdefault('style', {})['color'] = secondary

    requested_scale = LAYOUT_SCALE_BY_DENSITY.get(classify.get('layout_density'), 1.0)
    if requested_scale != 1.0:
        scalable_elements = [el for el in data['header']['elements'] if not _is_sidebar_element(el)]
        scale = _safe_uniform_scale(
            scalable_elements, requested_scale,
            _content_width_mm(data['page']), _flow_start_y_mm(data['flow']['elements']),
        )
        for el in scalable_elements:
            el['x'] = round(el['x'] * scale, 2)
            el['y'] = round(el['y'] * scale, 2)
            el['width'] = round(el['width'] * scale, 2)
            el['height'] = round(el['height'] * scale, 2)

    return data


def seed_design_data_from_image(raw_bytes):
    """
    The full Path 3 pipeline, minus persistence (the view owns creating the
    real InvoiceDesign row via the same helper design_duplicate uses — see
    views.py's _instantiate_design_from_builtin — so there's exactly one
    "create a design row" code path, not two).

    Returns (base_template, design_data). design_data is re-validated here
    against validate_design_data_schema_by_version — confirmed directly
    (apps/invoices/serializers.py's InvoiceDesignSerializer.validate_design_data)
    to be the exact same validator a real save through the standard
    InvoiceDesign CRUD endpoints goes through, not a different, weaker one
    (defense-in-depth: the scaling transform above is provably safe, but an
    AI-adjusted payload is exactly the kind of thing worth double-checking
    anyway) — raises ValueError if it somehow still fails, which the view
    turns into a clear error rather than ever saving a broken design.
    """
    classify = classify_design_image(raw_bytes)
    base_template = classify['base_template']
    seed = get_builtin_design_data(base_template)
    design_data = apply_ai_adjustments(seed, classify)

    errors = validate_design_data_schema_by_version(design_data)
    if errors:
        logger.error('AI-seeded design_data failed validation after adjustment: %s', errors)
        raise ValueError('The AI-adjusted design was invalid and could not be saved. Please try again.')

    return base_template, design_data
