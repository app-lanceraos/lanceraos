# core/tests/test_money.py
from decimal import Decimal
from types import SimpleNamespace

from django.test import SimpleTestCase

from core.money import Money


def make_snapshot(rates_to_usd, date='2026-08-08'):
    # Money.convert() only reads .rates_to_usd/.date, so a plain
    # SimpleNamespace stands in for ExchangeRateSnapshot without needing
    # a real database row.
    return SimpleNamespace(rates_to_usd=rates_to_usd, date=date)


class MoneyToUsdTests(SimpleTestCase):
    def test_to_usd_for_usd_currency_with_no_rate_returns_amount_unchanged(self):
        money = Money(amount=Decimal('100'), currency='USD')
        self.assertEqual(money.to_usd(), Decimal('100'))

    def test_to_usd_for_non_usd_currency_multiplies_by_rate(self):
        money = Money(amount=Decimal('1000'), currency='PKR', rate_to_usd=Decimal('0.0036'))
        self.assertEqual(money.to_usd(), Decimal('3.6'))

    def test_to_usd_raises_when_rate_missing_for_non_usd_currency(self):
        money = Money(amount=Decimal('1000'), currency='PKR')
        with self.assertRaises(ValueError):
            money.to_usd()


class MoneyConvertTests(SimpleTestCase):
    def test_convert_routes_through_usd_anchor(self):
        snapshot = make_snapshot({'PKR': 0.0036, 'EUR': 1.08, 'USD': 1.0})
        money = Money(amount=Decimal('100'), currency='EUR')

        converted = money.convert('PKR', snapshot)

        expected = (Decimal('100') * Decimal('1.08')) / Decimal('0.0036')
        self.assertEqual(converted.currency, 'PKR')
        self.assertEqual(converted.amount, expected)
        self.assertEqual(converted.rate_to_usd, Decimal('0.0036'))

    def test_convert_from_usd_uses_implicit_rate_of_one(self):
        snapshot = make_snapshot({'PKR': 0.0036, 'USD': 1.0})
        money = Money(amount=Decimal('10'), currency='USD')

        converted = money.convert('PKR', snapshot)

        self.assertEqual(converted.amount, Decimal('10') / Decimal('0.0036'))

    def test_convert_to_usd_uses_implicit_rate_of_one(self):
        snapshot = make_snapshot({'EUR': 1.08, 'USD': 1.0})
        money = Money(amount=Decimal('50'), currency='EUR')

        converted = money.convert('USD', snapshot)

        self.assertEqual(converted.amount, Decimal('50') * Decimal('1.08'))
        self.assertEqual(converted.currency, 'USD')

    def test_convert_raises_when_source_currency_missing_from_snapshot(self):
        snapshot = make_snapshot({'USD': 1.0})
        money = Money(amount=Decimal('50'), currency='XYZ')

        with self.assertRaises(ValueError):
            money.convert('USD', snapshot)

    def test_convert_raises_when_target_currency_missing_from_snapshot(self):
        snapshot = make_snapshot({'EUR': 1.08, 'USD': 1.0})
        money = Money(amount=Decimal('50'), currency='EUR')

        with self.assertRaises(ValueError):
            money.convert('XYZ', snapshot)
