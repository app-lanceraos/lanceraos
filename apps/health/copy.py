# apps/health/copy.py
"""
Every sentence the Health Score shows, built from the person's own numbers by templates (decisions H12, H14).
English, whole currency units, no locale dependence. Pure: no Django, no apps.*. The static "about" texts and
every threshold in a sentence are built from constants.py, so the words cannot disagree with the formula.
"""
from decimal import ROUND_HALF_UP, Decimal

from . import constants as c

MONTH_NAMES = (
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
)

NO_SCORE_MESSAGE = 'There is not enough recorded yet to give a score. The areas below say what each one needs.'
NOTE_FULL_MONTHS = 'Only full calendar months are counted, so the current month is left out until it ends.'
NOTE_GUIDE = 'This score is a guide based on the records you keep in LanceraOS. It is not financial, accounting or tax advice.'
NOTHING_MORE = 'Nothing more is needed here: this area has the full score.'
NOT_SCORED = 'Not scored yet.'


def _whole(value):
    return int(Decimal(value).quantize(Decimal('1'), rounding=ROUND_HALF_UP))


def plural(n, word):
    """'1 month', '2 months'."""
    return f'{n} {word}' if n == 1 else f'{n} {word}s'


def money(value, currency):
    """'PKR 95,000': the code, a space, whole units (half up) with thousands separators."""
    whole = _whole(value)
    return f'{"-" if whole < 0 else ""}{currency} {abs(whole):,}'


def pct(ratio):
    """A ratio as a whole percent, half up: 0.289 -> 29."""
    return _whole(Decimal(ratio) * 100)


def month_name(key):
    """'2026-03' -> 'March 2026'."""
    year, month = key.split('-')
    return f'{MONTH_NAMES[int(month) - 1]} {year}'


def change_phrase(growth):
    """'up 12%', 'down 8%', or 'unchanged' when the change rounds to 0%."""
    n = pct(growth)
    if n == 0:
        return 'unchanged'
    return f'up {n}%' if n > 0 else f'down {-n}%'


def gain_sentence(gain):
    return '' if gain is None else f' This is worth about {plural(gain, "point")} of your score.'


def _p(ratio):
    """A constant ratio as a whole percent for the static texts."""
    return pct(ratio)


def area_about(key):
    if key == c.INCOME_CONSISTENCY:
        return (
            'How steady your income is from month to month. Swing means how far a typical month is from your average '
            f'month. A full score needs a swing of {_p(c.CONSISTENCY_FULL_AT)}% or less; the score is zero at '
            f'{_p(c.CONSISTENCY_ZERO_AT)}% or more.'
        )
    if key == c.PROFIT_MARGIN:
        return (
            'How much of what you earn is left after the business expenses you recorded. A full score needs '
            f'{_p(c.MARGIN_FULL_AT)}% or more left; the score is zero at {_p(c.MARGIN_ZERO_AT)}% or less. Only expenses '
            'recorded in LanceraOS count. Personal spending and savings are not tracked here.'
        )
    if key == c.TAX_COMPLIANCE:
        p = c.TAX_POINTS
        return (
            f'Whether your tax basics are in place: an NTN saved ({p["ntn"]} points), PSEB registration marked '
            f'({p["pseb"]} points), a payment recorded in the last {c.RECENT_DAYS} days ({p["recent_payment"]} points) '
            f'and an expense recorded in the last {c.RECENT_DAYS} days ({p["recent_expense"]} points). The NTN and PSEB '
            'are what you entered; LanceraOS does not check them with FBR or PSEB. PSEB registration is for people who '
            'export IT services, so it may not apply to your work.'
        )
    if key == c.INCOME_GROWTH:
        return (
            'How your average month compares with your average month in the same number of months before it. A full '
            f'score needs growth of {_p(c.GROWTH_FULL_AT)}% or more, flat income earns half the points, and a fall of '
            f'{_p(-c.GROWTH_ZERO_AT)}% or more scores zero.'
        )
    if key == c.CLIENT_DIVERSITY:
        return (
            'How much of your income depends on one payer, using the "Received from" name on your payments. A full '
            f'score needs your biggest payer to be {_p(c.SHARE_FULL_AT)}% or less of your named income; the score is '
            f'zero at {_p(c.SHARE_ZERO_AT)}% or more. This needs a name on at least {_p(c.PAYER_COVERAGE_MIN)}% of your income.'
        )
    raise KeyError(key)


def _done_count(area):
    return sum(1 for check in area.details['checks'] if check['done'])


