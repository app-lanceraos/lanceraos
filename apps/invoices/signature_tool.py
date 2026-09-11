# apps/invoices/signature_tool.py
"""
Step 9's signature tool — classical image processing, deliberately NOT AI.
Background removal from a handwritten-signature photo is a narrow,
well-defined problem (isolate dark ink strokes from a lighter background)
that a luminance threshold solves reliably and for free; there's no
reason to spend a Groq call on it the way apps/invoices/ai_design.py's
classify step genuinely needs vision.

A per-image threshold computed via Otsu's method (see compute_otsu_threshold
below) replaced a single fixed constant — a real signature photo can be
lit/exposed very differently from one user's phone to another's, and no
single fixed number separates ink from paper well across all of them. An
explicit `threshold`/`feather` override is still accepted for anyone who
wants to bypass the automatic choice.

Two entry points:
- remove_signature_background(...) — the full pipeline for a photographed/
  uploaded signature: flattens to RGB (via flatten_to_rgb — see its own
  docstring for a real, reproduced bug this closes for images that
  already carry transparency), thresholds to build an alpha mask, then
  crops to the ink's own bounding box.
- crop_signature_to_content(...) — crop-only, for a signature that arrives
  ALREADY a clean transparent PNG (e.g. drawn on a canvas, see
  apps/invoices/views.py's signature_upload docstring for the `source`
  contract) — running that through remove_signature_background would
  flatten its alpha against an arbitrary background first, destroying it.
"""
import io

from PIL import Image

# Fallback threshold, used only if Otsu's histogram math has nothing to
# work with (a degenerate, single-color input — see compute_otsu_threshold).
# Not used for any normal photographed signature; Otsu is the real default.
DEFAULT_THRESHOLD = 190
# Pixels within this many gray levels below the threshold get a linear
# alpha ramp instead of a hard cutoff — anti-aliases stroke edges so they
# don't come out jagged. Fixed regardless of where Otsu places the
# threshold itself — a small feather band around whichever cutoff is
# chosen, not a value that scales with it.
DEFAULT_FEATHER = 35

# The cropped signature gets this much breathing room added back on every
# side, as a fraction of the ink bounding box's own width/height. Purely
# cosmetic — Image.getbbox() already includes every partially-feathered
# edge pixel, so this isn't compensating for clipped anti-aliasing, it's
# avoiding a signature that looks uncomfortably cramped against its own
# edges once composited onto an invoice. 5% is enough to read as
# deliberate whitespace without meaningfully reintroducing the wasted-
# margin problem this cropping step exists to fix.
CROP_MARGIN_RATIO = 0.05


def compute_otsu_threshold(grayscale_image):
    """
    Otsu's method, implemented directly against a 256-bin histogram
    (PIL.Image.histogram() on an 'L'-mode image) — no numpy, no new
    dependency. Finds the gray level t that maximizes the between-class
    variance of splitting the histogram into two classes: levels <= t
    (treated as the darker class — ink) and levels > t (the lighter
    class — paper/background). This is the standard Otsu formulation,
    just computed with plain Python sums instead of vectorized array ops.

    Returns an int threshold such that alpha_for_gray_level's existing
    `level >= threshold` cutoff puts the boundary in the right place —
    i.e. one past the best split point found, so the "ink" class (<=
    split point) is exactly what ends up opaque.

    Tie-breaking matters more than it looks: a genuinely bimodal image
    with a truly empty gap between the ink and paper clusters (no pixels
    at all at intermediate gray levels — a real possibility for a
    cleanly-scanned/solid-drawn signature, not just a contrived edge
    case) makes the between-class variance IDENTICAL across every split
    point inside that gap, since neither class's weight/mean changes
    until the far side of the gap is reached. Picking the first tied
    split (the naive argmax) lands the threshold right against the ink
    cluster's own edge — and combined with the fixed feather band below
    it (which extends BELOW the threshold), that can leave real ink
    pixels sitting inside the feather ramp instead of the guaranteed-
    opaque zone, coming out partially transparent. Picking the MIDPOINT
    of the tied plateau instead keeps the threshold centered in the gap,
    matching what a person would draw by eye, and giving the feather
    band room on both sides.
    """
    histogram = grayscale_image.histogram()
    total_pixels = sum(histogram)
    if total_pixels == 0:
        return DEFAULT_THRESHOLD

    sum_total = sum(level * count for level, count in enumerate(histogram))

    weight_below = 0
    sum_below = 0
    best_variance = -1.0
    plateau_start = 0
    plateau_end = 0

    # t ranges over 0..254 — t=255 would leave the "above" class empty,
    # which can never be the maximizing split for a real two-class image.
    for level in range(255):
        weight_below += histogram[level]
        sum_below += level * histogram[level]
        weight_above = total_pixels - weight_below
        if weight_below == 0 or weight_above == 0:
            continue
        mean_below = sum_below / weight_below
        mean_above = (sum_total - sum_below) / weight_above
        between_class_variance = weight_below * weight_above * (mean_below - mean_above) ** 2
        if between_class_variance > best_variance:
            best_variance = between_class_variance
            plateau_start = level
            plateau_end = level
        elif between_class_variance == best_variance:
            plateau_end = level

    best_split = (plateau_start + plateau_end) // 2
    return best_split + 1


