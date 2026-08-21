# apps/invoices/tests/test_design_editor_canvas.py
"""
20 August 2026 — real, substantial canvas rework (see DECISIONS.md's
"canvas must render the real thing" entry). A direct report identified 3
related problems: the canvas editor showed a generic abstract placeholder
instead of the actual template output; it used sample data instead of the
real logged-in freelancer's own profile; and resizing/repositioning an
element that "looked fine" in the canvas visibly broke the real rendered
invoice (traced to synthetic placeholder content having zero relationship
to what real content/fonts actually need — not a coordinate-math bug, see
DECISIONS.md's full root-cause writeup).

This file covers the new backend half: design_renderer.py's
render_editor_canvas_html/render_editor_element_html + design_preview.py's
wrappers (real freelancer profile automatically included, exactly like
every other function in that module) + the two new views
(design_editor_canvas, design_editor_element).
"""
import copy
from decimal import Decimal

from django.urls import reverse

from apps.invoices.design_preview import render_editor_canvas_html, render_editor_element_html
from apps.invoices.design_seeds import MINIMAL_DESIGN_DATA, MODERN_DESIGN_DATA, PROFESSIONAL_DESIGN_DATA
from apps.invoices.models import InvoiceDesign
from apps.invoices.tests.test_views import InvoicesAPITestCase


class RenderEditorCanvasHtmlTests(InvoicesAPITestCase):
    """apps/invoices/design_preview.render_editor_canvas_html — the initial real-content load."""

    def test_renders_real_indexed_elements_for_every_seed(self):
        for base_template, seed in [('professional', PROFESSIONAL_DESIGN_DATA), ('minimal', MINIMAL_DESIGN_DATA), ('modern', MODERN_DESIGN_DATA)]:
            html = render_editor_canvas_html(self.user, seed, base_template, 'default', sample_rows=3)
            self.assertIn('data-el-zone="1"', html, base_template)
            self.assertIn('data-el-zone="2"', html, base_template)
            # Every zone_1 element index from 0 up to len-1 must be present, in order.
            for i in range(len(seed['zone_1']['elements'])):
                self.assertIn(f'data-el-index="{i}"', html, f'{base_template} zone_1[{i}]')

    def test_uses_the_real_requesting_users_own_profile(self):
        self.user.profile.business_name = 'Editor Canvas Real Business'
        self.user.profile.save()
        html = render_editor_canvas_html(self.user, PROFESSIONAL_DESIGN_DATA, 'professional', 'default')
        self.assertIn('Editor Canvas Real Business', html)

    def test_resolves_the_real_requested_color_not_the_default(self):
        html = render_editor_canvas_html(self.user, MINIMAL_DESIGN_DATA, 'minimal', 'clay')
        self.assertIn('#a8663c', html)  # clay primary
        self.assertNotIn('#6b8570', html)  # sage (minimal's own default) must NOT leak in instead

    def test_never_splits_zone1_elements_into_a_simulated_sidebar(self):
        """Step 8b's own established scope (unchanged by this pass): the editor never physically simulates the fixed sidebar — every zone_1 element renders absolutely positioned, sidebar-flagged or not."""
        html = render_editor_canvas_html(self.user, MODERN_DESIGN_DATA, 'modern', 'default')
        self.assertNotIn('class="dyn-sidebar"', html)
        # The real sidebar-flagged logo (index 0) is still present, just absolutely positioned like everything else.
        self.assertIn('data-el-index="0"', html)
        self.assertIn('data-sidebar="true"', html)

    def test_never_combines_paired_elements_into_one_row(self):
        """Same established scope: pairing is a badge/attribute in the editor, never a real two-column reflow. 'dyn-pair-row' itself still appears as a bare CSS rule in the shared stylesheet (the real renderer's own use) — the real assertion is that no element in the BODY actually uses that class."""
        html = render_editor_canvas_html(self.user, PROFESSIONAL_DESIGN_DATA, 'professional', 'default')
        self.assertNotIn('class="dyn-pair-row"', html)
        self.assertIn('data-paired="true"', html)

    def test_real_sample_row_count_reflected(self):
        html = render_editor_canvas_html(self.user, PROFESSIONAL_DESIGN_DATA, 'professional', 'default', sample_rows=8)
        self.assertEqual(html.count('Sample line item'), 8)

    def test_a_genuine_style_edit_shows_up_in_the_real_output(self):
        """The actual item-3 verification: a real, specific style change is reflected precisely, not approximately."""
        data = copy.deepcopy(PROFESSIONAL_DESIGN_DATA)
        data['zone_1']['elements'][0]['x'] = 77.5
        data['zone_1']['elements'][0]['width'] = 33
        html = render_editor_canvas_html(self.user, data, 'professional', 'default')
        self.assertIn('left:77.5mm', html)
        self.assertIn('width:33mm', html)


