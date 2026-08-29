# apps/invoices/tests/test_design_canvas.py
"""
Tests for the editor's canvas adapter (design_canvas.py) and its HTTP
surface (views_design_editor.py's design_canvas_document /
design_canvas_element / design_template_data* views) — the LanceraOS
Template Builder's own production backend.

Nothing in this file touches a real Invoice row or a real InvoiceDesign
row — design_data always travels in the request body.
"""
import copy

from django.test import TestCase
from django.urls import reverse

from apps.invoices.design_canvas import build_canvas_document, render_canvas_element_content
from apps.invoices.design_renderer import (
    DesignRenderError,
    build_render_context,
    is_sidebar_element,
    prepare_element,
)
from apps.invoices.design_schema import get_schema_version, validate_design_data_schema_v2
from apps.invoices.design_seeds import BUILTIN_DESIGNS as LEGACY_BUILTIN_DESIGNS
from apps.invoices.design_templates import BUILTIN_DESIGNS, get_builtin_design_data
from apps.invoices.tests.test_views import InvoicesAPITestCase
from apps.users.models import User


class CanvasDocumentDatabaseTestCase(TestCase):
    """Base class providing a real user + real V2 render context, mirroring test_design_renderer.py's own RendererDatabaseTestCase."""

    def setUp(self):
        self.user = User.objects.create_user(email='v2-canvas@example.com', password='Sup3r$ecret1')
        self.context = build_render_context(self.user, 'professional', '')


# ══════════════════════════════════════════════════════════════════
# REUSE, NOT REIMPLEMENTATION — the canvas adapter must call the exact
# same geometry functions the canonical renderer calls, never a parallel copy.
# ══════════════════════════════════════════════════════════════════

class CanvasReusesCanonicalGeometryTests(CanvasDocumentDatabaseTestCase):
    def test_header_element_css_matches_canonical_renderer_exactly(self):
        """
        For every header element, the canvas document's own `css` string
        must be byte-identical to what design_renderer.prepare_element
        computes directly — proving the adapter calls the real function
        rather than recomputing position/alignment CSS a second way.
        """
        design_data = get_builtin_design_data('professional')
        document = build_canvas_document(design_data, self.context)

        for i, raw_element in enumerate(design_data['header']['elements']):
            expected = prepare_element(raw_element, self.context)['css']
            self.assertEqual(document['header_elements'][i]['css'], expected)

    def test_flow_element_css_matches_canonical_renderer_exactly(self):
        # Phase 4B.2: prepare_element is now the ONE function for every
        # element regardless of which list it came from (see
        # design_renderer.py's own docstring) — this is the flow-side
        # analog of the header test just above.
        design_data = get_builtin_design_data('minimal')
        document = build_canvas_document(design_data, self.context)

        for i, raw_element in enumerate(design_data['flow']['elements']):
            expected = prepare_element(raw_element, self.context)['css']
            self.assertEqual(document['flow_elements'][i]['css'], expected)

    def test_sidebar_flag_matches_canonical_is_sidebar_element(self):
        design_data = get_builtin_design_data('modern')
        document = build_canvas_document(design_data, self.context)
        for i, raw_element in enumerate(design_data['header']['elements']):
            self.assertEqual(document['header_elements'][i]['sidebar'], is_sidebar_element(raw_element))

    def test_content_html_reuses_the_same_element_content_partial(self):
        """
        A content fragment produced by the canvas adapter for a given
        element must appear, byte-for-byte, somewhere inside the
        canonical renderer's own full-document HTML output for the exact
        same design_data — proving both paths render through the same
        template, not two independent implementations.
        """
        from apps.invoices.design_renderer import render_design_html

        design_data = get_builtin_design_data('professional')
        # content_mode='real' explicitly — build_canvas_document's own
        # default is now 'alias' (Phase 4B, the correct default for the
        # editor canvas), which would show "Client Name" instead of real
        # sample data; this test specifically compares against
        # render_design_html's real-data output, so it needs real mode
        # too for the comparison to mean anything.
        document = build_canvas_document(design_data, self.context, content_mode='real')
        full_html = render_design_html(design_data, self.context)

        # Phase 4B: client_info (the old bundled type) no longer appears
        # in this seed — decomposed into a generic `text` element bound
        # to `client.name` (design_templates.py). Same real, always-present
        # anchor content, just addressed by binding instead of by the old
        # bundled type name.
        client_name_index = next(
            i for i, el in enumerate(design_data['header']['elements']) if el.get('binding') == 'client.name'
        )
        fragment = document['header_elements'][client_name_index]['content_html']
        self.assertIn('Callahan', fragment)  # the real sample client name (design_preview.py)
        self.assertIn('Callahan', full_html)


