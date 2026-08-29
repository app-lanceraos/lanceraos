# apps/invoices/tests/test_design_schema.py
"""
Template Builder — tests for design_schema.py's schema-version detection
and production structural validator. None of this is wired
into any live view/serializer; these are pure-function tests only.
"""
import copy

from django.test import SimpleTestCase

from apps.invoices.design_schema import (
    SCHEMA_VERSION_LEGACY,
    SCHEMA_VERSION_V2,
    get_schema_version,
    validate_design_data_schema_by_version,
    validate_design_data_schema_v2,
)

VALID_V2_DESIGN = {
    'schema_version': 2,
    'page': {'size': 'A4', 'width_mm': 210, 'height_mm': 297},
    'header': {
        'elements': [
            {'kind': 'semantic', 'type': 'logo', 'x': 20, 'y': 16, 'width': 15, 'height': 15,
             'style': {}, 'overrides': {}},
            {'kind': 'generic', 'type': 'text', 'x': 40, 'y': 16, 'width': 50, 'height': 10,
             'style': {}, 'overrides': {}, 'binding': 'invoice.number'},
        ],
    },
    'flow': {
        'elements': [
            {'kind': 'structural', 'type': 'table', 'x': 0, 'y': 80, 'width': 174, 'height': 45,
             'style': {}, 'overrides': {}},
            {'kind': 'semantic', 'type': 'totals', 'x': 112, 'y': 130, 'width': 62, 'height': 35,
             'style': {}, 'overrides': {}},
            {'kind': 'generic', 'type': 'divider', 'x': 0, 'y': 170, 'width': 174, 'height': 2,
             'style': {}, 'overrides': {}},
        ],
    },
}


# ══════════════════════════════════════════════════════════════════
# SCHEMA VERSION DETECTION
# ══════════════════════════════════════════════════════════════════

class SchemaVersionDetectionTests(SimpleTestCase):
    def test_legacy_design_with_no_schema_version_key_recognized_as_v1(self):
        self.assertEqual(get_schema_version({'zone_1': {}, 'zone_2': {}}), SCHEMA_VERSION_LEGACY)

    def test_design_with_explicit_schema_version_2_recognized_as_v2(self):
        self.assertEqual(get_schema_version({'schema_version': 2}), SCHEMA_VERSION_V2)

    def test_design_with_explicit_schema_version_1_recognized_as_v1(self):
        self.assertEqual(get_schema_version({'schema_version': 1}), SCHEMA_VERSION_LEGACY)

    def test_non_dict_payload_raises_value_error(self):
        for bad_input in ('not a dict', None, [], 42):
            with self.assertRaises(ValueError):
                get_schema_version(bad_input)

    def test_non_integer_schema_version_raises_value_error(self):
        for bad_version in ('2', 2.5, None, [2]):
            with self.assertRaises(ValueError):
                get_schema_version({'schema_version': bad_version})

    def test_boolean_schema_version_rejected_even_though_bool_is_an_int_subclass(self):
        # isinstance(True, int) is True in Python — explicitly guarded against
        # in get_schema_version so `schema_version: true` doesn't silently
        # resolve to schema_version 1.
        with self.assertRaises(ValueError):
            get_schema_version({'schema_version': True})

    def test_unknown_schema_version_is_recognized_but_not_supported_by_the_dispatcher(self):
        # get_schema_version itself doesn't reject an unrecognized-but-valid
        # integer (99) — that's validate_design_data_schema_by_version's job,
        # tested below. Recognition and support are deliberately separate.
        self.assertEqual(get_schema_version({'schema_version': 99}), 99)


# ══════════════════════════════════════════════════════════════════
# VERSION-DISPATCHED VALIDATION — the "unknown version rejected safely"
# and "malformed design rejected safely" success criteria
# ══════════════════════════════════════════════════════════════════

