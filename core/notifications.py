# core/notifications.py
import logging

from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import AuditLog, NotificationRead

logger = logging.getLogger(__name__)

# Which AuditLog events surface in the bell — a fixed allowlist here,
# not a schema change to AuditLog.event (which stays free-form on
# purpose, per its own docstring, so no future module has to edit a
# shared choices list to add its own events).
NOTIFICATION_EVENTS = {
    'password_changed', 'password_reset_done', 'new_device_login',
    'email_change_done', '2fa_enabled', '2fa_disabled',
    'deletion_confirmed', 'session_revoked',
    # apps/invoices, Step 10 — only the one event that tells the user
    # something they couldn't otherwise know (their custom SMTP silently
    # failed and Resend delivered instead). 'invoice_sent' is
    # deliberately NOT added here — see apps/invoices/notifications.py's
    # own handler docstring for why a self-triggered send doesn't need
    # a bell ping.
    'custom_smtp_failed',
    # apps/invoices, Step 13 — the immediate in-app ping when a CLIENT
    # posts a comment (per CLAUDE.md's Client Messaging spec: "When
    # client sends a message: immediate in-app notification to
    # freelancer"). The freelancer's own posts never self-notify, same
    # reasoning as invoice_sent above — see apps/invoices/notifications.py's
    # own handler.
    'comment_posted',
    # apps/invoices, Step 14 — a client submitted a payment claim.
    # payment_claim_confirmed is deliberately NOT added here: the
    # freelancer triggers that one themselves (clicking Confirm), same
    # self-trigger exclusion as invoice_sent/comment_posted above, and
    # its only real recipient is the client (a separate email, no bell
    # entry) — see apps/invoices/notifications.py's own handlers.
    'payment_claim_submitted',
    # apps/invoices, Step 15 — a client acknowledged an invoice.
    'invoice_acknowledged',
    # apps/invoices, Step 17 — an invoice crossed the day-30/final-
    # reminder threshold with no payment.
    'invoice_escalation_required',
    # apps/invoices, Step 16 — recurring invoice generation. Generated
    # is in-app only (routine, expected activity); failed/paused are
    # in-app + immediate email — see apps/invoices/notifications.py's
    # own handlers for the failed-vs-paused distinction (one per attempt
    # vs. the final, series-pausing one).
    'recurring_invoice_generated', 'recurring_generation_failed', 'recurring_generation_paused',
    # 'formal_notice_sent' is deliberately NOT added here — the
    # freelancer triggers it themselves, same self-trigger exclusion as
    # invoice_sent above.
    # apps/invoices, Step 18 — the weekly stale-draft nudge.
    'stale_drafts_digest',
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
    'custom_smtp_failed': 'Custom email delivery failed',
    'comment_posted': 'New message',
    'payment_claim_submitted': 'Payment reported',
    'invoice_acknowledged': 'Invoice acknowledged',
    'invoice_escalation_required': 'Invoice needs attention',
    'recurring_invoice_generated': 'Recurring invoice generated',
    'recurring_generation_failed': 'Recurring invoice generation failed',
    'recurring_generation_paused': 'Recurring invoices paused',
    'stale_drafts_digest': 'Unsent drafts waiting',
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
    # Per INVOICES_CLIENTS_TECHNICAL_SPEC.md Section 6's own table entry
    # for custom_smtp_failed — /settings?tab=smtp, not /invoices/{id}:
    # the fix this notification points to is in SMTP settings, not on
    # the invoice itself (the client-facing email already went out fine,
    # via the Resend fallback).
    'custom_smtp_failed': '/settings?tab=smtp',
    # FIXED (item 2 of the 16 August 2026 second verification pass — real,
    # confirmed bug, not a guess): every {id}-based entry here used to
    # build a `/invoices/{id}` PATH — but there has never been an
    # `/invoices/:id` ROUTE anywhere in frontend/src/App.jsx (confirmed
    # directly). Invoices.jsx's detail view is a slide-in panel driven by
    # React state, not a routed page, so clicking any of these
    # notifications landed nowhere real. Now points at the real route
    # (`/invoices`) with `invoice`/`tab` QUERY params instead — Invoices.jsx
    # reads `?invoice=<id>` on mount, opens that invoice's detail panel,
    # and (for comment_posted/payment_claim_submitted specifically) opens
    # it directly on the Comments/Claims tab via `?tab=`, not just the
    # invoice's default Details view. See DECISIONS.md.
    'comment_posted': '/invoices?invoice={id}&tab=comments',
    'payment_claim_submitted': '/invoices?invoice={id}&tab=claims',
    'invoice_acknowledged': '/invoices?invoice={id}',
    'invoice_escalation_required': '/invoices?invoice={id}',
    'recurring_invoice_generated': '/invoices?invoice={id}',
    # Per Section 6's own table entry for recurring_generation_failed —
    # /invoices/?filter=recurring, not a specific invoice id (the
    # metadata's own invoice_id refers to the TRIGGERING/root invoice,
    # not the failed occurrence, since no occurrence was ever created).
    'recurring_generation_failed': '/invoices/?filter=recurring',
    'recurring_generation_paused': '/invoices/?filter=recurring',
    'stale_drafts_digest': '/invoices/?status=draft',
}


