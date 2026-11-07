# apps/dashboard/views.py
"""
GET /api/dashboard/summary/ — one aggregate read for the whole Dashboard page (one round trip, one
consistent moment, one loading state). Each section is built independently: an unexpected exception in one
is logged and that section becomes {"available": false} while the others still return, status 200.
"""
import logging

from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

# Imported from apps.proposals on purpose: it is the project's one atomic fixed-window limiter. Promoting it to
# core/ is a later chore (DECISIONS.md, Dashboard entry), not part of this change.
from apps.proposals.ratelimit import rate_limited

from . import insights, services

logger = logging.getLogger(__name__)

# Generous tier (read-only): a page that refetches on Retry and on every visit stays far under this.
READS_PER_HOUR = 240
# The insights endpoint is also a read (a cache hit is free; a miss costs one model call, which core.ai limits per user
# per hour on its own), so it gets a generous limit of its own that a page visit never approaches.
INSIGHTS_READS_PER_HOUR = 120


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def dashboard_summary(request):
    """
    The dashboard payload for the authenticated user, every query scoped to them. `Cache-Control: no-store`
    because this is financial data that must not be served from the browser cache after logout.
    """
    if rate_limited(f'dashboard_summary:{request.user.pk}', READS_PER_HOUR):
        return Response({'error': 'Too many requests. Please try again later.'}, status=status.HTTP_429_TOO_MANY_REQUESTS)

    ctx = services.build_context(request.user)
    payload = {'currency': ctx.currency, 'generated_at': timezone.now().isoformat()}
    for name, builder in services.SECTION_BUILDERS:
        try:
            payload[name] = {'available': True, **builder(ctx)}
        except Exception:
            logger.exception('[DASHBOARD] Section %s failed for user %s; returning it as unavailable.', name, request.user.pk)
            payload[name] = {'available': False}

    response = Response(payload)
    response['Cache-Control'] = 'no-store'
    return response


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def dashboard_insights(request):
    """
    The Insights card's payload: up to three facts calculated by code, each with an observation and a suggestion (model
    text that passed the number guard, else fixed sentences). A SEPARATE endpoint so the summary never waits for a
    model. There is deliberately no try/except around get_insights: an AI failure never raises (it becomes fixed
    sentences), so an exception here is a real bug and should surface as a 500 and be logged. `no-store` as for the
    summary: it carries financial figures.
    """
    if rate_limited(f'dashboard_insights:{request.user.pk}', INSIGHTS_READS_PER_HOUR):
        return Response({'error': 'Too many requests. Please try again later.'}, status=status.HTTP_429_TOO_MANY_REQUESTS)
    payload = insights.get_insights(request.user, request_id=getattr(request, 'request_id', None))
    response = Response(payload)
    response['Cache-Control'] = 'no-store'
    return response
