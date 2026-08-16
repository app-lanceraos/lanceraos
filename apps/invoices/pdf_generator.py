# apps/invoices/pdf_generator.py
"""
Step 7b — the actual PDF render pipeline for Invoice. Step 7a built the
three templates and wired real Django template variables into them
(including the font-face/QR/signature variable *names* the templates
already expect); this module is what actually supplies those values and
turns the result into a real PDF via WeasyPrint.

Two entry points, deliberately separate responsibilities:
- render_invoice_pdf(invoice) -> bytes: a pure live render. Used for
  draft/created invoices (nothing frozen yet, per the spec's Stored PDF
  note) and as the first half of the store path below.
- store_invoice_pdf(invoice) -> str (the Cloudinary secure_url): renders
  once and uploads it. Does NOT touch invoice.pdf_url/pdf_generated_at
  itself — callers (invoice_mark_sent, the real /send/ later) decide
  when to persist those fields, since "render+upload" and "this invoice
  now has a frozen PDF" are different responsibilities, and a caller
  might reasonably want to retry the DB save without re-uploading.
"""
import base64
import io
import logging
from decimal import Decimal
from pathlib import Path

import qrcode
from django.template.loader import render_to_string
from django.templatetags.static import static
from django.utils import timezone
from weasyprint import HTML

from core.money import Money

logger = logging.getLogger(__name__)

FONTS_DIR = Path(__file__).resolve().parent / 'static' / 'invoices' / 'fonts'


def _font_uri(filename):
    """
    A real file:// URI WeasyPrint's own URL fetcher resolves directly —
    Django's {% static %} tag only resolves in a browser context (per
    the handoff notes), never inside WeasyPrint's HTML->PDF render.
    """
    return (FONTS_DIR / filename).as_uri()


# Only the weights each template's own @font-face declarations actually
# reference (verified directly against all three files, not bulk-sourced) —
# see DECISIONS.md for the full font-sourcing note, including Caveat,
# which is downloaded (apps/invoices/static/invoices/fonts/) but not
# referenced by any template's @font-face yet.
FONT_CONTEXT = {
    'font_ibm_plex_sans_regular': _font_uri('IBMPlexSans-Regular.ttf'),
    'font_ibm_plex_sans_semibold': _font_uri('IBMPlexSans-SemiBold.ttf'),
    'font_ibm_plex_mono_regular': _font_uri('IBMPlexMono-Regular.ttf'),
    'font_ibm_plex_mono_semibold': _font_uri('IBMPlexMono-SemiBold.ttf'),
    'font_source_serif_regular': _font_uri('SourceSerif4-Regular.ttf'),
    'font_source_serif_semibold': _font_uri('SourceSerif4-Semibold.ttf'),
    'font_space_grotesk': _font_uri('SpaceGrotesk[wght].ttf'),
}

# Same font files, same template variable names — only the URL SCHEME
# differs from FONT_CONTEXT above. file:// URIs are correct for
# WeasyPrint's own URL fetcher but meaningless (and blocked by real
# browsers) outside of it; static() resolves through Django's normal
# staticfiles machinery (apps/invoices/static/invoices/fonts/, confirmed
# reachable via the app-directories finder — no separate STATICFILES_DIRS
# entry needed) to a real browser-fetchable /static/... URL. Used by
# build_portal_context, never build_pdf_context — WeasyPrint never sees
# these.
PORTAL_FONT_CONTEXT = {
    'font_ibm_plex_sans_regular': static('invoices/fonts/IBMPlexSans-Regular.ttf'),
    'font_ibm_plex_sans_semibold': static('invoices/fonts/IBMPlexSans-SemiBold.ttf'),
    'font_ibm_plex_mono_regular': static('invoices/fonts/IBMPlexMono-Regular.ttf'),
    'font_ibm_plex_mono_semibold': static('invoices/fonts/IBMPlexMono-SemiBold.ttf'),
    'font_source_serif_regular': static('invoices/fonts/SourceSerif4-Regular.ttf'),
    'font_source_serif_semibold': static('invoices/fonts/SourceSerif4-Semibold.ttf'),
    'font_space_grotesk': static('invoices/fonts/SpaceGrotesk[wght].ttf'),
}

