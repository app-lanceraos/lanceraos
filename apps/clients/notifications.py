# apps/clients/notifications.py
"""
Client Portal Redesign, Phase 1b — apps.clients' first-ever @on(...)
event handler. Registered via ClientsConfig.ready() (apps.py), mirroring
apps.invoices.notifications' exact loading pattern: without that import,
this module would never be imported by anything, its decorators would
never run, and emit('ClientDetailsChangeRequested', ...) would silently
call zero handlers.

core.events is app-agnostic by design (core/events.py's own docstring),
so this module needed no import from apps.invoices at all to reuse the
exact same on()/emit() bus that app already uses — confirmed directly by
this app's own existing test_apps_clients_has_zero_apps_invoices_imports
AST check (apps/clients/tests/test_portal.py), which walks every .py
file under this app and would fail if this file broke that rule.
"""
import logging

from core.email import send_email
from core.events import on
from core.observability import log_event

logger = logging.getLogger(__name__)

# Human-readable labels for the proposed_* keys ClientDetailsChangeRequestSerializer
# accepts — used to build the email/AuditLog metadata without leaking the
# raw 'proposed_name' etc. field-name spelling into either.
_PROPOSED_FIELD_LABELS = {
    'proposed_name': 'Name',
    'proposed_email': 'Email',
    'proposed_company': 'Company',
    'proposed_phone': 'Phone',
    'proposed_address': 'Address',
    'proposed_country': 'Country',
}


@on('ClientDetailsChangeRequested')
def _notify_client_details_change_requested(client_id, user_id, proposed_changes, message, **_extra):
    """
    Mirrors apps.invoices.notifications._notify_payment_claim_submitted's
    exact pattern (the confirmed precedent this task's own brief points
    at) — an AuditLog/bell entry AND a real, immediate email to the
    freelancer, both gated together behind one notification-preference
    check. Gated on notif_client_messages, not notif_payments — this is
    a client-initiated COMMUNICATION (closest existing category to "a
    client reaching out"), not a payment event; no new preference
    category was invented for this one action.

    No persistent model anywhere — proposed_changes/message live only in
    this event's payload and, once written, this AuditLog row's own
    metadata. The freelancer applies any accepted change themselves via
    their own existing PUT /api/clients/<pk>/ (ClientSerializer) — this
    handler never writes to the Client row.
    """
    from apps.users.models import User

    from .models import Client

    try:
        user = User.objects.get(pk=user_id)
    except User.DoesNotExist:
        logger.warning('[CLIENTS] ClientDetailsChangeRequested handler: user_id=%s not found.', user_id)
        return

    try:
        profile = user.profile
    except Exception:
        profile = None
    if profile is not None and not profile.notif_client_messages:
        return

    client = Client.objects.filter(pk=client_id).first()
    if client is None:
        return

    log_event('client_details_change_requested', user=user, metadata={
        'client_id': client_id,
        'client_name': client.name,
        'proposed_changes': proposed_changes,
        'message': message,
    })

    subject = f'{client.name} would like to update their details'
    change_rows_html = ''.join(
        f'<p style="margin:4px 0;font-size:13px;color:#334155;">'
        f'<strong>{_PROPOSED_FIELD_LABELS.get(field, field)}:</strong> {value}</p>'
        for field, value in proposed_changes.items()
    )
    message_row_html = (
        f'<p style="margin:12px 0 0;font-size:13px;color:#334155;">"{message}"</p>' if message else ''
    )
    html_body = f"""
<p style="margin:0 0 16px;font-size:16px;font-weight:700;color:#1e293b;">{client.name} would like to update their details</p>
{change_rows_html}
{message_row_html}
<p style="margin:16px 0 0;font-size:13px;color:#64748b;">
  This is a proposal only — nothing on {client.name}'s record has changed. Review this in LanceraOS
  and update their details yourself if you'd like to accept it.
</p>"""

    plain_lines = [f'{client.name} would like to update their details on file with you.', '']
    for field, value in proposed_changes.items():
        plain_lines.append(f'{_PROPOSED_FIELD_LABELS.get(field, field)}: {value}')
    if message:
        plain_lines.append('')
        plain_lines.append(f'"{message}"')
    plain_lines.append('')
    plain_lines.append("This is a proposal only — nothing has changed automatically.")
    plain_body = '\n'.join(plain_lines)

    # Plain core.email.send_email, not send_client_facing_email — this is
    # a notification ABOUT the freelancer's own account activity, sent TO
    # the freelancer themselves, the same reasoning
    # build_payment_claim_submitted_email's own docstring already
    # establishes (apps/invoices/email_service.py): it can't sensibly go
    # out "as" their own business identity to themselves.
    send_email(user.email, subject, html_body, plain_body)
