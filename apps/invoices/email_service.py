# apps/invoices/email_service.py
"""
The custom-SMTP-vs-Resend routing chain core/email.py's own docstring
left for "the modules that actually need it" — apps/invoices is the
first real consumer. Both invoice_send (views.py) and the reminder
Celery task (tasks.py) call `send_invoice_related_email()` below, so the
routing/fallback/observability logic exists exactly once, not duplicated
per caller.

Decision chain, per CLAUDE.md's Custom Email Rules (items 1-7),
followed exactly:
  1. custom_smtp_enabled AND custom_smtp_verified on the sending user's
     FreelancerProfile -> send via their own SMTP server. Otherwise ->
     Resend, from noreply@lanceraos.com.
  4. Custom SMTP failure -> immediately fall back to Resend, notify the
     user in-app with the exact specified copy, log user_id/smtp_host/
     error_message/fallback_used=True/timestamp. The CLIENT-facing email
     itself is byte-for-byte the same regardless of which path sent it —
     the client is never told a fallback happened.
  5/6. custom_smtp_password is Fernet-encrypted at rest; decrypted ONLY
     here, inside the sending utility, never in a view or serializer.

Invoice.user.profile's custom_smtp_enabled/custom_smtp_verified fields
are only ever set by apps.users.views.smtp.save_custom_smtp/
disable_custom_smtp (per the security-audit-driven exclusion from the
general FreelancerProfileSerializer) — nothing in this module writes to
either field, so that invariant holds by construction; confirmed by
reading this file back after writing it, not just assumed.
"""
import base64
import logging

import requests
from django.core.mail import EmailMultiAlternatives, get_connection
from django.utils import timezone

from core.email import send_email_detailed
from core.encryption import decrypt_field
from core.events import emit

from apps.users.models import FreelancerProfile

from .models import CURRENCY_SYMBOLS

logger = logging.getLogger(__name__)

REQUEST_TIMEOUT_SECONDS = 15


# ══════════════════════════════════════════════════════════════════
# EMAIL CONTENT — real send + reminders
# ══════════════════════════════════════════════════════════════════
# No "View Invoice Online" link in either template, unlike v1's own
# version — v1 links to /invoice/<view_token>, but that public page
# doesn't exist in v2 yet (needs the client portal, Step 11; confirmed
# directly against CLAUDE.md's Module 2 status). The PDF is attached to
# the real send (and its own QR code already encodes
# Invoice.payment_page_url, Step 7b) — no dead link needed to view or pay
# it. Same reasoning for the onboarding-message/portal-footer blocks v1
# appends: both depend on the portal, so neither is ported here — see
# DECISIONS.md.

def _fmt_money(amount, currency):
    symbol = CURRENCY_SYMBOLS.get(currency, currency + ' ')
    try:
        return f'{symbol}{float(amount):,.2f}'
    except (TypeError, ValueError):
        return f'{symbol}{amount}'


def _html_wrapper(body_html):
    """Minimal branded HTML wrapper — same brand tokens as the rest of the app (DESIGN.md's --accent)."""
    return f"""<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#f4f6f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:28px 16px;">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
  <tr><td style="background:#1a3a5c;border-radius:10px 10px 0 0;padding:18px 32px;">
    <span style="font-size:18px;font-weight:800;color:#fff;letter-spacing:-0.5px;">LanceraOS</span>
  </td></tr>
  <tr><td style="background:#fff;padding:32px;border-radius:0 0 10px 10px;">
    {body_html}
  </td></tr>
  <tr><td style="padding:16px;text-align:center;">
    <p style="margin:0;font-size:11px;color:#94a3b8;">LanceraOS &bull; lanceraos.com</p>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>"""


