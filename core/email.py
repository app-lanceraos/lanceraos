# core/email.py
"""
Every email in LanceraOS goes through send_email() — never Django's
email backend, never smtplib directly (CLAUDE.md rule 3). This module
covers the Resend HTTP API call itself.

The custom-SMTP-vs-Resend routing decision chain (client-facing emails:
invoice delivery, proposal delivery, etc., which check the sending
user's FreelancerProfile.custom_smtp_* fields) is NOT built here — it
belongs with the modules that actually need it (invoices, proposals,
contracts), since apps/users never needs that chain at all. Per
CLAUDE.md: registration, password reset, 2FA codes, and security alerts
are platform security emails that must ALWAYS come from lanceraos.com
regardless of any user's custom SMTP config — so apps/users always
calls send_email() directly, with no routing decision to make.

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

logger = logging.getLogger(__name__)

RESEND_API_URL = 'https://api.resend.com/emails'
REQUEST_TIMEOUT_SECONDS = 10


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