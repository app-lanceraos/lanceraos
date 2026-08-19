# apps/invoices/tests/test_audit_trail.py
"""
Regression coverage for LANCERAOS_CLIENTS_INVOICES_PRODUCTION_AUDIT.md
(19 August 2026), finding INV-002: InvoiceCreated/InvoiceFinalised/
InvoicePaid/InvoicePartiallyPaid/InvoiceCancelled/InvoiceRefunded/
InvoiceMarkedBadDebt/InvoiceResent were all emitted from views.py with
zero registered @on(...) handlers in apps/invoices/notifications.py —
core.events.emit() only writes an AuditLog row when a handler is
registered, so none of these 8 real lifecycle events left any forensic
trail. Live-reproduced by the audit: a full real lifecycle (finalise,
mark-sent, mark-paid, cancel, refund, bad-debt, several partial
payments) produced exactly ONE AuditLog event type (invoice_sent).

This file reconstructs that exact scenario — the same 8 real actions —
against real test fixtures, then queries core.models.AuditLog directly
(not the notification bell, not a mock) and confirms every one of them
now has a real row.
"""
from datetime import date
from decimal import Decimal

from django.urls import reverse
from django.utils import timezone

from core.models import AuditLog

from apps.invoices.models import Invoice, InvoiceItem
from apps.invoices.tests.test_models import make_invoice
from apps.invoices.tests.test_views import InvoicesAPITestCase