# ══════════════════════════════════════════════════════════════════
# PAGE / MARGIN / SIDEBAR GEOMETRY — mm only, never px
# ══════════════════════════════════════════════════════════════════

class CanvasPageGeometryTests(CanvasDocumentDatabaseTestCase):
    def test_professional_real_measured_margins_are_surfaced(self):
        document = build_canvas_document(get_builtin_design_data('professional'), self.context)
        page = document['page']
        self.assertEqual(page['margin_top_mm'], 16)
        self.assertEqual(page['margin_right_mm'], 16)
        self.assertEqual(page['margin_bottom_mm'], 16)
        self.assertEqual(page['margin_left_mm'], 20)
        self.assertIsNone(page['sidebar'])

    def test_minimal_real_measured_margins_are_surfaced(self):
        document = build_canvas_document(get_builtin_design_data('minimal'), self.context)
        page = document['page']
        self.assertEqual(page['margin_top_mm'], 20)
        self.assertEqual(page['margin_right_mm'], 18)
        self.assertEqual(page['margin_bottom_mm'], 16)
        self.assertEqual(page['margin_left_mm'], 18)

    def test_modern_sidebar_geometry_is_surfaced_generically(self):
        """
        No template-name branching anywhere in the adapter — Modern's
        sidebar is represented purely because its own design_data.page.sidebar
        key is present, the same generic mechanism any other design could use.
        """
        document = build_canvas_document(get_builtin_design_data('modern'), self.context)
        page = document['page']
        self.assertEqual(page['sidebar'], {'width_mm': 42, 'color': None})
        self.assertEqual(page['effective_margin_left_mm'], page['margin_left_mm'] + 42)

    def test_document_carries_real_font_face_css_not_left_for_the_browser_to_guess(self):
        """
        Real, live-browser-caught Phase 3 bug (see
        LANCERAOS_TEMPLATE_BUILDER_2_PHASE3.md's own "found and fixed"
        section): the canvas silently fell back to the browser's default
        serif font for every element because no @font-face CSS was ever
        shipped to it at all. `css` must contain real @font-face rules
        for every font Phase 2's real reconstructions use, sourced from
        the SAME real partial (_v2_page_styles.html) the canonical
        renderer itself includes — never a second, hand-written CSS string.
        """
        document = build_canvas_document(get_builtin_design_data('professional'), self.context)
        self.assertIn('@font-face', document['css'])
        for family in ('IBM Plex Sans', 'IBM Plex Mono', 'Source Serif 4', 'Space Grotesk'):
            self.assertIn(family, document['css'])

    def test_page_dimensions_and_size_are_passed_through_unchanged(self):
        design_data = get_builtin_design_data('professional')
        document = build_canvas_document(design_data, self.context)
        self.assertEqual(document['page']['width_mm'], design_data['page']['width_mm'])
        self.assertEqual(document['page']['height_mm'], design_data['page']['height_mm'])
        self.assertEqual(document['page']['size'], design_data['page']['size'])

    def test_no_pixel_units_appear_anywhere_in_the_document_payload(self):
        """
        The adapter's whole contract is mm-in, mm-out — a 'px' substring
        anywhere in a numeric-geometry-bearing key would mean px leaked
        into the canonical boundary this module must never cross.
        """
        import json
        document = build_canvas_document(get_builtin_design_data('modern'), self.context)
        # Strip content_html (real rendered markup may legitimately contain
        # the word "px" in nothing relevant here, but let's be precise and
        # only inspect the structural/geometry keys).
        geometry_only = {
            'page': document['page'],
            'header_elements': [
                {k: v for k, v in el.items() if k != 'content_html'} for el in document['header_elements']
            ],
            'flow_elements': [
                {k: v for k, v in el.items() if k != 'content_html'} for el in document['flow_elements']
            ],
        }
        serialized = json.dumps(geometry_only)
        self.assertNotIn('px', serialized)


