# apps/invoices/design_templates.py
"""
The production builtin seeds — genuine canonical reconstructions of the 3
real built-in templates (professional.html/minimal.html/modern.html),
kept structurally separate from legacy_design_schema's own
`design_seeds.BUILTIN_DESIGNS` (the retired zone_1/zone_2 shape).
`design_duplicate` (apps/invoices/views.py) creates every new "Use this
template" InvoiceDesign row from `BUILTIN_DESIGNS` below, and
`get_blank_design_data` (also here) backs the editor's "start blank"
mode — both produce schema_version 2 design_data from the moment of
creation, with no separate migration step ever needed for a brand-new
design.

Phase 4B.2 rewrite — full free-form unification (see design_schema.py's
own module docstring for the full architectural reasoning). Every flow
element below now carries the SAME real `x`/`y`/`width`/`height` shape a
header element already has, in place of the old `spacing_after_previous`
+ `paired_side_by_side` stacking mechanism (both removed from the schema
entirely — a user now positions two elements side by side simply by
giving them adjacent `x` values, no special pairing construct needed).
The mandatory line-items table is now a real, positioned
`kind:'structural', type:'table'` element within `flow.elements` (no
longer a special `flow.table` key) — see this module's own
`_TABLE_HEIGHT_ESTIMATE_MM` comment for the one genuine, documented
trade-off this promotion carries: the table's `height` here is a
design-time ESTIMATE only (based on a fixed 3-sample-row convention,
matching the canvas editor's own existing preview convention), never the
table's true rendered height for a real invoice, which is content-driven
(however many real line items actually exist) and can exceed this
estimate for a large invoice. This is a genuine, inherent limitation of
true free-form positioning applied to a dynamic-height object — stated
here plainly, not hidden — and is no different in kind from what any
real design tool (Figma, Canva) does with a dynamic-height element.

Every flow element's new `x`/`y` below was derived by two combined
methods, both documented directly at each seed's own comments: (1) the
OLD real spacing chain (each element's old `spacing_after_previous` value,
walked cumulatively from a design-time-estimated table bottom edge) as a
first-pass geometry, then (2) DIRECT CALIBRATION against the real golden
templates — this module's own sibling test file,
test_design_templates_golden.py, measures real rendered text positions
from the actual, unmodified static templates with PyMuPDF and compares
them (within a documented tolerance) to this V2 reconstruction's own
rendered output; the `totals`/`signature` elements' exact `y` values below
were adjusted directly against that real, measured comparison (not left
as untested guesses) — see DECISIONS.md's Phase 4B.2 entry for the
specific before/after measurements this calibration used.

Phase 4B's field-level decomposition (business_info/client_info/dates
split into one generic `text` element per real field, payment_info's
`qr_and_link` variant split into independent `qr_code`/
`online_payment_link` elements) is unchanged by this phase — see the
prior version of this docstring, preserved in git history, for that
reasoning.

Phase 4B.3 rewrite (LANCERAOS_TEMPLATE_BUILDER_2_PHASE4B2_AUDIT.md findings
C1–C4) — two real, independent problems, fixed together because fixing one
correctly resolves the other:

  1. **Overflow (finding C2)**: `notes` and `payment_info`'s previous
     declared heights (24mm / 27mm) were smaller than their own real
     rendered content (measured directly, alias mode, via real DOM
     `scrollHeight`: ~30.7mm / ~41.8mm) and were placed edge-to-edge with
     whatever followed — a real, visible collision present in the
     default, unedited state of all 3 templates, confirmed live and
     accepted as a genuine defect (not a documented trade-off — unlike
     the table, above, `notes`/`payment_info`'s real content length is
     fully knowable at design time, not invoice-dependent).
  2. **Bundling (finding C3)**: Subtotal/Tax/Discount/Total were one
     indivisible `totals` element; Notes/Terms were one indivisible
     `notes` element — despite `design_schema.SUPPORTED_BINDINGS`
     already carrying individual bindings for every one of these 6
     fields (`invoice.subtotal`/`.tax_amount`/`.discount_amount`,
     `totals.grand_total`, `invoice.notes`, `invoice.terms`).

  Decomposing each bundle into its own independently positioned element —
  `totals` narrowed to exactly one row via its own pre-existing
  `style.rows` filter (zero renderer changes: `resolve_table_columns`'s
  sibling mechanism `totals_rows` already generically supports any subset)
  and `notes` narrowed to exactly one section via the new
  `style.sections` filter (design_renderer.py, `_v2_element_content.html`
  — the direct `rows`-pattern equivalent for notes, added because no
  such filter existed yet for it) — makes every real content block its
  own genuinely correctly-sized element, which is what actually resolves
  the overflow: each new element is sized to ITS OWN real, measured
  content (verified live via real DOM `scrollHeight`, not estimated),
  with a real, deliberate, non-zero gap (2–4mm) to whatever follows,
  never edge-to-edge again. `logo`/`signature`/`payment_info` remain
  single composite semantic elements — for `payment_info` specifically,
  a deliberate decision after investigation (see the same audit's finding
  C4 and this file's own MODERN/PROFESSIONAL/MINIMAL sections below for
  the full reasoning): its 5 real sub-fields (bank/JazzCash/Easypaisa/
  Payoneer) are COLLECTIVELY, independently optional in a way Subtotal/
  Tax/Discount/Total never are — the template's own real per-method AND
  whole-block conditional visibility is genuine, load-bearing behavior
  that 5 always-rendered independent elements would break. Its own
  overflow (an unconditional, deliberate worst-case: alias mode always
  shows all 4 sample methods) is still fixed — via a corrected height,
  not decomposition.

No hardcoded sample invoice values appear anywhere below — every
semantic AND generic-with-binding element resolves real invoice/business/
client data at render time (or, in the editor's alias content mode, a
fixed semantic label — never literal test-account data), exactly like the
original static templates and like every other real InvoiceDesign in this
system.
"""
import copy
import json
import os

SCHEMA_VERSION_V2 = 2

# Green-Light directive follow-up (Part 3, "blank design richness") — the
# rich, collision-verified content `get_blank_design_data` seeds a blank
# design with, sourced from the frontend's own real default template
# (design-editor-v2's `initialTemplateState`/elementCatalog.js, "every
# catalog element present, user removes what they don't want") rather than
# a second, hand-authored Python approximation of the same idea. Generated
# by frontend/scripts/js/dump_blank_design_elements.mjs, which runs the
# ACTUAL frontend adapter (templateToDesignData) against the ACTUAL
# frontend default template and dumps its real output — the reverse-
# direction sibling of frontend/scripts/py/dump_fixtures.py (that script
# goes Python -> JS test fixtures; this file is consumed the other way,
# JS -> this real runtime seed). Checked in, never hand-edited (its own
# `_generated_by` field records the exact command); regenerate by re-
# running that script whenever the frontend's own default layout changes
# — there is no automatic drift check beyond that discipline, the same
# trust model this codebase already accepts for dump_fixtures.py's own
# generated output.
_BLANK_DESIGN_RICH_ELEMENTS_PATH = os.path.join(os.path.dirname(__file__), 'data', 'blank_design_rich_elements.json')
_blank_design_rich_elements_cache = None


def _load_blank_design_rich_elements():
    """
    Lazily loads and caches the JS-generated rich element set (see this
    module's own header comment above). A fresh deep copy is handed back
    on every call — same "never a shared mutable value" contract every
    other seed-returning function in this file already has — so nothing
    a caller does to the result can mutate what a LATER call sees.
    """
    global _blank_design_rich_elements_cache
    if _blank_design_rich_elements_cache is None:
        with open(_BLANK_DESIGN_RICH_ELEMENTS_PATH) as f:
            data = json.load(f)
        _blank_design_rich_elements_cache = {'header': data['header'], 'flow': data['flow']}
    return copy.deepcopy(_blank_design_rich_elements_cache)