def measure(area, currency, months):
    """What was measured, in the person's numbers ('Not scored yet.' when the area has no score)."""
    if not area.scored:
        return NOT_SCORED
    d = area.details
    if area.key == c.INCOME_CONSISTENCY:
        n = plural(d['months_counted'], 'month')
        if d['swing'] is None:
            return f'No income was recorded in these {n}.'
        return f'Your monthly income swung {pct(d["swing"])}% around its average of {money(d["average"], currency)} over {n}.'
    if area.key == c.PROFIT_MARGIN:
        income, expenses = money(d['income'], currency), money(d['expenses'], currency)
        if d['net'] > 0:
            return f'You kept {pct(d["margin"])}% of your income: {income} received, {expenses} spent, {money(d["net"], currency)} left.'
        return f'Your expenses were as high as or higher than your income: {income} received, {expenses} spent.'
    if area.key == c.TAX_COMPLIANCE:
        return f'{_done_count(area)} of {len(d["checks"])} checks are in place.'
    if area.key == c.INCOME_GROWTH:
        return (
            f'Your average month was {money(d["average_recent"], currency)} over the last {plural(d["months_recent"], "month")}, '
            f'against {money(d["average_earlier"], currency)} over the {plural(d["months_earlier"], "month")} before '
            f'({change_phrase(d["growth"])}).'
        )
    if area.key == c.CLIENT_DIVERSITY:
        payers = 'payer' if d['named_payers'] == 1 else 'payers'
        return (
            f'{d["top_payer"]} paid {pct(d["top_share"])}% of the income that has a name '
            f'({money(d["top_amount"], currency)} of {money(d["named_income"], currency)}). '
            f'You have {d["named_payers"]} named {payers}.'
        )
    raise KeyError(area.key)


def _not_scored_needed(area, months):
    reason = area.reason
    d = area.details
    n_months = plural(months, 'month')
    if reason == c.REASON_NO_PAYMENTS:
        return f'Record your first payment. This area needs at least {c.MIN_MONTHS} full months since your first payment.'
    if reason == c.REASON_TOO_FEW_MONTHS:
        return f'This needs at least {c.MIN_MONTHS} full months since your first payment. You have {plural(d["months_counted"], "month")}.'
    if reason == c.REASON_NO_INCOME:
        return f'This needs income in the last {n_months}.'
    if reason == c.REASON_NO_EXPENSES:
        return (
            f'This needs at least one expense recorded in the last {n_months}. Without expenses your margin would '
            'look perfect, which would not be true.'
        )
    if reason == c.REASON_TOO_LITTLE_HISTORY:
        return (
            f'This compares your last {n_months} with the {n_months} before them, and needs at least {c.MIN_MONTHS} of '
            f'those earlier months on record. You have {plural(d["months_earlier"], "month")}.'
        )
    if reason == c.REASON_NO_EARLIER_INCOME:
        return 'There was no income in the earlier months, so there is nothing to compare with.'
    if reason == c.REASON_FEW_PAYER_NAMES:
        return f'This needs a "Received from" name on at least {_p(c.PAYER_COVERAGE_MIN)}% of your income. {pct(d["coverage"])}% has one now.'
    raise KeyError(reason)


def needed(area, currency, months):
    """What would raise the area's score; a plain statement when it already has full marks."""
    if not area.scored:
        return _not_scored_needed(area, months)
    if area.points == area.max_points:
        return NOTHING_MORE
    d = area.details
    maximum = area.max_points
    if area.key == c.INCOME_CONSISTENCY:
        if d['swing'] is None:
            return 'To score higher, record the payments you received in these months.'
        return (
            f'To score higher, make your months more even. At a swing of {_p(c.CONSISTENCY_FULL_AT)}% or less you get '
            f'all {maximum} points; yours is {pct(d["swing"])}%.'
        )
    if area.key == c.PROFIT_MARGIN:
        kept = f'you kept {pct(d["margin"])}%.' if d['net'] > 0 else 'you kept nothing.'
        return (
            f'To score higher, keep more of your income. When {_p(c.MARGIN_FULL_AT)}% or more is left you get all '
            f'{maximum} points; {kept}'
        )
    if area.key == c.TAX_COMPLIANCE:
        missing = '; '.join(check['label'] for check in d['checks'] if not check['done'])
        return f'To score higher, complete the missing checks: {missing}.'
    if area.key == c.INCOME_GROWTH:
        return (
            f'To score higher, grow your average month. At growth of {_p(c.GROWTH_FULL_AT)}% or more you get all '
            f'{maximum} points; yours is {change_phrase(d["growth"])}.'
        )
    if area.key == c.CLIENT_DIVERSITY:
        return (
            'To score higher, spread your income across more payers. When your biggest payer is '
            f'{_p(c.SHARE_FULL_AT)}% or less you get all {maximum} points; yours is {pct(d["top_share"])}%.'
        )
    raise KeyError(area.key)


