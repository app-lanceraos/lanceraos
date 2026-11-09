# apps/health/scoring.py
"""
The Health Score maths: pure functions over a Facts object. No Django, no apps.*, no database, no request.
Everything is a Decimal; points are whole numbers (half up) so the numbers on the page add up (decision H4).
"""
from decimal import ROUND_HALF_UP, Decimal

from . import constants as c
from .domain import AreaResult, Facts, Overall

ZERO = Decimal('0')
ONE = Decimal('1')
CENT = Decimal('0.01')
SCORED = 'scored'
NOT_ENOUGH = 'not_enough_data'


def round_half_up(value):
    return int(Decimal(value).quantize(ONE, rounding=ROUND_HALF_UP))


def linear_points(value, zero_at, full_at, max_points):
    """
    Whole points on a straight line: `zero_at` scores 0, `full_at` scores `max_points`, beyond either end is
    clamped. Works in both directions (a lower value can be better). Half up: 7.5 -> 8.
    """
    ratio = (Decimal(value) - zero_at) / (full_at - zero_at)
    ratio = min(ONE, max(ZERO, ratio))
    return round_half_up(ratio * max_points)


def median(values):
    """The median of Decimals, quantised to cents; the average of the two middle values when the count is even."""
    ordered = sorted(values)
    n = len(ordered)
    if n == 0:
        return ZERO
    mid = n // 2
    value = ordered[mid] if n % 2 else (ordered[mid - 1] + ordered[mid]) / 2
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


def _not_scored(key, reason, details):
    return AreaResult(key, NOT_ENOUGH, reason, None, c.AREA_MAX[key], details)


def _scored(key, points, details):
    return AreaResult(key, SCORED, None, points, c.AREA_MAX[key], details)


def weakest_month(income_months):
    """(month, income) of the lowest month, the earliest one on a tie; None without months."""
    if not income_months:
        return None
    return min(income_months, key=lambda item: (item[1], item[0]))


def score_income_consistency(facts: Facts) -> AreaResult:
    key = c.INCOME_CONSISTENCY
    months = facts.income_months
    n = len(months)
    blank = {
        'months_counted': n, 'average': None, 'swing': None, 'months_without_income': None,
        'weakest': None, 'typical': None,
    }
    if not facts.ever_paid:
        return _not_scored(key, c.REASON_NO_PAYMENTS, blank)
    if n < c.MIN_MONTHS:
        return _not_scored(key, c.REASON_TOO_FEW_MONTHS, blank)

    values = [amount for _month, amount in months]
    mean = sum(values) / n
    details = {
        'months_counted': n,
        'average': mean,
        'months_without_income': sum(1 for v in values if v == ZERO),
        'weakest': weakest_month(months),
        'typical': median(values),
    }
    if mean == ZERO:
        return _scored(key, 0, {**details, 'swing': None})
    variance = sum((v - mean) ** 2 for v in values) / n   # population variance, not sample
    swing = variance.sqrt() / mean
    points = linear_points(swing, c.CONSISTENCY_ZERO_AT, c.CONSISTENCY_FULL_AT, c.AREA_MAX[key])
    return _scored(key, points, {**details, 'swing': swing})


def score_profit_margin(facts: Facts) -> AreaResult:
    key = c.PROFIT_MARGIN
    blank = {
        'income': facts.income_total, 'expenses': facts.expense_total, 'net': None, 'margin': None,
        'expense_count': facts.expense_count, 'largest': facts.expense_top,
    }
    if facts.income_total <= ZERO:
        return _not_scored(key, c.REASON_NO_INCOME, blank)
    if facts.expense_count == 0:
        return _not_scored(key, c.REASON_NO_EXPENSES, blank)
    net = facts.income_total - facts.expense_total
    margin = net / facts.income_total
    points = linear_points(margin, c.MARGIN_ZERO_AT, c.MARGIN_FULL_AT, c.AREA_MAX[key])
    return _scored(key, points, {**blank, 'net': net, 'margin': margin})


