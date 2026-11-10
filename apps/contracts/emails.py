# apps/contracts/emails.py
"""
The four Contracts emails (Prompt 22, Part 7): the contract itself to the client, "you signed" (with the signed PDF)
to the client, "signed" (with the signed PDF) and "declined" to the freelancer.

EVERY value interpolated into HTML goes through `escape()` - names, titles, the sender, the client's reason. A client
types the name and the reason on a public page and the freelancer types the title, so either can contain markup; this
module's HTML must never carry it through raw. Plain-text bodies are plain and need no escaping. Subjects are
single-line: whitespace (CR, LF, tab, ...) collapses to one space so a pasted title cannot inject a header line.

No sentence here claims legal effect, certification or that anyone's identity was checked (decision K16): the emails
say what is RECORDED - the typed name, the time, the IP address and the browser details.
"""
from datetime import date, datetime

from django.conf import settings
from django.utils.html import escape

from apps.invoices.models import CURRENCY_SYMBOLS
from core.email_html import html_wrapper as _html_wrapper
from core.email_html import one_line as _one_line

from . import copy as words

SUBJECT_TITLE_MAX = 100


def _money(amount, currency):
    symbol = CURRENCY_SYMBOLS.get(currency, f'{currency} ')
    return f'{symbol}{amount:,.2f}'


def _date(value):
    return value.strftime('%d %b %Y') if isinstance(value, date) else ''


def _datetime(value):
    return value.strftime('%d %b %Y, %H:%M') + ' PKT' if isinstance(value, datetime) else ''


def _facts(contract):
    """(html, plain) lines for the fee and the sign-by date, each only when set."""
    html = ''
    plain = ''
    if contract.fee_amount and contract.fee_amount > 0:
        fee = _money(contract.fee_amount, contract.currency)
        html += f'<p style="margin:0 0 4px;font-size:13px;color:#334155;">Fee: <strong>{escape(fee)}</strong></p>'
        plain += f'Fee: {fee}\n'
    if contract.valid_until:
        sign_by = _date(contract.valid_until)
        html += f'<p style="margin:0 0 4px;font-size:13px;color:#334155;">Sign by: <strong>{escape(sign_by)}</strong></p>'
        plain += f'Sign by: {sign_by}\n'
    return html, plain


def build_client_contract_email(contract, sender_name):
    """
    To the CLIENT (sent through core.email.send_client_facing_email, so the freelancer's custom SMTP is used when
    configured). Returns (subject, html, plain). Deliberately does NOT paste the contract text: the public page is
    the record. Carries no contract number - the number is assigned only after this email has been sent.
    """
    title = _one_line(contract.title, SUBJECT_TITLE_MAX)
    sender = _one_line(sender_name) or 'Your freelancer'
    subject = f'Contract from {sender}: {title}'

    greeting_name = _one_line(contract.client_name)
    html_greeting = f'Hi {escape(greeting_name)},' if greeting_name else 'Hello,'
    plain_greeting = f'Hi {greeting_name},' if greeting_name else 'Hello,'
    facts_html, facts_plain = _facts(contract)
    intro = words.EMAIL_SENT_INTRO.format(sender=sender)

    url = contract.public_url
    body = f"""
<p style="margin:0 0 16px;font-size:16px;font-weight:700;color:#1e293b;">{html_greeting}</p>
<p style="margin:0 0 16px;font-size:13px;color:#334155;">{escape(intro)}</p>
<p style="margin:0 0 12px;font-size:15px;font-weight:700;color:#1e293b;">{escape(_one_line(contract.title))}</p>
{facts_html}
<p style="margin:24px 0;">
  <a href="{escape(url)}" style="background:#00c896;color:#fff;font-weight:700;font-size:14px;text-decoration:none;padding:12px 24px;border-radius:8px;display:inline-block;">{escape(words.EMAIL_BUTTON)}</a>
</p>
<p style="margin:0;font-size:13px;color:#64748b;">{escape(words.EMAIL_RECORDED)}</p>"""
    plain = (
        f'{plain_greeting}\n\n{intro}\n\n{_one_line(contract.title)}\n'
        f'{facts_plain}\n{words.EMAIL_BUTTON}: {url}\n\n{words.EMAIL_RECORDED}'
    )
    return subject, _html_wrapper(body), plain


