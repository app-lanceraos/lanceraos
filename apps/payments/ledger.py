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
from collections import defaultdict
from datetime import timedelta
from decimal import Decimal

from dateutil.relativedelta import relativedelta

from core.money import CENT, convert_amount

from .constants import PAYMENT_SOURCE_LABELS, PROBABLE_DUPLICATE_DAYS, RATE_ESTIMATED
from .models import ExchangeRateSnapshot, Payment

ZERO = Decimal('0')


def _convert_row(row, target_currency, snapshots, current_snapshot):
    """One (amount, currency, rate_to_usd, snapshot_id, rate_basis) row -> Decimal or None."""
    amount, currency, rate_to_usd, snapshot_id, _basis = row
    snapshot = snapshots.get(snapshot_id) or current_snapshot
    return convert_amount(amount, currency, rate_to_usd, target_currency, snapshot)


def _load_snapshots(rows):
    ids = {row[3] for row in rows if row[3]}
    return ExchangeRateSnapshot.objects.in_bulk(ids) if ids else {}


def converted_total(rows, target_currency, current_snapshot):
    """
    `rows`: iterable of (amount, currency, rate_to_usd, snapshot_id, rate_basis).
    Returns (total quantized to cents, converted_count, unconverted_count, estimated_count).
    `estimated_count` counts converted rows whose rate was only an estimate AND whose
    conversion actually used a rate (a payment already in the target currency uses none).
    """
    rows = list(rows)
    snapshots = _load_snapshots(rows)
    total, converted, unconverted, estimated = ZERO, 0, 0, 0
    for row in rows:
        value = _convert_row(row, target_currency, snapshots, current_snapshot)
        if value is None:
            unconverted += 1
            continue
        total += value
        converted += 1
        if row[4] == RATE_ESTIMATED and row[1] != target_currency:
            estimated += 1
    return total.quantize(CENT), converted, unconverted, estimated


def _month_start(d):
    return d.replace(day=1)


def _money(value):
    return str(value.quantize(CENT))


def summary_for_user(user, today, currency=None):
    """
    The Payments page's headline numbers. Constant query count whatever the row count: one
    query for the user's payments, one for the snapshots they reference, one for the profile
    currency and the current snapshot lookup; everything else is Python.

    Windows are by payment_date. `this_year` is the CALENDAR year; a Pakistani tax year
    (July-June) belongs to the future Tax module. `count` is the number of payments that
    contributed to `total` (convertible ones); a payment that cannot be converted is counted
    in `unconverted_count` and in no total.

    `month_change_pct` compares this month with last month and is null when last month is
    zero or when any payment in either of those two months could not be converted.
    """
    target = (currency or user.profile.default_currency or 'USD').upper()
    current = ExchangeRateSnapshot.get_current()
    raw = list(
        Payment.objects.filter(user=user).values_list(
            'amount', 'currency', 'rate_to_usd', 'exchange_rate_snapshot_id', 'rate_basis', 'payment_date', 'source',
        )
    )
    snapshots = _load_snapshots(raw)

    this_month_start = _month_start(today)
    last_month_start = this_month_start - relativedelta(months=1)
    next_month_start = this_month_start + relativedelta(months=1)
    year_start = today.replace(month=1, day=1)
    first_monthly = this_month_start - relativedelta(months=11)

    windows = {
        'this_month': lambda d: this_month_start <= d < next_month_start,
        'last_month': lambda d: last_month_start <= d < this_month_start,
        'this_year': lambda d: year_start <= d < year_start.replace(year=year_start.year + 1),
        'all_time': lambda d: True,
    }
    periods = {name: [ZERO, 0] for name in windows}
    by_source = defaultdict(lambda: [ZERO, 0])
    monthly = {(first_monthly + relativedelta(months=i)).strftime('%Y-%m'): ZERO for i in range(12)}
    unconverted_total = 0
    estimated_total = 0
    unconverted_in_change_months = 0

    for amount, row_currency, rate, snapshot_id, basis, payment_date, source in raw:
        value = _convert_row((amount, row_currency, rate, snapshot_id, basis), target, snapshots, current)
        in_change_months = last_month_start <= payment_date < next_month_start
        if value is None:
            unconverted_total += 1
            if in_change_months:
                unconverted_in_change_months += 1
            continue
        if basis == RATE_ESTIMATED and row_currency != target:
            estimated_total += 1
        for name, contains in windows.items():
            if contains(payment_date):
                periods[name][0] += value
                periods[name][1] += 1
        if windows['this_year'](payment_date):
            by_source[source][0] += value
            by_source[source][1] += 1
        key = payment_date.strftime('%Y-%m')
        if key in monthly:
            monthly[key] += value

    this_total, last_total = periods['this_month'][0], periods['last_month'][0]
    if last_total > 0 and unconverted_in_change_months == 0:
        month_change_pct = float(((this_total - last_total) / last_total * 100).quantize(Decimal('0.1')))
    else:
        month_change_pct = None

    return {
        'currency': target,
        'periods': {name: {'total': _money(total), 'count': count} for name, (total, count) in periods.items()},
        'month_change_pct': month_change_pct,
        'by_source': [
            {'source': source, 'label': PAYMENT_SOURCE_LABELS.get(source, source), 'total': _money(total), 'count': count}
            for source, (total, count) in sorted(by_source.items(), key=lambda item: item[1][0], reverse=True)
        ],
        'monthly': [{'month': month, 'total': _money(total)} for month, total in monthly.items()],
        'unconverted_count': unconverted_total,
        'estimated_count': estimated_total,
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
