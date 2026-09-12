# apps/invoices/tests/test_design_upload_image.py
"""
Tests for views_design_editor.design_upload_image — the new, authenticated
endpoint that lets the Template Builder's canvas upload an editor-authored
image (file picker / clipboard paste) to Cloudinary instead of embedding it
as an in-memory `data:` URI forever. Follows the exact same
validation/rate-limit/Cloudinary-mocking pattern as
test_signature_tool.py's SignatureUploadViewTests and apps/users' own
upload_logo tests.
"""
import io
from unittest import mock

from PIL import Image
from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse

from apps.invoices.tests.test_views import InvoicesAPITestCase


def _make_png_bytes(size=(40, 30)):
    buf = io.BytesIO()
    Image.new('RGB', size, (200, 50, 50)).save(buf, format='PNG')
    return buf.getvalue()


class DesignUploadImageViewTests(InvoicesAPITestCase):
    def _upload(self, image_bytes=None, filename='canvas-image.png', content_type='image/png'):
        csrf_token = self._csrf_token()
        return self.client.post(
            reverse('invoices:design_upload_image'),
            data={'image': SimpleUploadedFile(filename, image_bytes or _make_png_bytes(), content_type=content_type)},
            format='multipart', HTTP_X_CSRFTOKEN=csrf_token,
        )

    @mock.patch('cloudinary.uploader.upload')
    def test_happy_path_uploads_to_its_own_folder_and_returns_url_and_public_id(self, mock_upload):
        mock_upload.return_value = {
            'secure_url': 'https://res.cloudinary.com/demo/design-images/abc123.png',
            'public_id': 'lanceraos/design-images/abc123',
        }
        resp = self._upload()
        self.assertEqual(resp.status_code, 200, resp.content)
        body = resp.json()
        self.assertEqual(body['secure_url'], 'https://res.cloudinary.com/demo/design-images/abc123.png')
        self.assertEqual(body['public_id'], 'lanceraos/design-images/abc123')

        upload_kwargs = mock_upload.call_args
        self.assertEqual(upload_kwargs.kwargs.get('folder'), 'lanceraos/design-images')
        self.assertEqual(upload_kwargs.kwargs.get('resource_type'), 'image')

    @mock.patch('cloudinary.uploader.destroy')
    @mock.patch('cloudinary.uploader.upload')
    def test_never_calls_destroy_no_replace_on_upload_semantics(self, mock_upload, mock_destroy):
        """Unlike logo/signature, a canvas image has no 'previous one' to replace — destroy must never be called."""
        mock_upload.return_value = {'secure_url': 'https://res.cloudinary.com/demo/x.png', 'public_id': 'lanceraos/design-images/x'}
        self._upload()
        mock_destroy.assert_not_called()

    def test_no_file_returns_400(self):
        csrf_token = self._csrf_token()
        resp = self.client.post(reverse('invoices:design_upload_image'), data={}, format='multipart', HTTP_X_CSRFTOKEN=csrf_token)
        self.assertEqual(resp.status_code, 400)

    def test_disallowed_extension_rejected(self):
        resp = self._upload(filename='image.svg', content_type='image/svg+xml')
        self.assertEqual(resp.status_code, 400)

    def test_non_image_content_rejected(self):
        fake = SimpleUploadedFile('image.png', b'definitely not an image', content_type='image/png')
        csrf_token = self._csrf_token()
        resp = self.client.post(reverse('invoices:design_upload_image'), data={'image': fake}, format='multipart', HTTP_X_CSRFTOKEN=csrf_token)
        self.assertEqual(resp.status_code, 400)
        self.assertIn("doesn't look like a valid image", resp.json()['error'])

    def test_oversized_file_rejected_with_10mb_message(self):
        big_file = SimpleUploadedFile('image.png', b'\x00' * (10 * 1024 * 1024 + 1), content_type='image/png')
        csrf_token = self._csrf_token()
        resp = self.client.post(reverse('invoices:design_upload_image'), data={'image': big_file}, format='multipart', HTTP_X_CSRFTOKEN=csrf_token)
        self.assertEqual(resp.status_code, 400)
        self.assertIn('10MB', resp.json()['error'])

    def test_unauthenticated_request_rejected(self):
        self.client.logout()
        resp = self._upload()
        self.assertIn(resp.status_code, (401, 403))

    @mock.patch('cloudinary.uploader.upload')
    def test_rate_limit_applies_at_moderate_tier_30_per_hour(self, mock_upload):
        mock_upload.return_value = {'secure_url': 'https://res.cloudinary.com/demo/x.png', 'public_id': 'x'}
        for _ in range(30):
            resp = self._upload()
            self.assertEqual(resp.status_code, 200, resp.content)
        resp = self._upload()
        self.assertEqual(resp.status_code, 429)
        self.assertIn('error', resp.json())
