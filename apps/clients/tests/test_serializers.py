# apps/clients/tests/test_serializers.py
from django.test import TestCase
from django.utils import timezone

from apps.clients.serializers import ClientSerializer
from apps.payments.models import ExchangeRateSnapshot
from apps.users.models import User


class CurrencyValidationTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(email='freelancer@example.com', password='Sup3r$ecret1')

    def _serializer(self, currency):
        data = {'name': 'Acme Co', 'email': 'acme@example.com', 'default_currency': currency}
        return ClientSerializer(data=data, context={'request': _FakeRequest(self.user)})

    def test_usd_is_always_valid_with_zero_snapshots(self):
        self.assertFalse(ExchangeRateSnapshot.objects.exists())
        serializer = self._serializer('USD')
        self.assertTrue(serializer.is_valid(), serializer.errors)

    def test_unknown_currency_rejected_with_zero_snapshots(self):
        self.assertFalse(ExchangeRateSnapshot.objects.exists())
        serializer = self._serializer('PKR')
        self.assertFalse(serializer.is_valid())
        self.assertIn('default_currency', serializer.errors)

    def test_currency_present_in_latest_snapshot_is_accepted(self):
        ExchangeRateSnapshot.objects.create(
            date=timezone.now().date(),
            rates_to_usd={'USD': 1.0, 'PKR': 0.0036, 'EUR': 1.08},
            source='open.er-api.com',
            fetched_at=timezone.now(),
        )
        serializer = self._serializer('PKR')
        self.assertTrue(serializer.is_valid(), serializer.errors)

    def test_currency_absent_from_latest_snapshot_is_rejected(self):
        ExchangeRateSnapshot.objects.create(
            date=timezone.now().date(),
            rates_to_usd={'USD': 1.0, 'EUR': 1.08},
            source='open.er-api.com',
            fetched_at=timezone.now(),
        )
        serializer = self._serializer('XYZ')
        self.assertFalse(serializer.is_valid())

    def test_currency_validation_uses_the_most_recent_snapshot(self):
        ExchangeRateSnapshot.objects.create(
            date=timezone.now().date().replace(day=1),
            rates_to_usd={'USD': 1.0},
            source='open.er-api.com',
            fetched_at=timezone.now(),
        )
        ExchangeRateSnapshot.objects.create(
            date=timezone.now().date(),
            rates_to_usd={'USD': 1.0, 'GBP': 1.27},
            source='open.er-api.com',
            fetched_at=timezone.now(),
        )
        serializer = self._serializer('GBP')
        self.assertTrue(serializer.is_valid(), serializer.errors)


class _FakeRequest:
    def __init__(self, user):
        self.user = user
