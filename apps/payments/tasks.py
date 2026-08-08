# apps/payments/tasks.py
import logging

import requests
from celery import shared_task
from django.utils import timezone

from .models import ExchangeRateSnapshot

logger = logging.getLogger(__name__)

EXCHANGE_RATE_API_URL = 'https://open.er-api.com/v6/latest/USD'
REQUEST_TIMEOUT_SECONDS = 10
SOURCE_NAME = 'open.er-api.com'


@shared_task(bind=True, max_retries=3)
def fetch_exchange_rates(self):
    """
    Runs daily at 8:00 AM PKT. Fetches the full USD-based rate table from
    open.er-api.com and captures ALL of it into rates_to_usd, not just
    PKR/EUR/GBP — no extra API cost, just keeping more of what's already
    returned, so a future currency addition is a data change, not a
    migration.

    open.er-api.com returns USD->X rates (1 USD = api_rate units of X).
    ExchangeRateSnapshot stores the opposite direction — the value of 1
    unit of X in USD — since that's what Money.to_usd()/convert() need.
    Getting this inversion backwards would silently corrupt every
    downstream currency conversion, so: 1 unit of X in USD = 1 / api_rate.
    Sanity check — PKR at api_rate≈278.5 (1 USD = 278.5 PKR) inverts to
    ≈0.0036 USD per PKR, which is the right order of magnitude; EUR at
    api_rate≈0.92 (1 USD = 0.92 EUR) inverts to ≈1.09 USD per EUR, also
    correct. Confirms the division is the right way round before trusting it.

    Idempotent: if a snapshot for today's date already exists, returns
    early without re-fetching — Celery Beat firing this more than once on
    the same day (a retry, a manual trigger, a misconfigured schedule)
    must never produce two rows for the same date.
    """
    today = timezone.now().date()

    if ExchangeRateSnapshot.objects.filter(date=today).exists():
        logger.info('[EXCHANGE RATES] Snapshot for %s already exists; skipping fetch.', today)
        return {'status': 'skipped', 'reason': 'already_fetched', 'date': str(today)}

    try:
        response = requests.get(EXCHANGE_RATE_API_URL, timeout=REQUEST_TIMEOUT_SECONDS)
        response.raise_for_status()
        api_rates = response.json().get('rates', {})
    except requests.RequestException as exc:
        logger.error('[EXCHANGE RATES ERROR] Request failed: %s', exc)
        # Mirrors apps.users.tasks.anonymize_expired_accounts's
        # try/self.retry()/except self.MaxRetriesExceededError shape.
        # Verified directly against Celery's own retry() source (5.6.3):
        # because `exc` is passed here, Celery re-raises THAT original
        # exception once max_retries is exhausted (raise_with_context(exc)),
        # not MaxRetriesExceededError — that class is only raised when
        # retry() is called with no exc. This except branch is therefore
        # normally unreachable; kept only for defensive symmetry with the
        # sibling task and in case that Celery behavior ever changes.
        try:
            raise self.retry(exc=exc, countdown=300)
        except self.MaxRetriesExceededError:
            logger.critical('[EXCHANGE RATES CRITICAL] Max retries exceeded fetching rates for %s.', today)
            return {'status': 'failed', 'reason': 'max_retries_exceeded', 'date': str(today)}

    rates_to_usd = {
        currency: 1 / rate
        for currency, rate in api_rates.items()
        if rate  # guards against a zero/falsy api_rate producing a ZeroDivisionError
    }
    rates_to_usd['USD'] = 1.0  # explicit, never left to rely on the API's own USD entry alone

    ExchangeRateSnapshot.objects.create(
        date=today,
        rates_to_usd=rates_to_usd,
        source=SOURCE_NAME,
        fetched_at=timezone.now(),
    )

    logger.info('[EXCHANGE RATES] Fetched %s currencies for %s.', len(rates_to_usd), today)
    return {'status': 'fetched', 'date': str(today), 'currency_count': len(rates_to_usd)}