def flatten_to_rgb(img):
    """
    Flattens `img` (any PIL mode) to RGB for thresholding, treating real
    pre-existing transparency as white/paper rather than Pillow's own
    Image.convert('RGB') default of filling transparent pixels with
    BLACK.

    This is a real, reproduced bug fix, not a defensive guess: a
    photographed signature (source='upload's stated case) is always
    fully opaque — a camera never produces alpha. But 'upload' also
    genuinely covers someone re-uploading a signature image that
    ALREADY had its background removed elsewhere (another app, a prior
    export, a signature generator) — this view has no way to know that
    in advance, since 'drawn' is reserved for this app's own canvas
    output. Feeding an RGBA/LA/palette-with-transparency image straight
    into Image.convert('RGB') fills every transparent pixel with pure
    black (0,0,0). For a typical mostly-transparent signature PNG, that
    manufactures a huge black "background" region that is DARKER than
    the real ink strokes (which are dark but rarely pure (0,0,0)) —
    Otsu's between-class-variance split then centers itself between
    that fake black background and the real ink, landing ABOVE the
    ink's own gray level. Every ink pixel then reads as "the lighter
    class" and gets classified as background (alpha 0), while the fake
    black regions (actually meant to be transparent) get a nonzero
    feathered alpha instead — the mask comes out fully or almost fully
    empty. See test_signature_tool.py's
    FlattenToRgbTransparencyTests for a concrete before/after
    reproduction (getbbox()/opaque-pixel-count on the OLD plain
    convert('RGB') path vs this one, using the SAME input bytes).

    Compositing onto an opaque white canvas first, instead, makes
    transparent regions read as light ("paper"), which is what a
    pre-cleaned signature's transparent surroundings actually represent
    — correctly keeping them out of Otsu's dark/ink class. An image
    with no transparency at all (the overwhelmingly common real case —
    an actual camera photo) takes the plain convert('RGB') path
    unchanged, since there's nothing to composite.
    """
    has_alpha = img.mode in ('RGBA', 'LA') or (img.mode == 'P' and 'transparency' in img.info)
    if not has_alpha:
        return img.convert('RGB')

    rgba = img.convert('RGBA')
    white_background = Image.new('RGBA', rgba.size, (255, 255, 255, 255))
    return Image.alpha_composite(white_background, rgba).convert('RGB')


def build_alpha_mask(grayscale, threshold, feather):
    def alpha_for_gray_level(level):
        if level >= threshold:
            return 0
        if level <= threshold - feather:
            return 255
        return int(255 * (threshold - level) / feather)

    return grayscale.point(alpha_for_gray_level)


def _crop_to_alpha_content(rgba_image, alpha_mask, margin_ratio=CROP_MARGIN_RATIO):
    """
    Crops rgba_image to the bounding box of alpha_mask's non-zero pixels
    (the real ink/content, wherever it landed), padded by margin_ratio of
    the box's own width/height on every side. Returns the image
    untouched if alpha_mask is fully transparent (nothing detected) —
    cropping to an empty box would raise, and there's nothing meaningful
    to crop to anyway.
    """
    bbox = alpha_mask.getbbox()
    if bbox is None:
        return rgba_image

    left, top, right, bottom = bbox
    margin_x = max(1, round((right - left) * margin_ratio))
    margin_y = max(1, round((bottom - top) * margin_ratio))
    img_width, img_height = rgba_image.size

    return rgba_image.crop((
        max(0, left - margin_x),
        max(0, top - margin_y),
        min(img_width, right + margin_x),
        min(img_height, bottom + margin_y),
    ))


def remove_signature_background(image_bytes, threshold=None, feather=DEFAULT_FEATHER):
    """
    Returns cropped, transparent-background PNG bytes. Uses Image.point()
    with a 256-entry lookup table (built once, applied via Pillow's C
    internals) rather than a per-pixel Python loop — correct AND fast
    regardless of the input image's resolution.

    threshold: if None (the default), computed per-image via
    compute_otsu_threshold — the smart default. Pass an explicit int to
    bypass Otsu entirely and force a specific cutoff.
    feather: fixed anti-aliasing band width around whichever threshold is
    used (computed or explicit).
    """
    img = flatten_to_rgb(Image.open(io.BytesIO(image_bytes)))
    grayscale = img.convert('L')

    effective_threshold = threshold if threshold is not None else compute_otsu_threshold(grayscale)

    alpha_mask = build_alpha_mask(grayscale, effective_threshold, feather)

    rgba = img.convert('RGBA')
    rgba.putalpha(alpha_mask)

    rgba = _crop_to_alpha_content(rgba, alpha_mask)

    buf = io.BytesIO()
    rgba.save(buf, format='PNG')
    return buf.getvalue()


def crop_signature_to_content(image_bytes, margin_ratio=CROP_MARGIN_RATIO):
    """
    Crop-only path for a signature that's already a clean transparent PNG
    (e.g. drawn on a canvas, never photographed) — no RGB flattening, no
    thresholding, since doing either to an image that already has a real
    alpha channel would corrupt it. Crops to the bounding box of its own
    non-fully-transparent pixels, same margin convention as
    remove_signature_background. An input with no transparency at all
    (opaque image) has nothing to crop to — its alpha channel is uniformly
    255, so the whole image is the bounding box and it's returned
    unchanged in size.
    """
    rgba = Image.open(io.BytesIO(image_bytes)).convert('RGBA')
    alpha_mask = rgba.split()[-1]
    rgba = _crop_to_alpha_content(rgba, alpha_mask, margin_ratio)

    buf = io.BytesIO()
    rgba.save(buf, format='PNG')
    return buf.getvalue()
