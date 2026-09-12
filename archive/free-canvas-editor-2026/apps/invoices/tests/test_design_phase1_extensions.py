# apps/invoices/tests/test_design_phase1_extensions.py
"""
Phase 1 (rotation/ellipse/footer/crop, 07 September 2026) — schema and
canonical-renderer coverage for the 4 additive design_data capabilities
this phase introduced: element `rotation`, the `ellipse` generic type,
`page.footer`, and image `crop`. Every case here was first verified live
against a real WeasyPrint render before being written down as a permanent
test (see DECISIONS.md's own entry for the full before/after evidence,
including real rendered PNGs) — these tests pin that verified behavior
down, they don't replace it.
"""
import copy

import fitz  # PyMuPDF
from django.test import SimpleTestCase

from apps.invoices.design_renderer import (
    SHAPE_TYPES_WITH_OWN_FILL,
    build_render_context,
    render_design_html,
    render_design_pdf_bytes,
)
from apps.invoices.design_schema import rotated_bounding_box, validate_design_data_schema_v2
from apps.invoices.tests.test_views import InvoicesAPITestCase

MINIMAL_TABLE = {'kind': 'structural', 'type': 'table', 'x': 0, 'y': 100, 'width': 174, 'height': 30, 'style': {}, 'overrides': {}}
MINIMAL_TOTALS = {'kind': 'semantic', 'type': 'totals', 'x': 0, 'y': 140, 'width': 174, 'height': 20, 'style': {}, 'overrides': {}}


def base_design():
    return {
        'schema_version': 2,
        'page': {'size': 'A4', 'width_mm': 210, 'height_mm': 297},
        'header': {'elements': []},
        'flow': {'elements': [copy.deepcopy(MINIMAL_TABLE), copy.deepcopy(MINIMAL_TOTALS)]},
    }


# ══════════════════════════════════════════════════════════════════
# ROTATION — schema validation
# ══════════════════════════════════════════════════════════════════

class RotationValidationTests(SimpleTestCase):
    def test_rotation_absent_is_valid(self):
        self.assertEqual(validate_design_data_schema_v2(base_design()), [])

    def test_rotation_zero_on_pinned_element_is_valid(self):
        d = base_design()
        d['header']['elements'].append({
            'kind': 'generic', 'type': 'rectangle', 'x': 0, 'y': 0, 'width': 20, 'height': 20,
            'rotation': 0, 'style': {}, 'overrides': {},
        })
        self.assertEqual(validate_design_data_schema_v2(d), [])

    def test_nonzero_rotation_on_pinned_element_is_valid(self):
        # Positioned away from the page edges deliberately — a rotated
        # box's real (rotated) footprint can extend beyond its own
        # unrotated x/y (see _validate_page_bounds' own rotation-aware
        # extension), so a rotated element flush against x=0/y=0 would
        # correctly, separately fail the bounds check; this test is
        # about rotation validity alone.
        d = base_design()
        d['header']['elements'].append({
            'kind': 'generic', 'type': 'rectangle', 'x': 50, 'y': 50, 'width': 20, 'height': 20,
            'rotation': 30, 'style': {}, 'overrides': {},
        })
        self.assertEqual(validate_design_data_schema_v2(d), [])

    def test_nonzero_rotation_on_flow_layout_element_is_rejected(self):
        d = base_design()
        d['flow']['elements'].append({
            'kind': 'generic', 'type': 'rectangle', 'x': 0, 'y': 60, 'width': 20, 'height': 20,
            'rotation': 30, 'layout_mode': 'flow', 'style': {}, 'overrides': {},
        })
        errors = validate_design_data_schema_v2(d)
        self.assertTrue(any('rotation must be 0' in e and 'flow' in e for e in errors), errors)

    def test_zero_rotation_on_flow_layout_element_is_valid(self):
        d = base_design()
        d['flow']['elements'].append({
            'kind': 'generic', 'type': 'rectangle', 'x': 0, 'y': 60, 'width': 20, 'height': 20,
            'rotation': 0, 'layout_mode': 'flow', 'style': {}, 'overrides': {},
        })
        self.assertEqual(validate_design_data_schema_v2(d), [])

    def test_non_numeric_rotation_rejected(self):
        d = base_design()
        d['header']['elements'].append({
            'kind': 'generic', 'type': 'rectangle', 'x': 0, 'y': 0, 'width': 20, 'height': 20,
            'rotation': 'a lot', 'style': {}, 'overrides': {},
        })
        errors = validate_design_data_schema_v2(d)
        self.assertTrue(any('rotation must be a number' in e for e in errors), errors)

    def test_non_numeric_rotation_does_not_crash_the_overlap_or_bounds_pass(self):
        # A real bug found while writing this test suite: the overlap/
        # bounds passes run against every structurally-valid-geometry
        # element regardless of whether ITS OWN rotation value already
        # failed validation separately (_validate_element_list only
        # requires x/y/width/height to be numbers) — rotated_bounding_box
        # used to crash outright on a non-numeric rotation instead of
        # degrading to "treat as unrotated" the way the rest of this
        # validator tolerates one bad field without taking the whole
        # validation run down with it.
        d = base_design()
        d['header']['elements'].append({
            'kind': 'generic', 'type': 'rectangle', 'x': 50, 'y': 50, 'width': 20, 'height': 20,
            'rotation': 'a lot', 'style': {}, 'overrides': {},
        })
        errors = validate_design_data_schema_v2(d)  # must not raise
        self.assertTrue(any('rotation must be a number' in e for e in errors), errors)


