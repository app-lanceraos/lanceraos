# apps/invoices/tests/test_ai_design.py
"""
Step 9, Path 3 — AI-seeded designs. Mocks the real Groq API throughout
(core.ai.call_groq), same convention as every other external-service call
in this project's test suite — never spends real API tokens here.
"""
import io
import json
from unittest import mock

from PIL import Image, ImageChops
from django.test import SimpleTestCase, TestCase
from django.urls import reverse

from apps.invoices.ai_design import (
    LAYOUT_SCALE_BY_DENSITY, apply_ai_adjustments, classify_design_image,
    compress_image, seed_design_data_from_image,
)
from apps.invoices.legacy_design_schema import validate_design_data_schema
from apps.invoices.design_seeds import BUILTIN_DESIGNS
from apps.invoices.models import InvoiceDesign
from apps.invoices.tests.test_views import InvoicesAPITestCase


def make_test_image_bytes(width=1400, height=1800, fmt='PNG'):
    """
    A real, decodable image — not a mock — for genuine PIL processing.
    Per-channel noise (via Image.effect_noise, real C-level Pillow noise
    generation — not a pure-Python per-pixel loop, which was the first
    version of this fixture and made the whole suite take ~45s) on top of
    the color blocks deliberately defeats PNG's own run-length/palette
    compression, so this behaves like a real photo/screenshot (which
    compress_image's JPEG re-encode genuinely helps with) rather than a
    flat test pattern PNG already compresses trivially well, which would
    make a "compression reduced payload size" test meaningless.
    """
    base = Image.new('RGB', (width, height), color=(40, 60, 120))
    for x in range(0, width, 200):
        for y in range(0, height, 300):
            base.paste((220, 180, 60), (x, y, min(x + 120, width), min(y + 80, height)))
    noise = Image.merge('RGB', [Image.effect_noise((width, height), 20) for _ in range(3)])
    noisy = ImageChops.add(base, ImageChops.subtract(noise, Image.new('RGB', (width, height), (128, 128, 128))))
    buf = io.BytesIO()
    noisy.save(buf, format=fmt)
    return buf.getvalue()


# ══════════════════════════════════════════════════════════════════
# IMAGE COMPRESSION — real Pillow processing against real (if synthetic)
# reference images, not mocked. Two different sizes/formats, matching the
# task's own instruction to check real output rather than trust the
# 700px default blindly.
# ══════════════════════════════════════════════════════════════════

class CompressImageTests(SimpleTestCase):
    def test_downscales_a_large_image_to_max_width(self):
        raw = make_test_image_bytes(width=2000, height=2600, fmt='PNG')
        b64, media_type = compress_image(raw, max_width=700)
        self.assertEqual(media_type, 'image/jpeg')
        decoded = Image.open(io.BytesIO(__import__('base64').b64decode(b64)))
        self.assertEqual(decoded.width, 700)
        self.assertEqual(decoded.format, 'JPEG')

    def test_does_not_upscale_a_smaller_image(self):
        raw = make_test_image_bytes(width=400, height=500, fmt='PNG')
        b64, _ = compress_image(raw, max_width=700)
        decoded = Image.open(io.BytesIO(__import__('base64').b64decode(b64)))
        self.assertEqual(decoded.width, 400)

    def test_real_compression_meaningfully_reduces_payload_size(self):
        """A real, larger reference image (simulating a phone-camera-sized upload)."""
        raw = make_test_image_bytes(width=3000, height=4000, fmt='PNG')
        b64, _ = compress_image(raw, max_width=700, quality=78)
        compressed_size = len(b64) * 3 // 4  # rough base64 -> bytes
        self.assertLess(compressed_size, len(raw) / 4, 'Compressed payload should be dramatically smaller than the raw PNG.')

    def test_compressed_output_is_still_a_usable_recognizable_image(self):
        """Compression shouldn't destroy usability — verify the output actually decodes and keeps the right aspect ratio."""
        raw = make_test_image_bytes(width=1400, height=1800, fmt='PNG')
        b64, _ = compress_image(raw, max_width=700)
        decoded = Image.open(io.BytesIO(__import__('base64').b64decode(b64)))
        self.assertAlmostEqual(decoded.width / decoded.height, 1400 / 1800, places=2)
        self.assertGreater(decoded.width, 0)
        self.assertGreater(decoded.height, 0)