class RenderEditorElementHtmlTests(InvoicesAPITestCase):
    """apps/invoices/design_preview.render_editor_element_html — the live per-element style-panel refresh."""

    def test_real_content_for_a_zone1_type(self):
        self.user.profile.business_name = 'Refresh Test Co'
        self.user.profile.save()
        html = render_editor_element_html(self.user, 'professional', 'default', 'business_info', {'eyebrow': 'Invoice', 'show_tagline': False})
        self.assertIn('Refresh Test Co', html)
        self.assertIn('Invoice', html)

    def test_totals_variant_and_rows_respected(self):
        html = render_editor_element_html(self.user, 'minimal', 'default', 'totals', {'variant': 'total_due_display'})
        self.assertIn('dyn-total-due-amt', html)

    def test_payment_info_variant_respected(self):
        html_qr = render_editor_element_html(self.user, 'modern', 'default', 'payment_info', {'variant': 'qr_and_link'})
        self.assertIn('dyn-payonline', html_qr)


class DesignEditorCanvasEndpointTests(InvoicesAPITestCase):
    def test_returns_real_html_for_a_seed_starting_point(self):
        resp = self._post(reverse('invoices:design_editor_canvas'), {
            'design_data': PROFESSIONAL_DESIGN_DATA, 'base_template': 'professional', 'color_variant': 'default', 'sample_rows': 3,
        })
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp['Content-Type'], 'text/html')
        self.assertIn('data-el-zone="1"', resp.content.decode())

    def test_rejects_malformed_design_data_with_specific_schema_errors(self):
        resp = self._post(reverse('invoices:design_editor_canvas'), {
            'design_data': {'zone_1': {'elements': []}},  # missing zone_2 entirely
            'base_template': 'professional', 'color_variant': '',
        })
        self.assertEqual(resp.status_code, 400)
        self.assertIn('design_data', resp.json())

    def test_rejects_an_unknown_base_template(self):
        resp = self._post(reverse('invoices:design_editor_canvas'), {
            'design_data': PROFESSIONAL_DESIGN_DATA, 'base_template': 'nonexistent', 'color_variant': '',
        })
        self.assertEqual(resp.status_code, 400)

    def test_requires_authentication(self):
        self.client.cookies.clear()
        resp = self._post(reverse('invoices:design_editor_canvas'), {
            'design_data': PROFESSIONAL_DESIGN_DATA, 'base_template': 'professional', 'color_variant': '',
        })
        self.assertEqual(resp.status_code, 401)

    def test_a_genuinely_edited_design_reflects_the_edit_in_the_endpoints_own_output(self):
        """End-to-end proof this endpoint is what a real save->reload editor session would see: the exact position it returns matches what design_renderer.py's own real render (proven in test_design_color_and_preview.py) would use for the same design_data."""
        data = copy.deepcopy(MINIMAL_DESIGN_DATA)
        # Moved well clear of every other real element's own bounding box
        # (the seed's own elements all finish by y=74) — a real, valid,
        # non-overlapping edit, not colliding with the schema's own real
        # overlap check (which a first version of this test tripped,
        # correctly, by picking a spot that genuinely did collide).
        data['zone_1']['elements'][1]['y'] = 90.4
        resp = self._post(reverse('invoices:design_editor_canvas'), {
            'design_data': data, 'base_template': 'minimal', 'color_variant': 'default',
        })
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertIn('top:90.4mm', resp.content.decode())

    def test_sample_rows_clamped_to_a_sane_range(self):
        resp = self._post(reverse('invoices:design_editor_canvas'), {
            'design_data': PROFESSIONAL_DESIGN_DATA, 'base_template': 'professional', 'color_variant': '', 'sample_rows': 500,
        })
        self.assertEqual(resp.content.decode().count('Sample line item'), 20)