def _action_url(log):
    """
    Every existing entry in EVENT_ACTION_URLS is a static string — this
    is the first event (comment_posted, Step 13) whose real destination
    needs the specific invoice's id, so this is the first real use of the
    {id} placeholder. Falls back to the raw (unsubstituted) template if
    metadata['invoice_id'] is somehow missing, rather than raising —
    a slightly wrong link is far better than a 500 on the notification
    bell for every user.
    """
    template = EVENT_ACTION_URLS.get(log.event)
    if template and '{id}' in template:
        invoice_id = (log.metadata or {}).get('invoice_id')
        if invoice_id:
            return template.replace('{id}', invoice_id)
    return template


def _describe(log):
    if log.event == 'session_revoked':
        return 'A session on your account was signed out.'
    if log.event == 'new_device_login':
        return f'Signed in from {log.ip_address or "an unknown location"}.'
    if log.event == 'custom_smtp_failed':
        # Exact copy per CLAUDE.md's Custom Email Rule 4 — "[client]"
        # filled in with the real client name from this event's metadata
        # (apps/invoices/notifications.py's _record_custom_smtp_failed).
        client = log.metadata.get('client_name') or 'your client'
        return (
            f'Your email to {client} was sent from noreply@lanceraos.com '
            f'because your custom email failed. Check your SMTP settings.'
        )
    if log.event == 'comment_posted':
        client = log.metadata.get('client_name') or 'Your client'
        invoice_number = log.metadata.get('invoice_number') or 'an invoice'
        return f'{client} sent a new message on {invoice_number}.'
    if log.event == 'payment_claim_submitted':
        client = log.metadata.get('client_name') or 'Your client'
        invoice_number = log.metadata.get('invoice_number') or 'an invoice'
        return f'{client} reported a payment on {invoice_number}.'
    if log.event == 'invoice_acknowledged':
        client = log.metadata.get('client_name') or 'Your client'
        invoice_number = log.metadata.get('invoice_number') or 'an invoice'
        return f'{client} acknowledged {invoice_number}.'
    if log.event == 'invoice_escalation_required':
        invoice_number = log.metadata.get('invoice_number') or 'An invoice'
        return f'{invoice_number} is severely overdue and needs your attention.'
    if log.event == 'recurring_invoice_generated':
        invoice_number = log.metadata.get('invoice_number') or 'A new invoice'
        return f'{invoice_number} was generated from your recurring series.'
    if log.event == 'recurring_generation_failed':
        invoice_number = log.metadata.get('invoice_number') or 'a recurring invoice'
        count = log.metadata.get('failure_count')
        return f'Failed to generate the next occurrence of {invoice_number}{f" (attempt {count} of 3)" if count else ""}.'
    if log.event == 'recurring_generation_paused':
        invoice_number = log.metadata.get('invoice_number') or 'a recurring invoice'
        return f'The recurring series based on {invoice_number} was paused after 3 failed attempts.'
    if log.event == 'stale_drafts_digest':
        count = log.metadata.get('draft_count') or 0
        plural = 's' if count != 1 else ''
        return f'You have {count} unsent draft invoice{plural} sitting for over a week.'
    return ''


