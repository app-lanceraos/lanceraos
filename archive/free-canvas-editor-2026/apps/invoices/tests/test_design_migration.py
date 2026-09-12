# apps/invoices/tests/test_design_migration.py
"""
Template Builder 2.0, Phase 0 — tests for design_migration.py's pure
legacy-to-v2 converter. Nothing here touches the database; migrate_v1_to_v2
is a pure function tested purely on its inputs/outputs.
"""
import copy

from django.test import SimpleTestCase

from apps.invoices.design_migration import migrate_v1_to_v2
from apps.invoices.legacy_design_renderer import SIDEBAR_WIDTH_MM
from apps.invoices.design_schema import validate_design_data_schema_v2
from apps.invoices.design_seeds import BUILTIN_DESIGNS


def _professional_with_valid_widths():
    """
    Real, unmodified BUILTIN_DESIGNS['professional'] — kept as a thin
    alias (not a correction) now that migrate_v1_to_v2 fixes all 3 of the
    real, pre-existing bugs this fixture used to work around (paired-width
    doubling, header-box right-edge overflow, missing sidebar
    propagation — see MigrateV1ToV2RealSeedTests' own docstring for the
    full before/after). Kept under its original name rather than renamed
    everywhere, since every call site below cares about mapping MECHANICS
    (kind assignment, pairing-becomes-a-shared-row, style preservation),
    not about this specific fixture's own history.
    """
    return copy.deepcopy(BUILTIN_DESIGNS['professional'])


class MigrateV1ToV2DeterminismTests(SimpleTestCase):
    """The most important property: same input in, same output out, always."""

    def test_migrating_the_same_input_twice_produces_identical_output(self):
        # The real, unmodified seed — this is what actually proves
        # migrate_v1_to_v2 never has nondeterministic internal state (e.g.
        # dict ordering, or the row-width-splitting arithmetic's own
        # floating-point division) across repeat calls.
        source = copy.deepcopy(BUILTIN_DESIGNS['professional'])
        result_a = migrate_v1_to_v2(copy.deepcopy(source))
        result_b = migrate_v1_to_v2(copy.deepcopy(source))
        self.assertEqual(result_a, result_b)

    def test_migration_does_not_mutate_the_input_dict(self):
        source = copy.deepcopy(BUILTIN_DESIGNS['professional'])
        source_before = copy.deepcopy(source)
        migrate_v1_to_v2(source)
        self.assertEqual(source, source_before)