def _content_width_mm_for_page(page):
    """
    Reproduces design_schema.py's own `_validate_page_bounds` content-width
    formula exactly (margin_left + margin_right + sidebar reservation) —
    the real bound a blank design's rescaled rich content must fit inside,
    not the raw page width. Mirrors apps/invoices/ai_design.py's own
    identically-named/identically-reasoned `_content_width_mm` helper (not
    imported directly — that module's version is scoped to its own
    header-density-scaling use case and default-margin fallbacks; this one
    is intentionally simpler, since every BUILTIN_DESIGNS page dict always
    sets its own real margin_*_mm explicitly).
    """
    sidebar = page.get('sidebar')
    sidebar_width_mm = sidebar['width_mm'] if sidebar else 0
    effective_margin_left_mm = page['margin_left_mm'] + sidebar_width_mm
    return page['width_mm'] - effective_margin_left_mm - page['margin_right_mm']


def _scale_elements_to_fit(elements, content_width_mm):
    """
    Uniform-scale-from-origin, the same overlap-safety technique
    apps/invoices/ai_design.py's `_safe_uniform_scale` already established
    for this exact class of problem (rescaling a whole, already collision-
    verified element set to fit a narrower real template without
    independently repositioning — and therefore never independently
    re-overlapping — any single element). That helper only ever scales
    UP (requested_scale > 1.0); this one only ever scales DOWN (or leaves
    alone), since the frontend's own default template is authored against
    a generic, zero-margin 210mm-wide canvas — genuinely wider than every
    real base_template's own actual content_width_mm once real margins
    (and, for Modern, its real 42mm sidebar reservation) are subtracted.
    A single scale factor, computed from the single widest real right edge
    across the WHOLE set (header + flow together — design_schema.py's own
    `_validate_page_bounds` bounds both regions against the identical
    content_width_mm, confirmed directly), applied to x/y/width/height of
    every element identically. Y is deliberately scaled too (not left
    alone) purely to keep proportions faithful to the original layout —
    `_validate_page_bounds` itself only ever bounds the X axis, never Y
    (see that function's own docstring), so this is a fidelity choice, not
    a validation requirement.
    """
    if not elements:
        return elements
    max_right_edge = max(el['x'] + el['width'] for el in elements)
    if max_right_edge <= 0:
        return elements
    scale = min(1.0, content_width_mm / max_right_edge)
    if scale >= 1.0:
        return elements
    for el in elements:
        el['x'] = round(el['x'] * scale, 2)
        el['y'] = round(el['y'] * scale, 2)
        el['width'] = round(el['width'] * scale, 2)
        el['height'] = round(el['height'] * scale, 2)
    return elements

# Phase 4B.3 — real, measured (not estimated) alias-mode content heights,
# each confirmed via live DOM `scrollHeight` against the real backend
# render (`render_canvas_element_content`), the same real content the
# editor always shows. Named constants, not inlined numbers, so every
# seed's own arithmetic below is traceable back to a real measurement.
_TOTALS_ROW_HEIGHT_MM = 7.7          # a plain .v2-row (Subtotal/Tax/Discount), any template
_TOTALS_DUE_ROW_HEIGHT_MM = 13.5     # Professional/Modern's plain .v2-row-due "Total due" row
_TOTALS_PILL_HEIGHT_MM = 16.5        # Modern's .v2-total-pill "Total" display
# Minimal's .v2-total-due-amt (34pt) wraps to 2 lines at the original 62mm
# column width — real alias text ("Total Amount") is wider than typical
# real currency text ever is at that font size, confirmed directly by
# measuring the SAME fragment at increasing widths (41.3mm at 62mm/70mm/
# 80mm; 23.3mm — a single line — at 90mm+). Widened rather than heightened,
# since a 41mm-tall element for one number is a worse real design outcome
# than a slightly wider column; right-aligned against the same real
#174mm content-width right edge every other totals row already uses.
_TOTALS_DUE_DISPLAY_HEIGHT_MM = 24.0
_TOTALS_DUE_DISPLAY_WIDTH_MM = 95.0
_NOTES_SECTION_HEIGHT_MM = 12.4      # one Notes-only or Terms-only section, either template
_PAYMENT_INFO_HEIGHT_MM = 44.0       # payment_info, all 4 alias-mode methods (the real worst case)


def _totals_row(x, y, width, row, *, align='right', variant=None, extra_style=None):
    """
    One narrowed `totals` element showing exactly one real row — Phase
    4B.3's own decomposition mechanism (see this module's own docstring).

    Master Blueprint cutover (§B.3): `layout_mode: 'flow'` — every real
    totals row shares its column's exact x/width with its siblings, so
    design_renderer._group_into_render_chains groups all of them (for
    a given template) into one real chain: a row whose actual amount
    renders taller than its own declared estimate (an unusually large
    tax/discount/total) pushes the NEXT row down for real, at canonical
    render time, instead of silently overlapping it — same documented
    design-time-estimate-vs-real-render-time trade-off as the table's own
    _TABLE_HEIGHT_ESTIMATE_MM.
    """
    style = {'align': align, 'rows': [row]}
    if variant:
        style['variant'] = variant
    if extra_style:
        style.update(extra_style)
    return {
        'kind': 'semantic', 'type': 'totals', 'x': x, 'y': y,
        'width': width, 'height': {
            'subtotal': _TOTALS_ROW_HEIGHT_MM, 'tax': _TOTALS_ROW_HEIGHT_MM, 'discount': _TOTALS_ROW_HEIGHT_MM,
            'total': (
                _TOTALS_DUE_DISPLAY_HEIGHT_MM if variant == 'total_due_display'
                else _TOTALS_PILL_HEIGHT_MM if variant == 'total_pill'
                else _TOTALS_DUE_ROW_HEIGHT_MM
            ),
        }[row],
        'style': style, 'overrides': {}, 'layout_mode': 'flow',
    }


def _notes_section(x, y, width, section):
    """
    One narrowed `notes` element showing exactly its Notes-only or
    Terms-only half — Phase 4B.3's own new `style.sections` filter.

    Master Blueprint cutover (§B.3): `layout_mode: 'flow'` — Notes and
    Terms share the same x/width and are declared consecutively, so they
    form one real chain: unusually long real notes/terms text pushes the
    other section down for real at canonical render time, rather than
    silently overlapping it (the class of overflow Phase 5.3/5.4 first
    documented and only partially mitigated with CSS/warnings).
    """
    return {
        'kind': 'semantic', 'type': 'notes', 'x': x, 'y': y, 'width': width, 'height': _NOTES_SECTION_HEIGHT_MM,
        'style': {'sections': [section]}, 'overrides': {}, 'layout_mode': 'flow',
    }

# Shared, small style presets so every seed's decomposed section-label
# text looks like the real dedicated CSS class it's replacing
# (.v2-eyebrow / .v2-label) without re-typing the same 4 keys 9 times.
_EYEBROW_STYLE = {
    'font': 'IBM Plex Mono', 'font_size_pt': 7.5, 'letter_spacing_em': 0.22,
    'text_transform': 'uppercase', 'color': 'theme_primary',
}


def _section_label_style(align='left'):
    return {
        'font': 'IBM Plex Mono', 'font_size_pt': 7.5, 'letter_spacing_em': 0.16,
        'text_transform': 'uppercase', 'color': 'theme_primary', 'align': align,
    }


