# apps/clients/views_portal_notifications.py
"""
Client Notification Bell — the client-facing REST surface, Client Portal
Redesign Phase 5. A parallel, additive extension of core/notifications.py
(the freelancer's own bell), not a retrofit of it: that file's queries
are hardcoded to `user=`, so a client-scoped AuditLog/NotificationRead
row (written with `client=` set and `user` left None, per
core.observability.log_event's own Phase 5 addition) can never appear
there regardless of anything this file does. This file is the mirror
surface for the other side — portal-session-authenticated
(apps.clients.portal.resolve_session_from_request), never apps.users JWT
auth, matching every other portal endpoint in this codebase.

Deliberately lives in apps.clients, not apps.invoices: every event this
reads was already written by an apps.invoices handler
(apps/invoices/notifications.py) directly into core.models.AuditLog/
NotificationRead — reading those back needs no Invoice import at all,
only Client (already local to this app) and core (a shared,
app-agnostic dependency every app already has), so there's no reason to
put this on the apps.invoices side of the established one-directional
apps.invoices -> apps.clients dependency rule.

Polling only, by this task's own explicit instruction — no WebSocket
consumer. A later, separate task can add real-time delivery the same
way core/consumers.py's NotificationConsumer already does for the
freelancer side, if that's ever wanted.
"""
import logging

from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from core.models import AuditLog, NotificationRead

from apps.users.authentication import enforce_csrf_standalone

from .portal import resolve_session_from_request

logger = logging.getLogger(__name__)

# Which client-scoped AuditLog events surface in this bell — the client
# equivalent of core/notifications.py's own NOTIFICATION_EVENTS allowlist.
# Every one of these event-name strings is NEW as of this pass (a
# 'client_' prefix, deliberately distinct from any freelancer-facing
# event name, even where the underlying real-world action is the same —
# see apps/invoices/notifications.py's own "Client Notification Bell"
# section for why each one is written, and by which handler).
CLIENT_NOTIFICATION_EVENTS = {
    'client_invoice_sent',
    'client_comment_posted',
    'client_payment_claim_confirmed',
    'client_payment_claim_rejected',
    'client_formal_notice_sent',
}

CLIENT_EVENT_TITLES = {
    'client_invoice_sent': 'New invoice',
    'client_comment_posted': 'New message',
    'client_payment_claim_confirmed': 'Payment confirmed',
    'client_payment_claim_rejected': 'Payment claim rejected',
    'client_formal_notice_sent': 'Formal notice',
}


def _describe_client_notification(log):
    metadata = log.metadata or {}
    business_name = metadata.get('business_name') or 'Your freelancer'
    invoice_number = metadata.get('invoice_number') or 'an invoice'

    if log.event == 'client_invoice_sent':
        return f'{business_name} sent you invoice {invoice_number}.'
    if log.event == 'client_comment_posted':
        return f'{business_name} sent you a new message on {invoice_number}.'
    if log.event == 'client_payment_claim_confirmed':
        return f'Your payment on {invoice_number} was confirmed.'
    if log.event == 'client_payment_claim_rejected':
        note = metadata.get('review_note')
        base = f"Your reported payment on {invoice_number} wasn't confirmed."
        return f'{base} {note}' if note else base
    if log.event == 'client_formal_notice_sent':
        return f'{business_name} sent a formal notice regarding {invoice_number}.'
    return ''


def _client_notification_action_url(log):
    """
    Every handler that writes one of these events stores the invoice's
    own real, already-built `portal_view_url` directly in metadata at
    write time (apps/invoices/notifications.py) — never a template
    needing an {id} substitution the way core/notifications.py's
    _action_url does for the freelancer side, since there is no frontend
    bell UI yet to design a click-through route for (explicitly out of
    this task's scope). Returns None, not a broken link, when absent.
    """
    return (log.metadata or {}).get('portal_view_url')


def _serialize_client_notification(log, is_read):
    return {
        'id': str(log.id),
        'type': log.event,
        'title': CLIENT_EVENT_TITLES.get(log.event, log.event),
        'message': _describe_client_notification(log),
        'created_at': log.created_at.isoformat(),
        'is_read': is_read,
        'action_url': _client_notification_action_url(log),
    }


