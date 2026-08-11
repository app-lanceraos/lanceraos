# apps/invoices/management/commands/backfill_invoice_pdf_public_ids.py
"""
One-time backfill for invoices frozen before Invoice.pdf_public_id
existed. Re-runs store_invoice_pdf for every invoice with a non-blank
pdf_url and a blank pdf_public_id, persisting the new field.

Honest about what this does and doesn't fix: re-uploading does NOT make
the resulting secure_url reachable — this account has a confirmed
account-level Cloudinary ACL restriction on raw/PDF delivery (every real
GET against a raw-resource PDF returns 401 with `x-cld-error: deny or
ACL failure`, verified directly, independent of access_mode/signing/
upload parameters — see DECISIONS.md). This command only backfills the
public_id column so a future re-upload (once that Console setting is
fixed) can target/overwrite the same asset instead of orphaning it. It
does not and cannot fix the 401 itself.
"""
import logging

from django.core.management.base import BaseCommand

from apps.invoices.models import Invoice
from apps.invoices.pdf_generator import store_invoice_pdf

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = 'Backfills Invoice.pdf_public_id for invoices frozen before that field existed.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run', action='store_true',
            help='List affected invoices without re-uploading or saving anything.',
        )

    def handle(self, *args, **options):
        dry_run = options['dry_run']
        targets = Invoice.objects.exclude(pdf_url='').filter(pdf_public_id='')
        count = targets.count()
        self.stdout.write(f'Found {count} invoice(s) with pdf_url set and pdf_public_id blank.')

        if count == 0:
            return

        if dry_run:
            for invoice in targets:
                self.stdout.write(f'  [dry-run] {invoice.invoice_number or invoice.pk} — pdf_url={invoice.pdf_url}')
            return

        succeeded, failed = 0, 0
        for invoice in targets:
            try:
                pdf_result = store_invoice_pdf(invoice)
                invoice.pdf_url = pdf_result['secure_url']
                invoice.pdf_public_id = pdf_result['public_id']
                invoice.save(update_fields=['pdf_url', 'pdf_public_id'])
                succeeded += 1
                self.stdout.write(f'  OK: {invoice.invoice_number or invoice.pk} -> public_id={pdf_result["public_id"]}')
            except Exception as exc:
                failed += 1
                logger.exception('[INVOICES] Backfill re-upload failed for invoice_id=%s', invoice.pk)
                self.stdout.write(self.style.WARNING(f'  FAILED: {invoice.invoice_number or invoice.pk} — {exc}'))

        self.stdout.write(f'Backfill complete: {succeeded} succeeded, {failed} failed.')
        self.stdout.write(self.style.WARNING(
            'Note: backfilled URLs will still return 401 until the Cloudinary Console '
            '"Restricted media types" (or equivalent) setting is changed — this command '
            'only fixes the missing public_id column, not delivery access.'
        ))