def _static_text(x, y, width, height, text, style):
    return {
        'kind': 'generic', 'type': 'text', 'x': x, 'y': y, 'width': width, 'height': height,
        'style': {**style, 'text': text}, 'overrides': {}, 'binding': None,
    }


def _bound_text(binding, x, y, width, height, style):
    return {
        'kind': 'generic', 'type': 'text', 'x': x, 'y': y, 'width': width, 'height': height,
        'style': style, 'overrides': {}, 'binding': binding,
    }


def _divider(x, y, width, thickness_mm, color):
    """
    30 August 2026 fidelity fix — the real golden static templates'
    `<hr class="rule">` (a real, visible divider between the header and
    the Bill-to/table content) was completely absent from the V2
    canonical render. `type:'divider'` is a pre-existing, already-
    implemented generic schema type (design_renderer.py's own
    attach_generic_content/`_element_content.html`) — this was never a
    renderer gap, only a seed-content gap. A thin, near-zero declared
    height (1mm) — the real visible mark is `shape_css`'s own
    `border-top`, not the element's own box height.
    """
    return {
        'kind': 'generic', 'type': 'divider', 'x': x, 'y': y, 'width': width, 'height': 1,
        'style': {'thickness_mm': thickness_mm, 'color': color}, 'overrides': {}, 'binding': None,
    }


def _signature_parts_style(width, *, align='right', image_width=26, image_height=12):
    """
    Part 6 (per-part signature geometry/style) — the real `style.parts`
    shape for a `semantic:signature` element, at exactly the same visual
    arrangement the pre-existing flow layout (`_element_content.html`'s
    now-fallback-only branch: an auto-width, 14mm-tall image, a 0.3mm
    divider line, then a small uppercase mono label, all right-aligned
    within the bundle's own box) already produced — see design_renderer.
    _prepare_signature_parts' own docstring for the render-time mechanics.

    Every one of this codebase's 3 real builtin seeds calls this helper at
    their own real bundle width so the divider/label span the exact same
    full width they always have; only the image (the one part whose OLD
    rendering used an intrinsic, aspect-ratio-preserving auto-width rather
    than a fixed one) is a real, honestly-documented, narrow deviation —
    see this module's own docstring update / DECISIONS.md for why an
    explicit `width`+`object-fit:contain` box (never distorting a real
    uploaded signature, just possibly letterboxing it slightly if its own
    aspect ratio isn't close to this box's) is the correct trade-off once
    a part needs a real, independently-resizable box instead of the
    browser computing width from the asset's own natural dimensions.
    `align='right'` (every real seed's own existing `style.align`) shifts
    the image to the bundle's right edge exactly the way `text-align`
    used to; divider/label stay full-width either way (their own text-
    align, not their box position, is what `align` controlled for them).
    """
    image_dx = (width - image_width) if align == 'right' else (width - image_width) / 2 if align == 'center' else 0
    divider_dy = image_height + 1
    label_dy = divider_dy + 0.3 + 1.2
    return {
        'image': {'dx': image_dx, 'dy': 0, 'width': image_width, 'height': image_height},
        'divider': {'dx': 0, 'dy': divider_dy, 'width': width, 'height': 0.3, 'color': 'theme_secondary'},
        'label': {
            'dx': 0, 'dy': label_dy, 'width': width, 'height': 6,
            'font': 'IBM Plex Mono', 'font_weight': 400, 'font_size_pt': 7.5,
            'letter_spacing_em': 0.1, 'text_transform': 'uppercase', 'color': '#a09a89',
            'align': align,
        },
    }


def _signature_bundle_height(image_height=12, label_height=6):
    """
    Part 6 companion to `_signature_parts_style` above — the real, honest
    total footprint of the 3 parts it lays out (image + 1mm gap + 0.3mm
    divider + 1.2mm gap + label), used as the OUTER `semantic:signature`
    element's own declared `height`.

    This is a genuine fidelity fix, not incidental: the pre-existing seed
    height (7/8mm) was always an inaccurate placeholder — the real visual
    content (a 14mm-tall image alone) already overflowed it by a wide
    margin under the old flow layout, silently relying on `.v2-el`'s own
    `overflow: visible` (design_renderer.py never clips). That overflow
    guarantee is exactly why the mismatch was harmless for real rendering
    — but the adapter's own export now derives a real element's box from
    the union of its 3 real, independently-positioned parts (the same
    convention every other multi-part decomposition in this codebase
    already follows), so an editor round-trip of an unedited signature
    would otherwise silently grow the stored `height` from the old
    placeholder to this real value the first time a user merely opened
    and re-saved it. Authoring the seed's OWN declared height to already
    equal that real value up front means opening+resaving an untouched
    signature is a genuine no-op, not a silent drift — confirmed to
    introduce no new overlap with any real seed's neighboring elements
    (checked directly against all 3 real BUILTIN_DESIGNS seeds).
    """
    return image_height + 1 + 0.3 + 1.2 + label_height


def _page_pinned_rectangle(x, y, width, height, background_color):
    """
    09 September 2026 (Part 2) — a real, editable `generic:rectangle`
    rendered page-absolute/position:fixed (design_renderer.
    is_page_pinned_element), backing Professional's real spine bar +
    accent line (previously pure `page.spine` config — see this module's
    own PROFESSIONAL_DESIGN_DATA_V2 comment). Deliberately excluded from
    OVERLAP_EXEMPT_GENERIC_TYPES-driven validation entirely (rectangle
    already is exempt, unconditionally, regardless of this flag — see
    design_schema.py's own OVERLAP_EXEMPT_GENERIC_TYPES).
    """
    return {
        'kind': 'generic', 'type': 'rectangle', 'x': x, 'y': y, 'width': width, 'height': height,
        'style': {'page_pinned': True, 'background_color': background_color}, 'overrides': {},
    }


def _table(x, y, width, height, style):
    """
    Master Blueprint cutover (§B.3): `layout_mode: 'flow'` — the table's
    own `height` here remains a design-time ESTIMATE (see
    _TABLE_HEIGHT_ESTIMATE_MM below), but at real canonical render time it
    now genuinely grows to its real content (however many real line items
    actually exist) instead of being silently confined to a fixed 45mm
    box — closing that gap for a real invoice whose item count overflows
    the estimate WITHIN THE SAME PAGE (verified directly,
    test_design_layout_mode.py's own TableGrowsBeyondItsDesignTimeEstimateTests).

    KNOWN, DISCLOSED LIMITATION, NOT fixed by this change: real multi-PAGE
    overflow (an invoice with enough real line items to exceed a single
    page's own physical height) still silently loses the excess rows —
    confirmed directly, and confirmed to be a PRE-EXISTING defect of the
    whole V2 canonical renderer's absolutely-positioned-everything
    architecture (reproduces identically with the table left `pinned`,
    i.e. not introduced by layout_mode itself). Every element in this
    renderer, chain wrappers included, is positioned via CSS `position:
    absolute`, which never participates in real CSS page-break
    fragmentation — genuinely fixing this would mean reintroducing real
    document flow for at least the table and everything after it, a
    materially larger, separate architectural change. See the Master
    Blueprint completion report for the full finding.
    """
    return {
        'kind': 'structural', 'type': 'table', 'x': x, 'y': y, 'width': width, 'height': height,
        'style': style, 'overrides': {}, 'binding': None, 'layout_mode': 'flow',
    }


# Design-time-only estimate of the table's own rendered height with the
# canvas/preview's real 3-sample-row convention (thead ~7mm + 3 body rows
# ~11.8mm each, per the real, measured CSS in _v2_page_styles.html —
# see this module's own docstring). NOT a promise about a real invoice's
# actual line-item count.
_TABLE_HEIGHT_ESTIMATE_MM = 45