class MigrateV1ToV2RealSeedTests(SimpleTestCase):
    """
    Real, unmodified BUILTIN_DESIGNS migration now succeeds for all 3
    templates — 3 real, distinct, pre-existing bugs (found and documented,
    but deliberately left unfixed, by Phase 5.1) are fixed here:

      1. `_row_widths` (design_migration.py) — a v1 `paired_side_by_side`
         element almost never states an explicit `style.width` (v1's own
         CSS flexbox gave each one half the row for free), so the old
         `style.get('width', content_width_mm)` fallback gave the FULL
         content width to BOTH members of a real pair, doubling up on the
         same row (professional/minimal's real `signature` used to land
         at x=178, width=174 — a content area only 174mm wide to begin
         with). Fixed: unstated widths in a row now split the row's real
         remaining width evenly among themselves.
      2. `_clamp_width` — professional/minimal's own real `dates`/
         `business_info` zone_1 boxes verbatim-copy an x+width that runs
         past v2's own (newer, stricter) content-width bound — v1 never
         enforced this at all, tolerating it because the box is wider
         than its own right-aligned text ever actually renders. Fixed:
         width (never x/y) is clamped down to fit its own real coordinate
         space whenever it would otherwise overflow — a no-op for every
         box that already fits.
      3. Modern's real sidebar-flagged zone_1/zone_2 elements
         (`style.sidebar: True`) now correctly produce a real
         `page.sidebar` (width_mm=SIDEBAR_WIDTH_MM, the same real 42mm
         constant v1's own dynamic renderer already uses for this), and
         sidebar-flagged flow elements are positioned within that real
         sidebar width, independently of the main content column.

    This class also proves NONE of these fixes silently discards real
    content or repositions anything the migration mapper isn't explicitly
    allowed to touch (see the geometry-preservation tests below).
    """

    def test_all_three_builtin_seeds_migrate_successfully(self):
        for name, seed in BUILTIN_DESIGNS.items():
            with self.subTest(template=name):
                result = migrate_v1_to_v2(copy.deepcopy(seed))
                self.assertTrue(result['success'], msg=result['errors'])
                self.assertEqual(validate_design_data_schema_v2(result['design_data']), [])

    def test_modern_migration_produces_a_real_sidebar_with_the_correct_width(self):
        result = migrate_v1_to_v2(copy.deepcopy(BUILTIN_DESIGNS['modern']))
        self.assertTrue(result['success'], msg=result['errors'])
        sidebar = result['design_data']['page']['sidebar']
        self.assertEqual(sidebar['width_mm'], SIDEBAR_WIDTH_MM)
        # Every sidebar-flagged element (header AND flow) must fit inside
        # that real sidebar width — the exact bound _validate_page_bounds
        # itself checks, proven directly here rather than only implicitly
        # via test_all_three_builtin_seeds_migrate_successfully's own
        # zero-errors assertion.
        all_elements = result['design_data']['header']['elements'] + result['design_data']['flow']['elements']
        sidebar_elements = [el for el in all_elements if el['style'].get('sidebar')]
        self.assertTrue(sidebar_elements, msg='fixture assumption: modern has real sidebar-flagged elements')
        for el in sidebar_elements:
            self.assertLessEqual(el['x'] + el['width'], sidebar['width_mm'])

    def test_professional_and_minimal_migration_has_no_sidebar(self):
        for name in ('professional', 'minimal'):
            with self.subTest(template=name):
                result = migrate_v1_to_v2(copy.deepcopy(BUILTIN_DESIGNS[name]))
                self.assertTrue(result['success'], msg=result['errors'])
                self.assertNotIn('sidebar', result['design_data']['page'])

    def test_previously_doubled_pair_no_longer_overlaps(self):
        # Professional/minimal's real signature+payment_info (or
        # equivalent) pair used to both claim the full content width —
        # confirmed fixed by construction (a successful migration implies
        # zero overlap errors, since _validate_overlap runs as part of
        # the v2 structural validation both assertions above already
        # check) — this test additionally proves the two paired elements
        # really do sit side by side (distinct x, shared y), not merely
        # "small enough to not technically overlap by accident."
        result = migrate_v1_to_v2(_professional_with_valid_widths())
        source = BUILTIN_DESIGNS['professional']['zone_2']['elements']
        migrated = result['design_data']['flow']['elements']
        paired_migrated = [migrated[i + 1] for i, e in enumerate(source) if e.get('paired_side_by_side')]
        self.assertEqual(len(paired_migrated), 2)
        self.assertEqual(paired_migrated[0]['y'], paired_migrated[1]['y'])
        self.assertNotEqual(paired_migrated[0]['x'], paired_migrated[1]['x'])
        left, right = sorted(paired_migrated, key=lambda e: e['x'])
        self.assertLessEqual(left['x'] + left['width'], right['x'])

    def test_migrated_output_has_schema_version_2(self):
        result = migrate_v1_to_v2(_professional_with_valid_widths())
        self.assertEqual(result['design_data']['schema_version'], 2)

    def test_zone_1_elements_become_header_elements_with_semantic_kind_and_empty_overrides(self):
        source = _professional_with_valid_widths()
        result = migrate_v1_to_v2(copy.deepcopy(source))
        original = source['zone_1']['elements']
        migrated = result['design_data']['header']['elements']
        # Professional's real content width (no sidebar): 210 - 20 - 16.
        content_width_mm = 174
        self.assertEqual(len(migrated), len(original))
        for orig_el, new_el in zip(original, migrated):
            self.assertEqual(new_el['kind'], 'semantic')
            self.assertEqual(new_el['type'], orig_el['type'])
            self.assertEqual(new_el['x'], orig_el['x'])
            self.assertEqual(new_el['y'], orig_el['y'])
            # Width is verbatim UNLESS the real v1 box's own right edge
            # would exceed the real v2 content-width bound (a real,
            # pre-existing property of professional's own dates/
            # business_info boxes — see this class' own docstring, bug
            # #2) — in which case it's clamped down to fit exactly, never
            # more, never less.
            expected_width = orig_el['width']
            if orig_el['x'] + orig_el['width'] > content_width_mm:
                expected_width = content_width_mm - orig_el['x']
            self.assertEqual(new_el['width'], expected_width)
            self.assertEqual(new_el['height'], orig_el['height'])
            self.assertEqual(new_el['style'], orig_el.get('style', {}))
            self.assertEqual(new_el['overrides'], {})

    def test_zone_2_elements_become_flow_elements_with_paired_ones_sharing_a_real_row(self):
        # Phase 4B.2: paired_side_by_side/spacing_after_previous no longer
        # exist on the migrated output at all (see design_schema.py's
        # own docstring) — the real, observable proof that pairing
        # survived the migration is that the two originally-paired v1
        # elements now share the same real y (a genuine row) while every
        # other migrated element has its own distinct y.
        source = _professional_with_valid_widths()
        result = migrate_v1_to_v2(copy.deepcopy(source))
        migrated = result['design_data']['flow']['elements']
        original = source['zone_2']['elements']
        paired_original_types = [e['type'] for e in original if e.get('paired_side_by_side')]
        self.assertEqual(len(paired_original_types), 2, msg='fixture assumption: exactly one real pair')

        # The migrated table is prepended (index 0); original[i] maps to
        # migrated[i + 1] in the same order.
        paired_migrated = [
            migrated[i + 1] for i, e in enumerate(original) if e.get('paired_side_by_side')
        ]
        self.assertEqual(len(paired_migrated), 2)
        self.assertEqual(paired_migrated[0]['y'], paired_migrated[1]['y'])
        self.assertNotEqual(paired_migrated[0]['x'], paired_migrated[1]['x'])
        for el in migrated:
            self.assertNotIn('paired_side_by_side', el)
            self.assertNotIn('spacing_after_previous', el)

    def test_table_is_a_real_structural_element_with_style_preserved_verbatim(self):
        source = _professional_with_valid_widths()
        result = migrate_v1_to_v2(copy.deepcopy(source))
        flow_elements = result['design_data']['flow']['elements']
        table = next(e for e in flow_elements if e['type'] == 'table')
        self.assertEqual(table['kind'], 'structural')
        self.assertEqual(table['style'], source['zone_2']['table']['style'])

    def test_no_information_is_silently_discarded_for_real_seed_data(self):
        # Every real style key on every element must survive the
        # migration — spot-checked against a specific, real value from
        # professional's own real payment_info element (not paired, so
        # unaffected by the width-defaulting bug documented above): its
        # `variant` key, needed to pick the right real render branch.
        source = _professional_with_valid_widths()
        result = migrate_v1_to_v2(copy.deepcopy(source))
        payment_info = next(e for e in result['design_data']['flow']['elements'] if e['type'] == 'payment_info')
        self.assertEqual(payment_info['style'].get('variant'), 'bank_methods')


