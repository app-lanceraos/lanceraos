# apps/invoices/notifications.py
"""
Event handlers — the "plain functions living next to the code they
affect" pattern INVOICES_CLIENTS_TECHNICAL_SPEC.md's Business Event
System section describes, e.g. "a handler in apps/invoices/
notifications.py that turns InvoicePaid into an AuditLog write". This is
the first module to actually add one: InvoiceSent has been emitted since
Step 1 with zero registered handlers (confirmed directly — grepping for
`@on(` anywhere in the codebase before this file existed returned
nothing), and CustomSmtpFailed (email_service.py, this step) is a new
emit with nowhere to go without this file either.

Registered via apps/invoices/apps.py's InvoicesConfig.ready() — importing
this module is what runs its @on(...) decorators; nothing else imports it.

WebSocket push (the other half of the spec's example) is NOT added here —
core/notifications.py's own bell-list endpoint (list_notifications) reads
AuditLog directly via polling, and frontend/src/hooks/useWebSocket.js is
still "[not yet built]" per CLAUDE.md's own frontend rules — there is
nothing to push to yet.
"""
import logging

from core.events import on
from core.observability import log_event

logger = logging.getLogger(__name__)


@on('InvoiceSent')
def _record_invoice_sent(invoice_id, user_id, via, **_extra):
    """
    AuditLog write for both the real send (via='platform') and the
    manual mark-sent flip (via='manual', already emitted by
    invoice_mark_sent since before this file existed) — this is simply
    the first handler that ever consumes it. Not added to
    core/notifications.py's NOTIFICATION_EVENTS allowlist: an "invoice
    sent" ping to the freelancer who just clicked Send themselves isn't
    information they don't already have, unlike custom_smtp_failed
    below, which tells them something they couldn't otherwise know
    happened.
    """
    from apps.users.models import User

    try:
        user = User.objects.get(pk=user_id)
    except User.DoesNotExist:
        logger.warning('[INVOICES] InvoiceSent handler: user_id=%s not found.', user_id)
        return

    log_event('invoice_sent', user=user, metadata={'invoice_id': invoice_id, 'via': via})


@on('CustomSmtpFailed')
def _record_custom_smtp_failed(user_id, invoice_id, client_name, client_email, smtp_host, error_message, **_extra):
    """
    The in-app notification CLAUDE.md's Custom Email Rule 4 requires,
    with its exact specified copy — this AuditLog write is what
    core/notifications.py's list_notifications endpoint (the bell) reads
    once 'custom_smtp_failed' is added to its NOTIFICATION_EVENTS/
    EVENT_TITLES/EVENT_ACTION_URLS dicts (done in that file, this step).
    user_id/smtp_host/error_message/fallback_used=True/timestamp are all
    captured here — timestamp is AuditLog.created_at itself, not a
    separate field.
    """
    from apps.users.models import User

    try:
        user = User.objects.get(pk=user_id)
    except User.DoesNotExist:
        logger.warning('[INVOICES] CustomSmtpFailed handler: user_id=%s not found.', user_id)
        return

    log_event('custom_smtp_failed', user=user, metadata={
        'invoice_id': invoice_id,
        'client_name': client_name,
        'client_email': client_email,
        'smtp_host': smtp_host,
        'error_message': error_message,
        'fallback_used': True,
    })