def build_invoice_send_email(invoice):
    """Subject/HTML/plain-text for the real /send/ action. Returns (subject, html, plain)."""
    sender = _sender_name(invoice.user, getattr(invoice.user, 'profile', None))
    amount = _fmt_money(invoice.total, invoice.currency)
    due = invoice.due_date.strftime('%d %b %Y') if invoice.due_date else '—'

    subject = f'Invoice {invoice.invoice_number} from {sender}'
    body = f"""
<p style="margin:0 0 8px;font-size:20px;font-weight:700;color:#1e293b;">Invoice from {sender}</p>
<p style="margin:0 0 24px;font-size:14px;color:#64748b;">Hi {invoice.client_name},</p>
<table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;margin-bottom:24px;">
  <tr style="background:#f8fafc;">
    <td style="padding:10px 16px;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.05em;border-right:1px solid #e2e8f0;">Invoice</td>
    <td style="padding:10px 16px;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.05em;border-right:1px solid #e2e8f0;">Amount</td>
    <td style="padding:10px 16px;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.05em;">Due</td>
  </tr>
  <tr>
    <td style="padding:12px 16px;font-size:14px;font-weight:600;color:#1e293b;border-right:1px solid #e2e8f0;">{invoice.invoice_number}</td>
    <td style="padding:12px 16px;font-size:16px;font-weight:800;color:#00c896;border-right:1px solid #e2e8f0;">{amount}</td>
    <td style="padding:12px 16px;font-size:14px;font-weight:600;color:#dc2626;">{due}</td>
  </tr>
</table>
<p style="margin:0;font-size:13px;color:#64748b;line-height:1.6;">
  The invoice PDF is attached to this email.<br/>Reply to this email if you have any questions.
</p>
<p style="margin:20px 0 0;font-size:14px;color:#1e293b;">
  {sender}<br/><a href="mailto:{invoice.user.email}" style="color:#00c896;text-decoration:none;">{invoice.user.email}</a>
</p>"""

    plain = (
        f'Invoice from {sender}\n\nHi {invoice.client_name},\n\n'
        f'Invoice: {invoice.invoice_number}\nAmount:  {amount}\nDue:     {due}\n\n'
        f'PDF attached. Reply to this email with any questions.\n\n{sender}\n{invoice.user.email}'
    )
    return subject, _html_wrapper(body), plain


# day-overdue threshold -> (reminder_number, template key) — matches
# InvoiceReminder.TEMPLATE_CHOICES exactly (models.py).
REMINDER_SCHEDULE = [
    (3, 1, 'reminder_1'),
    (7, 2, 'reminder_2'),
    (14, 3, 'reminder_3'),
    (30, 4, 'reminder_4'),
]


def build_reminder_email(invoice, reminder_number):
    """
    Subject/HTML/plain-text for an escalating reminder — tone ported
    directly from v1-reference/apps/invoices/email_service.py's
    send_invoice_reminder_email (polite -> firm -> formal -> final),
    adapted only for v2's real days_overdue property (no stored
    'overdue' status to reference) and the dropped view/portal links.
    Returns (subject, html, plain).
    """
    sender = _sender_name(invoice.user, getattr(invoice.user, 'profile', None))
    amount = _fmt_money(invoice.total, invoice.currency)
    due = invoice.due_date.strftime('%d %b %Y') if invoice.due_date else '—'
    days = invoice.days_overdue

    if reminder_number == 1:
        subject = f'Reminder — Invoice {invoice.invoice_number} is {days} days overdue'
        body = f"""
<p style="margin:0 0 16px;font-size:16px;font-weight:700;color:#1e293b;">Payment Reminder</p>
<p style="margin:0 0 16px;font-size:14px;color:#334155;line-height:1.7;">Hi {invoice.client_name},<br/><br/>
Just a friendly reminder that invoice <strong>{invoice.invoice_number}</strong> for <strong>{amount}</strong> was due on <strong>{due}</strong>.
If you've already paid, please ignore this.</p>
<p style="margin:0;font-size:13px;color:#64748b;">{sender}</p>"""
        plain = (
            f'Hi {invoice.client_name},\n\nReminder: Invoice {invoice.invoice_number} for {amount} '
            f'was due {due} and is {days} days overdue.\n\n{sender}'
        )
    elif reminder_number == 2:
        subject = f'Invoice {invoice.invoice_number} — {days} days overdue'
        body = f"""
<p style="margin:0 0 16px;font-size:16px;font-weight:700;color:#1e293b;">Invoice Overdue</p>
<p style="margin:0 0 16px;font-size:14px;color:#334155;line-height:1.7;">Dear {invoice.client_name},<br/><br/>
Invoice <strong>{invoice.invoice_number}</strong> for <strong>{amount}</strong> (due {due}) is now <strong>{days} days overdue</strong>.
Please arrange payment or reply if there is an issue.</p>
<p style="margin:0;font-size:13px;color:#64748b;">{sender}</p>"""
        plain = (
            f'Dear {invoice.client_name},\n\nInvoice {invoice.invoice_number} for {amount} is '
            f'{days} days overdue (due {due}). Please pay immediately.\n\n{sender}'
        )
    elif reminder_number == 3:
        subject = f'URGENT — Invoice {invoice.invoice_number} — {days} days overdue'
        body = f"""
<p style="margin:0 0 16px;font-size:16px;font-weight:700;color:#dc2626;">Urgent — Payment Required</p>
<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px 16px;margin:0 0 16px;">
  <p style="margin:0;font-size:13px;font-weight:600;color:#dc2626;">&#9888; {days} days overdue — please respond within 48 hours</p>
</div>
<p style="margin:0 0 16px;font-size:14px;color:#334155;line-height:1.7;">Dear {invoice.client_name},<br/><br/>
Invoice <strong>{invoice.invoice_number}</strong> for <strong>{amount}</strong> remains unpaid.
Please respond within 48 hours or contact us immediately.</p>
<p style="margin:0;font-size:13px;color:#64748b;">{sender} &bull; <a href="mailto:{invoice.user.email}" style="color:#1a3a5c;">{invoice.user.email}</a></p>"""
        plain = (
            f'URGENT: Invoice {invoice.invoice_number} for {amount} is {days} days overdue. '
            f'Please respond within 48 hours.\n\n{sender}\n{invoice.user.email}'
        )
    else:
        subject = f'FINAL NOTICE — Invoice {invoice.invoice_number} — {days} days overdue'
        body = f"""
<p style="margin:0 0 16px;font-size:16px;font-weight:700;color:#7f1d1d;">Final Notice</p>
<div style="background:#fef2f2;border:2px solid #dc2626;border-radius:8px;padding:12px 16px;margin:0 0 16px;">
  <p style="margin:0;font-size:13px;font-weight:700;color:#991b1b;">&#128308; Final notice — full payment required within 7 days</p>
</div>
<table style="width:100%;border-collapse:collapse;margin:0 0 16px;">
  <tr><td style="padding:6px 0;font-size:13px;color:#64748b;font-weight:600;width:40%;">Invoice</td><td style="font-size:13px;color:#1e293b;">{invoice.invoice_number}</td></tr>
  <tr><td style="padding:6px 0;font-size:13px;color:#64748b;font-weight:600;">Amount Due</td><td style="font-size:13px;font-weight:700;color:#dc2626;">{amount}</td></tr>
  <tr><td style="padding:6px 0;font-size:13px;color:#64748b;font-weight:600;">Original Due</td><td style="font-size:13px;color:#1e293b;">{due}</td></tr>
  <tr><td style="padding:6px 0;font-size:13px;color:#64748b;font-weight:600;">Days Overdue</td><td style="font-size:13px;font-weight:700;color:#dc2626;">{days}</td></tr>
</table>
<p style="margin:0;font-size:13px;color:#64748b;">{sender} &bull; <a href="mailto:{invoice.user.email}" style="color:#1a3a5c;">{invoice.user.email}</a></p>"""
        plain = (
            f'FINAL NOTICE: Invoice {invoice.invoice_number} for {amount} is {days} days overdue. '
            f'Payment required within 7 days.\n\n{sender}\n{invoice.user.email}'
        )

    return subject, _html_wrapper(body), plain