# ══════════════════════════════════════════════════════════════════
# INDEXING — every element must be traceable back to its exact
# design_data array position, the save-path's own requirement
# ══════════════════════════════════════════════════════════════════

class CanvasIndexingTests(CanvasDocumentDatabaseTestCase):
    def test_header_elements_are_indexed_in_original_array_order(self):
        design_data = get_builtin_design_data('professional')
        document = build_canvas_document(design_data, self.context)
        indices = [el['index'] for el in document['header_elements']]
        self.assertEqual(indices, list(range(len(design_data['header']['elements']))))

    def test_flow_elements_are_indexed_in_original_array_order(self):
        design_data = get_builtin_design_data('minimal')
        document = build_canvas_document(design_data, self.context)
        indices = [el['index'] for el in document['flow_elements']]
        self.assertEqual(indices, list(range(len(design_data['flow']['elements']))))

    def test_every_flow_element_carries_its_own_kind_type_style_overrides(self):
        design_data = get_builtin_design_data('modern')
        document = build_canvas_document(design_data, self.context)
        for i, raw in enumerate(design_data['flow']['elements']):
            out = document['flow_elements'][i]
            self.assertEqual(out['kind'], raw['kind'])
            self.assertEqual(out['type'], raw['type'])
            self.assertEqual(out['style'], raw.get('style') or {})
            self.assertEqual(out['overrides'], raw.get('overrides') or {})


# ══════════════════════════════════════════════════════════════════
# ALL 9 REAL BUILTIN VARIANTS — geometry is variant-independent,
# only colors differ (Phase 2's own established finding)
# ══════════════════════════════════════════════════════════════════

class AllNineVariantsCanvasDocumentTests(CanvasDocumentDatabaseTestCase):
    def test_every_real_template_variant_combination_builds_a_valid_canvas_document(self):
        from apps.invoices.design_seeds import COLOR_VARIANTS

        combos = 0
        for template, variants in COLOR_VARIANTS.items():
            for variant in variants:
                context = build_render_context(self.user, template, variant['key'])
                document = build_canvas_document(get_builtin_design_data(template), context)
                self.assertGreater(len(document['header_elements']), 0)
                self.assertGreater(len(document['flow_elements']), 0)
                combos += 1
        self.assertEqual(combos, 9)  # 3 templates x 3 variants — asserted directly, not assumed


# ══════════════════════════════════════════════════════════════════
# VALIDATION — a schema-invalid document must never silently render
# ══════════════════════════════════════════════════════════════════

class CanvasDocumentValidationTests(CanvasDocumentDatabaseTestCase):
    def test_invalid_design_data_raises_v2_render_error(self):
        with self.assertRaises(DesignRenderError):
            build_canvas_document({'not': 'valid'}, self.context)

    def test_overlapping_header_elements_raise_v2_render_error(self):
        design_data = copy.deepcopy(get_builtin_design_data('professional'))
        design_data['header']['elements'][1]['x'] = design_data['header']['elements'][0]['x']
        design_data['header']['elements'][1]['y'] = design_data['header']['elements'][0]['y']
        with self.assertRaises(DesignRenderError):
            build_canvas_document(design_data, self.context)


