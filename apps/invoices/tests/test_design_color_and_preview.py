# apps/invoices/tests/test_design_color_and_preview.py
"""
SEV1 follow-up, 20 August 2026 — two related but distinct real bugs, both
confirmed by direct evidence (a screenshot of all 3 gallery cards
rendering the exact same generic thumbnail, and the prior round's own
admission that color_variant had zero effect anywhere):

1. Gallery preview cards showed a client-side approximation that never
   reacted to the selected color swatch, and (per the screenshot) barely
   differed between templates. Fixed with a real backend render
   (apps/invoices/design_preview.py) — the exact same render path
   (pdf_generator.render_html_for_design) a real client invoice uses,
   embedded via an iframe (DesignLivePreview.jsx replaces the deleted
   DesignCanvasPreview.jsx client-side approximation).

2. color_variant was completely inert in every real render path.
   apps/invoices/design_seeds.COLOR_VARIANTS + resolve_design_colors are
   the real fix — each of the 3 static templates' own brand-accent hex
   values (verified directly, not guessed) are parametrized into
   design_primary_color/design_secondary_color template variables,
   sourced from build_pdf_context via the SAME resolution both the
   static-template path and the dynamic design_renderer path share.

Also covers item 0's own verification: a brand-new invoice created with
a real default design correctly resolves the right base_template AND
color — and the real, separate, previously-undetected "a still-editable
draft predating any default design shows stale output" edge case this
same investigation surfaced, fixed via _effective_design's live fallback
for draft-status invoices only (never past draft — the frozen-PDF
guarantee is untouched).

See DECISIONS.md's 20 August 2026 "color_variant wiring" entry for the
full investigation and reasoning.
"""
from decimal import Decimal

from django.urls import reverse

from apps.invoices.design_seeds import COLOR_VARIANTS, PROFESSIONAL_DESIGN_DATA, resolve_design_colors
from apps.invoices.models import Invoice, InvoiceDesign, InvoiceItem
from apps.invoices.pdf_generator import build_pdf_context, render_invoice_pdf, render_invoice_portal_html
from apps.invoices.tests.test_views import InvoicesAPITestCase

# Every real (base_template, color_variant, expected_primary_hex) combination — the actual verification bar this round set: all 9, not a sample.
ALL_COMBINATIONS = [
    ('professional', 'default', '#a8813c'), ('professional', 'forest', '#4a7c59'), ('professional', 'burgundy', '#8c3a4d'),
    ('minimal', 'default', '#6b8570'), ('minimal', 'slate', '#5b6b78'), ('minimal', 'clay', '#a8663c'),
    ('modern', 'default', '#2d2a6e'), ('modern', 'midnight', '#1a1a2e'), ('modern', 'plum', '#4a2d5e'),
]


class ResolveDesignColorsTests(InvoicesAPITestCase):
    def test_all_9_real_combinations_resolve_to_their_own_distinct_primary(self):
        seen = set()
        for base_template, color_variant, expected_primary in ALL_COMBINATIONS:
            primary, secondary = resolve_design_colors(base_template, color_variant)
            self.assertEqual(primary, expected_primary, f'{base_template}/{color_variant}')
            seen.add(primary)
        self.assertEqual(len(seen), 9)  # genuinely 9 distinct primaries, not fewer

    def test_blank_color_variant_falls_back_to_that_templates_own_default(self):
        for base_template, _, expected_default_primary in ALL_COMBINATIONS[::3]:  # the 3 'default' rows
            primary, _ = resolve_design_colors(base_template, '')
            self.assertEqual(primary, expected_default_primary)

    def test_unrecognized_color_variant_falls_back_to_default_not_a_crash(self):
        primary, secondary = resolve_design_colors('professional', 'some-typo-value')
        self.assertEqual((primary, secondary), (COLOR_VARIANTS['professional'][0]['primary'], COLOR_VARIANTS['professional'][0]['secondary']))

    def test_unknown_base_template_falls_back_to_professional_not_a_crash(self):
        primary, secondary = resolve_design_colors('nonexistent', 'default')
        self.assertEqual(primary, COLOR_VARIANTS['professional'][0]['primary'])


class BuildPdfContextColorTests(InvoicesAPITestCase):
    def test_context_defaults_match_the_pre_existing_hardcoded_professional_colors(self):
        """No design at all — must resolve to exactly what was already hardcoded, zero regression."""
        invoice = self._invoice(status='created', design=None)
        InvoiceItem.objects.create(invoice=invoice, description='Work', quantity=Decimal('1'), unit_price=Decimal('100'))
        context = build_pdf_context(invoice)
        self.assertEqual(context['design_primary_color'], '#a8813c')
        self.assertEqual(context['design_secondary_color'], '#1a2b42')

    def test_context_reflects_a_real_assigned_designs_color(self):
        design = InvoiceDesign.objects.create(
            user=self.user, name='Burgundy', base_template='professional', source='builtin', color_variant='burgundy',
        )
        invoice = self._invoice(status='created', design=design)
        InvoiceItem.objects.create(invoice=invoice, description='Work', quantity=Decimal('1'), unit_price=Decimal('100'))
        context = build_pdf_context(invoice)
        self.assertEqual(context['design_primary_color'], '#8c3a4d')