class VersionDispatchedValidationTests(SimpleTestCase):
    def test_unknown_schema_version_rejected_with_a_specific_message_not_a_crash(self):
        errors = validate_design_data_schema_by_version({'schema_version': 99, 'zone_1': {}, 'zone_2': {}})
        self.assertTrue(errors)
        self.assertIn('99', errors[0])

    def test_non_dict_payload_rejected_with_a_specific_message_not_a_crash(self):
        errors = validate_design_data_schema_by_version('not a dict')
        self.assertTrue(errors)

    def test_valid_v2_design_passes_with_no_errors(self):
        errors = validate_design_data_schema_by_version(copy.deepcopy(VALID_V2_DESIGN))
        self.assertEqual(errors, [])

    def test_legacy_design_is_routed_to_the_real_v1_validator(self):
        # A structurally invalid v1 payload (missing zone_2) should produce
        # the v1 validator's own real error, proving the dispatch actually
        # reaches apps.invoices.design_schema.validate_design_data_schema,
        # not a v2-shaped stand-in.
        errors = validate_design_data_schema_by_version({'zone_1': {'elements': []}})
        self.assertTrue(any('zone_2' in e for e in errors))


# ══════════════════════════════════════════════════════════════════
# V2 STRUCTURAL VALIDATOR
# ══════════════════════════════════════════════════════════════════