def _sender_name(user, profile):
    if profile:
        if profile.business_name:
            return profile.business_name
        if profile.display_name:
            return profile.display_name
    return user.get_full_name() or user.username


def get_reply_to_address(invoice):
    """
    reply+<view_token>@lanceraos.com — the established pattern, ported
    directly from v1-reference/apps/invoices/email_service.py's own
    `_get_reply_to_address` (checked directly rather than invented here).
    view_token is already unique/unguessable (Invoice.view_token), so
    this doubles as the correlation key an inbound-reply webhook would
    need to match a reply back to the right invoice — see DECISIONS.md
    for why building that inbound handler itself is explicitly out of
    this step's scope (belongs to Comments, Step 13).
    """
    return f'reply+{invoice.view_token}@lanceraos.com'


def _get_custom_smtp_connection(profile):
    """
    Decrypts custom_smtp_password ONLY here (CLAUDE.md rule 6) — never in
    a view, serializer, or anywhere upstream of this call. Mirrors
    apps/users/views/smtp.py's save_custom_smtp connection-building
    exactly (same backend string, same kwarg shape), since that's real,
    already-audited precedent for constructing this exact connection.
    """
    return get_connection(
        backend='django.core.mail.backends.smtp.EmailBackend',
        host=profile.custom_smtp_host,
        port=profile.custom_smtp_port,
        username=profile.custom_smtp_username,
        password=decrypt_field(profile.custom_smtp_password or ''),
        use_tls=profile.custom_smtp_use_tls,
        use_ssl=profile.custom_smtp_use_ssl,
        fail_silently=False,
        timeout=REQUEST_TIMEOUT_SECONDS,
    )


def _get_custom_smtp_from_address(user, profile):
    display = profile.custom_smtp_from_name or _sender_name(user, profile)
    address = profile.custom_smtp_username or user.email
    return f'{display} <{address}>'


def fetch_invoice_pdf_bytes(invoice):
    """
    Fetches the already-frozen PDF from its stored Cloudinary pdf_url —
    never re-renders it (the freeze point is _finalise_invoice; see that
    function's own docstring). Returns None on any failure rather than
    raising, so callers decide what a missing PDF means for their own
    send (a hard failure for the real send; reminders never attach a PDF
    at all, matching v1's own reminder emails).
    """
    if not invoice.pdf_url:
        return None
    try:
        resp = requests.get(invoice.pdf_url, timeout=REQUEST_TIMEOUT_SECONDS)
        resp.raise_for_status()
        return resp.content
    except requests.RequestException:
        logger.exception('Failed to fetch stored PDF for invoice_id=%s from %s', invoice.pk, invoice.pdf_url)
        return None


