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

SCHEMA_VERSION_V2 = 2

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
    render time, instead of silently overlapping it. The canvas editor is
    unaffected (design_canvas.py never groups chains) — same documented
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
    },
    'header': {
        'elements': [
            {'kind': 'semantic', 'type': 'logo', 'x': 0, 'y': 1, 'width': 15, 'height': 15,
             'style': {'border_radius_mm': 2.5}, 'overrides': {}},

            # ── Masthead: was one bundled business_info element ────────
            _static_text(20, 0, 90, 4, 'Invoice', _EYEBROW_STYLE),
            _bound_text('business.name', 20, 5, 90, 10,
                        {'font': 'Source Serif 4', 'font_size_pt': 21, 'font_weight': 600, 'color': 'theme_secondary'}),
            _bound_text('business.city', 20, 16, 44, 4, {'font_size_pt': 8.5}),
            _bound_text('business.country', 66, 16, 44, 4, {'font_size_pt': 8.5}),

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
            {'kind': 'semantic', 'type': 'signature', 'x': 119, 'y': 234, 'width': 55, 'height': 8,
             'style': {'label': 'Authorised signature', 'align': 'right'}, 'overrides': {}},
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
    },
    'header': {
        'elements': [
            {'kind': 'semantic', 'type': 'logo', 'x': 0, 'y': 6, 'width': 12, 'height': 12,
             'style': {}, 'overrides': {}},

            _static_text(17, 0, 90, 4, 'Invoice', _EYEBROW_STYLE),
            _bound_text('business.name', 17, 5, 90, 9,
                        {'font': 'IBM Plex Sans', 'font_size_pt': 19, 'font_weight': 600, 'color': 'theme_secondary'}),
            _bound_text('business.city', 17, 15, 44, 4, {'font_size_pt': 8.5}),
            _bound_text('business.country', 63, 15, 44, 4, {'font_size_pt': 8.5}),

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
            {'kind': 'semantic', 'type': 'signature', 'x': 119, 'y': 250, 'width': 55, 'height': 7,
             'style': {'label': 'Authorised signature', 'has_signature_image': True, 'align': 'right'},
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
        'sidebar': {'width_mm': 42, 'color': None},  # None -> renderer falls back to design_primary_color
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
            _bound_text('business.name', 6, 35, 30, 8,
                        {'sidebar': True, 'font': 'Space Grotesk', 'font_size_pt': 14, 'font_weight': 700}),
            _bound_text('business.city', 6, 44, 30, 4, {'sidebar': True, 'font_size_pt': 7.5}),
            _bound_text('business.country', 6, 48, 30, 4, {'sidebar': True, 'font_size_pt': 7.5}),

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
            {'kind': 'semantic', 'type': 'signature', 'x': 76, 'y': 223, 'width': 60, 'height': 7,
             'style': {'label': 'Authorised signature', 'has_signature_image': True, 'align': 'right'},
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
    Zero pre-arranged header content (`header.elements: []`) — the ONLY
    elements present are the two structurally mandatory anchors
    design_schema requires every design_data payload to contain (the
    line-items table, a totals block that includes the real grand-total
    row), positioned at a sensible top-of-page default so the design is
    immediately valid and renderable, not just non-empty. Never a database
    row — a fresh, real, independent value every call, same "always a
    deep copy, no shared mutable state" contract get_builtin_design_data
    already has.
    """
    if base_template not in BUILTIN_DESIGNS:
        raise ValueError(f'base_template must be one of {sorted(BUILTIN_DESIGNS.keys())}.')
    source = BUILTIN_DESIGNS[base_template]
    table_seed = next(el for el in source['flow']['elements'] if el.get('type') == 'table')
    content_x, content_width = table_seed['x'], table_seed['width']
    table_y = 20
    return {
        'schema_version': SCHEMA_VERSION_V2,
        'page': copy.deepcopy(source['page']),
        'header': {'elements': []},
        'flow': {
            'elements': [
                _table(content_x, table_y, content_width, _TABLE_HEIGHT_ESTIMATE_MM, {
                    'header_border_color': 'theme_primary', 'row_border_color': '#e5e1d6', 'font': 'IBM Plex Mono',
                    'columns': ['description', 'quantity', 'unit_price', 'total'],
                }),
                _totals_row(content_x + content_width - 62, table_y + _TABLE_HEIGHT_ESTIMATE_MM + 10, 62, 'total'),
            ],
        },
    }
