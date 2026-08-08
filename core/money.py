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