# Item 10 of the verification pass — appended to the rendered portal HTML's
# own <head> by render_invoice_portal_html, below. Overrides ONLY html/body
# (every template already has both; neither needs internal changes for
# this): `html` gets the muted "desk" background a real PDF viewer sits
# on; `body` — already each template's own themed "paper" background,
# untouched here — gets centered with a real margin and a subtle
# shadow/radius instead of sitting flush against the browser's own edges.
# Deliberately a later, separate <style> block rather than editing each
# template's own body{} rule (three files, three different background
# colors) — CSS cascade order alone makes this override win.
PORTAL_WRAPPER_STYLE = '''
<style>
  html { background: #e4e1d8; min-height: 100%; }
  body {
    max-width: 210mm;
    margin: 32px auto !important;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.18);
    border-radius: 3px;
  }
  @media (max-width: 720px) {
    body { margin: 0 auto !important; box-shadow: none; border-radius: 0; }
  }
</style>
'''

# Interim default template, per this step's explicit instruction: checked
# directly — FreelancerProfile has no default-template-ish field of its
# own (verified against apps/users/models.py) — and Invoice.design
# (InvoiceDesign FK) is null for every real invoice today, since nothing
# creates InvoiceDesign rows yet (Step 8 builds the design system, Step 9
# the editor). SUPERSEDED the moment Step 8 wires real design selection —
# not a permanent decision being made here.
DEFAULT_TEMPLATE = 'professional'

TEMPLATE_MAP = {
    'professional': 'invoices/professional.html',
    'minimal': 'invoices/minimal.html',
    'modern': 'invoices/modern.html',
}


def _select_template_name(invoice):
    if invoice.design_id and invoice.design.base_template in TEMPLATE_MAP:
        return TEMPLATE_MAP[invoice.design.base_template]
    return TEMPLATE_MAP[DEFAULT_TEMPLATE]


def _generate_qr_data_uri(url):
    """
    Ports v1's generate_qr_image (v1-reference/apps/invoices/pdf_generator.py)
    directly — same qrcode[pil] library, same QRCode parameters. Returns a
    base64 data URI instead of v1's ReportLab ImageReader, since these
    WeasyPrint templates embed the QR as a plain <img src="...">: a data
    URI needs no filesystem path or network fetch at render time at all,
    avoiding the exact class of "WeasyPrint can't resolve this URL"
    problem the fonts above have to work around with file:// URIs.
    """
    try:
        qr = qrcode.QRCode(
            version=None,
            error_correction=qrcode.constants.ERROR_CORRECT_M,
            box_size=10,
            border=2,
        )
        qr.add_data(url)
        qr.make(fit=True)
        img = qr.make_image(fill_color='black', back_color='white')
        buf = io.BytesIO()
        img.save(buf, format='PNG')
        encoded = base64.b64encode(buf.getvalue()).decode('ascii')
        return f'data:image/png;base64,{encoded}'
    except Exception:
        logger.exception('QR generation failed for invoice PDF render.')
        return None


def build_pdf_context(invoice):
    """
    Everything the three templates need. `invoice`/`freelancer` give the
    templates direct access to every frozen snapshot field, real
    InvoiceItem queryset (invoice.items.all()), and the
    currency_symbol/payment_page_url/client_currency_conversion
    properties (Step 7a/7b, apps/invoices/models.py) — no separate
    pre-formatting happens here beyond what genuinely can't be a template
    variable (the QR image itself; the font file locations).
    """
    freelancer = invoice.user.profile
    return {
        'invoice': invoice,
        'freelancer': freelancer,
        'qr_code_data_uri': _generate_qr_data_uri(invoice.payment_page_url),
        'signature_url': freelancer.signature_url or None,
        **FONT_CONTEXT,
    }


def render_invoice_pdf(invoice):
    """Live-renders `invoice` to PDF bytes. No storage side effect — see this module's own docstring for why draft/created invoices always call this fresh."""
    template_name = _select_template_name(invoice)
    html_string = render_to_string(template_name, build_pdf_context(invoice))
    return HTML(string=html_string).write_pdf()


def build_portal_context(invoice):
    """
    Same context as build_pdf_context — same invoice/freelancer objects,
    same QR data URI, same signature_url — with PORTAL_FONT_CONTEXT
    swapped in for FONT_CONTEXT. This is the ENTIRE difference between
    the PDF and the live-HTML render paths: everything else (which
    template, which fields, how totals/dates format) comes from the same
    single source, per the one-HTML/CSS-renderer principle this project
    builds all three invoice outputs (editor preview, portal page, PDF)
    against. @page CSS rules in the templates are meaningless in a
    browser but deliberately left in — stripping them here would mean
    the markup two render paths serve is no longer byte-for-byte the
    same template, the exact drift this design exists to prevent.
    """
    context = build_pdf_context(invoice)
    context.update(PORTAL_FONT_CONTEXT)
    return context