class RotatedElementNearPageEdgeTests(SimpleTestCase):
    """
    Phase 1's own deliberate extension of _validate_page_bounds to use
    the real rotated footprint (not just the "Critical" _validate_overlap
    requirement) — a rotated element's true top-left corner can sit
    outside its own unrotated x/y, so a plain x>=0/y>=0 check would
    under-enforce for a rotated element flush against a page edge.
    """

    def test_rotated_box_flush_with_the_left_edge_can_genuinely_poke_off_page(self):
        d = base_design()
        d['header']['elements'].append({
            'kind': 'generic', 'type': 'rectangle', 'x': 0, 'y': 0, 'width': 20, 'height': 20,
            'rotation': 30, 'style': {}, 'overrides': {},
        })
        errors = validate_design_data_schema_v2(d)
        self.assertTrue(any('may not start before' in e for e in errors), errors)

    def test_same_box_moved_away_from_the_edge_is_valid(self):
        d = base_design()
        d['header']['elements'].append({
            'kind': 'generic', 'type': 'rectangle', 'x': 50, 'y': 50, 'width': 20, 'height': 20,
            'rotation': 30, 'style': {}, 'overrides': {},
        })
        self.assertEqual(validate_design_data_schema_v2(d), [])


# ══════════════════════════════════════════════════════════════════
# ROTATION — rotated_bounding_box math (the Python port of the
# editor's own utils/geometry.js rotatedBoundingBox)
# ══════════════════════════════════════════════════════════════════

class RotatedBoundingBoxTests(SimpleTestCase):
    def test_zero_rotation_returns_the_plain_unrotated_box(self):
        box = rotated_bounding_box({'x': 10, 'y': 20, 'width': 30, 'height': 40})
        self.assertEqual(box, {'minX': 10, 'maxX': 40, 'minY': 20, 'maxY': 60})

    def test_90_degree_rotation_swaps_width_and_height_footprint(self):
        # A 100x10 box rotated 90deg around its own center occupies a
        # real footprint that is 10 wide x 100 tall — width/height swap.
        box = rotated_bounding_box({'x': 0, 'y': 0, 'width': 100, 'height': 10, 'rotation': 90})
        self.assertAlmostEqual(box['maxX'] - box['minX'], 10, places=6)
        self.assertAlmostEqual(box['maxY'] - box['minY'], 100, places=6)

    def test_45_degree_rotation_grows_the_bounding_box_by_the_real_diagonal(self):
        box = rotated_bounding_box({'x': 0, 'y': 0, 'width': 40, 'height': 40, 'rotation': 45})
        # A 40x40 square rotated 45deg has a real diagonal footprint of
        # 40*sqrt(2) =~ 56.57, centered on the original center (20, 20).
        self.assertAlmostEqual(box['maxX'] - box['minX'], 40 * (2 ** 0.5), places=4)


