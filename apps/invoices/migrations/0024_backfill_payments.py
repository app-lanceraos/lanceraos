# apps/invoices/migrations/0024_backfill_payments.py
"""
Data migration — creates one ledger Payment for every legacy InvoicePartialPayment and links
the two (Payments core, 07 November 2026).

Before the income ledger existed, money received lived only as allocations on invoices. The
ledger must start complete, so every allocation with `payment IS NULL` gets exactly one
Payment (origin 'invoice') carrying the allocation's own amount, currency, date, source and
notes, the invoice's client name as counterparty, and the allocation's EXISTING frozen rate.

Rules this migration keeps on purpose:
  - A rate is NEVER recomputed or invented. A non-USD allocation whose rate is NULL stays NULL
    on the Payment with rate_basis 'none' (no honest historical rate exists; core.money reports
    such a row as unconverted rather than guessing).
  - The snapshot is the latest one on or before the day the allocation was RECORDED (else the
    earliest), and rate_basis follows the distance between that snapshot and payment_date.
  - The thresholds below are copied inline, not imported: a migration must keep meaning what it
    meant on the day it was written even if app code later changes.
  - created_at/updated_at are set to recorded_at after the insert (auto_now_add overwrites them
    at insert time); bulk_update does not run pre_save, so it keeps them.
  - Idempotent: a second run only sees allocations that still have payment IS NULL.

Reverse: unlink every allocation, then delete the origin='invoice' payments.
"""
import bisect
import logging
from decimal import Decimal

from django.db import migrations

logger = logging.getLogger(__name__)

BATCH_SIZE = 500
NEARBY_MAX_DAYS = 7  # copied from apps.payments.constants on purpose, see module docstring
RATE_QUANTUM = Decimal('1E-10')


def _basis(distance_days):
    distance_days = abs(distance_days)
    if distance_days == 0:
        return 'exact'
    if distance_days <= NEARBY_MAX_DAYS:
        return 'nearby'
    return 'estimated'


def _choose_snapshot(snapshot_dates, snapshot_ids, recorded_on):
    """Latest snapshot on or before `recorded_on`, else the earliest; (None, None) with no snapshots."""
    if not snapshot_dates:
        return None, None
    index = bisect.bisect_right(snapshot_dates, recorded_on) - 1
    if index < 0:
        index = 0
    return snapshot_ids[index], snapshot_dates[index]


def backfill_payments(apps, schema_editor):
    """Returns counts so a test can assert on them directly."""
    InvoicePartialPayment = apps.get_model('invoices', 'InvoicePartialPayment')
    Payment = apps.get_model('payments', 'Payment')
    ExchangeRateSnapshot = apps.get_model('payments', 'ExchangeRateSnapshot')

    snapshots = list(ExchangeRateSnapshot.objects.order_by('date').values_list('date', 'id'))
    snapshot_dates = [row[0] for row in snapshots]
    snapshot_ids = [row[1] for row in snapshots]

    pending = InvoicePartialPayment.objects.filter(payment__isnull=True)
    counts = {'allocations_before': pending.count(), 'payments_created': 0}

    def flush(partials):
        payments = []
        for partial in partials:
            recorded_on = partial.recorded_at.date()
            snapshot_id, snapshot_date = _choose_snapshot(snapshot_dates, snapshot_ids, recorded_on)
            rate = partial.rate_to_usd
            if partial.currency == 'USD':
                rate = Decimal('1')
            if rate is None:
                basis = 'none'
            elif snapshot_date is None:
                basis = 'exact' if partial.currency == 'USD' else 'estimated'
            else:
                basis = _basis((snapshot_date - partial.payment_date).days)
            payments.append(Payment(
                user_id=partial.invoice.user_id,
                amount=partial.amount,
                currency=partial.currency,
                payment_date=partial.payment_date,
                source=partial.source,
                counterparty=(partial.invoice.client_name or '')[:200],
                notes=partial.notes,
                origin='invoice',
                rate_to_usd=None if rate is None else Decimal(rate).quantize(RATE_QUANTUM),
                rate_basis=basis,
                exchange_rate_snapshot_id=snapshot_id,
            ))
        Payment.objects.bulk_create(payments)
        for payment, partial in zip(payments, partials):
            payment.created_at = partial.recorded_at
            payment.updated_at = partial.recorded_at
            partial.payment_id = payment.id
        Payment.objects.bulk_update(payments, ['created_at', 'updated_at'])
        InvoicePartialPayment.objects.bulk_update(partials, ['payment'])
        counts['payments_created'] += len(payments)

    batch = []
    for partial in pending.select_related('invoice').order_by('pk').iterator(chunk_size=BATCH_SIZE):
        batch.append(partial)
        if len(batch) >= BATCH_SIZE:
            flush(batch)
            batch = []
    if batch:
        flush(batch)

    counts['allocations_after'] = InvoicePartialPayment.objects.filter(payment__isnull=True).count()
    logger.info('[0024 backfill_payments] %s', counts)
    return counts


def unbackfill_payments(apps, schema_editor):
    InvoicePartialPayment = apps.get_model('invoices', 'InvoicePartialPayment')
    Payment = apps.get_model('payments', 'Payment')
    InvoicePartialPayment.objects.filter(payment__isnull=False).update(payment=None)
    deleted, _ = Payment.objects.filter(origin='invoice').delete()
    return {'payments_deleted': deleted}


class Migration(migrations.Migration):

    dependencies = [
        ('invoices', '0023_invoicepartialpayment_payment'),
        ('payments', '0002_payment'),
    ]

    operations = [
        migrations.RunPython(backfill_payments, unbackfill_payments),
    ]
