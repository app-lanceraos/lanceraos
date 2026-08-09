# apps/invoices/signature_tool.py
"""
Step 9's signature tool — classical image processing, deliberately NOT AI.
Background removal from a handwritten-signature photo is a narrow,
well-defined problem (isolate dark ink strokes from a lighter background)
that a fixed luminance threshold solves reliably and for free; there's no
reason to spend a Groq call on it the way apps/invoices/ai_design.py's
classify step genuinely needs vision.
"""
import io

from PIL import Image

# A pixel this dark (0=black, 255=white on the grayscale channel) or darker
# is treated as fully-opaque ink. Real handwritten signatures are usually
# photographed on white/off-white paper with a visible ink stroke — 190
# comfortably separates typical ink (well under 100 for blue/black pen)
# from typical paper-with-shadow (usually above 210) even under uneven
# lighting, verified directly against a realistic synthetic test fixture
# (apps/invoices/tests/test_signature_tool.py), not just picked and trusted.
DEFAULT_THRESHOLD = 190
# Pixels within this many gray levels below the threshold get a linear
# alpha ramp instead of a hard cutoff — anti-aliases stroke edges so they
# don't come out jagged.
DEFAULT_FEATHER = 35


def remove_signature_background(image_bytes, threshold=DEFAULT_THRESHOLD, feather=DEFAULT_FEATHER):
    """
    Returns PNG bytes with the background made transparent. Uses
    Image.point() with a 256-entry lookup table (built once, applied via
    Pillow's C internals) rather than a per-pixel Python loop — correct AND
    fast regardless of the input image's resolution.
    """
    img = Image.open(io.BytesIO(image_bytes)).convert('RGB')
    grayscale = img.convert('L')

    def alpha_for_gray_level(level):
        if level >= threshold:
            return 0
        if level <= threshold - feather:
            return 255
        return int(255 * (threshold - level) / feather)

    alpha_mask = grayscale.point(alpha_for_gray_level)

    rgba = img.convert('RGBA')
    rgba.putalpha(alpha_mask)

    buf = io.BytesIO()
    rgba.save(buf, format='PNG')
    return buf.getvalue()
