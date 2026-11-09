# apps/health/service.py
"""
Assembles the Health Score payload from Facts: the scoring, the improvement steps and the sentences. The page
(`score`) and the Dashboard widget (`mini`) are both built here, so they can never disagree (decision H14).
"""
from decimal import ROUND_HALF_UP, Decimal

from apps.payments import rollup

from . import constants as c
from . import copy, facts as facts_module, scoring, tips

ONE_DECIMAL = Decimal('0.1')


def pct1(ratio):
    """A ratio as a percentage number with one decimal (half up), or None. The only float in the payload."""
    if ratio is None:
        return None
    return float((Decimal(ratio) * 100).quantize(ONE_DECIMAL, rounding=ROUND_HALF_UP))


def _money(value):
    return None if value is None else rollup.money(value)


def _details(area):
    d = area.details
    if area.key == c.INCOME_CONSISTENCY:
        weakest = d['weakest']
        return {
            'months_counted': d['months_counted'],
            'average': _money(d['average']),
            'swing_pct': pct1(d['swing']),
            'months_without_income': d['months_without_income'],
            'weakest_month': None if weakest is None else {'month': weakest[0], 'income': rollup.money(weakest[1])},
            'typical_month': _money(d['typical']),
        }
    if area.key == c.PROFIT_MARGIN:
        largest = d['largest']
        return {
            'income': _money(d['income']),
            'expenses': _money(d['expenses']),
            'net': _money(d['net']),
            'margin_pct': pct1(d['margin']),
            'expense_count': d['expense_count'],
            'largest_category': None if largest is None else {'category': largest[0], 'label': largest[1], 'total': rollup.money(largest[2])},
        }
    if area.key == c.TAX_COMPLIANCE:
        return {'checks': [dict(check) for check in d['checks']]}
    if area.key == c.INCOME_GROWTH:
        return {
            'months_recent': d['months_recent'],
            'months_earlier': d['months_earlier'],
            'average_recent': _money(d['average_recent']),
            'average_earlier': _money(d['average_earlier']),
            'change_pct': pct1(d['growth']),
        }
    return {
        'named_payers': d['named_payers'],
        'top_payer': d['top_payer'],
        'top_share_pct': pct1(d['top_share']),
        'named_income': _money(d['named_income']),
        'unnamed_income': _money(d['unnamed_income']),
        'named_share_pct': pct1(d['coverage']),
    }


def _dimension(area, actions, facts):
    percent = None if area.points is None else scoring.round_half_up(Decimal(area.points) * 100 / area.max_points)
    return {
        'key': area.key,
        'label': c.AREA_LABELS[area.key],
        'max_points': area.max_points,
        'status': area.status,
        'reason': area.reason,
        'points': area.points,
        'percent': percent,
        'about': copy.area_about(area.key),
        'measure': copy.measure(area, facts.currency, facts.months),
        'needed': copy.needed(area, facts.currency, facts.months),
        'steps': [copy.action_text(action, facts.currency) for action in actions],
        'details': _details(area),
    }


def _tip(action, currency):
    return {'dimension': action.dimension, 'kind': action.kind, 'text': copy.action_text(action, currency), 'gain': action.gain}


def build_score(user, months=c.DEFAULT_WINDOW, now=None):
    """The whole score page for `user` over `months` full calendar months."""
    facts = facts_module.gather(user, months, now)
    areas = scoring.score_all(facts)
    total = scoring.overall(areas)
    actions = tips.build_actions(facts, areas, total)
    scored_count = sum(1 for area in areas if area.scored)
    return {
        'currency': facts.currency,
        'months': facts.months,
        'window': {
            'start': facts.window_start.isoformat(),
            'end': facts.window_end.isoformat(),
            'earlier_start': facts.earlier_start.isoformat(),
            'earlier_end': facts.earlier_end.isoformat(),
        },
        'score': total.score,
        'grade': total.grade,
        'grade_label': total.grade_label,
        'available_points': total.available,
        'earned_points': total.earned,
        'partial': total.partial,
        'message': None if total.score is not None else copy.NO_SCORE_MESSAGE,
        'dimensions': [_dimension(area, actions[area.key], facts) for area in areas],
        'tips': [_tip(action, facts.currency) for action in tips.ranked(actions)],
        'notes': copy.notes(
            scored_count, total.available, total.partial and total.score is not None, facts.currency,
            facts.unconverted_payments, facts.unconverted_expenses,
        ),
        'counts': {
            'payments_in_window': facts.income_count,
            'expenses_in_window': facts.expense_count,
            'unconverted_payments': facts.unconverted_payments,
            'unconverted_expenses': facts.unconverted_expenses,
        },
    }


def build_mini(user, now=None):
    """The Dashboard widget: the same 12-month score, plus the single best tip."""
    payload = build_score(user, c.DEFAULT_WINDOW, now)
    return {
        'currency': payload['currency'],
        'months': payload['months'],
        'score': payload['score'],
        'grade': payload['grade'],
        'grade_label': payload['grade_label'],
        'partial': payload['partial'],
        'message': payload['message'],
        'top_tip': payload['tips'][0] if payload['tips'] else None,
    }