class MigrateV1ToV2InputHandlingTests(SimpleTestCase):
    def test_malformed_legacy_input_is_rejected_not_crashed_on(self):
        result = migrate_v1_to_v2({'zone_1': {'elements': []}})  # missing zone_2 entirely
        self.assertFalse(result['success'])
        self.assertIsNone(result['design_data'])
        self.assertTrue(result['errors'])

    def test_non_dict_input_is_rejected_not_crashed_on(self):
        result = migrate_v1_to_v2('not a dict')
        self.assertFalse(result['success'])
        self.assertTrue(result['errors'])

    def test_already_v2_input_passes_through_unchanged_with_a_warning(self):
        already_v2 = {'schema_version': 2, 'page': {}, 'header': {}, 'flow': {}}
        result = migrate_v1_to_v2(copy.deepcopy(already_v2))
        self.assertTrue(result['success'])
        self.assertEqual(result['design_data'], already_v2)
        self.assertTrue(result['warnings'])

    def test_unsupported_schema_version_is_rejected_not_guessed_at(self):
        result = migrate_v1_to_v2({'schema_version': 99, 'zone_1': {}, 'zone_2': {}})
        self.assertFalse(result['success'])
        self.assertIn('99', result['errors'][0])

    def test_result_always_has_the_documented_keys(self):
        for input_data in (
            copy.deepcopy(BUILTIN_DESIGNS['professional']),
            {'zone_1': {}},
            'garbage',
            {'schema_version': 2, 'page': {}, 'header': {}, 'flow': {}},
        ):
            result = migrate_v1_to_v2(input_data)
            self.assertEqual(set(result.keys()), {'success', 'design_data', 'errors', 'warnings'})
            self.assertIsInstance(result['errors'], list)
            self.assertIsInstance(result['warnings'], list)
