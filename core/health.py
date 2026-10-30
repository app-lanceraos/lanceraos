# core/health.py
"""
Liveness/readiness probe for the hosting platform (Railway's healthcheck).

Deliberately NOT like every other endpoint in this project:
- No authentication and no DRF throttling. The platform probes every few
  seconds from a single source; the global AnonRateThrottle (100/hour)
  would turn the probe into a 429 within minutes and the platform would
  mark a perfectly healthy service as failed and restart it.
- No ApiRequestLog row (core.middleware.RequestLoggingMiddleware skips
  HEALTH_CHECK_PATH) — a probe every 10-30s would otherwise add thousands
  of useless rows per day to a table that exists for debugging real traffic.
- The body never reveals which dependency failed or why. The path is
  public; the reason goes to the server log only.
"""
import logging

from django.core.cache import cache
from django.db import connection
from rest_framework.decorators import (
    api_view, authentication_classes, permission_classes, throttle_classes,
)
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

logger = logging.getLogger(__name__)

HEALTH_CHECK_PATH = '/api/health/'
_CACHE_PROBE_KEY = 'health:probe'


def _database_ok():
    """True if a connection can be opened and answers a trivial query."""
    try:
        connection.ensure_connection()
        return bool(connection.is_usable())
    except Exception:
        logger.exception('[HEALTH] Database check failed.')
        return False


def _cache_ok():
    """True if the cache (Redis) accepts a write and returns it on read."""
    try:
        cache.set(_CACHE_PROBE_KEY, 'ok', timeout=10)
        return cache.get(_CACHE_PROBE_KEY) == 'ok'
    except Exception:
        logger.exception('[HEALTH] Cache check failed.')
        return False


@api_view(['GET'])
@authentication_classes([])
@permission_classes([AllowAny])
@throttle_classes([])
def health_check(request):
    """200 {"status": "ok"} when Postgres and Redis both answer; 503 otherwise."""
    healthy = _database_ok() and _cache_ok()
    if healthy:
        response = Response({'status': 'ok'})
    else:
        response = Response({'status': 'unavailable'}, status=503)
    response['Cache-Control'] = 'no-store'
    return response
