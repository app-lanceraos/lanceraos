# core/notifications.py
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import AuditLog, NotificationRead

# Which AuditLog events surface in the bell — a fixed allowlist here,
# not a schema change to AuditLog.event (which stays free-form on
# purpose, per its own docstring, so no future module has to edit a
# shared choices list to add its own events).
NOTIFICATION_EVENTS = {
    'password_changed', 'password_reset_done', 'new_device_login',
    'email_change_done', '2fa_enabled', '2fa_disabled',
    'deletion_confirmed', 'session_revoked',
}

EVENT_TITLES = {
    'password_changed': 'Password changed',
    'password_reset_done': 'Password reset',
    'new_device_login': 'New sign-in to your account',
    'email_change_done': 'Email address changed',
    '2fa_enabled': 'Two-factor authentication enabled',
    '2fa_disabled': 'Two-factor authentication disabled',
    'deletion_confirmed': 'Account scheduled for deletion',
    'session_revoked': 'Session signed out',
}

# Where clicking each notification type navigates. Compulsory — every
# notification-relevant event must have a real entry here, never left
# to fall through to None. If a future module adds an event to
# NOTIFICATION_EVENTS, it must add its action_url here in the same
# change (see DESIGN.md's Notifications section for the full rule).
EVENT_ACTION_URLS = {
    'password_changed': '/settings?tab=security',
    'password_reset_done': '/settings?tab=security',
    'new_device_login': '/settings?tab=sessions',
    'email_change_done': '/settings?tab=account',
    '2fa_enabled': '/settings?tab=security',
    '2fa_disabled': '/settings?tab=security',
    'deletion_confirmed': '/settings?tab=security',
    'session_revoked': '/settings?tab=sessions',
}


def _describe(log):
    if log.event == 'session_revoked':
        return 'A session on your account was signed out.'
    if log.event == 'new_device_login':
        return f'Signed in from {log.ip_address or "an unknown location"}.'
    return ''


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def list_notifications(request):
    logs = list(
        AuditLog.objects.filter(user=request.user, event__in=NOTIFICATION_EVENTS)
        .order_by('-created_at')[:50]
    )
    states = {
        nr.audit_log_id: nr
        for nr in NotificationRead.objects.filter(user=request.user, audit_log__in=logs)
    }
    visible_logs = [log for log in logs if not (states.get(log.id) and states[log.id].dismissed_at)]
    data = [{
        'id': str(log.id),
        'type': log.event,
        'title': EVENT_TITLES.get(log.event, log.event),
        'message': _describe(log),
        'created_at': log.created_at.isoformat(),
        'is_read': log.id in states,
        'action_url': EVENT_ACTION_URLS.get(log.event),
    } for log in visible_logs]
    unread_count = sum(1 for n in data if not n['is_read'])
    return Response({'notifications': data, 'unread_count': unread_count})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def mark_notification_read(request, notification_id):
    try:
        log = AuditLog.objects.get(pk=notification_id, user=request.user)
    except AuditLog.DoesNotExist:
        return Response({'error': 'Notification not found.'}, status=status.HTTP_404_NOT_FOUND)
    NotificationRead.objects.get_or_create(user=request.user, audit_log=log)
    return Response({'message': 'Marked as read.'})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def mark_all_notifications_read(request):
    logs = AuditLog.objects.filter(user=request.user, event__in=NOTIFICATION_EVENTS)
    existing = set(
        NotificationRead.objects.filter(user=request.user, audit_log__in=logs)
        .values_list('audit_log_id', flat=True)
    )
    to_create = [NotificationRead(user=request.user, audit_log=log) for log in logs if log.id not in existing]
    NotificationRead.objects.bulk_create(to_create)
    return Response({'message': 'All notifications marked as read.'})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def dismiss_notifications(request):
    """
    Bulk-dismiss ("delete") a list of notification ids from the bell —
    never touches AuditLog itself, only marks these as hidden for this
    user. Body: {"ids": ["<uuid>", ...]}
    """
    ids = request.data.get('ids', [])
    if not isinstance(ids, list) or not ids:
        return Response({'error': 'ids must be a non-empty list.'}, status=status.HTTP_400_BAD_REQUEST)
    logs = AuditLog.objects.filter(pk__in=ids, user=request.user)
    now = timezone.now()
    for log in logs:
        nr, _ = NotificationRead.objects.get_or_create(user=request.user, audit_log=log)
        nr.dismissed_at = now
        nr.save(update_fields=['dismissed_at'])
    return Response({'message': f'{logs.count()} notification(s) dismissed.'})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def mark_notifications_read(request):
    """
    Bulk-mark a specific list of notification ids as read (distinct from
    mark_all_notifications_read, which marks everything). Body:
    {"ids": ["<uuid>", ...]}
    """
    ids = request.data.get('ids', [])
    if not isinstance(ids, list) or not ids:
        return Response({'error': 'ids must be a non-empty list.'}, status=status.HTTP_400_BAD_REQUEST)
    logs = AuditLog.objects.filter(pk__in=ids, user=request.user)
    for log in logs:
        NotificationRead.objects.get_or_create(user=request.user, audit_log=log)
    return Response({'message': f'{logs.count()} notification(s) marked as read.'})