def _serialize_notification(log, is_read):
    return {
        'id': str(log.id),
        'type': log.event,
        'title': EVENT_TITLES.get(log.event, log.event),
        'message': _describe(log),
        'created_at': log.created_at.isoformat(),
        'is_read': is_read,
        'action_url': _action_url(log),
    }


def _visible_logs_and_states(user):
    """
    Shared by list_notifications, compute_unread_count, and
    broadcast_notification — one query shape, one definition of
    "visible" (not dismissed) and "read" (a NotificationRead row
    exists, regardless of its own dismissed_at).
    """
    logs = list(
        AuditLog.objects.filter(user=user, event__in=NOTIFICATION_EVENTS)
        .order_by('-created_at')[:50]
    )
    states = {
        nr.audit_log_id: nr
        for nr in NotificationRead.objects.filter(user=user, audit_log__in=logs)
    }
    visible_logs = [log for log in logs if not (states.get(log.id) and states[log.id].dismissed_at)]
    return visible_logs, states


def compute_unread_count(user):
    visible_logs, states = _visible_logs_and_states(user)
    return sum(1 for log in visible_logs if log.id not in states)


def broadcast_notification(log):
    """
    Real-time push to the bell — called by core.observability.log_event()
    right after the AuditLog row is committed, for every event in
    NOTIFICATION_EVENTS, from any app, with zero per-app wiring (see
    DECISIONS.md). Mirrors apps.invoices.comments.broadcast_comment's own
    guard: never raises, since a broadcast failure must not roll back or
    fail the request that already durably wrote the audit row.
    """
    if log.user_id is None or log.event not in NOTIFICATION_EVENTS:
        return

    from asgiref.sync import async_to_sync
    from channels.layers import get_channel_layer

    channel_layer = get_channel_layer()
    if channel_layer is None:
        return

    try:
        async_to_sync(channel_layer.group_send)(f'notifications_{log.user_id}', {
            'type': 'notification.message',
            'notification': _serialize_notification(log, is_read=False),
            'unread_count': compute_unread_count(log.user),
        })
    except Exception:
        logger.exception('[CORE] Failed to broadcast notification for AuditLog id=%s', log.pk)


def _push_state_refresh(user):
    """
    Multi-tab consistency for mark-read/dismiss actions — the same
    per-user group notification pushes to, carrying just the recomputed
    unread_count so every other open tab can update its badge (and
    refetch the list if it's currently showing one) without a manual
    refresh.
    """
    from asgiref.sync import async_to_sync
    from channels.layers import get_channel_layer

    channel_layer = get_channel_layer()
    if channel_layer is None:
        return

    try:
        async_to_sync(channel_layer.group_send)(f'notifications_{user.id}', {
            'type': 'notification.refresh',
            'unread_count': compute_unread_count(user),
        })
    except Exception:
        logger.exception('[CORE] Failed to broadcast notification-state refresh for user_id=%s', user.pk)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def list_notifications(request):
    visible_logs, states = _visible_logs_and_states(request.user)
    data = [_serialize_notification(log, log.id in states) for log in visible_logs]
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
    _push_state_refresh(request.user)
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
    _push_state_refresh(request.user)
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
    _push_state_refresh(request.user)
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
    _push_state_refresh(request.user)
    return Response({'message': f'{logs.count()} notification(s) marked as read.'})
