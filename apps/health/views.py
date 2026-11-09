# apps/health/views.py
"""
The two read-only Health Score endpoints (decision H17): 240 reads/hour per user each, in separate buckets,
`Cache-Control: no-store` on every response (errors included). Function views, every query scoped to
request.user. Nothing is stored; the score is computed live.
"""
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.payments.http import bad_request, no_store, too_many_requests
from core.ratelimit import rate_limited

from . import constants as c
from . import service

READS_PER_HOUR = 240
MONTHS_ERROR = 'months must be 3, 6, 12 or 24.'


def parse_months(raw):
    """(months, error). Omitted is 12; otherwise only the exact strings 3, 6, 12 and 24 are accepted."""
    if raw is None:
        return c.DEFAULT_WINDOW, None
    for months in c.WINDOWS:
        if raw == str(months):
            return months, None
    return None, MONTHS_ERROR


@no_store
@api_view(['GET'])
@permission_classes([IsAuthenticated])
def health_score(request):
    """The whole Health Score page for ?months=3|6|12|24 (default 12): the score, five areas, tips and notes."""
    if rate_limited(f'health:score:{request.user.pk}', READS_PER_HOUR):
        return too_many_requests()
    months, error = parse_months(request.query_params.get('months'))
    if error:
        return bad_request(error)
    return Response(service.build_score(request.user, months))


@no_store
@api_view(['GET'])
@permission_classes([IsAuthenticated])
def health_mini(request):
    """The small version for the Dashboard: the 12-month score, its grade and the single best tip."""
    if rate_limited(f'health:mini:{request.user.pk}', READS_PER_HOUR):
        return too_many_requests()
    return Response(service.build_mini(request.user))