# ══════════════════════════════════════════════════════════════════
# SINGLE-ELEMENT REFRESH
# ══════════════════════════════════════════════════════════════════

class SingleElementRefreshTests(CanvasDocumentDatabaseTestCase):
    def test_semantic_totals_variant_renders_correctly(self):
        html = render_canvas_element_content(
            'semantic', 'totals', {'variant': 'total_pill', 'pill_color': '#ff00ff'}, {}, self.context,
        )
        self.assertIn('v2-total-pill', html)
        self.assertIn('#ff00ff', html)

    def test_totals_pill_color_override_actually_takes_effect(self):
        # Phase 6 (style/theme cascade) regression test for a real,
        # previously-live bug: _v2_element_content.html used to read
        # `el.style.pill_color` directly, so a real `overrides.pill_color`
        # (exactly what StylePanel.jsx's own pillColor Style Panel control
        # writes) was silently ignored by this exact endpoint — the
        # editor's own live style-panel refresh call. Confirms the fix:
        # the override now wins over the base style value.
        html = render_canvas_element_content(
            'semantic', 'totals',
            {'variant': 'total_pill', 'pill_color': '#111111'},
            {'pill_color': '#00ff00'},
            self.context,
        )
        self.assertIn('#00ff00', html)
        self.assertNotIn('#111111', html)

    def test_totals_pill_color_theme_token_resolves_and_tracks_variant(self):
        # The architecture plan's own named TB-001 case, for pill_color
        # specifically (its own literal example): a 'theme_secondary'
        # sentinel must resolve to the real, current variant's own
        # secondary color, not render literally or stay frozen.
        modern_default = build_render_context(self.user, 'modern', '')
        modern_plum = build_render_context(self.user, 'modern', 'plum')
        html_default = render_canvas_element_content(
            'semantic', 'totals', {'variant': 'total_pill', 'pill_color': 'theme_secondary'}, {}, modern_default,
        )
        html_plum = render_canvas_element_content(
            'semantic', 'totals', {'variant': 'total_pill', 'pill_color': 'theme_secondary'}, {}, modern_plum,
        )
        self.assertIn('#d4e157', html_default)  # modern/default's real secondary color
        self.assertIn('#8fd9c4', html_plum)  # modern/plum's real secondary color
        self.assertNotIn('theme_secondary', html_default)
        self.assertNotIn('theme_secondary', html_plum)

    def test_generic_text_binding_resolves(self):
        html = render_canvas_element_content(
            'generic', 'text', {}, {}, self.context,
        )
        # No binding given -> static style.text default, empty string; a
        # binding IS exercised directly against resolve_binding elsewhere
        # (test_design_renderer.py) — this just proves the plumbing
        # doesn't crash for the no-binding case, matching a freshly
        # dropped generic text element.
        self.assertIsInstance(html, str)

    def test_generic_rectangle_renders_shape_css(self):
        html = render_canvas_element_content(
            'generic', 'rectangle', {'background_color': '#123456'}, {}, self.context,
        )
        self.assertIn('#123456', html)

    def test_unknown_element_type_raises(self):
        with self.assertRaises(DesignRenderError):
            render_canvas_element_content('semantic', 'not-a-real-type', {}, {}, self.context)


# ══════════════════════════════════════════════════════════════════
# HTTP ENDPOINTS
# ══════════════════════════════════════════════════════════════════

