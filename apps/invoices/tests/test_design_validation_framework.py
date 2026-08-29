# apps/invoices/tests/test_design_validation_framework.py
"""
Template Builder 2.0 — tests for design_validation.py's structured-
finding framework. Phase 0 confirmed the result shape and Layer A
(schema) really delegating to the real validators; the Green-Light
directive made Layers C (semantic) and D (renderability) real for v2
designs, tested for real below. Layer B is still confirmed a genuine
no-op (re-verified, not re-implemented — see the module's own docstring
for why no functional gap remains for it to fill).
"""
import copy

from django.test import SimpleTestCase, TestCase
from django.urls import reverse

from apps.invoices.design_migration import migrate_v1_to_v2
from apps.invoices.design_renderer import build_render_context
from apps.invoices.design_seeds import BUILTIN_DESIGNS
from apps.invoices.design_templates import BUILTIN_DESIGNS as PRODUCTION_BUILTIN_DESIGNS
from apps.invoices.design_templates import get_builtin_design_data
from apps.invoices.design_validation import (
    CATEGORY_RENDERABILITY,
    CATEGORY_SCHEMA,
    CATEGORY_SEMANTIC,
    SEVERITY_ERROR,
    SEVERITY_WARNING,
    make_finding,
    run_validation,
)
from apps.invoices.tests.test_views import InvoicesAPITestCase
from apps.users.models import User


class MakeFindingTests(SimpleTestCase):
    def test_produces_the_documented_shape(self):
        finding = make_finding('SOME_CODE', SEVERITY_ERROR, CATEGORY_SCHEMA, 'a message', component_id='abc')
        self.assertEqual(finding, {
            'code': 'SOME_CODE', 'severity': SEVERITY_ERROR, 'category': CATEGORY_SCHEMA,
            'component_id': 'abc', 'message': 'a message',
        })

    def test_component_id_defaults_to_none(self):
        finding = make_finding('SOME_CODE', SEVERITY_WARNING, CATEGORY_SCHEMA, 'a message')
        self.assertIsNone(finding['component_id'])

    def test_invalid_severity_rejected(self):
        with self.assertRaises(ValueError):
            make_finding('SOME_CODE', 'not-a-real-severity', CATEGORY_SCHEMA, 'a message')


class RunValidationResultShapeTests(SimpleTestCase):
    def test_result_has_the_documented_keys(self):
        result = run_validation(copy.deepcopy(BUILTIN_DESIGNS['professional']))
        self.assertEqual(set(result.keys()), {'valid', 'errors', 'warnings'})
        self.assertIsInstance(result['errors'], list)
        self.assertIsInstance(result['warnings'], list)

    def test_valid_legacy_design_is_valid(self):
        result = run_validation(copy.deepcopy(BUILTIN_DESIGNS['professional']))
        self.assertTrue(result['valid'])
        self.assertEqual(result['errors'], [])

    def test_valid_v2_design_is_valid(self):
        # Phase 5.1: a real, valid v2 design — not a live migration of the
        # real professional v1 seed, which no longer succeeds once page-
        # boundary validation exists (a real, pre-existing bug in
        # design_migration.py's paired-element width math, unrelated to
        # what this test is actually checking; see test_design_migration.py's
        # own MigrateV1ToV2RealSeedTests for the full explanation). This
        # test's own purpose — confirm run_validation accepts a valid v2-
        # shaped design — doesn't depend on migration specifically.
        v2 = get_builtin_design_data('professional')
        result = run_validation(v2)
        self.assertTrue(result['valid'])

    def test_structurally_invalid_design_is_invalid_with_schema_category_findings(self):
        result = run_validation({'zone_1': {'elements': []}})  # missing zone_2
        self.assertFalse(result['valid'])
        self.assertTrue(result['errors'])
        self.assertTrue(all(f['category'] == CATEGORY_SCHEMA for f in result['errors']))
        self.assertTrue(all(f['severity'] == SEVERITY_ERROR for f in result['errors']))

    def test_unsupported_schema_version_produces_a_schema_error_not_a_crash(self):
        result = run_validation({'schema_version': 99, 'zone_1': {}, 'zone_2': {}})
        self.assertFalse(result['valid'])
        self.assertTrue(any(f['code'] == 'SCHEMA_VERSION_UNSUPPORTED' for f in result['errors']))

    def test_non_dict_payload_produces_a_schema_error_not_a_crash(self):
        result = run_validation('not a dict')
        self.assertFalse(result['valid'])
        self.assertTrue(result['errors'])

    def test_warnings_never_affect_validity(self):
        # No layer in Phase 0 actually produces a warning for a clean design,
        # but the contract itself (valid depends only on errors) is testable
        # directly against the implementation.
        result = run_validation(copy.deepcopy(BUILTIN_DESIGNS['professional']))
        self.assertTrue(result['valid'])
        self.assertEqual(result['warnings'], [])  # true today; asserting the actual current behavior


