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
"""
import logging

import requests
from django.conf import settings

logger = logging.getLogger(__name__)

RESEND_API_URL = 'https://api.resend.com/emails'
REQUEST_TIMEOUT_SECONDS = 10


def send_email(to, subject, html_body, text_body=None):
    """
    Sends one email via the Resend HTTP API. Returns True/False, never
    raises — a transient email-provider outage must not 500 an otherwise-
    successful registration or login. Callers that need to react to a
    failure (e.g. a 2FA login where no code was actually delivered) check
    the return value and respond accordingly, exactly as v1 already did.
    """
    api_key = getattr(settings, 'RESEND_API_KEY', '')
    from_email = getattr(settings, 'DEFAULT_FROM_EMAIL', 'LanceraOS <noreply@lanceraos.com>')

    if not api_key:
        logger.error('RESEND_API_KEY is not configured — cannot send "%s" to %s', subject, to)
        return False

    payload = {'from': from_email, 'to': [to], 'subject': subject, 'html': html_body}
    if text_body:
        payload['text'] = text_body

    try:
        resp = requests.post(
            RESEND_API_URL,
            json=payload,
            headers={'Authorization': f'Bearer {api_key}'},
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
    except requests.RequestException:
        logger.exception('Resend API request failed for "%s" to %s', subject, to)
        return False

    if resp.status_code >= 400:
        logger.error(
            'Resend API returned %s for "%s" to %s: %s',
            resp.status_code, subject, to, resp.text[:500],
        )
        return False

    return True