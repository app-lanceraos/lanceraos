# apps/tax/domain.py
"""The plain data the database module hands to the pure modules. No Django, no apps.*."""
from dataclasses import dataclass
from datetime import date
from decimal import Decimal


@dataclass(frozen=True)
class MonthFacts:
    """One calendar month of the tax year: PKR values, each export payment's tax rounded on its own and then summed."""
    month: str                 # 'YYYY-MM'
    export_receipts: Decimal
    expected_deduction: Decimal
    local_receipts: Decimal


@dataclass(frozen=True)
class TaxFacts:
    tax_year: int
    start: date
    end: date
    counted_to: date
    rate: Decimal                      # the Decimal fraction used for the export estimate (from law.export_rate)
    has_pseb_number: bool
    pseb_marked: bool                  # the self-declared checkbox; used for the wording only, never for the rate
    has_ntn: bool
    export_total: Decimal
    export_count: int
    expected_deduction: Decimal
    local_total: Decimal
    local_count: int
    by_currency: tuple                 # ((code, original amount, count), ...) every non-PKR payment, unconverted ones included
    monthly: tuple                     # (MonthFacts, ...) every month from the start of the tax year to counted_to
    unconverted_count: int
    estimated_count: int
    payment_count: int                 # every payment in the period, converted or not