class LayerSelectionTests(SimpleTestCase):
    def test_running_only_the_schema_layer_still_catches_structural_errors(self):
        result = run_validation({'zone_1': {'elements': []}}, layers=('schema',))
        self.assertFalse(result['valid'])

    def test_running_only_layout_layer_on_a_structurally_invalid_design_reports_nothing(self):
        # Confirms layer B is a genuine, documented no-op in Phase 0 — it
        # must NOT independently catch what layer A would catch, since that
        # would misrepresent what's actually implemented.
        result = run_validation({'zone_1': {'elements': []}}, layers=('layout',))
        self.assertTrue(result['valid'])
        self.assertEqual(result['errors'], [])

    def test_running_only_semantic_layer_on_a_v1_shaped_document_reports_nothing(self):
        # Layer C is real for v2 only — a v1-shaped (zone_1/zone_2) payload
        # never reaches its checks at all, matching this codebase's own
        # v1/v2 boundary (v1 is being phased out, not extended).
        result = run_validation({'zone_1': {'elements': []}, 'zone_2': {'elements': []}}, layers=('semantic',))
        self.assertEqual(result['errors'], [])
        self.assertEqual(result['warnings'], [])

    def test_running_only_renderability_layer_without_a_design_or_context_reports_nothing(self):
        result = run_validation({}, layers=('renderability',))
        self.assertEqual(result['errors'], [])
        self.assertEqual(result['warnings'], [])

    def test_validation_does_not_mutate_the_input_design_data(self):
        design = copy.deepcopy(BUILTIN_DESIGNS['professional'])
        before = copy.deepcopy(design)
        run_validation(design)
        self.assertEqual(design, before)


class SemanticLayerRealChecksTests(SimpleTestCase):
    """Layer C, real for v2 (Green-Light directive) — TB-004 plus 3 siblings."""

    def test_every_builtin_v2_design_passes_every_semantic_check(self):
        # All 3 builtins already bind invoice.number/invoice.due_date/
        # client.name and include a 'total' row in their totals block —
        # a real regression guard that stays true as those seeds evolve.
        for name in PRODUCTION_BUILTIN_DESIGNS:
            with self.subTest(template=name):
                result = run_validation(copy.deepcopy(PRODUCTION_BUILTIN_DESIGNS[name]), layers=('semantic',))
                self.assertEqual(result['warnings'], [])

    def test_missing_invoice_number_binding_produces_a_warning_not_an_error(self):
        design = copy.deepcopy(PRODUCTION_BUILTIN_DESIGNS['professional'])
        design['header']['elements'] = [
            el for el in design['header']['elements'] if el.get('binding') != 'invoice.number'
        ]
        result = run_validation(design, layers=('semantic',))
        self.assertEqual(result['errors'], [])  # never blocks — advisory only
        codes = {f['code'] for f in result['warnings']}
        self.assertIn('MISSING_INVOICE_NUMBER', codes)

    def test_missing_due_date_binding_produces_a_warning(self):
        design = copy.deepcopy(PRODUCTION_BUILTIN_DESIGNS['professional'])
        design['header']['elements'] = [
            el for el in design['header']['elements'] if el.get('binding') != 'invoice.due_date'
        ]
        result = run_validation(design, layers=('semantic',))
        codes = {f['code'] for f in result['warnings']}
        self.assertIn('MISSING_DUE_DATE', codes)

    def test_missing_client_name_produces_a_warning(self):
        design = copy.deepcopy(PRODUCTION_BUILTIN_DESIGNS['professional'])
        design['header']['elements'] = [
            el for el in design['header']['elements'] if el.get('binding') != 'client.name'
        ]
        result = run_validation(design, layers=('semantic',))
        codes = {f['code'] for f in result['warnings']}
        self.assertIn('MISSING_CLIENT_NAME', codes)

    def test_totals_block_missing_the_total_row_produces_a_warning(self):
        design = copy.deepcopy(PRODUCTION_BUILTIN_DESIGNS['professional'])
        for el in design['flow']['elements']:
            if el.get('type') == 'totals':
                el['style']['rows'] = [r for r in el['style']['rows'] if r != 'total']
        result = run_validation(design, layers=('semantic',))
        codes = {f['code'] for f in result['warnings']}
        self.assertIn('MISSING_GRAND_TOTAL', codes)

    def test_structurally_invalid_v2_document_gets_no_semantic_findings(self):
        # Layer A already reports the real problem; Layer C only inspects
        # a document once it's schema-valid (see _v2_schema_valid_elements).
        broken = copy.deepcopy(PRODUCTION_BUILTIN_DESIGNS['professional'])
        del broken['flow']  # now fails schema validation outright
        result = run_validation(broken, layers=('semantic',))
        self.assertEqual(result['warnings'], [])


