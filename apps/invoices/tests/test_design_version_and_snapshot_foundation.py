# apps/invoices/tests/test_design_version_and_snapshot_foundation.py
"""
Template Builder 2.0, Phase 0 — tests for the two new, purely additive
database structures: InvoiceDesignVersion (the versioning foundation)
and Invoice.rendered_design_snapshot (the finalized-invoice provenance
foundation). Both exist as inert scaffolding in this phase — these tests
prove the tables/fields work AND, just as importantly, prove nothing in
the existing application actually writes to them yet.
"""
from decimal import Decimal

from django.db import IntegrityError
from django.test import TestCase
from django.urls import reverse

from apps.invoices.design_seeds import PROFESSIONAL_DESIGN_DATA
from apps.invoices.models import InvoiceDesign, InvoiceDesignVersion, InvoiceItem
from apps.invoices.tests.test_models import make_invoice
from apps.invoices.tests.test_views import InvoicesAPITestCase


class InvoiceDesignVersionModelTests(TestCase):
    """The model itself works — creation, __str__, ordering, uniqueness, cascade."""

    def setUp(self):
        from apps.users.models import User
        self.user = User.objects.create_user(email='version-foundation@example.com', password='Sup3r$ecret1')
        self.design = InvoiceDesign.objects.create(
            user=self.user, name='My Design', base_template='professional', source='custom',
            design_data=PROFESSIONAL_DESIGN_DATA,
        )
        # Master Blueprint cutover: InvoiceDesign.save() now auto-creates a
        # real version 1 on this very create() call above (see
        # InvoiceDesignVersionRealWritePathTests below for that behavior's
        # own dedicated coverage) — cleared here so THIS class's tests
        # (raw model CRUD/constraints/cascade, independent of the
        # save-triggered auto-versioning) start from a clean slate, same
        # as before that behavior existed.
        InvoiceDesignVersion.objects.filter(design=self.design).delete()

    def test_can_create_a_version_row(self):
        version = InvoiceDesignVersion.objects.create(
            design=self.design, version_number=1, design_data=PROFESSIONAL_DESIGN_DATA,
        )
        self.assertEqual(version.design_id, self.design.pk)
        self.assertEqual(version.version_number, 1)

    def test_str_is_human_readable(self):
        version = InvoiceDesignVersion.objects.create(
            design=self.design, version_number=3, design_data=PROFESSIONAL_DESIGN_DATA,
        )
        self.assertIn('My Design', str(version))
        self.assertIn('3', str(version))

    def test_version_number_unique_per_design(self):
        InvoiceDesignVersion.objects.create(design=self.design, version_number=1, design_data={})
        with self.assertRaises(IntegrityError):
            InvoiceDesignVersion.objects.create(design=self.design, version_number=1, design_data={})

    def test_same_version_number_allowed_across_different_designs(self):
        other_design = InvoiceDesign.objects.create(
            user=self.user, name='Another Design', base_template='minimal', source='custom',
            design_data=PROFESSIONAL_DESIGN_DATA,
        )
        InvoiceDesignVersion.objects.filter(design=other_design).delete()  # same auto-version-1 clear as setUp
        InvoiceDesignVersion.objects.create(design=self.design, version_number=1, design_data={})
        # Must not raise — uniqueness is (design, version_number) together, not version_number alone.
        InvoiceDesignVersion.objects.create(design=other_design, version_number=1, design_data={})

    def test_deleting_the_parent_design_cascades_to_its_versions(self):
        InvoiceDesignVersion.objects.create(design=self.design, version_number=1, design_data={})
        design_pk = self.design.pk
        self.design.delete()
        self.assertEqual(InvoiceDesignVersion.objects.filter(design_id=design_pk).count(), 0)

    def test_design_data_snapshot_is_stored_verbatim(self):
        version = InvoiceDesignVersion.objects.create(
            design=self.design, version_number=1, design_data=PROFESSIONAL_DESIGN_DATA,
        )
        version.refresh_from_db()
        self.assertEqual(version.design_data, PROFESSIONAL_DESIGN_DATA)


