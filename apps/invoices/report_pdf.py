# apps/invoices/report_pdf.py
"""
The two money-report PDFs (Prompt 16): the Profit and Loss and the Statement of Income. They live in
apps.invoices, not apps.payments, because WeasyPrint, the font files and FONT_CONTEXT are here and
apps.payments may not import this app (DECISIONS.md, decision R5).

Shape follows pdf_generator.build_statement_context / render_client_statement_pdf: the `build_*_context`
functions are PURE (they read the report maths and the profile and return ready-to-print strings, so a test
can check every sentence without WeasyPrint) and the `render_*_pdf` functions turn a context into bytes.
The weasyprint import is inside the render functions on purpose; see pdf_generator's module docstring for
why a module-level import is forbidden.

Money is printed as `CODE 1,234.56`, built here from Decimal. Templates do no arithmetic. Identity data
(CNIC, NTN) is decrypted only here, only when the request opted in, and never leaves the context dict.
"""
import logging
import time
from calendar import monthrange
from decimal import Decimal

from django.template.loader import render_to_string
from django.utils import timezone

from apps.payments import report

from .pdf_generator import FONT_CONTEXT, FONTS_DIR

logger = logging.getLogger(__name__)

MONTH_NAMES = ('Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec')

PURPOSE_LINES = {
    'bank': 'Bank account or loan application',
    'visa': 'Visa application',
    'pseb': 'PSEB registration',
    'other': 'General reference',
}
DEFAULT_PURPOSE = 'other'
ADDRESSED_TO_MAX = 100

PNL_TEMPLATE = 'invoices/reports/pnl.html'
STATEMENT_TEMPLATE = 'invoices/reports/income_statement.html'


# ---------------------------------------------------------------------------
# Formatting (fixed English tables; never locale-dependent strftime)
# ---------------------------------------------------------------------------

def fmt_date(value):
    """08 Nov 2026."""
    return f'{value.day:02d} {MONTH_NAMES[value.month - 1]} {value.year}'


def fmt_month(key):
    """'2026-11' -> 'Nov 2026'."""
    year, month = key.split('-')
    return f'{MONTH_NAMES[int(month) - 1]} {year}'


def fmt_number(value):
    """A money string or Decimal as 1,234.56; zero and negative zero print 0.00, a negative prints -1,234.56."""
    number = Decimal(value)
    if number == 0:
        return '0.00'
    return format(number, ',.2f')


def fmt_amount(code, value):
    """CODE 1,234.56 (the ISO code, never a symbol)."""
    return f'{code} {fmt_number(value)}'


def plural(n, one, many):
    return f'{n} {one if n == 1 else many}'


def fmt_cnic(digits):
    """The stored digits-only CNIC as printed on paper: 12345-1234567-1."""
    return f'{digits[:5]}-{digits[5:12]}-{digits[12:]}' if len(digits) == 13 else digits


def fmt_ntn(digits):
    """The stored digits-only NTN as printed on paper: 1234567 or 1234567-8."""
    return f'{digits[:7]}-{digits[7:]}' if len(digits) == 8 else digits


def _is_month_edge(start, end):
    """True when the period starts mid-month or ends before the last day of its month."""
    return start.day != 1 or end.day != monthrange(end.year, end.month)[1]


# ---------------------------------------------------------------------------
# Identity (explicit allowlist: the profile also holds bank details and OAuth tokens)
# ---------------------------------------------------------------------------

def _full_name(user, profile):
    return f'{user.first_name} {user.last_name}'.strip() or profile.display_name


def _address_lines(profile):
    lines = [profile.address_line1, profile.address_line2]
    place = ', '.join(part for part in (profile.city, profile.country) if part)
    return [line.strip() for line in lines + [place] if line and line.strip()]


def _logo_url(profile):
    """Only an https URL ever reaches the template; anything else is dropped."""
    logo = (profile.logo or '').strip()
    return logo if logo.startswith('https://') else ''


# ---------------------------------------------------------------------------
# Profit and Loss
# ---------------------------------------------------------------------------