class V2SchemaValidationTests(SimpleTestCase):
    def test_valid_design_passes_with_no_errors(self):
        self.assertEqual(validate_design_data_schema_v2(copy.deepcopy(VALID_V2_DESIGN)), [])

    def test_non_dict_payload_rejected(self):
        self.assertTrue(validate_design_data_schema_v2('not a dict'))
        self.assertTrue(validate_design_data_schema_v2(None))

    def test_wrong_schema_version_value_rejected(self):
        d = copy.deepcopy(VALID_V2_DESIGN)
        d['schema_version'] = 1
        errors = validate_design_data_schema_v2(d)
        self.assertTrue(any('schema_version' in e for e in errors))

    def test_missing_page_rejected(self):
        d = copy.deepcopy(VALID_V2_DESIGN)
        del d['page']
        self.assertTrue(any('page' in e for e in validate_design_data_schema_v2(d)))

    def test_page_missing_required_keys_rejected(self):
        d = copy.deepcopy(VALID_V2_DESIGN)
        d['page'] = {'size': 'A4'}
        errors = validate_design_data_schema_v2(d)
        self.assertTrue(any('width_mm' in e or 'height_mm' in e for e in errors))

    def test_missing_header_rejected(self):
        d = copy.deepcopy(VALID_V2_DESIGN)
        del d['header']
        self.assertTrue(any('header' in e for e in validate_design_data_schema_v2(d)))

    def test_missing_flow_rejected(self):
        d = copy.deepcopy(VALID_V2_DESIGN)
        del d['flow']
        self.assertTrue(any('flow' in e for e in validate_design_data_schema_v2(d)))

    def test_element_missing_kind_rejected(self):
        d = copy.deepcopy(VALID_V2_DESIGN)
        del d['header']['elements'][0]['kind']
        errors = validate_design_data_schema_v2(d)
        self.assertTrue(any('kind' in e for e in errors))

    def test_element_with_invalid_kind_value_rejected(self):
        d = copy.deepcopy(VALID_V2_DESIGN)
        d['header']['elements'][0]['kind'] = 'not-a-real-kind'
        errors = validate_design_data_schema_v2(d)
        self.assertTrue(any('kind' in e for e in errors))

    def test_semantic_kind_with_generic_type_rejected(self):
        d = copy.deepcopy(VALID_V2_DESIGN)
        d['header']['elements'][1]['kind'] = 'semantic'  # type is 'text', a generic type
        errors = validate_design_data_schema_v2(d)
        self.assertTrue(any('generic type but kind is "semantic"' in e for e in errors))

    def test_generic_kind_with_semantic_type_rejected(self):
        d = copy.deepcopy(VALID_V2_DESIGN)
        d['header']['elements'][0]['kind'] = 'generic'  # type is 'logo', a semantic type
        errors = validate_design_data_schema_v2(d)
        self.assertTrue(any('semantic type but kind is "generic"' in e for e in errors))

    def test_element_missing_overrides_rejected(self):
        d = copy.deepcopy(VALID_V2_DESIGN)
        del d['header']['elements'][0]['overrides']
        errors = validate_design_data_schema_v2(d)
        self.assertTrue(any('overrides' in e for e in errors))

    def test_overrides_must_be_an_object(self):
        d = copy.deepcopy(VALID_V2_DESIGN)
        d['header']['elements'][0]['overrides'] = 'not a dict'
        errors = validate_design_data_schema_v2(d)
        self.assertTrue(any('overrides' in e for e in errors))

    def test_header_overlap_detected_across_semantic_and_generic_elements(self):
        d = copy.deepcopy(VALID_V2_DESIGN)
        d['header']['elements'][1]['x'] = 20  # now overlaps element 0 (logo, x=20..35, y=16..31)
        d['header']['elements'][1]['y'] = 16
        errors = validate_design_data_schema_v2(d)
        self.assertTrue(any('overlaps' in e for e in errors))

    def test_missing_line_items_table_rejected(self):
        d = copy.deepcopy(VALID_V2_DESIGN)
        d['flow']['elements'] = [e for e in d['flow']['elements'] if e['type'] != 'table']
        self.assertTrue(any('table' in e for e in validate_design_data_schema_v2(d)))

    def test_missing_totals_block_rejected(self):
        d = copy.deepcopy(VALID_V2_DESIGN)
        d['flow']['elements'] = [e for e in d['flow']['elements'] if e['type'] != 'totals']
        errors = validate_design_data_schema_v2(d)
        self.assertTrue(any('totals' in e for e in errors))

    def test_flow_element_overlap_detected_now_that_flow_is_free_form(self):
        # Phase 4B.2: flow elements now carry real x/y like header elements
        # always have, and the overlap guarantee is validated (not
        # structural) across the combined header+flow set — see
        # design_schema.py's own docstring.
        d = copy.deepcopy(VALID_V2_DESIGN)
        d['flow']['elements'][2]['x'] = 112  # divider now overlaps totals (x=112..174, y=130..165)
        d['flow']['elements'][2]['y'] = 150
        errors = validate_design_data_schema_v2(d)
        self.assertTrue(any('overlaps' in e for e in errors))

    def test_table_type_only_allowed_in_flow_not_header(self):
        # HEADER_TYPES deliberately excludes STRUCTURAL_TYPES — header
        # stays "identity" content (logo/business/client/dates); the
        # table (and every FLOW_SEMANTIC_TYPES entry) is only a valid
        # type within flow.elements.
        d = copy.deepcopy(VALID_V2_DESIGN)
        table = next(e for e in d['flow']['elements'] if e['type'] == 'table')
        d['flow']['elements'].remove(table)
        d['header']['elements'].append(table)
        errors = validate_design_data_schema_v2(d)
        self.assertTrue(any('invalid type "table"' in e for e in errors))

    def test_generic_text_binding_must_be_in_the_supported_allow_list(self):
        d = copy.deepcopy(VALID_V2_DESIGN)
        d['header']['elements'][1]['binding'] = 'invoice.made_up_field'
        errors = validate_design_data_schema_v2(d)
        self.assertTrue(any('binding' in e for e in errors))

    def test_generic_text_with_no_binding_is_valid_static_text(self):
        d = copy.deepcopy(VALID_V2_DESIGN)
        del d['header']['elements'][1]['binding']
        self.assertEqual(validate_design_data_schema_v2(d), [])

    def test_generic_text_binding_explicitly_null_is_valid_static_text(self):
        d = copy.deepcopy(VALID_V2_DESIGN)
        d['header']['elements'][1]['binding'] = None
        self.assertEqual(validate_design_data_schema_v2(d), [])

    def test_binding_ignored_on_non_text_elements(self):
        d = copy.deepcopy(VALID_V2_DESIGN)
        d['header']['elements'][0]['binding'] = 'invoice.made_up_field'  # a logo — binding meaningless here
        # _validate_binding is a no-op for non-'text' types, so this must NOT raise a binding error.
        errors = validate_design_data_schema_v2(d)
        self.assertFalse(any('binding' in e for e in errors))


