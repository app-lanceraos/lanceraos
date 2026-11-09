# apps/payments/report.py
"""
The money-report maths (Prompt 16): the Profit and Loss and the Statement of Income. Request-free: no view,
no serializer, no Response. Both read the two ledgers through apps.payments (`ledger.income_rows`,
`expense_ledger.expense_rows`) and total them with `rollup.summarize_range`, so a report can never disagree
with the Payments and Expenses cards (one conversion, one rounding rule).

Cash basis (decision R1): income is a Payment dated in the period, an expense is an Expense dated in the
period. An unpaid invoice is not income. Net = income - ALL expenses (decision R4): the deductible flag is
shown, never subtracted, and there is no tax figure here (that belongs to the Tax module).
"""
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from . import expense_ledger, ledger, rollup
from .constants import EARLIEST_PAYMENT_DATE, EXPENSE_CATEGORY_LABELS, PAYMENT_SOURCE_LABELS
from .models import ExchangeRateSnapshot

MAX_RANGE_MONTHS = 60
STATEMENT_CURRENCIES = ('USD', 'PKR')

ZERO = Decimal('0')


def default_range(today):
    """1 January of the current year to today."""
    return date(today.year, 1, 1), today


def validate_range(start, end, today):
    """None when the period is acceptable, otherwise the first problem as a sentence (checked in this order)."""
    if start > end:
        return 'The start date must be on or before the end date.'
    if end > today:
        return 'The end date cannot be in the future.'
    if start < EARLIEST_PAYMENT_DATE:
        return f'The start date cannot be before {EARLIEST_PAYMENT_DATE.isoformat()}.'
    if rollup.months_spanned(start, end) > MAX_RANGE_MONTHS:
        return f'Choose a period of {MAX_RANGE_MONTHS} months or less.'
    return None


def _margin_pct(net, income):
    """Net as a percentage of income, one decimal, or None when there is no income to measure against."""
    if income <= ZERO:
        return None
    return float((net / income * 100).quantize(Decimal('0.1'), rounding=ROUND_HALF_UP))


def pnl(user, start, end, currency=None):
    """
    The Profit and Loss for [start, end] in one currency (the requested one, else the profile's, else USD).
    Constant query count whatever the row count: one query per ledger, one for each ledger's snapshots, plus
    the profile and the current-snapshot lookups.
    """
    target = (currency or user.profile.default_currency or 'USD').upper()
    current = ExchangeRateSnapshot.get_current()
    income = rollup.summarize_range(ledger.income_rows(user, start, end), (target,), start, end, current)
    expenses = rollup.summarize_range(expense_ledger.expense_rows(user, start, end), (target,), start, end, current)

    income_total = income.total[target]
    expenses_total = expenses.total[target]
    deductible = expenses.flagged_total[target]
    net = income_total - expenses_total

    monthly = [
        {
            'month': month,
            'income': rollup.money(income_amounts[target]),
            'expenses': rollup.money(expense_amounts[target]),
            'net': rollup.money(income_amounts[target] - expense_amounts[target]),
        }
        for (month, income_amounts, _i), (_m, expense_amounts, _e) in zip(income.monthly, expenses.monthly)
    ]
    return {
        'currency': target,
        'start': start.isoformat(),
        'end': end.isoformat(),
        'income': {
            'total': rollup.money(income_total),
            'count': income.count,
            'by_source': [
                {'source': source, 'label': PAYMENT_SOURCE_LABELS.get(source, source), 'total': rollup.money(amounts[target]), 'count': n}
                for source, amounts, n in income.by_group
            ],
        },
        'expenses': {
            'total': rollup.money(expenses_total),
            'count': expenses.count,
            'deductible_total': rollup.money(deductible),
            'not_deductible_total': rollup.money(expenses_total - deductible),
            'by_category': [
                {'category': category, 'label': EXPENSE_CATEGORY_LABELS.get(category, category), 'total': rollup.money(amounts[target]), 'count': n}
                for category, amounts, n in expenses.by_group
            ],
        },
        'net': {'total': rollup.money(net), 'margin_pct': _margin_pct(net, income_total)},
        'monthly': monthly,
        'unconverted_count': {'income': income.unconverted_count, 'expenses': expenses.unconverted_count},
        'estimated_count': {'income': income.estimated_count, 'expenses': expenses.estimated_count},
    }


def income_statement(user, start, end):
    """
    What was received in [start, end], in USD and the PKR equivalent, month by month, by source and by
    original currency. Income only: no expenses, no tax. A payment is included only if it converts into BOTH
    currencies (otherwise it is counted in `unconverted_count` and shown only under `by_currency`).
    """
    usd, pkr = STATEMENT_CURRENCIES
    current = ExchangeRateSnapshot.get_current()
    result = rollup.summarize_range(ledger.income_rows(user, start, end), STATEMENT_CURRENCIES, start, end, current)
    return {
        'start': start.isoformat(),
        'end': end.isoformat(),
        'months': rollup.months_spanned(start, end),
        'currencies': list(STATEMENT_CURRENCIES),
        'total': {'usd': rollup.money(result.total[usd]), 'pkr': rollup.money(result.total[pkr])},
        'count': result.count,
        'by_source': [
            {'source': source, 'label': PAYMENT_SOURCE_LABELS.get(source, source),
             'usd': rollup.money(amounts[usd]), 'pkr': rollup.money(amounts[pkr]), 'count': n}
            for source, amounts, n in result.by_group
        ],
        'by_currency': [
            {'currency': code, 'amount': rollup.money(amount), 'count': n}
            for code, amount, n in result.by_currency
        ],
        'monthly': [
            {'month': month, 'count': n, 'usd': rollup.money(amounts[usd]), 'pkr': rollup.money(amounts[pkr])}
            for month, amounts, n in result.monthly
        ],
        'unconverted_count': result.unconverted_count,
        'estimated_count': result.estimated_count,
    }
