# apps/invoices/tests/test_design_template_data.py
"""
Tests for the editor's "first-class starting mode" template data —
get_blank_design_data (design_templates.py) and its HTTP surface
(views_design_editor.py's design_templates_list/design_template_data).

Split off from the former test_design_canvas.py (removed along with
design_canvas.py and the GrapesJS-only design_canvas_document/
design_canvas_element endpoints it tested — see DECISIONS.md's removal
entry): everything in THIS file tests code with a real, current caller
(DesignGallery.jsx's own "Blank design"/template-picker actions, plus
the new editor's own load path) — unlike design_canvas.py, which had
none left once GrapesJS was removed.
"""
import copy

from django.test import TestCase
from django.urls import reverse

from apps.invoices.design_schema import get_schema_version, validate_design_data_schema_v2
from apps.invoices.design_templates import BUILTIN_DESIGNS
from apps.invoices.tests.test_views import InvoicesAPITestCase


class BlankDesignDataTests(TestCase):
    """
    Green-Light directive — get_blank_design_data (design_templates.py),
    the editor's second first-class starting mode. Unit-level coverage;
    DesignV2BuiltinsEndpointTests below covers the HTTP surface.
    """

    def test_every_template_produces_a_schema_valid_blank_design(self):
        """
        Part 3 ("blank design richness") — a blank design is no longer the
        two structurally-mandatory-anchors-only layout; it now carries the
        frontend's own real, rich default element set (see
        design_templates.py's `_load_blank_design_rich_elements`). This
        still asserts the two mandatory anchors are present (never
        removed), but no longer asserts header.elements is empty or that
        flow contains ONLY table/totals — that assumption is exactly what
        this phase changed, deliberately.
        """
        from apps.invoices.design_templates import get_blank_design_data

        for name in BUILTIN_DESIGNS:
            with self.subTest(template=name):
                blank = get_blank_design_data(name)
                self.assertEqual(get_schema_version(blank), 2)
                self.assertEqual(validate_design_data_schema_v2(blank), [])
                self.assertGreater(len(blank['header']['elements']), 0)
                types_present = {el['type'] for el in blank['flow']['elements']}
                self.assertIn('table', types_present)
                self.assertIn('totals', types_present)

    def test_blank_design_shares_the_same_page_geometry_as_its_builtin(self):
        """
        Part 3 — geometry (margins/sidebar width) is still copied verbatim
        from the selected base_template, EXCEPT `page.sidebar.color`: a
        blank design has no actual sidebar-flagged content element, so its
        own copy is forced to 'transparent' rather than the builtin's real
        `None` (which means "the .v2-sidebar wrapper paints its own
        default theme-color fill") — otherwise a blank Modern design would
        render a solid, full-height colored panel with nothing behind it
        (a real, reported bug this phase fixed; see design_templates.py's
        own get_blank_design_data docstring).
        """
        from apps.invoices.design_templates import get_blank_design_data

        for name in BUILTIN_DESIGNS:
            with self.subTest(template=name):
                blank = get_blank_design_data(name)
                expected_page = copy.deepcopy(BUILTIN_DESIGNS[name]['page'])
                if expected_page.get('sidebar'):
                    expected_page['sidebar']['color'] = 'transparent'
                self.assertEqual(blank['page'], expected_page)

    def test_returns_an_independent_deep_copy(self):
        from apps.invoices.design_templates import get_blank_design_data

        a = get_blank_design_data('professional')
        a['page']['width_mm'] = 999
        b = get_blank_design_data('professional')
        self.assertNotEqual(b['page']['width_mm'], 999)

    def test_unknown_base_template_raises(self):
        from apps.invoices.design_templates import get_blank_design_data

        with self.assertRaises(ValueError):
            get_blank_design_data('made-up')


class DesignV2BuiltinsEndpointTests(InvoicesAPITestCase):
    def test_requires_authentication(self):
        self.client.logout()
        resp = self.client.get(reverse('invoices:design_templates_list'))
        self.assertEqual(resp.status_code, 401)

    def test_lists_the_real_three_templates_and_nine_variants(self):
        resp = self.client.get(reverse('invoices:design_templates_list'))
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(sorted(body['templates']), sorted(BUILTIN_DESIGNS.keys()))
        total_variants = sum(len(v) for v in body['variants'].values())
        self.assertEqual(total_variants, 9)

    def test_fetching_one_builtin_returns_a_real_deep_copy(self):
        resp = self.client.get(reverse('invoices:design_template_data') + '?base_template=modern')
        self.assertEqual(resp.status_code, 200)
        returned = resp.json()['design_data']
        self.assertEqual(get_schema_version(returned), 2)
        self.assertEqual(returned['page']['sidebar']['width_mm'], 42)

        # Mutating the response must never affect the module-level constant.
        returned['page']['sidebar']['width_mm'] = 999
        self.assertEqual(BUILTIN_DESIGNS['modern']['page']['sidebar']['width_mm'], 42)

    def test_unknown_base_template_returns_400(self):
        resp = self.client.get(reverse('invoices:design_template_data') + '?base_template=made-up')
        self.assertEqual(resp.status_code, 400)

    def test_blank_true_returns_the_blank_starting_mode_not_the_full_builtin(self):
        """
        Green-Light directive — the editor's second first-class starting
        mode. Part 3: this mode's own content is now the frontend's real
        rich default (no longer an empty header / table+totals-only flow —
        see BlankDesignDataTests above for the full reasoning), so this
        only asserts it's genuinely non-empty and distinct in KIND from
        "the full builtin" — never byte-identical to it (the builtin has
        its own real business/client/date bindings positioned exactly per
        that template's own measured layout; the blank mode's content
        comes from a different, template-independent source and is
        rescaled to fit, so the two element sets differ by design).
        """
        resp = self.client.get(reverse('invoices:design_template_data') + '?base_template=professional&blank=true')
        self.assertEqual(resp.status_code, 200)
        returned = resp.json()['design_data']
        self.assertEqual(get_schema_version(returned), 2)
        self.assertGreater(len(returned['header']['elements']), 0)
        self.assertEqual(validate_design_data_schema_v2(returned), [])
        types_present = {el['type'] for el in returned['flow']['elements']}
        self.assertIn('table', types_present)
        self.assertIn('totals', types_present)
        self.assertNotEqual(returned['header']['elements'], BUILTIN_DESIGNS['professional']['header']['elements'])
        # Same real page geometry as the full builtin for this template
        # (margins/sidebar width) — a blank start and a builtin start
        # share the identical printable area. Professional has no
        # `sidebar` key at all, so there's no color-suppression difference
        # to account for here (see BlankDesignDataTests' own geometry test
        # for the template that does, Modern).
        self.assertEqual(returned['page'], BUILTIN_DESIGNS['professional']['page'])

    def test_blank_mode_still_validates_the_base_template_value(self):
        resp = self.client.get(reverse('invoices:design_template_data') + '?base_template=made-up&blank=true')
        self.assertEqual(resp.status_code, 400)
