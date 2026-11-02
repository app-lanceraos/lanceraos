# apps/proposals/emails.py
"""
The three Proposals emails: the proposal itself to the client, and "accepted" /
"declined" to the freelancer.

EVERY value interpolated into HTML goes through `escape()` — names, titles, the
sender, the client's message. A client types the message on a public page and
the freelancer types the title, so either can contain markup; this module's
HTML must never carry it through raw. (The invoice email builders in
apps/invoices/email_service.py do NOT escape — see DECISIONS.md, 02 November
2026; they are not touched here.) Plain-text bodies are plain and need no
escaping. Subjects are single-line: whitespace (CR, LF, tab, ...) collapses to
one space so a pasted title cannot inject a header line.

`_html_wrapper` is a local copy of the small branded wrapper in
apps/invoices/email_service.py, which is private to that app; promoting one
shared copy to core/ is a follow-up that needs a change in apps/invoices.
"""
import re
from datetime import date

from django.conf import settings
from django.utils.html import escape

from apps.invoices.models import CURRENCY_SYMBOLS

SUBJECT_TITLE_MAX = 100
_WHITESPACE = re.compile(r'\s+')
_CONTROL = re.compile(r'[\x00-\x1f\x7f]')


def _one_line(text, limit=None):
    """Collapses every run of whitespace/control characters to one space; optionally caps the length."""
    cleaned = _WHITESPACE.sub(' ', _CONTROL.sub(' ', text or '')).strip()
    return cleaned[:limit].rstrip() if limit else cleaned


def _money(amount, currency):
    symbol = CURRENCY_SYMBOLS.get(currency, f'{currency} ')
    return f'{symbol}{amount:,.2f}'


def _date(value):
    return value.strftime('%d %b %Y') if isinstance(value, date) else ''


def _html_wrapper(body_html):
    """Minimal branded HTML wrapper — same brand tokens as the rest of the app's emails."""
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


def build_client_proposal_email(proposal, sender_name):
    """
    To the CLIENT (sent through core.email.send_client_facing_email, so the
    freelancer's custom SMTP is used when configured). Returns
    (subject, html, plain). Deliberately does NOT paste the proposal text: the
    public page is the record. Carries no proposal number either — the number
    is assigned only after this email has been sent (see views.proposal_send).
    """
    title = _one_line(proposal.title, SUBJECT_TITLE_MAX)
    sender = _one_line(sender_name) or 'Your freelancer'
    subject = f'Proposal from {sender}: {title}'

    greeting_name = (proposal.client_name or '').strip()
    html_greeting = f'Hi {escape(greeting_name)},' if greeting_name else 'Hello,'
    plain_greeting = f'Hi {greeting_name},' if greeting_name else 'Hello,'

    facts_html = ''
    facts_plain = ''
    if proposal.total > 0:
        total = _money(proposal.total, proposal.currency)
        facts_html += f'<p style="margin:0 0 4px;font-size:13px;color:#334155;">Total: <strong>{escape(total)}</strong></p>'
        facts_plain += f'Total: {total}\n'
    if proposal.valid_until:
        valid = _date(proposal.valid_until)
        facts_html += f'<p style="margin:0 0 4px;font-size:13px;color:#334155;">Valid until: <strong>{escape(valid)}</strong></p>'
        facts_plain += f'Valid until: {valid}\n'

    url = proposal.public_url
    body = f"""
<p style="margin:0 0 16px;font-size:16px;font-weight:700;color:#1e293b;">{html_greeting}</p>
<p style="margin:0 0 16px;font-size:13px;color:#334155;">{escape(sender)} has sent you a proposal.</p>
<p style="margin:0 0 12px;font-size:15px;font-weight:700;color:#1e293b;">{escape(proposal.title)}</p>
{facts_html}
<p style="margin:24px 0;">
  <a href="{escape(url)}" style="background:#00c896;color:#fff;font-weight:700;font-size:14px;text-decoration:none;padding:12px 24px;border-radius:8px;display:inline-block;">View proposal</a>
</p>
<p style="margin:0;font-size:13px;color:#64748b;">You can accept or decline it on that page.</p>"""
    plain = (
        f'{plain_greeting}\n\n{sender} has sent you a proposal.\n\n{proposal.title}\n'
        f'{facts_plain}\nView proposal: {url}\n\nYou can accept or decline it on that page.'
    )
    return subject, _html_wrapper(body), plain


def build_proposal_answered_email(proposal, decision):
    """
    To the FREELANCER (platform email via core.email.send_email — a notice
    about their own account activity, never sent as their business). `decision`
    is 'accepted' or 'declined'. Returns (subject, html, plain).
    """
    accepted = decision == 'accepted'
    title = _one_line(proposal.title, SUBJECT_TITLE_MAX)
    subject = f'Proposal {"accepted" if accepted else "declined"}: {title}'
    who = (proposal.client_name or '').strip() or (proposal.client_email or '').strip() or 'Your client'
    verb = 'accepted' if accepted else 'declined'
    number = f' ({proposal.proposal_number})' if proposal.proposal_number else ''
    message = (proposal.response_message or '').strip()
    url = f'{settings.FRONTEND_URL}/proposals?proposal={proposal.pk}'

    message_html = ''
    message_plain = ''
    if message:
        message_html = (
            '<p style="margin:16px 0 4px;font-size:12px;color:#64748b;">Their message:</p>'
            f'<div style="white-space:pre-wrap;font-size:13px;color:#334155;background:#f4f6f8;'
            f'border-radius:8px;padding:12px 14px;">{escape(message)}</div>'
        )
        message_plain = f'\nTheir message:\n{message}\n'

    next_step_html = (
        '<p style="margin:16px 0 0;font-size:13px;color:#334155;">Next: create an invoice from it.</p>'
        if accepted else ''
    )
    next_step_plain = '\nNext: create an invoice from it.\n' if accepted else ''

    body = f"""
<p style="margin:0 0 16px;font-size:16px;font-weight:700;color:#1e293b;">Proposal {verb}</p>
<p style="margin:0;font-size:13px;color:#334155;">{escape(who)} {verb} your proposal
<strong>{escape(proposal.title)}</strong>{escape(number)}.</p>
{message_html}
{next_step_html}
<p style="margin:24px 0 0;"><a href="{escape(url)}" style="color:#00c896;font-weight:600;text-decoration:none;">Open the proposal &rarr;</a></p>"""
    plain = (
        f'{who} {verb} your proposal "{proposal.title}"{number}.\n{message_plain}{next_step_plain}\n'
        f'Open the proposal: {url}'
    )
    return subject, _html_wrapper(body), plain
