# apps/payments/tests.py
from datetime import date
from unittest.mock import MagicMock, patch

import requests
from django.test import TestCase
from django.utils import timezone

from apps.payments.models import ExchangeRateSnapshot
from apps.payments.tasks import fetch_exchange_rates


def make_response(rates):
    response = MagicMock()
    response.status_code = 200
    response.raise_for_status.return_value = None
    response.json.return_value = {'result': 'success', 'base_code': 'USD', 'rates': rates}
    return response


class FetchExchangeRatesTests(TestCase):
    @patch('apps.payments.tasks.requests.get')
    def test_fetch_creates_snapshot_with_correctly_inverted_rates(self, mock_get):
        # API convention: 1 USD = 278.5 PKR, 1 USD = 0.92 EUR, 1 USD = 1 USD.
        mock_get.return_value = make_response({'USD': 1, 'PKR': 278.5, 'EUR': 0.92})

        result = fetch_exchange_rates()

        self.assertEqual(result['status'], 'fetched')
        snapshot = ExchangeRateSnapshot.objects.get(date=timezone.now().date())
        self.assertAlmostEqual(snapshot.rates_to_usd['PKR'], 1 / 278.5)
        self.assertAlmostEqual(snapshot.rates_to_usd['EUR'], 1 / 0.92)
        self.assertEqual(snapshot.rates_to_usd['USD'], 1.0)
        self.assertEqual(snapshot.source, 'open.er-api.com')

    @patch('apps.payments.tasks.requests.get')
    def test_fetch_is_idempotent_for_the_same_day(self, mock_get):
        mock_get.return_value = make_response({'USD': 1, 'PKR': 278.5})

        first = fetch_exchange_rates()
        second = fetch_exchange_rates()

        self.assertEqual(first['status'], 'fetched')
        self.assertEqual(second['status'], 'skipped')
        self.assertEqual(ExchangeRateSnapshot.objects.filter(date=timezone.now().date()).count(), 1)
        # The mocked API was only actually reached once — the second call
        # short-circuited before ever touching requests.get.
        mock_get.assert_called_once()

    @patch('apps.payments.tasks.requests.get')
    def test_fetch_does_not_duplicate_when_snapshot_already_exists(self, mock_get):
        ExchangeRateSnapshot.objects.create(
            date=timezone.now().date(),
            rates_to_usd={'USD': 1.0},
            source='open.er-api.com',
            fetched_at=timezone.now(),
        )

        result = fetch_exchange_rates()

        self.assertEqual(result['status'], 'skipped')
        mock_get.assert_not_called()
        self.assertEqual(ExchangeRateSnapshot.objects.count(), 1)

    @patch('apps.payments.tasks.requests.get')
    def test_fetch_retries_on_request_failure(self, mock_get):
        """
        Verified against real Celery retry() semantics (see the comment
        in tasks.py) rather than assumed: calling the task directly hits
        request.called_directly and gives up after a single attempt with
        no retry at all, so this exercises the task through .apply()
        instead — the same path Celery Beat's real dispatch goes
        through — to actually observe the retry loop. Because self.retry()
        is called with exc=exc, Celery re-raises that original exception
        once max_retries is exhausted rather than MaxRetriesExceededError,
        so the RequestException is what should surface here.
        """
        mock_get.side_effect = requests.RequestException('connection refused')

        result = fetch_exchange_rates.apply()

        self.assertFalse(result.successful())
        self.assertIsInstance(result.result, requests.RequestException)
        # Initial attempt + 3 retries.
        self.assertEqual(mock_get.call_count, 4)
        self.assertEqual(ExchangeRateSnapshot.objects.count(), 0)

    @patch('apps.payments.tasks.requests.get')
    def test_fetch_does_not_retry_when_called_directly_outside_a_worker(self, mock_get):
        """
        Calling the task as a plain function (not through .apply()/.delay())
        sets request.called_directly=True, which makes Celery's retry()
        re-raise the original exception immediately with no retry attempt
        at all — documented Celery behavior, verified directly here rather
        than assumed.
        """
        mock_get.side_effect = requests.RequestException('connection refused')

        with self.assertRaises(requests.RequestException):
            fetch_exchange_rates()

        mock_get.assert_called_once()
