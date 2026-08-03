# apps/admin_panel/views_audit.py
from django.core.exceptions import ValidationError
from django.db.models import Q
from rest_framework import status
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from core.models import AuditLog
from core.observability import log_event

from .authentication import AdminCookieJWTAuthentication


def _audit_log_entry(log):
    return {
        'id': str(log.id),
        'event': log.event,
        'user': log.user.email if log.user else None,
        'actor': log.actor.email if log.actor else None,
        'ip_address': log.ip_address,
        'user_agent': log.user_agent,
        'metadata': log.metadata,
        'created_at': log.created_at.isoformat(),
    }


@api_view(['GET'])
@authentication_classes([AdminCookieJWTAuthentication])
@permission_classes([IsAuthenticated])
def audit_log_list(request):
    qs = AuditLog.objects.select_related('user', 'actor').order_by('-created_at')

    event_query = request.query_params.get('event', '').strip()
    # Exclude the audit-log-viewing event from the DEFAULT view only —
    # otherwise every admin's own "I looked at the log" action becomes
    # the newest entry every single time they load this page, burying
    # whatever they were actually trying to look at. Still fully
    # visible if explicitly searched for.
    if not event_query:
        qs = qs.exclude(event='admin_audit_log_viewed')

    admin_only = request.query_params.get('admin_only', '').strip().lower() == 'true'
    if admin_only:
        qs = qs.filter(actor__isnull=False)

    user_query = request.query_params.get('user', '').strip()
    if user_query:
        qs = qs.filter(Q(user__email__icontains=user_query) | Q(user__username__icontains=user_query))

    actor_query = request.query_params.get('actor', '').strip()
    if actor_query:
        qs = qs.filter(Q(actor__email__icontains=actor_query) | Q(actor__username__icontains=actor_query))

    if event_query:
        qs = qs.filter(event__icontains=event_query)

    ip_query = request.query_params.get('ip', '').strip()
    if ip_query:
        qs = qs.filter(ip_address=ip_query)

    try:
        date_from = request.query_params.get('from', '').strip()
        if date_from:
            qs = qs.filter(created_at__gte=date_from)
        date_to = request.query_params.get('to', '').strip()
        if date_to:
            qs = qs.filter(created_at__lte=date_to)
    except (ValidationError, ValueError):
        return Response({'error': 'Invalid date format for "from"/"to". Use ISO format, e.g. 2026-01-01.'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        limit = min(max(int(request.query_params.get('limit', 50)), 1), 200)
    except ValueError:
        limit = 50
    try:
        offset = max(int(request.query_params.get('offset', 0)), 0)
    except ValueError:
        offset = 0

    total = qs.count()
    page = qs[offset:offset + limit]

    log_event(
        'admin_audit_log_viewed', actor=request.user, request=request,
        metadata={'filters': dict(request.query_params), 'result_count': total},
    )

    return Response({
        'results': [_audit_log_entry(log) for log in page],
        'total': total,
        'limit': limit,
        'offset': offset,
    })


@api_view(['GET'])
@authentication_classes([AdminCookieJWTAuthentication])
@permission_classes([IsAuthenticated])
def audit_log_event_types(request):
    """
    Distinct event names currently in use — event is deliberately
    free-form (see core/models.py's AuditLog docstring), so this is how
    a future frontend builds a filter dropdown without a hardcoded list
    that would drift out of sync with what modules actually log.
    """
    events = AuditLog.objects.order_by('event').values_list('event', flat=True).distinct()
    return Response({'event_types': list(events)})