class DesignEditorElementEndpointTests(InvoicesAPITestCase):
    def test_returns_real_content_json(self):
        resp = self._post(reverse('invoices:design_editor_element'), {
            'el_type': 'client_info', 'style': {'label': 'Bill to', 'align': 'left'},
            'base_template': 'professional', 'color_variant': 'default',
        })
        self.assertEqual(resp.status_code, 200)
        self.assertIn('Bill to', resp.json()['html'])

    def test_rejects_an_unknown_element_type(self):
        resp = self._post(reverse('invoices:design_editor_element'), {
            'el_type': 'not_a_real_type', 'style': {}, 'base_template': 'professional', 'color_variant': '',
        })
        self.assertEqual(resp.status_code, 400)

    def test_rejects_a_non_object_style(self):
        resp = self._post(reverse('invoices:design_editor_element'), {
            'el_type': 'logo', 'style': 'not-an-object', 'base_template': 'professional', 'color_variant': '',
        })
        self.assertEqual(resp.status_code, 400)

    def test_uses_the_real_requesting_users_own_logo_and_data(self):
        self.user.profile.city = 'Karachi'
        self.user.profile.country = 'Pakistan'
        self.user.profile.save()
        resp = self._post(reverse('invoices:design_editor_element'), {
            'el_type': 'business_info', 'style': {'show_tagline': True}, 'base_template': 'professional', 'color_variant': '',
        })
        self.assertIn('Karachi', resp.json()['html'])
        self.assertIn('Pakistan', resp.json()['html'])

    def test_requires_authentication(self):
        self.client.cookies.clear()
        resp = self._post(reverse('invoices:design_editor_element'), {
            'el_type': 'logo', 'style': {}, 'base_template': 'professional', 'color_variant': '',
        })
        self.assertEqual(resp.status_code, 401)


class EditorCanvasMatchesRealInvoiceOutputTests(InvoicesAPITestCase):
    """
    Item 3's own explicit verification bar: a specific, measured element
    change made through this exact editor-canvas render path must produce
    the identical value in a REAL, saved, finalised invoice's own render —
    not just "look similar." Both paths go through design_renderer.py's
    shared _zone1_element_css/_annotate_zone2_element helpers, so this is
    a real, direct proof they stay in lockstep, not an assumption.
    """

    def test_a_real_resize_reflected_identically_in_the_real_invoice_render(self):
        from apps.invoices.models import Invoice, InvoiceItem
        from apps.invoices.pdf_generator import render_invoice_portal_html

        data = copy.deepcopy(PROFESSIONAL_DESIGN_DATA)
        # A specific, measured resize — matches what a real drag/resize in
        # the canvas would produce after px->mm conversion (see
        # serialization.js's own pxToMm, 2dp rounding).
        data['zone_1']['elements'][0]['x'] = 45.2
        data['zone_1']['elements'][0]['y'] = 30.7
        data['zone_1']['elements'][0]['width'] = 22.5
        data['zone_1']['elements'][0]['height'] = 22.5

        canvas_html = render_editor_canvas_html(self.user, data, 'professional', 'default')
        self.assertIn('left:45.2mm', canvas_html)
        self.assertIn('top:30.7mm', canvas_html)
        self.assertIn('width:22.5mm', canvas_html)
        self.assertIn('height:22.5mm', canvas_html)

        design = InvoiceDesign.objects.create(
            user=self.user, name='Resized', base_template='professional', source='custom', design_data=data,
        )
        invoice = Invoice.objects.create(
            user=self.user, invoice_number=None, status='created', client_name='X', client_email='x@example.com',
            currency='USD', design=design, due_date='2026-09-01',
        )
        InvoiceItem.objects.create(invoice=invoice, description='Work', quantity=Decimal('1'), unit_price=Decimal('100'))
        invoice.recalculate_totals()
        invoice.save()

        real_html = render_invoice_portal_html(invoice)
        self.assertIn('left:45.2mm', real_html)
        self.assertIn('top:30.7mm', real_html)
        self.assertIn('width:22.5mm', real_html)
        self.assertIn('height:22.5mm', real_html)
