# apps/payments/expense_ledger.py
"""
The shared maths over the Expense ledger — the money-out counterpart of apps.payments.ledger. The P&L
and the Tax module will call this later instead of re-deriving it. Nothing here knows about requests,
DRF or Response.

Same conventions as the income summary (decisions E2/E10), because it runs on the same rollup engine
(apps.payments.rollup): an expense converts with the snapshot it froze at record time for BOTH legs, so a
past month's total never changes when today's rate changes; a row that cannot be converted is counted in
`unconverted_count` and in no total.
"""
from datetime import timedelta

from . import rollup
from .constants import EXPENSE_CATEGORY_LABELS, PROBABLE_DUPLICATE_DAYS
from .models import ExchangeRateSnapshot, Expense


def summary_for_user(user, today, currency=None):
    """
    The Expenses page's headline numbers. Constant query count whatever the row count: one query for
    the user's expenses, one for the snapshots they reference, one for the profile currency and the
    current snapshot lookup; everything else is Python.

    Windows are by expense_date; `this_year` is the CALENDAR year (a July-June tax year belongs to the
    Tax module). Each window carries `deductible_total`: the converted total of its expenses with
    is_deductible=True. `by_category` is this calendar year, largest first, with the category's label (a
    value no longer in the list falls back to the value itself).
    """
    target = (currency or user.profile.default_currency or 'USD').upper()
    current = ExchangeRateSnapshot.get_current()
    rows = [
        rollup.Row(amount, row_currency, rate, snapshot_id, basis, expense_date, category, is_deductible)
        for amount, row_currency, rate, snapshot_id, basis, expense_date, category, is_deductible in Expense.objects.filter(user=user).values_list(
            'amount', 'currency', 'rate_to_usd', 'exchange_rate_snapshot_id', 'rate_basis', 'expense_date', 'category', 'is_deductible',
        )
    ]
    result = rollup.summarize(rows, target, today, current)

    return {
        'currency': target,
        'periods': {
            name: {
                'total': rollup.money(window.total),
                'count': window.count,
                'deductible_total': rollup.money(window.flagged_total),
            }
            for name, window in result.periods.items()
        },
        'month_change_pct': result.month_change_pct,
        'by_category': [
            {'category': category, 'label': EXPENSE_CATEGORY_LABELS.get(category, category), 'total': rollup.money(total), 'count': count}
            for category, total, count in result.by_group
        ],
        'monthly': [{'month': month, 'total': rollup.money(total)} for month, total in result.monthly],
        'unconverted_count': result.unconverted_count,
        'estimated_count': result.estimated_count,
    }


def find_possible_duplicates(user, amount, currency, expense_date, category, exclude_id=None,
                             window_days=PROBABLE_DUPLICATE_DAYS, limit=3):
    """
    Expenses of the same user, currency, exact amount AND category dated within `window_days` either
    way (inclusive). A notice shown after a create, never a block: buying the same thing twice is
    legitimate.
    """
    qs = Expense.objects.filter(
        user=user, currency=currency, amount=amount, category=category,
        expense_date__gte=expense_date - timedelta(days=window_days),
        expense_date__lte=expense_date + timedelta(days=window_days),
    )
    if exclude_id is not None:
        qs = qs.exclude(pk=exclude_id)
    return list(qs.order_by('-expense_date', '-created_at')[:limit])