# ══════════════════════════════════════════════════════════════════
# ROTATION-AWARE OVERLAP — the "Critical" requirement: an axis-aligned
# test would pass designs that visibly overlap and fail designs that
# don't, once rotation exists. Both directions covered.
# ══════════════════════════════════════════════════════════════════

class RotationAwareOverlapTests(SimpleTestCase):
    def test_boxes_with_no_unrotated_overlap_but_real_rotated_overlap_are_caught(self):
        # Unrotated: box A spans x:[0,40], box B spans x:[41,81] — a real
        # 1mm gap, no overlap. Rotating A by 45deg grows its real
        # footprint to a ~56.57mm-wide diagonal centered at x=20, i.e.
        # x:[~-8.3, ~48.3] — genuinely reaching into box B's space.
        # Uses generic `text` (real content, still overlap-checked) rather
        # than `rectangle` — a decorative shape is now exempt from this
        # check entirely (see OVERLAP_EXEMPT_GENERIC_TYPES /
        # test_design_schema.py's own decorative-exemption tests), so it
        # would no longer exercise the rotation-aware overlap math this
        # test is actually about.
        d = base_design()
        d['header']['elements'] = [
            {'kind': 'generic', 'type': 'text', 'x': 0, 'y': 0, 'width': 40, 'height': 40, 'rotation': 45,
             'style': {}, 'overrides': {}},
            {'kind': 'generic', 'type': 'text', 'x': 41, 'y': 0, 'width': 40, 'height': 40,
             'style': {}, 'overrides': {}},
        ]
        errors = validate_design_data_schema_v2(d)
        self.assertTrue(any('overlap' in e for e in errors), errors)

    def test_boxes_with_unrotated_overlap_but_no_real_rotated_overlap_are_not_flagged(self):
        # Unrotated: box A spans x:[0,100], box B spans x:[60,160] — they
        # overlap under a plain axis-aligned test. Rotating A by 90deg
        # shrinks its real X-extent to its own height (10mm), centered on
        # its original center x=50, i.e. x:[45,55] — clear of box B
        # (starts at x=60). Uses generic `text` rather than `rectangle` —
        # a decorative shape now skips the rotated-overlap comparison
        # entirely (see OVERLAP_EXEMPT_GENERIC_TYPES), which would make
        # this pass trivially regardless of whether the rotation math
        # below is actually correct.
        d = base_design()
        d['header']['elements'] = [
            {'kind': 'generic', 'type': 'text', 'x': 0, 'y': 0, 'width': 100, 'height': 10, 'rotation': 90,
             'style': {}, 'overrides': {}},
            {'kind': 'generic', 'type': 'text', 'x': 60, 'y': 0, 'width': 100, 'height': 10,
             'style': {}, 'overrides': {}},
        ]
        errors = validate_design_data_schema_v2(d)
        self.assertFalse(any('overlap' in e for e in errors), errors)

    def test_zero_rotation_overlap_detection_is_unchanged(self):
        # Uses generic `text` for the same reason as the test above —
        # `rectangle` is now overlap-exempt (decorative), which is
        # unrelated to what this specific test (plain axis-aligned
        # detection still works at rotation=0) is verifying.
        d = base_design()
        d['header']['elements'] = [
            {'kind': 'generic', 'type': 'text', 'x': 0, 'y': 0, 'width': 40, 'height': 40,
             'style': {}, 'overrides': {}},
            {'kind': 'generic', 'type': 'text', 'x': 30, 'y': 0, 'width': 40, 'height': 40,
             'style': {}, 'overrides': {}},
        ]
        errors = validate_design_data_schema_v2(d)
        self.assertTrue(any('overlap' in e for e in errors), errors)