def _visible_client_logs_and_states(client):
    """
    Mirrors core/notifications.py's own _visible_logs_and_states exactly,
    scoped by `client=` instead of `user=` — one query shape, one
    definition of "visible" (not dismissed) and "read" (a
    NotificationRead row exists, regardless of its own dismissed_at).
    """
    logs = list(
        AuditLog.objects.filter(client=client, event__in=CLIENT_NOTIFICATION_EVENTS)
        .order_by('-created_at')[:50]
    )
    states = {
        nr.audit_log_id: nr
        for nr in NotificationRead.objects.filter(client=client, audit_log__in=logs)
    }
    visible_logs = [log for log in logs if not (states.get(log.id) and states[log.id].dismissed_at)]
    return visible_logs, states


@api_view(['GET'])
@permission_classes([AllowAny])
def portal_notifications_list(request):
    """
    GET /api/clients/portal/notifications/ — this client's own
    notifications, newest first, read/dismissed state included. Real 401
    (never an empty list) with no valid portal session, matching every
    other portal-session-authenticated endpoint in this codebase.
    """
    client = resolve_session_from_request(request)
    if client is None:
        return Response({'error': 'No active portal session.'}, status=status.HTTP_401_UNAUTHORIZED)

    visible_logs, states = _visible_client_logs_and_states(client)
    data = [_serialize_client_notification(log, log.id in states) for log in visible_logs]
    unread_count = sum(1 for n in data if not n['is_read'])
    return Response({'notifications': data, 'unread_count': unread_count})


@api_view(['POST'])
@permission_classes([AllowAny])
def portal_notification_mark_read(request, notification_id):
    """
    POST /api/clients/portal/notifications/<id>/mark-read/ — mirrors
    core/notifications.py's mark_notification_read. `AuditLog.objects.get(
    pk=notification_id, client=client)` is itself the cross-client
    isolation: a notification id belonging to a DIFFERENT client (or to a
    freelancer's own user-scoped row) never matches this filter, so this
    always returns a real 404 for it rather than silently marking
    something that isn't this client's own.
    """
    enforce_csrf_standalone(request)

    client = resolve_session_from_request(request)
    if client is None:
        return Response({'error': 'No active portal session.'}, status=status.HTTP_401_UNAUTHORIZED)

    try:
        log = AuditLog.objects.get(pk=notification_id, client=client)
    except AuditLog.DoesNotExist:
        return Response({'error': 'Notification not found.'}, status=status.HTTP_404_NOT_FOUND)

    NotificationRead.objects.get_or_create(client=client, audit_log=log)
    return Response({'message': 'Marked as read.'})


@api_view(['POST'])
@permission_classes([AllowAny])
def portal_notifications_mark_all_read(request):
    """POST /api/clients/portal/notifications/mark-all-read/ — mirrors core/notifications.py's mark_all_notifications_read, scoped to `client=`."""
    enforce_csrf_standalone(request)

    client = resolve_session_from_request(request)
    if client is None:
        return Response({'error': 'No active portal session.'}, status=status.HTTP_401_UNAUTHORIZED)

    logs = AuditLog.objects.filter(client=client, event__in=CLIENT_NOTIFICATION_EVENTS)
    existing = set(
        NotificationRead.objects.filter(client=client, audit_log__in=logs)
        .values_list('audit_log_id', flat=True)
    )
    to_create = [NotificationRead(client=client, audit_log=log) for log in logs if log.id not in existing]
    NotificationRead.objects.bulk_create(to_create)
    return Response({'message': 'All notifications marked as read.'})


@api_view(['POST'])
@permission_classes([AllowAny])
def portal_notifications_dismiss(request):
    """
    POST /api/clients/portal/notifications/dismiss/ — mirrors
    core/notifications.py's dismiss_notifications, scoped to `client=`.
    Body: {"ids": ["<uuid>", ...]}. `AuditLog.objects.filter(pk__in=ids,
    client=client)` is the cross-client isolation here too — any id in
    the list that doesn't belong to this client is silently excluded
    from the queryset, never dismissed.
    """
    enforce_csrf_standalone(request)

    client = resolve_session_from_request(request)
    if client is None:
        return Response({'error': 'No active portal session.'}, status=status.HTTP_401_UNAUTHORIZED)

    ids = request.data.get('ids', [])
    if not isinstance(ids, list) or not ids:
        return Response({'error': 'ids must be a non-empty list.'}, status=status.HTTP_400_BAD_REQUEST)

    logs = AuditLog.objects.filter(pk__in=ids, client=client)
    now = timezone.now()
    for log in logs:
        nr, _ = NotificationRead.objects.get_or_create(client=client, audit_log=log)
        nr.dismissed_at = now
        nr.save(update_fields=['dismissed_at'])
    return Response({'message': f'{logs.count()} notification(s) dismissed.'})
