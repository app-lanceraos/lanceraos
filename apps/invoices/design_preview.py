# apps/invoices/design_preview.py
"""
20 August 2026 — SEV1 follow-up, item 1: the design gallery's own preview
cards (DesignGallery.jsx's BuiltinTemplateCard/SavedDesignCard) rendered
the exact same generic client-side approximation for every template and
never reacted to the selected color swatch at all. This module is the
real fix's backend half — a lightweight, non-WeasyPrint HTML render of
the ACTUAL template (one of the 3 static ones, or the real
design_renderer.py dynamic path for a saved custom design) with real
sample invoice data, the requesting user's own real logo/business
profile, and the real resolved color_variant — served to the frontend as
a plain GET the gallery embeds directly in a scaled-down iframe. This is
"the most honest approach" per this pass's own explicit framing: it is
provably the same render path (render_html_for_design, pdf_generator.py)
a real client will actually see, not a second, approximate
reimplementation — the only difference from a real invoice render is the
sample data source (this module's own fixed fixture, never a real
Invoice row) and that PORTAL_FONT_CONTEXT/HTML is used, never WeasyPrint
(no PDF is ever produced here — a preview is display-only, and skipping
WeasyPrint keeps this fast enough to feel "live" on every swatch click).

No database writes happen anywhere in this module — the sample
"invoice"/"items" are plain in-memory objects (SimpleNamespace), not
Invoice/InvoiceItem rows, so a gallery preview can never accumulate
throwaway rows or need cleanup.
"""
from datetime import date
from decimal import Decimal
from types import SimpleNamespace

from django.template.loader import render_to_string

from .design_renderer import render_editor_canvas_html as _render_editor_canvas_html
from .design_renderer import render_editor_element_html as _render_editor_element_html
from .design_seeds import resolve_design_colors
from .pdf_generator import DEFAULT_TEMPLATE, PORTAL_FONT_CONTEXT, TEMPLATE_MAP, _generate_qr_data_uri, render_html_for_design

CURRENCY_SYMBOLS = {'USD': '$', 'EUR': '€', 'GBP': '£', 'PKR': 'Rs. '}

SAMPLE_ITEMS = [
    {'description': 'Homepage redesign', 'quantity': Decimal('1'), 'unit_price': Decimal('1200.00')},
    {'description': 'Design system components', 'quantity': Decimal('1'), 'unit_price': Decimal('860.00')},
    {'description': 'Revisions round 1', 'quantity': Decimal('1'), 'unit_price': Decimal('240.00')},
]


class _ItemsManager:
    """Duck-types the one method the templates actually call — `invoice.items.all()` — without a real queryset or a saved Invoice row to hang one off."""

    def __init__(self, items):
        self._items = items

    def all(self):
        return self._items


def _build_sample_invoice(currency='USD'):
    items = [SimpleNamespace(total=i['quantity'] * i['unit_price'], **i) for i in SAMPLE_ITEMS]
    subtotal = sum((i.total for i in items), Decimal('0'))
    return SimpleNamespace(
        invoice_number='INV-2026-0042',
        issue_date=date(2026, 8, 9), due_date=date(2026, 8, 23),
        client_name='Callahan & Reyes LLP', client_company='', client_address='', client_email='accounts@callahanreyes.com',
        currency_symbol=CURRENCY_SYMBOLS.get(currency, currency + ' '),
        items=_ItemsManager(items),
        subtotal=subtotal, tax_rate=None, tax_amount=Decimal('0'), discount_amount=Decimal('0'), total=subtotal,
        client_currency_conversion=None,
        notes='Thanks for the business.', terms='Due within 14 days.',
        payment_page_url='https://lanceraos.com/invoice/preview',
        user=SimpleNamespace(email='you@example.com'),
    )


def build_preview_context(user, base_template, color_variant):
    """Real freelancer profile (their own actual logo/business name — the same 'when they have one' treatment DesignCanvasPreview.jsx already gave), sample invoice content, the real resolved color pair."""
    freelancer = user.profile
    invoice = _build_sample_invoice()
    primary_color, secondary_color = resolve_design_colors(base_template, color_variant)
    return {
        'invoice': invoice,
        'freelancer': freelancer,
        'qr_code_data_uri': _generate_qr_data_uri(invoice.payment_page_url),
        'signature_url': freelancer.signature_url or None,
        'design_primary_color': primary_color,
        'design_secondary_color': secondary_color,
        **PORTAL_FONT_CONTEXT,
    }


def render_builtin_template_preview_html(user, base_template, color_variant):
    """Path 1's own preview — one of the 3 real static templates, real sample data, the requested color. Never the dynamic renderer — a builtin pick's own design_data is (by construction, design_renderer.design_has_real_custom_data's own rule) never 'real custom data' until a user actually edits it."""
    template_name = TEMPLATE_MAP.get(base_template, TEMPLATE_MAP[DEFAULT_TEMPLATE])
    context = build_preview_context(user, base_template, color_variant)
    return render_to_string(template_name, context)


def render_design_preview_html(user, design):
    """A real, saved InvoiceDesign's own preview ('Your designs') — routes through the exact same render_html_for_design branch a real invoice with this design assigned would use, so a custom/edited design's card genuinely matches what a client will see, dynamic renderer included."""
    context = build_preview_context(user, design.base_template, design.color_variant)
    return render_html_for_design(design, context)


def render_editor_canvas_html(user, design_data, base_template, color_variant, sample_rows=3):
    """
    20 August 2026 — Step 8b canvas rework (see DECISIONS.md). The canvas
    editor's own initial-load render: real content, real fonts, real
    resolved color, ALWAYS via design_renderer's per-element, indexed
    layout (design_renderer.render_editor_canvas_html) — unlike the
    gallery preview functions above, this is never routed through the 3
    static templates, even for an untouched builtin pick, since only the
    per-element-positioned dynamic path has a DOM structure that maps
    one-to-one onto design_data's own element list at all (the 3 static
    templates are hand-built markup with no such mapping — there's
    nothing in professional.html for a canvas drag to correspond to).
    """
    context = build_preview_context(user, base_template, color_variant)
    return _render_editor_canvas_html(design_data, context, sample_rows=sample_rows)


def render_editor_element_html(user, base_template, color_variant, el_type, style):
    """
    The canvas's live per-element content refresh (a style-panel font/
    color/label/variant change) — re-renders just that one element's real
    content fragment via the exact same _dynamic_element_content.html
    partial every other real render path uses, so the canvas never shows
    anything a real invoice with this exact (type, style) wouldn't.
    `base_template`/`color_variant` only matter here insofar as
    _dynamic_element_content.html's own CSS classes (already loaded once
    into the canvas iframe's <head> at initial load) reference
    design_primary_color/design_secondary_color — this function doesn't
    need to re-supply them itself, only the invoice/freelancer/qr context
    the content fragment's own bindings read.
    """
    context = build_preview_context(user, base_template, color_variant)
    return _render_editor_element_html(el_type, style, context)
