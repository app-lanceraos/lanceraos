# apps/invoices/design_renderer.py
"""
The canonical production renderer — the ONE renderer real invoice
PDF/portal/preview-as-client output goes through for any InvoiceDesign
whose design_data is schema_version 2 (see design_schema.py).
`pdf_generator.render_html_for_design` dispatches here first; a
pre-existing legacy-shaped design (no schema_version key) falls through
to legacy_design_renderer.py instead — see that module's own docstring
for the retired-but-kept reasoning.

THE CORE ARCHITECTURAL RULE THIS MODULE EXISTS TO SATISFY: there is no
branch anywhere in this file that compares design_data against a seed, a
template identity, or a "was this edited" flag to decide HOW to render.
render_design_html renders whatever schema-valid design_data it is given,
unconditionally, every time, through the same code path — a no-op editor
open+save can never silently change an invoice's render quality, because
there is nothing to switch between.

The full style/overrides theme cascade (theme -> template defaults ->
element `style` -> explicit user `overrides`) is only partially
implemented: resolve_style_value below implements the correct partial-cascade
rule — an explicit `overrides` value wins over the same key in `style` —
but doesn't yet resolve which literal `style` values are "really" theme
defaults vs. hand-set values; every migrated legacy design's literal
style values render exactly as they did before migration, unchanged.
"""
from types import SimpleNamespace

from django.template.loader import render_to_string

from apps.invoices.design_schema import SUPPORTED_BINDINGS, validate_design_data_schema_v2
from apps.invoices.pdf_generator import (
    FONT_CONTEXT,
    PORTAL_FONT_CONTEXT,
    _generate_qr_data_uri,
    _generate_wordmark_data_uri,
    _is_premium_branding_enabled,
)

# Page content margins, in mm. NOT invented for Phase 1 — these are the
# exact real values apps/invoices/templates/invoices/_dynamic_element_styles.html's
# `.dyn-main` container already uses in production today (padding: 16mm
# 16mm 16mm 20mm), per Phase 1's own instruction not to contradict the
# existing product's real geometry. Per-design margin customization is
# not a concept in any currently-approved phase; this is a renderer-level
# constant, not part of design_data, and is the direct fix for the
# architecture plan's MISMATCH-1 finding (the old editor canvas had no
# equivalent page-margin container at all).
PAGE_MARGIN_TOP_MM = 16
PAGE_MARGIN_RIGHT_MM = 16
PAGE_MARGIN_BOTTOM_MM = 16
PAGE_MARGIN_LEFT_MM = 20

# Phase 1 (rotation/ellipse/footer/crop, 07 September 2026) — the real
# WeasyPrint `@page` bottom margin reserved for `page.footer`'s own
# margin-box content (@bottom-left/@bottom-center/@bottom-right — see
# _page_styles.html), same value professional.html/minimal.html/
# modern.html already use for the identical purpose (their own real,
# working `@page { margin: 0 0 16mm 0; }`). A renderer-level constant,
# not part of design_data — this schema has no per-design footer-height
# concept, matching how PAGE_MARGIN_*_MM above are renderer constants too.
# Distinct from PAGE_MARGIN_BOTTOM_MM (a plain CSS `padding-bottom` on
# `.v2-content`, inside the body's own normal flow, unrelated to the
# real `@page` margin box a footer needs — the two can both apply at
# once, one adding breathing room above the last real content row, the
# other carving out physical page space for the footer strip below it).
FOOTER_MARGIN_BOX_HEIGHT_MM = 16

# Phase 1 — the footer's own default style, applied whenever `page.footer`
# is present but a given key is absent from `page.footer.style` (design_
# schema.py validates these are the right TYPE when present, but doesn't
# assign defaults — that's this renderer's job, same division of
# responsibility every other optional page/style field in this module
# already follows). `text_color` reuses `#a09a89` — not invented for this
# feature, it's this exact file's own pre-existing muted-footer-ish tone
# (`.v2-sig-line`'s color, _page_styles.html) rather than a new arbitrary
# shade or one of the 3 static templates' own template-specific hues.
FOOTER_STYLE_DEFAULTS = {
    'text_color': '#a09a89',
    'background_color': 'transparent',
    'divider_color': None,
    'font_family': 'IBM Plex Mono',
    'font_size_pt': 7,
    'font_weight': None,
    'show_wordmark': True,
}


class DesignRenderError(ValueError):
    """
    Raised for any V2 rendering failure that must be explicit rather than
    silently producing a blank or partially-rendered financial document
    (Phase 1 Part 15's own requirement). A ValueError subclass, not a new
    exception hierarchy — matching this codebase's existing lightweight
    convention (apps.invoices.ai_design raises plain ValueError/RuntimeError
    for its own explicit failures rather than inventing a class tree).
    """


# ── Dynamic bindings (generic `text` elements only) ────────────────────
#
# The approved 7-entry allow-list from design_schema.SUPPORTED_BINDINGS
# is the single source of truth for WHICH bindings are legal; this dict is
# the single source of truth for HOW each one resolves. See
# test_design_renderer.py's BindingResolversMatchAllowListTests for the
# test proving these two sets never drift apart.
#
# No entry here ever evaluates arbitrary Python, does generic attribute
# traversal on a user-supplied string, or executes anything design_data
# itself supplies as code — each resolver is a fixed, hardcoded lambda
# reading one specific, known-safe attribute off the real context objects
# this module itself constructs (never off a path named in design_data).
BINDING_RESOLVERS = {
    'invoice.number': lambda ctx: ctx['invoice'].invoice_number or 'DRAFT',
    'invoice.issue_date': lambda ctx: (
        ctx['invoice'].issue_date.strftime('%d %b %Y') if ctx['invoice'].issue_date else ''
    ),
    'invoice.due_date': lambda ctx: (
        ctx['invoice'].due_date.strftime('%d %b %Y') if ctx['invoice'].due_date else '—'
    ),
    'invoice.subtotal': lambda ctx: f"{ctx['invoice'].currency_symbol}{ctx['invoice'].subtotal:,.2f}",
    'invoice.tax_amount': lambda ctx: f"{ctx['invoice'].currency_symbol}{ctx['invoice'].tax_amount:,.2f}",
    'invoice.discount_amount': lambda ctx: f"{ctx['invoice'].currency_symbol}{ctx['invoice'].discount_amount:,.2f}",
    'invoice.notes': lambda ctx: ctx['invoice'].notes or '',
    'invoice.terms': lambda ctx: ctx['invoice'].terms or '',
    'invoice.payment_link': lambda ctx: ctx['invoice'].payment_page_url,
    'business.name': lambda ctx: ctx['freelancer'].business_name or ctx['freelancer'].display_name,
    'business.email': lambda ctx: ctx['invoice'].user.email,
    'business.address_line1': lambda ctx: ctx['freelancer'].address_line1 or '',
    'business.city': lambda ctx: ctx['freelancer'].city or '',
    'business.country': lambda ctx: ctx['freelancer'].country or '',
    'business.phone': lambda ctx: ctx['freelancer'].phone or '',
    'client.name': lambda ctx: ctx['invoice'].client_name or 'No client yet',
    'client.company': lambda ctx: ctx['invoice'].client_company or '',
    'client.email': lambda ctx: ctx['invoice'].client_email or '',
    'client.phone': lambda ctx: ctx['invoice'].client_phone or '',
    'client.address': lambda ctx: ctx['invoice'].client_address or '',
    'totals.grand_total': lambda ctx: f"{ctx['invoice'].currency_symbol}{ctx['invoice'].total:,.2f}",
    # Phase 4B.3 — see design_schema.SUPPORTED_BINDINGS' own comment for
    # the full reasoning (real, confirmed FreelancerProfile fields; not
    # used to decompose the built-in payment_info seed itself).
    'business.bank_name': lambda ctx: ctx['freelancer'].bank_name or '',
    'business.bank_account_number': lambda ctx: ctx['freelancer'].bank_account_number or '',
    'business.jazzcash_number': lambda ctx: ctx['freelancer'].jazzcash_number or '',
    'business.easypaisa_number': lambda ctx: ctx['freelancer'].easypaisa_number or '',
    'business.payoneer_email': lambda ctx: ctx['freelancer'].payoneer_email or '',
    # Phase 3a (07 September 2026) — see design_schema.SUPPORTED_BINDINGS'
    # own comment for the full reasoning. `client_currency_conversion` is
    # a dict (currency/symbol/converted_total/rate) or None, never a
    # printable scalar on its own — this resolver reproduces the exact
    # "≈ {symbol}{converted_total} at rate {rate}" text every one of the
    # 3 static templates + legacy_design_renderer already renders
    # (`_dynamic_element_content.html`/`professional.html`/`minimal.html`/
    # `modern.html`, all four verbatim-identical), so a design using this
    # binding matches what a user already sees on the templates it's
    # replacing, not a new, independently-invented format. Resolves to
    # '' (never a crash, never the raw dict) for every one of the real
    # None-cases that property's own docstring documents (one-time
    # client, matching currency, no snapshot, etc.) — `_element_has_real_
    # content`'s existing blank-string-is-empty check for bound text then
    # correctly collapses the element, exactly like the static templates'
    # own `{% if invoice.client_currency_conversion %}` gate already does.
    'invoice.client_currency_conversion': lambda ctx: (
        f"≈ {ctx['invoice'].client_currency_conversion['symbol']}"
        f"{ctx['invoice'].client_currency_conversion['converted_total']:,.2f} "
        f"at rate {ctx['invoice'].client_currency_conversion['rate']}"
    ) if ctx['invoice'].client_currency_conversion else '',
    # `tax_rate` is a plain DecimalField (apps/invoices/models.py) — the
    # direct sibling of `invoice.tax_amount`/`invoice.discount_amount`
    # above, which were already bindable; the RATE itself, unlike those
    # two computed amounts, never was. `floatformat:"-2"`'s own Django
    # semantics (strip trailing zeros, keep up to 2 decimal places) is
    # reproduced here in plain Python so "10%" (not "10.00%") matches
    # exactly what the 3 static templates' own tax-rate label already
    # shows (`invoice.tax_rate|floatformat:"-2"`, _element_content.html's
    # totals branch). Real bug found while running the full test suite:
    # `tax_rate` is nullable in practice (design_preview.py's own sample
    # invoice sets it to None, matching a real invoice's own optional
    # tax_rate field) — an unguarded `f"{None:.2f}"` raised a hard
    # TypeError instead of resolving to '' the way every other optional
    # bound field already does, so this now mirrors those (e.g.
    # `invoice.notes`) with an explicit `or Decimal('0')`-style guard.
    'invoice.tax_rate': lambda ctx: (
        f"{ctx['invoice'].tax_rate:.2f}".rstrip('0').rstrip('.') + '%'
        if ctx['invoice'].tax_rate is not None else ''
    ),
}

