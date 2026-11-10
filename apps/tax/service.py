# apps/tax/service.py
"""
Assembles the four Tax payloads. Request-free: no view, no Response. `build_overview` is the one place the
overview numbers are put together; the PDF calls it too, so the page and the document cannot disagree.

Parsing of the tax year lives here (`parse_tax_year`, `parse_calculator_input`) so the overview, the calculator
and the PDF view all accept and refuse exactly the same values.
"""
import re
from decimal import Decimal

from . import calc, copy, facts, law

NOT_STARTED = 'That tax year has not started.'
SHAPE_ERROR = 'Send a JSON object with taxable_income.'
REQUIRED_ERROR = 'taxable_income is required.'
UNPARSABLE_ERROR = 'taxable_income must be a number of rupees, for example 1500000 or 1500000.50.'
NEGATIVE_ERROR = 'taxable_income cannot be negative.'
TOO_BIG_ERROR = f'taxable_income cannot be more than {law.CALCULATOR_MAX_INCOME:,}.'
SURCHARGE_UNVERIFIED_ERROR = (
    f'For tax year 2026, income above Rs {law.SURCHARGE_THRESHOLD:,} carries a surcharge and we have not confirmed its '
    'rate, so we do not calculate it. Ask a tax advisor.'
)
_INCOME_PATTERN = re.compile(r'-?[0-9]+(\.[0-9]{1,2})?')


def today():
    """The date the figures are computed for. Delegates to facts.today at call time so a test can patch it in one place."""
    return facts.today()


def tax_year_error():
    """'tax_year must be 2026 or 2027.' built from the supported years."""
    years = [str(y) for y in law.SUPPORTED_TAX_YEARS]
    listed = years[0] if len(years) == 1 else ', '.join(years[:-1]) + ' or ' + years[-1]
    return f'tax_year must be {listed}.'


def parse_tax_year(raw, today):
    """
    (tax_year, stale_law, error message or None). `raw` is the query-string value or None. Omitted gives the
    default for `today`; otherwise only the exact strings of the supported years are accepted.
    """
    if raw is None:
        year, stale = law.default_tax_year(today)
        return year, stale, None
    for year in law.SUPPORTED_TAX_YEARS:
        if raw == str(year):
            if law.tax_year_bounds(year)[0] > today:
                return None, False, NOT_STARTED
            return year, False, None
    return None, False, tax_year_error()


def _parse_income(raw):
    """(Decimal or None, error). A JSON string of digits (up to 2 decimals) or a JSON integer; a bool is not an integer."""
    if isinstance(raw, bool):
        return None, UNPARSABLE_ERROR
    if isinstance(raw, int):
        value = Decimal(raw)
    elif isinstance(raw, str):
        if _INCOME_PATTERN.fullmatch(raw) is None:
            return None, UNPARSABLE_ERROR
        value = Decimal(raw)
    else:
        return None, UNPARSABLE_ERROR
    if value < 0:
        return None, NEGATIVE_ERROR
    if value > law.CALCULATOR_MAX_INCOME:
        return None, TOO_BIG_ERROR
    return value + 0, None  # + 0 turns a negative zero into zero


def parse_calculator_input(body, today):
    """(taxable_income Decimal, tax_year int, error message or None) for the calculator's JSON body."""
    if not isinstance(body, dict):
        return None, None, SHAPE_ERROR
    if 'taxable_income' not in body:
        return None, None, REQUIRED_ERROR
    income, error = _parse_income(body['taxable_income'])
    if error:
        return None, None, error
    if 'tax_year' not in body:
        year, _stale = law.default_tax_year(today)
        return income, year, None
    raw = body['tax_year']
    if isinstance(raw, bool) or not isinstance(raw, (int, str)):
        return None, None, tax_year_error()
    if isinstance(raw, int) and raw in law.SUPPORTED_TAX_YEARS:
        return income, raw, None
    if isinstance(raw, str):
        for year in law.SUPPORTED_TAX_YEARS:
            if raw == str(year):
                return income, year, None
    return None, None, tax_year_error()