# ══════════════════════════════════════════════════════════════════
# ELLIPSE — schema + renderer
# ══════════════════════════════════════════════════════════════════

class EllipseSchemaTests(SimpleTestCase):
    def test_ellipse_is_a_valid_generic_type(self):
        d = base_design()
        d['header']['elements'].append({
            'kind': 'generic', 'type': 'ellipse', 'x': 0, 'y': 0, 'width': 20, 'height': 10,
            'style': {'background_color': '#00ff00'}, 'overrides': {},
        })
        self.assertEqual(validate_design_data_schema_v2(d), [])


# ══════════════════════════════════════════════════════════════════
# CROP — schema validation
# ══════════════════════════════════════════════════════════════════

class CropSchemaTests(SimpleTestCase):
    def test_crop_on_non_image_element_rejected(self):
        d = base_design()
        d['header']['elements'].append({
            'kind': 'generic', 'type': 'rectangle', 'x': 0, 'y': 0, 'width': 20, 'height': 20,
            'crop': {'x': 0, 'y': 0, 'width': 0.5, 'height': 0.5}, 'style': {}, 'overrides': {},
        })
        errors = validate_design_data_schema_v2(d)
        self.assertTrue(any('crop is only valid on a generic "image" element' in e for e in errors), errors)

    def test_crop_fractions_out_of_range_rejected(self):
        d = base_design()
        d['header']['elements'].append({
            'kind': 'generic', 'type': 'image', 'x': 0, 'y': 0, 'width': 20, 'height': 20,
            'crop': {'x': -0.1, 'y': 0, 'width': 1.5, 'height': 0.5},
            'style': {'src': 'data:image/png;base64,x'}, 'overrides': {},
        })
        errors = validate_design_data_schema_v2(d)
        self.assertTrue(any('crop.x' in e for e in errors), errors)
        self.assertTrue(any('crop.width' in e for e in errors), errors)

    def test_crop_missing_key_rejected(self):
        d = base_design()
        d['header']['elements'].append({
            'kind': 'generic', 'type': 'image', 'x': 0, 'y': 0, 'width': 20, 'height': 20,
            'crop': {'x': 0, 'y': 0}, 'style': {'src': 'data:image/png;base64,x'}, 'overrides': {},
        })
        errors = validate_design_data_schema_v2(d)
        self.assertTrue(any('crop is missing required key' in e for e in errors), errors)

    def test_valid_crop_accepted(self):
        d = base_design()
        d['header']['elements'].append({
            'kind': 'generic', 'type': 'image', 'x': 0, 'y': 0, 'width': 20, 'height': 20,
            'crop': {'x': 0.5, 'y': 0.0, 'width': 0.5, 'height': 0.5},
            'style': {'src': 'data:image/png;base64,x'}, 'overrides': {},
        })
        self.assertEqual(validate_design_data_schema_v2(d), [])


# ══════════════════════════════════════════════════════════════════
# PAGE.FOOTER — schema validation
# ══════════════════════════════════════════════════════════════════

class FooterSchemaTests(SimpleTestCase):
    def test_footer_absent_is_valid(self):
        self.assertEqual(validate_design_data_schema_v2(base_design()), [])

    def test_empty_footer_object_is_valid(self):
        d = base_design()
        d['page']['footer'] = {}
        self.assertEqual(validate_design_data_schema_v2(d), [])

    def test_footer_with_valid_style_is_valid(self):
        d = base_design()
        d['page']['footer'] = {'style': {
            'text_color': '#333333', 'background_color': '#ffffff', 'divider_color': '#cccccc',
            'font_family': 'IBM Plex Mono', 'font_size_pt': 8, 'font_weight': 600, 'show_wordmark': False,
        }}
        self.assertEqual(validate_design_data_schema_v2(d), [])

    def test_footer_style_invalid_font_size_rejected(self):
        d = base_design()
        d['page']['footer'] = {'style': {'font_size_pt': -1}}
        errors = validate_design_data_schema_v2(d)
        self.assertTrue(any('font_size_pt' in e for e in errors), errors)

    def test_footer_style_non_boolean_show_wordmark_rejected(self):
        d = base_design()
        d['page']['footer'] = {'style': {'show_wordmark': 'yes'}}
        errors = validate_design_data_schema_v2(d)
        self.assertTrue(any('show_wordmark' in e for e in errors), errors)

    def test_footer_non_object_rejected(self):
        d = base_design()
        d['page']['footer'] = 'not an object'
        errors = validate_design_data_schema_v2(d)
        self.assertTrue(any('page.footer, if present, must be an object' in e for e in errors), errors)


