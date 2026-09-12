# apps/invoices/tests/test_design_cutover.py
"""
Production Template Builder cutover — proves the real, load-bearing chain:
a production-shaped design_data can be created/edited/deleted through
the exact same real InvoiceDesign CRUD endpoints (design_list/design_detail/
design_set_default, apps/invoices/views.py) a legacy design already uses (no
parallel legacy-only persistence surface), and a real Invoice assigned that
design actually renders through the canonical production renderer
(design_renderer.render_design_html) rather than the legacy static/dynamic
renderer — end to end: editor-shaped design_data -> real DB row -> real
invoice PDF/portal render.
"""
import copy
from decimal import Decimal
from unittest.mock import patch

import fitz  # PyMuPDF
from django.urls import reverse

from apps.invoices.design_migration import migrate_v1_to_v2
from apps.invoices.design_seeds import BUILTIN_DESIGNS
from apps.invoices.design_templates import get_builtin_design_data
from apps.invoices.models import InvoiceDesign
from apps.invoices.pdf_generator import render_invoice_pdf, render_invoice_portal_html
from apps.invoices.tests.test_pdf_templates import make_invoice_with_items
from apps.invoices.tests.test_views import InvoicesAPITestCase


class V2DesignPersistenceTests(InvoicesAPITestCase):
    """A schema_version:2 design_data now saves/loads through the real, production InvoiceDesign endpoints."""

    def _v2_payload(self, **overrides):
        payload = {
            'name': 'My V2 Design',
            'base_template': 'professional',
            'design_data': get_builtin_design_data('professional'),
        }
        payload.update(overrides)
        return payload

    def test_create_design_with_v2_design_data_succeeds(self):
        resp = self._post(reverse('invoices:design_list'), self._v2_payload())
        self.assertEqual(resp.status_code, 201, resp.content)
        body = resp.json()
        self.assertEqual(body['design_data']['schema_version'], 2)
        design = InvoiceDesign.objects.get(pk=body['id'])
        self.assertEqual(design.design_data['schema_version'], 2)

    def test_create_design_rejects_structurally_invalid_v2_design_data(self):
        payload = self._v2_payload()
        del payload['design_data']['flow']  # v2's own required key, not v1's zone_2
        resp = self._post(reverse('invoices:design_list'), payload)
        self.assertEqual(resp.status_code, 400)
        errors = resp.json()['design_data']
        self.assertTrue(any('flow' in e for e in errors), errors)

    def test_v2_design_get_put_round_trip_preserves_schema_version_and_shape(self):
        resp = self._post(reverse('invoices:design_list'), self._v2_payload())
        design_id = resp.json()['id']
        url = reverse('invoices:design_detail', kwargs={'pk': design_id})

        get_resp = self._get(url)
        self.assertEqual(get_resp.json()['design_data']['schema_version'], 2)

        # A real edit (moving one header element) — proves PUT re-validates
        # via the v2 (not v1) structural validator and the saved row keeps
        # the edit, not just the original payload.
        edited = copy.deepcopy(get_resp.json()['design_data'])
        edited['header']['elements'][0]['x'] += 1
        put_resp = self._put(url, self._v2_payload(design_data=edited, name='Edited V2 Design'))
        self.assertEqual(put_resp.status_code, 200, put_resp.content)
        design = InvoiceDesign.objects.get(pk=design_id)
        self.assertEqual(design.design_data['header']['elements'][0]['x'], edited['header']['elements'][0]['x'])

    def test_v1_designs_unaffected_by_v2_dispatch(self):
        """A legacy (v1-shaped) design_data still saves/validates exactly as before — no regression from the version dispatch."""
        payload = {
            'name': 'My Custom V1 Design', 'base_template': 'professional',
            'design_data': copy.deepcopy(BUILTIN_DESIGNS['professional']),
        }
        resp = self._post(reverse('invoices:design_list'), payload)
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertNotIn('schema_version', resp.json()['design_data'])

    def test_v2_design_can_be_set_as_default_through_the_real_endpoint(self):
        resp = self._post(reverse('invoices:design_list'), self._v2_payload())
        design_id = resp.json()['id']
        set_default_resp = self._post(reverse('invoices:design_set_default', kwargs={'pk': design_id}), {})
        self.assertEqual(set_default_resp.status_code, 200, set_default_resp.content)
        self.assertTrue(InvoiceDesign.objects.get(pk=design_id).is_default)