# Phase 4B — the editor's design-time content mode. `content_mode='real'`
# (the default everywhere, and the ONLY mode render_design_html/
# render_design_pdf_bytes ever use — see their own call sites below,
# neither accepts a content_mode parameter at all) resolves every binding
# to genuine invoice/profile data, unchanged from Phase 1-3. `'alias'` is
# new: it resolves every binding to a fixed, human-readable label instead
# ("Client Name", "Invoice Number") so the CANVAS EDITOR — a design
# environment, not a live invoice preview — always shows what a field
# REPRESENTS rather than today's test-account data, and, critically,
# never collapses to zero size just because the real underlying field
# happens to be blank (see the per-branch unconditional-rendering changes
# in _v2_element_content.html). Only design_canvas.py's own two view-
# facing entry points ever pass content_mode='alias' — the canonical
# renderer used for actual PDF/portal output has no code path that could
# ever receive anything but the 'real' default, by construction, not by
# convention.
ALIAS_BINDING_LABELS = {
    'invoice.number': 'Invoice Number',
    'invoice.issue_date': 'Invoice Date',
    'invoice.due_date': 'Due Date',
    'invoice.subtotal': 'Subtotal Amount',
    'invoice.tax_amount': 'Tax Amount',
    'invoice.discount_amount': 'Discount Amount',
    'invoice.notes': 'Notes text',
    'invoice.terms': 'Terms text',
    'invoice.payment_link': 'Payment Link',
    'business.name': 'Business Name',
    'business.email': 'Business Email',
    'business.address_line1': 'Business Address',
    'business.city': 'Business City',
    'business.country': 'Business Country',
    'business.phone': 'Business Phone',
    'client.name': 'Client Name',
    'client.company': 'Client Company',
    'client.email': 'Client Email',
    'client.phone': 'Client Phone',
    'client.address': 'Client Address',
    'totals.grand_total': 'Total Amount',
    'business.bank_name': 'Bank Name',
    'business.bank_account_number': 'Bank Account Number',
    'business.jazzcash_number': 'JazzCash Number',
    'business.easypaisa_number': 'Easypaisa Number',
    'business.payoneer_email': 'Payoneer Email',
    'invoice.client_currency_conversion': 'Currency Conversion',
    'invoice.tax_rate': 'Tax Rate',
}


def resolve_binding(binding, context, content_mode='real'):
    """
    Safe, explicit resolution of a generic text element's dynamic
    binding. Only the entries in SUPPORTED_BINDINGS may ever resolve —
    anything else is a hard DesignRenderError, never a silent blank and
    never the literal binding string rendered as if it were content.

    `content_mode='alias'` (Phase 4B) returns the fixed ALIAS_BINDING_LABELS
    string instead of resolving real data — used only by the design-time
    canvas, never by real invoice rendering (see this module's own
    ALIAS_BINDING_LABELS comment above).
    """
    if binding not in SUPPORTED_BINDINGS:
        raise DesignRenderError(f'Unsupported binding "{binding}" — must be one of {sorted(SUPPORTED_BINDINGS)}.')
    if content_mode == 'alias':
        return ALIAS_BINDING_LABELS.get(binding, binding)
    resolver = BINDING_RESOLVERS.get(binding)
    if resolver is None:
        # Unreachable if BINDING_RESOLVERS and SUPPORTED_BINDINGS are kept
        # in sync (tested directly) — a real, explicit error rather than a
        # silent KeyError if that ever drifts.
        raise DesignRenderError(f'Binding "{binding}" is schema-recognized but has no resolver implemented.')
    try:
        return resolver(context)
    except (KeyError, AttributeError) as exc:
        raise DesignRenderError(f'Could not resolve binding "{binding}": missing required context ({exc}).') from exc


def _element_has_real_content(element, context, content_mode='real'):
    """
    Green-Light directive (§18-22) — "missing data must not create ugly
    empty spaces." Determines whether an element's REAL content is
    actually non-empty, so the layout engine (`_prepare_header_region`/
    `_prepare_flow_region`) can exclude a genuinely-empty optional
    element from consuming any layout space at all, rather than
    reserving its declared box regardless of whether anything real would
    render inside it.

    Deliberately conservative — only specific, well-understood content-
    bearing types can ever be considered "empty." Decorative/structural
    types (rectangle, divider, container, the table, totals rows,
    unbound static text) always count as real content: "empty" has no
    honest meaning for them (a $0.00 total is real data, not missing
    data; a divider's entire purpose is the line itself; static text a
    user deliberately typed is never treated as accidental). `signature`
    is NOT in this always-real group — see its own branch below.

    `content_mode='alias'` (the editor's own design-time canvas) always
    returns True — the canvas must keep showing every element so a
    designer can select and configure it, even one that would collapse
    in a real invoice; collapsing is a canonical-render-time concern
    only, matching the same "canvas is a fixed design-time estimate;
    the canonical renderer alone applies real content" principle already
    established for the table's own height and for layout_mode's own
    chain/row growth (see this module's own _prepare_flow_region).
    """
    # Green-Light directive — the Layers panel's "hide" toggle. Checked
    # BEFORE the content_mode early-return below and regardless of it: a
    # user who deliberately hid an element wants it excluded from real
    # invoice output — the canvas adapter (design_canvas.py) never
    # calls this function at all, so a hidden element still appears
    # (dimmed, via editor-only CSS) in the editor canvas either way; this
    # check only ever affects the canonical renderer's own real/preview
    # output.
    if element.get('hidden'):
        return False

    if content_mode != 'real':
        return True

    kind = element.get('kind')
    el_type = element.get('type')

    if kind == 'generic' and el_type == 'text':
        binding = element.get('binding')
        if not binding:
            return True  # static, user-authored text is never "missing data"
        try:
            value = resolve_binding(binding, context, 'real')
        except DesignRenderError:
            return True  # fail open — never silently hide content on a resolution error
        return bool(value and str(value).strip())

    if kind == 'generic' and el_type == 'image':
        return bool(resolve_style_value(element, 'src'))

    if el_type == 'logo':
        return bool(context['freelancer'].logo)

    if el_type == 'payment_info':
        freelancer = context['freelancer']
        return bool(
            freelancer.bank_name or freelancer.bank_account_number
            or freelancer.jazzcash_number or freelancer.easypaisa_number
            or freelancer.payoneer_email
        )

    if el_type == 'qr_code':
        return bool(context.get('qr_code_data_uri'))

    if el_type == 'online_payment_link':
        return bool(context['invoice'].payment_page_url)

    if el_type == 'notes':
        sections = resolve_style_value(element, 'sections', ['notes', 'terms'])
        invoice = context['invoice']
        return bool(
            ('notes' in sections and invoice.notes)
            or ('terms' in sections and invoice.terms)
        )

    if el_type == 'signature':
        # An unset signature is a genuinely empty block, not decorative
        # scaffolding: with no real image to show, neither the image NOR
        # the "Authorised signature" line/label means anything — the
        # whole element collapses and the flow chain reclaims its space,
        # matching the exact pattern `logo` already established above,
        # not the "always real" treatment this type had before.
        return bool(context['freelancer'].signature_url)

    # totals, table, rectangle, divider, container: always real content
    # (see this function's own docstring for why each is deliberately
    # excluded from ever being treated as "empty").
    return True


def resolve_style_value(element, key, default=None):
    """
    The one, deliberately trivial piece of style/overrides precedence
    Phase 1 implements: an explicit `overrides` value for `key` wins over
    the same key in `style`; otherwise `style`'s value; otherwise
    `default`. This is NOT the architecture plan's full theme cascade
    (theme -> template defaults -> style -> overrides) — there is no
    theme-token resolution here at all. It is exactly enough to make an
    `overrides` dict meaningful once something (a later phase) starts
    writing real values into it, while being a complete no-op today,
    since every v1->v2 migrated design has an empty overrides dict.
    """
    overrides = element.get('overrides') or {}
    if key in overrides:
        return overrides[key]
    style = element.get('style') or {}
    return style.get(key, default)


_THEME_COLOR_TOKENS = {
    'theme_primary': 'design_primary_color',
    'theme_secondary': 'design_secondary_color',
}


def resolve_theme_color(value, context):
    """
    Phase 4B: a decomposed label element (e.g. the "Bill to"/"Invoice"
    static-text siblings replacing what used to be a bundled semantic
    element's own dedicated CSS class) needs to reference the design's
    live-resolved theme color, not a hardcoded hex — otherwise switching
    color_variant would no longer affect it, a real fidelity regression
    from the bundled version's own `color: {{ design_primary_color }}`
    class rule. `style.color`/`overrides.color` may be the literal string
    'theme_primary' or 'theme_secondary' (two small, generic sentinel
    tokens, not a per-element special case) to opt into this; any other
    string is returned unchanged as a literal color value, exactly as
    before this function existed.
    """
    key = _THEME_COLOR_TOKENS.get(value)
    return context.get(key) if key else value


