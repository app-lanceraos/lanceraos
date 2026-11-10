# apps/tax/facts.py
"""
The only module of apps.tax that reads the database. `gather` turns the income ledger into one TaxFacts object:
ONE query for the income rows of the tax year, one for the snapshots they reference, one for the profile, so the
cost is the same for 5 payments or 5,000.

What is export money (decision T3): a payment in any currency other than PKR. A payment in PKR is a local
payment and gets no bank-deduction estimate. The rate (decision T4) comes from whether a validated PSEB number is
saved (`pseb_hash`), never from the self-declared `pseb_registered` flag.
"""
from collections import defaultdict
from decimal import Decimal

from django.utils import timezone

from apps.payments import ledger, rollup
from apps.payments.constants import RATE_ESTIMATED
from apps.payments.models import ExchangeRateSnapshot

from . import calc, law
from .domain import MonthFacts, TaxFacts

ZERO = Decimal('0')
LOCAL_CURRENCY = 'PKR'


def today():
    """The date the figures are computed for (PKT, USE_TZ is False). A module-level function so tests can patch it."""
    return timezone.now().date()


def gather(user, tax_year, now=None) -> TaxFacts:
    now = now or today()
    start, end = law.tax_year_bounds(tax_year)
    counted_to = min(end, now)

    profile = user.profile
    has_pseb_number = bool(profile.pseb_hash)
    rate = law.export_rate(has_pseb_number)

    rows = ledger.income_rows(user, start, counted_to)
    current = ExchangeRateSnapshot.get_current()
    snapshots = rollup.load_snapshots(rows)

    months = rollup.month_keys(start, counted_to)
    export_by_month = {m: ZERO for m in months}
    deduction_by_month = {m: ZERO for m in months}
    local_by_month = {m: ZERO for m in months}
    currencies = defaultdict(lambda: [ZERO, 0])
    export_count = local_count = unconverted = estimated = payment_count = 0

    for row in rows:
        if not start <= row.on_date <= counted_to:
            continue
        payment_count += 1
        is_export = row.currency != LOCAL_CURRENCY
        if is_export:
            bucket = currencies[row.currency]
            bucket[0] += row.amount
            bucket[1] += 1
        value = rollup.convert_row(row, LOCAL_CURRENCY, snapshots, current)
        if value is None:
            unconverted += 1
            continue
        month = row.on_date.strftime('%Y-%m')
        if is_export:
            export_count += 1
            export_by_month[month] += value
            deduction_by_month[month] += calc.export_deduction(value, rate)
            if row.rate_basis == RATE_ESTIMATED:
                estimated += 1
        else:
            local_count += 1
            local_by_month[month] += value

    return TaxFacts(
        tax_year=tax_year, start=start, end=end, counted_to=counted_to, rate=rate,
        has_pseb_number=has_pseb_number, pseb_marked=bool(profile.pseb_registered), has_ntn=bool(profile.ntn_encrypted),
        export_total=sum(export_by_month.values(), ZERO), export_count=export_count,
        expected_deduction=sum(deduction_by_month.values(), ZERO),
        local_total=sum(local_by_month.values(), ZERO), local_count=local_count,
        by_currency=tuple((code, amount, count) for code, (amount, count) in sorted(currencies.items())),
        monthly=tuple(MonthFacts(m, export_by_month[m], deduction_by_month[m], local_by_month[m]) for m in months),
        unconverted_count=unconverted, estimated_count=estimated, payment_count=payment_count,
    )