# ══════════════════════════════════════════════════════════════════
# RENDERER — real WeasyPrint output. Uses the real user/profile +
# render context established by InvoicesAPITestCase, matching this
# test suite's own established convention.
# ══════════════════════════════════════════════════════════════════

class RotationRendersInHtmlTests(InvoicesAPITestCase):
    def test_rotation_emits_a_real_css_transform(self):
        context = build_render_context(self.user, 'professional', '')
        d = base_design()
        d['header']['elements'].append({
            'kind': 'generic', 'type': 'rectangle', 'x': 10, 'y': 10, 'width': 30, 'height': 15,
            'rotation': 25, 'style': {'background_color': '#cc3333'}, 'overrides': {},
        })
        html = render_design_html(d, context, for_pdf=True)
        self.assertIn('transform:rotate(25deg)', html)
        self.assertIn('transform-origin:center', html)

    def test_zero_rotation_emits_no_transform(self):
        context = build_render_context(self.user, 'professional', '')
        d = base_design()
        d['header']['elements'].append({
            'kind': 'generic', 'type': 'rectangle', 'x': 10, 'y': 10, 'width': 30, 'height': 15,
            'style': {'background_color': '#cc3333'}, 'overrides': {},
        })
        html = render_design_html(d, context, for_pdf=True)
        self.assertNotIn('transform:rotate', html)


class EllipseRendersWithoutDoubleBackgroundTests(InvoicesAPITestCase):
    """
    Pins the real bug found during this phase's own live-render
    verification: the outer `.v2-el` wrapper used to ALSO paint
    `background-color` from the same `style.background_color` key
    `attach_generic_content`'s shape_css already resolves onto the INNER
    shaped div — invisible for a plain rectangle (both boxes identical),
    but it silently hid an ellipse's own rounding behind a sharp-cornered
    rectangle painted in the same color underneath/around it. Confirmed
    live via a real rendered PNG before this fix (see DECISIONS.md).
    """

    def test_ellipse_element_has_no_background_color_on_the_outer_wrapper(self):
        context = build_render_context(self.user, 'professional', '')
        d = base_design()
        d['header']['elements'].append({
            'kind': 'generic', 'type': 'ellipse', 'x': 10, 'y': 10, 'width': 50, 'height': 20,
            'style': {'background_color': '#2a8f4d'}, 'overrides': {},
        })
        html = render_design_html(d, context, for_pdf=True)
        outer_div_start = html.index('class="v2-el"')
        outer_style_start = html.index('style="', outer_div_start)
        outer_style_end = html.index('"', outer_style_start + len('style="'))
        outer_style = html[outer_style_start:outer_style_end]
        self.assertNotIn('background-color', outer_style, outer_style)
        # The inner div (attach_generic_content's own shape_css) is where
        # the real fill + rounding both live.
        self.assertIn('background:#2a8f4d', html)
        self.assertIn('border-radius:50%', html)

    def test_rectangle_and_container_are_still_in_the_shared_fill_tuple(self):
        # Not a behavior change for these two (both boxes were always the
        # same size/color for a plain rectangle) — just confirms the fix
        # didn't accidentally narrow the tuple to ellipse only.
        self.assertEqual(set(SHAPE_TYPES_WITH_OWN_FILL), {'rectangle', 'container', 'ellipse'})