class StaticTemplateRealColorRenderTests(InvoicesAPITestCase):
    """The actual verification bar: render real invoices, one per (base_template, color_variant), confirm the real rendered output shows 9 genuinely different color schemes."""

    def test_all_9_combinations_render_their_own_distinct_color_in_real_output(self):
        for base_template, color_variant, expected_primary in ALL_COMBINATIONS:
            design = InvoiceDesign.objects.create(
                user=self.user, name=f'{base_template}-{color_variant}', base_template=base_template,
                source='builtin', color_variant=color_variant,
            )
            invoice = self._invoice(status='created', design=design)
            InvoiceItem.objects.create(invoice=invoice, description='Work', quantity=Decimal('1'), unit_price=Decimal('100'))
            html = render_invoice_portal_html(invoice)
            self.assertIn(expected_primary, html, f'{base_template}/{color_variant}')

    def test_dynamic_renderer_path_also_reflects_the_real_color(self):
        """The dynamic design_renderer.py path (a genuinely edited design) must resolve colors identically to the static path — same build_pdf_context, same resolve_design_colors call."""
        import copy
        data = copy.deepcopy(PROFESSIONAL_DESIGN_DATA)
        data['zone_1']['elements'][0]['x'] = 30  # a real edit, clears the design_has_real_custom_data condition
        design = InvoiceDesign.objects.create(
            user=self.user, name='Edited burgundy', base_template='professional', source='custom',
            color_variant='burgundy', design_data=data,
        )
        invoice = self._invoice(status='created', design=design)
        InvoiceItem.objects.create(invoice=invoice, description='Work', quantity=Decimal('1'), unit_price=Decimal('100'))
        html = render_invoice_portal_html(invoice)
        self.assertIn('#8c3a4d', html)  # burgundy primary
        self.assertIn('left:30mm', html)  # confirms this really did go through the dynamic path, not the static one


class DraftLiveDefaultFallbackTests(InvoicesAPITestCase):
    """
    Item 0's own real, separate finding: a draft created BEFORE any
    default design existed (or before one was set) must still reflect
    the CURRENT default in its own live preview — never past draft,
    where the frozen-PDF guarantee means design must stay exactly what
    finalise resolved it to.
    """

    def test_a_pre_existing_design_less_draft_reflects_a_default_set_afterward(self):
        invoice = self._invoice(status='draft', design=None)
        InvoiceItem.objects.create(invoice=invoice, description='Work', quantity=Decimal('1'), unit_price=Decimal('100'))
        html_before = render_invoice_portal_html(invoice)
        self.assertIn('#a8813c', html_before)  # still the bare hardcoded default — no default design exists yet

        design = InvoiceDesign.objects.create(
            user=self.user, name='New default', base_template='minimal', source='builtin',
            color_variant='clay', is_default=True,
        )
        invoice.refresh_from_db()
        html_after = render_invoice_portal_html(invoice)
        self.assertIn('#a8663c', html_after)  # clay primary — the draft's OWN design_id is still None, but the live render now reflects the current default
        self.assertIsNone(Invoice.objects.get(pk=invoice.pk).design_id)  # never persisted — a pure read-time fallback

    def test_the_live_fallback_never_applies_past_draft(self):
        """A finalised (or beyond) invoice must NEVER pick up a default set afterward — the frozen-PDF guarantee."""
        invoice = self._invoice(status='created', design=None)
        InvoiceItem.objects.create(invoice=invoice, description='Work', quantity=Decimal('1'), unit_price=Decimal('100'))
        InvoiceDesign.objects.create(
            user=self.user, name='New default', base_template='minimal', source='builtin',
            color_variant='clay', is_default=True,
        )
        html = render_invoice_portal_html(invoice)
        self.assertIn('#a8813c', html)  # unchanged — still the bare default, never the new clay default
        self.assertNotIn('#a8663c', html)

    def test_the_live_fallback_never_applies_to_another_users_default(self):
        from apps.users.models import User
        other_user = User.objects.create_user(email='other-color-user@example.com', password='Sup3r$ecret1')
        InvoiceDesign.objects.create(
            user=other_user, name='Someone elses default', base_template='minimal', source='builtin',
            color_variant='clay', is_default=True,
        )
        invoice = self._invoice(status='draft', design=None)
        InvoiceItem.objects.create(invoice=invoice, description='Work', quantity=Decimal('1'), unit_price=Decimal('100'))
        html = render_invoice_portal_html(invoice)
        self.assertIn('#a8813c', html)
        self.assertNotIn('#a8663c', html)