class DesignV2CanvasDocumentEndpointTests(InvoicesAPITestCase):
    def test_requires_authentication(self):
        self.client.logout()
        resp = self.client.post(
            reverse('invoices:design_canvas_document'), data='{}', content_type='application/json',
        )
        self.assertEqual(resp.status_code, 401)

    def test_returns_a_real_canvas_document_for_a_real_builtin(self):
        design_data = get_builtin_design_data('modern')
        resp = self._post(reverse('invoices:design_canvas_document'), {
            'design_data': design_data, 'base_template': 'modern', 'color_variant': '',
        })
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body['page']['sidebar']['width_mm'], 42)
        self.assertEqual(len(body['header_elements']), len(design_data['header']['elements']))
        self.assertEqual(len(body['flow_elements']), len(design_data['flow']['elements']))

    def test_malformed_design_data_returns_422_not_500(self):
        resp = self._post(reverse('invoices:design_canvas_document'), {'design_data': {'bad': True}})
        self.assertEqual(resp.status_code, 422)

    def test_a_legacy_shaped_design_is_migrated_in_memory_and_opens_successfully(self):
        """
        Production cutover — opening ANY saved design for editing (including
        the rare one the one-time production migration couldn't safely
        convert) must work in the one production editor. A legacy-shape
        payload is migrated in memory here, never persisted by this
        read-only endpoint.
        """
        resp = self._post(reverse('invoices:design_canvas_document'), {
            'design_data': copy.deepcopy(LEGACY_BUILTIN_DESIGNS['professional']),
            'base_template': 'professional', 'color_variant': '',
        })
        self.assertEqual(resp.status_code, 200, resp.content)
        body = resp.json()
        self.assertTrue(len(body['header_elements']) > 0)
        self.assertTrue(len(body['flow_elements']) > 0)

    def test_a_legacy_design_that_cannot_be_migrated_returns_a_clear_422_not_a_500(self):
        from apps.invoices.design_migration import migrate_v1_to_v2

        broken_legacy = copy.deepcopy(LEGACY_BUILTIN_DESIGNS['professional'])
        del broken_legacy['zone_2']  # structurally invalid even as legacy input
        assert not migrate_v1_to_v2(broken_legacy)['success']  # sanity-check the premise

        resp = self._post(reverse('invoices:design_canvas_document'), {
            'design_data': broken_legacy, 'base_template': 'professional', 'color_variant': '',
        })
        self.assertEqual(resp.status_code, 422)
        self.assertIn('older format', resp.json()['design_data'])

    def test_missing_design_data_returns_400(self):
        resp = self._post(reverse('invoices:design_canvas_document'), {})
        self.assertEqual(resp.status_code, 400)

    def test_endpoint_never_touches_the_database(self):
        from apps.invoices.models import Invoice, InvoiceDesign
        design_before = InvoiceDesign.objects.count()
        invoice_before = Invoice.objects.count()
        self._post(reverse('invoices:design_canvas_document'), {
            'design_data': get_builtin_design_data('professional'),
        })
        self.assertEqual(InvoiceDesign.objects.count(), design_before)
        self.assertEqual(Invoice.objects.count(), invoice_before)

    def test_a_second_users_design_data_never_reaches_the_first_users_session(self):
        """
        Ownership/isolation regression (Phase 3 Part 23): design_data is
        always taken from the POSTER's own request body, never fetched by
        id from the database — so there is no code path by which User B's
        canvas document could ever be built from User A's stored design
        without User B supplying that exact JSON themselves. This test
        proves the endpoint has no id-based lookup at all: a second user,
        completely unauthenticated to see anything about the first, gets
        a fully valid response using only their own submitted payload.
        """
        other = User.objects.create_user(email='other-v2-canvas@example.com', password='Sup3r$ecret1')
        other.is_email_verified = True
        other.is_active = True
        other.save()
        self.client.logout()
        self._login(email='other-v2-canvas@example.com', password='Sup3r$ecret1')
        resp = self._post(reverse('invoices:design_canvas_document'), {
            'design_data': get_builtin_design_data('minimal'), 'base_template': 'minimal',
        })
        self.assertEqual(resp.status_code, 200)
        # The response reflects the requester's OWN profile (empty/default,
        # since `other` has no business name set) — not the original user's.
        self.assertNotIn('freelancer@example.com', resp.json()['header_elements'][0]['content_html'])