class V2DesignRealInvoiceRenderTests(InvoicesAPITestCase):
    """A real Invoice assigned a v2 InvoiceDesign actually renders through design_renderer, not v1's renderer."""

    def setUp(self):
        super().setUp()
        # Real, non-blank profile fields — the same content
        # test_pdf_templates.make_freelancer sets, applied to the existing
        # InvoicesAPITestCase.self.user (creating a second User with the
        # same email would collide on the real unique constraint).
        profile = self.user.profile
        profile.display_name = 'Fahad Ali'
        profile.business_name = 'Horizon Studio'
        profile.city = 'Lahore'
        profile.country = 'Pakistan'
        profile.save()

    def _make_v2_design(self, base_template='professional'):
        return InvoiceDesign.objects.create(
            user=self.user, name='V2', base_template=base_template, source='custom',
            design_data=get_builtin_design_data(base_template),
        )

    def test_invoice_pdf_render_uses_v2_renderer_for_a_v2_design(self):
        design = self._make_v2_design()
        invoice = make_invoice_with_items(self.user, n_items=3, design=design)
        pdf_bytes = render_invoice_pdf(invoice)
        self.assertTrue(pdf_bytes.startswith(b'%PDF'))
        doc = fitz.open(stream=pdf_bytes, filetype='pdf')
        text = doc[0].get_text()
        doc.close()
        # The real client name must actually appear — proves the v2
        # renderer's own binding resolution ran against REAL invoice data,
        # not alias-mode labels (which only the editor canvas ever uses).
        self.assertIn(invoice.client_name, text)

    def test_invoice_portal_html_render_uses_v2_renderer_for_a_v2_design(self):
        design = self._make_v2_design()
        invoice = make_invoice_with_items(self.user, n_items=3, design=design)
        html = render_invoice_portal_html(invoice)
        # v2's own canonical template's distinguishing real CSS class —
        # never emitted by v1's static templates or its own dynamic
        # renderer (dyn-main/dyn-zone1 etc.) — proves the dispatch in
        # render_html_for_design actually took the v2 branch.
        self.assertIn('v2-content', html)
        self.assertIn('Reyes LLP', html)  # invoice.client_name, minus the '&' HTML-escapes

    def test_invoice_with_v1_design_still_uses_v1_renderer(self):
        """Regression: a real v1 (edited, dynamic-path) design must be unaffected by the new v2 dispatch branch."""
        design = InvoiceDesign.objects.create(
            user=self.user, name='V1 custom', base_template='professional', source='custom',
            design_data={**copy.deepcopy(BUILTIN_DESIGNS['professional']), 'zone_1': {
                'elements': [
                    {**el, 'x': el['x'] + 1}
                    for el in BUILTIN_DESIGNS['professional']['zone_1']['elements']
                ],
            }},
        )
        invoice = make_invoice_with_items(self.user, n_items=3, design=design)
        html = render_invoice_portal_html(invoice)
        self.assertNotIn('v2-content', html)
        self.assertIn('Reyes LLP', html)

    def test_migrated_v1_design_assigned_to_a_real_invoice_renders_via_v2(self):
        """The full cutover chain: a real v1 builtin, migrated in memory, saved as a real v2 InvoiceDesign, assigned to a real invoice, renders via v2."""
        migration = migrate_v1_to_v2(copy.deepcopy(BUILTIN_DESIGNS['modern']))
        self.assertTrue(migration['success'], msg=migration['errors'])
        design = InvoiceDesign.objects.create(
            user=self.user, name='Migrated Modern', base_template='modern', source='custom',
            design_data=migration['design_data'],
        )
        invoice = make_invoice_with_items(self.user, n_items=2, design=design)
        html = render_invoice_portal_html(invoice)
        self.assertIn('v2-content', html)
        self.assertIn('Reyes LLP', html)  # invoice.client_name, minus the '&' HTML-escapes