def send_invoice_related_email(invoice, subject, html_body, plain_body, *, pdf_bytes=None, request_id=None):
    """
    THE shared custom-SMTP-vs-Resend routing function — the one place
    this decision chain exists, called by invoice_send (views.py, real
    send, pdf_bytes populated) and the reminder task (tasks.py,
    pdf_bytes=None; v1 never attaches a PDF to reminder emails either).

    User is always cc'd on the email to their client — real, ported
    precedent (v1-reference/apps/invoices/email_service.py's
    `_send_with_fallback`), not a new addition: the freelancer should
    have their own copy of what just went out in their name.

    Returns a result dict — never raises:
      {'sent': bool, 'sent_via': 'custom_smtp'|'resend'|None,
       'smtp_host': str|None, 'provider_message_id': str|None,
       'fallback_used': bool, 'error': str|None}
    """
    user = invoice.user
    try:
        profile = user.profile
    except FreelancerProfile.DoesNotExist:
        profile = None

    reply_to = get_reply_to_address(invoice)
    use_custom = bool(profile and profile.custom_smtp_enabled and profile.custom_smtp_verified)
    attachment_filename = f'{invoice.invoice_number or "invoice"}.pdf'

    if use_custom:
        try:
            connection = _get_custom_smtp_connection(profile)
            from_address = _get_custom_smtp_from_address(user, profile)
            msg = EmailMultiAlternatives(
                subject=subject, body=plain_body, from_email=from_address,
                to=[invoice.client_email], cc=[user.email], reply_to=[reply_to],
                connection=connection,
            )
            msg.attach_alternative(html_body, 'text/html')
            if pdf_bytes:
                msg.attach(attachment_filename, pdf_bytes, 'application/pdf')
            msg.send(fail_silently=False)

            result = {
                'sent': True, 'sent_via': 'custom_smtp', 'smtp_host': profile.custom_smtp_host,
                'provider_message_id': None, 'fallback_used': False, 'error': None,
            }
            _log_email_result(invoice, subject, request_id, result)
            return result
        except Exception as exc:
            error_message = str(exc)
            logger.error(
                '[INVOICE EMAIL] Custom SMTP failed user_id=%s smtp_host=%s error=%s — falling back to Resend.',
                user.pk, profile.custom_smtp_host, error_message,
            )
            # CLAUDE.md rule 4: immediately fall back (below), notify the
            # user in-app (the CustomSmtpFailed handler in
            # apps/invoices/notifications.py turns this into the exact
            # specified copy + AuditLog entry the notification bell
            # reads), and log user_id/smtp_host/error_message/
            # fallback_used=True/timestamp (done here AND in the
            # fallback's own _log_email_result call below).
            emit(
                'CustomSmtpFailed',
                user_id=str(user.pk), invoice_id=str(invoice.pk),
                client_name=invoice.client_name, client_email=invoice.client_email,
                smtp_host=profile.custom_smtp_host, error_message=error_message,
            )

    attachments = None
    if pdf_bytes:
        attachments = [{'filename': attachment_filename, 'content_base64': base64.b64encode(pdf_bytes).decode('ascii')}]

    detailed = send_email_detailed(
        to=invoice.client_email, subject=subject, html_body=html_body, text_body=plain_body,
        cc=[user.email], reply_to=reply_to, attachments=attachments,
    )
    result = {
        'sent': detailed['sent'], 'sent_via': 'resend', 'smtp_host': None,
        'provider_message_id': detailed['provider_message_id'],
        'fallback_used': use_custom, 'error': detailed['error'],
    }
    _log_email_result(invoice, subject, request_id, result)
    return result


def _log_email_result(invoice, subject, request_id, result):
    """
    Full observability per CLAUDE.md's Observability Rules item 3:
    request_id, recipient, subject, sent_via, smtp_host,
    provider_message_id, status, timestamp — one structured log line,
    correlatable by request_id with the rest of that request's timeline
    exactly as core.middleware's own RequestLoggingMiddleware intends.
    """
    if not result['sent']:
        status_label = 'failed'
    elif result['fallback_used']:
        status_label = 'fallback_used'
    else:
        status_label = 'sent'

    logger.info(
        '[INVOICE EMAIL] request_id=%s recipient=%s subject=%s sent_via=%s smtp_host=%s '
        'provider_message_id=%s status=%s timestamp=%s',
        request_id, invoice.client_email, subject, result['sent_via'], result['smtp_host'],
        result['provider_message_id'], status_label, timezone.now().isoformat(),
    )
