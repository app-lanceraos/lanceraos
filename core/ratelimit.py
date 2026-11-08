# core/ratelimit.py
"""
One atomic fixed-window rate limiter for every endpoint that wants one: Proposals (owner-facing
and public), the Dashboard and Payments. Same shape as core.ai's limiter (cache.add + cache.incr),
not the get-then-set of the invoices helpers: two concurrent requests cannot both read the same
count and both slip under the limit.

Promoted here from apps/proposals/ratelimit.py (Payments core, 07 November 2026) so that
apps.payments, the bottom of the dependency tree, can use it without importing a feature app.
"""
import logging

from django.core.cache import cache

logger = logging.getLogger(__name__)


def rate_limited(key, limit, timeout=3600):
    """
    Counts one hit against `key` and returns True when the count now EXCEEDS
    `limit` (the request must be refused). Fails open if the cache itself
    errors (logged): the limiter protects against abuse and must not turn a
    cache outage into a feature outage.
    """
    try:
        cache.add(key, 0, timeout=timeout)
        try:
            count = cache.incr(key)
        except ValueError:
            # The key expired between add() and incr().
            cache.add(key, 1, timeout=timeout)
            count = 1
    except Exception:
        logger.exception('[RATE LIMIT] Rate-limit cache failed for key=%s; allowing the request.', key)
        return False
    return count > limit