# ══════════════════════════════════════════════════════════════════
# PROFESSIONAL — real page margins measured: @page margin: 0 0 16mm 0;
# .page { padding: 16mm 16mm 0 20mm; } => effective top16/right16/
# bottom16(page-level)/left20 — IDENTICAL to Phase 1's original
# module-level default, so no per-design override is actually needed
# here (included explicitly anyway, for clarity and so this seed is not
# silently dependent on the renderer's own defaults never changing).
# Content width = 210 - 20 - 16 = 174mm.
# ══════════════════════════════════════════════════════════════════
PROFESSIONAL_DESIGN_DATA_V2 = {
    'schema_version': SCHEMA_VERSION_V2,
    'page': {
        'size': 'A4', 'width_mm': 210, 'height_mm': 297,
        'margin_top_mm': 16, 'margin_right_mm': 16, 'margin_bottom_mm': 16, 'margin_left_mm': 20,
        # 30 August 2026 fidelity fix — the real golden static template's
        # own decorative `.spine`/`.spine::after` (professional.html: a
        # 3mm primary-colored bar bled to the true left page edge, plus a
        # thin 0.4mm accent line at its own right edge) was completely
        # absent from the V2 canonical render before this.
        #
        # 09 September 2026 (Part 2) — REMOVED from here. `page.spine`
        # config is retired as the SOURCE of this bar for any NEW design
        # (design_schema.py keeps validating/rendering it for a
        # PRE-EXISTING design that still has it — full backward
        # compatibility, nothing about reading an old row changes). The
        # bar + accent line are now 2 real, selectable, editable
        # `generic:rectangle` elements at the very start of `flow.elements`
        # below (`style.page_pinned: true`) — see design_renderer.py's
        # is_page_pinned_element for the render mechanism this uses
        # instead (page-absolute, position:fixed, repeats on every real
        # multi-page PDF — verified directly against a real 5-page render,
        # not assumed; see DECISIONS.md's 09 September 2026 Part 2 entry).
        # 30 August 2026 fidelity fix — professional.html's own real
        # `body { background: #faf9f6; }` (a warm off-white, not pure
        # white) was silently flattened to the canonical renderer's one
        # shared, hardcoded `#ffffff` for every template. Real, measured
        # value (confirmed directly: golden PNG background pixel sampled
        # at rgb(249,249,246) vs the V2 render's rgb(255,255,255)).
        'background_color': '#faf9f6',
        # 09 September 2026 fidelity fix — professional.html's own real
        # per-page `@bottom-left`/`@bottom-center`/`@bottom-right` footer
        # (business identity, a genuine multi-page-only "Page X of N"
        # counter, and the LanceraOS wordmark) was completely absent from
        # every V2-rendered invoice — `page.footer`'s own documented
        # contract is that ITS ABSENCE means no footer at all, and this
        # seed never set the key (found and fixed as part of a real-gap
        # audit; see DECISIONS.md). `{}` is genuinely sufficient here:
        # FOOTER_STYLE_DEFAULTS' own `text_color` (#a09a89) is already
        # byte-identical to this template's real, measured
        # `@bottom-left { color: #a09a89; }` (design_renderer.py's own
        # `_WORDMARK_FILL_BY_TEMPLATE['professional']` confirms the same
        # value independently) — no per-design override needed for an
        # exact match.
        'footer': {},
    },
    'header': {
        'elements': [
            {'kind': 'semantic', 'type': 'logo', 'x': 0, 'y': 1, 'width': 15, 'height': 15,
             'style': {'border_radius_mm': 2.5}, 'overrides': {}},

            # ── Masthead: was one bundled business_info element ────────
            _static_text(20, 0, 90, 4, 'Invoice', _EYEBROW_STYLE),
            _bound_text('business.name', 20, 5, 90, 10,
                        {'font': 'Source Serif 4', 'font_size_pt': 21, 'font_weight': 600, 'color': 'theme_secondary'}),

            # ── Dates: was one bundled dates element ────────────────────
            _bound_text('invoice.number', 130, 0, 44, 6,
                        {'font': 'IBM Plex Mono', 'font_size_pt': 12, 'font_weight': 600, 'align': 'right', 'color': 'theme_secondary'}),
            _static_text(130, 7, 17, 6, 'Issue date', {'font_size_pt': 8.5}),
            _bound_text('invoice.issue_date', 148, 7, 26, 6, {'font_weight': 600, 'align': 'right'}),
            _static_text(130, 17, 17, 6, 'Due date', {'font_size_pt': 8.5}),
            _bound_text('invoice.due_date', 148, 17, 26, 6, {'font_weight': 600, 'align': 'right'}),

            # ── Client ("Bill to"): was one bundled client_info element ─
            _static_text(0, 42, 80, 3, 'Bill to', _section_label_style()),
            _bound_text('client.name', 0, 46, 80, 5, {'font_size_pt': 11, 'font_weight': 600}),
            _bound_text('client.company', 0, 51, 80, 4, {}),
            _bound_text('client.address', 0, 55, 80, 6, {}),
            _bound_text('client.email', 0, 61, 80, 4, {}),

            # ── Business ("From"): was one bundled sender_repeat element ─
            _static_text(95, 42, 79, 4, 'From', _section_label_style('right')),
            _bound_text('business.name', 95, 47, 79, 5, {'font_size_pt': 11, 'font_weight': 600, 'align': 'right'}),
            _bound_text('business.address_line1', 95, 53, 79, 4, {'align': 'right'}),
            _bound_text('business.email', 95, 58, 79, 7, {'align': 'right'}),
        ],
    },
    'flow': {
        'elements': [
            # 09 September 2026 (Part 2) — Professional's real spine bar +
            # accent line, now 2 real editable elements (see this seed's
            # own `page` comment above and _page_pinned_rectangle's
            # docstring) instead of `page.spine` config. Placed FIRST in
            # this list deliberately — the adapter's own normalizeZOrder
            # (frontend/.../utils/zorder.js) groups every real shape
            # element at the front of the editor's own item stack on load,
            # so a shape's position within its own list here is what
            # round-trips byte-for-byte on re-export (see
            # designDataAdapter.js's own HEADER_CATALOG_TYPES: a shape
            # always exports into `flow`, never `header`, regardless of
            # which list it was authored in — so both go here, never in
            # `header.elements`, for that same reason).
            _page_pinned_rectangle(0, 0, 3, 297, 'theme_primary'),
            _page_pinned_rectangle(3, 0, 0.4, 297, '#d9c9a8'),
            # y=68: the real golden `<hr class="rule">` — sits between the
            # header's own real content bottom (65mm) and the table's own
            # calibrated y=76 below, with real clearance on both sides.
            _divider(0, 68, 174, 0.4, 'theme_secondary'),
            # y=76: header's own real content bottom (65mm) + the real,
            # measured gap to the table's top edge in the golden template
            # (11mm) — unchanged from this seed's pre-4B.2 spacing_before_mm.
            _table(0, 76, 174, _TABLE_HEIGHT_ESTIMATE_MM, {
                # Phase 6 (style/theme cascade) fix: this was a literal hex
                # copy of Professional's own DEFAULT color_variant primary
                # (design_seeds.COLOR_VARIANTS['professional'][0]['primary']
                # == '#a8813c') — a real TB-001-class bug (see
                # design_renderer.thead_cell_css's own comment):
                # switching to a non-default variant never actually changed
                # this border color. 'theme_primary' is the same sentinel
                # token resolve_theme_color already resolves for `color`/
                # `background_color` elsewhere in this schema.
                'header_border_color': 'theme_primary', 'row_border_color': '#e5e1d6', 'font': 'IBM Plex Mono',
                'columns': ['description', 'quantity', 'unit_price', 'total'],
            }),
            # y=124.5: direct calibration against the real golden template
            # (test_design_templates_golden.py's own PyMuPDF measurement of
            # "Subtotal") — see this module's own docstring. Phase 4B.3
            # (finding C3): narrowed from one bundled 4-row element into 4
            # independently positioned rows, stacked from this one
            # calibrated anchor so the golden position is unchanged.
            _totals_row(112, 124.5, 62, 'subtotal'),
            _totals_row(112, 132.2, 62, 'tax'),
            _totals_row(112, 139.9, 62, 'discount'),
            _totals_row(112, 147.6, 62, 'total'),
            # Phase 4B.5 (correcting the 4B.4 audit's blocker finding): the
            # real template's `.lower { display:flex }` row places
            # Notes/Terms (`.notes-block`, 56% of the 174mm content width =
            # 97mm) and Payment Methods (`.pay-block`, 40% = 70mm) SIDE BY
            # SIDE, not stacked — confirmed by directly measuring the real
            # rendered PDF (PyMuPDF drawing/image bounding boxes, not just
            # text baselines): both labels' real y0 is 176.4mm(abs) =
            # 160.4mm content-relative. y=164 here (rather than 160.4)
            # is a deliberate, small, necessary adjustment: this element's
            # own alias-mode default shows all 4 totals rows (Subtotal/Tax/
            # Discount/Total) for editing purposes, whose combined bottom
            # (161.1mm, see the 4 _totals_row calls above) sits lower than
            # the real invoice's own 2-row (no tax/discount) total block —
            # an inherent, content-dependent-height limitation of this
            # absolutely-positioned schema (the same class of trade-off
            # `_TABLE_HEIGHT_ESTIMATE_MM` already documents for the table),
            # not a fidelity regression: a real invoice with no tax/discount
            # renders with much more headroom here than the editor's own
            # worst-case alias view needs.
            _notes_section(0, 164, 97, 'notes'),
            _notes_section(0, 178.4, 97, 'terms'),
            # Phase 4B.3 (finding C2): height corrected from 27mm to a real
            # measured 42.5mm (alias mode's own worst case — all 4 sample
            # payment methods) — see this module's own docstring for why
            # payment_info stays one bundled element (finding C4). Phase
            # 4B.5: x/width corrected from x=0/width=40 (stacked under
            # Notes) to x=104/width=70 — the real measured `.pay-block`
            # column (124.4mm page-absolute = 104.4mm content-relative,
            # 40% of 174mm = 69.6mm), i.e. genuinely beside Notes/Terms now,
            # not below them.
            {'kind': 'semantic', 'type': 'payment_info', 'x': 104, 'y': 164, 'width': 70, 'height': 42.5,
             'style': {'label': 'Payment methods', 'variant': 'bank_methods'}, 'overrides': {}, 'layout_mode': 'flow'},
            # Phase 4B.5: the real template's `.sign-row { display:flex;
            # align-items:flex-end }` pairs the QR/pay-online block with
            # signature as one row, bottom-aligned (confirmed directly: both
            # the QR image and the signature line's real bounding boxes
            # share the identical bottom edge, 256.9mm page-absolute =
            # 240.9mm content-relative). The pre-4B.5 seed had these
            # INVERTED — signature above, QR/link below — contradicting
            # even its own Phase 4B "Decision #3" comment (which said
            # signature moved "underneath instead"). Corrected by swapping
            # which element gets which y (values are otherwise very close
            # to what was already here, confirming the inversion was the
            # actual defect, not the general vertical placement).
            {'kind': 'semantic', 'type': 'qr_code', 'x': 0, 'y': 222, 'width': 20, 'height': 20,
             'style': {}, 'overrides': {}},
            {'kind': 'semantic', 'type': 'online_payment_link', 'x': 24, 'y': 228, 'width': 90, 'height': 12,
             'style': {'label': 'Pay online'}, 'overrides': {}},
            # y corrected (was 222.3, above the QR/link row — the actual
            # bug; see the qr_code/online_payment_link comment above) to
            # 234, matching the real measured signature-line position
            # (250.1mm page-absolute = 234.1mm content-relative) and this
            # row's own real shared bottom edge with QR/link (~240–242mm).
            {'kind': 'semantic', 'type': 'signature', 'x': 119, 'y': 234, 'width': 55, 'height': _signature_bundle_height(),
             'style': {'label': 'Authorised signature', 'align': 'right', 'parts': _signature_parts_style(55)},
             'overrides': {}},
        ],
    },
}

