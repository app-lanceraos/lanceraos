# apps/invoices/ai_design.py
"""
Step 9, Path 3 — AI-seeded designs. CLASSIFY-only: one Groq vision call
extracts a design-spec narrow enough to map directly onto
design_schema.py's real two-zone vocabulary (closest base_template + a
couple of real colors + a coarse layout-density choice), then that spec
adjusts one of design_seeds.py's own 3 seeds programmatically. Deliberately
NOT full HTML generation with an iterative "nudge and regenerate" loop —
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
from .design_schema import validate_design_data_schema
from .design_seeds import BUILTIN_DESIGNS, get_builtin_design_data

logger = logging.getLogger(__name__)

# Mirrors frontend/src/lib/designEditor/constants.js's PAGE_WIDTH_MM/
# ZONE_1_HEIGHT_MM — design_schema.py itself doesn't validate a page-bound
# (only pairwise overlap + the mandatory elements), so this is purely this
# module's own defensive clamp after scaling, not a schema requirement.
# Documented duplication, same tradeoff as builtinDesigns.js's seed mirror.
PAGE_WIDTH_MM = 210
ZONE_1_HEIGHT_MM = 100

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


def _clamp_zone1_bounds(elements):
    """
    Defense-in-depth only — see this module's LAYOUT_SCALE_BY_DENSITY
    comment for why, at the actual scale factors used, this in practice
    never fires for the 3 real seeds (verified directly per template in
    tests). Kept anyway since it's cheap and correct if a seed's own
    proportions ever change enough to need it.
    """
    for el in elements:
        if el['x'] + el['width'] > PAGE_WIDTH_MM:
            el['x'] = round(max(0, PAGE_WIDTH_MM - el['width']), 2)
        if el['y'] + el['height'] > ZONE_1_HEIGHT_MM:
            el['y'] = round(max(0, ZONE_1_HEIGHT_MM - el['height']), 2)


def apply_ai_adjustments(design_data, classify):
    """
    Adjusts a real builtin seed's design_data per the classify result.
    Provably overlap-safe by construction, not just hopefully-safe:

    - Colors only ever touch style-dict values (zone_2.table.style's real
      color keys, and zone_1's business_info elements' style.color) — a
      color change can never cause a bounding-box overlap.
    - Proportions apply a SINGLE uniform scale factor to every zone_1
      element's x/y/width/height together, from the shared origin (0,0).
      This is the actual overlap-safety argument, not just an assumption:
      the axis-aligned overlap test (`a.x + a.width <= b.x` etc., see
      design_schema.py's _boxes_overlap) is a linear inequality, and
      multiplying every term in it by the same positive constant preserves
      its direction — so if the seed had no overlaps (guaranteed, since
      every seed already passes validate_design_data_schema), scaling
      every element by the same factor from the same origin cannot
      introduce one. A per-element independent nudge (the "naive" approach
      this deliberately avoids) has no such guarantee at all.
    """
    data = copy.deepcopy(design_data)
    base_template = classify.get('base_template')
    primary = classify.get('primary_color')
    secondary = classify.get('secondary_color')

    slots = TABLE_COLOR_SLOTS.get(base_template)
    table_style = data['zone_2']['table'].setdefault('style', {})
    if slots and primary:
        table_style[slots[0]] = primary
    if slots and secondary:
        table_style[slots[1]] = secondary

    for el in data['zone_1']['elements']:
        if el.get('type') == 'business_info' and secondary:
            el.setdefault('style', {})['color'] = secondary

    scale = LAYOUT_SCALE_BY_DENSITY.get(classify.get('layout_density'), 1.0)
    if scale != 1.0:
        for el in data['zone_1']['elements']:
            el['x'] = round(el['x'] * scale, 2)
            el['y'] = round(el['y'] * scale, 2)
            el['width'] = round(el['width'] * scale, 2)
            el['height'] = round(el['height'] * scale, 2)
        _clamp_zone1_bounds(data['zone_1']['elements'])

    return data


def seed_design_data_from_image(raw_bytes):
    """
    The full Path 3 pipeline, minus persistence (the view owns creating the
    real InvoiceDesign row via the same helper design_duplicate uses — see
    views.py's _instantiate_design_from_builtin — so there's exactly one
    "create a design row" code path, not two).

    Returns (base_template, design_data). design_data is re-validated here
    against the exact same validator the serializer uses (defense-in-depth:
    the scaling transform above is provably safe, but an AI-adjusted payload
    is exactly the kind of thing worth double-checking anyway) — raises
    ValueError if it somehow still fails, which the view turns into a clear
    error rather than ever saving a broken design.
    """
    classify = classify_design_image(raw_bytes)
    base_template = classify['base_template']
    seed = get_builtin_design_data(base_template)
    design_data = apply_ai_adjustments(seed, classify)

    errors = validate_design_data_schema(design_data)
    if errors:
        logger.error('AI-seeded design_data failed validation after adjustment: %s', errors)
        raise ValueError('The AI-adjusted design was invalid and could not be saved. Please try again.')

    return base_template, design_data
