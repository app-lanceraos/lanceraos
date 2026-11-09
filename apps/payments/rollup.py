# apps/payments/rollup.py
"""
The one rollup engine behind BOTH ledgers (Prompt 14, decision E11): money in (Payment) and money
out (Expense) are summarised by the same loop, so a bug fixed in one cannot stay alive in the other.
Promoted out of ledger.summary_for_user, whose income output is pinned byte for byte by a golden
master. Request-free: no view, no serializer, no Response.

Historical-rate rule (Payments core, decision P4): a row converts with the snapshot it froze at record
time for BOTH legs (into USD, then out to the reporting currency), so a past month's total never changes
when today's rate changes. If that snapshot link is gone (SET_NULL on prune) the current snapshot is the
fallback. Conversion always goes through core.money.convert_amount (STANDARDS.md); a row that cannot be
converted is counted, never guessed and never dropped silently.
"""
from collections import defaultdict
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from typing import NamedTuple

from dateutil.relativedelta import relativedelta

from core.money import CENT, convert_amount

from .constants import RATE_ESTIMATED
from .models import ExchangeRateSnapshot

ZERO = Decimal('0')

PERIOD_NAMES = ('this_month', 'last_month', 'this_year', 'all_time')


class Row(NamedTuple):
    """
    One ledger row as the rollup reads it. The first five fields are all `convert_row` and
    `converted_total` need; the last three place the row in time and in a group.
    `group` is the by-group key (a payment's source, an expense's category); `flagged` marks
    rows that also count toward each window's `flagged_total` (an expense's is_deductible).
    """
    amount: Decimal
    currency: str
    rate_to_usd: Decimal | None
    snapshot_id: object
    rate_basis: str
    on_date: object
    group: str
    flagged: bool


@dataclass(frozen=True)
class Window:
    """One period: the converted total, how many rows contributed, and the flagged part of the total."""
    total: Decimal
    count: int
    flagged_total: Decimal


@dataclass(frozen=True)
class Rollup:
    periods: dict          # PERIOD_NAMES -> Window
    by_group: list         # [(group, total, count)] for the calendar year, largest first
    monthly: list          # [('YYYY-MM', total)] last 12 calendar months, oldest first, zero-filled
    unconverted_count: int
    estimated_count: int
    month_change_pct: float | None


class RangeRollup(NamedTuple):
    """The result of `summarize_range`: one period, one or more target currencies."""
    targets: tuple          # ('PKR',) or ('USD', 'PKR')
    total: dict             # target -> Decimal, a sum of cent-rounded rows
    flagged_total: dict     # target -> Decimal, sum of rows with flagged=True
    count: int              # rows that contributed (convertible into EVERY target)
    by_group: list          # [(group, {target: Decimal}, count)] largest first by the FIRST target; ties keep first-seen order
    monthly: list           # [('YYYY-MM', {target: Decimal}, count)] every month of the period, oldest first, zero-filled
    by_currency: list       # [(currency, Decimal original amount, count)] EVERY row in the period incl. unconverted ones, by code
    unconverted_count: int  # rows that did not convert into every target
    estimated_count: int    # included rows with rate_basis 'estimated' where at least one target differs from the row's own currency


def convert_row(row, target_currency, snapshots, current_snapshot):
    """
    One row (amount, currency, rate_to_usd, snapshot_id, ...) -> Decimal in the target rounded to the cent
    (ROUND_HALF_UP), or None when it cannot be honestly converted. A same-currency amount is returned as it
    is: it already has two decimals and needs no rate.
    """
    snapshot = snapshots.get(row[3]) or current_snapshot
    value = convert_amount(row[0], row[1], row[2], target_currency, snapshot)
    if value is None or row[1] == target_currency:
        return value
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


def load_snapshots(rows):
    """Every snapshot the rows reference, in one query."""
    ids = {row[3] for row in rows if row[3]}
    return ExchangeRateSnapshot.objects.in_bulk(ids) if ids else {}


def month_start(d):
    return d.replace(day=1)


def month_keys(start, end):
    """Every calendar month a period touches, as 'YYYY-MM', oldest first (a period touches a month if any day of it falls in it)."""
    keys = []
    cursor = month_start(start)
    last = month_start(end)
    while cursor <= last:
        keys.append(cursor.strftime('%Y-%m'))
        cursor += relativedelta(months=1)
    return keys


def months_spanned(start, end):
    """How many calendar months the period touches."""
    return (end.year - start.year) * 12 + (end.month - start.month) + 1


def money(value):
    """A Decimal as the two-decimal string every API payload uses."""
    return str(value.quantize(CENT))


