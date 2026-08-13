# core/email.py
"""
Every email in LanceraOS goes through send_email() — never Django's
email backend, never smtplib directly (CLAUDE.md rule 3). This module
covers the Resend HTTP API call itself.

registration, password reset, 2FA codes, and security alerts are
platform security emails that must ALWAYS come from lanceraos.com
regardless of any user's custom SMTP config — so apps/users always
calls send_email() directly, with no routing decision to make.

The custom-SMTP-vs-Resend routing decision chain (client-facing emails:
invoice delivery, proposal delivery, client portal links, etc., which
check the sending user's FreelancerProfile.custom_smtp_* fields) DOES
live here now, as send_client_facing_email() below — originally built
inside apps/invoices/email_service.py (Step 10, as
send_invoice_related_email) since apps/invoices was its first real
consumer. Promoted to core this pass (Step 11) once apps.clients (the
portal magic-link resend email) needed the exact same chain:
apps.clients importing it from apps.invoices would have created an
apps.clients -> apps.invoices dependency, violating this project's
one-directional apps.invoices -> apps.clients rule
(INVOICES_CLIENTS_TECHNICAL_SPEC.md Section 2). core/ has no
app-specific dependents at all, so this is the correct shared home —
confirmed by construction: this file imports nothing from apps/.
apps/invoices/email_service.py's own send_invoice_related_email is now
a thin wrapper that builds invoice-specific content and calls this.

apps/invoices is this module's first real routing-chain consumer (Step
10) — it needed `cc`/`reply_to`/`attachments` support and the real
Resend `provider_message_id` for observability, neither of which any
existing apps/users caller needs. Added as purely optional keyword
arguments precisely so every existing `send_email(to, subject, html)`
call site (apps/users/emails.py, all positional/2-3-arg) is completely
unaffected — same signature, same bool-only return.
"""
import base64
import logging

import requests
from django.conf import settings
from django.core.exceptions import ObjectDoesNotExist
from django.core.mail import EmailMultiAlternatives, get_connection
from django.utils import timezone

from core.encryption import decrypt_field
from core.events import emit

logger = logging.getLogger(__name__)

RESEND_API_URL = 'https://api.resend.com/emails'
REQUEST_TIMEOUT_SECONDS = 10
# Separate from REQUEST_TIMEOUT_SECONDS (the Resend HTTP call's own
# timeout) — this is the connection timeout for a USER's own SMTP
# server, a different real-world latency profile. Preserves the exact
# value send_invoice_related_email originally used before this move.
CUSTOM_SMTP_TIMEOUT_SECONDS = 15