# Phase 3a (07 September 2026) — the font analog of _THEME_COLOR_TOKENS/
# resolve_theme_color directly above: two small, generic sentinel tokens
# ('theme_heading_font'/'theme_body_font') an element's `style.font`/
# `style.font_weight` may carry instead of a literal value, resolved
# against `design_data.theme` (see design_schema._validate_theme's own
# docstring for why font theming lives INSIDE design_data itself rather
# than being derived from an outside model field the way color_variant
# is). `context` here always carries these 4 keys (render_design_html
# populates them from `design_data.get('theme') or {}` before any element
# is prepared — absent for every design, real value None) — a value that
# isn't one of the two sentinel strings is returned completely unchanged,
# exactly like resolve_theme_color's own no-op guarantee for a literal
# hex; every existing element's `style.font`/`style.font_weight` is
# already a literal font name/number, never one of these two strings, so
# this is a strict, zero-risk generalization, not a behavior change.
_THEME_FONT_FAMILY_TOKENS = {
    'theme_heading_font': 'theme_heading_font_family',
    'theme_body_font': 'theme_body_font_family',
}
_THEME_FONT_WEIGHT_TOKENS = {
    'theme_heading_font': 'theme_heading_font_weight',
    'theme_body_font': 'theme_body_font_weight',
}


def resolve_theme_font_family(value, context):
    key = _THEME_FONT_FAMILY_TOKENS.get(value)
    return context.get(key) if key else value


def resolve_theme_font_weight(value, context):
    key = _THEME_FONT_WEIGHT_TOKENS.get(value)
    return context.get(key) if key else value


def is_sidebar_element(element):
    """
    True when an element is flagged `style.sidebar: true` — the real,
    established v1 convention (see design_seeds.py) generalized to V2 by
    Phase 2. A top-level, public helper (Phase 3 addition) rather than
    the inline closure `render_design_html` used through Phase 2 —
    promoted for reuse by design_canvas.py's own header/flow
    page-vs-sidebar split, which needs the exact same rule and must not
    reimplement it a second time (the same "one real layout computation,
    reused, not duplicated" principle this module's own docstring states).
    """
    return bool((element.get('style') or {}).get('sidebar'))


# The 3 generic types whose fill/border is resolved authoritatively by
# attach_generic_content's own shape_css (below), onto their INNER
# shaped div — see prepare_element's own background-color guard, which
# reads this same tuple to make sure the OUTER `.v2-el` wrapper never
# also paints an identical, always-sharp-cornered background behind it.
SHAPE_TYPES_WITH_OWN_FILL = ('rectangle', 'container', 'ellipse')


def attach_generic_content(prepared, element, context, content_mode='real'):
    """Populates the extra keys the template needs for a generic element. No-op for semantic elements."""
    if element.get('kind') != 'generic':
        return
    el_type = element.get('type')

    if el_type == 'text':
        binding = element.get('binding')
        if binding:
            prepared['resolved_text'] = resolve_binding(binding, context, content_mode)
        else:
            # Phase 0's schema doesn't define where static text content
            # lives for a generic text element (reasonably — that's a
            # rendering-contract decision, this phase's job per Part 2).
            # Decision: a plain `style.text` string. Documented here as a
            # new Phase 1 convention, not something Phase 0 already specified.
            prepared['resolved_text'] = resolve_style_value(element, 'text', '')

    elif el_type == 'image':
        prepared['image_src'] = resolve_style_value(element, 'src', '')
        # Phase 1 — non-destructive crop: `element['crop']` (validated by
        # design_schema.py to be x/y/width/height fractions of the SOURCE
        # image, each 0-1) is rendered via the standard CSS
        # crop-without-re-encoding technique — a sized, `overflow:hidden`
        # wrapper (see _element_content.html) with the real, full <img>
        # scaled up by 1/crop.width x 1/crop.height and shifted so the
        # crop rectangle's own top-left lands at the wrapper's origin.
        # The source asset itself is never touched — only re-cropping the
        # SAME original never compounds quality loss, unlike re-encoding
        # a new, already-cropped image on every edit. Confirmed directly
        # against a real WeasyPrint render (see DECISIONS.md) — absolute
        # positioning + percentage width/height inside an overflow:hidden
        # ancestor renders correctly, the same real mechanism this
        # renderer already trusts elsewhere (.v2-sidebar, .v2-spine).
        crop = element.get('crop')
        if crop:
            crop_width = crop['width'] or 1
            crop_height = crop['height'] or 1
            img_width_pct = 100 / crop_width
            img_height_pct = 100 / crop_height
            left_pct = -(crop['x'] / crop_width) * 100
            top_pct = -(crop['y'] / crop_height) * 100
            prepared['crop_css'] = (
                f'position:absolute;max-width:none;'
                f'width:{img_width_pct}%;height:{img_height_pct}%;'
                f'left:{left_pct}%;top:{top_pct}%;'
            )

        # Phase 3a (07 September 2026) — image border + corner radius,
        # the same 3 field names (border_color/border_width_mm/
        # border_radius_mm) rectangle/container/logo already established
        # (see SHAPE_TYPES_WITH_OWN_FILL's own border resolution below,
        # and _element_content.html's pre-existing logo border_radius_mm
        # usage) — reused verbatim rather than inventing image-specific
        # names. Applied to a SEPARATE `image_frame_css` key (never
        # folded into `crop_css`) because it must land on a different
        # element depending on whether crop is active: the crop wrapper
        # div (so overflow:hidden actually clips the rounded corner —
        # putting radius/border on the inner, oversized, absolutely-
        # positioned <img> itself would round/border the IMAGE's own
        # edges, most of which sit outside the visible crop window, not
        # the visible box) when cropped, or directly on the plain <img>
        # itself when uncropped (there is no wrapper to put it on).
        # `_element_content.html` picks the right target; this function
        # only ever computes the CSS string once, not which element gets
        # it — the same "one real computation" division of responsibility
        # every other prepare step in this module already follows.
        border_color = resolve_theme_color(resolve_style_value(element, 'border_color', None), context)
        border_width = resolve_style_value(element, 'border_width_mm', 0)
        border_radius_mm = resolve_style_value(element, 'border_radius_mm')
        frame_css = ''
        if border_color and border_width:
            frame_css += f'border:{border_width}mm solid {border_color};'
        if border_radius_mm:
            frame_css += f'border-radius:{border_radius_mm}mm;'
        prepared['image_frame_css'] = frame_css

    elif el_type in SHAPE_TYPES_WITH_OWN_FILL:
        # 30 August 2026 fidelity fix — this branch never called
        # resolve_theme_color (every OTHER color-bearing generic/semantic
        # branch in this module does), a real, confirmed gap: a rectangle's
        # `background_color`/`border_color` set to the 'theme_primary'/
        # 'theme_secondary' sentinel rendered as the LITERAL invalid CSS
        # value `background:theme_primary;` (silently transparent) instead
        # of the design's real resolved color — found while adding
        # Professional's V2 spine (a real rectangle element that needs to
        # track color_variant, exactly like the golden static template's
        # own `.spine { background: {{ design_primary_color }}; }`).
        bg = resolve_theme_color(resolve_style_value(element, 'background_color', 'transparent'), context)
        border_color = resolve_theme_color(resolve_style_value(element, 'border_color', None), context)
        border_width = resolve_style_value(element, 'border_width_mm', 0)
        css = f'background:{bg};'
        if border_color and border_width:
            css += f'border:{border_width}mm solid {border_color};'
        # Phase 3a (07 September 2026) — corner radius for rectangle/
        # container, the same `border_radius_mm` field/mm-unit convention
        # `_element_content.html`'s pre-existing logo branch already
        # established (a rectangle/container previously always rendered
        # sharp-cornered — there was no code path that ever read this key
        # for either type). Applied to BOTH rectangle and container (not
        # rectangle alone) because they share this exact branch/CSS
        # target and there is no reason a container's own corners
        # couldn't round too — not a second, parallel implementation.
        # Placed BEFORE ellipse's own forced `border-radius:50%` below, on
        # purpose: CSS resolves the LAST `border-radius` declaration in a
        # single style string, so an ellipse's forced round shape always
        # wins over a stray/inherited border_radius_mm value, never fights
        # with it.
        border_radius_mm = resolve_style_value(element, 'border_radius_mm')
        if border_radius_mm:
            css += f'border-radius:{border_radius_mm}mm;'
        # Phase 1 — 'ellipse' reuses this exact same fill/border
        # resolution (never a parallel one) plus one forced addition: a
        # single border-radius:50% renders as a true ellipse (not just a
        # circle) on a non-square box — CSS resolves a percentage
        # border-radius independently per axis, confirmed directly
        # against a real WeasyPrint render (see DECISIONS.md). Always
        # forced, never a user-configurable style key — an "ellipse" that
        # isn't elliptical would just be a second, confusingly-named
        # rectangle.
        if el_type == 'ellipse':
            css += 'border-radius:50%;'
        prepared['shape_css'] = css

    elif el_type == 'divider':
        color = resolve_theme_color(resolve_style_value(element, 'color', '#cccccc'), context)
        thickness = resolve_style_value(element, 'thickness_mm', 0.5)
        prepared['shape_css'] = f'border-top:{thickness}mm solid {color};'