def build_overview(user, tax_year, stale_law=False, now=None):
    """The overview payload (see CLAUDE.md Module 4) for one tax year. Money is two-decimal strings."""
    now = now or today()
    f = facts.gather(user, tax_year, now)
    in_progress = now <= f.end
    current_year = law.tax_year_of(now)
    return {
        'tax_year': f.tax_year,
        'label': f'Tax year {f.tax_year}',
        'start': f.start.isoformat(),
        'end': f.end.isoformat(),
        'counted_to': f.counted_to.isoformat(),
        'status': 'in_progress' if in_progress else 'complete',
        'currency': facts.LOCAL_CURRENCY,
        'rate': {
            'percent': law.export_rate_percent(f.has_pseb_number),
            'basis': copy.rate_basis(f.has_pseb_number),
            'pseb_marked_without_number': f.pseb_marked and not f.has_pseb_number,
            'sentence': copy.rate_sentence(f.has_pseb_number, f.pseb_marked),
        },
        'export': {
            'total': calc.money(f.export_total),
            'count': f.export_count,
            'expected_deduction': calc.money(f.expected_deduction),
            'by_currency': [
                {'currency': code, 'amount': calc.money(amount), 'count': count} for code, amount, count in f.by_currency
            ],
        },
        'local': {'total': calc.money(f.local_total), 'count': f.local_count},
        'monthly': [
            {
                'month': m.month,
                'export_receipts': calc.money(m.export_receipts),
                'expected_deduction': calc.money(m.expected_deduction),
                'local_receipts': calc.money(m.local_receipts),
            }
            for m in f.monthly
        ],
        'unconverted_count': f.unconverted_count,
        'estimated_count': f.estimated_count,
        'return': {'due': law.return_due(f.tax_year).isoformat(), 'sentence': copy.return_sentence(f.tax_year, now)},
        'has_ntn': f.has_ntn,
        'checklist': copy.checklist(
            has_ntn=f.has_ntn, has_pseb_number=f.has_pseb_number, pseb_marked=f.pseb_marked, tax_year=f.tax_year,
        ),
        'not_covered': list(law.NOT_COVERED),
        'notes': copy.overview_notes(
            unconverted_count=f.unconverted_count, estimated_count=f.estimated_count, in_progress=in_progress,
            start=f.start, counted_to=f.counted_to, stale_law=stale_law, current_year=current_year, used_year=f.tax_year,
        ),
        'stale_law': stale_law,
        'law': {'version': law.LAW_VERSION, 'last_verified': law.LAST_VERIFIED.isoformat()},
        # Not part of the JSON contract: lets the PDF view refuse a year with no payment at all without a second query.
        '_payment_count': f.payment_count,
    }


def public_overview(payload):
    """The overview without its internal keys (those starting with an underscore)."""
    return {key: value for key, value in payload.items() if not key.startswith('_')}


def build_law():
    """The sourced facts behind the numbers. Static; no database."""
    return {
        'version': law.LAW_VERSION,
        'last_verified': law.LAST_VERIFIED.isoformat(),
        'tax_years': list(law.SUPPORTED_TAX_YEARS),
        'facts': [
            {'id': f['id'], 'title': f['title'], 'text': f['text'], 'confidence': f['confidence'], 'sources': list(f['sources'])}
            for f in law.FACTS
        ],
        'sources': [dict(s) for s in law.SOURCES],
        'not_covered': list(law.NOT_COVERED),
        'links': dict(law.LINKS),
    }


def build_slab_result(taxable_income, tax_year):
    """The calculator payload. Raises calc.SurchargeUnverified when the income needs a surcharge we cannot verify."""
    result = calc.slab_tax(taxable_income, tax_year)
    effective = result['effective_percent']
    return {
        'tax_year': tax_year,
        'taxable_income': calc.money(taxable_income),
        'bands': [
            {
                'from': calc.money(b['from']),
                'to': None if b['to'] is None else calc.money(b['to']),
                'rate_percent': b['rate_percent'],
                'income_in_band': calc.money(b['income_in_band']),
                'tax': calc.money(b['tax']),
            }
            for b in result['bands']
        ],
        'tax_before_surcharge': calc.money(result['tax_before_surcharge']),
        'surcharge_percent': result['surcharge_percent'],
        'surcharge': calc.money(result['surcharge']),
        'total_tax': calc.money(result['total_tax']),
        'effective_percent': None if effective is None else float(effective),
        'marginal_percent': result['marginal_percent'],
        'notes': copy.calculator_notes(tax_year, result['surcharge_percent'] is not None),
    }