class ImageCropRendersTests(InvoicesAPITestCase):
    def test_cropped_image_gets_absolute_positioned_scaled_css_inside_an_overflow_hidden_wrapper(self):
        context = build_render_context(self.user, 'professional', '')
        d = base_design()
        d['header']['elements'].append({
            'kind': 'generic', 'type': 'image', 'x': 10, 'y': 10, 'width': 40, 'height': 40,
            'style': {'src': 'data:image/png;base64,x'},
            'crop': {'x': 0.5, 'y': 0.0, 'width': 0.5, 'height': 0.5}, 'overrides': {},
        })
        html = render_design_html(d, context, for_pdf=True)
        self.assertIn('overflow:hidden', html)
        # width fraction 0.5 -> the real image must be scaled to 200% so
        # its cropped half exactly fills the wrapper.
        self.assertIn('width:200.0%', html)
        self.assertIn('height:200.0%', html)
        # x=0.5 of a 0.5-wide crop -> shift left by 100% to bring the
        # right half into view.
        self.assertIn('left:-100.0%', html)
        self.assertIn('top:-0.0%', html)

    def test_uncropped_image_keeps_the_original_object_fit_contain_markup(self):
        context = build_render_context(self.user, 'professional', '')
        d = base_design()
        d['header']['elements'].append({
            'kind': 'generic', 'type': 'image', 'x': 10, 'y': 10, 'width': 40, 'height': 40,
            'style': {'src': 'data:image/png;base64,x'}, 'overrides': {},
        })
        html = render_design_html(d, context, for_pdf=True)
        self.assertIn('object-fit:contain', html)
        self.assertNotIn('overflow:hidden', html)


class FooterRendersInRealPdfTests(InvoicesAPITestCase):
    """
    Real WeasyPrint renders (render_design_pdf_bytes, not just HTML
    string inspection) — the footer's whole reason to exist is the
    per-page `@page` margin box, which only WeasyPrint's own PDF engine
    actually produces.
    """

    def _design_with_footer(self, extra_flow=None):
        d = base_design()
        d['page']['footer'] = {'style': {'text_color': '#333333', 'font_size_pt': 8, 'show_wordmark': True}}
        if extra_flow:
            d['flow']['elements'].append(extra_flow)
        return d

    def test_genuine_single_page_omits_the_page_counter_entirely(self):
        context = build_render_context(self.user, 'professional', '')
        pdf_bytes = render_design_pdf_bytes(self._design_with_footer(), context)
        doc = fitz.open(stream=pdf_bytes, filetype='pdf')
        self.assertEqual(len(doc), 1)
        text = doc[0].get_text()
        self.assertNotIn('of 1', text)
        self.assertIn('you@example.com', text)  # freelancer email, left slot
        doc.close()

    def test_multipage_shows_the_real_page_x_of_n_counter_on_every_page(self):
        context = build_render_context(self.user, 'professional', '')
        long_text = {
            'kind': 'generic', 'type': 'text', 'x': 0, 'y': 250, 'width': 174, 'height': 20, 'layout_mode': 'flow',
            'style': {'text': '\n'.join(f'Forced pagination line {i}.' for i in range(220))}, 'overrides': {},
        }
        pdf_bytes = render_design_pdf_bytes(self._design_with_footer(extra_flow=long_text), context)
        doc = fitz.open(stream=pdf_bytes, filetype='pdf')
        n = len(doc)
        self.assertGreater(n, 1)
        for i in range(n):
            text = doc[i].get_text()
            self.assertIn(f'Page {i + 1} of {n}', text, f'page {i + 1} missing the real counter')
        doc.close()

    def test_no_footer_configured_renders_with_zero_footer_text_and_the_original_full_page_height(self):
        context = build_render_context(self.user, 'professional', '')
        pdf_bytes = render_design_pdf_bytes(base_design(), context)
        doc = fitz.open(stream=pdf_bytes, filetype='pdf')
        self.assertEqual(len(doc), 1)
        self.assertNotIn('you@example.com', doc[0].get_text())
        doc.close()