def prepare_element(element, context, content_mode='real', *, chain_member=False):
    """
    Builds the per-element dict canonical.html iterates — ONE function
    for every element in EITHER `header.elements` or `flow.elements`
    (Phase 4B.2: the two used to need separate functions, prepare_header_
    element/prepare_flow_element, because flow elements were spacing-
    positioned and header elements were absolutely positioned; now both
    lists share one shape — see design_schema.py's own docstring for
    the full reasoning — so they share one preparation function too).
    Absolute positioning in real mm — no px conversion anywhere in this
    module (Part 3's own requirement: the renderer side of the coordinate
    contract stays in the canonical mm unit throughout; px only ever
    existed as an editor-internal, GrapesJS-specific concern, out of
    scope here).

    `content_mode` (Phase 4B, default 'real') — see ALIAS_BINDING_LABELS'
    comment above. render_design_html never passes anything but the
    default; only design_canvas.py's editor-facing endpoints do.

    `chain_member` (Master Blueprint cutover, §B.3) — True only when this
    element is being rendered as a non-first member of a real-flow
    "chain" (see _group_into_render_chains below): position/left/top/
    width/height are omitted from the built CSS entirely (the chain's own
    wrapper div supplies position/left/top/width; the member's own real
    height comes from its own content, via ordinary CSS document flow —
    the whole point of a chain). Every other style property (font/align/
    color/etc.) is computed exactly the same either way.
    """
    prepared = dict(element)
    prepared['content_mode'] = content_mode
    # Phase 4B: route el.style.label reads through the same overrides-wins
    # precedence every other style key already gets (a real, pre-existing
    # gap — client_info/business_info(sender_repeat) read el.style.label
    # directly in the template, bypassing resolve_style_value entirely, so
    # a user's retext-via-overrides never took effect for these labels).
    prepared['resolved_label'] = resolve_style_value(element, 'label')
    if chain_member:
        css = ''
    else:
        css = (
            f"position:absolute;left:{element['x']}mm;top:{element['y']}mm;"
            f"width:{element['width']}mm;height:{element['height']}mm;"
        )
    # Phase 1 — rotation (degrees; absent/0 means no transform at all, so
    # this is a pure no-op for every element that predates this field).
    # design_schema.py's own validation already rejects rotation on a
    # 'flow'-layout element, so a chain_member here can only ever be a
    # PINNED single flow-region item (see _prepare_flow_region) — never
    # an actual growing chain member. That item's real box lives on its
    # own .v2-flow-item wrapper (not this inner div — see that function's
    # own docstring), so `width:100%;height:100%;` is added here too,
    # making this div's own box match its wrapper exactly before rotating
    # it around that box's center — otherwise this div (with no size of
    # its own) would rotate around a zero-size point instead of visually
    # rotating in place. A header-region element already has its own
    # real width/height in `css` above, so this branch is a no-op there.
    rotation = element.get('rotation') or 0
    if rotation:
        if chain_member:
            css += 'width:100%;height:100%;'
        css += f'transform:rotate({rotation}deg);transform-origin:center;'
    # `style.align` applied on the wrapping container, matching v1's own
    # real, established convention exactly (design_renderer.py's
    # _zone1_element_css) — found and fixed during Phase 2's own golden-
    # reference comparison: an earlier version of this function omitted
    # it, which silently left "From"-style right-aligned party blocks
    # left-aligned in the V2 output despite their real style.align value.
    align = resolve_style_value(element, 'align')
    if align:
        css += f'text-align:{align};'
    # Phase 3.2 fix (LANCERAOS_TEMPLATE_BUILDER_2_PHASE3_1.md Finding 1):
    # style.font/font_size_pt/color were never applied to header elements
    # at all — every element silently fell back to the body's generic
    # IBM Plex Sans regardless of its own real, distinctive per-element
    # font (Source Serif 4 for Professional's masthead, Space Grotesk for
    # Modern's titles/metadata). v1's own real, already-correct
    # `_zone1_element_css` (design_renderer.py) has always applied these
    # three — this is a direct, one-to-one port of that same convention,
    # not a new invention. `style.color` is included for the same
    # completeness/parity reason, even though Phase 3.1 didn't separately
    # flag it — v1 applies it in the identical spot and there's no reason
    # for V2 to silently omit it.
    # Phase 3a (07 September 2026) — routed through resolve_theme_font_family
    # so the 'theme_heading_font'/'theme_body_font' sentinels (see that
    # function's own docstring) actually take effect; a no-op passthrough
    # for every existing element's literal font name.
    font = resolve_theme_font_family(resolve_style_value(element, 'font'), context)
    if font:
        css += f"font-family:'{font}';"
    font_size_pt = resolve_style_value(element, 'font_size_pt')
    if font_size_pt:
        css += f'font-size:{font_size_pt}pt;'
    # `font_weight` — new in Phase 3.2, not a v1 concept (v1's own
    # `_zone1_element_css` has no equivalent). Needed because Modern's
    # real masthead invoice number (`.masthead .num`) is genuinely
    # font-weight:700, not the 600 every other template's own real CSS
    # (and `.v2-num`'s own shared default) uses — confirmed by direct
    # inspection of modern.html, not assumed.
    # Phase 3a — same theme-sentinel routing as `font` above, for
    # `font_weight`'s own 'theme_heading_font'/'theme_body_font' values.
    font_weight = resolve_theme_font_weight(resolve_style_value(element, 'font_weight'), context)
    if font_weight:
        css += f'font-weight:{font_weight};'
    color = resolve_theme_color(resolve_style_value(element, 'color'), context)
    if color:
        css += f'color:{color};'
    # Phase 4B additions — needed once business_info/client_info/dates'
    # own dedicated CSS classes (.v2-eyebrow/.v2-label's letter-spacing +
    # uppercase) stop being available for free (those bundled semantic
    # types are being decomposed into plain generic `text` elements for
    # the 3 seeds, see design_templates.py). Two small, generic, reusable
    # style keys — not a type-specific hack — so a decomposed label
    # element can still look like the real label it's replacing.
    letter_spacing_em = resolve_style_value(element, 'letter_spacing_em')
    if letter_spacing_em:
        css += f'letter-spacing:{letter_spacing_em}em;'
    text_transform = resolve_style_value(element, 'text_transform')
    if text_transform:
        css += f'text-transform:{text_transform};'
    # Phase 1 real bug fix, found via a real WeasyPrint render (see
    # DECISIONS.md): rectangle/container/ellipse resolve their OWN fill
    # from this exact same `style.background_color` key via
    # attach_generic_content's `shape_css`, applied to the INNER shaped
    # div — this generic per-element background-color would ALSO paint
    # the OUTER `.v2-el` wrapper with the identical color, as a plain,
    # always-sharp-cornered rectangle. For a rectangle/container (no
    # rounding), the two identically-sized, identically-colored boxes
    # were visually indistinguishable — completely harmless. For an
    # ellipse, the outer wrapper's own sharp-cornered rectangle painted
    # right behind/around the inner rounded shape, in the same color,
    # silently hiding the rounding entirely (confirmed directly: the
    # element rendered as a plain rectangle, not the ellipse it should
    # have been). These 3 types manage their own fill authoritatively via
    # shape_css; the outer wrapper should never also paint it.
    if not (element.get('kind') == 'generic' and element.get('type') in SHAPE_TYPES_WITH_OWN_FILL):
        background_color = resolve_theme_color(resolve_style_value(element, 'background_color'), context)
        if background_color:
            css += f'background-color:{background_color};'
    opacity = resolve_style_value(element, 'opacity')
    if opacity is not None:
        css += f'opacity:{opacity};'
    prepared['css'] = css

    # ── Type-specific prepared fields (unchanged behavior from the old,
    # separate prepare_flow_element for these three cases — just now
    # reachable from either list, since totals/notes/table can in
    # principle live in either now that position no longer distinguishes
    # header from flow). ──────────────────────────────────────────────
    if element.get('kind') == 'semantic' and element.get('type') == 'notes':
        prepared['resolved_notes_label'] = resolve_style_value(element, 'notes_label', 'Notes')
        prepared['resolved_terms_label'] = resolve_style_value(element, 'terms_label', 'Terms')
        # Phase 4B.3 (LANCERAOS_TEMPLATE_BUILDER_2_PHASE4B2_AUDIT.md finding
        # C3) — `sections` narrows a notes element to just its Notes half,
        # just its Terms half, or (default, unchanged for every existing
        # design) both, the exact same generic filtering convention
        # `totals.style.rows` already established. This is what lets
        # design_templates.py give a real invoice's Notes and Terms text
        # their own independent element — genuinely two separate objects,
        # each still correctly omitting itself when its own real content
        # is blank (the existing per-section `{% if invoice.notes %}`/
        # `{% if invoice.terms %}` checks in _v2_element_content.html are
        # UNCHANGED — only gated by one more condition, never replaced),
        # rather than a second, independently-invented conditional-
        # visibility mechanism.
        prepared['notes_sections'] = resolve_style_value(element, 'sections', ['notes', 'terms'])

    if element.get('kind') == 'semantic' and element.get('type') == 'totals':
        # Real bug found during Phase 2's own golden-reference comparison,
        # confirmed to ALSO exist in v1's real, live
        # apps/invoices/templates/invoices/_dynamic_element_content.html
        # (not touched here — that file is untouched per this phase's own
        # rules; documented as a pre-existing finding, not fixed there):
        # `style.rows` was only ever checked for the subtotal/tax/discount
        # rows, never for the plain "Total due" row itself, so a design
        # with two totals elements (one showing subtotal/tax/discount via
        # an explicit `rows` list, a second showing the actual grand total
        # via `variant: total_due_display` — exactly Minimal's real,
        # measured structure) would show the grand total TWICE. Resolved
        # here as a real, generalizable default: `rows` defaults to all
        # four row kinds (today's implicit "show everything" behavior for
        # a single-totals-element design, e.g. Professional/Modern,
        # unchanged), and the "Total due" row itself now respects
        # `'total' in rows` exactly like its three siblings always have.
        prepared['totals_rows'] = resolve_style_value(element, 'rows', ['subtotal', 'tax', 'discount', 'total'])
        # Phase 6 (style/theme cascade) fix — a real, live, reachable bug:
        # `_v2_element_content.html`'s two `total_pill` branches read
        # `el.style.pill_color` directly, which (a) never honored a real
        # `overrides.pill_color` (StylePanel.jsx's own pillColor control
        # writes exactly there — confirmed directly — so picking a pill
        # color in the Style Panel silently had zero effect on either the
        # live canvas or the canonical renderer, since neither ever looked
        # at the override), and (b) never resolved the 'theme_primary'/
        # 'theme_secondary' sentinel tokens (Modern's own seed value was a
        # literal hex copy of its default variant's secondary color — the
        # same TB-001 class as thead_cell_css's own fix above). Routed
        # through the exact same resolve_style_value + resolve_theme_color
        # pair every other themeable property already uses — not a third,
        # independently-invented resolution path.
        prepared['resolved_pill_color'] = resolve_theme_color(resolve_style_value(element, 'pill_color'), context)

    if element.get('kind') == 'structural' and element.get('type') == 'table':
        # Phase 4B.2 — the table is now a real positioned element (see
        # design_schema.py's own docstring); its own `style` dict
        # keeps carrying the SAME table-specific config Phase 4B already
        # established (font, header colors, `columns`) — resolved here,
        # once, the same "one real computation, reused" way every other
        # per-type prepared field already works.
        table_style = element.get('style') or {}
        cell_padding_mm = table_style.get('cell_padding_mm')
        prepared['table_columns'] = resolve_table_columns(table_style)
        prepared['thead_cell_css'] = thead_cell_css(table_style, context, cell_padding_mm)
        prepared['row_cell_css'] = row_cell_css(table_style, context, cell_padding_mm)
        # Phase 3a (07 September 2026) — alternating-row shading. `''`
        # (falsy) whenever `zebra_enabled` is absent/false — every
        # existing table_style dict — so `_table_row.html`'s own
        # `{% cycle "" el.zebra_row_bg %}` alternates between two empty
        # strings and never emits a background, byte-identical to before
        # this field existed. `zebra_color` defaults to a real, existing
        # muted tone already used elsewhere in this stylesheet
        # (`.v2-alias-box`'s own background, _page_styles.html) rather
        # than inventing a new shade, and is routed through
        # resolve_theme_color so the 'theme_primary'/'theme_secondary'
        # sentinels work here too, exactly like every other themeable
        # color in this module.
        prepared['zebra_row_bg'] = (
            resolve_theme_color(table_style.get('zebra_color', '#f5f3ee'), context)
            if table_style.get('zebra_enabled') else ''
        )
        if content_mode == 'alias':
            # A design environment, not a live invoice preview (same rule
            # every other binding already follows) — generic placeholder
            # rows, never the sample invoice's own specific line-item text
            # (which is real-looking content, just not what THIS element
            # is asking to preview: "what does a table look like here",
            # not "what does invoice INV-2026-0042 specifically contain").
            prepared['table_rows'] = ALIAS_SAMPLE_TABLE_ITEMS
        else:
            prepared['table_rows'] = list(context['invoice'].items.all())

    attach_generic_content(prepared, element, context, content_mode)
    return prepared


