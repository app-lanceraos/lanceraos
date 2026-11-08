# apps/payments/rates.py
"""
Which exchange rate a payment freezes, and how trustworthy it is.

A payment's rate comes from the ExchangeRateSnapshot NEAREST its payment_date, not from
today's snapshot: a report of a past month must not move when today's rate moves
(Payments core, decision P4). Snapshots only exist from the day the daily fetch started,
so a payment older than the oldest snapshot gets that snapshot's rate and is labelled
`estimated`. Request-free: no view, no serializer.
"""
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from .constants import NEARBY_MAX_DAYS, RATE_ESTIMATED, RATE_EXACT, RATE_NEARBY, RATE_NONE
from .models import ExchangeRateSnapshot

# Payment.rate_to_usd is Decimal(18,10); quantize here so the in-memory object equals what the
# database will hold after a reload.
RATE_QUANTUM = Decimal('1E-10')


@dataclass(frozen=True)
class RateContext:
    rate_to_usd: Decimal | None
    snapshot: ExchangeRateSnapshot | None
    basis: str


def basis_for_distance(days):
    """Same day = exact, within NEARBY_MAX_DAYS = nearby, anything farther = estimated."""
    days = abs(days)
    if days == 0:
        return RATE_EXACT
    if days <= NEARBY_MAX_DAYS:
        return RATE_NEARBY
    return RATE_ESTIMATED


def _nearest_snapshots(on_date):
    """
    Up to two candidates, closest first: the nearest snapshot on or before `on_date` and the
    nearest after it (two queries). A tie in distance goes to the earlier one.
    """
    before = ExchangeRateSnapshot.objects.filter(date__lte=on_date).order_by('-date').first()
    after = ExchangeRateSnapshot.objects.filter(date__gt=on_date).order_by('date').first()
    ranked = []
    if before is not None:
        ranked.append(((on_date - before.date).days, 0, before))
    if after is not None:
        ranked.append(((after.date - on_date).days, 1, after))
    ranked.sort(key=lambda item: (item[0], item[1]))
    return [(distance, snapshot) for distance, _tie, snapshot in ranked]


def rate_context(currency: str, on_date: date) -> RateContext:
    """
    The frozen rate for `currency` on `on_date`.

    USD is always rate 1 but still attaches the nearest snapshot, because a later report in
    another currency needs that day's OTHER leg (precedent: Invoice.capture_issue_rate()
    attaches a snapshot for USD invoices too). With no snapshots at all USD is (1, None,
    exact) and any other currency is (None, None, none).
    """
    candidates = _nearest_snapshots(on_date)

    if currency == 'USD':
        if not candidates:
            return RateContext(Decimal('1'), None, RATE_EXACT)
        distance, snapshot = candidates[0]
        return RateContext(Decimal('1'), snapshot, basis_for_distance(distance))

    for distance, snapshot in candidates:
        raw = snapshot.rates_to_usd.get(currency)
        if raw is None:
            continue
        rate = Decimal(str(raw)).quantize(RATE_QUANTUM)
        if rate <= 0:
            continue
        return RateContext(rate, snapshot, basis_for_distance(distance))
    return RateContext(None, None, RATE_NONE)
