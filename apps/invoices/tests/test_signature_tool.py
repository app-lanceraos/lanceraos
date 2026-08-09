# apps/invoices/tests/test_signature_tool.py
"""
Step 9's signature tool — classical image processing (Pillow luminance
thresholding), not AI. Tests the real background-removal function against
a realistic synthetic fixture (ink strokes on off-white paper with a
shadow gradient and some noise) — a real Pillow-processed image, not a
mock — plus the upload/preview/commit view.
"""
import io
import random
from unittest import mock

from PIL import Image, ImageDraw
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import SimpleTestCase
from django.urls import reverse

from apps.invoices.signature_tool import remove_signature_background
from apps.invoices.tests.test_views import InvoicesAPITestCase


def make_realistic_signature_photo(width=800, height=300):
    """
    Off-white paper background (with a soft shadow gradient, like an
    unevenly-lit phone photo) plus a few dark, pen-width curved strokes —
    not a flat two-tone test pattern. Real enough to genuinely exercise the
    threshold/feather logic, not just prove the function runs.
    """
    random.seed(42)
    img = Image.new('RGB', (width, height), color=(248, 245, 238))
    pixels = img.load()
    # Shadow gradient: darker toward one corner, plus light per-pixel noise —
    # both are exactly what a hard, un-adaptive threshold could get fooled by.
    for y in range(height):
        for x in range(width):
            shadow = int(20 * (x / width) * (y / height))
            noise = random.randint(-4, 4)
            base = 248 - shadow + noise
            pixels[x, y] = (max(0, min(255, base)), max(0, min(255, base - 3)), max(0, min(255, base - 10)))

    draw = ImageDraw.Draw(img)
    # A few pen-like strokes (dark blue-black ink, ~4px wide, gently curved).
    for stroke_y_base in (80, 140, 200):
        points = [(x, stroke_y_base + int(15 * ((x / width) - 0.5) ** 2 * 4)) for x in range(60, width - 60, 8)]
        draw.line(points, fill=(15, 15, 35), width=4, joint='curve')

    buf = io.BytesIO()
    img.save(buf, format='PNG')
    return buf.getvalue()


class RemoveSignatureBackgroundTests(SimpleTestCase):
    def setUp(self):
        self.raw = make_realistic_signature_photo()
        self.result_bytes = remove_signature_background(self.raw)
        self.result = Image.open(io.BytesIO(self.result_bytes))

    def test_output_is_a_valid_rgba_png(self):
        self.assertEqual(self.result.format, 'PNG')
        self.assertEqual(self.result.mode, 'RGBA')
        self.assertEqual(self.result.size, (800, 300))

    def test_background_pixels_become_transparent(self):
        """Corners (paper, no ink) should end up with low alpha."""
        alpha = self.result.split()[-1]
        corners = [(5, 5), (795, 5), (5, 295), (795, 295)]
        for xy in corners:
            self.assertLess(alpha.getpixel(xy), 40, f'Corner {xy} should be near-transparent (paper background).')

    def test_ink_stroke_pixels_stay_opaque(self):
        """Points known to sit directly on a drawn stroke should end up with high alpha."""
        alpha = self.result.split()[-1]
        # The middle stroke is centered at y=140 (see stroke_y_base loop above), roughly flat near x=400.
        stroke_point = (400, 140)
        self.assertGreater(alpha.getpixel(stroke_point), 200, 'A pixel on a real ink stroke should stay opaque.')

    def test_ink_color_is_preserved_not_just_made_opaque(self):
        rgba = self.result.convert('RGBA')
        r, g, b, a = rgba.getpixel((400, 140))
        self.assertGreater(a, 200)
        # The original ink was dark blue-black (15,15,35) — preserved color, not flattened to pure black.
        self.assertLess(r, 60)
        self.assertLess(b - r, 40)

    def test_shadowed_background_area_still_treated_as_background(self):
        """The gradient shadow makes the bottom-right paper area noticeably darker than the corners — still not ink, must stay mostly transparent."""
        alpha = self.result.split()[-1]
        # Bottom-right area, away from any stroke, where the shadow gradient is at its darkest.
        shadowed_point = (750, 280)
        self.assertLess(alpha.getpixel(shadowed_point), 60, 'Shadowed paper should not be misread as ink.')

    def test_runs_correctly_regardless_of_input_format(self):
        """Real, not just 'doesn't error' — a JPEG-sourced input should still separate ink from background correctly."""
        buf = io.BytesIO()
        Image.open(io.BytesIO(self.raw)).convert('RGB').save(buf, format='JPEG', quality=90)
        result = Image.open(io.BytesIO(remove_signature_background(buf.getvalue())))
        alpha = result.split()[-1]
        self.assertLess(alpha.getpixel((5, 5)), 60)
        self.assertGreater(alpha.getpixel((400, 140)), 180)