def thead_cell_css(table_style, context, cell_padding_mm=None):
    """
    Phase 3.2 fix (LANCERAOS_TEMPLATE_BUILDER_2_PHASE3_1.md Finding 4):
    a direct, one-to-one port of v1's own real, already-correct
    `_thead_cell_css` (design_renderer.py) — `table.style.header_bg`/
    `header_color`/`header_border_color` were real, measured values in
    every one of Phase 2's own seed reconstructions
    (design_templates.py) but were never read by canonical.html at
    all; only `table.style.font` was ever consumed. No template-name
    branching — this reads whatever the given table_style dict actually
    contains, generically.

    Phase 6 (style/theme cascade) fix: `header_bg`/`header_border_color`
    were real, live-verified instances of the architecture plan's TB-001
    bug class — Professional's/Minimal's `header_border_color` and
    Modern's `header_bg` were each stored as a literal hex copy of that
    template's own DEFAULT color_variant primary color (confirmed
    directly against design_seeds.COLOR_VARIANTS), so picking a
    non-default variant never actually changed the table header's own
    accent color. `context` is now required (not optional/defaulted) so
    every call site explicitly supplies the real, variant-resolved
    theme — resolve_theme_color is a no-op passthrough for any value
    that isn't the 'theme_primary'/'theme_secondary' sentinel, so this
    has zero effect on `header_color` (Modern's fixed white table-header
    text, never variant-derived — confirmed directly against
    design_templates.py, left as a literal on purpose) or on a
    hand-authored design that sets a genuine custom literal color.

    Phase 3a (07 September 2026) — `cell_padding_mm`, if given, is a real
    configurable cell padding override (the standalone editor already
    lets a user set this; the canonical renderer's own header/row padding
    was previously a fixed, un-overridable value baked into
    `_page_styles.html`'s class rules — `table.v2-items thead th { padding:
    0 3mm 3mm 0; }`). Appended as an inline `padding:{n}mm;` — inline
    style on the `<th>`/`<td>` itself always wins over the shared class
    rule regardless of CSS specificity/declaration order, so this is a
    real, effective override, not a no-op fighting the class. `None`
    (absent — every existing table_style dict) emits nothing, so the
    class's own default padding is completely unaffected for any design
    that predates this field.
    """
    parts = []
    header_bg = resolve_theme_color(table_style.get('header_bg'), context)
    if header_bg:
        parts.append(f"background:{header_bg}")
    header_color = resolve_theme_color(table_style.get('header_color'), context)
    if header_color:
        parts.append(f"color:{header_color}")
    border_color = resolve_theme_color(table_style.get('header_border_color'), context)
    if border_color:
        parts.append(f"border-bottom:0.5mm solid {border_color}")
    if cell_padding_mm is not None:
        parts.append(f"padding:{cell_padding_mm}mm")
    return '; '.join(parts)


def row_cell_css(table_style, context, cell_padding_mm=None):
    """
    Phase 3.2 fix — the direct v1-equivalent port of `_row_cell_css`, same
    reasoning as thead_cell_css above.

    Phase 6: `context` accepted for the same reason thead_cell_css now
    requires it (a single, consistent signature for both table-CSS
    helpers) — `row_border_color`'s own real seed values (a fixed light
    neutral gray in both Professional and Minimal) are confirmed NOT to
    match either template's own theme primary/secondary color in
    design_seeds.COLOR_VARIANTS, so resolve_theme_color is a real no-op
    here today, not a behavior change; the mechanism is wired through
    generically so a future genuinely-themed row-border color would work
    without a second signature change.

    Phase 3a — `cell_padding_mm`, same override as thead_cell_css above,
    applied identically to every body cell.
    """
    parts = []
    color = resolve_theme_color(table_style.get('row_border_color'), context)
    if color:
        parts.append(f"border-bottom:0.25mm solid {color}")
    if cell_padding_mm is not None:
        parts.append(f"padding:{cell_padding_mm}mm")
    return '; '.join(parts) + (';' if parts else '')


# Phase 4B (item 11/§A.5 of the plan) — every real column the line-items
# table can show. `InvoiceItem` (apps/invoices/models.py) only has these 4
# real fields; there is no separate "Item" field distinct from
# "Description" in the data model, so — unlike the product spec's own
# informal "Item/Description/Quantity/Rate/Amount" wording — this is 4
# real toggleable columns, not 5.
TABLE_COLUMNS = ['description', 'quantity', 'unit_price', 'total']
TABLE_COLUMN_LABELS = {'description': 'Description', 'quantity': 'Qty', 'unit_price': 'Rate', 'total': 'Amount'}
# The 3 real golden templates' own measured default widths (52/12/18/18%,
# confirmed directly against professional.html/minimal.html/modern.html).
TABLE_COLUMN_DEFAULT_WIDTHS = {'description': 52, 'quantity': 12, 'unit_price': 18, 'total': 18}

# Phase 4B.2 — the table's own design-time (content_mode='alias') sample
# rows, moved here from design_canvas.py (that module's own special
# table-content generation is gone now that the table is a real element
# flowing through this file's one prepare_element/content-dispatch path
# like everything else — see design_schema.py's own docstring). 3
# rows, matching the canvas's own long-established convention.
ALIAS_SAMPLE_TABLE_ITEMS = [
    SimpleNamespace(description='Sample line item 1', quantity=1, unit_price=100, total=100),
    SimpleNamespace(description='Sample line item 2', quantity=1, unit_price=100, total=100),
    SimpleNamespace(description='Sample line item 3', quantity=1, unit_price=100, total=100),
]


def resolve_table_columns(table_style):
    """
    Returns the ordered, width-renormalized list of visible table columns
    for a given `flow.table.style` dict — `[{'key','label','width_pct','align'}, ...]`.
    `table_style.columns` (new, optional — absent/empty/all-invalid means
    "all 4", today's unconditional behavior, unchanged for every existing
    design) may narrow or reorder which columns show; widths are
    renormalized proportionally from TABLE_COLUMN_DEFAULT_WIDTHS so a
    narrower column set still fills the table's own full width. This one
    function is the single source of truth for BOTH the canonical renderer
    (canonical.html) and the editor canvas (design_canvas.py) — see
    this module's own docstring's "one real computation, reused" rule.

    Phase 3a (07 September 2026) — `align`: `table_style.column_alignments`
    (new, optional — a list of 'left'/'center'/'right' strings) lets a
    design override per-column text alignment; `align` is `None` when it's
    absent (every existing design), which `_table_head.html`/
    `_table_row.html` both treat as "emit no inline text-align override at
    all" — the existing CSS-class-driven default (`.v2-num-col`: right;
    everything else: left, `_page_styles.html`) is completely unaffected,
    so this is a strict, zero-risk addition.

    COLUMN-COUNT MISMATCH POLICY (a real, decided trade-off, not an
    oversight): `column_alignments`' own length need not match the real
    resolved column count (a design might store 4 alignment entries but
    `table_style.columns` narrows the table to 2 real columns, or vice
    versa) — resolved by CYCLING the given list with `i % len(alignments)`
    for the i-th visible column, left-to-right in final display order
    (after narrowing/reordering). A shorter list simply repeats from its
    own start (e.g. 2 entries applied to 4 columns reuses entries 0,1,0,1);
    a longer list has its extra trailing entries silently unused. Chosen
    over two rejected alternatives: (a) index-matching against the
    ORIGINAL, unfiltered TABLE_COLUMNS order would silently misapply an
    alignment meant for one column to a completely different one the
    moment `columns` reorders anything; (b) falling back to the class-
    driven default for any out-of-range index would make a design's own
    explicit alignment choice partially disappear with no visible error —
    cycling at least guarantees every visible column gets SOME author-
    specified alignment when the author supplied any at all, which is the
    more predictable failure mode of the two.
    """
    requested = (table_style or {}).get('columns') or TABLE_COLUMNS
    seen = set()
    columns = []
    for key in requested:
        if key in TABLE_COLUMNS and key not in seen:
            columns.append(key)
            seen.add(key)
    if not columns:
        columns = list(TABLE_COLUMNS)

    alignments = (table_style or {}).get('column_alignments') or None

    total_default_width = sum(TABLE_COLUMN_DEFAULT_WIDTHS[key] for key in columns)
    return [
        {
            'key': key,
            'label': TABLE_COLUMN_LABELS[key],
            'width_pct': round(TABLE_COLUMN_DEFAULT_WIDTHS[key] / total_default_width * 100, 2),
            'align': alignments[i % len(alignments)] if alignments else None,
        }
        for i, key in enumerate(columns)
    ]