class ItemZeroBrandNewInvoiceTests(InvoicesAPITestCase):
    """Item 0's own explicit verification: base_template selection genuinely works for a brand-new invoice created through the real API, with a real default design active."""

    def test_a_real_new_invoice_created_through_the_api_reflects_the_current_default_design(self):
        design = InvoiceDesign.objects.create(
            user=self.user, name='My Minimal', base_template='minimal', source='builtin',
            color_variant='slate', is_default=True,
        )
        resp = self._post(reverse('invoices:invoice_list'), {'client_name': 'Acme', 'client_email': 'acme@example.com'})
        self.assertEqual(resp.status_code, 201)
        invoice = Invoice.objects.get(pk=resp.json()['id'])
        self.assertEqual(invoice.design_id, design.pk)

        InvoiceItem.objects.create(invoice=invoice, description='Work', quantity=Decimal('1'), unit_price=Decimal('100'))
        pdf_bytes = render_invoice_pdf(invoice)
        self.assertTrue(pdf_bytes.startswith(b'%PDF'))
        html = render_invoice_portal_html(invoice)
        self.assertIn('#5b6b78', html)  # slate primary — real base_template AND real color, both correct for a brand-new invoice


class DesignPreviewEndpointTests(InvoicesAPITestCase):
    def test_builtin_preview_renders_real_html_for_every_combination(self):
        for base_template, color_variant, expected_primary in ALL_COMBINATIONS:
            resp = self._get(reverse('invoices:design_builtin_preview') + f'?base_template={base_template}&color_variant={color_variant}')
            self.assertEqual(resp.status_code, 200, f'{base_template}/{color_variant}')
            self.assertEqual(resp['Content-Type'], 'text/html')
            self.assertIn(expected_primary, resp.content.decode())
            self.assertIn('Callahan', resp.content.decode())  # real sample data, not empty

    def test_builtin_preview_rejects_an_unknown_base_template(self):
        resp = self._get(reverse('invoices:design_builtin_preview') + '?base_template=nonexistent')
        self.assertEqual(resp.status_code, 400)

    def test_builtin_preview_requires_authentication(self):
        self.client.cookies.clear()
        resp = self._get(reverse('invoices:design_builtin_preview') + '?base_template=professional')
        self.assertEqual(resp.status_code, 401)

    def test_builtin_preview_uses_the_requesting_users_own_real_profile(self):
        self.user.profile.business_name = 'Real Business Name Inc'
        self.user.profile.save()
        resp = self._get(reverse('invoices:design_builtin_preview') + '?base_template=professional&color_variant=default')
        self.assertIn('Real Business Name Inc', resp.content.decode())

    def test_saved_design_preview_renders_via_the_real_design(self):
        design = InvoiceDesign.objects.create(
            user=self.user, name='My design', base_template='modern', source='builtin', color_variant='plum',
        )
        resp = self._get(reverse('invoices:design_preview', kwargs={'pk': design.pk}))
        self.assertEqual(resp.status_code, 200)
        self.assertIn('#4a2d5e', resp.content.decode())  # plum primary

    def test_saved_design_preview_never_reachable_for_another_users_design(self):
        from apps.users.models import User
        other_user = User.objects.create_user(email='other-preview-user@example.com', password='Sup3r$ecret1')
        design = InvoiceDesign.objects.create(user=other_user, name='Not yours', base_template='professional', source='builtin')
        resp = self._get(reverse('invoices:design_preview', kwargs={'pk': design.pk}))
        self.assertEqual(resp.status_code, 404)

    def test_saved_design_preview_routes_a_real_edit_through_the_dynamic_renderer(self):
        import copy
        data = copy.deepcopy(PROFESSIONAL_DESIGN_DATA)
        data['zone_1']['elements'][0]['x'] = 55
        design = InvoiceDesign.objects.create(
            user=self.user, name='Edited', base_template='professional', source='custom', design_data=data,
        )
        resp = self._get(reverse('invoices:design_preview', kwargs={'pk': design.pk}))
        self.assertIn('left:55mm', resp.content.decode())

    def test_preview_endpoints_are_not_blocked_by_clickjacking_protection(self):
        """The whole point of these endpoints is to be embedded in an <iframe> — X-Frame-Options must not be DENY here, matching invoice_preview_as_client's own established @xframe_options_exempt precedent."""
        resp = self._get(reverse('invoices:design_builtin_preview') + '?base_template=professional')
        self.assertNotEqual(resp.get('X-Frame-Options'), 'DENY')

        design = InvoiceDesign.objects.create(user=self.user, name='X', base_template='minimal', source='builtin')
        resp2 = self._get(reverse('invoices:design_preview', kwargs={'pk': design.pk}))
        self.assertNotEqual(resp2.get('X-Frame-Options'), 'DENY')