def build_pnl_context(user, start, end, currency=None):
    """Everything pnl.html prints, as strings. Pure: no WeasyPrint."""
    data = report.pnl(user, start, end, currency)
    code = data['currency']
    profile = user.profile
    today = timezone.now().date()

    income, expenses, net = data['income'], data['expenses'], data['net']
    is_loss = Decimal(net['total']) < 0
    margin = net['margin_pct']

    unconverted = data['unconverted_count']
    estimated = data['estimated_count']
    unconverted_total = unconverted['income'] + unconverted['expenses']
    estimated_total = estimated['income'] + estimated['expenses']
    fees_total = next((Decimal(row['total']) for row in expenses['by_category'] if row['category'] == 'fees'), Decimal('0'))

    notes = [
        'This report counts money you recorded as received and money you recorded as spent, on the date of each. '
        'Invoices that have not been paid are not income. Amounts in other currencies are converted at the '
        'exchange rate saved for the date of each payment or expense.'
    ]
    if unconverted_total:
        notes.append(
            f"{plural(unconverted['income'], 'payment', 'payments')} and {plural(unconverted['expenses'], 'expense', 'expenses')} "
            f"could not be converted because no exchange rate was saved for {'it' if unconverted_total == 1 else 'them'}. "
            f"{'It is' if unconverted_total == 1 else 'They are'} left out of every figure in this report, so the net result is incomplete."
        )
    if estimated_total:
        notes.append(
            f"{plural(estimated_total, 'item uses', 'items use')} an estimated exchange rate (the closest day available), "
            'so the converted figures are approximate.'
        )
    if fees_total > 0:
        notes.append(
            'Platform and payment fees are counted as expenses here. If the income you recorded was already reduced '
            'by those fees, they are counted twice and your net profit is understated.'
        )
    notes.append("'Marked deductible' is your own note. LanceraOS adds these up but does not calculate tax.")

    return {
        'document_title': 'Profit and Loss',
        'trading_name': profile.business_name or profile.display_name,
        'address_lines': _address_lines(profile),
        'period_line': f'{fmt_date(start)} to {fmt_date(end)} - Amounts in {code}',
        'income_total': fmt_amount(code, income['total']),
        'expenses_total': fmt_amount(code, expenses['total']),
        'net_label': 'Net loss' if is_loss else 'Net profit',
        'net_total': fmt_amount(code, net['total']),
        'is_loss': is_loss,
        'margin_text': None if margin is None else f'Net margin {margin}% of income',
        'income_rows': [
            {'label': row['label'], 'count': row['count'], 'amount': fmt_amount(code, row['total'])}
            for row in income['by_source']
        ],
        'income_count': income['count'],
        'expense_rows': [
            {'label': row['label'], 'count': row['count'], 'amount': fmt_amount(code, row['total'])}
            for row in expenses['by_category']
        ],
        'expense_count': expenses['count'],
        'deductible_total': fmt_amount(code, expenses['deductible_total']),
        'not_deductible_total': fmt_amount(code, expenses['not_deductible_total']),
        'monthly_rows': [
            {
                'month': fmt_month(row['month']),
                'income': fmt_amount(code, row['income']),
                'expenses': fmt_amount(code, row['expenses']),
                'net': fmt_amount(code, row['net']),
            }
            for row in data['monthly']
        ],
        'notes': notes,
        'generated_on': fmt_date(today),
        **FONT_CONTEXT,
    }


def render_pnl_pdf(context):
    """The P&L context -> PDF bytes."""
    return _render(PNL_TEMPLATE, context)


# ---------------------------------------------------------------------------
# Statement of Income
# ---------------------------------------------------------------------------

