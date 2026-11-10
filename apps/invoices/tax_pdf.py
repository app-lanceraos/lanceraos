# apps/invoices/tax_pdf.py
"""
The Tax Summary (estimate) PDF (Prompt 20). It lives in apps.invoices for the same reason as the two money-report
PDFs (report_pdf.py, decision R5): WeasyPrint, the fonts and the PDF helpers are here, and apps.tax may not import
this app. Every figure comes from apps.tax.service.build_overview, so the page and the document cannot disagree.

`build_tax_summary_context` is PURE (no WeasyPrint): it returns ready-to-print strings. The NTN is decrypted here,
only when the request opted in, and never leaves the context dict. No CNIC is ever read. The weasyprint import
stays inside the render function (see pdf_generator's module docstring).
"""
from datetime import date

from apps.tax import law, service

from . import report_pdf
from .pdf_generator import FONT_CONTEXT

TAX_SUMMARY_TEMPLATE = 'invoices/reports/tax_summary.html'
DOCUMENT_TITLE = 'Tax Summary (estimate)'


def attachment_filename(tax_year):
    """ASCII only: tax_summary_2027.pdf."""
    return f'tax_summary_{tax_year}.pdf'


def closing_paragraph():
    return (
        f"Tax rules last checked on {report_pdf.fmt_date(law.LAST_VERIFIED)} against FBR's Withholding Tax Rates Card 2027 "
        'and FBR Circular No. 02 of 2026-27. This summary is an estimate prepared by LanceraOS from records entered or '
        'imported by the account holder. It is not a tax return, a tax certificate, an audit or tax advice. Your '
        "bank's records and FBR's own system show the tax actually paid."
    )


def build_tax_summary_context(user, tax_year, include_ntn, stale_law=False):
    """Everything tax_summary.html prints, as strings. `has_payments` is not printed: it lets the view refuse an empty year."""
    now = service.today()
    data = service.build_overview(user, tax_year, stale_law, now)
    profile = user.profile
    code = data['currency']
    fmt = report_pdf

    name = report_pdf._full_name(user, profile)
    business = (profile.business_name or '').strip()
    identity = [('Full name', [name])]
    if business:
        identity.append(('Business name', [business]))
    address = report_pdf._address_lines(profile)
    if address:
        identity.append(('Address', address))
    identity.append(('Email', [user.email]))
    if (profile.phone or '').strip():
        identity.append(('Phone', [profile.phone.strip()]))
    if include_ntn:
        identity.append(('NTN', [fmt.fmt_ntn(profile.ntn)]))

    rate = data['rate']
    saved = rate['basis'] == 'pseb_number_saved'
    rate_line = f"Rate used: {rate['percent']}% (" + (
        'PSEB registration number saved)' if saved else 'no PSEB registration number saved)'
    )

    start = date.fromisoformat(data['start'])
    end = date.fromisoformat(data['end'])
    counted_to = date.fromisoformat(data['counted_to'])
    next_steps = [data['return']['sentence']] + [item['text'] for item in data['checklist'] if item['status'] != 'done']

    return {
        'document_title': DOCUMENT_TITLE,
        'trading_name': business or name,
        'address_lines': address,
        'tax_year_line': f"Tax year {data['tax_year']}: {fmt.fmt_date(start)} to {fmt.fmt_date(end)}",
        'counted_line': f'Counted up to {fmt.fmt_date(counted_to)}' if data['status'] == 'in_progress' else '',
        'identity': identity,
        'export_total': fmt.fmt_amount(code, data['export']['total']),
        'expected_deduction': fmt.fmt_amount(code, data['export']['expected_deduction']),
        'local_total': fmt.fmt_amount(code, data['local']['total']),
        'rate_line': rate_line,
        'monthly_rows': [
            {
                'month': fmt.fmt_month(row['month']),
                'export': fmt.fmt_amount(code, row['export_receipts']),
                'tax': fmt.fmt_amount(code, row['expected_deduction']),
                'local': fmt.fmt_amount(code, row['local_receipts']),
            }
            for row in data['monthly']
        ],
        'currency_rows': [
            {'currency': row['currency'], 'count': row['count'], 'amount': fmt.fmt_amount(row['currency'], row['amount'])}
            for row in data['export']['by_currency']
        ],
        'next_steps': next_steps,
        'notes': data['notes'],
        'closing': closing_paragraph(),
        'generated_on': fmt.fmt_date(now),
        'has_payments': data['_payment_count'] > 0,
        **FONT_CONTEXT,
    }


def render_tax_summary_pdf(context):
    """The tax summary context -> PDF bytes."""
    return report_pdf._render(TAX_SUMMARY_TEMPLATE, context)