def summarize(rows, target_currency, today, current_snapshot):
    """
    Rolls `rows` (a list of Row) up for the reporting currency `target_currency`.

    Windows are by `on_date`. `this_year` is the CALENDAR year; a Pakistani tax year (July-June)
    belongs to the future Tax module. A window's `count` is the number of rows that contributed to
    its total (convertible ones); a row that cannot be converted is counted in `unconverted_count`
    and in no total. `by_group` is the calendar year only, largest first, and groups with equal
    totals keep the order in which they were first seen (a stable sort over insertion order).

    `month_change_pct` compares this month with last month and is None when last month is zero or
    when any row in either of those two months could not be converted.

    No database work beyond one bulk snapshot load.
    """
    snapshots = load_snapshots(rows)

    this_month_start = month_start(today)
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
    periods = {name: [ZERO, 0, ZERO] for name in windows}
    by_group = defaultdict(lambda: [ZERO, 0])
    monthly = {(first_monthly + relativedelta(months=i)).strftime('%Y-%m'): ZERO for i in range(12)}
    unconverted_total = 0
    estimated_total = 0
    unconverted_in_change_months = 0

    for row in rows:
        on_date = row.on_date
        value = convert_row(row, target_currency, snapshots, current_snapshot)
        in_change_months = last_month_start <= on_date < next_month_start
        if value is None:
            unconverted_total += 1
            if in_change_months:
                unconverted_in_change_months += 1
            continue
        if row.rate_basis == RATE_ESTIMATED and row.currency != target_currency:
            estimated_total += 1
        for name, contains in windows.items():
            if contains(on_date):
                periods[name][0] += value
                periods[name][1] += 1
                if row.flagged:
                    periods[name][2] += value
        if windows['this_year'](on_date):
            by_group[row.group][0] += value
            by_group[row.group][1] += 1
        key = on_date.strftime('%Y-%m')
        if key in monthly:
            monthly[key] += value

    this_total, last_total = periods['this_month'][0], periods['last_month'][0]
    if last_total > 0 and unconverted_in_change_months == 0:
        month_change_pct = float(((this_total - last_total) / last_total * 100).quantize(Decimal('0.1')))
    else:
        month_change_pct = None

    return Rollup(
        periods={name: Window(total, count, flagged) for name, (total, count, flagged) in periods.items()},
        by_group=[
            (group, total, count)
            for group, (total, count) in sorted(by_group.items(), key=lambda item: item[1][0], reverse=True)
        ],
        monthly=list(monthly.items()),
        unconverted_count=unconverted_total,
        estimated_count=estimated_total,
        month_change_pct=month_change_pct,
    )


def summarize_range(rows, targets, start, end, current_snapshot):
    """
    Rolls `rows` (a list of Row) up for ONE period, `start` to `end` inclusive, into one or more target
    currencies at once (the P&L passes one, the income statement passes USD and PKR).

    A row whose `on_date` is outside the period is ignored here too: this function is the authority, a
    caller's SQL date filter is only an optimisation. A row is included only if it converts into EVERY
    target; otherwise it is counted in `unconverted_count` and in no total. Every conversion goes through
    `convert_row` (one rounding rule, one implementation). `by_currency` still lists every row of the
    period, unconverted ones included, so a statement can show money it could not convert. The month list
    is complete and zero-filled. No database work beyond one bulk snapshot load.
    """
    targets = tuple(targets)
    in_period = [row for row in rows if start <= row.on_date <= end]
    snapshots = load_snapshots(in_period)

    total = {t: ZERO for t in targets}
    flagged_total = {t: ZERO for t in targets}
    by_group = {}
    monthly = {key: [{t: ZERO for t in targets}, 0] for key in month_keys(start, end)}
    by_currency = {}
    count = unconverted_count = estimated_count = 0

    for row in in_period:
        entry = by_currency.setdefault(row.currency, [ZERO, 0])
        entry[0] += row.amount
        entry[1] += 1

        values = {t: convert_row(row, t, snapshots, current_snapshot) for t in targets}
        if any(value is None for value in values.values()):
            unconverted_count += 1
            continue
        count += 1
        if row.rate_basis == RATE_ESTIMATED and any(row.currency != t for t in targets):
            estimated_count += 1
        group = by_group.setdefault(row.group, [{t: ZERO for t in targets}, 0])
        month = monthly[row.on_date.strftime('%Y-%m')]
        for t, value in values.items():
            total[t] += value
            if row.flagged:
                flagged_total[t] += value
            group[0][t] += value
            month[0][t] += value
        group[1] += 1
        month[1] += 1

    first = targets[0]
    return RangeRollup(
        targets=targets,
        total=total,
        flagged_total=flagged_total,
        count=count,
        by_group=[
            (name, amounts, group_count)
            for name, (amounts, group_count) in sorted(by_group.items(), key=lambda item: item[1][0][first], reverse=True)
        ],
        monthly=[(key, amounts, month_count) for key, (amounts, month_count) in monthly.items()],
        by_currency=[(code, amount, n) for code, (amount, n) in sorted(by_currency.items())],
        unconverted_count=unconverted_count,
        estimated_count=estimated_count,
    )
