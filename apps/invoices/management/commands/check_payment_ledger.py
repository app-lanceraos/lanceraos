# apps/invoices/management/commands/check_payment_ledger.py
"""
Read-only integrity check for the income ledger (Payments core, 07 November 2026). It lives in
apps.invoices because it needs both Payment and InvoicePartialPayment, and apps.payments can
import neither the invoice models nor this command.

Mandatory after the ledger migrations (DEPLOYMENT.md): it proves the 0024 backfill left no
allocation without a ledger row and that nothing since has drifted. Exits non-zero on any problem.
Prints counts and at most 10 ids per problem; never amounts, names or any other business data.
"""
from django.core.management.base import BaseCommand, CommandError
from django.db.models import Count, F, Q, Sum

from apps.invoices.models import InvoicePartialPayment
from apps.payments.models import Payment

MAX_IDS = 10


class Command(BaseCommand):
    help = 'Checks that every invoice payment allocation and every ledger Payment agree. Read-only.'

    def handle(self, *args, **options):
        checks = [
            (
                'allocation with no ledger payment',
                InvoicePartialPayment.objects.filter(payment__isnull=True),
            ),
            (
                'allocation currency differs from its payment',
                InvoicePartialPayment.objects.filter(payment__isnull=False).exclude(currency=F('payment__currency')),
            ),
            (
                'allocations sum to more than the payment amount',
                Payment.objects.annotate(allocated=Sum('invoice_allocations__amount')).filter(allocated__gt=F('amount')),
            ),
            (
                'invoice-origin payment without exactly one matching allocation',
                Payment.objects.filter(origin='invoice')
                .annotate(allocation_count=Count('invoice_allocations'), allocated=Sum('invoice_allocations__amount'))
                .filter(~Q(allocation_count=1) | ~Q(allocated=F('amount'))),
            ),
            (
                'payment belongs to a different user than its invoice',
                InvoicePartialPayment.objects.filter(payment__isnull=False).exclude(payment__user=F('invoice__user')),
            ),
            (
                'imported payment with no import batch',
                Payment.objects.filter(origin='import', import_batch__isnull=True),
            ),
            (
                'non-imported payment that carries an external id or an import batch',
                Payment.objects.exclude(origin='import').filter(~Q(external_id='') | Q(import_batch__isnull=False)),
            ),
        ]

        self.stdout.write(
            f'Ledger rows: {Payment.objects.count()} payments, {InvoicePartialPayment.objects.count()} invoice allocations.'
        )
        problems = 0
        for label, qs in checks:
            count = qs.count()
            problems += count
            self.stdout.write(f'  [{"FAIL" if count else "ok"}] {label}: {count}')
            if count:
                ids = ', '.join(str(pk) for pk in qs.values_list('pk', flat=True)[:MAX_IDS])
                self.stdout.write(f'      ids (up to {MAX_IDS}): {ids}')

        if problems:
            raise CommandError(f'Payment ledger check FAILED: {problems} problem row(s).')
        self.stdout.write(self.style.SUCCESS('Payment ledger check passed.'))