def _group_into_render_chains(elements):
    """
    Master Blueprint cutover (§B.3) — groups a page-element list (declared
    array order, never re-sorted) into render units:

      - A run of 2+ CONSECUTIVE elements that all declare
        `layout_mode: 'flow'` AND share an identical x/width (the same
        real convention design_templates.py already places genuinely-
        stacked content in — e.g. a totals block's Subtotal/Tax/Discount/
        Total rows, or a Notes section immediately followed by its own
        Terms section, share one column) is ONE real "chain" — content-
        driven growth for the whole group, via ordinary CSS document flow
        (a longer-than-expected member genuinely pushes the next one down
        through WeasyPrint's own real layout engine, not a fixed
        design-time gap).
      - A single `layout_mode: 'flow'` element with no compatible neighbor
        is still its own (length-1) chain, so it independently gets real
        auto-height instead of a fixed one (e.g. the mandatory table,
        whose declared height everywhere else in this codebase is
        documented as a design-time ESTIMATE only — this closes that gap
        for real invoice output specifically).
      - Any `pinned` element (the default, and every element that existed
        before this field did) is untouched — its own length-1 'single'
        group, rendered exactly as before.

    Deliberately does NOT reach across a `pinned` element in between, and
    deliberately does NOT push anything outside its own chain (a pinned
    sibling in a different column is never moved) — the scoped, honest
    trade-off the Master Blueprint's own §B.3 names explicitly, not a
    claim of universal reflow.
    """
    groups = []
    for el in elements:
        is_flow = el.get('layout_mode') == 'flow'
        if (
            is_flow and groups and groups[-1]['kind'] == 'chain'
            and groups[-1]['elements'][-1]['x'] == el['x']
            and groups[-1]['elements'][-1]['width'] == el['width']
        ):
            groups[-1]['elements'].append(el)
        elif is_flow:
            groups.append({'kind': 'chain', 'elements': [el]})
        else:
            groups.append({'kind': 'single', 'elements': [el]})
    return groups


def _render_chain_members_html(chain_elements, context, content_mode='real'):
    """
    Renders one real-flow chain's (see _group_into_render_chains above)
    real member content as ordinary, non-absolutely-positioned CSS
    document-flow children, each with a real `margin-top` computed from
    the GAP the original design_data declared between consecutive members
    (never a fixed constant) — so a member that renders taller than its
    own declared height pushes the next one down by exactly that much
    extra, and a member that renders exactly as expected reproduces the
    original design-time gap exactly (a genuine no-op for any chain whose
    real content matches its design-time estimate). Returns plain HTML —
    the caller (Pagination Fix cutover's own _prepare_flow_region, below)
    is responsible for the actual positioning wrapper (a real-flow-region
    flex item, not an absolutely-positioned box — see that function's own
    docstring for why).
    """
    members_html = []
    cursor_bottom = None
    for el in chain_elements:
        member = prepare_element(el, context, content_mode, chain_member=True)
        # Rounded to 2 decimal places (this codebase's own established mm
        # precision elsewhere) and floored at 0 — two design-time
        # y-values that are meant to be exactly adjacent can
        # differ by a floating-point epsilon (e.g. 2.8e-14) rather than
        # exact zero; left unrounded, that epsilon prints as invalid CSS
        # (scientific notation, e.g. "2.8e-14mm", which no CSS parser
        # accepts) instead of a harmless zero gap.
        gap_mm = 0.0 if cursor_bottom is None else round(max(0.0, el['y'] - cursor_bottom), 2)
        margin = f'margin-top:{gap_mm}mm;' if gap_mm else ''
        content_html = render_to_string('invoices/canonical/_element_content.html', {**context, 'el': member})
        members_html.append(f'<div class="v2-el v2-flow-chain-member" style="{member["css"]}{margin}">{content_html}</div>')
        cursor_bottom = el['y'] + el['height']
    return ''.join(members_html)


# Pagination fix (28 August 2026) — how close two chain-items' own starting
# y must be to be considered "the same row" (genuinely side-by-side content,
# e.g. Notes/Terms beside Payment Methods) rather than one stacked above the
# other. Reuses the same real, established tolerance OVERLAP_EPSILON_MM
# already absorbs for the identical reason (mm<->px<->mm canvas round-trip
# noise) would be too tight here — this is a real DESIGN-TIME author choice
# (two elements the designer deliberately placed at the same y), not
# rounding noise, so a slightly more generous 1.0mm tolerance is used.
ROW_Y_EPSILON_MM = 1.0


def _group_chain_items_into_rows(chain_items):
    """
    Second-level grouping, on top of _group_into_render_chains' own
    output: any two chain-items (single elements OR whole chains) whose
    own starting y lands within ROW_Y_EPSILON_MM of each other are
    genuinely side-by-side content (e.g. design_templates.py's own real
    Notes/Terms-beside-Payment-Methods layout) and become ONE real row,
    rendered as a flex container — this is what lets them sit next to
    each other while BOTH still participate in real, paginatable CSS
    document flow (see _prepare_flow_region's own docstring for why that
    matters). Matching is NOT dependent on array adjacency — two items far
    apart in design_data's own element list but sharing a y are still
    correctly grouped, matching the schema's own "position is truth, list
    order is not" convention (design_schema.py has never treated
    element list order as meaningful for anything other than serialization
    round-tripping).

    Returns rows sorted by their own real y (this is what determines
    actual top-to-bottom stacking order now that position is no longer
    literal page coordinates) — within a row, items are sorted by x
    (left-to-right, matching visual reading order).
    """
    rows = []
    for item in chain_items:
        item_y = item['elements'][0]['y']
        matched = next((r for r in rows if abs(r['y'] - item_y) <= ROW_Y_EPSILON_MM), None)
        if matched:
            matched['items'].append(item)
        else:
            rows.append({'y': item_y, 'items': [item]})
    rows.sort(key=lambda r: r['y'])
    for row in rows:
        row['items'].sort(key=lambda it: it['elements'][0]['x'])
    return rows