def render_invoice_portal_html(invoice):
    """
    Live-renders `invoice` as real browser-facing HTML — the same
    template _select_template_name picks for the PDF, via
    build_portal_context instead of build_pdf_context. Used by both the
    real portal-view endpoint (apps/invoices/views_portal.py) and
    Preview-as-Client (same module) — one shared renderer for both, per
    the one-HTML/CSS-renderer principle: neither is a second,
    hand-built reimplementation of the invoice layout.

    A small CSS override is appended before the shared template's own
    </head> (item 10 of the verification pass — real, found bug: the
    rendered page sat flush against the browser's own edges with no
    centering or margin, unlike a real PDF viewer's "paper on a
    background" feel). Deliberately styles ONLY `html`/`body` — elements
    every one of the 3 templates already has, none of which any
    template's own internal markup needs to change for — never the
    shared template's actual content structure, and irrelevant to
    render_invoice_pdf's own WeasyPrint path (@page-based pagination
    there ignores html/body box styling like this entirely, so this
    can't affect the PDF/frozen-artifact output at all).
    """
    template_name = _select_template_name(invoice)
    html = render_to_string(template_name, build_portal_context(invoice))
    return html.replace('</head>', PORTAL_WRAPPER_STYLE + '</head>', 1)


def upload_pdf_bytes(invoice, pdf_bytes):
    """
    The upload half of store_invoice_pdf, split out (this pass) so a
    caller that already has real rendered bytes in hand — specifically
    email_service.py's self-heal chain — never pays WeasyPrint's render
    cost twice for the same content. Returns
    {'secure_url': str, 'public_id': str}.

    `resource_type='raw'` (not 'image') since this is a PDF document, not
    an image Cloudinary should try to transform/thumbnail.

    `access_mode='public'` is passed explicitly — this is the
    documented, correct way to request public delivery for a raw
    upload. Confirmed directly against the real Cloudinary account this
    project uses (a real test upload, checked via the Admin API, not
    assumed) that this account currently has an account-level ACL
    restriction on raw/PDF delivery that silently ignores this parameter
    regardless of upload-time value (every real GET against the
    resulting secure_url returns 401 with `x-cld-error: deny or ACL
    failure`, Cloudinary's own header confirming an account-side policy,
    not a code-level bug) — see DECISIONS.md for the full investigation
    and why this parameter is still the correct thing to send: it costs
    nothing, is the textbook-correct call per Cloudinary's own API docs,
    and takes effect immediately the moment that account setting
    changes, without needing a second code change.
    """
    import cloudinary.uploader  # lazy import — same convention as apps/users/views/profile.py's upload_logo

    try:
        result = cloudinary.uploader.upload(
            io.BytesIO(pdf_bytes), folder='lanceraos/invoices', resource_type='raw',
            public_id=f'invoice_{invoice.pk}', overwrite=True, format='pdf',
            access_mode='public',
        )
    except Exception:
        logger.exception('Cloudinary invoice-PDF upload failed for invoice_id=%s', invoice.pk)
        raise
    return {'secure_url': result.get('secure_url', ''), 'public_id': result.get('public_id', '')}


def store_invoice_pdf(invoice):
    """Renders once and uploads the result — see upload_pdf_bytes for the upload half's own documentation."""
    return upload_pdf_bytes(invoice, render_invoice_pdf(invoice))


# ══════════════════════════════════════════════════════════════════
# CLIENT STATEMENT — Step 19. Same WeasyPrint pipeline, same
# FONT_CONTEXT/font-sourcing convention as the invoice templates above
# — no separate font logic for this document type.
# ══════════════════════════════════════════════════════════════════
# Kept local to this module rather than importing apps.invoices.models.
# CURRENCY_SYMBOLS to avoid a needless models import here (pdf_generator.py
# otherwise only imports Invoice lazily, inside build_statement_context,
# matching this file's existing convention elsewhere) — same 4
# currencies this app already supports, same symbols.
CURRENCY_SYMBOLS_STATEMENT = {'USD': '$', 'EUR': '€', 'GBP': '£', 'PKR': 'Rs '}