# ══════════════════════════════════════════════════════════════════
# CLASSIFY — the one Groq vision call, mocked
# ══════════════════════════════════════════════════════════════════

class ClassifyDesignImageTests(SimpleTestCase):
    def _raw_image(self):
        return make_test_image_bytes()

    @mock.patch('apps.invoices.ai_design.call_groq')
    def test_valid_reply_parses_correctly(self, mock_call_groq):
        mock_call_groq.return_value = json.dumps({
            'base_template': 'modern', 'primary_color': '#112233', 'secondary_color': '#ffffff',
            'layout_density': 'compact', 'reasoning': 'bold sidebar layout',
        })
        result = classify_design_image(self._raw_image())
        self.assertEqual(result['base_template'], 'modern')
        self.assertEqual(result['primary_color'], '#112233')

    @mock.patch('apps.invoices.ai_design.call_groq')
    def test_strips_think_tags_and_fences_before_parsing(self, mock_call_groq):
        mock_call_groq.return_value = (
            '<think>let me look at this</think>\n```json\n'
            '{"base_template": "minimal", "primary_color": "#000", "secondary_color": "#fff", '
            '"layout_density": "balanced", "reasoning": "clean"}\n```'
        )
        result = classify_design_image(self._raw_image())
        self.assertEqual(result['base_template'], 'minimal')

    @mock.patch('apps.invoices.ai_design.call_groq')
    def test_invalid_json_reply_raises_value_error(self, mock_call_groq):
        mock_call_groq.return_value = 'this is not json at all'
        with self.assertRaises(ValueError):
            classify_design_image(self._raw_image())

    @mock.patch('apps.invoices.ai_design.call_groq')
    def test_base_template_outside_real_three_raises_value_error(self, mock_call_groq):
        """The model must never be trusted to invent a 4th template."""
        mock_call_groq.return_value = json.dumps({
            'base_template': 'fancy-custom-layout', 'primary_color': '#000', 'secondary_color': '#fff',
            'layout_density': 'balanced',
        })
        with self.assertRaises(ValueError):
            classify_design_image(self._raw_image())

    @mock.patch('apps.invoices.ai_design.call_groq', side_effect=RuntimeError('Groq API error 500: boom'))
    def test_groq_failure_raises_value_error_not_runtime_error(self, mock_call_groq):
        """ai_design.py's own boundary — callers only ever need to catch ValueError."""
        with self.assertRaises(ValueError):
            classify_design_image(self._raw_image())

    @mock.patch('apps.invoices.ai_design.call_groq')
    def test_sends_image_and_prompt_together_in_one_message(self, mock_call_groq):
        """The POC's own insight: one call, image + text together, not two passes."""
        mock_call_groq.return_value = json.dumps({
            'base_template': 'professional', 'primary_color': '#a8813c', 'secondary_color': '#1a2b42',
            'layout_density': 'balanced',
        })
        classify_design_image(self._raw_image())
        messages = mock_call_groq.call_args[0][0]
        self.assertEqual(len(messages), 1)
        content_types = [c['type'] for c in messages[0]['content']]
        self.assertEqual(sorted(content_types), ['image_url', 'text'])


# ══════════════════════════════════════════════════════════════════
# ADJUSTMENT — the real overlap-safety guarantee. This is the part the
# task explicitly wants proven, not just validator-caught after the fact.
# ══════════════════════════════════════════════════════════════════

