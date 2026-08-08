# apps/invoices/tests/test_new_models.py
"""
Lighter coverage for the models with no complex business logic to port —
InvoiceComment/PaymentClaim (straightforward CRUD) and InvoiceDesign/
InvoicePreset (whose only real logic, the is_default-enforcement save(),
is ported structurally from v1's InvoiceTemplate.save() and IS worth
testing directly).
"""
from datetime import date
from decimal import Decimal

from django.test import TestCase

from apps.invoices.models import (
    Invoice, InvoiceComment, InvoiceDesign, InvoicePreset, InvoicePresetItem, PaymentClaim,
)
from apps.invoices.tests.test_models import make_invoice
from apps.users.models import User


class InvoiceCommentTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(email='freelancer@example.com', password='Sup3r$ecret1')
        self.invoice = make_invoice(self.user)

    def test_create_freelancer_comment(self):
        comment = InvoiceComment.objects.create(
            invoice=self.invoice, author_type='freelancer', author_user=self.user,
            source='app', body_text='Thanks for your business!',
        )
        self.assertEqual(self.invoice.comments.count(), 1)
        self.assertEqual(comment.author_user, self.user)

    def test_create_client_comment_with_snapshot_fields(self):
        comment = InvoiceComment.objects.create(
            invoice=self.invoice, author_type='client', client_name='Acme Co', client_email='acme@example.com',
            source='portal', body_text='When is this due?',
        )
        self.assertIsNone(comment.author_user)
        self.assertEqual(comment.client_email, 'acme@example.com')

    def test_deleting_comment_author_sets_null_not_cascade(self):
        """
        author_user is SET_NULL per the spec, so a comment survives its
        author's account being anonymized/deleted — deliberately using a
        DIFFERENT user than the invoice's own owner here, since deleting
        the invoice's owner would CASCADE the invoice (and take the
        comment with it) before SET_NULL on author_user ever mattered.
        """
        commenter = User.objects.create_user(email='commenter@example.com', password='Sup3r$ecret1')
        comment = InvoiceComment.objects.create(
            invoice=self.invoice, author_type='freelancer', author_user=commenter,
            source='app', body_text='Note.',
        )
        commenter.delete()
        comment.refresh_from_db()
        self.assertIsNone(comment.author_user_id)
        self.assertTrue(InvoiceComment.objects.filter(pk=comment.pk).exists())


class PaymentClaimTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(email='freelancer@example.com', password='Sup3r$ecret1')
        self.invoice = make_invoice(self.user, total=Decimal('100.00'))

    def test_create_claim_defaults_to_pending(self):
        claim = PaymentClaim.objects.create(
            invoice=self.invoice, client_email='acme@example.com', amount_claimed=Decimal('100.00'),
            payment_date=date.today(),
        )
        self.assertEqual(claim.status, 'pending')
        self.assertIsNone(claim.reviewed_at)

    def test_deleting_invoice_cascades_to_claims(self):
        PaymentClaim.objects.create(
            invoice=self.invoice, client_email='acme@example.com', amount_claimed=Decimal('100.00'),
            payment_date=date.today(),
        )
        invoice_id = self.invoice.pk
        self.invoice.delete()
        self.assertEqual(PaymentClaim.objects.filter(invoice_id=invoice_id).count(), 0)


class InvoiceDesignTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(email='freelancer@example.com', password='Sup3r$ecret1')

    def test_only_one_default_design_per_user(self):
        first = InvoiceDesign.objects.create(user=self.user, name='First', base_template='professional', is_default=True)
        second = InvoiceDesign.objects.create(user=self.user, name='Second', base_template='minimal', is_default=True)
        first.refresh_from_db()
        self.assertFalse(first.is_default)
        self.assertTrue(second.is_default)

    def test_default_design_is_scoped_per_user(self):
        other_user = User.objects.create_user(email='other@example.com', password='Sup3r$ecret1')
        mine = InvoiceDesign.objects.create(user=self.user, name='Mine', base_template='professional', is_default=True)
        InvoiceDesign.objects.create(user=other_user, name='Theirs', base_template='modern', is_default=True)
        mine.refresh_from_db()
        self.assertTrue(mine.is_default)  # unaffected by the other user's default


class InvoicePresetTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(email='freelancer@example.com', password='Sup3r$ecret1')

    def test_only_one_default_preset_per_user(self):
        first = InvoicePreset.objects.create(user=self.user, name='Web Dev', is_default=True)
        second = InvoicePreset.objects.create(user=self.user, name='Consulting', is_default=True)
        first.refresh_from_db()
        self.assertFalse(first.is_default)
        self.assertTrue(second.is_default)

    def test_preset_items_cascade_on_preset_delete(self):
        preset = InvoicePreset.objects.create(user=self.user, name='Web Dev')
        InvoicePresetItem.objects.create(preset=preset, description='Design', unit_price=Decimal('500.00'))
        preset_id = preset.pk
        preset.delete()
        self.assertEqual(InvoicePresetItem.objects.filter(preset_id=preset_id).count(), 0)

    def test_preset_survives_client_deletion(self):
        from apps.clients.models import Client
        client = Client.objects.create(user=self.user, name='Acme', email='acme@example.com')
        preset = InvoicePreset.objects.create(user=self.user, name='Acme Default', include_client=True, client=client)
        client.delete()
        preset.refresh_from_db()
        self.assertIsNone(preset.client_id)