def _invoice_amounts_in_client_currency(invoice, target_currency):
    """
    Converts total/amount_paid/outstanding_amount into target_currency —
    generalizes Invoice.client_currency_conversion (which only converts
    `total`) to every figure a statement needs, via the SAME underlying
    mechanism (core.money.Money, anchored on the invoice's own FROZEN
    rate_to_usd_at_issue + exchange_rate_snapshot — never today's rate),
    not a second, independent conversion implementation. Returns None
    for every figure when no real conversion is possible (same
    currency needs no conversion and is handled separately by the
    caller; no frozen rate/snapshot means nothing safe to convert) —
    never guessed, matching client_currency_conversion's own contract.
    """
    if invoice.rate_to_usd_at_issue is None or not invoice.exchange_rate_snapshot:
        return None
    if target_currency not in invoice.exchange_rate_snapshot.rates_to_usd:
        return None

    def convert(amount):
        money = Money(amount, invoice.currency, invoice.rate_to_usd_at_issue)
        return money.convert(target_currency, invoice.exchange_rate_snapshot).amount.quantize(Decimal('0.01'))

    return {'total': convert(invoice.total), 'amount_paid': convert(invoice.amount_paid), 'outstanding': convert(invoice.outstanding_amount)}


def build_statement_context(client, start_date, end_date):
    """
    Every non-draft invoice for `client` with issue_date inside
    [start_date, end_date] (inclusive), oldest first. Each row shows a
    running balance — the cumulative OUTSTANDING total across the listed
    invoices in chronological order (this invoice's own outstanding
    amount added to everything before it in the range), not a full
    interleaved invoice+payment ledger — see DECISIONS.md for why that
    narrower, simpler definition was chosen.

    Amounts are shown in the CLIENT's own default_currency — same
    currency needs no conversion at all; a different currency converts
    via _invoice_amounts_in_client_currency above. A row with no real
    conversion available (invoice.currency differs from the client's own
    AND no frozen rate was ever captured) is still LISTED (never
    silently dropped) but contributes nothing to the running balance or
    totals, and increments `unconverted_count` — an honest, visible gap
    rather than a wrong number.
    """
    from .models import Invoice

    invoices = list(
        Invoice.objects.filter(client=client, issue_date__gte=start_date, issue_date__lte=end_date)
        .exclude(status='draft')
        .order_by('issue_date', 'created_at')
    )

    target_currency = client.default_currency
    running_balance = Decimal('0')
    total_invoiced = Decimal('0')
    total_paid = Decimal('0')
    unconverted_count = 0
    rows = []

    for invoice in invoices:
        if invoice.currency == target_currency:
            amounts = {'total': invoice.total, 'amount_paid': invoice.amount_paid, 'outstanding': invoice.outstanding_amount}
        else:
            amounts = _invoice_amounts_in_client_currency(invoice, target_currency)

        if amounts is None:
            unconverted_count += 1
            rows.append({'invoice': invoice, 'amounts': None, 'running_balance': None})
            continue

        running_balance += amounts['outstanding']
        total_invoiced += amounts['total']
        total_paid += amounts['amount_paid']
        rows.append({'invoice': invoice, 'amounts': amounts, 'running_balance': running_balance.quantize(Decimal('0.01'))})

    return {
        'client': client,
        'freelancer': client.user.profile,
        'start_date': start_date,
        'end_date': end_date,
        'target_currency': target_currency,
        'currency_symbol': CURRENCY_SYMBOLS_STATEMENT.get(target_currency, target_currency + ' '),
        'rows': rows,
        'total_invoiced': total_invoiced.quantize(Decimal('0.01')),
        'total_paid': total_paid.quantize(Decimal('0.01')),
        'total_outstanding': (total_invoiced - total_paid).quantize(Decimal('0.01')),
        'unconverted_count': unconverted_count,
        'generated_at': timezone.now(),
        **FONT_CONTEXT,
    }


def render_client_statement_pdf(client, start_date, end_date):
    """Live-rendered on every call — no frozen-artifact concept here, unlike a sent invoice's PDF. A statement reflects current data for whatever range is requested."""
    html_string = render_to_string('invoices/statement.html', build_statement_context(client, start_date, end_date))
    return HTML(string=html_string).write_pdf()
