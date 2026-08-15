# apps/invoices/email_service.py
"""
Invoice-specific email content (subject/HTML/plain-text builders) and the
Cloudinary-PDF-fetch self-heal chain. The actual custom-SMTP-vs-Resend
routing chain used to live entirely in this file (Step 10) but was
promoted to core/email.py as send_client_facing_email() this pass (Step
11), once apps.clients (the portal magic-link resend email) needed the
exact same chain — apps.clients importing it from here would have
created an apps.clients -> apps.invoices dependency, violating this
project's one-directional apps.invoices -> apps.clients rule
(INVOICES_CLIENTS_TECHNICAL_SPEC.md Section 2). See core/email.py's own
docstring for the full routing-chain documentation (CLAUDE.md's Custom
Email Rules 1-7) — send_invoice_related_email below is now a thin
wrapper: it builds the invoice-specific pieces (attachment, cc, reply-to,
recipient name, correlation id) and calls the shared core function.

Both invoice_send (views.py) and the reminder Celery task (tasks.py)
call send_invoice_related_email() below, so this invoice-specific
assembly exists exactly once, not duplicated per caller.
"""
import logging

import requests
from django.utils import timezone

from core.email import pdf_bytes_to_attachment, sender_display_name, send_client_facing_email

from .pdf_generator import render_invoice_pdf, upload_pdf_bytes

from .models import CURRENCY_SYMBOLS

logger = logging.getLogger(__name__)

REQUEST_TIMEOUT_SECONDS = 15


# ══════════════════════════════════════════════════════════════════
# EMAIL CONTENT — real send + reminders
# ══════════════════════════════════════════════════════════════════
# "View Invoice Online" now links to invoice.portal_view_url (Step 12's
# real, Django-served portal HTML page) — the client portal exists now,
# closing the gap this comment used to flag ("v1 links to
# /invoice/<view_token>, but that public page doesn't exist in v2 yet").
# The PDF is still attached to the real send (and its own QR code still
# encodes Invoice.payment_page_url, Step 7b) — the online link is an
# addition, not a replacement. The onboarding-message/portal-footer
# blocks v1 also appends are still NOT ported here — those depend on
# richer portal content (the two-way message thread, Step 13) this step
# doesn't build; see DECISIONS.md.

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
    sender = sender_display_name(invoice.user, getattr(invoice.user, "profile", None))
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
<p style="margin:0 0 16px;font-size:13px;color:#64748b;line-height:1.6;">
  The invoice PDF is attached to this email.<br/>Reply to this email if you have any questions.
</p>
<p style="margin:0 0 20px;">
  <a href="{invoice.portal_view_url}" style="color:#00c896;font-weight:600;text-decoration:none;">View Invoice Online &rarr;</a>
</p>
<p style="margin:20px 0 0;font-size:14px;color:#1e293b;">
  {sender}<br/><a href="mailto:{invoice.user.email}" style="color:#00c896;text-decoration:none;">{invoice.user.email}</a>
