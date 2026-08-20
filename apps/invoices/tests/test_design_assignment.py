# apps/invoices/tests/test_design_assignment.py
"""
SEV1 fix, 19 August 2026 — a real, live-browser-verified report: "NOTHING
in the design editor actually works." Root-caused to something upstream
of PDF-001's own renderer (which was itself proven correct, live, when
invoice.design_id was set manually): Invoice.design was NEVER assigned by
ANY code path in the real application — not the wizard, not autosave, not
finalise, nothing. InvoiceDesign.is_default (the "Set as default" star in
DesignGallery.jsx) was write-only — set, never read. Confirmed directly
against real production data before this fix: 82 real invoices, 0 with
design_id set, 13 real InvoiceDesign rows, 0 referenced by any invoice.

This file covers the real fix: invoice_create assigns the user's current
default design at creation time; _finalise_invoice backfills it for any
pre-existing draft that predates this fix; _duplicate_invoice_core carries
a design forward like every other copied field. See DECISIONS.md's 19
August 2026 "design assignment gap" entry for the full investigation,
including the real live-browser proof that Step 8b's own drag/save/reload
and the PDF-001 renderer were BOTH already working correctly — this was
never a regression in either, just a missing connection between them.
"""
from decimal import Decimal

from django.urls import reverse

from apps.invoices.design_seeds import PROFESSIONAL_DESIGN_DATA
from apps.invoices.models import Invoice, InvoiceDesign, InvoiceItem
from apps.invoices.tests.test_views import InvoicesAPITestCase


class InvoiceCreateDefaultDesignTests(InvoicesAPITestCase):
    def test_create_assigns_the_users_default_design(self):
        design = InvoiceDesign.objects.create(
            user=self.user, name='My Default', base_template='minimal', source='builtin',
            design_data=PROFESSIONAL_DESIGN_DATA, is_default=True,
        )
        resp = self._post(reverse('invoices:invoice_list'), {'client_name': 'Acme', 'client_email': 'acme@example.com'})
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.json()['design'], str(design.pk))
        invoice = Invoice.objects.get(pk=resp.json()['id'])
        self.assertEqual(invoice.design_id, design.pk)

    def test_create_leaves_design_null_when_the_user_has_no_default(self):
        InvoiceDesign.objects.create(
            user=self.user, name='Not default', base_template='minimal', source='builtin',
            design_data=PROFESSIONAL_DESIGN_DATA, is_default=False,
        )
        resp = self._post(reverse('invoices:invoice_list'), {'client_name': 'Acme', 'client_email': 'acme@example.com'})
        self.assertEqual(resp.status_code, 201)
        self.assertIsNone(resp.json()['design'])

    def test_create_never_picks_up_another_users_default_design(self):
        from apps.users.models import User
        other_user = User.objects.create_user(email='other-design@example.com', password='Sup3r$ecret1')
        InvoiceDesign.objects.create(
            user=other_user, name='Someone elses default', base_template='minimal', source='builtin',
            design_data=PROFESSIONAL_DESIGN_DATA, is_default=True,
        )
        resp = self._post(reverse('invoices:invoice_list'), {'client_name': 'Acme', 'client_email': 'acme@example.com'})
        self.assertEqual(resp.status_code, 201)
        self.assertIsNone(resp.json()['design'])

    def test_a_client_cannot_pass_an_arbitrary_design_id_directly(self):
        """`design` is deliberately absent from InvoiceSerializer's own writable fields — only the server's own default-design lookup may set it."""
        design = InvoiceDesign.objects.create(
            user=self.user, name='Real design', base_template='minimal', source='builtin',
            design_data=PROFESSIONAL_DESIGN_DATA, is_default=False,
        )
        resp = self._post(reverse('invoices:invoice_list'), {
            'client_name': 'Acme', 'client_email': 'acme@example.com', 'design': str(design.pk),
        })
        self.assertEqual(resp.status_code, 201)
        self.assertIsNone(resp.json()['design'])  # not the default, and the client-supplied value was ignored