# ══════════════════════════════════════════════════════════════════
# MINIMAL — real page margins measured directly from @page { margin:
# 20mm 18mm 16mm; } (CSS 3-value shorthand: top=20, left&right=18,
# bottom=16) — genuinely different from Phase 1's default (16/16/16/20)
# and from Professional's own real margins, confirming per-design
# margins are a real necessity, not a speculative one.
# Content width = 210 - 18 - 18 = 174mm.
# ══════════════════════════════════════════════════════════════════
MINIMAL_DESIGN_DATA_V2 = {
    'schema_version': SCHEMA_VERSION_V2,
    'page': {
        'size': 'A4', 'width_mm': 210, 'height_mm': 297,
        'margin_top_mm': 20, 'margin_right_mm': 18, 'margin_bottom_mm': 16, 'margin_left_mm': 18,
        # 30 August 2026 fidelity fix — see Professional's own identical
        # comment above. minimal.html's own real `body { background:
        # #fdfdfb; }`, silently flattened to the canonical renderer's one
        # shared #ffffff before this.
        'background_color': '#fdfdfb',
        # 09 September 2026 fidelity fix — see Professional's own identical
        # comment above (same real gap, same audit, same fix). Unlike
        # Professional, minimal.html's own real, measured
        # `@bottom-left { color: #a3a099; }` differs from
        # FOOTER_STYLE_DEFAULTS' shared default (#a09a89) — an explicit
        # `text_color` override is needed for an exact match; every other
        # footer style field (font_family/font_size_pt) is already
        # byte-identical to minimal.html's own real CSS, so left at the
        # renderer's own defaults.
        'footer': {'style': {'text_color': '#a3a099'}},
    },
    'header': {
        'elements': [
            {'kind': 'semantic', 'type': 'logo', 'x': 0, 'y': 6, 'width': 12, 'height': 12,
             'style': {}, 'overrides': {}},

            _static_text(17, 0, 90, 4, 'Invoice', _EYEBROW_STYLE),
            _bound_text('business.name', 17, 5, 90, 9,
                        {'font': 'IBM Plex Sans', 'font_size_pt': 19, 'font_weight': 600, 'color': 'theme_secondary'}),

            _bound_text('invoice.number', 130, 0, 44, 6,
                        {'font': 'IBM Plex Mono', 'font_size_pt': 10, 'font_weight': 600, 'align': 'right', 'color': 'theme_secondary'}),
            _static_text(130, 7, 17, 6, 'Issue date', {'font_size_pt': 8.5}),
            _bound_text('invoice.issue_date', 148, 7, 26, 6, {'font_weight': 600, 'align': 'right'}),
            _static_text(130, 17, 17, 6, 'Due date', {'font_size_pt': 8.5}),
            _bound_text('invoice.due_date', 148, 17, 26, 6, {'font_weight': 600, 'align': 'right'}),

            _static_text(0, 42, 80, 3, 'Bill to', _section_label_style()),
            _bound_text('client.name', 0, 46, 80, 5, {'font_size_pt': 11, 'font_weight': 600}),
            _bound_text('client.company', 0, 51, 80, 4, {}),
            _bound_text('client.address', 0, 55, 80, 6, {}),
            _bound_text('client.email', 0, 61, 80, 4, {}),

            _static_text(95, 42, 79, 4, 'From', _section_label_style('right')),
            _bound_text('business.name', 95, 47, 79, 5, {'font_size_pt': 11, 'font_weight': 600, 'align': 'right'}),
            _bound_text('business.address_line1', 95, 53, 79, 4, {'align': 'right'}),
            _bound_text('business.email', 95, 58, 79, 7, {'align': 'right'}),
        ],
    },
    'flow': {
        'elements': [
            # y=67: the real golden `<hr class="rule">` (0.3mm, matching
            # minimal.html's own thinner rule vs Professional's 0.4mm) —
            # sits with real clearance before the table's own y=75 below.
            _divider(0, 67, 174, 0.3, 'theme_secondary'),
            _table(0, 75, 174, _TABLE_HEIGHT_ESTIMATE_MM, {
                # Phase 6: same TB-001-class fix as Professional's table
                # above — '#171614' was a literal copy of Minimal's own
                # DEFAULT color_variant SECONDARY color
                # (design_seeds.COLOR_VARIANTS['minimal'][0]['secondary']).
                'header_border_color': 'theme_secondary', 'row_border_color': '#e8e6de', 'font': 'IBM Plex Mono',
                'columns': ['description', 'quantity', 'unit_price', 'total'],
            }),
            # y calibrated directly against golden's own measured "Subtotal"
            # position (see this module's docstring's calibration note).
            # Phase 4B.3 (finding C3): narrowed further than the pre-4B.3
            # version — which already split Total from Subtotal/Tax/
            # Discount, but still left the latter 3 bundled together — into
            # 4 fully independent rows, stacked from this one calibrated
            # anchor.
            _totals_row(112, 128.34, 62, 'subtotal'),
            _totals_row(112, 136.04, 62, 'tax'),
            _totals_row(112, 143.74, 62, 'discount'),
            # Phase 4B.3 (finding C2): a real, previously-undetected
            # overflow — alias-mode "Total Amount" wraps to 2 lines at this
            # element's original 62mm width, needing ~41.3mm of height
            # rather than its declared 20mm. Fixed by widening (95mm, still
            # right-aligned to the same 174mm content-area right edge every
            # other totals row uses) rather than heightening, since real
            # currency text is far narrower than the alias placeholder and a
            # 41mm-tall element for one number is a worse real layout
            # outcome — see this module's own `_TOTALS_DUE_DISPLAY_*`
            # comment.
            _totals_row(79, 153.44, _TOTALS_DUE_DISPLAY_WIDTH_MM, 'total', variant='total_due_display',
                        extra_style={'font_size_pt': 34}),
            # Phase 4B.5 (correcting the 4B.4 audit's blocker finding — same
            # real defect as Professional, independently re-measured against
            # minimal.html's own real rendered PDF): `.lower { display:flex }`
            # places Notes/Terms (56% of 174mm = 97mm) beside Payment Methods
            # (40% = 70mm, real measured x=104.4mm content-relative), not
            # stacked. y=180 (vs. the real measured 179.7) is essentially
            # unchanged — Minimal's own totals decomposition (3 rows +
            # total_due_display) already bottoms out at 176.94mm, close to
            # the real value, so only a ~3mm gap adjustment was needed here
            # (unlike Professional/Modern, whose 4-plain-row totals block
            # needed a bigger adjustment — see Professional's own comment
            # above for the full reasoning on why this varies by template).
            _notes_section(0, 180, 97, 'notes'),
            _notes_section(0, 194.4, 97, 'terms'),
            # Phase 4B.3 (finding C2): height corrected from 27mm to a real
            # measured 42.5mm (alias mode's own worst case — all 4 sample
            # payment methods) — see this module's own docstring for why
            # payment_info stays one bundled element (finding C4). Phase
            # 4B.5: x/width corrected from x=0/width=40 (stacked under
            # Notes) to x=104/width=70, matching the real measured
            # `.pay-block` column exactly (122.4mm page-absolute = 104.4mm
            # content-relative, 40% of 174mm = 69.6mm) — genuinely beside
            # Notes/Terms now, not below them.
            {'kind': 'semantic', 'type': 'payment_info', 'x': 104, 'y': 180, 'width': 70, 'height': 42.5,
             'style': {'label': 'Payment methods', 'variant': 'bank_methods'}, 'overrides': {}, 'layout_mode': 'flow'},
            # Phase 4B.5: minimal.html's own real CSS (`.pay-online img.qr
            # { width:18mm }`) differs from professional.html's 20mm — real
            # templates are NOT assumed identical, confirmed directly. Kept
            # at 20mm here anyway (not the real 18mm) because the shared
            # canvas/render partial's `.v2-qr` class is a fixed, pre-
            # existing `width:20mm; height:20mm` regardless of the
            # element's own declared box (`_v2_page_styles.html`, predates
            # Phase 4B.2's real-geometry unification) — declaring 18mm here
            # would just create a real, spurious 2mm overflow against CSS
            # this phase doesn't touch (out of scope: a renderer/CSS change,
            # not a seed-geometry correction). The real `.sign-row` pairs
            # this with signature as one bottom-aligned row (QR image
            # bottom and signature-line bottom share the identical real y,
            # 276.8mm page-absolute) — the pre-4B.5 seed had signature ABOVE
            # this row instead of level with it; corrected below.
            {'kind': 'semantic', 'type': 'qr_code', 'x': 0, 'y': 239, 'width': 20, 'height': 20,
             'style': {}, 'overrides': {}},
            {'kind': 'semantic', 'type': 'online_payment_link', 'x': 22, 'y': 245, 'width': 90, 'height': 12,
             'style': {'label': 'Pay online'}, 'overrides': {}},
            # y corrected (was 238.0, above the QR/link row) to 250, matching
            # the real measured signature-line position (269.9mm
            # page-absolute = 249.9mm content-relative).
            {'kind': 'semantic', 'type': 'signature', 'x': 119, 'y': 250, 'width': 55, 'height': _signature_bundle_height(),
             'style': {
                 'label': 'Authorised signature', 'has_signature_image': True, 'align': 'right',
                 'parts': _signature_parts_style(55),
             },
             'overrides': {}},
        ],
    },
}

