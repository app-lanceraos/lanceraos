# core/money.py
"""
Immutable value object for carrying an amount and its currency together
through business logic (views, tasks, PDF rendering) — replacing the
pattern of passing amount/currency as two separate loose arguments that
can drift apart from each other on the way through a call chain.

This is a plain Python object, not a Django model field, and does not
replace the separate amount/currency DB columns on models — those stay
as-is for queryability. Money is constructed from them at the point of
use and never persisted directly.

USD is the anchor currency (see apps.payments.ExchangeRateSnapshot):
rate_to_usd is the value of one unit of `currency` in USD, so converting
between any two non-USD currencies always routes through USD rather than
needing a direct rate for every currency pair.
"""
from dataclasses import dataclass
from decimal import Decimal

CENT = Decimal('0.01')


@dataclass(frozen=True)
class Money:
    amount: Decimal
    currency: str
    rate_to_usd: Decimal | None = None  # None only for USD itself

    def to_usd(self) -> Decimal:
        """
        USD converts to itself with an implicit rate of 1, regardless of
        whether rate_to_usd was supplied. Every other currency requires a
        real rate_to_usd — there is no sensible default to fall back on.
        """
        if self.currency == 'USD':
            return self.amount
        if self.rate_to_usd is None:
            raise ValueError(
                f'Cannot convert {self.currency} to USD without a rate_to_usd.'
            )
        return self.amount * self.rate_to_usd

    def convert(self, target_currency: str, snapshot) -> 'Money':
        """
        Converts via USD as the anchor: this currency -> USD -> target
        currency, using snapshot.rates_to_usd for whichever side(s) of the
        conversion aren't USD itself. Looks up rates directly from the
        snapshot rather than relying on self.rate_to_usd, so a Money
        constructed without one (or with a stale one) still converts
        correctly as long as the snapshot has both currencies.
        """
        source_rate = self._rate_for(self.currency, snapshot)
        target_rate = self._rate_for(target_currency, snapshot)

        usd_amount = self.amount * source_rate
        converted_amount = usd_amount / target_rate

        return Money(
            amount=converted_amount,
            currency=target_currency,
            rate_to_usd=target_rate,
        )

    def to_currency(self, target_currency: str, snapshot) -> Decimal:
        """
        Like to_usd(), but lands in an arbitrary target currency instead of
        always USD — the freelancer's own FreelancerProfile.default_currency,
        for KPI/analytics figures that must respect that setting rather than
        assuming USD. The source leg still uses THIS Money's own rate_to_usd
        (historically frozen at issue time, matching every other anchor-
        currency conversion in this app); only the USD->target leg falls
        back to `snapshot` (necessarily today's rate — there is no per-
        invoice frozen rate for a currency the invoice was never issued in).
        """
        usd_amount = self.to_usd()
        if target_currency == 'USD':
            return usd_amount
        target_rate = self._rate_for(target_currency, snapshot)
        return usd_amount / target_rate

    @staticmethod
    def _rate_for(currency: str, snapshot) -> Decimal:
        if currency == 'USD':
            return Decimal('1')
        rate = snapshot.rates_to_usd.get(currency)
        if rate is None:
            raise ValueError(
                f'No exchange rate for {currency!r} in snapshot dated {snapshot.date}.'
            )
        return Decimal(str(rate))


def needs_snapshot(currency: str, target_currency: str) -> bool:
    """
    Whether converting `currency` -> `target_currency` needs an exchange-
    rate snapshot at all. Same currency needs nothing, and a USD target
    only needs the source's own frozen rate (Money.to_currency short-
    circuits the USD->target leg for USD). Exposed so callers that fetch
    the snapshot lazily (apps.clients' payment_stats) ask the same
    question this module's conversion does, instead of re-deriving it.
    """
    return currency != target_currency and target_currency != 'USD'


def convert_amount(amount, currency, rate_to_usd_at_issue, target_currency, snapshot):
    """
    Converts one amount into target_currency, or returns None when no
    honest conversion exists — never a guess.

    Mechanism (the project's established anchor-currency one, shared by
    the invoice KPI strip, analytics, and the client list): the source leg
    uses the invoice's own FROZEN rate_to_usd_at_issue into USD; only the
    USD->target leg uses `snapshot` (necessarily a current rate — there is
    no frozen rate for a currency the invoice was never issued in).

    - Same currency: returned as-is, no rate or snapshot needed.
    - USD source: its rate into USD is 1 by definition, so a missing
      rate_to_usd_at_issue is irrelevant (Money.to_usd already ignores it).
      Real dev data had 29 finalised USD invoices with a NULL rate; the
      earlier version of this logic treated every one of them as
      unconvertible into any non-USD currency.
    - Any other source needs a real frozen rate; any non-USD target needs
      a snapshot containing that currency.
    """
    if currency == target_currency:
        return amount
    if rate_to_usd_at_issue is None and currency != 'USD':
        return None
    if needs_snapshot(currency, target_currency) and snapshot is None:
        return None
    try:
        return Money(amount, currency, rate_to_usd_at_issue).to_currency(target_currency, snapshot)
    except ValueError:
        return None


def unify_amounts_to_currency(rows, target_currency, snapshot):
    """
    Real anchor-currency unification across mixed-currency rows — the one
    shared implementation behind invoice_summary (KPI cards) and
    invoice_analytics's currency breakdown. Moved here from
    apps/invoices/views.py (as `_unify_amounts_to_currency`) so apps.clients
    can use the same logic without importing apps.invoices — the same
    promotion precedent as send_client_facing_email (DECISIONS.md,
    13 August 2026).

    `rows` is an iterable of (amount, currency, rate_to_usd_at_issue)
    tuples — callers decide what they're summing, this only handles
    conversion + honest-gap bookkeeping. A row convert_amount() cannot
    convert is skipped and counted in `unconverted_count` — never guessed,
    never silently included unconverted. Returns (total quantized to
    cents, unconverted_count).
    """
    unified_total = Decimal('0')
    unconverted_count = 0
    for amount, currency, rate_to_usd_at_issue in rows:
        converted = convert_amount(amount, currency, rate_to_usd_at_issue, target_currency, snapshot)
        if converted is None:
            unconverted_count += 1
        else:
            unified_total += converted
    return unified_total.quantize(CENT), unconverted_count