def _prepare_flow_region(flow_elements_raw, context, content_mode='real', *, header_height_mm=0.0):
    """
    Pagination fix (28 August 2026) — the real root-cause fix for genuine
    multi-page content loss (a real, previously-undiscovered, pre-existing
    defect: ANY content in this renderer's original all-absolutely-
    positioned architecture was confined to a single page's physical
    space, full stop — confirmed by direct, minimal, isolated reproduction
    independent of design_data, layout_mode, or any specific template;
    see the accompanying investigation for the exact experiments proving
    this and proving the fix below).

    Root cause, precisely: a `position: absolute` box's content is never
    fragmented across page boundaries by WeasyPrint (a real, correct
    implementation of the CSS Fragmentation spec, which excludes
    out-of-flow boxes from being fragmentation containers) — REGARDLESS of
    how tall its own or its ancestors' declared/CSS height is. The
    `layout_mode: 'flow'` chain mechanism (_group_into_render_chains,
    _render_chain_members_html) already correctly made a chain's own
    members grow to real content height via genuine CSS document flow —
    but the chain's own OUTER WRAPPER was still `position: absolute`,
    which silently capped the whole, otherwise-correctly-growing chain to
    page 1 regardless.

    The fix: EVERY flow-list element (chain or single, `flow` or `pinned`
    layout_mode alike) is now rendered inside a real, normal-flow "row" —
    a `display:flex` container that is itself an ordinary, non-absolutely-
    positioned block, stacking via real `margin-top` (computed from each
    row's own declared y minus the real previous row's bottom, exactly
    the same "reproduce the design-time gap unless real content grows
    past it" principle _render_chain_members_html already established for
    within-chain siblings — this is that same principle applied one level
    up, to the relationship between rows). Because the row containers are
    real, ordinary, in-flow boxes, WeasyPrint now correctly fragments them
    (and their real `<table>` content, and real overflowing text) across
    as many pages as the real content actually needs — proven directly:
    a normal `<table>` and a normal paragraph both fragment correctly
    across pages when placed in real document flow, and do NOT when
    placed inside a `position:absolute` ancestor, regardless of that
    ancestor's own declared height.

    A `pinned` single element becomes a length-1 row whose flex item gets
    an explicit CSS height (matching its declared height exactly — it
    never grows); a `flow`-mode chain's own items get no fixed height at
    all (real auto-height, exactly as _render_chain_members_html already
    produces internally). Side-by-side content (e.g. Notes/Terms beside
    Payment Methods) becomes a real multi-item flex row via
    _group_chain_items_into_rows, each item's own `margin-left` computed
    from its real x-offset from whatever sits to its own left in the same
    row (first item's margin-left is simply its own x, since row-relative
    x=0 is the content area's own left edge).

    This is a byte-for-byte no-op for any design whose real content
    matches its design-time geometry exactly (every existing golden test)
    — the same margin-reproduces-the-original-gap principle that already
    made the chain mechanism itself provably a no-op is now applied
    consistently at the row level too. It requires zero schema change:
    every element's x/y/width/height keeps its existing meaning
    (design-time position/size); only how the RENDERER turns that
    geometry into CSS changed, from "literal absolute page coordinates"
    to "relative document-flow order and spacing, derived from the exact
    same numbers".

    Deliberately UNCHANGED by this fix: the editor canvas
    (design_canvas.py), which keeps rendering every flow element via
    its own simple, ungrouped, absolutely-positioned design-time preview
    — the same established "the canvas is a fixed, approximate design-
    time estimate; the canonical renderer alone applies real, content-
    driven layout at actual render time" principle this codebase already
    uses for the table's own height estimate, now extended to real
    pagination too.
    """
    # Green-Light directive (§18-22) — "missing data must not create ugly
    # empty spaces." Row/chain GROUPING always uses the ORIGINAL, full
    # (unfiltered) element list — a row's own anchor position (and which
    # elements share a row) must never depend on which of them happen to
    # have real content this time, or side-by-side grouping itself would
    # become unstable. Each chain-item ALSO carries a `visible_elements`
    # list (real-content-only) computed once here via
    # _element_has_real_content — this is what RENDERING actually uses.
    # A chain like [Notes(empty), Terms(has content)] keeps its real ROW
    # anchor at Notes' own declared y (so Terms visually moves UP to
    # occupy the space Notes would have used, rather than staying pinned
    # to its own further-down declared position) while its INTERNAL
    # member walk (_render_chain_members_html) only ever sees Terms —
    # the first (and only) visible member always gets margin-top=0,
    # i.e. it starts right at the row's own top, exactly the outcome
    # "Terms moves up" requires.
    chain_items = []
    for group in _group_into_render_chains(flow_elements_raw):
        first = group['elements'][0]
        chain_items.append({
            'x': first['x'], 'width': first['width'], 'y': first['y'],
            'is_flow_chain': group['kind'] == 'chain',
            'elements': group['elements'],
            'visible_elements': [el for el in group['elements'] if _element_has_real_content(el, context, content_mode)],
        })

    rows_out = []
    # The flow region is a real, normal-flow sibling immediately AFTER the
    # header region (see canonical.html) — its own internal top edge
    # corresponds to content-area-absolute `header_height_mm`, NOT 0. Every
    # element's x/y is measured from the SAME content-area origin
    # regardless of whether it's a header or flow element (unchanged
    # convention, predating this fix) — so the very first flow row's own
    # margin-top must close the real gap between the header's bottom and
    # that row's own declared y, exactly like every subsequent row already
    # does relative to the row before it. Omitting this (starting from an
    # implicit 0 instead) was a real, confirmed bug in this fix's own
    # first draft — found via test_design_templates_golden.py's own golden-
    # position tests, which measured every flow element rendering
    # `header_height_mm` too high (e.g. Professional: the table rendering
    # ~11mm above its real, intended position).
    previous_row_bottom_mm = header_height_mm
    for row in _group_chain_items_into_rows(chain_items):
        # A chain/single item with ZERO real content contributes nothing —
        # not its declared height, not its own margin, nothing. If EVERY
        # item in this row is empty (e.g. Notes+Terms+Payment Info all
        # blank at once), the entire row is dropped and never touches
        # `previous_row_bottom_mm`, so the NEXT real row's own margin-top
        # is computed relative to whatever last genuinely rendered —
        # never leaving a reserved-but-invisible gap behind.
        visible_items = [item for item in row['items'] if item['visible_elements']]
        if not visible_items:
            continue

        row_top_mm = row['y']
        margin_top_mm = round(max(0.0, row_top_mm - previous_row_bottom_mm), 2)

        items_out = []
        cursor_right_mm = 0.0
        row_bottom_mm = row_top_mm
        for item in visible_items:
            margin_left_mm = round(max(0.0, item['x'] - cursor_right_mm), 2)
            if item['is_flow_chain']:
                content_html = _render_chain_members_html(item['visible_elements'], context, content_mode)
                height_mm = None  # real auto-height — the whole point of a flow chain
            else:
                el = item['visible_elements'][0]
                prepared = prepare_element(el, context, content_mode, chain_member=True)
                content_html = render_to_string('invoices/canonical/_element_content.html', {**context, 'el': prepared})
                content_html = f'<div class="v2-el" style="{prepared["css"]}">{content_html}</div>'
                height_mm = el['height']  # pinned — never grows

            items_out.append({'width_mm': item['width'], 'margin_left_mm': margin_left_mm, 'height_mm': height_mm, 'content_html': content_html})
            cursor_right_mm = item['x'] + item['width']
            item_declared_bottom = max(el['y'] + el['height'] for el in item['visible_elements'])
            row_bottom_mm = max(row_bottom_mm, item_declared_bottom)

        rows_out.append({'margin_top_mm': margin_top_mm, 'items': items_out})
        previous_row_bottom_mm = row_bottom_mm

    return rows_out


def _prepare_header_region(header_elements_raw, context, content_mode='real'):
    """
    The header region stays exactly as it always has: absolutely
    positioned, free-form 2D placement (never a simple top-to-bottom
    stack the way flow content is) — real header content (business name,
    dates, client info) is bounded/short by this whole system's own
    long-standing convention, so it never needs real pagination, and
    forcing it through the same row/flex mechanism flow content now uses
    would actively break its intentionally free-form layout (elements at
    deliberately close but different y values, e.g. an eyebrow label
    directly above a business name, are NOT "the same row" the way two
    side-by-side flow elements are). Returns (header_height_mm, prepared
    elements) — header_height_mm is the real, computed bottom edge of the
    tallest header element, used to size the header's own real, in-flow
    (not absolutely-positioned) wrapper box so it correctly pushes the
    flow region below it.

    Green-Light directive (§18-22, specifically §22's header case) —
    an element with no real content (e.g. a blank client phone/address
    bound field, a logo when none is configured) is simply not rendered
    at all — no empty box, no visible artifact — since header elements
    never push each other (free-form absolute placement, unlike flow's
    stacking model), skipping one is always safe and never disturbs any
    other header element's own position. `header_height_mm` itself is
    computed from VISIBLE elements only, so the header's own reserved
    box (and therefore where the flow region starts) correctly shrinks
    in the rare case where the single tallest header element happens to
    be the one with no real content.
    """
    visible = [el for el in header_elements_raw if _element_has_real_content(el, context, content_mode)]
    prepared = [prepare_element(el, context, content_mode) for el in visible]
    header_height_mm = max((el['y'] + el['height'] for el in visible), default=0.0)
    return header_height_mm, prepared