# ══════════════════════════════════════════════════════════════════
# MODERN — real page margins measured from `.main { margin-left: 42mm;
# padding: 14mm 16mm 16mm; }` (3-value shorthand: top=14, left&right=16,
# bottom=16) plus the real, existing full-height sidebar
# (`.sidebar { width: 42mm; ... }`) — the one built-in that genuinely
# cannot be reconstructed without the Phase 2 sidebar schema addition
# (see design_schema.py). Sidebar content (logo, business name, the
# QR/pay-online block) is modeled with `style.sidebar: True` on ordinary
# elements — the exact same generalization of v1's own pre-existing
# convention design_seeds.py's original Modern seed already used.
# Main content width = 210 - (16 sidebar-offset + 16 margin_left... see
# render_design_html: effective_margin_left = margin_left_mm(16) +
# sidebar.width_mm(42) = 58) - margin_right(16) = 136mm.
# ══════════════════════════════════════════════════════════════════
MODERN_DESIGN_DATA_V2 = {
    'schema_version': SCHEMA_VERSION_V2,
    'page': {
        'size': 'A4', 'width_mm': 210, 'height_mm': 297,
        'margin_top_mm': 14, 'margin_right_mm': 16, 'margin_bottom_mm': 16, 'margin_left_mm': 16,
        # `width_mm` stays real page-level geometry (drives the main-
        # content margin offset AND gates the fixed `.v2-sidebar` column
        # every sidebar-flagged element — logo/business name/QR/pay-online
        # link, all below — renders inside; removing it would break all of
        # them, not just the background fill). `color: None` (unchanged
        # since before Part 2) means the wrapper's own default fill still
        # applies — the VISIBLE bar is now a real, editable element instead
        # (09 September 2026, Part 2 — see the `_page_pinned_rectangle`-
        # sibling `style.sidebar: True` rectangle at the very start of
        # `flow.elements` below), so this default and that element resolve
        # to the identical color and simply double-paint — zero visual
        # change, but the fill is now genuinely selectable/editable.
        'sidebar': {'width_mm': 42, 'color': None},
        # 09 September 2026 fidelity fix — see Professional's own identical
        # comment above (same real gap, same audit, same fix). modern.html's
        # own real, measured `@bottom-left { color: #a8a5b8; }` differs from
        # FOOTER_STYLE_DEFAULTS' shared default — an explicit `text_color`
        # override is needed for an exact match, same as Minimal. (The
        # static template's own `@bottom-left` also carries a
        # sidebar-avoiding `margin`/`width` offset that the current
        # page.footer schema has no per-side equivalent for — a real,
        # narrower cosmetic gap than "no footer at all", left as-is; the
        # footer box itself, its color, and the wordmark all now render
        # correctly, which is this fix's actual scope.)
        'footer': {'style': {'text_color': '#a8a5b8'}},
    },
    'header': {
        'elements': [
            # ── Sidebar content — absolutely positioned relative to the
            #    sidebar's own (fixed) box, real measured page-relative
            #    coordinates (sidebar occupies page x=0..42mm regardless
            #    of the main content's own margin_left). Sidebar text is
            #    white via the .v2-sidebar class itself — no per-element
            #    color override needed/added here.
            {'kind': 'semantic', 'type': 'logo', 'x': 6, 'y': 14, 'width': 15, 'height': 15,
             'style': {'sidebar': True}, 'overrides': {}},
            # 09 September 2026 fidelity fix — the original width=30 here
            # was measured against the sidebar's own CSS padding-box
            # (sidebar_width_mm 42 minus 6mm padding on each side), mirroring
            # modern.html's real `.sidebar { padding: 14mm 6mm 12mm; }` — but
            # a real WeasyPrint render (confirmed directly, not assumed)
            # showed this genuinely too tight: even a real, normal 2-word
            # business name ("Horizon Studio", this codebase's own standard
            # test fixture value, used across a dozen existing test files)
            # wrapped to 2 lines at 14pt bold Space Grotesk in a 30mm box.
            # Sidebar V2 elements are positioned as real page-absolute
            # coordinates (x=6 measures from the sidebar's left BORDER edge,
            # not its own padding-box — confirmed by direct pixel
            # measurement: a schema x=6 render position landed at 6.0mm),
            # so 36 is the true maximum before design_schema's own
            # page-bounds check (x + width <= page.sidebar.width_mm) rejects
            # it — widened to that ceiling rather than reducing font_size_pt,
            # since font_size_pt=14 is the exact value that reproduces
            # modern.html's own real `.sidebar .brandname { font-size: 14pt;
            # }` — changing it would trade one fidelity gap for another.
            # This does not fix every conceivable business name (a genuine
            # 3-word name like "Sarah Khan Designs" still needs more room
            # than a 42mm-wide sidebar has to give at this font size,
            # confirmed directly — a materially larger layout change, not
            # this fix's scope), but does fix the real, reported case: a
            # normal-length business name now renders on one line.
            _bound_text('business.name', 6, 35, 36, 8,
                        {'sidebar': True, 'font': 'Space Grotesk', 'font_size_pt': 14, 'font_weight': 700}),

            # ── Main content ─────────────────────────────────────────
            _bound_text('invoice.number', 0, 0, 60, 8,
                        {'font': 'Space Grotesk', 'font_size_pt': 22, 'font_weight': 700, 'color': 'theme_primary'}),
            _static_text(76, 0, 30, 6, 'Issue date', {'font_size_pt': 8.5, 'align': 'right'}),
            _bound_text('invoice.issue_date', 106, 0, 30, 6, {'font_weight': 600, 'align': 'right'}),
            _static_text(76, 10, 30, 6, 'Due date', {'font_size_pt': 8.5, 'align': 'right'}),
            _bound_text('invoice.due_date', 106, 10, 30, 6, {'font_weight': 600, 'align': 'right'}),

            _static_text(0, 35, 63, 3, 'Bill to', _section_label_style()),
            _bound_text('client.name', 0, 39, 63, 5, {'font_size_pt': 11, 'font_weight': 700}),
            _bound_text('client.company', 0, 45, 63, 4, {}),
            _bound_text('client.address', 0, 50, 63, 6, {}),
            _bound_text('client.email', 0, 57, 63, 4, {}),

            _static_text(73, 35, 63, 4, 'From', _section_label_style('right')),
            _bound_text('business.name', 73, 40, 63, 5, {'font_size_pt': 11, 'font_weight': 700, 'align': 'right'}),
            _bound_text('business.address_line1', 73, 46, 63, 4, {'align': 'right'}),
            _bound_text('business.email', 73, 51, 63, 4, {'align': 'right'}),
        ],
    },
    'flow': {
        'elements': [
            # 09 September 2026 (Part 2) — the sidebar's real, visible fill
            # is now this real, editable `generic:rectangle` (full-bleed:
            # the sidebar's own real width_mm x the full page height)
            # rather than being painted purely from `page.sidebar.color`
            # config (see this seed's own `page.sidebar` comment above).
            # `style.sidebar: True` (not `page_pinned` — Modern already has
            # a real `page.sidebar`, so this reuses that existing,
            # already-gated page-absolute/position:fixed rendering
            # mechanism directly rather than introducing a second one it
            # doesn't need). Placed FIRST in this list for the same
            # editor-z-order/round-trip reason Professional's own new
            # elements are placed first in ITS flow.elements — see that
            # seed's own comment for the full reasoning.
            {'kind': 'generic', 'type': 'rectangle', 'x': 0, 'y': 0, 'width': 42, 'height': 297,
             'style': {'sidebar': True, 'background_color': 'theme_primary'}, 'overrides': {}},

            # ── Sidebar flow content — positioned within the sidebar's own
            #    fixed column, below its absolutely-positioned header
            #    content (logo/business fields above). A flat, always-
            #    vertical stack, matching the real modern.html sidebar's
            #    own flex-column layout.
            {'kind': 'semantic', 'type': 'qr_code', 'x': 6, 'y': 60, 'width': 20, 'height': 20,
             'style': {'sidebar': True}, 'overrides': {}},
            {'kind': 'semantic', 'type': 'online_payment_link', 'x': 6, 'y': 82, 'width': 30, 'height': 10,
             'style': {'sidebar': True, 'label': 'Pay online'}, 'overrides': {}},

            # ── Main content ─────────────────────────────────────────
            _table(0, 72, 136, _TABLE_HEIGHT_ESTIMATE_MM, {
                # Phase 6: same TB-001-class fix — '#2d2a6e' was a literal
                # copy of Modern's own DEFAULT color_variant PRIMARY color
                # (design_seeds.COLOR_VARIANTS['modern'][0]['primary']).
                # 'header_color' (white table-header text) is left as a
                # real literal on purpose — confirmed it does NOT match
                # either Modern's primary or secondary color in any of its
                # 3 real variants, so it is genuinely fixed, not a
                # mis-baked theme value.
                'header_bg': 'theme_primary', 'header_color': '#ffffff', 'font': 'IBM Plex Mono',
                'columns': ['description', 'quantity', 'unit_price', 'total'],
            }),
            # y calibrated directly against golden's own measured "Subtotal"
            # position (see this module's docstring's calibration note).
            # Phase 4B.3 (finding C3): narrowed from one bundled 4-row
            # element into 4 independently positioned rows, stacked from
            # this one calibrated anchor.
            _totals_row(74, 122.23, 62, 'subtotal'),
            _totals_row(74, 129.93, 62, 'tax'),
            _totals_row(74, 137.63, 62, 'discount'),
            # Phase 6 (style/theme cascade) fix: '#d4e157' was a literal
            # copy of Modern's own DEFAULT color_variant SECONDARY color
            # (design_seeds.COLOR_VARIANTS['modern'][0]['secondary']) — the
            # architecture plan's own TB-001 example almost verbatim (see
            # design_renderer.prepare_element's own `resolved_pill_color`
            # comment for the full reasoning, including the separate,
            # previously-unfixed bug this also closes: a real
            # overrides.pill_color from the Style Panel was silently
            # ignored by both this element's live canvas refresh and the
            # canonical renderer).
            _totals_row(74, 145.33, 62, 'total', variant='total_pill', extra_style={'pill_color': 'theme_secondary'}),
            # Phase 4B.5 (correcting the 4B.4 audit's blocker finding — same
            # real defect as Professional/Minimal, independently re-measured
            # against modern.html's own real rendered PDF): `.lower {
            # display:flex }` places Notes/Terms (56% of the 136mm main-
            # content width = 76mm) beside Payment Methods (`.pay-block2`,
            # 40% = 54mm, real measured x=81.6mm content-relative), not
            # stacked. y=164 (vs. the real measured 159.0) needed the same
            # kind of small, deliberate adjustment as Professional — see
            # Professional's own comment above for the full reasoning
            # (Modern's 4-plain-row totals block bottoms out at 161.83mm,
            # which would otherwise collide with the real y).
            _notes_section(0, 164, 76, 'notes'),
            _notes_section(0, 178.4, 76, 'terms'),
            # Phase 4B.3 (finding C2): height corrected from 27mm to a real
            # measured 42.5mm — bumped to 45mm here specifically (Modern's
            # own real sample data wraps BOTH the bank-transfer AND
            # Payoneer-email rows to 2 lines each, a real, measured
            # worst-case taller than the other 2 templates' own worst case)
            # — see this module's own docstring for why payment_info stays
            # one bundled element (finding C4). Phase 4B.5: x/width
            # corrected from x=0/width=40 (stacked under Notes) to x=82/
            # width=54, matching the real measured `.pay-block2` column
            # (139.6mm page-absolute = 81.6mm content-relative, 40% of
            # 136mm = 54.4mm) — genuinely beside Notes/Terms now.
            {'kind': 'semantic', 'type': 'payment_info', 'x': 82, 'y': 164, 'width': 54, 'height': 45,
             'style': {'label': 'Payment methods', 'variant': 'bank_methods'}, 'overrides': {}, 'layout_mode': 'flow'},
            # Phase 4B.5: corrected from x=81/width=55/y=206.2 (never
            # golden-verified for Modern — confirmed directly, no
            # `test_modern_signature_*` test exists) to the real measured
            # `.sign-block` box (134mm page-absolute = 76mm content-
            # relative, width=60mm exactly — modern.html's own CSS,
            # `margin-left:auto; text-align:right`, both seeds' right edge
            # land on the same 136mm content-width regardless of the x/
            # width split, but the real box is 76–136mm, not 81–136mm).
            # Modern's real CSS has no `.sign-row` pairing signature with
            # QR/link at all (confirmed directly — QR/link live entirely in
            # the sidebar here) — signature genuinely stands alone in main
            # content, matching this seed's own existing structure; only
            # its exact box needed correcting, not its pairing.
            {'kind': 'semantic', 'type': 'signature', 'x': 76, 'y': 223, 'width': 60, 'height': _signature_bundle_height(),
             'style': {
                 'label': 'Authorised signature', 'has_signature_image': True, 'align': 'right',
                 'parts': _signature_parts_style(60),
             },
             'overrides': {}},
        ],
    },
}

