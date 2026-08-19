# apps/invoices/management/commands/backfill_recurring_next_dates.py
"""
One-time backfill for recurring root invoices finalised before
_finalise_invoice ever set next_recurring_date (19 August 2026 fix —
see DECISIONS.md). Every recurring root created through the real
wizard/finalise flow before this fix sat with next_recurring_date=None
forever, since generate_recurring_invoices' own advance step only ever
runs once a value already exists — this is why 4 real recurring
invoices in production, some finalised weeks ago, never generated a
single occurrence.

Seeds next_recurring_date using the exact same anchor the fix itself
uses at finalise time: _advance_recurring_date(issue_date,
recurring_interval_days) — one interval after the root's own issue
date, calendar-accurate for the month-based intervals. Scoped to
is_recurring=True, parent_invoice IS NULL (roots only — a generated
child never gets its own next_recurring_date, unaffected either way),
next_recurring_date IS NULL, recurring_interval_days IS NOT NULL,
status != 'draft' (a still-draft recurring invoice hasn't been
finalised yet — the real fix already covers it correctly at its own
future finalise call, backfilling it now would be premature).
"""
import logging

from django.core.management.base import BaseCommand

from apps.invoices.models import Invoice
from apps.invoices.tasks import _advance_recurring_date

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = 'Backfills Invoice.next_recurring_date for recurring roots finalised before that field was ever seeded.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run', action='store_true',
            help='List affected invoices and the date each would receive, without saving anything.',
        )

    def handle(self, *args, **options):
        dry_run = options['dry_run']
        targets = Invoice.objects.filter(
            is_recurring=True, parent_invoice__isnull=True, next_recurring_date__isnull=True,
            recurring_interval_days__isnull=False,
        ).exclude(status='draft')
        count = targets.count()
        self.stdout.write(f'Found {count} recurring root invoice(s) with next_recurring_date unset.')

        if count == 0:
            return

        for invoice in targets:
            new_date = _advance_recurring_date(invoice.issue_date, invoice.recurring_interval_days)
            if dry_run:
                self.stdout.write(f'  [dry-run] {invoice.invoice_number or invoice.pk} — issue_date={invoice.issue_date}, interval={invoice.recurring_interval_days}d -> next_recurring_date={new_date}')
                continue
            invoice.next_recurring_date = new_date
            invoice.save(update_fields=['next_recurring_date'])
            self.stdout.write(f'  OK: {invoice.invoice_number or invoice.pk} -> next_recurring_date={new_date}')

        if not dry_run:
            self.stdout.write(self.style.WARNING(
                'Note: a backfilled date already in the past becomes immediately eligible on the '
                'next generate_recurring_invoices run — the very first occurrence for a series that '
                'was silently broken since finalise, generated as a real, current-dated invoice, not '
                'backdated to when it "should have" fired.'
            ))