def score_tax_compliance(facts: Facts) -> AreaResult:
    key = c.TAX_COMPLIANCE
    done = {
        'ntn': facts.has_ntn, 'pseb': facts.has_pseb,
        'recent_payment': facts.recent_payment, 'recent_expense': facts.recent_expense,
    }
    checks = [
        {'key': check, 'label': label, 'done': bool(done[check]), 'points': maximum if done[check] else 0, 'max_points': maximum}
        for check, label, maximum in c.TAX_CHECKS
    ]
    return _scored(key, sum(item['points'] for item in checks), {'checks': checks})


def growth_figures(facts: Facts):
    """(months_recent, average_recent, average_earlier) over the effective months of each window."""
    months_recent = len(facts.income_months)
    average_recent = facts.recent_total / months_recent if months_recent else ZERO
    average_earlier = facts.earlier_total / facts.earlier_months if facts.earlier_months else ZERO
    return months_recent, average_recent, average_earlier


def score_income_growth(facts: Facts) -> AreaResult:
    key = c.INCOME_GROWTH
    months_recent, average_recent, average_earlier = growth_figures(facts)
    blank = {
        'months_recent': months_recent, 'months_earlier': facts.earlier_months,
        'average_recent': None, 'average_earlier': None, 'growth': None,
    }
    if facts.earlier_months < c.MIN_MONTHS:
        return _not_scored(key, c.REASON_TOO_LITTLE_HISTORY, blank)
    if average_earlier == ZERO:
        return _not_scored(key, c.REASON_NO_EARLIER_INCOME, blank)
    growth = average_recent / average_earlier - ONE
    points = linear_points(growth, c.GROWTH_ZERO_AT, c.GROWTH_FULL_AT, c.AREA_MAX[key])
    details = {**blank, 'average_recent': average_recent, 'average_earlier': average_earlier, 'growth': growth}
    return _scored(key, points, details)


def named_income(facts: Facts):
    return sum((amount for _name, amount in facts.payers), ZERO)


def payer_coverage(facts: Facts):
    """The share of all income that carries a "Received from" name; zero without income."""
    if facts.income_total <= ZERO:
        return ZERO
    return named_income(facts) / facts.income_total


def score_client_diversity(facts: Facts) -> AreaResult:
    key = c.CLIENT_DIVERSITY
    named = named_income(facts)
    coverage = payer_coverage(facts)
    blank = {
        'named_payers': len(facts.payers), 'top_payer': None, 'top_amount': None, 'top_share': None,
        'named_income': named, 'unnamed_income': facts.unnamed_total, 'coverage': coverage,
    }
    if facts.income_total <= ZERO:
        return _not_scored(key, c.REASON_NO_INCOME, blank)
    if coverage < c.PAYER_COVERAGE_MIN:
        return _not_scored(key, c.REASON_FEW_PAYER_NAMES, blank)
    top_name, top_amount = min(facts.payers, key=lambda item: (-item[1], item[0]))
    share = top_amount / named
    points = linear_points(share, c.SHARE_ZERO_AT, c.SHARE_FULL_AT, c.AREA_MAX[key])
    return _scored(key, points, {**blank, 'top_payer': top_name, 'top_amount': top_amount, 'top_share': share})


SCORERS = (
    score_income_consistency,
    score_profit_margin,
    score_tax_compliance,
    score_income_growth,
    score_client_diversity,
)


def score_all(facts: Facts):
    """The five AreaResults, always in the order of constants.AREAS."""
    return [scorer(facts) for scorer in SCORERS]


def grade_for(score):
    for floor, key, label in c.GRADES:
        if score >= floor:
            return key, label
    return c.GRADES[-1][1], c.GRADES[-1][2]


def overall(areas) -> Overall:
    """
    Total over the areas that could be scored: round_half_up(100 x earned / available). Fewer than
    OVERALL_MIN_POINTS available gives no score at all. An area without enough data is left out, never zero.
    """
    scored = [area for area in areas if area.scored]
    earned = sum(area.points for area in scored)
    available = sum(area.max_points for area in scored)
    partial = len(scored) < len(areas)
    if available < c.OVERALL_MIN_POINTS:
        return Overall(earned, available, None, None, None, partial)
    score = round_half_up(Decimal(100) * earned / available)
    grade, label = grade_for(score)
    return Overall(earned, available, score, grade, label, partial)