def action_text(action, currency):
    """One improvement step as a sentence. The gain sentence is added only when the gain is known."""
    n = action.numbers
    gain = gain_sentence(action.gain)
    key = action.text_key
    if key == 'consistency_gaps':
        return (
            f'No payment is recorded in {n["gaps"]} of your {plural(n["months"], "full month")}. If you were paid in any '
            'of them, record the payment; until you do, they count as months with no income.'
        )
    if key == 'consistency_weakest':
        return (
            f'Your weakest month, {month_name(n["month"])}, brought in {money(n["weakest"], currency)}, against '
            f'{money(n["typical"], currency)} in a typical month. Bringing it up to a typical month would raise this area.{gain}'
        )
    if key == 'consistency_weakest_zero':
        return (
            f'Your weakest month, {month_name(n["month"])}, has no payment recorded, against '
            f'{money(n["typical"], currency)} in a typical month. A typical month there would raise this area.{gain}'
        )
    if key == 'consistency_first_payment':
        return 'Record the payments you have received on the Payments page, or import them from a CSV file.'
    if key == 'margin_costs':
        group = ''
        if n.get('category'):
            group = f' Your largest group was {n["category"]} at {money(n["category_total"], currency)}.'
        return (
            f'Your expenses were {pct(n["cost_ratio"])}% of your income ({money(n["expenses"], currency)} against '
            f'{money(n["income"], currency)}).{group} Spending {money(n["delta"], currency)} less '
            f'({_p(c.MARGIN_STEP)}% of your income) would raise this area.{gain}'
        )
    if key == 'margin_record':
        return (
            f'No expenses are recorded in the last {plural(n["months"], "month")}, so your profit margin cannot be '
            'measured. Record your business costs (internet, software, equipment, platform fees) on the Expenses page.'
        )
    if key == 'tax_ntn':
        return f'Save your NTN in Settings, then Tax & PSEB. An NTN is the number you need to file a tax return with FBR.{gain}'
    if key == 'tax_pseb':
        return (
            'If you are registered with PSEB, mark it in Settings, then Tax & PSEB. PSEB registration is for people who '
            f'export IT services, so it may not apply to your work.{gain}'
        )
    if key == 'tax_payment':
        return f'No payment is recorded in the last {c.RECENT_DAYS} days. Record the money you have received on the Payments page.{gain}'
    if key == 'tax_expense':
        return (
            f'No expense is recorded in the last {c.RECENT_DAYS} days. Record your business costs on the Expenses page, '
            f'so your profit is not overstated.{gain}'
        )
    if key == 'growth':
        return (
            f'Your average month was {money(n["average_recent"], currency)} over the last {plural(n["months_recent"], "month")}, '
            f'against {money(n["average_earlier"], currency)} over the {plural(n["months_earlier"], "month")} before. '
            f'An average month of {money(n["target"], currency)} ({_p(c.GROWTH_TARGET)}% above the earlier months) would '
            f'raise this area.{gain}'
        )
    if key == 'diversity_spread':
        return (
            f'{n["name"]} paid {pct(n["share"])}% of the income that has a name ({money(n["amount"], currency)} of '
            f'{money(n["named"], currency)}). If your biggest payer were {_p(c.SPREAD_TARGET)}% of it, that would raise '
            f'this area.{gain}'
        )
    if key == 'diversity_names':
        return (
            f'Only {pct(n["coverage"])}% of your income has a "Received from" name. Fill in that name on your payments '
            f'until at least {_p(c.PAYER_COVERAGE_MIN)}% of your income has one.'
        )
    raise KeyError(key)


def notes(scored_count, available, show_partial, currency, unconverted_payments, unconverted_expenses):
    """The notes under the score, in order. The first and the last always appear."""
    result = [NOTE_FULL_MONTHS]
    if show_partial:
        result.append(
            f'This score covers {scored_count} of {len(c.AREAS)} areas ({available} of {c.TOTAL_POINTS} points). The other '
            'areas could not be measured yet, and the score will change when they can.'
        )
    parts = []
    if unconverted_payments:
        parts.append(plural(unconverted_payments, 'payment'))
    if unconverted_expenses:
        parts.append(plural(unconverted_expenses, 'expense'))
    if parts:
        result.append(f'Some records could not be converted to {currency} and are left out: {" and ".join(parts)}.')
    result.append(NOTE_GUIDE)
    return result
