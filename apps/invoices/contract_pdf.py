# apps/invoices/contract_pdf.py
"""
The Contract PDF (Prompt 22, decision K11). It lives in apps.invoices for the same reason as the report PDFs
(report_pdf.py, decision R5): WeasyPrint, the font files and the PDF helpers are here, and apps.contracts may not be
imported by the rest of this app except by the two contract PDF modules.

`build_contract_context` is PURE (no WeasyPrint): it returns ready-to-print strings from the stored contract. The text
is printed from the stored sections, so a signed contract prints exactly the words that were frozen at send. The PDF
prints names, times (Pakistan time), the fingerprint and the Key terms. It does NOT print IP addresses or browser
strings, and it says nothing about legal validity. The weasyprint import stays inside the render function.
"""
import re

from django.utils import timezone

from apps.contracts import copy as words
from apps.contracts.integrity import parties_snapshot

from . import report_pdf
from .pdf_generator import FONT_CONTEXT

CONTRACT_TEMPLATE = 'invoices/contracts/contract.html'
_PARAGRAPH_SPLIT = re.compile(r'\n\s*\n')


def attachment_filename(contract):
    """ASCII only: CON-2026-0001.pdf, or contract_draft.pdf for a contract with no number yet."""
    return f'{contract.contract_number}.pdf' if contract.contract_number else 'contract_draft.pdf'


def _when(value):
    """10 Nov 2026, 14:32 (naive Pakistan time; the caller adds the PKT label)."""
    return f'{report_pdf.fmt_date(value.date())}, {value:%H:%M}'


def paragraphs(text):
    """A section's text as paragraphs (split on blank lines), each a list of lines. Nothing here is HTML."""
    result = []
    for block in _PARAGRAPH_SPLIT.split(text or ''):
        lines = [line.strip() for line in block.split('\n') if line.strip()]
        if lines:
            result.append(lines)
    return result


def _status_line(contract):
    if contract.status == 'draft':
        return words.PDF_STATUS_DRAFT
    if contract.status == 'signed':
        return words.PDF_STATUS_SIGNED.format(when=_when(contract.responded_at))
    if contract.status == 'declined':
        return words.PDF_STATUS_DECLINED.format(when=report_pdf.fmt_date(contract.responded_at.date()))
    if contract.status == 'withdrawn':
        return words.PDF_STATUS_WITHDRAWN
    return words.PDF_STATUS_AWAITING


def _signature_blocks(contract):
    owner = None
    if contract.owner_signed_name:
        owner = {
            'name': contract.owner_signed_name,
            'line': words.PDF_SIGNED_LINE.format(when=_when(contract.owner_signed_at)),
        }
    if contract.status == 'signed':
        client = {
            'name': contract.signed_name,
            'line': words.PDF_SIGNED_LINE.format(when=_when(contract.responded_at)),
        }
    elif contract.status == 'declined':
        client = {'name': '', 'line': words.PDF_STATUS_DECLINED.format(when=report_pdf.fmt_date(contract.responded_at.date()))}
    else:
        client = {'name': '', 'line': words.PDF_NOT_SIGNED_YET}
    if owner is None:
        owner = {'name': '', 'line': words.PDF_NOT_SIGNED_YET}
    return owner, client


def build_contract_context(contract):
    """Everything contract.html prints, as strings. Pure: no WeasyPrint."""
    profile = contract.user.profile
    parties = contract.parties if contract.status != 'draft' and contract.parties else parties_snapshot(contract)
    freelancer = parties.get('freelancer') or {}
    client = parties.get('client') or {}
    code = contract.currency

    place = ', '.join(part for part in (freelancer.get('city'), freelancer.get('country')) if part)
    trading_name = freelancer.get('business_name') or freelancer.get('name') or ''

    freelancer_lines = [line for line in (freelancer.get('name'), freelancer.get('business_name'), place) if line]
    client_lines = [line for line in (client.get('name'), client.get('company')) if line]

    key_terms = []
    if contract.fee_amount and contract.fee_amount > 0:
        key_terms.append(('Fee', [report_pdf.fmt_amount(code, contract.fee_amount)]))
    payment_lines = [line for para in paragraphs(contract.payment_terms) for line in para]
    if payment_lines:
        key_terms.append(('Payment terms', payment_lines))
    if contract.start_date:
        key_terms.append(('Start date', [report_pdf.fmt_date(contract.start_date)]))
    if contract.end_date:
        key_terms.append(('End date', [report_pdf.fmt_date(contract.end_date)]))
    if contract.valid_until:
        key_terms.append(('Sign by', [report_pdf.fmt_date(contract.valid_until)]))

    owner_signature, client_signature = _signature_blocks(contract)
    return {
        'document_title': contract.title,
        'title': contract.title,
        'logo_url': report_pdf._logo_url(profile),
        'trading_name': trading_name,
        'address_lines': [place] if place else [],
        'number_line': f'Contract {contract.contract_number}' if contract.contract_number else 'Contract (draft)',
        'footer_label': contract.contract_number or 'Draft',
        'status_line': _status_line(contract),
        'freelancer_lines': freelancer_lines,
        'client_lines': client_lines,
        'key_terms': key_terms,
        'sections': [
            {'number': index, 'title': section.get('title', ''), 'paragraphs': paragraphs(section.get('text', ''))}
            for index, section in enumerate(contract.sections or [], start=1)
        ],
        'owner_signature': owner_signature,
        'client_signature': client_signature,
        'has_record': bool(contract.content_hash),
        'fingerprint_label': words.PDF_FINGERPRINT_LABEL,
        'fingerprint': contract.content_hash,
        'fingerprint_note': words.PDF_FINGERPRINT_NOTE,
        'signing_note': words.PDF_SIGNING_NOTE,
        'generated_on': report_pdf.fmt_date(timezone.now().date()),
        **FONT_CONTEXT,
    }


def render_contract_pdf(context):
    """The contract context -> PDF bytes."""
    return report_pdf._render(CONTRACT_TEMPLATE, context)