def build_income_statement_context(user, start, end, options):
    """
    Everything income_statement.html prints, as strings. Pure: no WeasyPrint.
    `options`: purpose (key of PURPOSE_LINES), addressed_to (plain text, may be empty), include_cnic,
    include_ntn (bools; the caller has already checked the number is saved). The CNIC / NTN are read here
    and only here, and only when asked for.
    """
    data = report.income_statement(user, start, end)
    profile = user.profile
    today = timezone.now().date()
    usd, pkr = report.STATEMENT_CURRENCIES

    name = _full_name(user, profile)
    business = (profile.business_name or '').strip()
    intro_name = f'{name} (trading as {business})' if business else name

    # Each value is a list of lines (an address has several), so the template never guesses a type.
    identity = [('Full name', [name])]
    if business:
        identity.append(('Business name', [business]))
    address = _address_lines(profile)
    if address:
        identity.append(('Address', address))
    identity.append(('Email', [user.email]))
    if (profile.phone or '').strip():
        identity.append(('Phone', [profile.phone.strip()]))
    if options.get('include_cnic'):
        identity.append(('CNIC', [fmt_cnic(profile.cnic)]))
    if options.get('include_ntn'):
        identity.append(('NTN', [fmt_ntn(profile.ntn)]))

    unconverted = data['unconverted_count']
    estimated = data['estimated_count']
    notes = [
        'PKR amounts are an indicative equivalent. Each payment is converted at the daily reference exchange rate '
        'saved by LanceraOS for the date of that payment. They may differ from the amounts actually credited to a bank account.'
    ]
    if unconverted:
        notes.append(
            f"{plural(unconverted, 'payment', 'payments')} could not be converted because no exchange rate was saved for "
            f"{'it' if unconverted == 1 else 'them'}. {'It is' if unconverted == 1 else 'They are'} shown under "
            "'Received in these currencies' but "
            f"{'is' if unconverted == 1 else 'are'} not included in the totals above."
        )
    if estimated:
        notes.append(
            f"{plural(estimated, 'payment uses', 'payments use')} an estimated exchange rate (the closest day available), "
            'so the converted figures are approximate.'
        )
    if _is_month_edge(start, end):
        notes.append('A month at the start or end of the period may be partial if the period does not begin or end on a month boundary.')
    notes.append(
        'These figures come from records entered or imported by the account holder. LanceraOS has not checked them '
        'against any bank, platform or tax record. This is not a certificate, audit or attestation issued by LanceraOS, '
        'a bank, the FBR, PSEB or any other authority.'
    )

    addressed_to = (options.get('addressed_to') or '').strip()
    purpose = options.get('purpose') or DEFAULT_PURPOSE
    return {
        'document_title': 'Statement of Income',
        'logo_url': _logo_url(profile),
        'trading_name': business or name,
        'period_line': f'Period: {fmt_date(start)} to {fmt_date(end)}',
        'purpose_line': f'Purpose: {PURPOSE_LINES[purpose]}',
        'to_line': f'To: {addressed_to}' if addressed_to else 'To whom it may concern',
        'identity': identity,
        'intro': (
            f'This statement summarises the payments received by {intro_name} between {fmt_date(start)} and '
            f'{fmt_date(end)}, as recorded by the account holder in LanceraOS.'
        ),
        'total_usd': fmt_amount(usd, data['total']['usd']),
        'total_pkr': fmt_amount(pkr, data['total']['pkr']),
        'payment_count': data['count'],
        'payment_count_text': plural(data['count'], 'payment', 'payments'),
        'monthly_rows': [
            {'month': fmt_month(row['month']), 'count': row['count'],
             'usd': fmt_amount(usd, row['usd']), 'pkr': fmt_amount(pkr, row['pkr'])}
            for row in data['monthly']
        ],
        'source_rows': [
            {'label': row['label'], 'count': row['count'],
             'usd': fmt_amount(usd, row['usd']), 'pkr': fmt_amount(pkr, row['pkr'])}
            for row in data['by_source']
        ],
        'currency_rows': [
            {'currency': row['currency'], 'count': row['count'], 'amount': fmt_amount(row['currency'], row['amount'])}
            for row in data['by_currency']
        ],
        'notes': notes,
        'declaration': (
            f'I, {name}, declare that this statement summarises the payments I recorded as received in the period above '
            'and that, to the best of my knowledge, these records are accurate.'
        ),
        'generated_on': fmt_date(today),
        # Not printed: lets the view refuse an empty statement without a second query.
        'has_payments': data['count'] > 0,
        **FONT_CONTEXT,
    }


def render_income_statement_pdf(context):
    """The statement context -> PDF bytes."""
    return _render(STATEMENT_TEMPLATE, context)


# ---------------------------------------------------------------------------
# Rendering and logging
# ---------------------------------------------------------------------------

def _render(template_name, context):
    """
    Template -> PDF. Resources are fetched by a restricted fetcher: local files (the fonts) and https only,
    five seconds, no redirects. A logo that cannot be fetched is skipped by WeasyPrint and never fails the
    render. The import is deferred; see this module's docstring.
    """
    from weasyprint import HTML, URLFetcher

    fetcher = URLFetcher(timeout=5, allowed_protocols=('file', 'https'), allow_redirects=False)
    html = render_to_string(template_name, context)
    return HTML(string=html, base_url=FONTS_DIR.as_uri() + '/', url_fetcher=fetcher).write_pdf()


def log_pdf_attempt(document_type, request, started, success):
    """The one structured line CLAUDE.md asks of every PDF: document type, request id, duration, outcome."""
    logger.info(
        '[PDF] document_type=%s request_id=%s duration_ms=%d success=%s',
        document_type, getattr(request, 'request_id', None), int((time.perf_counter() - started) * 1000), success,
    )


def attachment_filename(prefix, start, end):
    """ASCII only: profit_and_loss_2026-01-01_2026-11-08.pdf."""
    return f'{prefix}_{start.isoformat()}_{end.isoformat()}.pdf'