def _send_via_resend(to, subject, html_body, text_body=None, cc=None, reply_to=None, attachments=None):
    """
    Does the actual Resend HTTP call and returns (success, message_id,
    error_detail) — never raises. `attachments` is a list of
    {'filename': str, 'content_base64': str} dicts; Resend's real HTTP
    API (not assumed — checked directly) accepts an `attachments` array
    of `{filename, content}` where `content` is base64-encoded, plus
    top-level `cc`/`reply_to` fields alongside `from`/`to`/`subject`.

    `message_id` extraction is wrapped in its own try/except separately
    from the request itself — a malformed or unexpected success-response
    body must never turn a delivered email into a reported failure.
    """
    api_key = getattr(settings, 'RESEND_API_KEY', '')
    from_email = getattr(settings, 'DEFAULT_FROM_EMAIL', 'LanceraOS <noreply@lanceraos.com>')

    if not api_key:
        logger.error('RESEND_API_KEY is not configured — cannot send "%s" to %s', subject, to)
        return False, None, 'not_configured'

    payload = {'from': from_email, 'to': [to], 'subject': subject, 'html': html_body}
    if text_body:
        payload['text'] = text_body
    if cc:
        payload['cc'] = cc
    if reply_to:
        payload['reply_to'] = reply_to
    if attachments:
        payload['attachments'] = [
            {'filename': a['filename'], 'content': a['content_base64']} for a in attachments
        ]

    try:
        resp = requests.post(
            RESEND_API_URL,
            json=payload,
            headers={'Authorization': f'Bearer {api_key}'},
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
    except requests.RequestException as exc:
        logger.exception('Resend API request failed for "%s" to %s', subject, to)
        return False, None, str(exc)

    if resp.status_code >= 400:
        logger.error(
            'Resend API returned %s for "%s" to %s: %s',
            resp.status_code, subject, to, resp.text[:500],
        )
        return False, None, f'resend_http_{resp.status_code}'

    message_id = None
    try:
        message_id = resp.json().get('id')
    except Exception:
        pass

    return True, message_id, None


def send_email(to, subject, html_body, text_body=None):
    """
    Sends one email via the Resend HTTP API. Returns True/False, never
    raises — a transient email-provider outage must not 500 an otherwise-
    successful registration or login. Callers that need to react to a
    failure (e.g. a 2FA login where no code was actually delivered) check
    the return value and respond accordingly, exactly as v1 already did.

    Thin wrapper over _send_via_resend() — every existing caller here
    only ever needed the bool, so this signature/contract is completely
    unchanged. New callers that need cc/reply_to/attachments or the real
    provider_message_id (apps/invoices) call send_email_detailed() below
    directly instead of this wrapper.
    """
    success, _message_id, _error = _send_via_resend(to, subject, html_body, text_body)
    return success


def send_email_detailed(to, subject, html_body, text_body=None, cc=None, reply_to=None, attachments=None):
    """
    Same Resend send as send_email(), but returns the full result dict
    a caller doing its own observability logging needs — never raises,
    same as send_email(). `attachments`: list of
    {'filename': str, 'content_base64': str}.
    """
    success, message_id, error = _send_via_resend(
        to, subject, html_body, text_body, cc=cc, reply_to=reply_to, attachments=attachments,
    )
    return {'sent': success, 'provider_message_id': message_id, 'error': error}


def pdf_bytes_to_attachment(filename, pdf_bytes):
    """Small helper — every PDF-attaching caller needs this exact shape."""
    return {'filename': filename, 'content_base64': base64.b64encode(pdf_bytes).decode('ascii')}


def sender_display_name(user, profile):
    """
    business_name -> display_name -> full name -> username, in that
    order. Moved here unchanged from apps/invoices/email_service.py's
    _sender_name — purely a User/FreelancerProfile concern, never an
    invoice one, so it belongs alongside the routing chain that uses it,
    not with the module that happened to write it first.
    """
    if profile:
        if profile.business_name:
            return profile.business_name
        if profile.display_name:
            return profile.display_name
    return user.get_full_name() or user.username


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
        timeout=CUSTOM_SMTP_TIMEOUT_SECONDS,
    )


def _get_custom_smtp_from_address(user, profile):
    display = profile.custom_smtp_from_name or sender_display_name(user, profile)
    address = profile.custom_smtp_username or user.email
    return f'{display} <{address}>'