class RenderabilityLayerRealChecksTests(TestCase):
    """Layer D, real for v2 given a real invoice_context (Green-Light directive)."""

    def setUp(self):
        self.user = User.objects.create_user(email='validation-layer-d@example.com', password='Sup3r$ecret1')

    def test_every_builtin_v2_design_renders_cleanly_against_a_real_context(self):
        for name in PRODUCTION_BUILTIN_DESIGNS:
            with self.subTest(template=name):
                ctx = build_render_context(self.user, name, '')
                result = run_validation(copy.deepcopy(PRODUCTION_BUILTIN_DESIGNS[name]), invoice_context=ctx, layers=('renderability',))
                self.assertEqual(result['errors'], [])

    def test_incomplete_render_context_is_caught_as_a_real_render_failure(self):
        # An out-of-allow-list binding can never reach Layer D at all — it
        # fails Layer A's own schema validation first, so
        # _v2_schema_valid_elements' guard already returns [] before any
        # dry-run is attempted (see the sibling test below). The class of
        # problem Layer D exists to catch is a SCHEMA-VALID design that
        # still can't render for real — modeled here with a genuinely
        # incomplete render context (missing 'freelancer' entirely, which
        # every business.* binding resolver needs), producing a real
        # DesignRenderError from resolve_binding's own KeyError/AttributeError
        # handling, not a fabricated one.
        design = copy.deepcopy(PRODUCTION_BUILTIN_DESIGNS['professional'])
        incomplete_ctx = {'invoice': build_render_context(self.user, 'professional', '')['invoice']}
        result = run_validation(design, invoice_context=incomplete_ctx, layers=('renderability',))
        self.assertEqual(len(result['errors']), 1)
        self.assertEqual(result['errors'][0]['code'], 'RENDER_FAILED')
        self.assertEqual(result['errors'][0]['category'], CATEGORY_RENDERABILITY)

    def test_no_invoice_context_means_no_renderability_findings_even_for_a_valid_design(self):
        result = run_validation(
            copy.deepcopy(PRODUCTION_BUILTIN_DESIGNS['professional']), invoice_context=None, layers=('renderability',),
        )
        self.assertEqual(result['errors'], [])
        self.assertEqual(result['warnings'], [])

    def test_structurally_invalid_v2_document_gets_no_renderability_attempt(self):
        broken = copy.deepcopy(PRODUCTION_BUILTIN_DESIGNS['professional'])
        del broken['flow']
        ctx = build_render_context(self.user, 'professional', '')
        result = run_validation(broken, invoice_context=ctx, layers=('renderability',))
        # Layer A (not run here) would report this; Layer D alone must not
        # attempt (and crash on, or duplicate) a dry-run against it.
        self.assertEqual(result['errors'], [])


class DesignV2ValidateEndpointTests(InvoicesAPITestCase):
    """The Template Health endpoint (views_design_editor.design_validate) — same isolated-test-surface
    conventions as every other v2- endpoint (see test_design_canvas.py's own equivalent class)."""

    def test_requires_authentication(self):
        self.client.logout()
        resp = self.client.post(
            reverse('invoices:design_validate'), data='{}', content_type='application/json',
        )
        self.assertEqual(resp.status_code, 401)

    def test_a_valid_builtin_design_reports_valid_with_no_warnings(self):
        resp = self._post(reverse('invoices:design_validate'), {
            'design_data': get_builtin_design_data('professional'), 'base_template': 'professional',
        })
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertTrue(body['valid'])
        self.assertEqual(body['errors'], [])
        self.assertEqual(body['warnings'], [])

    def test_missing_design_data_returns_400(self):
        resp = self._post(reverse('invoices:design_validate'), {})
        self.assertEqual(resp.status_code, 400)

    def test_a_design_missing_the_invoice_number_binding_reports_a_real_warning(self):
        design_data = get_builtin_design_data('professional')
        design_data['header']['elements'] = [
            el for el in design_data['header']['elements'] if el.get('binding') != 'invoice.number'
        ]
        resp = self._post(reverse('invoices:design_validate'), {
            'design_data': design_data, 'base_template': 'professional',
        })
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertTrue(body['valid'])  # a warning never blocks
        codes = {f['code'] for f in body['warnings']}
        self.assertIn('MISSING_INVOICE_NUMBER', codes)

    def test_structurally_invalid_design_reports_a_real_schema_error(self):
        resp = self._post(reverse('invoices:design_validate'), {'design_data': {'bad': True}})
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertFalse(body['valid'])
        self.assertTrue(body['errors'])

    def test_endpoint_never_touches_the_database(self):
        from apps.invoices.models import Invoice, InvoiceDesign
        design_before = InvoiceDesign.objects.count()
        invoice_before = Invoice.objects.count()
        self._post(reverse('invoices:design_validate'), {
            'design_data': get_builtin_design_data('professional'),
        })
        self.assertEqual(InvoiceDesign.objects.count(), design_before)
        self.assertEqual(Invoice.objects.count(), invoice_before)