class FinaliseDesignBackfillTests(InvoicesAPITestCase):
    """The defensive fallback for drafts created before this fix — every real draft in the database as of 19 August 2026 needed exactly this."""

    def test_finalise_backfills_a_default_design_for_a_pre_existing_design_less_draft(self):
        design = InvoiceDesign.objects.create(
            user=self.user, name='Set after the draft existed', base_template='minimal', source='builtin',
            design_data=PROFESSIONAL_DESIGN_DATA, is_default=True,
        )
        # Simulates a real pre-fix draft: created directly (bypassing invoice_create's own new default-lookup), design_id genuinely None.
        invoice = self._invoice(status='draft', invoice_number=None, design=None)
        InvoiceItem.objects.create(invoice=invoice, description='Work', quantity=Decimal('1'), unit_price=Decimal('100'))

        resp = self._post(reverse('invoices:invoice_finalise', kwargs={'pk': invoice.pk}))
        self.assertEqual(resp.status_code, 200)
        invoice.refresh_from_db()
        self.assertEqual(invoice.design_id, design.pk)

    def test_finalise_never_overrides_an_already_assigned_design(self):
        default_design = InvoiceDesign.objects.create(
            user=self.user, name='Current default', base_template='minimal', source='builtin',
            design_data=PROFESSIONAL_DESIGN_DATA, is_default=True,
        )
        earlier_design = InvoiceDesign.objects.create(
            user=self.user, name='Chosen earlier', base_template='professional', source='custom',
            design_data=PROFESSIONAL_DESIGN_DATA, is_default=False,
        )
        invoice = self._invoice(status='draft', invoice_number=None, design=earlier_design)
        InvoiceItem.objects.create(invoice=invoice, description='Work', quantity=Decimal('1'), unit_price=Decimal('100'))

        self._post(reverse('invoices:invoice_finalise', kwargs={'pk': invoice.pk}))
        invoice.refresh_from_db()
        self.assertEqual(invoice.design_id, earlier_design.pk)  # untouched — never silently swapped to the current default
        self.assertNotEqual(invoice.design_id, default_design.pk)

    def test_finalise_leaves_design_null_when_no_default_exists_either(self):
        invoice = self._invoice(status='draft', invoice_number=None, design=None)
        InvoiceItem.objects.create(invoice=invoice, description='Work', quantity=Decimal('1'), unit_price=Decimal('100'))
        self._post(reverse('invoices:invoice_finalise', kwargs={'pk': invoice.pk}))
        invoice.refresh_from_db()
        self.assertIsNone(invoice.design_id)


class DuplicateCarriesDesignForwardTests(InvoicesAPITestCase):
    def test_duplicate_carries_the_originals_design_forward(self):
        design = InvoiceDesign.objects.create(
            user=self.user, name='On the original', base_template='minimal', source='custom',
            design_data=PROFESSIONAL_DESIGN_DATA,
        )
        original = self._invoice(status='sent', sent_at='2026-08-01T00:00:00Z', design=design)
        resp = self._post(reverse('invoices:invoice_duplicate', kwargs={'pk': original.pk}))
        self.assertEqual(resp.status_code, 201)
        new_invoice = Invoice.objects.get(pk=resp.json()['id'])
        self.assertEqual(new_invoice.design_id, design.pk)

    def test_duplicate_of_a_design_less_invoice_stays_design_less(self):
        original = self._invoice(status='sent', sent_at='2026-08-01T00:00:00Z', design=None)
        resp = self._post(reverse('invoices:invoice_duplicate', kwargs={'pk': original.pk}))
        new_invoice = Invoice.objects.get(pk=resp.json()['id'])
        self.assertIsNone(new_invoice.design_id)


class RecurringGenerationStillReadsRootDesignLiveTests(InvoicesAPITestCase):
    """
    Regression guard for Step 16's own established design decision (series
    settings, including `design`, are read LIVE from the recurring root at
    generation time — see generate_recurring_invoices' own docstring,
    tasks.py). _duplicate_invoice_core's new `design=original.design`
    default must never fight that explicit override — `defaults.update
    (overrides)` already makes an explicit kwarg win, this proves it still
    does after this pass's change.
    """

    def test_generated_child_uses_the_roots_current_design_not_a_stale_default(self):
        from datetime import date
        from apps.invoices.tasks import generate_recurring_invoices

        default_design = InvoiceDesign.objects.create(
            user=self.user, name='Stale default', base_template='professional', source='builtin',
            design_data=PROFESSIONAL_DESIGN_DATA, is_default=True,
        )
        root_design = InvoiceDesign.objects.create(
            user=self.user, name='Root series design', base_template='minimal', source='custom',
            design_data=PROFESSIONAL_DESIGN_DATA, is_default=False,
        )
        root = self._invoice(
            status='sent', sent_at='2026-01-01T00:00:00Z', is_recurring=True, recurring_interval_days=7,
            next_recurring_date=date(2026, 1, 1), due_date=date(2026, 1, 15), issue_date=date(2026, 1, 1),
            design=root_design,
        )
        InvoiceItem.objects.create(invoice=root, description='Retainer', quantity=Decimal('1'), unit_price=Decimal('100'))

        generate_recurring_invoices()
        child = Invoice.objects.get(parent_invoice=root)
        self.assertEqual(child.design_id, root_design.pk)
        self.assertNotEqual(child.design_id, default_design.pk)
