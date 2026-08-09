# apps/invoices/design_seeds.py
"""
Real design_data JSON decompositions of the 3 built templates
(apps/invoices/templates/invoices/{professional,minimal,modern}.html),
per apps/invoices/design_schema.py's contract — the "decomposing
Professional/Minimal/Modern into the shared JSON element-structure" work
the Step 7 handoff notes deferred to "once the editor itself exists."
The editor (Step 8b) still doesn't exist; the schema does now, so this
is that decomposition, written directly from each template's real CSS
(mm units, matching the templates' own @page/padding values) — not
pixel-perfect reproductions, honest starting positions a user could
meaningfully drag around in Step 8b's canvas. See DECISIONS.md for the
reasoning behind the handful of places the real HTML doesn't map
1:1 onto the two-zone vocabulary (modern.html's fixed sidebar in
particular).

Deliberately Python dicts, not database rows — InvoiceDesign.user is a
required FK (CASCADE, no null=True — verified directly against the
model), so there is no "ownerless" row a `builtin` design could live as.
design_duplicate (apps/invoices/views.py) is what turns one of these
into a real, owned InvoiceDesign row at the moment a user actually picks
it — see that view's own docstring and DECISIONS.md for why this is the
right mechanism rather than pre-creating rows for every user or making
`user` nullable.
"""
import copy

PROFESSIONAL_DESIGN_DATA = {
    'zone_1': {
        'elements': [
            {'type': 'logo', 'x': 20, 'y': 16, 'width': 15, 'height': 15,
             'style': {'border_radius_mm': 2.5}},
            {'type': 'business_info', 'x': 39, 'y': 16, 'width': 90, 'height': 17,
             'style': {'font': 'Source Serif 4', 'font_size_pt': 21, 'color': '#1a2b42',
                       'eyebrow': 'Invoice', 'show_tagline': True}},
            {'type': 'dates', 'x': 133, 'y': 16, 'width': 57, 'height': 20,
             'style': {'align': 'right', 'font': 'IBM Plex Mono', 'show_invoice_number': True}},
            {'type': 'client_info', 'x': 20, 'y': 48, 'width': 85, 'height': 28,
             'style': {'label': 'Bill to', 'align': 'left'}},
            {'type': 'business_info', 'x': 115, 'y': 48, 'width': 75, 'height': 28,
             'style': {'label': 'From', 'align': 'right', 'variant': 'sender_repeat'}},
        ],
    },
    'zone_2': {
        'table': {
            'style': {'header_border_color': '#a8813c', 'row_border_color': '#e5e1d6', 'font': 'IBM Plex Mono'},
        },
        'elements': [
            {'type': 'totals', 'spacing_after_previous': 6, 'style': {'width': 62, 'align': 'right'}},
            {'type': 'notes', 'spacing_after_previous': 14, 'style': {'width': 56}},
            {'type': 'payment_info', 'spacing_after_previous': 0,
             'style': {'width': 40, 'label': 'Payment methods', 'variant': 'bank_methods'}},
            {'type': 'payment_info', 'spacing_after_previous': 18,
             'style': {'label': 'Pay online', 'variant': 'qr_and_link'}, 'paired_side_by_side': True},
            {'type': 'signature', 'spacing_after_previous': 0,
             'style': {'label': 'Authorised signature'}, 'paired_side_by_side': True},
        ],
    },
}

