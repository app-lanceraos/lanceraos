# apps/tax/calc.py
"""
Tax arithmetic, pure: no Django, no apps.*, no database. Every rate and band comes from `law`.

Rounding (decision T5, T6): the estimated tax of ONE payment is (PKR value x rate) rounded to 0.01 with
ROUND_HALF_UP, and every total is the exact sum of those rounded values. The slab tax is computed band by band
in exact Decimal; the tax before the surcharge is rounded once, the surcharge is taken from that rounded
figure and rounded, and the total is the sum of the two printed figures, so everything printed adds up.
"""
from decimal import ROUND_HALF_UP, Decimal

from . import law

CENT = Decimal('0.01')
TENTH = Decimal('0.1')
HUNDRED = Decimal('100')
ZERO = Decimal('0')


class SurchargeUnverified(Exception):
    """The income needs a surcharge whose rate is not verified for this tax year, so no figure is calculated."""


def cents(value):
    """A Decimal rounded to 0.01, ROUND_HALF_UP."""
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


def export_deduction(pkr_value, rate):
    """(PKR value x rate) rounded to 0.01 ROUND_HALF_UP. `rate` is a Decimal fraction such as 0.0025."""
    return cents(pkr_value * rate)


def money(value):
    """A Decimal as the two-decimal string every tax payload uses."""
    return str(cents(value))


def slab_tax(taxable_income, tax_year):
    """
    Normal-rate tax for a non-salaried individual on `taxable_income` (a Decimal >= 0) in `tax_year` (an int).
    Returns a dict of Decimals, ints-as-strings and lists:
      bands: [{'from', 'to', 'rate_percent', 'income_in_band', 'tax'}] for bands with income in them
             (Decimals; 'to' is None for the open band; 'rate_percent' is a string)
      tax_before_surcharge, surcharge, total_tax: Decimals rounded to 0.01
      surcharge_percent: the percent string, or None when no surcharge applies
      effective_percent: Decimal with one place, or None for an income of 0
      marginal_percent: the rate of the band that contains the income, as a string
    Raises SurchargeUnverified when the income is above the surcharge threshold and the year's rate is unverified.
    """
    income = Decimal(taxable_income)
    bands, exact_total = [], ZERO
    marginal = law.NON_SALARIED_BANDS[0][2]
    for lower, upper, percent, _fixed in law.NON_SALARIED_BANDS:
        top = income if upper is None else min(income, Decimal(upper))
        in_band = top - Decimal(lower)
        if income > lower:
            marginal = percent
        if in_band <= 0:
            continue
        exact = in_band * Decimal(percent) / HUNDRED
        exact_total += exact
        bands.append({
            'from': Decimal(lower), 'to': None if upper is None else Decimal(upper),
            'rate_percent': percent, 'income_in_band': in_band, 'tax': cents(exact),
        })

    before = cents(exact_total)
    surcharge, surcharge_percent = cents(ZERO), None
    if income > law.SURCHARGE_THRESHOLD:
        percent = law.surcharge_percent(tax_year)
        if percent is None:
            raise SurchargeUnverified(tax_year)
        surcharge_percent = percent
        surcharge = cents(before * Decimal(percent) / HUNDRED)
    total = before + surcharge
    effective = None if income == 0 else (total / income * HUNDRED).quantize(TENTH, rounding=ROUND_HALF_UP)
    return {
        'bands': bands,
        'tax_before_surcharge': before,
        'surcharge_percent': surcharge_percent,
        'surcharge': surcharge,
        'total_tax': total,
        'effective_percent': effective,
        'marginal_percent': marginal,
    }