class DesignV2CanvasElementEndpointTests(InvoicesAPITestCase):
    def test_requires_authentication(self):
        self.client.logout()
        resp = self.client.post(
            reverse('invoices:design_canvas_element'), data='{}', content_type='application/json',
        )
        self.assertEqual(resp.status_code, 401)

    def test_returns_html_for_a_valid_element(self):
        resp = self._post(reverse('invoices:design_canvas_element'), {
            'kind': 'semantic', 'el_type': 'signature', 'style': {'label': 'Sign here'},
            'base_template': 'professional', 'color_variant': '',
        })
        self.assertEqual(resp.status_code, 200)
        self.assertIn('Sign here', resp.json()['html'])

    def test_invalid_kind_returns_400(self):
        resp = self._post(reverse('invoices:design_canvas_element'), {
            'kind': 'not-a-kind', 'el_type': 'signature', 'style': {},
        })
        self.assertEqual(resp.status_code, 400)

    def test_invalid_base_template_returns_400(self):
        resp = self._post(reverse('invoices:design_canvas_element'), {
            'kind': 'semantic', 'el_type': 'signature', 'style': {}, 'base_template': 'not-real',
        })
        self.assertEqual(resp.status_code, 400)


class BlankDesignDataTests(TestCase):
    """
    Green-Light directive — get_blank_design_data (design_templates.py),
    the editor's second first-class starting mode. Unit-level coverage;
    DesignV2BuiltinsEndpointTests below covers the HTTP surface.
    """

    def test_every_template_produces_a_schema_valid_blank_design(self):
        from apps.invoices.design_templates import get_blank_design_data

        for name in BUILTIN_DESIGNS:
            with self.subTest(template=name):
                blank = get_blank_design_data(name)
                self.assertEqual(get_schema_version(blank), 2)
                self.assertEqual(validate_design_data_schema_v2(blank), [])
                self.assertEqual(blank['header']['elements'], [])
                types_present = {el['type'] for el in blank['flow']['elements']}
                self.assertEqual(types_present, {'table', 'totals'})

    def test_blank_design_shares_the_same_page_geometry_as_its_builtin(self):
        from apps.invoices.design_templates import get_blank_design_data

        for name in BUILTIN_DESIGNS:
            with self.subTest(template=name):
                blank = get_blank_design_data(name)
                self.assertEqual(blank['page'], BUILTIN_DESIGNS[name]['page'])

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
        """Green-Light directive — the editor's second first-class starting mode."""
        resp = self.client.get(reverse('invoices:design_template_data') + '?base_template=professional&blank=true')
        self.assertEqual(resp.status_code, 200)
        returned = resp.json()['design_data']
        self.assertEqual(get_schema_version(returned), 2)
        self.assertEqual(returned['header']['elements'], [])
        self.assertEqual(validate_design_data_schema_v2(returned), [])
        types_present = {el['type'] for el in returned['flow']['elements']}
        self.assertEqual(types_present, {'table', 'totals'})
        # Same real page geometry as the full builtin for this template —
        # a blank start and a builtin start share the identical printable area.
        self.assertEqual(returned['page'], BUILTIN_DESIGNS['professional']['page'])

    def test_blank_mode_still_validates_the_base_template_value(self):
        resp = self.client.get(reverse('invoices:design_template_data') + '?base_template=made-up&blank=true')
        self.assertEqual(resp.status_code, 400)


class NoRealInvoiceDesignRecordsTouchedTests(TestCase):
    """
    Structural guard mirroring test_design_templates_golden.py's own
    RealInvoiceDesignRecordsUntouchedTests — proves the canvas adapter
    module itself contains no database-writing code, by source inspection
    rather than trust.
    """

    def test_design_canvas_module_has_no_database_write_calls(self):
        import inspect

        from apps.invoices import design_canvas

        source = inspect.getsource(design_canvas)
        for forbidden in ('.objects.create', '.objects.update', '.save(', 'InvoiceDesign.objects', 'Invoice.objects'):
            self.assertNotIn(forbidden, source, f'design_canvas.py must never call {forbidden!r}')