class AuditLogHandlersWiredTests(InvoicesAPITestCase):
    def _latest_event(self, event, invoice_id=None):
        qs = AuditLog.objects.filter(user=self.user, event=event)
        if invoice_id is not None:
            # Scoped by invoice_id in the query itself, not just asserted
            # after the fact — several invoices in this test can share
            # the same event type (e.g. two 'invoice_paid' rows), so
            # merely taking the overall latest of that event type could
            # silently grab the WRONG invoice's row.
            qs = qs.filter(metadata__invoice_id=str(invoice_id))
        return qs.latest('created_at')

    def test_full_real_lifecycle_writes_a_real_auditlog_row_for_every_action(self):
        """
        The audit's own exact reproduction, all 8 previously-silent
        events plus the one that already worked (invoice_sent, included
        here as a control — it must still work, not just the newly-fixed
        ones).
        """
        # 1. Create.
        invoice = self._invoice(status='draft', invoice_number=None, total=Decimal('1000.00'))
        InvoiceItem.objects.create(invoice=invoice, description='Work', quantity=Decimal('1'), unit_price=Decimal('1000.00'))
        # make_invoice creates directly via the model, not the API — fire
        # a real API create too, so InvoiceCreated is exercised for real.
        created_resp = self._post(reverse('invoices:invoice_list'), {
            'currency': 'USD', 'due_date': '2026-12-31',
            'client_name': 'Audit Trail Co', 'client_email': 'audit@example.com',
            'items': [{'description': 'Line item', 'quantity': '1', 'unit_price': '50.00'}],
        })
        self.assertEqual(created_resp.status_code, 201)
        created_invoice_id = created_resp.json()['id']

        # 2. Finalise.
        resp = self._post(reverse('invoices:invoice_finalise', kwargs={'pk': invoice.pk}))
        self.assertEqual(resp.status_code, 200)

        # 3. Mark sent (control — already worked before this fix).
        resp = self._post(reverse('invoices:invoice_mark_sent', kwargs={'pk': invoice.pk}), {'confirm': True})
        self.assertEqual(resp.status_code, 200)

        # 4. Mark paid.
        resp = self._post(reverse('invoices:invoice_mark_paid', kwargs={'pk': invoice.pk}), {'source': 'bank'})
        self.assertEqual(resp.status_code, 200)

        # 5. A separate invoice for cancel.
        cancel_invoice = self._invoice(status='sent', sent_at=timezone.now(), total=Decimal('200.00'))
        resp = self._post(reverse('invoices:invoice_cancel', kwargs={'pk': cancel_invoice.pk}))
        self.assertEqual(resp.status_code, 200)

        # 6. A separate invoice for refund (paid, then partially refunded).
        refund_invoice = self._invoice(status='sent', sent_at=timezone.now(), total=Decimal('300.00'))
        self._post(reverse('invoices:invoice_mark_paid', kwargs={'pk': refund_invoice.pk}), {'source': 'bank'})
        resp = self._post(reverse('invoices:invoice_refund', kwargs={'pk': refund_invoice.pk}), {'amount': '100.00'})
        self.assertEqual(resp.status_code, 200)

        # 7. A separate invoice for bad debt.
        bad_debt_invoice = self._invoice(status='sent', sent_at=timezone.now(), total=Decimal('400.00'))
        resp = self._post(reverse('invoices:invoice_mark_bad_debt', kwargs={'pk': bad_debt_invoice.pk}))
        self.assertEqual(resp.status_code, 200)

        # 8. A separate invoice for a partial payment (InvoicePartiallyPaid, distinct from InvoicePaid above).
        partial_invoice = self._invoice(status='sent', sent_at=timezone.now(), total=Decimal('500.00'))
        resp = self._post(reverse('invoices:invoice_add_payment', kwargs={'pk': partial_invoice.pk}), {
            'amount': '150.00', 'payment_date': str(date.today()),
        })
        self.assertEqual(resp.status_code, 201)

        # Now the exact live scenario the audit ran and found nothing for.
        self._latest_event('invoice_sent', invoice.pk)  # control — already worked
        self._latest_event('invoice_created', created_invoice_id)
        self._latest_event('invoice_finalised', invoice.pk)
        self._latest_event('invoice_paid', invoice.pk)
        self._latest_event('invoice_cancelled', cancel_invoice.pk)
        self._latest_event('invoice_refunded', refund_invoice.pk)
        self._latest_event('invoice_marked_bad_debt', bad_debt_invoice.pk)
        self._latest_event('invoice_partially_paid', partial_invoice.pk)

        # Not just "a row exists" — the fields a real audit-log viewer
        # needs: who (user), which invoice (metadata.invoice_id), when
        # (created_at, implicit on every row).
        refund_log = self._latest_event('invoice_refunded', refund_invoice.pk)
        self.assertEqual(refund_log.user, self.user)
        self.assertIsNotNone(refund_log.created_at)
        self.assertEqual(refund_log.metadata.get('amount'), '100.00')

    def test_invoice_created_captures_duplicated_from(self):
        original = self._invoice(status='sent', sent_at=timezone.now(), total=Decimal('100.00'))
        resp = self._post(reverse('invoices:invoice_duplicate', kwargs={'pk': original.pk}))
        self.assertEqual(resp.status_code, 201)
        new_id = resp.json()['id']

        log = AuditLog.objects.filter(user=self.user, event='invoice_created', metadata__invoice_id=new_id).latest('created_at')
        self.assertEqual(log.metadata.get('duplicated_from'), str(original.pk))

    def test_invoice_resent_writes_a_real_row(self):
        from unittest.mock import patch

        invoice = self._invoice(
            status='sent', sent_at=timezone.now(), sent_via_platform=True, total=Decimal('250.00'),
            client_email='client@example.com',
        )
        with patch('apps.invoices.views.fetch_invoice_pdf_bytes', return_value=b'%PDF-fake'), \
             patch('apps.invoices.views.send_invoice_related_email', return_value={
                 'sent': True, 'sent_via': 'resend', 'fallback_used': False, 'error': None,
             }):
            resp = self._post(reverse('invoices:invoice_resend', kwargs={'pk': invoice.pk}), {'confirm': True})
        self.assertEqual(resp.status_code, 200, resp.content)

        self._latest_event('invoice_resent', invoice.pk)

    def test_handler_does_not_crash_or_write_a_row_for_a_nonexistent_user_id(self):
        """
        Defensive: a handler encountering a user_id that no longer
        resolves (e.g. a genuinely stale/racy id) must warn and return,
        never raise — matching _record_invoice_sent's own established
        behavior for this exact edge case.
        """
        from core.events import emit

        before = AuditLog.objects.filter(event='invoice_cancelled').count()
        emit('InvoiceCancelled', invoice_id='00000000-0000-0000-0000-000000000000', user_id='00000000-0000-0000-0000-000000000000')
        after = AuditLog.objects.filter(event='invoice_cancelled').count()
        self.assertEqual(before, after)