class InvoiceDesignVersionRealWritePathTests(TestCase):
    """
    Master Blueprint cutover — InvoiceDesign.save()'s own real version-
    write path (_create_version_if_content_changed). A genuine content
    change (including the very first save of a brand-new design) creates
    a real, new version; a content-unrelated save (a plain rename, an
    is_default flip) does NOT — proving this isn't a naive "version on
    every save" that would bloat real history with byte-identical
    duplicates.
    """

    def setUp(self):
        from apps.users.models import User
        self.user = User.objects.create_user(email='real-version@example.com', password='Sup3r$ecret1')

    def test_creating_a_design_writes_a_real_version_1(self):
        design = InvoiceDesign.objects.create(
            user=self.user, name='A Design', base_template='professional', source='custom',
            design_data=PROFESSIONAL_DESIGN_DATA,
        )
        versions = list(InvoiceDesignVersion.objects.filter(design=design).order_by('version_number'))
        self.assertEqual(len(versions), 1)
        self.assertEqual(versions[0].version_number, 1)
        self.assertEqual(versions[0].design_data, PROFESSIONAL_DESIGN_DATA)

    def test_a_real_content_change_creates_a_new_version(self):
        design = InvoiceDesign.objects.create(
            user=self.user, name='A Design', base_template='professional', source='custom',
            design_data=PROFESSIONAL_DESIGN_DATA,
        )
        edited = {**PROFESSIONAL_DESIGN_DATA, 'zone_1': {'elements': []}}
        design.design_data = edited
        design.save()
        versions = list(InvoiceDesignVersion.objects.filter(design=design).order_by('version_number'))
        self.assertEqual(len(versions), 2)
        self.assertEqual(versions[1].version_number, 2)
        self.assertEqual(versions[1].design_data, edited)

    def test_renaming_a_design_does_not_create_a_new_version(self):
        design = InvoiceDesign.objects.create(
            user=self.user, name='Original Name', base_template='professional', source='custom',
            design_data=PROFESSIONAL_DESIGN_DATA,
        )
        design.name = 'Renamed'
        design.save()
        self.assertEqual(InvoiceDesignVersion.objects.filter(design=design).count(), 1)

    def test_setting_a_design_as_default_does_not_create_a_new_version(self):
        design = InvoiceDesign.objects.create(
            user=self.user, name='A Design', base_template='professional', source='custom',
            design_data=PROFESSIONAL_DESIGN_DATA,
        )
        design.is_default = True
        design.save()
        self.assertEqual(InvoiceDesignVersion.objects.filter(design=design).count(), 1)

    def test_saving_a_design_through_the_real_api_creates_a_real_version_on_content_change(self):
        design = InvoiceDesign.objects.create(
            user=self.user, name='Untouched by versioning', base_template='professional', source='custom',
            design_data=PROFESSIONAL_DESIGN_DATA,
        )
        edited = {**PROFESSIONAL_DESIGN_DATA, 'zone_1': {'elements': []}}
        design.design_data = edited
        design.save()
        self.assertEqual(InvoiceDesignVersion.objects.filter(design=design).count(), 2)


class InvoiceRenderedDesignSnapshotFieldTests(TestCase):
    """The field itself: exists, nullable, defaults to None."""

    def setUp(self):
        from apps.users.models import User
        self.user = User.objects.create_user(email='snapshot-foundation@example.com', password='Sup3r$ecret1')

    def test_new_invoice_has_null_snapshot_by_default(self):
        invoice = make_invoice(self.user)
        self.assertIsNone(invoice.rendered_design_snapshot)

    def test_field_accepts_a_real_json_value_when_explicitly_set(self):
        invoice = make_invoice(self.user)
        invoice.rendered_design_snapshot = {'schema_version': 2, 'page': {}}
        invoice.save(update_fields=['rendered_design_snapshot'])
        invoice.refresh_from_db()
        self.assertEqual(invoice.rendered_design_snapshot, {'schema_version': 2, 'page': {}})


