# apps/health/facts.py
"""
The only module of apps.health that reads the database. `gather` turns the two payments ledgers into one Facts
object: one query for ALL the person's income rows, one for the expense rows of the window, a few snapshot
loads, and plain Python for the rest, so the cost is the same for 5 rows or 5,000.

Windows (decision H1): the `months` full calendar months that END BEFORE the current month; the "earlier
window" is the same number of months before that. The current month is never counted. Months before the first
recorded payment are dropped from every income measure (decision H2).
"""
from datetime import timedelta
from decimal import Decimal

from dateutil.relativedelta import relativedelta
from django.utils import timezone

from apps.payments import expense_ledger, ledger, rollup
from apps.payments.constants import EXPENSE_CATEGORY_LABELS
from apps.payments.models import ExchangeRateSnapshot

from . import constants as c
from .domain import Facts

ZERO = Decimal('0')


def today():
    """The date the score is computed for (PKT, USE_TZ is False). A module-level function so tests can patch it."""
    return timezone.now().date()


def windows(months, now):
    """(window_start, window_end, earlier_start, earlier_end) for `months` full calendar months before `now`'s month."""
    this_month = rollup.month_start(now)
    window_start = this_month - relativedelta(months=months)
    return window_start, this_month - timedelta(days=1), window_start - relativedelta(months=months), window_start - timedelta(days=1)


def _display_name(name):
    if len(name) > c.PAYER_NAME_LIMIT:
        return name[:c.PAYER_NAME_LIMIT - 3] + '...'
    return name


def gather(user, months, now=None) -> Facts:
    now = now or today()
    window_start, window_end, earlier_start, earlier_end = windows(months, now)
    recent_from = now - timedelta(days=c.RECENT_DAYS - 1)

    profile = user.profile
    target = (profile.default_currency or 'USD').upper()
    current = ExchangeRateSnapshot.get_current()

    income_rows, display = ledger.income_rows_by_payer(user)
    expense_rows = expense_ledger.expense_rows(user, min(window_start, recent_from), now)

    income = rollup.summarize_range(income_rows, (target,), window_start, window_end, current)
    earlier = rollup.summarize_range(income_rows, (target,), earlier_start, earlier_end, current)
    expenses = rollup.summarize_range(expense_rows, (target,), window_start, window_end, current)

    first_key = min(row.on_date for row in income_rows).strftime('%Y-%m') if income_rows else None
    effective = tuple(
        (month, amounts[target]) for month, amounts, _n in income.monthly if first_key is not None and month >= first_key
    )
    earlier_effective = [
        amounts[target] for month, amounts, _n in earlier.monthly if first_key is not None and month >= first_key
    ]

    payers, unnamed = [], ZERO
    for key, amounts, _n in income.by_group:
        if key == '':
            unnamed = amounts[target]
        else:
            payers.append((_display_name(display.get(key, key)), amounts[target]))
    payers.sort(key=lambda item: (-item[1], item[0]))

    top = None
    if expenses.by_group:
        category, amounts, _n = expenses.by_group[0]
        top = (category, EXPENSE_CATEGORY_LABELS.get(category, category), amounts[target])

    income_total = income.total[target]
    return Facts(
        currency=target,
        months=months,
        window_start=window_start,
        window_end=window_end,
        earlier_start=earlier_start,
        earlier_end=earlier_end,
        income_months=effective,
        income_total=income_total,
        income_count=income.count,
        recent_total=income_total,
        expense_total=expenses.total[target],
        expense_count=expenses.count,
        expense_top=top,
        earlier_months=len(earlier_effective),
        earlier_total=sum(earlier_effective, ZERO),
        payers=tuple(payers),
        unnamed_total=unnamed,
        has_ntn=bool(profile.ntn_encrypted),      # whether one is saved, never its digits (decision H15)
        has_pseb=bool(profile.pseb_registered),
        recent_payment=any(recent_from <= row.on_date <= now for row in income_rows),
        recent_expense=any(recent_from <= row.on_date <= now for row in expense_rows),
        ever_paid=bool(income_rows),
        unconverted_payments=income.unconverted_count + earlier.unconverted_count,
        unconverted_expenses=expenses.unconverted_count,
    )