class LayersPanelFlagsTests(SimpleTestCase):
    """Green-Light directive — the Layers panel's "lock"/"hide" toggles, both optional booleans."""

    def test_hidden_true_is_valid(self):
        d = copy.deepcopy(VALID_V2_DESIGN)
        d['header']['elements'][0]['hidden'] = True
        self.assertEqual(validate_design_data_schema_v2(d), [])

    def test_locked_true_is_valid(self):
        d = copy.deepcopy(VALID_V2_DESIGN)
        d['header']['elements'][0]['locked'] = True
        self.assertEqual(validate_design_data_schema_v2(d), [])

    def test_hidden_non_boolean_rejected(self):
        d = copy.deepcopy(VALID_V2_DESIGN)
        d['header']['elements'][0]['hidden'] = 'yes'
        errors = validate_design_data_schema_v2(d)
        self.assertTrue(any('hidden' in e for e in errors))

    def test_locked_non_boolean_rejected(self):
        d = copy.deepcopy(VALID_V2_DESIGN)
        d['header']['elements'][0]['locked'] = 'yes'
        errors = validate_design_data_schema_v2(d)
        self.assertTrue(any('locked' in e for e in errors))

    def test_absent_hidden_and_locked_is_valid_every_existing_design_has_neither(self):
        d = copy.deepcopy(VALID_V2_DESIGN)
        self.assertNotIn('hidden', d['header']['elements'][0])
        self.assertNotIn('locked', d['header']['elements'][0])
        self.assertEqual(validate_design_data_schema_v2(d), [])