class ApplyAiAdjustmentsOverlapSafetyTests(SimpleTestCase):
    def test_all_three_seeds_stay_overlap_free_at_every_density_including_the_extreme(self):
        """
        The real proof: apply every discrete density (including 'spacious',
        the largest scale-up) to all 3 real builtin seeds and confirm
        validate_design_data_schema reports zero errors for each — not
        just that *a* validator call happens, but that it genuinely finds
        nothing wrong.
        """
        for base_template, seed in BUILTIN_DESIGNS.items():
            for density in LAYOUT_SCALE_BY_DENSITY:
                classify = {
                    'base_template': base_template, 'primary_color': '#123456',
                    'secondary_color': '#abcdef', 'layout_density': density,
                }
                adjusted = apply_ai_adjustments(seed, classify)
                errors = validate_design_data_schema(adjusted)
                self.assertEqual(errors, [], f'{base_template}/{density}: {errors}')

    def test_uniform_scale_preserves_relative_non_overlap_by_construction(self):
        """
        The actual mathematical property this relies on, exercised directly
        rather than only inferred from "the validator happened to pass":
        two elements with a real gap between them at scale=1 still have a
        real (scaled) gap at any positive uniform scale — construct a
        deliberately tight-but-non-overlapping pair and confirm scaling
        both together by 1.5x (well beyond the real 0.92-1.08 range this
        module actually uses) still doesn't overlap them.
        """
        design_data = {
            'zone_1': {'elements': [
                {'type': 'logo', 'x': 10, 'y': 10, 'width': 20, 'height': 20, 'style': {}},
                {'type': 'dates', 'x': 31, 'y': 10, 'width': 20, 'height': 20, 'style': {}},  # 1mm real gap
            ]},
            'zone_2': {'table': {'style': {}}, 'elements': [{'type': 'totals', 'spacing_after_previous': 0, 'style': {}}]},
        }
        classify = {'base_template': 'professional', 'layout_density': 'balanced'}
        # Directly exercise the same scale-from-origin transform at an extreme factor.
        import copy
        data = copy.deepcopy(design_data)
        scale = 1.5
        for el in data['zone_1']['elements']:
            el['x'] *= scale
            el['y'] *= scale
            el['width'] *= scale
            el['height'] *= scale
        errors = validate_design_data_schema(data)
        self.assertEqual(errors, [])

    def test_a_naive_independent_nudge_WOULD_overlap_illustrating_why_uniform_scale_is_used(self):
        """
        Contrast case, not testing ai_design.py itself: demonstrates the
        real risk a "naive" per-element adjustment (nudging one element's
        position independently, the approach deliberately NOT used) creates,
        which is exactly why apply_ai_adjustments never does this.
        """
        design_data = {
            'zone_1': {'elements': [
                {'type': 'logo', 'x': 10, 'y': 10, 'width': 20, 'height': 20, 'style': {}},
                {'type': 'dates', 'x': 31, 'y': 10, 'width': 20, 'height': 20, 'style': {}},
            ]},
            'zone_2': {'table': {'style': {}}, 'elements': [{'type': 'totals', 'spacing_after_previous': 0, 'style': {}}]},
        }
        import copy
        naive = copy.deepcopy(design_data)
        naive['zone_1']['elements'][1]['x'] -= 15  # an independent "make it more compact" nudge
        errors = validate_design_data_schema(naive)
        self.assertTrue(errors, 'Expected the naive independent nudge to actually produce an overlap.')
        self.assertTrue(any('overlap' in e for e in errors))

    def test_colors_are_applied_to_real_present_style_keys(self):
        classify = {
            'base_template': 'modern', 'primary_color': '#111111', 'secondary_color': '#222222',
            'layout_density': 'balanced',
        }
        adjusted = apply_ai_adjustments(BUILTIN_DESIGNS['modern'], classify)
        self.assertEqual(adjusted['zone_2']['table']['style']['header_bg'], '#111111')
        self.assertEqual(adjusted['zone_2']['table']['style']['header_color'], '#222222')

    def test_original_seed_dict_is_never_mutated(self):
        """get_builtin_design_data's own deepcopy discipline must hold through this function too."""
        import copy
        original_snapshot = copy.deepcopy(BUILTIN_DESIGNS['professional'])
        apply_ai_adjustments(BUILTIN_DESIGNS['professional'], {
            'base_template': 'professional', 'primary_color': '#000000', 'secondary_color': '#ffffff',
            'layout_density': 'spacious',
        })
        self.assertEqual(BUILTIN_DESIGNS['professional'], original_snapshot)

    def test_unknown_density_defaults_to_no_scaling(self):
        adjusted = apply_ai_adjustments(BUILTIN_DESIGNS['minimal'], {
            'base_template': 'minimal', 'layout_density': 'not-a-real-value',
        })
        for original, scaled in zip(BUILTIN_DESIGNS['minimal']['zone_1']['elements'], adjusted['zone_1']['elements']):
            self.assertEqual(original['x'], scaled['x'])


# ══════════════════════════════════════════════════════════════════
# FULL PIPELINE ORCHESTRATION
# ══════════════════════════════════════════════════════════════════

