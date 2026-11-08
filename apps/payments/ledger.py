# apps/payments/ledger.py
"""
The shared income maths over the Payment ledger — the counterpart of apps/invoices/kpis.py.
Tax, P&L and the income certificate will call this later instead of re-deriving it. Nothing
here knows about requests, DRF or Response.

Historical-rate rule (Payments core, decision P4): a payment converts with the snapshot it
froze at record time for BOTH legs (into USD, then out to the reporting currency), so a past
month's total never changes when today's rate changes. If that snapshot link is gone
(SET_NULL on prune) the current snapshot is the fallback. Conversion always goes through
core.money.convert_amount (STANDARDS.md); a row that cannot be converted is counted, never
guessed and never dropped silently.
"""
from datetime import timedelta
from decimal import Decimal

from core.money import CENT

from . import rollup
from .constants import PAYMENT_SOURCE_LABELS, PROBABLE_DUPLICATE_DAYS, RATE_ESTIMATED
from .models import ExchangeRateSnapshot, Payment

ZERO = Decimal('0')


def converted_total(rows, target_currency, current_snapshot):
    """
    `rows`: iterable of (amount, currency, rate_to_usd, snapshot_id, rate_basis).
    Returns (total quantized to cents, converted_count, unconverted_count, estimated_count).
    `estimated_count` counts converted rows whose rate was only an estimate AND whose
    conversion actually used a rate (a payment already in the target currency uses none).
    """
    rows = list(rows)
    snapshots = rollup.load_snapshots(rows)
    total, converted, unconverted, estimated = ZERO, 0, 0, 0
    for row in rows:
        value = rollup.convert_row(row, target_currency, snapshots, current_snapshot)
        if value is None:
            unconverted += 1
            continue
        total += value
        converted += 1
        if row[4] == RATE_ESTIMATED and row[1] != target_currency:
            estimated += 1
    return total.quantize(CENT), converted, unconverted, estimated


def summary_for_user(user, today, currency=None):
    """
    The Payments page's headline numbers. Constant query count whatever the row count: one
    query for the user's payments, one for the snapshots they reference, one for the profile
    currency and the current snapshot lookup; everything else is Python (apps.payments.rollup,
    shared with the expense summary).

    Windows are by payment_date. `this_year` is the CALENDAR year; a Pakistani tax year
    (July-June) belongs to the future Tax module. `count` is the number of payments that
    contributed to `total` (convertible ones); a payment that cannot be converted is counted
    in `unconverted_count` and in no total.

    `month_change_pct` compares this month with last month and is null when last month is
    zero or when any payment in either of those two months could not be converted.
    """
    target = (currency or user.profile.default_currency or 'USD').upper()
    current = ExchangeRateSnapshot.get_current()
    rows = [
        rollup.Row(amount, row_currency, rate, snapshot_id, basis, payment_date, source, False)
        for amount, row_currency, rate, snapshot_id, basis, payment_date, source in Payment.objects.filter(user=user).values_list(
            'amount', 'currency', 'rate_to_usd', 'exchange_rate_snapshot_id', 'rate_basis', 'payment_date', 'source',
        )
    ]
    result = rollup.summarize(rows, target, today, current)

    return {
        'currency': target,
        'periods': {
            name: {'total': rollup.money(window.total), 'count': window.count}
            for name, window in result.periods.items()
        },
        'month_change_pct': result.month_change_pct,
        'by_source': [
            {'source': source, 'label': PAYMENT_SOURCE_LABELS.get(source, source), 'total': rollup.money(total), 'count': count}
            for source, total, count in result.by_group
        ],
        'monthly': [{'month': month, 'total': rollup.money(total)} for month, total in result.monthly],
        'unconverted_count': result.unconverted_count,
        'estimated_count': result.estimated_count,
    }


def find_possible_duplicates(user, amount, currency, payment_date, exclude_id=None, window_days=PROBABLE_DUPLICATE_DAYS, limit=3):
    """
    Payments of the same user, currency and exact amount dated within `window_days` either way
    (inclusive). Shown after a manual entry so a payment typed twice, or typed once and also
    recorded on an invoice, is noticed before it is counted twice.
    """
    qs = Payment.objects.filter(
        user=user, currency=currency, amount=amount,
        payment_date__gte=payment_date - timedelta(days=window_days),
        payment_date__lte=payment_date + timedelta(days=window_days),
    )
    if exclude_id is not None:
        qs = qs.exclude(pk=exclude_id)
    return list(qs.order_by('-payment_date', '-created_at')[:limit])