# ══════════════════════════════════════════════════════════════════
# PAGE-BOUNDARY VALIDATION — Phase 5.1 (closes the Phase 5 adversarial
# audit's own finding: an element with no colliding sibling could be
# dragged/resized off the physical page with zero validation). VALID_V2_
# DESIGN's own page has no explicit margins, so the defaults apply
# (right=16mm, left=20mm — see design_renderer.py's
# PAGE_MARGIN_RIGHT/LEFT_MM, duplicated in design_schema.py's own
# _PAGE_MARGIN_RIGHT/LEFT_MM to avoid a circular import): content
# width is [0, 174]. The divider element (flow.elements[2],
# x=0,y=170,w=174,h=2) is used as the mutable target throughout since
# it's a plain generic element with no other constraints (unlike table/
# totals, which are separately mandatory). Deliberately NO upper bound on
# y+height (a bottom-edge ceiling) — see _validate_page_bounds's own
# docstring for the real, measured reason (design_migration.py's naive
# v1->v2 stacking genuinely overflows a single page for all 3 real
# builtin templates; enforcing a bottom ceiling here would reject that
# pre-existing, isolated, in-memory-only preview feature's real output).
# `y >= 0` is still enforced — a negative y is never legitimate.
# ══════════════════════════════════════════════════════════════════
class V2PageBoundsValidationTests(SimpleTestCase):
    def _set_divider(self, d, x, y, width, height):
        divider = d['flow']['elements'][2]
        divider['x'], divider['y'], divider['width'], divider['height'] = x, y, width, height
        return d

    def _bounds_errors(self, d):
        return [e for e in validate_design_data_schema_v2(d) if 'edge' in e]

    def test_element_exactly_touching_left_edge_is_valid(self):
        d = self._set_divider(copy.deepcopy(VALID_V2_DESIGN), 0, 200, 50, 10)
        self.assertEqual(self._bounds_errors(d), [])

    def test_element_exactly_touching_top_edge_is_valid(self):
        d = self._set_divider(copy.deepcopy(VALID_V2_DESIGN), 50, 0, 50, 10)
        self.assertEqual(self._bounds_errors(d), [])

    def test_element_exactly_touching_right_edge_is_valid(self):
        d = self._set_divider(copy.deepcopy(VALID_V2_DESIGN), 124, 200, 50, 10)  # 124+50=174
        self.assertEqual(self._bounds_errors(d), [])

    def test_element_exactly_touching_bottom_edge_is_valid(self):
        d = self._set_divider(copy.deepcopy(VALID_V2_DESIGN), 50, 255, 50, 10)  # 255+10=265
        self.assertEqual(self._bounds_errors(d), [])

    def test_element_exactly_filling_the_content_area_is_valid(self):
        d = self._set_divider(copy.deepcopy(VALID_V2_DESIGN), 0, 0, 174, 265)
        self.assertEqual(self._bounds_errors(d), [])

    def test_negative_x_rejected(self):
        d = self._set_divider(copy.deepcopy(VALID_V2_DESIGN), -5, 200, 50, 10)
        errors = self._bounds_errors(d)
        self.assertTrue(any('x >= 0' in e for e in errors))

    def test_negative_y_rejected(self):
        d = self._set_divider(copy.deepcopy(VALID_V2_DESIGN), 50, -5, 50, 10)
        errors = self._bounds_errors(d)
        self.assertTrue(any('y >= 0' in e for e in errors))

    def test_right_edge_beyond_content_width_rejected(self):
        d = self._set_divider(copy.deepcopy(VALID_V2_DESIGN), 150, 200, 50, 10)  # 150+50=200 > 174
        errors = self._bounds_errors(d)
        self.assertTrue(any('right edge' in e for e in errors))

    def test_bottom_edge_beyond_content_height_is_deliberately_not_rejected(self):
        # Named explicitly (not just omitted) so a future change to this
        # deliberate scope decision is a conscious edit, not an accidental
        # regression — see _validate_page_bounds's own docstring for why
        # (design_migration.py's real, measured output for all 3 builtin
        # templates already overflows a single page's content height).
        d = self._set_divider(copy.deepcopy(VALID_V2_DESIGN), 50, 260, 50, 1000)  # wildly tall
        self.assertEqual(self._bounds_errors(d), [])

    def test_element_completely_outside_page_rejected_on_the_x_axis(self):
        d = self._set_divider(copy.deepcopy(VALID_V2_DESIGN), 500, 600, 50, 10)
        errors = self._bounds_errors(d)
        self.assertTrue(any('right edge' in e for e in errors))

    def test_tiny_floating_point_noise_within_epsilon_is_accepted(self):
        # 0.01mm over — well inside OVERLAP_EPSILON_MM (0.3mm), the exact
        # same tolerance reused from the overlap check (no second epsilon
        # invented for this).
        d = self._set_divider(copy.deepcopy(VALID_V2_DESIGN), 124.01, 200, 50, 10)
        self.assertEqual(self._bounds_errors(d), [])

    def test_genuine_off_page_geometry_rejected_despite_epsilon(self):
        # 0.5mm over — outside the 0.3mm epsilon, must still be rejected.
        d = self._set_divider(copy.deepcopy(VALID_V2_DESIGN), 124.5, 200, 50, 10)
        errors = self._bounds_errors(d)
        self.assertTrue(any('right edge' in e for e in errors))

    def test_all_three_real_builtin_seeds_still_pass_page_bounds(self):
        from apps.invoices.design_templates import get_builtin_design_data
        for name in ('professional', 'minimal', 'modern'):
            with self.subTest(template=name):
                d = get_builtin_design_data(name)
                self.assertEqual(validate_design_data_schema_v2(d), [])

    def test_sidebar_element_is_bounded_by_the_sidebar_column_not_the_main_content_area(self):
        # A sidebar element's own coordinate space is the sidebar's own
        # box (0..sidebar.width_mm), not the main content area — matching
        # the exact same sidebar partition _validate_overlap already uses.
        # x=50 would be genuinely off-page for main content (content
        # width 174 minus the sidebar's own 42mm reduces it further) but
        # is squarely invalid for a 42mm-wide sidebar regardless.
        d = copy.deepcopy(VALID_V2_DESIGN)
        d['page']['sidebar'] = {'width_mm': 42, 'color': None}
        d['flow']['elements'][2]['style'] = {'sidebar': True}
        d['flow']['elements'][2]['x'] = 50
        d['flow']['elements'][2]['y'] = 10
        d['flow']['elements'][2]['width'] = 20
        d['flow']['elements'][2]['height'] = 10
        errors = self._bounds_errors(d)
        self.assertTrue(any('elements[2]' in e and 'right edge' in e for e in errors), errors)

    def test_sidebar_element_within_the_sidebar_column_is_valid(self):
        # Adding a sidebar genuinely narrows the main content area for
        # every OTHER (non-sidebar) element too (effective_margin_left_mm
        # grows by the sidebar's own width — the exact real formula
        # design_renderer.py uses) — VALID_V2_DESIGN's own table/totals
        # were sized for a sidebar-less 174mm content width, so adding a
        # sidebar here correctly makes THEM newly invalid; this test only
        # asserts the sidebar element itself (index 2) has no bounds
        # error, not that the whole fixture stays valid.
        d = copy.deepcopy(VALID_V2_DESIGN)
        d['page']['sidebar'] = {'width_mm': 42, 'color': None}
        d['flow']['elements'][2]['style'] = {'sidebar': True}
        d['flow']['elements'][2]['x'] = 6
        d['flow']['elements'][2]['y'] = 10
        d['flow']['elements'][2]['width'] = 20
        d['flow']['elements'][2]['height'] = 10
        errors = self._bounds_errors(d)
        self.assertFalse(any('elements[2]' in e for e in errors), errors)