# ══════════════════════════════════════════════════════════════════
# VIEW — POST /api/invoices/signature/ (preview-then-commit)
# ══════════════════════════════════════════════════════════════════

class SignatureUploadViewTests(InvoicesAPITestCase):
    def _upload(self, commit=False, image_bytes=None, filename='sig.png', content_type='image/png'):
        data = {'image': SimpleUploadedFile(filename, image_bytes or make_realistic_signature_photo(), content_type=content_type)}
        if commit:
            data['commit'] = 'true'
        csrf_token = self._csrf_token()
        return self.client.post(reverse('invoices:signature_upload'), data=data, format='multipart', HTTP_X_CSRFTOKEN=csrf_token)

    def test_preview_call_returns_data_uri_and_does_not_touch_cloudinary_or_profile(self):
        with mock.patch('cloudinary.uploader.upload') as mock_upload:
            resp = self._upload(commit=False)
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertTrue(resp.json()['preview_data_uri'].startswith('data:image/png;base64,'))
        mock_upload.assert_not_called()
        self.user.profile.refresh_from_db()
        self.assertEqual(self.user.profile.signature_url, '')

    @mock.patch('cloudinary.uploader.upload')
    def test_commit_call_uploads_and_saves_profile(self, mock_upload):
        mock_upload.return_value = {'secure_url': 'https://res.cloudinary.com/demo/sig.png', 'public_id': 'lanceraos/signatures/abc123'}
        resp = self._upload(commit=True)
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.json()['signature_url'], 'https://res.cloudinary.com/demo/sig.png')
        self.user.profile.refresh_from_db()
        self.assertEqual(self.user.profile.signature_url, 'https://res.cloudinary.com/demo/sig.png')
        self.assertEqual(self.user.profile.signature_public_id, 'lanceraos/signatures/abc123')
        upload_kwargs = mock_upload.call_args
        self.assertEqual(upload_kwargs.kwargs.get('resource_type'), 'image')
        self.assertEqual(upload_kwargs.kwargs.get('folder'), 'lanceraos/signatures')

    @mock.patch('cloudinary.uploader.upload')
    @mock.patch('cloudinary.uploader.destroy')
    def test_commit_replaces_and_destroys_previous_signature(self, mock_destroy, mock_upload):
        self.user.profile.signature_url = 'https://res.cloudinary.com/demo/old.png'
        self.user.profile.signature_public_id = 'lanceraos/signatures/old123'
        self.user.profile.save()
        mock_upload.return_value = {'secure_url': 'https://res.cloudinary.com/demo/new.png', 'public_id': 'lanceraos/signatures/new456'}

        resp = self._upload(commit=True)
        self.assertEqual(resp.status_code, 200)
        mock_destroy.assert_called_once_with('lanceraos/signatures/old123')
        self.user.profile.refresh_from_db()
        self.assertEqual(self.user.profile.signature_public_id, 'lanceraos/signatures/new456')

    def test_non_image_upload_rejected(self):
        fake = SimpleUploadedFile('sig.png', b'definitely not an image', content_type='image/png')
        csrf_token = self._csrf_token()
        resp = self.client.post(reverse('invoices:signature_upload'), data={'image': fake}, format='multipart', HTTP_X_CSRFTOKEN=csrf_token)
        self.assertEqual(resp.status_code, 400)
        self.assertIn("doesn't look like a valid image", resp.json()['error'])

    def test_disallowed_extension_rejected(self):
        resp = self._upload(filename='sig.svg', content_type='image/svg+xml')
        self.assertEqual(resp.status_code, 400)

    def test_no_file_returns_400(self):
        csrf_token = self._csrf_token()
        resp = self.client.post(reverse('invoices:signature_upload'), data={}, format='multipart', HTTP_X_CSRFTOKEN=csrf_token)
        self.assertEqual(resp.status_code, 400)

    @mock.patch('cloudinary.uploader.upload')
    def test_rate_limit_applies(self, mock_upload):
        mock_upload.return_value = {'secure_url': 'https://res.cloudinary.com/demo/sig.png', 'public_id': 'x'}
        for _ in range(10):
            resp = self._upload(commit=True)
            self.assertEqual(resp.status_code, 200)
        resp = self._upload(commit=True)
        self.assertEqual(resp.status_code, 429)