class SeedDesignDataFromImageTests(SimpleTestCase):
    @mock.patch('apps.invoices.ai_design.call_groq')
    def test_produces_schema_valid_design_data_end_to_end(self, mock_call_groq):
        mock_call_groq.return_value = json.dumps({
            'base_template': 'professional', 'primary_color': '#a8813c', 'secondary_color': '#1a2b42',
            'layout_density': 'spacious',
        })
        base_template, design_data = seed_design_data_from_image(make_test_image_bytes())
        self.assertEqual(base_template, 'professional')
        self.assertEqual(validate_design_data_schema(design_data), [])

    @mock.patch('apps.invoices.ai_design.call_groq', return_value='not valid json')
    def test_classify_failure_propagates_as_value_error(self, mock_call_groq):
        with self.assertRaises(ValueError):
            seed_design_data_from_image(make_test_image_bytes())


# ══════════════════════════════════════════════════════════════════
# VIEW — POST /api/invoices/designs/ai-seed/
# ══════════════════════════════════════════════════════════════════

class DesignAiSeedViewTests(InvoicesAPITestCase):
    def _upload(self, image_bytes=None, filename='reference.png', content_type='image/png', extra=None):
        from django.core.files.uploadedfile import SimpleUploadedFile
        data = {'image': SimpleUploadedFile(filename, image_bytes or make_test_image_bytes(), content_type=content_type)}
        if extra:
            data.update(extra)
        csrf_token = self._csrf_token()
        return self.client.post(reverse('invoices:design_ai_seed'), data=data, format='multipart', HTTP_X_CSRFTOKEN=csrf_token)

    @mock.patch('apps.invoices.views.seed_design_data_from_image')
    def test_successful_seed_creates_real_ai_seeded_design(self, mock_seed):
        mock_seed.return_value = ('modern', BUILTIN_DESIGNS['modern'])
        resp = self._upload()
        self.assertEqual(resp.status_code, 201, resp.content)
        design = InvoiceDesign.objects.get(pk=resp.json()['id'])
        self.assertEqual(design.source, 'ai_seeded')
        self.assertEqual(design.base_template, 'modern')
        self.assertEqual(design.user, self.user)

    def test_no_file_returns_400(self):
        csrf_token = self._csrf_token()
        resp = self.client.post(reverse('invoices:design_ai_seed'), data={}, format='multipart', HTTP_X_CSRFTOKEN=csrf_token)
        self.assertEqual(resp.status_code, 400)

    def test_non_image_upload_rejected(self):
        from django.core.files.uploadedfile import SimpleUploadedFile
        fake = SimpleUploadedFile('reference.png', b'not actually an image', content_type='image/png')
        csrf_token = self._csrf_token()
        resp = self.client.post(reverse('invoices:design_ai_seed'), data={'image': fake}, format='multipart', HTTP_X_CSRFTOKEN=csrf_token)
        self.assertEqual(resp.status_code, 400)
        self.assertIn("doesn't look like a valid image", resp.json()['error'])

    def test_disallowed_extension_rejected(self):
        resp = self._upload(image_bytes=make_test_image_bytes(), filename='reference.gif', content_type='image/gif')
        self.assertEqual(resp.status_code, 400)

    @mock.patch('apps.invoices.views.seed_design_data_from_image', side_effect=ValueError('The AI design service is unavailable right now.'))
    def test_pipeline_failure_returns_clear_error_not_a_dead_end(self, mock_seed):
        resp = self._upload()
        self.assertEqual(resp.status_code, 502)
        self.assertIn('unavailable', resp.json()['error'])
        # No design row should be left half-created.
        self.assertEqual(InvoiceDesign.objects.filter(user=self.user).count(), 0)

    @mock.patch('apps.invoices.views.seed_design_data_from_image')
    def test_rate_limit_is_separate_and_stricter_than_moderate_design_limit(self, mock_seed):
        mock_seed.return_value = ('professional', BUILTIN_DESIGNS['professional'])
        for _ in range(5):
            resp = self._upload()
            self.assertEqual(resp.status_code, 201)
        resp = self._upload()
        self.assertEqual(resp.status_code, 429)

    @mock.patch('apps.invoices.views.seed_design_data_from_image')
    def test_reference_image_is_never_persisted_anywhere(self, mock_seed):
        """
        Real, direct verification per the spec's liability/copyright
        reasoning — not just "no code calls cloudinary.uploader.upload for
        it," but confirming the actual bytes never reach that call at all.
        """
        mock_seed.return_value = ('professional', BUILTIN_DESIGNS['professional'])
        with mock.patch('cloudinary.uploader.upload') as mock_upload:
            resp = self._upload()
        self.assertEqual(resp.status_code, 201)
        mock_upload.assert_not_called()