def build_contract_signed_client_email(contract):
    """To the CLIENT after they sign: a copy is attached and the page is linked. Returns (subject, html, plain)."""
    title = _one_line(contract.title, SUBJECT_TITLE_MAX)
    subject = f'You signed: {title}'
    name = _one_line(contract.client_name) or _one_line(contract.signed_name)
    html_greeting = f'Hi {escape(name)},' if name else 'Hello,'
    plain_greeting = f'Hi {name},' if name else 'Hello,'
    when = _datetime(contract.responded_at)
    line = f'You signed "{_one_line(contract.title)}" as {_one_line(contract.signed_name)}' + (f' on {when}.' if when else '.')
    url = contract.public_url

    body = f"""
<p style="margin:0 0 16px;font-size:16px;font-weight:700;color:#1e293b;">{html_greeting}</p>
<p style="margin:0 0 12px;font-size:13px;color:#334155;">{escape(line)}</p>
<p style="margin:0 0 12px;font-size:13px;color:#334155;">{escape(words.EMAIL_SIGNED_COPY)}</p>
<p style="margin:24px 0 0;"><a href="{escape(url)}" style="color:#00c896;font-weight:600;text-decoration:none;">Open the contract &rarr;</a></p>"""
    plain = f'{plain_greeting}\n\n{line}\n{words.EMAIL_SIGNED_COPY}\n\nOpen the contract: {url}'
    return subject, _html_wrapper(body), plain


def build_contract_signed_owner_email(contract):
    """To the FREELANCER when the client signs (platform email; the signed PDF is attached). Returns (subject, html, plain)."""
    title = _one_line(contract.title, SUBJECT_TITLE_MAX)
    subject = f'Contract signed: {title}'
    who = _one_line(contract.signed_name) or _one_line(contract.client_name) or 'Your client'
    number = f' ({contract.contract_number})' if contract.contract_number else ''
    when = _datetime(contract.responded_at)
    line = f'{who} signed your contract "{_one_line(contract.title)}"{number}' + (f' on {when}.' if when else '.')
    url = f'{settings.FRONTEND_URL}/contracts?contract={contract.pk}'

    body = f"""
<p style="margin:0 0 16px;font-size:16px;font-weight:700;color:#1e293b;">Contract signed</p>
<p style="margin:0 0 12px;font-size:13px;color:#334155;">{escape(line)}</p>
<p style="margin:0 0 12px;font-size:13px;color:#334155;">{escape(words.EMAIL_SIGNED_COPY)}</p>
<p style="margin:24px 0 0;"><a href="{escape(url)}" style="color:#00c896;font-weight:600;text-decoration:none;">Open the contract &rarr;</a></p>"""
    plain = f'{line}\n{words.EMAIL_SIGNED_COPY}\n\nOpen the contract: {url}'
    return subject, _html_wrapper(body), plain


def build_contract_declined_owner_email(contract):
    """To the FREELANCER when the client declines, with the client's reason when given. Returns (subject, html, plain)."""
    title = _one_line(contract.title, SUBJECT_TITLE_MAX)
    subject = f'Contract declined: {title}'
    who = _one_line(contract.client_name) or _one_line(contract.client_email) or 'Your client'
    number = f' ({contract.contract_number})' if contract.contract_number else ''
    reason = (contract.response_message or '').strip()
    line = f'{who} declined your contract "{_one_line(contract.title)}"{number}.'
    url = f'{settings.FRONTEND_URL}/contracts?contract={contract.pk}'

    reason_html = ''
    reason_plain = ''
    if reason:
        reason_html = (
            '<p style="margin:16px 0 4px;font-size:12px;color:#64748b;">Their reason:</p>'
            f'<div style="white-space:pre-wrap;font-size:13px;color:#334155;background:#f4f6f8;'
            f'border-radius:8px;padding:12px 14px;">{escape(reason)}</div>'
        )
        reason_plain = f'\nTheir reason:\n{reason}\n'

    body = f"""
<p style="margin:0 0 16px;font-size:16px;font-weight:700;color:#1e293b;">Contract declined</p>
<p style="margin:0;font-size:13px;color:#334155;">{escape(line)}</p>
{reason_html}
<p style="margin:24px 0 0;"><a href="{escape(url)}" style="color:#00c896;font-weight:600;text-decoration:none;">Open the contract &rarr;</a></p>"""
    plain = f'{line}\n{reason_plain}\nOpen the contract: {url}'
    return subject, _html_wrapper(body), plain