class RenderedDesignSnapshotRealWritePathTests(InvoicesAPITestCase):
    """
    Master Blueprint cutover — the real TB-007 provenance fix. Finalizing
    a real invoice through the real, existing /finalise/ endpoint now
    captures a real, self-contained snapshot (base_template +
    color_variant + design_data) of whatever design was resolved for it,
    at the exact moment it leaves draft — see pdf_generator.py's own
    _effective_design/_FrozenDesignSnapshot for the read side.
    """

    def test_finalising_a_draft_invoice_populates_the_snapshot_field(self):
        design = InvoiceDesign.objects.create(
            user=self.user, name='Finalise Test Design', base_template='professional', source='builtin',
            color_variant='ink', design_data=PROFESSIONAL_DESIGN_DATA, is_default=True,
        )
        invoice = self._invoice(status='draft', invoice_number=None, design=design)
        InvoiceItem.objects.create(invoice=invoice, description='Work', quantity=Decimal('1'), unit_price=Decimal('100'))

        resp = self._post(reverse('invoices:invoice_finalise', kwargs={'pk': invoice.pk}))
        self.assertEqual(resp.status_code, 200)

        invoice.refresh_from_db()
        self.assertEqual(invoice.status, 'created')  # confirms finalise really ran
        self.assertIsNotNone(invoice.rendered_design_snapshot)
        self.assertEqual(invoice.rendered_design_snapshot['base_template'], 'professional')
        self.assertEqual(invoice.rendered_design_snapshot['color_variant'], 'ink')
        self.assertEqual(invoice.rendered_design_snapshot['design_data'], PROFESSIONAL_DESIGN_DATA)

    def test_deleting_the_design_after_finalise_does_not_affect_the_already_finalised_invoice(self):
        # The real, direct TB-007 regression test: a real invoice
        # already in this project's own dev database has design_id=NULL
        # today because deleting a design SET_NULLs the live FK with no
        # provenance ever captured — this proves the fix.
        design = InvoiceDesign.objects.create(
            user=self.user, name='Finalise Test Design', base_template='minimal', source='builtin',
            design_data=PROFESSIONAL_DESIGN_DATA, is_default=True,
        )
        invoice = self._invoice(status='draft', invoice_number=None, design=design)
        InvoiceItem.objects.create(invoice=invoice, description='Work', quantity=Decimal('1'), unit_price=Decimal('100'))
        self._post(reverse('invoices:invoice_finalise', kwargs={'pk': invoice.pk}))
        invoice.refresh_from_db()

        design.delete()
        invoice.refresh_from_db()
        self.assertIsNone(invoice.design_id)  # the live FK really is nulled (unchanged, existing SET_NULL behavior)
        self.assertIsNotNone(invoice.rendered_design_snapshot)  # but the snapshot survives, untouched
        self.assertEqual(invoice.rendered_design_snapshot['base_template'], 'minimal')

    def test_editing_the_design_after_finalise_does_not_affect_the_already_finalised_invoice(self):
        design = InvoiceDesign.objects.create(
            user=self.user, name='Finalise Test Design', base_template='professional', source='builtin',
            design_data=PROFESSIONAL_DESIGN_DATA, is_default=True,
        )
        invoice = self._invoice(status='draft', invoice_number=None, design=design)
        InvoiceItem.objects.create(invoice=invoice, description='Work', quantity=Decimal('1'), unit_price=Decimal('100'))
        self._post(reverse('invoices:invoice_finalise', kwargs={'pk': invoice.pk}))
        invoice.refresh_from_db()

        design.design_data = {**PROFESSIONAL_DESIGN_DATA, 'zone_1': {'elements': []}}
        design.save()

        from apps.invoices.pdf_generator import _effective_design
        resolved = _effective_design(invoice)
        self.assertEqual(resolved.design_data, PROFESSIONAL_DESIGN_DATA)  # the frozen snapshot, not the just-edited live design