MINIMAL_DESIGN_DATA = {
    'zone_1': {
        'elements': [
            {'type': 'logo', 'x': 18, 'y': 20, 'width': 12, 'height': 12, 'style': {}},
            {'type': 'business_info', 'x': 34, 'y': 20, 'width': 90, 'height': 15,
             'style': {'font': 'IBM Plex Sans', 'font_size_pt': 19, 'eyebrow': 'Invoice', 'show_tagline': True}},
            {'type': 'dates', 'x': 130, 'y': 20, 'width': 62, 'height': 16,
             'style': {'align': 'right', 'font': 'IBM Plex Mono', 'show_invoice_number': True}},
            {'type': 'client_info', 'x': 18, 'y': 48, 'width': 85, 'height': 26,
             'style': {'label': 'Bill to', 'align': 'left'}},
            {'type': 'business_info', 'x': 115, 'y': 48, 'width': 77, 'height': 26,
             'style': {'label': 'From', 'align': 'right', 'variant': 'sender_repeat'}},
        ],
    },
    'zone_2': {
        'table': {
            'style': {'header_border_color': '#171614', 'row_border_color': '#e8e6de', 'font': 'IBM Plex Mono'},
        },
        'elements': [
            {'type': 'totals', 'spacing_after_previous': 6,
             'style': {'width': 62, 'align': 'right', 'rows': ['subtotal', 'tax', 'discount']}},
            {'type': 'totals', 'spacing_after_previous': 12,
             'style': {'align': 'right', 'variant': 'total_due_display', 'font_size_pt': 34}},
            {'type': 'notes', 'spacing_after_previous': 4, 'style': {'width': 56}},
            {'type': 'payment_info', 'spacing_after_previous': 0,
             'style': {'width': 40, 'label': 'Payment methods', 'variant': 'bank_methods'}},
            {'type': 'payment_info', 'spacing_after_previous': 16,
             'style': {'label': 'Pay online', 'variant': 'qr_and_link'}, 'paired_side_by_side': True},
            {'type': 'signature', 'spacing_after_previous': 0,
             'style': {'label': 'Authorised signature', 'has_signature_image': True}, 'paired_side_by_side': True},
        ],
    },
}

# modern.html's full-height position:fixed sidebar doesn't map cleanly
# onto "zone_1 sits above the table" (it runs the whole page height,
# beside the table, not above it) — kept honest rather than forced:
# the sidebar's own logo/business_info still use those zone_1 types
# (style.sidebar=True marks where they really render), and its
# pay-online QR block becomes a zone_2 payment_info element with the
# same sidebar flag, since "payment_info" isn't in the zone_1 type
# vocabulary at all. See DECISIONS.md.
MODERN_DESIGN_DATA = {
    'zone_1': {
        'elements': [
            {'type': 'logo', 'x': 6, 'y': 14, 'width': 15, 'height': 15, 'style': {'sidebar': True}},
            {'type': 'business_info', 'x': 6, 'y': 31, 'width': 30, 'height': 22,
             'style': {'sidebar': True, 'font': 'Space Grotesk', 'show_tagline': True}},
            {'type': 'dates', 'x': 58, 'y': 14, 'width': 136, 'height': 18,
             'style': {'eyebrow': 'Invoice', 'show_invoice_number': True, 'font': 'Space Grotesk'}},
            {'type': 'client_info', 'x': 58, 'y': 40, 'width': 64, 'height': 26,
             'style': {'label': 'Bill to', 'align': 'left'}},
            {'type': 'business_info', 'x': 126, 'y': 40, 'width': 68, 'height': 26,
             'style': {'label': 'From', 'align': 'right', 'variant': 'sender_repeat'}},
        ],
    },
    'zone_2': {
        'table': {
            'style': {'header_bg': '#2d2a6e', 'header_color': '#ffffff', 'font': 'IBM Plex Mono'},
        },
        'elements': [
            {'type': 'totals', 'spacing_after_previous': 6,
             'style': {'width': 62, 'align': 'right', 'variant': 'total_pill', 'pill_color': '#d4e157'}},
            {'type': 'notes', 'spacing_after_previous': 12, 'style': {'width': 56}},
            {'type': 'payment_info', 'spacing_after_previous': 0,
             'style': {'width': 40, 'label': 'Payment methods', 'variant': 'bank_methods'}},
            {'type': 'payment_info', 'spacing_after_previous': 0,
             'style': {'label': 'Pay online', 'variant': 'qr_and_link', 'sidebar': True}},
            {'type': 'signature', 'spacing_after_previous': 16,
             'style': {'label': 'Authorised signature', 'has_signature_image': True, 'align': 'right'}},
        ],
    },
}

BUILTIN_DESIGNS = {
    'professional': PROFESSIONAL_DESIGN_DATA,
    'minimal': MINIMAL_DESIGN_DATA,
    'modern': MODERN_DESIGN_DATA,
}


def get_builtin_design_data(base_template):
    """Deep copy — callers (design_duplicate) get an independent dict, never a shared reference."""
    return copy.deepcopy(BUILTIN_DESIGNS[base_template])