def render_design_html(design_data, context, *, for_pdf=False):
    """
    The one canonical V2 renderer. Validates design_data against the real
    v2 structural schema first (a schema-invalid payload is a hard,
    explicit DesignRenderError — never a silent blank/partial render), then
    renders unconditionally — no seed-equality branch, no "was this
    edited" check, no template-identity check. See this module's own
    docstring for why that absence is the point, not an oversight.

    `context` is whatever build_render_context() below produces:
    real `invoice` and `freelancer` objects, `qr_code_data_uri`, and the
    resolved `design_primary_color`/`design_secondary_color`. `for_pdf`
    selects file:// font URIs (FONT_CONTEXT, for WeasyPrint) vs. /static/
    URLs (PORTAL_FONT_CONTEXT, for a browser-rendered HTML response) —
    the exact same real, already-correct, environment-safe asset
    mechanism apps/invoices/pdf_generator.py already established for
    every other real render path (Part 9's own requirement: no new,
    hardcoded-localhost asset strategy is introduced here).
    """
    errors = validate_design_data_schema_v2(design_data)
    if errors:
        raise DesignRenderError('design_data failed v2 schema validation: ' + '; '.join(errors))

    # Phase 3a (07 September 2026) — font theming. `design_data.theme`
    # (optional, absent for every existing design) is resolved into the
    # SAME `context` dict every element-preparation call below already
    # threads through (the same place `design_primary_color`/
    # `design_secondary_color` already live) — `resolve_theme_font_family`/
    # `resolve_theme_font_weight` read these 4 keys back out again. Absent
    # theme -> every value here is None -> `if font:`/`if font_weight:`
    # guards in prepare_element simply skip emitting anything, matching
    # today's behavior exactly.
    theme = design_data.get('theme') or {}
    context = {
        **context,
        'theme_heading_font_family': theme.get('heading_font_family'),
        'theme_heading_font_weight': theme.get('heading_font_weight'),
        'theme_body_font_family': theme.get('body_font_family'),
        'theme_body_font_weight': theme.get('body_font_weight'),
    }

    page = design_data['page']
    # Pagination fix (28 August 2026) — header.elements and flow.elements
    # are read SEPARATELY again here (Phase 4B.2 had merged them into one
    # flat list for positioning purposes, since both used absolute
    # coordinates identically) — see _prepare_header_region's own
    # docstring for exactly why: header content genuinely needs free-form
    # 2D absolute placement (never pagination), while flow content needs
    # real document-flow stacking (to genuinely paginate). The schema
    # itself is completely unchanged — `header`/`flow` were always two
    # separate arrays; only this renderer's OWN internal treatment of
    # that existing split changed.
    header_elements_raw = design_data['header']['elements']
    flow_elements_raw = design_data['flow']['elements']

    # Phase 2 additions — all optional, all falling back to Phase 1's
    # original constants when absent, so an already-migrated v2 design
    # (which never sets any of these) renders exactly as it did before
    # this phase. See design_schema.py's own _validate_page docstring
    # for the full "why" (measured, per-template real geometry).
    margin_top_mm = page.get('margin_top_mm', PAGE_MARGIN_TOP_MM)
    margin_right_mm = page.get('margin_right_mm', PAGE_MARGIN_RIGHT_MM)
    margin_bottom_mm = page.get('margin_bottom_mm', PAGE_MARGIN_BOTTOM_MM)
    margin_left_mm = page.get('margin_left_mm', PAGE_MARGIN_LEFT_MM)
    sidebar = page.get('sidebar')
    sidebar_width_mm = sidebar['width_mm'] if sidebar else 0
    # 30 August 2026 — optional, additive `page.spine` (the same pattern
    # `page.sidebar` already established: absent for every existing
    # design, so this is fully backward-compatible). Renders a real,
    # full-page-height decorative bar bled to the true left page edge —
    # Professional's own golden static template's real `.spine` element,
    # which the V2 canonical render never reproduced at all until now
    # (a real, confirmed fidelity gap). Deliberately NOT added to
    # design_schema.py's own formal validation (which already tolerates
    # unrecognized `page` keys, confirmed directly — no "extra keys
    # rejected" check exists) or to design_canvas.py's editor — scoped
    # exactly to what this pass asked for (the real render output), not
    # silently expanded into editor support, which would be a real,
    # separate, larger feature.
    # 30 August 2026 fidelity fix — each real template's own genuinely
    # different page background (#faf9f6 professional / #fdfdfb minimal /
    # #ffffff modern) was silently flattened to one hardcoded #ffffff
    # shared across all three in the canonical renderer's own stylesheet.
    # Optional, additive `page.background_color` (absent = the existing
    # #ffffff default, so this is fully backward-compatible), same
    # pattern as spine/sidebar above.
    background_color = page.get('background_color', '#ffffff')
    footer = page.get('footer')
    # Phase 1 — a real @page bottom margin is only ever reserved when a
    # footer is actually configured; every existing design (no page.footer
    # key at all) keeps the exact `margin:0` / full-page-height body it
    # already renders with, byte-for-byte. `.v2-content`'s own min-height
    # is reduced by the same amount so a short, otherwise-single-page
    # design doesn't overflow onto a spurious page 2 purely because its
    # declared min-height now exceeds what one page's shrunken content
    # box actually holds — confirmed against a real WeasyPrint render,
    # not assumed (see DECISIONS.md).
    footer_margin_mm = FOOTER_MARGIN_BOX_HEIGHT_MM if footer else 0
    content_min_height_mm = page['height_mm'] - footer_margin_mm
    footer_style = {**FOOTER_STYLE_DEFAULTS, **(footer.get('style') or {})} if footer else None
    if footer_style:
        # Font theme-linking retrofit — the footer used to have its own,
        # earlier, separate style validation (design_schema._validate_footer)
        # that never resolved the Phase 3a 'theme_heading_font'/
        # 'theme_body_font' sentinels at all (only design_schema.py's fix
        # even allows them through validation now) — a theme-linked footer
        # font previously fell straight through to the template as the
        # LITERAL sentinel string, `font-family: 'theme_body_font';`, never
        # the design's real resolved theme font. Retrofitted onto the exact
        # same resolve_theme_font_family/resolve_theme_font_weight functions
        # every ordinary element's `style.font`/`style.font_weight` already
        # goes through above (prepare_element) — not a second, parallel
        # font-theme mechanism. A no-op for every existing footer (a
        # literal font_family string, or the default None font_weight).
        footer_style['font_family'] = resolve_theme_font_family(footer_style['font_family'], context)
        footer_style['font_weight'] = resolve_theme_font_weight(footer_style['font_weight'], context)
    footer_wordmark_data_uri = None
    if footer and footer_style['show_wordmark'] and _is_premium_branding_enabled(context['freelancer']):
        footer_wordmark_data_uri = _generate_wordmark_data_uri(footer_style['text_color'])
    # Real WeasyPrint limitation (confirmed directly, same finding
    # professional.html's own @page block already documents): there is no
    # `@page :first:last` / "exactly one page" CSS selector, so whether to
    # even show a "Page X of N" counter can only be decided from a REAL
    # rendered page count — never guessed from content length. Callers
    # that already know (render_design_pdf_bytes' own 2-pass render, or
    # pdf_generator.render_invoice_pdf's identical mandatory sequencing
    # for the static templates) set this in `context`; any other caller
    # (a browser-rendered portal/preview HTML view, where `@page` margin
    # boxes have no visual effect at all) safely defaults to False.
    single_page_layout = bool(footer and context.get('single_page_layout', False))
    spine = page.get('spine')
    spine_color = resolve_theme_color(spine.get('color'), context) if spine else None
    spine_accent_color = spine.get('accent_color') if spine else None
    # A sidebar's own width is a real, additional left offset for the
    # main content column — matching modern.html's own real CSS
    # (`.main { margin-left: 42mm; padding: ... 16mm; }`, i.e. the
    # sidebar width PLUS the ordinary left padding, not one or the other).
    effective_margin_left_mm = margin_left_mm + sidebar_width_mm

    content_width_mm = page['width_mm'] - effective_margin_left_mm - margin_right_mm

    # Sidebar-flagged elements render in a separate, fixed, full-page-
    # height column — never stacked into the ordinary content flow. This
    # mirrors v1's own pre-existing, already-correct zone1-page-vs-sidebar
    # distinction (apps/invoices/design_renderer.py's
    # _prepare_zone1_elements) — generalized to V2, not newly invented.
    # Sidebar filtering still applies within EACH of header/flow
    # separately (Modern's real seed has sidebar-flagged elements in
    # both — its logo/business-name in `header`, its QR/pay-online in
    # `flow` — this is unchanged from before this fix).
    header_page_elements_raw = [el for el in header_elements_raw if not is_sidebar_element(el)]
    flow_page_elements_raw = [el for el in flow_elements_raw if not is_sidebar_element(el)]
    sidebar_elements_raw = [
        el for el in header_elements_raw + flow_elements_raw if is_sidebar_element(el)
    ]

    # content_mode is never threaded through this function or its
    # callers (render_design_pdf_bytes) — real invoice/PDF/portal
    # output has no code path that could ever pass anything but
    # prepare_element's own 'real' default (see ALIAS_BINDING_LABELS'
    # comment above for why that's a structural guarantee, not a
    # convention). Only design_canvas.py's editor-facing endpoints
    # call prepare_element directly with content_mode='alias'.
    header_height_mm, header_elements = _prepare_header_region(header_page_elements_raw, context)
    flow_rows = _prepare_flow_region(flow_page_elements_raw, context, header_height_mm=header_height_mm)
    sidebar_elements = [prepare_element(el, context) for el in sidebar_elements_raw]

    font_context = FONT_CONTEXT if for_pdf else PORTAL_FONT_CONTEXT

    template_context = {
        'page_width_mm': page['width_mm'],
        'page_height_mm': page['height_mm'],
        'margin_top_mm': margin_top_mm,
        'margin_right_mm': margin_right_mm,
        'margin_bottom_mm': margin_bottom_mm,
        'margin_left_mm': effective_margin_left_mm,
        'content_width_mm': content_width_mm,
        'header_height_mm': header_height_mm,
        'header_elements': header_elements,
        'flow_rows': flow_rows,
        'sidebar': sidebar,
        'sidebar_width_mm': sidebar_width_mm,
        'sidebar_elements': sidebar_elements,
        'spine': spine,
        'spine_color': spine_color,
        'spine_accent_color': spine_accent_color,
        'page_background_color': background_color,
        'content_min_height_mm': content_min_height_mm,
        'footer': footer,
        'footer_style': footer_style,
        'footer_margin_mm': footer_margin_mm,
        'footer_wordmark_data_uri': footer_wordmark_data_uri,
        'single_page_layout': single_page_layout,
        'invoice': context['invoice'],
        'freelancer': context['freelancer'],
        'qr_code_data_uri': context.get('qr_code_data_uri'),
        'design_primary_color': context.get('design_primary_color', '#1a2b42'),
        'design_secondary_color': context.get('design_secondary_color', '#a8813c'),
        **font_context,
    }
    return render_to_string('invoices/canonical/canonical.html', template_context)


def render_design_pdf_bytes(design_data, context):
    """
    Real PDF bytes via WeasyPrint — same library, same bare `HTML(string=...)
    .write_pdf()` call convention apps/invoices/pdf_generator.py's own real
    PDF generation already uses (no base_url needed: FONT_CONTEXT's file://
    URIs are already absolute). WeasyPrint is imported inside this function,
    not at module load time — matching this codebase's own established,
    deliberate practice (see CLAUDE.md Section 8c) of deferring this import
    to avoid a confirmed macOS-specific fork-safety issue when this module
    is imported by a Celery worker process before any fork occurs. Nothing
    in Phase 1 wires this function into any Celery task, so the risk this
    practice guards against doesn't currently apply here either way — but
    following the same convention costs nothing and avoids reintroducing a
    real, previously-fixed class of bug if a later phase ever does.

    Phase 1 (rotation/ellipse/footer/crop, 07 September 2026) — a design
    with `page.footer` configured now goes through the same MANDATORY SAFE
    ORDER pdf_generator.render_invoice_pdf's own docstring establishes for
    the 3 static templates' identical "Page X of N" problem: page count
    must always come from a natural-flow render first, never guessed or
    assumed. (1) Render once assuming multi-page (`single_page_layout`
    unset/False, the counter markup present); read the REAL page count
    off WeasyPrint's own `Document.pages`. (2) Only if that count is
    exactly 1, re-render the SAME design_data/context with
    `single_page_layout=True` (the counter omitted) and use THAT as final
    output — never rendered a third time, and never applied to a
    confirmed multi-page document. A design with no footer at all skips
    this entirely (single render, unchanged performance) — there is
    nothing page-count-dependent to decide in that case.
    """
    from weasyprint import HTML

    footer = (design_data.get('page') or {}).get('footer')
    if not footer:
        html_string = render_design_html(design_data, context, for_pdf=True)
        return HTML(string=html_string).write_pdf()

    context = {**context, 'single_page_layout': False}
    html_string = render_design_html(design_data, context, for_pdf=True)
    document = HTML(string=html_string).render()

    if len(document.pages) == 1:
        context = {**context, 'single_page_layout': True}
        html_string = render_design_html(design_data, context, for_pdf=True)
        document = HTML(string=html_string).render()

    return document.write_pdf()


def build_render_context(user, base_template, color_variant, invoice=None):
    """
    Builds the (invoice, freelancer, colors, qr) context render_design_html
    needs. Reuses apps.invoices.design_preview.build_preview_context's
    real, already-tested sample-invoice/real-profile assembly rather than
    inventing a second sample-data mechanism — the exact same real data
    the existing gallery preview cards already show a user. When a real
    `invoice` is supplied, it replaces the sample one (and its own QR is
    regenerated from its own real payment_page_url) — but the freelancer
    profile and resolved colors are always fetched fresh, never trusted
    from a caller-supplied value.
    """
    from apps.invoices.design_preview import build_preview_context

    context = dict(build_preview_context(user, base_template, color_variant))
    if invoice is not None:
        context['invoice'] = invoice
        context['qr_code_data_uri'] = _generate_qr_data_uri(invoice.payment_page_url)
    return context
