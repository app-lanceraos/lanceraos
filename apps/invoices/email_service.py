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
    sender = sender_display_name(invoice.user, getattr(invoice.user, "profile", None))
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
