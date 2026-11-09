# apps/health/tips.py
"""
"How to improve", computed and never guessed (decision H12). Every improvement is a counterfactual: the SAME
scoring functions are run on a modified copy of the facts (dataclasses.replace), and the gain is the change in
the DISPLAYED total, not a separate estimate. A step whose gain is under one point is dropped. Pure: no Django,
no apps.*, no AI.
"""
from dataclasses import replace
from decimal import ROUND_HALF_UP, Decimal

from . import constants as c
from . import scoring
from .domain import Action, Facts

ZERO = Decimal('0')
CENT = Decimal('0.01')
HYPOTHETICAL_PAYER = 'another payer'


def _total(facts):
    return scoring.overall(scoring.score_all(facts)).score


def _gain(facts, before, **changes):
    """Score after the change minus score before it; None when either side has no score."""
    if before is None:
        return None
    after = _total(replace(facts, **changes))
    if after is None:
        return None
    return after - before


def _improve(facts, before, dimension, text_key, numbers, **changes):
    """An `improve` action with its computed gain, or None when the gain is below one point (or unknown)."""
    gain = _gain(facts, before, **changes)
    if gain is None or gain < 1:
        return None
    return Action(dimension, 'improve', text_key, numbers, gain)


def _record(dimension, text_key, numbers=None):
    return Action(dimension, 'record', text_key, numbers or {}, None)


def _consistency_actions(facts, area, before):
    actions = []
    months = facts.income_months
    gaps = sum(1 for _m, amount in months if amount == ZERO)
    if gaps:
        actions.append(_record(c.INCOME_CONSISTENCY, 'consistency_gaps', {'gaps': gaps, 'months': len(months)}))
    if area.reason == c.REASON_NO_PAYMENTS:
        actions.append(_record(c.INCOME_CONSISTENCY, 'consistency_first_payment'))
    if area.scored:
        weak_month, weak_income = area.details['weakest']
        typical = area.details['typical']
        if weak_income < typical * c.WEAK_MONTH_RATIO:
            lifted = tuple((m, typical if m == weak_month else amount) for m, amount in months)
            key = 'consistency_weakest_zero' if weak_income == ZERO else 'consistency_weakest'
            action = _improve(
                facts, before, c.INCOME_CONSISTENCY, key,
                {'month': weak_month, 'weakest': weak_income, 'typical': typical},
                income_months=lifted,
            )
            if action:
                # Table order: gaps first, then the weakest month.
                actions.append(action)
    order = {'consistency_gaps': 0, 'consistency_weakest': 1, 'consistency_weakest_zero': 1, 'consistency_first_payment': 2}
    return sorted(actions, key=lambda a: order[a.text_key])


def _margin_actions(facts, area, before):
    if area.reason == c.REASON_NO_EXPENSES:
        return [_record(c.PROFIT_MARGIN, 'margin_record', {'months': facts.months})]
    if not area.scored or area.details['margin'] >= c.MARGIN_FULL_AT:
        return []
    income = facts.income_total
    delta = (income * c.MARGIN_STEP).quantize(CENT, rounding=ROUND_HALF_UP)
    lowered = max(ZERO, facts.expense_total - income * c.MARGIN_STEP)
    top = facts.expense_top
    action = _improve(
        facts, before, c.PROFIT_MARGIN, 'margin_costs',
        {
            'cost_ratio': facts.expense_total / income, 'expenses': facts.expense_total, 'income': income,
            'category': top[1] if top else None, 'category_total': top[2] if top else None, 'delta': delta,
        },
        expense_total=lowered,
    )
    return [action] if action else []


TAX_ACTIONS = {
    'ntn': ('tax_ntn', 'has_ntn'),
    'pseb': ('tax_pseb', 'has_pseb'),
    'recent_payment': ('tax_payment', 'recent_payment'),
    'recent_expense': ('tax_expense', 'recent_expense'),
}


def _tax_actions(facts, area, before):
    actions = []
    for check in area.details['checks']:
        if check['done']:
            continue
        text_key, field_name = TAX_ACTIONS[check['key']]
        if before is None:
            actions.append(_record(c.TAX_COMPLIANCE, text_key))
            continue
        action = _improve(facts, before, c.TAX_COMPLIANCE, text_key, {}, **{field_name: True})
        if action:
            actions.append(action)
    return actions


def _growth_actions(facts, area, before):
    if not area.scored or area.details['growth'] >= c.GROWTH_TIP_BELOW:
        return []
    details = area.details
    months_recent = details['months_recent']
    target_average = details['average_earlier'] * (1 + c.GROWTH_TARGET)
    action = _improve(
        facts, before, c.INCOME_GROWTH, 'growth',
        {
            'average_recent': details['average_recent'], 'average_earlier': details['average_earlier'],
            'months_recent': months_recent, 'months_earlier': details['months_earlier'],
            'target': target_average.quantize(CENT, rounding=ROUND_HALF_UP),
        },
        recent_total=target_average * months_recent,
    )
    return [action] if action else []


def _diversity_actions(facts, area, before):
    if area.reason == c.REASON_FEW_PAYER_NAMES:
        return [_record(c.CLIENT_DIVERSITY, 'diversity_names', {'coverage': area.details['coverage']})]
    if not area.scored or area.details['top_share'] <= c.SPREAD_TIP_ABOVE:
        return []
    details = area.details
    named = details['named_income']
    ordered = sorted(facts.payers, key=lambda item: (-item[1], item[0]))
    (top_name, top_amount), others = ordered[0], ordered[1:]
    capped = named * c.SPREAD_TARGET
    spread = [(top_name, capped), (HYPOTHETICAL_PAYER, top_amount - capped)] + others
    action = _improve(
        facts, before, c.CLIENT_DIVERSITY, 'diversity_spread',
        {'name': top_name, 'share': details['top_share'], 'amount': top_amount, 'named': named},
        payers=tuple(sorted(spread, key=lambda item: (-item[1], item[0]))),
    )
    return [action] if action else []


ACTION_BUILDERS = {
    c.INCOME_CONSISTENCY: _consistency_actions,
    c.PROFIT_MARGIN: _margin_actions,
    c.TAX_COMPLIANCE: _tax_actions,
    c.INCOME_GROWTH: _growth_actions,
    c.CLIENT_DIVERSITY: _diversity_actions,
}


def build_actions(facts: Facts, areas, overall):
    """
    Every action, grouped by area in the fixed area order and, inside an area, in the order the steps are shown.
    Returns {area key: [Action, ...]}. With no overall score no gain exists: only the four tax checks stay
    (as `record` steps), every other `improve` step is dropped.
    """
    before = overall.score
    by_key = {area.key: area for area in areas}
    result = {}
    for key in c.AREA_KEYS:
        actions = ACTION_BUILDERS[key](facts, by_key[key], before)
        result[key] = actions
    return result


def ranked(actions_by_area, limit=c.TIP_LIMIT):
    """
    The page's tip list: `improve` actions by gain (highest first, ties by area order), then the `record`
    actions in area order, cut to `limit`.
    """
    area_order = {key: index for index, key in enumerate(c.AREA_KEYS)}
    flat = [action for key in c.AREA_KEYS for action in actions_by_area[key]]
    improve = sorted(
        (a for a in flat if a.kind == 'improve'),
        key=lambda a: (-a.gain, area_order[a.dimension]),
    )
    record = [a for a in flat if a.kind == 'record']
    return (improve + record)[:limit]