def send_client_facing_email(user, to, subject, html_body, text_body=None, *, cc=None, reply_to=None,
                              attachments=None, recipient_name=None, context_type=None, context_id=None,
                              request_id=None):
    """
    THE shared custom-SMTP-vs-Resend routing chain for every client-
    facing email LanceraOS sends on a user's behalf — CLAUDE.md's Custom
    Email Rules items 1-7, followed exactly. See this module's own
    top-of-file docstring for why this now lives in core/ rather than
    apps/invoices/email_service.py (its original home).

    1. custom_smtp_enabled AND custom_smtp_verified on `user`'s
       FreelancerProfile -> send via their own SMTP server. Otherwise ->
       Resend, from noreply@lanceraos.com.
    4. Custom SMTP failure -> immediately fall back to Resend, emits
       'CustomSmtpFailed' (core/events.py's bus — app-agnostic by
       design, so apps/invoices/notifications.py's already-registered
       handler processes this identically whether the failure came from
       an invoice send or a client-portal email; no import needed either
       direction) for the in-app notification + AuditLog write CLAUDE.md
       requires, and logs user_id/smtp_host/error_message/
       fallback_used=True/timestamp. The CLIENT-facing email itself is
       byte-for-byte the same regardless of which path sent it — the
       client is never told a fallback happened.
    5/6. custom_smtp_password is Fernet-encrypted at rest; decrypted
       ONLY inside _get_custom_smtp_connection, never in a view,
       serializer, or here directly.

    `attachments`: list of {'filename': str, 'content_base64': str} —
    same shape send_email_detailed already uses; decoded back to raw
    bytes only for the local custom-SMTP attach() call, which needs raw
    bytes rather than base64 text.
    `recipient_name` is used only for the CustomSmtpFailed notification's
    copy ("Your email to {name} was sent from noreply@...") — falls back
    to 'your client' if omitted (core/notifications.py's own existing
    fallback there). `context_type`/`context_id` are optional, generic
    correlation fields for observability/AuditLog (e.g. 'invoice',
    invoice.pk) — no caller is required to supply them, and a caller
    with no natural "context" (a portal magic-link resend, tied to a
    Client rather than any single artifact) can simply omit both.

    Returns a result dict — never raises:
      {'sent': bool, 'sent_via': 'custom_smtp'|'resend'|None,
       'smtp_host': str|None, 'provider_message_id': str|None,
       'fallback_used': bool, 'error': str|None}
    """
    try:
        profile = user.profile
    except ObjectDoesNotExist:
        profile = None

    use_custom = bool(profile and profile.custom_smtp_enabled and profile.custom_smtp_verified)

    if use_custom:
        try:
            connection = _get_custom_smtp_connection(profile)
            from_address = _get_custom_smtp_from_address(user, profile)
            msg = EmailMultiAlternatives(
                subject=subject, body=text_body or '', from_email=from_address,
                to=[to], cc=cc or [], reply_to=[reply_to] if reply_to else None,
                connection=connection,
            )
            msg.attach_alternative(html_body, 'text/html')
            for a in (attachments or []):
                msg.attach(a['filename'], base64.b64decode(a['content_base64']), 'application/pdf')
            msg.send(fail_silently=False)

            result = {
                'sent': True, 'sent_via': 'custom_smtp', 'smtp_host': profile.custom_smtp_host,
                'provider_message_id': None, 'fallback_used': False, 'error': None,
            }
            _log_client_email_result(to, subject, request_id, result)
            return result
        except Exception as exc:
            error_message = str(exc)
            logger.error(
                '[CLIENT EMAIL] Custom SMTP failed user_id=%s smtp_host=%s error=%s — falling back to Resend.',
                user.pk, profile.custom_smtp_host, error_message,
            )
            emit(
                'CustomSmtpFailed',
                user_id=str(user.pk), recipient_name=recipient_name, recipient_email=to,
                smtp_host=profile.custom_smtp_host, error_message=error_message,
                context_type=context_type, context_id=context_id,
            )

    detailed = send_email_detailed(
        to=to, subject=subject, html_body=html_body, text_body=text_body,
        cc=cc, reply_to=reply_to, attachments=attachments,
    )
    result = {
        'sent': detailed['sent'], 'sent_via': 'resend', 'smtp_host': None,
        'provider_message_id': detailed['provider_message_id'],
        'fallback_used': use_custom, 'error': detailed['error'],
    }
    _log_client_email_result(to, subject, request_id, result)
    return result


def _log_client_email_result(to, subject, request_id, result):
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
        '[CLIENT EMAIL] request_id=%s recipient=%s subject=%s sent_via=%s smtp_host=%s '
        'provider_message_id=%s status=%s timestamp=%s',
        request_id, to, subject, result['sent_via'], result['smtp_host'],
        result['provider_message_id'], status_label, timezone.now().isoformat(),
    )