</p>"""

    plain = (
        f'Invoice from {sender}\n\nHi {invoice.client_name},\n\n'
        f'Invoice: {invoice.invoice_number}\nAmount:  {amount}\nDue:     {due}\n\n'
        f'PDF attached. Reply to this email with any questions.\n\n'
        f'View Invoice Online: {invoice.portal_view_url}\n\n{sender}\n{invoice.user.email}'
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
    adapted for v2's real days_overdue property (no stored 'overdue'
    status to reference). Every tier includes the "View Invoice Online"
    link (invoice.portal_view_url) now that the portal exists — the
    dropped-links note this docstring used to carry is stale (Step 12).
    Returns (subject, html, plain).
    """
    sender = sender_display_name(invoice.user, getattr(invoice.user, "profile", None))
    amount = _fmt_money(invoice.total, invoice.currency)
    due = invoice.due_date.strftime('%d %b %Y') if invoice.due_date else '—'
    days = invoice.days_overdue
    view_link_html = f'<p style="margin:0 0 16px;"><a href="{invoice.portal_view_url}" style="color:#00c896;font-weight:600;text-decoration:none;">View Invoice Online &rarr;</a></p>'
    view_link_plain = f'\n\nView Invoice Online: {invoice.portal_view_url}'

    if reminder_number == 1:
        subject = f'Reminder — Invoice {invoice.invoice_number} is {days} days overdue'
        body = f"""
<p style="margin:0 0 16px;font-size:16px;font-weight:700;color:#1e293b;">Payment Reminder</p>
<p style="margin:0 0 16px;font-size:14px;color:#334155;line-height:1.7;">Hi {invoice.client_name},<br/><br/>
Just a friendly reminder that invoice <strong>{invoice.invoice_number}</strong> for <strong>{amount}</strong> was due on <strong>{due}</strong>.
If you've already paid, please ignore this.</p>
{view_link_html}
<p style="margin:0;font-size:13px;color:#64748b;">{sender}</p>"""
        plain = (
            f'Hi {invoice.client_name},\n\nReminder: Invoice {invoice.invoice_number} for {amount} '
            f'was due {due} and is {days} days overdue.{view_link_plain}\n\n{sender}'
        )
    elif reminder_number == 2:
        subject = f'Invoice {invoice.invoice_number} — {days} days overdue'
        body = f"""
<p style="margin:0 0 16px;font-size:16px;font-weight:700;color:#1e293b;">Invoice Overdue</p>
<p style="margin:0 0 16px;font-size:14px;color:#334155;line-height:1.7;">Dear {invoice.client_name},<br/><br/>
Invoice <strong>{invoice.invoice_number}</strong> for <strong>{amount}</strong> (due {due}) is now <strong>{days} days overdue</strong>.
Please arrange payment or reply if there is an issue.</p>
{view_link_html}
<p style="margin:0;font-size:13px;color:#64748b;">{sender}</p>"""
        plain = (
            f'Dear {invoice.client_name},\n\nInvoice {invoice.invoice_number} for {amount} is '
            f'{days} days overdue (due {due}). Please pay immediately.{view_link_plain}\n\n{sender}'
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
{view_link_html}
<p style="margin:0;font-size:13px;color:#64748b;">{sender} &bull; <a href="mailto:{invoice.user.email}" style="color:#1a3a5c;">{invoice.user.email}</a></p>"""
        plain = (
            f'URGENT: Invoice {invoice.invoice_number} for {amount} is {days} days overdue. '
            f'Please respond within 48 hours.{view_link_plain}\n\n{sender}\n{invoice.user.email}'
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
{view_link_html}
<p style="margin:0;font-size:13px;color:#64748b;">{sender} &bull; <a href="mailto:{invoice.user.email}" style="color:#1a3a5c;">{invoice.user.email}</a></p>"""
        plain = (
            f'FINAL NOTICE: Invoice {invoice.invoice_number} for {amount} is {days} days overdue. '
            f'Payment required within 7 days.{view_link_plain}\n\n{sender}\n{invoice.user.email}'
        )

    return subject, _html_wrapper(body), plain


# ══════════════════════════════════════════════════════════════════
# EMAIL CONTENT — Formal Notice (Step 17, manual-only)
# ══════════════════════════════════════════════════════════════════

def build_formal_notice_email(invoice):
    """
    Firmer than even reminder_number==4's "final notice" tier — this is a
    deliberate, freelancer-triggered escalation, not an automated part of
    the day-3/7/14/30 schedule. States days overdue and amount owed
    explicitly, and points the client at the real comment thread/portal
    link to respond (invoice.portal_view_url — the same shared renderer,
    with Messages reachable from there for a saved client). No PDF
    attachment, matching build_reminder_email's own precedent ("v1 never
    attaches a PDF to reminder emails either").
    """
    sender = sender_display_name(invoice.user, getattr(invoice.user, 'profile', None))
    amount = _fmt_money(invoice.total, invoice.currency)
    due = invoice.due_date.strftime('%d %b %Y') if invoice.due_date else '—'
    days = invoice.days_overdue

    subject = f'Formal Notice — Invoice {invoice.invoice_number} ({days} days overdue)'
    body = f"""
<div style="background:#7f1d1d;border-radius:6px;padding:10px 14px;margin:0 0 20px;">
  <p style="margin:0;font-size:13px;font-weight:700;color:#fff;">FORMAL NOTICE OF OVERDUE PAYMENT</p>
</div>
<p style="margin:0 0 16px;font-size:14px;color:#334155;line-height:1.7;">Dear {invoice.client_name},<br/><br/>
This is a formal notice regarding invoice <strong>{invoice.invoice_number}</strong>, which remains
<strong>unpaid</strong> and is now <strong>{days} days overdue</strong>. Immediate payment is required.</p>
<table style="width:100%;border-collapse:collapse;margin:0 0 16px;">
  <tr><td style="padding:6px 0;font-size:13px;color:#64748b;font-weight:600;width:40%;">Invoice</td><td style="font-size:13px;color:#1e293b;">{invoice.invoice_number}</td></tr>
  <tr><td style="padding:6px 0;font-size:13px;color:#64748b;font-weight:600;">Amount Owed</td><td style="font-size:13px;font-weight:700;color:#dc2626;">{amount}</td></tr>
  <tr><td style="padding:6px 0;font-size:13px;color:#64748b;font-weight:600;">Original Due Date</td><td style="font-size:13px;color:#1e293b;">{due}</td></tr>
  <tr><td style="padding:6px 0;font-size:13px;color:#64748b;font-weight:600;">Days Overdue</td><td style="font-size:13px;font-weight:700;color:#dc2626;">{days}</td></tr>
</table>
<p style="margin:0 0 16px;font-size:13px;color:#334155;line-height:1.7;">
If there is a dispute or reason for non-payment, please respond via the invoice's own message thread
as soon as possible — we would rather resolve this directly.</p>
<p style="margin:0 0 16px;"><a href="{invoice.portal_view_url}" style="color:#00c896;font-weight:600;text-decoration:none;">View Invoice &amp; Respond &rarr;</a></p>
<p style="margin:0;font-size:13px;color:#64748b;">{sender} &bull; <a href="mailto:{invoice.user.email}" style="color:#1a3a5c;">{invoice.user.email}</a></p>"""
    plain = (
        f'FORMAL NOTICE: Invoice {invoice.invoice_number} for {amount} (due {due}) remains unpaid and is '
        f'{days} days overdue. Immediate payment is required.\n\n'
        f'Respond via the invoice thread: {invoice.portal_view_url}\n\n{sender}\n{invoice.user.email}'
    )
    return subject, _html_wrapper(body), plain


# ══════════════════════════════════════════════════════════════════
# EMAIL CONTENT — freelancer-facing lifecycle notifications
# (acknowledgment / escalation / recurring generation, Steps 15-17)
# ══════════════════════════════════════════════════════════════════
# All four are TO the freelancer about their own account activity —
# routed through plain core.email.send_email in notifications.py, never
# the custom-SMTP-vs-Resend chain, same reasoning
# build_unread_comments_email_for_freelancer's own docstring already
# gives (a notification about the freelancer's own account can't
# sensibly go out "as" their own business identity to themselves).

def build_invoice_acknowledged_email(invoice):
    subject = f'{invoice.client_name} acknowledged Invoice {invoice.invoice_number}'
    body = f"""
<p style="margin:0 0 16px;font-size:16px;font-weight:700;color:#1e293b;">Invoice acknowledged</p>
<p style="margin:0;font-size:13px;color:#334155;line-height:1.7;">
{invoice.client_name} has acknowledged Invoice <strong>{invoice.invoice_number}</strong> and its terms.</p>"""
    plain = f'{invoice.client_name} has acknowledged Invoice {invoice.invoice_number} and its terms.'
    return subject, _html_wrapper(body), plain


def build_escalation_required_email(invoice):
    amount = _fmt_money(invoice.total, invoice.currency)
    subject = f'Action needed — Invoice {invoice.invoice_number} is severely overdue'
    body = f"""
<p style="margin:0 0 16px;font-size:16px;font-weight:700;color:#dc2626;">Invoice needs your attention</p>
<p style="margin:0 0 16px;font-size:13px;color:#334155;line-height:1.7;">
Invoice <strong>{invoice.invoice_number}</strong> for <strong>{amount}</strong> is now {invoice.days_overdue} days
overdue and has gone through the full reminder schedule with no payment. Consider following up directly, or
sending a Formal Notice from the invoice.</p>"""
    plain = (
        f'Invoice {invoice.invoice_number} for {amount} is {invoice.days_overdue} days overdue and has gone '
        f'through the full reminder schedule with no payment. Consider a Formal Notice.'
    )
    return subject, _html_wrapper(body), plain


def build_recurring_generation_failed_email(invoice, failure_count):
    subject = f'A recurring invoice failed to generate ({invoice.invoice_number})'
    body = f"""
<p style="margin:0 0 16px;font-size:16px;font-weight:700;color:#dc2626;">Recurring invoice generation failed</p>
<p style="margin:0;font-size:13px;color:#334155;line-height:1.7;">
The next occurrence of your recurring series based on Invoice <strong>{invoice.invoice_number}</strong> failed
to generate (attempt {failure_count} of 3). LanceraOS will automatically retry on the next scheduled run.</p>"""
    plain = (
        f'The next occurrence of your recurring series based on Invoice {invoice.invoice_number} failed to '
        f'generate (attempt {failure_count} of 3). LanceraOS will retry automatically.'
    )
    return subject, _html_wrapper(body), plain


def build_recurring_generation_paused_email(invoice):
    subject = f'Recurring invoices paused — {invoice.invoice_number}'
    body = f"""
<p style="margin:0 0 16px;font-size:16px;font-weight:700;color:#dc2626;">Your recurring series has been paused</p>
<p style="margin:0;font-size:13px;color:#334155;line-height:1.7;">
The recurring series based on Invoice <strong>{invoice.invoice_number}</strong> failed to generate 3 times in a
row and has been automatically paused so it doesn't keep failing silently. Review and resume it from the
invoice when you're ready.</p>"""
    plain = (
        f'The recurring series based on Invoice {invoice.invoice_number} failed to generate 3 times in a row '
        f'and has been automatically paused. Review and resume it from the invoice when ready.'
    )
    return subject, _html_wrapper(body), plain


# ══════════════════════════════════════════════════════════════════
# EMAIL CONTENT — stale-draft weekly digest (Step 18)
# ══════════════════════════════════════════════════════════════════

def build_stale_drafts_email(draft_count, breakdown):
    """
    `breakdown`: {currency: Decimal total}, one line per currency —
    never summed together into one figure across different currencies
    (see notify_unread_comments... no, see notify_stale_drafts' own
    docstring for why: a still-draft invoice has no frozen conversion
    rate to sum against a draft in a different currency honestly).
    """
    plural = 's' if draft_count != 1 else ''
    subject = f'{draft_count} unsent draft invoice{plural} waiting'
    totals_html = ''.join(
        f'<li style="margin-bottom:4px;">{_fmt_money(total, currency)}</li>'
        for currency, total in breakdown.items()
    )
    body = f"""
<p style="margin:0 0 16px;font-size:16px;font-weight:700;color:#1e293b;">You have {draft_count} unsent draft{plural}</p>
<p style="margin:0 0 12px;font-size:13px;color:#334155;">
  These invoices have been sitting as drafts for over a week, totaling:
</p>
<ul style="margin:0 0 20px;padding-left:20px;font-size:13px;color:#334155;">{totals_html}</ul>
<p style="margin:0;font-size:13px;color:#64748b;">Finish and send them from your Invoices list whenever you're ready.</p>"""
    totals_plain = '\n'.join(f'{_fmt_money(total, currency)}' for currency, total in breakdown.items())
    plain = f'You have {draft_count} unsent draft{plural}, totaling:\n{totals_plain}\n\nFinish and send them from your Invoices list.'
    return subject, _html_wrapper(body), plain


# ══════════════════════════════════════════════════════════════════
# EMAIL CONTENT — unread-comment batch notification (Step 13)
# ══════════════════════════════════════════════════════════════════
# ONE email per invoice, covering everything unread at the 1-hour
# threshold (apps/invoices/tasks.py's notify_unread_comments) — never
# one email per comment. Two builders, not one: the framing differs by
# direction ("you have new messages" vs. "X sent you a new message"),
# and the recipient determines which routing chain sends it (see
# tasks.py's own docstring on the freelancer-vs-client distinction).

def build_unread_comments_email_for_freelancer(invoice, comments):
    """
    To the freelancer themselves — routed through plain core.email.send_email
    (tasks.py), never the custom-SMTP-vs-Resend chain. A notification
    about the freelancer's OWN account activity can't sensibly go out
    "as" the freelancer's own business identity to themselves — the
    custom-SMTP chain exists specifically for CLIENT-facing sends,
    structurally not applicable when the freelancer IS the recipient.
    """
    plural = 's' if len(comments) != 1 else ''
    subject = f'{len(comments)} new message{plural} on Invoice {invoice.invoice_number}'
    rows = ''.join(
        f'<li style="margin-bottom:8px;"><strong>{c.client_name or "Your client"}:</strong> '
        f'{(c.body_text or "")[:200]}</li>'
        for c in comments
    )
    body = f"""
<p style="margin:0 0 16px;font-size:16px;font-weight:700;color:#1e293b;">New message{plural} on Invoice {invoice.invoice_number}</p>
<ul style="margin:0 0 20px;padding-left:20px;font-size:13px;color:#334155;">{rows}</ul>
<p style="margin:0;font-size:13px;color:#64748b;">Reply from within LanceraOS to keep the conversation going.</p>"""
    plain_lines = '\n'.join(f'{c.client_name or "Your client"}: {(c.body_text or "")[:200]}' for c in comments)
    plain = f'{len(comments)} new message{plural} on Invoice {invoice.invoice_number}:\n\n{plain_lines}'
    return subject, _html_wrapper(body), plain


def build_unread_comments_email_for_client(invoice, comments):
    """To the client — routed through send_client_facing_email (tasks.py), the standard client-facing routing chain, per CLAUDE.md's Custom Email Rule 2 ('Client messages' is explicitly listed)."""
    sender = sender_display_name(invoice.user, getattr(invoice.user, 'profile', None))
    plural = 's' if len(comments) != 1 else ''
    subject = f'{len(comments)} new message{plural} from {sender}'
    rows = ''.join(
        f'<li style="margin-bottom:8px;">{(c.body_text or "")[:200]}</li>'
        for c in comments
    )
    body = f"""
<p style="margin:0 0 16px;font-size:16px;font-weight:700;color:#1e293b;">New message{plural} from {sender}</p>
<ul style="margin:0 0 20px;padding-left:20px;font-size:13px;color:#334155;">{rows}</ul>
<p style="margin:0;font-size:13px;color:#64748b;">
  <a href="{invoice.portal_view_url}" style="color:#00c896;font-weight:600;text-decoration:none;">View and reply &rarr;</a>
</p>"""
    plain_lines = '\n'.join((c.body_text or '')[:200] for c in comments)
    plain = f'{len(comments)} new message{plural} from {sender}:\n\n{plain_lines}\n\nView and reply: {invoice.portal_view_url}'
    return subject, _html_wrapper(body), plain


def build_payment_claim_submitted_email(invoice, claim):
    """
    To the freelancer themselves — routed through plain core.email.send_email
    (apps/invoices/notifications.py), never the custom-SMTP-vs-Resend chain,
    for the exact same reason build_unread_comments_email_for_freelancer
    above is: a notification about the freelancer's own account activity
    can't sensibly go out "as" their own business identity to themselves.
    """
    amount = _fmt_money(claim.amount_claimed, claim.currency)
    subject = f'{claim.client_name or "Your client"} reported a payment on Invoice {invoice.invoice_number}'
    note_row = f'<p style="margin:12px 0 0;font-size:13px;color:#334155;">"{claim.client_note}"</p>' if claim.client_note else ''
    body = f"""
<p style="margin:0 0 16px;font-size:16px;font-weight:700;color:#1e293b;">Payment reported on Invoice {invoice.invoice_number}</p>
<p style="margin:0 0 8px;font-size:13px;color:#334155;">
  {claim.client_name or 'Your client'} says they paid <strong>{amount}</strong>
  via {claim.get_payment_source_display()} on {claim.payment_date.strftime('%d %b %Y')}.
</p>
{note_row}
<p style="margin:16px 0 0;font-size:13px;color:#64748b;">Review this claim from Invoice {invoice.invoice_number} in LanceraOS to confirm or reject it.</p>"""
    plain = (
        f'{claim.client_name or "Your client"} reported a payment on Invoice {invoice.invoice_number}: '
        f'{amount} via {claim.get_payment_source_display()} on {claim.payment_date.strftime("%d %b %Y")}.'
        + (f'\n\n"{claim.client_note}"' if claim.client_note else '')
    )
    return subject, _html_wrapper(body), plain


def build_payment_claim_confirmed_email(invoice, claim):
    """To the client — routed through send_client_facing_email, the standard client-facing routing chain, per CLAUDE.md's Custom Email Rule 2."""
    sender = sender_display_name(invoice.user, getattr(invoice.user, 'profile', None))
    amount = _fmt_money(claim.amount_claimed, claim.currency)
    subject = f'Payment confirmed — Invoice {invoice.invoice_number}'
    body = f"""
<p style="margin:0 0 16px;font-size:16px;font-weight:700;color:#1e293b;">Thanks — your payment has been confirmed</p>
<p style="margin:0 0 20px;font-size:13px;color:#334155;">
  {sender} has confirmed your payment of <strong>{amount}</strong> for Invoice {invoice.invoice_number}.
</p>
<p style="margin:0;font-size:13px;color:#64748b;">
  <a href="{invoice.portal_view_url}" style="color:#00c896;font-weight:600;text-decoration:none;">View invoice &rarr;</a>
</p>"""
    plain = f'{sender} has confirmed your payment of {amount} for Invoice {invoice.invoice_number}.\n\nView invoice: {invoice.portal_view_url}'
    return subject, _html_wrapper(body), plain


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


def _try_fetch(url):
    resp = requests.get(url, timeout=REQUEST_TIMEOUT_SECONDS)
    resp.raise_for_status()
    return resp.content


def fetch_invoice_pdf_bytes(invoice):
    """
    Fetches the already-frozen PDF from its stored Cloudinary pdf_url —
    never re-renders it on the happy path (the freeze point is
    _finalise_invoice; see that function's own docstring).

    Self-heal chain on failure, in order:
      1. Re-render ONCE (render_invoice_pdf) and try to upload those exact
         bytes (upload_pdf_bytes, overwriting the same public_id),
         persisting the resulting pdf_url/pdf_public_id/pdf_generated_at,
         then retry the fetch. The invoice's content can't have changed
         since freeze (is_editable forbids edits past draft), so a
         same-content re-upload doesn't violate the frozen-PDF principle
         — it's recovery, not re-rendering a changed document.
      2. If the retried fetch ALSO fails, fall back to the SAME bytes
         already rendered in step 1 — no second render. This step exists
         because of a confirmed, code-independent problem: this
         Cloudinary account has an ACL restriction on raw/PDF delivery
         (verified directly — every real GET against a raw-resource PDF
         URL returns 401 with `x-cld-error: deny or ACL failure`
         regardless of access_mode, signing, or URL type; see
         DECISIONS.md) that step 1's re-upload cannot fix, since it hits
         the exact same account-level policy. Without this fallback,
         /send/ would be permanently broken until that Cloudinary Console
         setting changes. This does NOT re-freeze anything — pdf_url
         still points at the (still-401) stored asset; only this one
         email's attachment bytes come from the fresh render.

    Reusing one render across both the re-upload attempt and the final
    fallback is a real, measured fix, not a hypothetical one: profiling
    this chain end to end against the real dev Cloudinary account showed
    WeasyPrint's render alone costs ~6s, and the original version called
    it twice on this path (once inside store_invoice_pdf, again for the
    live-render fallback) — since this account's restriction makes this
    the path EVERY real send currently takes, that was a real ~6s tax on
    every single /send/ call, not a rare-case cost. See DECISIONS.md.

    Returns None only if every path — including the final live render —
    fails, so callers can still treat a total failure as fatal for a real
    send (reminders never attach a PDF at all either way, matching v1).
    """
    if not invoice.pdf_url:
        return None

    try:
        return _try_fetch(invoice.pdf_url)
    except requests.RequestException as exc:
        logger.warning(
            '[INVOICES] Stored PDF fetch failed for invoice_id=%s url=%s (%s) — attempting self-heal re-upload.',
            invoice.pk, invoice.pdf_url, exc,
        )

    try:
        pdf_bytes = render_invoice_pdf(invoice)
    except Exception:
        logger.exception('[INVOICES] Self-heal render failed for invoice_id=%s — no PDF bytes available.', invoice.pk)
        return None

    try:
        pdf_result = upload_pdf_bytes(invoice, pdf_bytes)
        invoice.pdf_url = pdf_result['secure_url']
        invoice.pdf_public_id = pdf_result['public_id']
        invoice.pdf_generated_at = timezone.now()
        invoice.save(update_fields=['pdf_url', 'pdf_public_id', 'pdf_generated_at'])
    except Exception:
        logger.exception('[INVOICES] Self-heal re-upload failed for invoice_id=%s.', invoice.pk)
    else:
        try:
            content = _try_fetch(invoice.pdf_url)
            logger.info('[INVOICES] Self-heal re-upload+retry succeeded for invoice_id=%s.', invoice.pk)
            return content
        except requests.RequestException as exc:
            logger.warning(
                '[INVOICES] Self-heal retry fetch still failing for invoice_id=%s (%s) — falling back to the bytes already rendered above.',
                invoice.pk, exc,
            )

    logger.info('[INVOICES] Live-render fallback used for invoice_id=%s — stored pdf_url remains unreachable.', invoice.pk)
    return pdf_bytes


def send_invoice_related_email(invoice, subject, html_body, plain_body, *, pdf_bytes=None, request_id=None):
    """
    Thin invoice-specific wrapper over core.email.send_client_facing_email
    (the shared custom-SMTP-vs-Resend routing chain, promoted out of this
    module this pass — see this file's own top docstring). Builds the
    invoice-specific pieces the generic function doesn't know about: the
    PDF attachment (base64-encoded via pdf_bytes_to_attachment), the
    reply-to address (reply+<view_token>@..., get_reply_to_address), the
    freelancer's own cc, the client's display name (for the
    CustomSmtpFailed notification copy), and an 'invoice'/invoice.pk
    correlation pair for observability. Called by invoice_send (views.py,
    real send, pdf_bytes populated) and the reminder task (tasks.py,
    pdf_bytes=None; v1 never attaches a PDF to reminder emails either).

    User is always cc'd on the email to their client — real, ported
    precedent (v1-reference/apps/invoices/email_service.py's
    `_send_with_fallback`), not a new addition: the freelancer should
    have their own copy of what just went out in their name.

    Returns the same result dict send_client_facing_email does — never
    raises.
    """
    attachments = None
    if pdf_bytes:
        attachment_filename = f'{invoice.invoice_number or "invoice"}.pdf'
        attachments = [pdf_bytes_to_attachment(attachment_filename, pdf_bytes)]

    return send_client_facing_email(
        invoice.user, invoice.client_email, subject, html_body, plain_body,
        cc=[invoice.user.email], reply_to=get_reply_to_address(invoice), attachments=attachments,
        recipient_name=invoice.client_name, context_type='invoice', context_id=str(invoice.pk),
        request_id=request_id,
    )