BUILTIN_DESIGNS = {
    'professional': PROFESSIONAL_DESIGN_DATA_V2,
    'minimal': MINIMAL_DESIGN_DATA_V2,
    'modern': MODERN_DESIGN_DATA_V2,
}


def get_builtin_design_data(base_template):
    """Deep copy — mirrors design_seeds.get_builtin_design_data's exact convention."""
    return copy.deepcopy(BUILTIN_DESIGNS[base_template])


def get_blank_design_data(base_template):
    """
    Green-Light directive — the editor's second first-class starting mode
    ("Two first-class starting modes: blank canvas AND built-in templates,
    fully editable"). `base_template` still selects the underlying color/
    typography foundation (exactly like a blank document in most design
    tools still has an underlying stylesheet) — this reuses that
    template's own real page geometry (margins, sidebar) verbatim, so a
    blank start and a builtin start share the identical printable area.

    Part 3 ("blank design richness") rewrite — this used to seed only the
    two structurally mandatory anchors (`header.elements: []`, a bare
    table + totals block), a real, separate, hand-authored-in-Python
    approximation of "blank" that drifted from the frontend editor's own
    original, deliberate default (every catalog element present, user
    removes what they don't want — design-editor-v2's `initialTemplateState`,
    verified collision-free across its complete set) — the actual real
    UX shipped to users didn't match this project's own stated intent for
    it. Content now comes from `_load_blank_design_rich_elements()` (the
    frontend's own real default, dumped to a checked-in JSON fixture by
    frontend/scripts/js/dump_blank_design_elements.mjs — see that file's
    module-level comment and this module's own header comment for the
    full drift-prevention reasoning), rescaled to fit whichever
    base_template's real content_width_mm is narrower than the generic,
    zero-margin canvas that content was originally authored against (see
    `_scale_elements_to_fit` — a uniform scale-from-origin, never an
    independent per-element clamp, so the set's own already-verified
    collision-freedom is preserved exactly).

    `page.sidebar.color` is forced to `'transparent'` when present (Modern
    only) rather than left at the source seed's own `None` — `None` means
    "the .v2-sidebar wrapper paints its own default theme-color fill"
    (see design_renderer.py's canonical.html, `{{ sidebar.color|default:
    design_primary_color }}`), which is correct for Modern's real BUILTIN
    seed (a real sidebar-background rectangle element also exists there
    now and simply double-paints the identical color — see that seed's
    own comment) but was a real, reported bug for a blank design: nothing
    in the rich content dumped above is sidebar-flagged, so a blank Modern
    design rendered a solid, full-height colored panel purely from this
    page-level default, with zero actual sidebar content behind it. Width
    reservation (`width_mm`, which shifts the main content column and
    narrows content_width_mm for the scale-to-fit step above) is
    unaffected — only the wrapper's own implicit fill is suppressed.

    Never a database row — a fresh, real, independent value every call,
    same "always a deep copy, no shared mutable state" contract
    get_builtin_design_data already has.
    """
    if base_template not in BUILTIN_DESIGNS:
        raise ValueError(f'base_template must be one of {sorted(BUILTIN_DESIGNS.keys())}.')
    source = BUILTIN_DESIGNS[base_template]
    page = copy.deepcopy(source['page'])
    if page.get('sidebar'):
        page['sidebar']['color'] = 'transparent'

    rich = _load_blank_design_rich_elements()
    content_width_mm = _content_width_mm_for_page(page)
    all_elements = rich['header']['elements'] + rich['flow']['elements']
    _scale_elements_to_fit(all_elements, content_width_mm)

    return {
        'schema_version': SCHEMA_VERSION_V2,
        'page': page,
        'header': rich['header'],
        'flow': rich['flow'],
    }
