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
from pathlib import Path

import qrcode
from django.template.loader import render_to_string
from weasyprint import HTML

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


def store_invoice_pdf(invoice):
    """
    Renders once and uploads the result to Cloudinary, returning the
    secure_url — the frozen artifact for a sent-or-beyond invoice.
    `resource_type='raw'` (not 'image') since this is a PDF document, not
    an image Cloudinary should try to transform/thumbnail.
    """
    import cloudinary.uploader  # lazy import — same convention as apps/users/views/profile.py's upload_logo

    pdf_bytes = render_invoice_pdf(invoice)
    try:
        result = cloudinary.uploader.upload(
            io.BytesIO(pdf_bytes), folder='lanceraos/invoices', resource_type='raw',
            public_id=f'invoice_{invoice.pk}', overwrite=True, format='pdf',
        )
    except Exception:
        logger.exception('Cloudinary invoice-PDF upload failed for invoice_id=%s', invoice.pk)
        raise
    return result.get('secure_url', '')
