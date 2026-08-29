# LanceraOS Template Builder — Product Architecture

**Originally drafted:** 28 August 2026, as an architecture-and-investigation report — no code had
been modified to produce it, and nothing was to begin against it without explicit approval.
**Implemented:** 29 August 2026 — the production cutover (see DECISIONS.md's 29 August 2026
"Production cutover" entry) executed this plan: the system described below as "V2"/"final" IS now
the one production LanceraOS Template Builder, reached through one real route, with the original
system retired to read-compatibility-only. This document has been updated in place (not replaced)
to describe that as-built reality rather than a still-open proposal.

**How to read what follows:** Sections 2-6 are a **historical snapshot**, preserved as written on
28 August 2026, of how the system looked immediately BEFORE the cutover — real at the time, not
current state now. Sections 7 onward ("Final ___ Architecture") describe the TARGET this document
specified; that target is now the actual, implemented architecture, with one mechanical caveat:
every `_v2`-suffixed file/route name below (`design_schema_v2.py`, `design_renderer_v2.py`,
`design_seeds_v2.py`, `design_canvas_v2.py`, `views_design_v2.py`, `/designs-v2/`, `design-editor-v2/`,
`designEditorV2/`, `DesignEditorV2.jsx`) was promoted to its plain, un-suffixed name during the
cutover (`design_schema.py`, `design_renderer.py`, `design_templates.py`, `design_canvas.py`,
`views_design_editor.py`, `/designs/`, `design-editor/`, `designEditor/`, `DesignEditor.jsx`) — the
original, un-suffixed v1 modules with the same names were renamed to explicit `legacy_*` names
first (`legacy_design_schema.py`, `legacy_design_renderer.py`) to free them; `design_seeds.py`
itself was NOT renamed and still holds the retired shape's own seeds. Treat every `_v2` mention
below as referring to today's one production module by that mapping — CLAUDE.md, DATABASE.md, and
DECISIONS.md's own 29 August 2026 entry are the live, current-state references if this mapping and
the prose below ever appear to disagree; this document is the architectural "why," not the
up-to-the-minute file listing.

Section 35 ("Open Decisions Requiring User Approval") has been updated to reflect which of those
decisions the cutover actually resolved.

---

## 1. Executive Summary

Template Builder 2.0 exists today as two things simultaneously: a genuinely well-engineered rendering/persistence/versioning system (schema, canonical renderer, migration mapper, pagination engine, real production persistence), and an unfinished product (no multi-select, no semantic validation gate, no decided mobile scope, an editor page that mixes real user-facing UI with leftover diagnostic tooling from its dev-sandbox origins). It is reachable by a real user today — through an explicit opt-in path — and a v2 design genuinely renders through the same production PDF/portal pipeline a v1 design uses, with the one truly safety-critical historical bug (an invoice's design silently changing after the fact) actually fixed.

This document reconstructs exactly how the system got here, maps every point where it touches the existing LanceraOS product, and specifies what the *finished* product must be — architecture, UX, data model, backend, frontend, renderer, validation, security, testing, file layout, documentation cleanup, and a finite implementation program. It flags every place a genuine product decision is still open rather than making it unilaterally.

**What this document is not:** an instruction to start building. Nothing here should be implemented until reviewed and explicitly approved.

---

## 2. Current System Reconstruction

The entire Template Builder 2.0 effort lives in the working tree as uncommitted changes (`git status --short`). It divides cleanly into four groups:

**A. New V2-only backend modules (`apps/invoices/`)** — none of these existed before this effort; none are imported by anything V1 depends on:
- `design_schema_v2.py` (584 lines) — the v2 JSON contract + structural validator.
- `design_seeds_v2.py` (683 lines) — the 3 real, hand-calibrated builtin reconstructions.
- `design_renderer_v2.py` (1,013 lines) — the canonical renderer (bindings, style resolution, header region, flow-region pagination engine).
- `design_canvas_v2.py` (254 lines) — the editor-canvas adapter (reuses the canonical renderer's own geometry functions; does not implement the header/flow-region split).
- `design_migration.py` (349 lines) — the one-way, pure v1→v2 structural converter.
- `design_validation.py` (148 lines) — the 4-layer validation scaffold (only Layer A is real).
- `views_design_v2.py` (239 lines) — the originally-isolated preview/canvas endpoints (still real, still used by the editor's diagnostic tooling; the *real* CRUD path since the persistence cutover is the shared v1 endpoints, not these).
- `management/commands/audit_template_design_migration.py`, `export_invoice_designs_backup.py` — read-only tooling.
- `migrations/0011_phase0_design_versioning_and_snapshot_foundation.py` — the one additive schema migration (adds `Invoice.rendered_design_snapshot`, creates `InvoiceDesignVersion`).
- `templates/invoices/v2/` — 5 partials (`canonical_v2.html`, `_v2_element_content.html`, `_v2_page_styles.html`, `_v2_table_head.html`, `_v2_table_row.html`).
- 12 new test files under `apps/invoices/tests/` — real, currently-passing coverage for every module above.

**B. Modified shared backend files** — genuine, small, additive touch points into the existing product:
- `apps/invoices/pdf_generator.py` (+124/-lines) — `render_html_for_design` gained a real v2 dispatch branch; `_effective_design` gained the snapshot-aware read path; `_FrozenDesignSnapshot` is a new small proxy class.
- `apps/invoices/serializers.py` (+18) — `InvoiceDesignSerializer.validate_design_data` now dispatches by `schema_version`.
- `apps/invoices/models.py` (+105) — `InvoiceDesign.save()` gained real version-writing; `_finalise_invoice`-adjacent snapshot capture lives in `views.py`, not here (the model change is version-writing only).
- `apps/invoices/views.py` (+19) — the snapshot-capture lines inside `_finalise_invoice`.
- `apps/invoices/urls.py` (+17) — the 5 isolated v2 endpoint routes, plus the (unused-by-cutover) route naming.
- `apps/invoices/design_preview.py` (+7) — a comment/reasoning update only (no behavior change); it already called the now-v2-aware `render_html_for_design`.
- `apps/invoices/design_schema.py` (+57/-4) — **the one V1 file touched**, and it predates this session: the Phase 4B.2 `_boxes_overlap` → public `boxes_overlap` rename plus a 0.3mm epsilon, reused by `design_schema_v2.py` rather than duplicated. Confirmed via direct diff inspection to be the *entire* extent of V1 modification across this whole effort.

**C. New frontend V2 modules** — `frontend/src/pages/design-editor-v2/` (`DesignEditorV2.jsx`, 1,071 lines; `StylePanel.jsx`, 451 lines) and `frontend/src/lib/designEditorV2/` (`canvasApi.js`, `componentTypes.js`, `constants.js`, `serialization.js`, plus 3 test files). All net-new; nothing here is imported by v1's own editor (`frontend/src/pages/design-editor/`, untouched).

**D. Modified shared frontend files:**
- `frontend/src/App.jsx` (+29) — the isolated dev route (`/dev/design-editor-v2`, unchanged) plus the new real route (`/invoices/designs-v2/:id/edit`).
- `frontend/src/pages/DesignGallery.jsx` (+31/-4) — the opt-in "Try the new design editor" button, and `handleEdit`'s schema-version-based routing.

**E. Documentation** — 31 markdown files at the project root, none committed, spanning the original V1 audit, the architecture plan, 24 phase/audit reports, and 3 documents from this session (Master Blueprint, Completion Report, Pagination Fix Report). Full classification in §30.

**What is temporary/obsolete right now, independent of any future decision:** nothing in group A or C is temporary — it is the real, load-bearing implementation. The isolated `views_design_v2.py` endpoints and the `/dev/design-editor-v2` route are candidates for eventual removal once the editor's real UI absorbs whatever diagnostic value they still provide (see §28–29) — they are not currently obsolete, since the real editor still calls some of them (`design_v2_canvas_document`, `design_v2_canvas_element`) for its own live canvas building/refresh.

---

## 3. Historical Evolution

```
V1 shipped (3 static templates + 1 generic dynamic renderer,
  selected by exact-dict-equality against the seed)
  → real production use, real bugs accumulate silently
→ LANCERAOS_TEMPLATE_BUILDER_AUDIT.md (21 Aug): FAIL verdict.
  1 CRITICAL + 8 HIGH findings — wrong colors after edit (TB-001),
  broken resize, wrong fonts, a from-scratch dropped element that can
  hide the invoice number, a no-op save silently downgrading render
  quality (MISMATCH-7), a design delete nulling a frozen invoice's
  provenance (TB-007), zero E2E test coverage anywhere.
→ ARCHITECTURE_PLAN.md: a 10-phase plan to fix V1 IN PLACE.
→ Phases 0–5.6 (24 documents): NONE of it touched V1. All real work
  moved into an isolated, unreachable, `_v2`-suffixed parallel system.
  Genuinely good architecture (one renderer, no seed-equality branch,
  canvas reuses canonical geometry) but zero production impact —
  confirmed 0 real InvoiceDesign rows ever used it.
→ MASTER_BLUEPRINT.md (this session): named the two-track problem as
  the #1 strategic finding, proposed layout_mode, flagged "add a new
  element" as confirmed-absent by direct grep.
→ Streams 1–4 (this session): made V2 real.
  1. Persistence + rendering CUTOVER — the same InvoiceDesign CRUD
     endpoints v1 uses now validate/save v2 designs too; the same
     render_html_for_design dispatch point renders through v2 when
     schema_version==2. Migration mapper's 3 real bugs fixed.
  2. layout_mode: pinned|flow — content-driven growth for same-column
     chains (Notes/Terms, totals rows), renderer-only, canvas untouched.
  3. Element creation + duplication — closes the confirmed-absent
     capability; computed non-overlapping placement.
  4. Versioning + provenance — InvoiceDesignVersion and
     Invoice.rendered_design_snapshot, designed since Phase 0, wired
     for real; the TB-007 scenario directly regression-tested.
  Plus: DesignGallery entry point, "Show canonical reference" stale-
  state fix.
→ COMPLETION_REPORT.md: honest classification — real progress, real
  gaps (validation layers, multi-select, mobile, a newly-found
  pagination defect).
→ PAGINATION_FIX_REPORT.md (this session): root-caused and fixed the
  multi-page content-loss defect — `position:absolute` content is never
  fragmented across pages by WeasyPrint, independent of any prior
  change. Fixed by converting the flow region to real CSS document
  flow (header stays absolutely positioned and bounded); zero schema
  change; V1 untouched.
→ THIS DOCUMENT: architectural reset — full reconstruction + final
  product definition, before any further implementation.
```

**Judging each major decision against final-product requirements:**

| Decision | Still correct? | Verdict |
|---|---|---|
| One canonical renderer, no seed-equality branch | Yes — this is the single most important structural property of the whole system | **Keep, non-negotiable** |
| Canvas reuses canonical renderer's geometry functions directly | Yes — the discipline that prevents editor/renderer drift | **Keep, non-negotiable** |
| `header`/`flow` as two element lists | Yes, now doing real work again (pagination fix revived it for exactly the right reason) | **Keep** |
| `layout_mode: pinned\|flow` | Yes, proven correct by golden tests + dedicated pagination tests | **Keep, extend coverage** |
| Real persistence via the *same* InvoiceDesign endpoints (not a parallel v2 API) | Yes — avoids exactly the duplicated-mechanism problem the Blueprint criticized elsewhere | **Keep, non-negotiable** |
| `InvoiceDesignVersion` on every real content change | Yes, tested, correct semantics (skip no-op saves) | **Keep** |
| Snapshot-at-finalize for provenance | Yes — directly fixes the worst historical bug | **Keep, non-negotiable** |
| GrapesJS as the canvas engine | Workable but has cost the project real time repeatedly (resize-commit bug, selector-manager class-vs-id bug, resize/drag desync, no zoom-awareness) | **Re-evaluate in §9, not an automatic keep** |
| `views_design_v2.py`'s isolated endpoints as a *second* API surface alongside the real CRUD endpoints | Was correct when isolated; now a real, if small, duplication now that real persistence exists | **Consolidate — see §26/§28** |
| `DesignEditorV2.jsx` as one 1,071-line file mixing real UI and dev diagnostics | Was correct for an isolated sandbox; not correct for a real, shipped editor | **Rework — see §9/§28** |
| A design-time canvas that never groups pagination chains (fixed geometry preview) | Correct trade-off, but must be explicit/communicated to the user, not silent | **Keep the trade-off, add the communication (§11)** |

---

## 4. Current V2 Architecture (as it stands today)

```
InvoiceDesign (shared model, real DB table)
  .design_data: JSONField — either legacy (no schema_version key) or {schema_version: 2, page, header, flow}
  .save() → InvoiceDesignVersion row iff design_data content actually changed

InvoiceDesignSerializer.validate_design_data(value)
  → get_schema_version(value) → dispatch:
      legacy  → design_schema.validate_design_data_schema      (v1, unchanged)
      2       → design_schema_v2.validate_design_data_schema_v2 (v2, real)

Real CRUD (apps/invoices/views.py, unchanged endpoints):
  GET/POST   /api/invoices/designs/
  GET/PUT/DELETE /api/invoices/designs/{id}/
  POST /api/invoices/designs/{id}/set-default/
  POST /api/invoices/designs/duplicate/          (v1 builtins only)

Real render dispatch (apps/invoices/pdf_generator.py):
  render_html_for_design(design, context, for_pdf)
    design_data.schema_version == 2 → design_renderer_v2.render_v2_design_html
    design_has_real_custom_data(design) → design_renderer.render_dynamic_design_html (v1)
    else → the 3 static templates (v1)

_effective_design(invoice)
    status != draft AND rendered_design_snapshot exists → _FrozenDesignSnapshot(snapshot)
    invoice.design_id → invoice.design (live FK)
    status == draft → user's current default design (live)
    else → None

design_renderer_v2.render_v2_design_html(design_data, context, for_pdf)
  1. validate_design_data_schema_v2 (hard fail, no partial render)
  2. header.elements  → _prepare_header_region  → position:absolute, free-form, bounded
  3. flow.elements    → _prepare_flow_region     → real CSS document-flow rows (the pagination fix)
       _group_into_render_chains   (same-column layout_mode:'flow' runs → one chain)
       _group_chain_items_into_rows (shared-y chains/singles → one flex row, side-by-side support)
  4. sidebar elements → position:fixed, unchanged, simple per-element path
  5. → invoices/v2/canonical_v2.html

design_canvas_v2.py (editor-facing, UNCHANGED by the pagination fix):
  build_v2_canvas_document → simple per-element prepare, position:absolute for every element,
    header and flow both, no chain/row grouping — a deliberate, documented design-time
    APPROXIMATION, never the real render-time layout.

Frontend (frontend/src/pages/design-editor-v2/DesignEditorV2.jsx):
  isRealMode = (URL has a real :id param) — the SAME component serves both:
    /dev/design-editor-v2         (isolated sandbox, no real save, still exists, untouched)
    /invoices/designs-v2/:id/edit (real: loads/saves through the real API)
  GrapesJS-based canvas: select/drag/resize/undo-redo/add-element/duplicate/delete,
    a real StylePanel, a "Show canonical reference" live-preview iframe.
```

---

## 5. Existing LanceraOS/V1 Integration Analysis

Every point where V2 code is reachable from, or reaches into, the pre-existing product:

| Integration point | Direction | What actually happens |
|---|---|---|
| `pdf_generator.render_html_for_design` | V2 → shared | The one dispatch function every real PDF/portal/preview render call already went through; now has a 3rd branch. V1's own two branches are byte-for-byte unchanged (confirmed by the full pre-existing v1 test suite passing unmodified). |
| `pdf_generator._effective_design` | V2 → shared | Now snapshot-aware; a v1 invoice with no snapshot (everything finalized before this fix) falls through to the exact pre-existing behavior. |
| `InvoiceDesignSerializer.validate_design_data` | V2 → shared | Dispatches by schema_version; a v1 payload (no key) takes the exact original code path unchanged. |
| `InvoiceDesign.save()` | V2 → shared | Now also writes a version row on real content change — applies to v1 designs too (harmless; they simply also get version history now, which nothing currently reads for v1 but is not destructive). |
| `Invoice.rendered_design_snapshot` / `InvoiceDesignVersion` | New, additive | Migration `0011` is pure `AddField`/`CreateModel` — no `AlterField`, no data migration, no risk to existing rows. |
| `design_schema.boxes_overlap` | V1 → V2 (reused) | V1's own overlap check still calls this function under its new public name; behavior for v1 callers is unchanged (the added epsilon only matters for the specific near-zero-gap case, tested not to break any v1 case). |
| `design_preview.py` | V2 → shared | Already called `render_html_for_design`; a v1 or v2 design both flow through the same gallery-preview mechanism now — a v2 design's gallery card genuinely shows real v2 output for the first time. |
| `DesignGallery.jsx` | V2 → shared (UI) | One shared page for both v1 and v2 designs; `handleEdit` branches by `design_data.schema_version`. |
| `apps/invoices/urls.py` | Additive | 5 new isolated routes; no existing route changed or removed. |
| `apps/invoices/design_schema.py` | Pre-existing, not this session | The `boxes_overlap` rename/epsilon predates this whole session's work (confirmed by git blame timing relative to session start). |

**No integration point does any of the following:** alters existing invoice rendering for an invoice that isn't explicitly assigned a v2 design; corrupts existing `InvoiceDesign` rows (every v1 row's `design_data` shape is read, never rewritten, by anything in V2); changes any existing API's request/response contract (only additive fields/routes); changes database semantics for any existing table beyond two purely additive structures.

---

## 6. Isolation & Safety Boundary

| Integration point | Classification |
|---|---|
| `render_html_for_design`'s new v2 branch | **SAFE** — gated strictly on `schema_version == 2`, a value that exists on zero real rows unless a user explicitly creates one through the new opt-in editor |
| `_effective_design`'s snapshot read | **SAFE** — additive branch, falls through identically when no snapshot exists (100% of pre-cutover invoices) |
| `InvoiceDesignSerializer` version dispatch | **SAFE** — legacy path byte-identical to before |
| `InvoiceDesign.save()` version-writing | **SAFE WITH GUARD** — the guard (skip if content unchanged) is what keeps this from being a performance/storage concern at scale; must remain a hard requirement, not an optimization to defer |
| `boxes_overlap` shared utility | **SAFE** — pre-existing, tested against v1's own 66+ overlap tests with zero regression |
| `views_design_v2.py`'s isolated endpoints | **UNNECESSARY (partially)** — `design_v2_preview`/`design_v2_builtins_list`/`design_v2_builtin` were built for an isolated sandbox that no longer needs to be isolated; `design_v2_canvas_document`/`design_v2_canvas_element` remain genuinely necessary (the editor's own live document/content-refresh) |
| The dev-only route `/dev/design-editor-v2` | **MUST BE ISOLATED** (already is) — no nav link, gated by PrivateRoute, but should not be confused with a real product surface; a candidate for removal once the real editor's own diagnostic needs are met some other way (§28) |
| `design_migration.py` | **SAFE** — pure function, never called against a real row by anything in the current system; **DANGEROUS if ever wired into an automatic bulk-migration job without the explicit approval gate this document's §15/§35 requires** |
| Any future "make v2 the default for all users" switch | **DANGEROUS if not explicitly gated** — must remain an opt-in choice per §15 until a real soak period and explicit sign-off |

**Design principle for the final architecture, stated explicitly per the audit's own requirement:** *existing LanceraOS functionality remains unchanged unless an explicitly approved V2 cutover is required.* Every integration point above already satisfies this; the final architecture must preserve it as new work is added (in particular: no future workstream may make v2 the *default* render path without a dedicated, separate approval step — see §35).

---

## 7. Final Product Definition

Template Builder 2.0, finished, is: **a real invoice-design editor a freelancer can open, build a custom design in from a blank canvas or a starting template, style, save, and have that exact design govern every invoice generated against it — reliably, for arbitrarily long real content, indefinitely, even after the design itself is later changed or deleted.**

The complete journey, as it must work end to end:

```
Design Gallery
  → "Try the new design editor" (or open an existing v2 design)
→ Editor opens (real design, or a real builtin as a starting point)
→ Canvas: add elements, select, move, resize, duplicate, delete, style
→ Save (real persistence — the same InvoiceDesign a v1 design uses)
→ Set as default (or leave as a named, reusable design)
→ A new invoice is created → its design is resolved at creation
→ Invoice is finalized → design_data + base_template + color_variant
    frozen into Invoice.rendered_design_snapshot, forever
→ PDF requested → render_invoice_pdf → v2 canonical renderer, real
    bindings, real pagination
→ Client opens the portal link → render_invoice_portal_html → same
    renderer, same content, same pagination logic (HTML has no "pages"
    but must show 100% of the same content)
→ Weeks later, the freelancer edits or deletes the original design
    → the already-sent invoice is completely unaffected (reads its own
      frozen snapshot, never the live design)
```

Every step above already works today for the happy path. The gaps (§26) are about *completeness* of the editor experience (multi-select, semantic validation, mobile), not about whether the pipeline itself is sound.

---

## 8. Final UX Architecture

**Application shell:**
- Header: design name (editable inline), Save (with a real, visible save-status indicator: idle / saving / saved / error — never silent), Back to Design Gallery.
- Toolbar: template/variant selector (only meaningful for a fresh design not yet diverged from a builtin), zoom, Undo/Redo, Add Element, Duplicate/Delete (context-sensitive to selection).
- A single, real "Unsaved changes" indicator (already built) that becomes false immediately after a successful save.
- **Exit-with-unsaved-changes**: currently unhandled — the browser's native "leave site" warning is not wired to the dirty-state flag. This must be built (a `beforeunload` handler gated on the same `dirty` boolean the toolbar already tracks) — a real, currently-open gap (§26).
- Preview: "Show canonical reference" already exists and now reflects live edits (fixed this session) — this becomes the shell's own primary Preview action, not a secondary diagnostic tool.

**Complete user journey (per the audit's own required list), current status marked:**

| Step | Status |
|---|---|
| Design Gallery → create/open template | **Built** |
| Editor → canvas | **Built** |
| Add elements | **Built** (5 generic types + duplicate) |
| Select elements | **Built** |
| Move | **Built** |
| Resize | **Built** |
| Duplicate | **Built** |
| Delete | **Built** |
| Configure (bindings, labels) | **Built** |
| Style | **Built** (font/color/weight/align/opacity/border-radius/pill-color/columns) |
| Arrange (multi-select, alignment guides, z-order beyond delete order) | **Not built** |
| Preview | **Built** |
| Save | **Built** (real persistence) |
| Version | **Built** (automatic, not yet user-facing — no rollback UI) |
| Assign | **Built** (set-default; per-invoice override still absent, matching v1's own long-standing gap) |
| Invoice → PDF | **Built**, including real pagination |
| Portal | **Built** |

---

## 9. Final Editor Architecture

**The single most important structural decision for the editor itself: split `DesignEditorV2.jsx` (1,071 lines today) into a real production component and a genuinely separate diagnostic/dev harness**, rather than one file serving both audiences via an `isRealMode` boolean sprinkled through the render tree. Concretely:

- `DesignEditor.jsx` (real) — the production editor: canvas, toolbar, StylePanel, Add Element panel, Save/name/back — everything a real user needs, nothing else.
- `DesignEditorDevHarness.jsx` (or simply keep the existing file, renamed, for the `/dev/...` route only) — the verification tooling (zoom-level debug buttons, "Reload from serialized," the verification log) that has real value for continued engineering work but should never ship inside the production bundle path a real user's browser loads for the real route.
- Both share the same underlying hooks/lib (`serialization.js`, `componentTypes.js`, `canvasApi.js`, `constants.js`) — no logic duplication, only UI-surface separation.

**GrapesJS re-evaluation (flagged, not decided — §35):** across this project's history, GrapesJS has required at least 4 distinct internal-bug workarounds (broken resize-commit path, SelectorManager class-vs-ID collision, resize/drag view/model desync, no zoom-awareness in resize handles). Each was fixed correctly, but the pattern itself is a signal. The final architecture does **not** mandate replacing GrapesJS — the schema is now fully stable, which is exactly the condition under which a smaller, purpose-built canvas (a plain SVG/DOM drag-resize layer, since the actual interaction surface needed — free 2D positioning, 8-handle resize, no rich text editing, no nested component trees — is narrow) becomes a realistic, lower-risk alternative. This is a genuine build-vs-keep decision requiring product sign-off, not something to decide unilaterally in this document.

**Editor state (detailed further in §16):** `designData` (the authoritative, currently-loaded-or-edited JSON, same shape as persistence), `canvasDoc` (the backend-computed rendering of it — geometry, CSS, content HTML per element), GrapesJS's own internal component tree (derived from `canvasDoc`, the single source the user directly manipulates), and a thin layer of pure-UI state (selection, zoom, dirty flag, save status). **Undo/redo** is GrapesJS's own `UndoManager` — not reimplemented — covering every canvas mutation (drag/resize/add/duplicate/delete/style change) uniformly.

---

## 10. Final Element Architecture

The current type registry (`design_schema_v2.py`) is the correct starting point and should not be arbitrarily expanded. 14 real types across 3 kinds:

**Semantic (10):** `logo`, `business_info`\*, `client_info`\*, `dates`\* (header-only, all decomposed into generic `text` in the actual seeds — the schema still names them as legacy-compatible types, not because a design author picks them directly), `totals`, `notes`, `signature`, `payment_info`, `qr_code`, `online_payment_link` (flow-only).

**Generic (5):** `text` (optionally bound via the closed 26-entry `SUPPORTED_BINDINGS` allow-list), `image`, `rectangle`, `divider`, `container`.

**Structural (1):** `table` — exactly one required per design, non-deletable, real InvoiceItem-bound content.

For every type, the contract that already exists and must remain the target:

| Property | Rule |
|---|---|
| Data source | Real invoice/business/client fields only, via the closed binding allow-list — never arbitrary expression evaluation |
| Geometry | x/y/width/height in mm, always; `layout_mode` optional (`pinned` default, `flow` opt-in) |
| Style | `style` (template default) + `overrides` (user edit) — see §11 |
| Renderer behavior | One shared `prepare_element`/`_v2_element_content.html` path for canonical, canvas, and (via `chain_member`) pagination-region rendering — never a second implementation |
| PDF vs portal behavior | Identical content and layout; only font-URL scheme differs (`file://` vs `/static/`) |
| Pagination behavior | `pinned`: never grows, participates in document flow for *position* only; `flow`: real content-driven height, can push same-row/same-chain siblings and span pages |

**Element creation lifecycle (already built):** pick type (+ binding, if `text`) → compute a real, non-overlapping default position (below existing content) → fetch real content via the same live-refresh endpoint the style panel uses → append as a real GrapesJS component → select it. This remains correct; the only gap is that it only inserts into the `flow` list today — inserting into `header` (for a genuinely custom header layout) is not built and is a real, open product question (§35: is free-form header composition actually wanted, or is header deliberately meant to stay "the 4 identity fields, decomposed, nothing more"?).

---

## 11. Final Style Architecture

**The precedence model, already implemented and correct as far as it goes:**

```
theme (color_variant, resolved once per design via resolve_design_colors)
  → element `style` (template/seed default)
    → element `overrides` (explicit user edit)
```

`resolve_style_value(element, key, default)`: `overrides[key]` wins over `style[key]` wins over `default`. `resolve_theme_color(value, context)`: the literal sentinel strings `'theme_primary'`/`'theme_secondary'` resolve to the design's live-resolved colors; anything else (a real hex the user picked) passes through unchanged.

**One authoritative rule, already true today, and the final architecture's hard requirement going forward:** the editor canvas, the canonical HTML renderer, the PDF renderer, and the portal all call the exact same `resolve_style_value`/`resolve_theme_color`/`prepare_element` functions — there is no second, competing style-resolution implementation anywhere in the codebase, and none should ever be introduced. The one narrow exception, already documented and acceptable: the canvas's own `parseCssDeclarations` (frontend) parses the *already-resolved* CSS string the backend computed, rather than re-resolving from scratch — this is display plumbing, not a second resolution algorithm.

**What is not yet built, and should be a deliberate, scoped decision rather than silently expanded:** a fourth cascade layer ("template defaults" as a concept distinct from the seed's own `style` dict) was named in the original architecture plan but deliberately not built (Phase 5.6's own documented non-goal) — the 3-layer model above has proven sufficient for every real bug found so far (including the TB-001-class color bugs closed in Phase 5.6). **Recommendation: do not add a 4th layer unless a concrete, real requirement demonstrates the 3-layer model is insufficient** — this is exactly the kind of premature abstraction the project's own engineering discipline warns against.

---

## 12. Final Layout Architecture

The pagination fix (this session) is the target architecture, re-evaluated here rather than assumed:

- **Header region**: absolutely positioned, free-form 2D, bounded by its own real computed height (`max(y+height)` across header elements), wrapped in one ordinary (`position: relative`, not `absolute`) box — a genuine in-flow sibling of the flow region below it.
- **Flow region**: every flow element — `pinned` or `flow` alike — renders inside a real CSS flex row (never `position: absolute`). Same-column consecutive `flow`-mode runs become one chain (real document-flow growth within the chain); shared-y chains/singles become one multi-item row (real side-by-side layout, e.g. Notes/Terms beside Payment Methods). Rows stack via real `margin-top` derived from the same x/y/width/height numbers `design_data` already stores.
- **Table**: a real `<table>` element, `layout_mode: 'flow'`, no fixed CSS height — genuinely paginates row-by-row via WeasyPrint's own native table-fragmentation support (verified directly, header optionally repeating).
- **Sidebar**: unchanged, `position: fixed`, real-page-repeating, bounded by design convention (Modern's logo/business-name/QR/pay-link) — never needs pagination.

**Re-evaluation verdict: this is the correct final architecture, not merely an acceptable interim fix.** It required zero schema change (every element's x/y/width/height keeps its existing meaning), preserved 100% of existing golden-test fidelity, and is proven by direct, rigorous measurement (not assumption) to eliminate real content loss across every tested case (1 page through 4+ pages, single and combined overflow, all 3 templates).

**Guarantee the final architecture provides:** *no user content silently disappears.* This is now true for the table and every flow element. It is **not yet true for header content** — a pathologically long business name or client address could still overflow the header's own fixed, bounded box. This is a real, explicitly named open item (§26, §35): is a bounded header an acceptable, permanent product constraint (matching this system's entire history of treating header fields as short-by-convention), or does the final product need header overflow protection too? This is a product decision, not an engineering default.

**What happens when content cannot fit at all** (e.g., a single element wider than the page): currently, the schema's own `_validate_page_bounds` rejects this at save time (a hard 400/validation error, never a silent corruption) — this remains correct and should not change.

---

## 13. Final Pagination Architecture

(Consolidating §12's mechanism with the specific guarantees the audit requires.)

- **Page creation**: driven entirely by real CSS document flow — WeasyPrint creates as many pages as the real, rendered flow-region content needs. No manual page-counting or Python-side height measurement is involved anywhere.
- **Page breaking / content continuation**: standard CSS fragmentation — text wraps and continues across pages; a `<table>`'s rows may fall across a page boundary, with WeasyPrint's native `thead` repetition available if a future design wants it (not currently configured, a real, cheap enhancement — §26).
- **Table header repetition**: not yet explicitly enabled (`display: table-header-group` is CSS-standard for this and was proven working in the audit's own isolated experiment) — a small, low-risk, high-value addition for the next workstream.
- **Minimum vs. dynamic heights**: `pinned` = fixed (its own declared height is authoritative, forever); `flow` = the declared height is a minimum only, real content may exceed it.
- **Row/collision rules**: a `pinned` row never moves relative to its own chain, but its *page position* can legitimately shift to a later page if enough real flow content precedes it — this is the correct, honest consequence of the fix (verified directly: 8 real line items on Professional's template now correctly needs 2 pages instead of silently overlapping the totals block beneath it).
- **Multi-page behavior guarantee**: verified directly for 1, 2, 3, and 4+ pages, for Notes alone, Terms alone, both combined, and combined with an oversized table, across all 3 templates.

---

## 14. Final Data Model

The `design_data` JSON shape (schema_version 2) is final as it stands; changes should be additive-only.

```
{
  "schema_version": 2,
  "page": {
    "size": "A4",                          # required, string
    "width_mm": 210, "height_mm": 297,      # required, > 0
    "margin_top_mm": 16, "margin_right_mm": 16,   # optional, default per-renderer constants
    "margin_bottom_mm": 16, "margin_left_mm": 20, # optional
    "sidebar": { "width_mm": 42, "color": null }  # optional; null color = use theme
  },
  "header": { "elements": [ <element>, ... ] },   # free-form, bounded, non-paginating
  "flow":   { "elements": [ <element>, ... ] }     # real document-flow, paginating
}

<element> = {
  "kind": "semantic" | "generic" | "structural",   # required
  "type": "<one of the 14 real types>",            # required, must match `kind`
  "x": <mm, number>, "y": <mm, number>,             # required — design-time position
  "width": <mm, >0>, "height": <mm, >0>,            # required — design-time size (a minimum for layout_mode:'flow')
  "style": { ... },                                  # required dict — template/seed defaults
  "overrides": { ... },                              # required dict — explicit user edits, wins over style
  "binding": "<one of 26 SUPPORTED_BINDINGS>" | null, # optional, `text` only
  "layout_mode": "pinned" | "flow"                    # optional, default "pinned"
}
```

Ownership/persistence: the whole JSON blob lives in `InvoiceDesign.design_data` (unchanged field, shared with v1). Every save writes a new `InvoiceDesignVersion` row iff the content changed. At invoice finalize, `{base_template, color_variant, design_data}` — the complete rendering recipe — is deep-copied into `Invoice.rendered_design_snapshot`, forever immutable from that point.

**Is the current schema sufficient for the final product?** Yes, for everything currently in scope. The one gap named honestly: there is no `is_published`/draft-state field on `InvoiceDesign` itself (§21) — if the Draft/Publish distinction from the original architecture plan is approved, this is the one real, additive field the schema would need (`InvoiceDesign.status` or similar) — **not implemented, flagged for explicit approval (§35).**

---

## 15. Final Backend Architecture

Responsibilities, kept deliberately simple — no new layer is proposed beyond what already exists cleanly:

| Layer | Owns |
|---|---|
| **Models** (`models.py`) | `InvoiceDesign` (data + version-writing on save), `InvoiceDesignVersion` (immutable history), `Invoice.rendered_design_snapshot` (frozen provenance) |
| **Serializers** (`serializers.py`) | `InvoiceDesignSerializer` — version-dispatched validation, the one real gate a save must pass |
| **Schema validators** (`design_schema.py` / `design_schema_v2.py`) | Pure structural validation functions, no I/O, no side effects |
| **Renderer** (`design_renderer_v2.py`) | The one canonical HTML/PDF-content generator; no persistence, no validation beyond its own hard-fail-on-invalid-input guard |
| **Canvas adapter** (`design_canvas_v2.py`) | Editor-facing JSON shaping only; reuses renderer functions, never reimplements them |
| **Views** (`views.py`, `views_design_v2.py`) | HTTP concerns only — auth, rate limiting, request/response shape; delegates all real logic to the layers above |
| **Migration** (`design_migration.py`) | Pure, offline, never-automatically-invoked conversion function |
| **Management commands** | Read-only reporting/backup tooling |

**API endpoints, final state:**
- Real, shared CRUD (unchanged from today): `GET/POST /api/invoices/designs/`, `GET/PUT/DELETE /api/invoices/designs/{id}/`, `POST /api/invoices/designs/{id}/set-default/`, `POST /api/invoices/designs/duplicate/`.
- V2-specific, still needed: `POST /api/invoices/designs/v2-canvas/` (live document build), `POST /api/invoices/designs/v2-canvas-element/` (live content refresh).
- V2-specific, candidates for consolidation once the dev-only sandbox route is retired: `design_v2_preview`, `design_v2_builtins_list`, `design_v2_builtin` (§28).

**Concurrency/optimistic locking:** not currently implemented for design edits (two browser tabs editing the same design could silently clobber each other on save — the same class of gap the original architecture plan named under "concurrency/data-loss testing"). Real risk is low today (single-user editing is the overwhelmingly common case) but should be named as an open item, not silently assumed safe (§26).

**Auditability:** `InvoiceDesignVersion` already provides real history; no dedicated `core.AuditLog` event fires for a design edit (matching the model's own documented reasoning — a design edit isn't a security/finance-relevant action the way an invoice status transition is). This remains a deliberate, reasonable choice, not a gap.

---

## 16. Final Frontend Architecture

**State categories, kept distinct (the current implementation already mostly respects this; the split proposed in §9 makes it explicit):**

| State | Where it lives | Nature |
|---|---|---|
| `designData` | React state, `DesignEditor.jsx` | The authoritative, serializable design — same shape as persistence |
| `canvasDoc` | React state | Backend-computed rendering of `designData` (geometry/CSS/content) — regenerated on load, template/variant change |
| GrapesJS component tree | GrapesJS's own internal model | The live, directly-manipulated canvas — built from `canvasDoc`, read back into `designData` on save via `extractV2DesignDataFromEditor` |
| Selection / zoom / dirty / save-status | Local React state | Pure UI, never persisted |
| `name` / `savedDesignId` | Local React state | Real-mode-only persistence bookkeeping |

**Change propagation:** every canvas mutation (drag/resize/style/add/duplicate/delete) is a GrapesJS component-tree mutation; `UndoManager` tracks all of them uniformly; "Save" serializes the *current* tree state (never the stale load-time state — this was a real, fixed bug this session) and POSTs/PUTs it through the real API.

**No duplicated state representation exists today** beyond the necessary GrapesJS-tree ↔ `designData` translation boundary (which is the serialization layer's entire purpose, not duplication). This should remain the standard going forward — any future feature (multi-select, alignment guides) must extend this same model, not introduce a second parallel one.

---

## 17. Final Renderer Architecture

One function, `render_v2_design_html(design_data, context, for_pdf)`, is the canonical renderer for every real output:

```
render_invoice_pdf        → render_html_for_design(design, build_pdf_context(...), for_pdf=True)
render_invoice_portal_html → render_html_for_design(design, build_portal_context(...), for_pdf=False)
design_preview.py          → render_html_for_design(design, build_preview_context(...))  (gallery cards)
views_design_v2.design_v2_preview → render_v2_design_html directly (isolated diagnostic tool)
```

`for_pdf` selects `file://` vs `/static/` font URIs — the *only* difference between the PDF and portal/HTML output paths. Pagination, content, styling, and bindings are identical between them by construction (there is only one render function). This is the correct final architecture and should never be allowed to drift into two separate implementations.

---

## 18. Persistence Architecture

Already final: the real, shared `InvoiceDesign` CRUD (§15) is the single persistence path for both v1 and v2 designs. No parallel v2-only persistence API exists or should be built. `InvoiceDesignSerializer` is the one validation gate; `InvoiceDesign.save()` is the one place version history is written.

---

## 19. Versioning & Provenance

```
InvoiceDesign.design_data  (the LIVE, current, editable state)
  → InvoiceDesign.save() → InvoiceDesignVersion(version_number=N+1, design_data=<snapshot>)
       (only when content actually changed — never a no-op duplicate)

Invoice created  → design resolved (live default, or draft fallback)
Invoice finalized → {base_template, color_variant, design_data} deep-copied into
                     Invoice.rendered_design_snapshot — IMMUTABLE from this instant

pdf_generator._effective_design(invoice):
  status != draft AND snapshot exists → read the SNAPSHOT, ignore the live design entirely
  otherwise → live design (draft-only convenience, or pre-fix legacy invoices)
```

**Explicit guarantee, directly regression-tested:** editing or deleting `InvoiceDesign` after an invoice has been finalized against it cannot change that invoice's own rendered output, ever — confirmed by a real test that deletes the design after finalize and verifies the snapshot (not the now-null live FK) still drives rendering correctly.

**What is not yet built:** a user-facing rollback UI for `InvoiceDesignVersion` (the data exists; there is no "restore version N" button or endpoint). A real, scoped, low-risk addition for a future workstream (§31), not required for the pipeline's own correctness.

---

## 20. Migration Architecture

`design_migration.py`'s `migrate_v1_to_v2` is pure, deterministic, and now correctly converts all 3 real builtin templates (3 real bugs fixed this session: paired-width doubling, header right-edge overflow, missing sidebar propagation). It is **never invoked against a real `InvoiceDesign` row today** — its only real call sites are the read-only audit management command and the isolated preview endpoint's in-memory conversion.

**What remains before any real bulk migration could responsibly happen:**
- A real, human-reviewed decision on *when* (not automatically, not silently) a real user's existing v1 design gets offered migration, per the Blueprint's own §B.8 cutover plan (opt-in, with a real before/after visual comparison shown to the user — not built).
- Validation that migrated output visually matches the original closely enough (the golden-test methodology already exists and could be pointed at real user designs, but hasn't been).
- Idempotency: re-running migration on an already-v2 design is already handled (`migrate_v1_to_v2` passes through unchanged with a warning) — this part is done.
- Rollback: since migration is never automatic and never destructive (it produces a *new* payload, never overwrites in place until a human explicitly saves it), there is no "rollback" concept needed beyond simply not saving the migrated result.

**This remains explicitly out of scope until a dedicated workstream and explicit approval (§35).**

---

## 21. Validation Architecture

`design_validation.py`'s 4-layer shape is correct and should be completed, not replaced:

| Layer | Status | What it checks |
|---|---|---|
| A — Schema | **Real** | Structural validity (`design_schema_v2.validate_design_data_schema_v2`) — required keys, types, overlap, page bounds |
| B — Layout | **Stub** | Would catch anything Layer A's overlap/bounds checks don't (currently: nothing left uncaught for the cases tested) |
| C — Semantic | **Stub** | Would enforce: a visible invoice number, issue date, seller identity, client identity, the table, and totals must all actually be present and bound — before a design is considered "real enough to use" |
| D — Renderability | **Stub** | Would do a real dry-run render against representative (not just short) sample data as a final gate |

**Client-side vs. server-side:** the server (Layer A today) is authoritative and must remain so — the editor may add client-side hints (e.g., the existing overflow-warning outline) but must never be trusted as the actual gate.

**What remains undecided:** whether Layers B/C/D gate on *every save* (today's model — every save is immediately usable) or only on a new, explicit "Publish" action (the original architecture plan's own proposal, requiring a new `InvoiceDesign.status` field). **This is the single largest open product decision in this whole document — see §35.**

---

## 22. Security Architecture

**Real risks in this product, addressed:**
- Cross-user design access: every real CRUD endpoint scopes by `user=request.user` (unchanged v1 convention, applies identically to v2 designs).
- The isolated v2 canvas endpoints never fetch by ID from the database — `design_data` always travels in the request body — so there is structurally no cross-user leak path there, verified by a dedicated test.
- Binding safety: the closed 26-entry allow-list, resolved via fixed lambdas reading known-safe attributes — never arbitrary attribute traversal or code execution on user-supplied strings. This remains correct and must never be relaxed into a generic expression language.
- Malformed payloads: `V2RenderError`/schema validation reject explicitly rather than partially rendering or crashing.
- Version tampering: `InvoiceDesignVersion` rows are never user-writable directly (no endpoint exposes them for write) — only ever created by the model's own `save()` override.

**Not currently addressed, and should be named rather than assumed:**
- No optimistic-locking/concurrent-edit protection (§15) — a real, if narrow, "unauthorized-by-race-condition overwrite" risk between two legitimate sessions of the same user.
- No rate limit specifically tuned for the new real save endpoints beyond the existing shared `_check_moderate_rate_limit` (30/hour) — adequate for a real user's own editing pace, not a new risk.

No speculative security architecture is proposed beyond these — the binding allow-list and per-user scoping already address the real, concrete risks specific to this feature.

---

## 23. Error/Failure Architecture

| Operation | Current behavior | Target (if different) |
|---|---|---|
| Save fails (network/validation) | Real error surfaced in the toolbar (`saveStatus: 'error'`, message shown) | Keep; add retry affordance |
| Render fails (schema-invalid design reaches a real invoice — should be structurally impossible post-validation) | Hard `V2RenderError`, never a partial/blank page | Keep |
| PDF generation fails | Existing self-heal chain (re-upload, retry, live-render fallback) — unrelated to v2 specifically, already robust | Keep |
| Migration fails | Returns `{success: False, errors: [...]}`, never partial output | Keep |
| Missing binding target (e.g., client has no phone) | Resolves to an empty string, never an exception | Keep |
| Concurrent edit (two tabs) | **Undefined today** — last save wins silently | **Open gap — name to the user, do not silently assume safe (§26)** |
| Browser refresh with unsaved changes | **No warning today** (§8) | **Build a `beforeunload` guard — real, scoped, low-risk addition** |

**Guiding principle for the final product, stated as a hard requirement:** the user must never be left wondering whether their work was saved — every save action must resolve to a clearly visible success or failure state, and any destructive navigation with unsaved changes must be interceptable.

---

## 24. Testing Architecture

The layered strategy already substantially exists; this section defines the target, not a rewrite.

- **Unit** (existing, extend): schema validation, geometry/chain/row grouping, binding resolution, migration mapping — all pure-function, already well-covered.
- **Integration** (existing, extend): real API save/load round trips, real DB `InvoiceDesign`/`InvoiceDesignVersion`/`Invoice.rendered_design_snapshot` behavior.
- **Frontend** (existing, extend): the lightweight fake-editor unit-test strategy already established for `serialization.js` — correct and sufficient for pure data-layer logic; not a substitute for real interaction testing.
- **Renderer** (existing, extend): real WeasyPrint + PyMuPDF measurement — proven far more trustworthy than "the function didn't raise" (this session's own pagination investigation is the clearest example of why).
- **End-to-end**: **genuinely missing.** No `@playwright/test` dependency exists; every "browser verification" claim across this project's history was either a live, ephemeral session (not repeatable, not CI-enforced) or explicitly disclosed as unavailable (as in this session). **This is a real, standing gap — see §31, workstream 12.**
- **Regression** (existing v1 suite): must continue to run, unmodified, on every future change — the one non-negotiable safety net for "V2 work didn't break the existing product."
- **Data integrity** (existing, extend): the version/snapshot tests already directly regression-test the TB-007 scenario; extend to cover concurrent-edit behavior once §15/§22's open gap is resolved.
- **Pagination** (existing, extend): the 15 new tests this session are the real baseline; extend to Minimal/Modern-specific edge cases and to the still-open header-overflow question once §12/§35 is resolved.
- **Security** (existing, extend): cross-user isolation already tested; extend if/when concurrent-edit protection is built.
- **Visual validation, editor vs. canonical**: the golden-position PyMuPDF methodology is the right tool and should remain the standard — real browser screenshot comparison remains unavailable without live browser access.

**Acceptance criteria for "testing is sufficient" going forward:** every workstream in §31 must ship with tests at the layer(s) appropriate to its own risk — a pure backend change needs backend tests; anything touching real user interaction (drag, multi-select) needs either real Playwright coverage (once adopted) or an explicit, honest disclosure that only the data layer was verified.

---

## 25. File/Module Architecture

**Final target directory shape (backend, `apps/invoices/`):**

```
design_schema.py         # V1 — keep until V1 retirement (§29)
design_schema_v2.py       # KEEP — the v2 contract
design_seeds.py           # V1 — keep until retirement
design_seeds_v2.py        # KEEP
design_renderer.py        # V1 — keep until retirement
design_renderer_v2.py      # KEEP — the canonical renderer
design_canvas_v2.py        # KEEP — editor adapter
design_migration.py        # KEEP — pure converter
design_validation.py       # KEEP — complete Layers B/C/D here, not a new module
design_preview.py          # KEEP — shared gallery-preview mechanism
views.py                   # KEEP — real CRUD lives here
views_design_v2.py         # REWORK — consolidate/trim per §28 once sandbox retires
views_portal.py            # V1/shared — unaffected
pdf_generator.py           # KEEP — the one real dispatch point
```

**Frontend target shape:**
```
pages/design-editor/DesignEditor.jsx           # V1 — keep until retirement
pages/design-editor-v2/DesignEditor.jsx         # REAL production editor (rename/split from today's file, §9)
pages/design-editor-v2/DesignEditorDevHarness.jsx  # dev-only diagnostic tooling, split out
pages/design-editor-v2/StylePanel.jsx            # KEEP
lib/designEditorV2/{constants,serialization,componentTypes,canvasApi}.js  # KEEP, shared by both editor variants
```

**Files/documents to keep, rework, merge, or delete are detailed by name in §27–29 and §30** — not repeated here to avoid duplication.

---

## 26. Current Problems That Must Be Resolved

Ranked by real user impact, not by engineering elegance:

1. **No semantic/renderability validation gate (§21)** — a design can be saved and set as default even if it has no visible invoice number or client identity. Real risk: a freelancer ships a broken invoice without warning.
2. **No multi-select / alignment guides / snapping** — a real, named UX gap for building anything beyond simple layouts.
3. **Mobile editor scope undecided and currently broken** — no product decision has ever been made about what mobile should do here.
4. **Header content has no overflow protection** — the one remaining place content can still silently overflow its own box (though bounded, per convention).
5. **No concurrent-edit protection** — two tabs, last write wins, silently.
6. **No `beforeunload` guard for unsaved changes.**
7. **`DesignEditorV2.jsx` mixes production UI with dev diagnostics in one file** — a real maintainability and shipped-bundle-size concern, not just a style preference.
8. **GrapesJS's own internal bugs have cost real engineering time repeatedly** — worth a genuine build-vs-keep evaluation, not indefinite patching.
9. **No end-to-end browser test coverage** — every interaction-layer guarantee rests on either manual verification (not repeatable) or data-layer unit tests (not proof of real usability).
10. **Table header repetition (`thead` on every page) is not explicitly configured** — a small, cheap, high-value addition once a workstream reaches it.
11. **No rollback UI for `InvoiceDesignVersion`.**
12. **`views_design_v2.py`'s isolated preview/builtins endpoints duplicate what the real gallery/preview mechanism can now do directly** — a real, if minor, duplicated-mechanism concern.

---

## 27. Current Components That Should Be Preserved

- The one-canonical-renderer, no-seed-equality-branch principle (`render_v2_design_html`).
- Canvas-reuses-canonical-geometry-functions discipline (`design_canvas_v2.py`).
- The closed, hardcoded binding allow-list and its resolver dictionary.
- The 3-layer style cascade (`resolve_style_value`/`resolve_theme_color`).
- The header-region/flow-region split and the row/chain pagination mechanism.
- Real persistence via the shared `InvoiceDesign` model and endpoints (no parallel API).
- The version-on-real-change (not version-on-every-save) semantics.
- Snapshot-at-finalize provenance.
- The migration mapper's pure-function, never-automatic design.
- The golden-test (real PyMuPDF measurement) methodology for visual-fidelity claims.

---

## 28. Components That Should Be Reworked

- `DesignEditorV2.jsx` → split into a real production editor and a separate dev harness (§9, §25).
- `views_design_v2.py` → once the dev-only sandbox route is no longer needed for active engineering work, `design_v2_preview`/`design_v2_builtins_list`/`design_v2_builtin` should be reconsidered — either folded into the real preview mechanism (`design_preview.py` already does this job for real designs) or explicitly kept as engineering-only tooling, clearly labeled as such, not presented as product surface.
- `StylePanel.jsx`'s `capabilitiesFor` — a growing, ad hoc per-type/per-kind list; fine at its current size, but should be revisited if the element-type registry ever grows further (not urgent today).
- The `style.rows` / `style.sections` dual mechanism (totals-row filtering vs. notes/terms filtering) — two independently-named mechanisms doing the same conceptual job; should be generalized into one convention before a third one (e.g., for Payment Info decomposition, still deferred) is ever added.

---

## 29. Components That Should Be Removed

**Not now — only after V1 is fully retired, per the Blueprint's own §B.8 cutover plan (a real soak period, zero remaining V1 traffic, explicit sign-off):**
- `professional.html`, `minimal.html`, `modern.html`, `dynamic_design.html` (the 3 static templates + v1's generic renderer template).
- `design_renderer.py`, `design_seeds.py`, `design_schema.py` (v1's own modules) — **not before** `boxes_overlap` is either duplicated into `design_schema_v2.py` directly or v1 is confirmed fully gone (whichever the actual retirement plan calls for).
- `frontend/src/pages/design-editor/` (v1's entire editor) and `frontend/src/lib/designEditor/`.
- `design_editor_canvas`/`design_editor_element` (v1's own canvas endpoints in `views.py`).

**No component should be deleted based on this document alone** — this section identifies future candidates, contingent on the V1-retirement gate in §35, not an instruction to delete now.

---

## 30. Documentation Cleanup Plan

**AUTHORITATIVE — must remain, read first by any future work:**
- `LANCERAOS_TEMPLATE_BUILDER_ARCHITECTURE.md` (this document — renamed from
  `LANCERAOS_TEMPLATE_BUILDER_2_FINAL_ARCHITECTURE.md` during the 29 August 2026 production
  cutover; see this document's own top banner)
- `CLAUDE.md`, `DECISIONS.md`, `DATABASE.md`, `STANDARDS.md` (project-wide, unrelated to cleanup)

**HISTORICAL — real value as a record, should be archived (e.g., moved to a `docs/template-builder-2/history/` directory) rather than deleted or left cluttering the project root:**
- `LANCERAOS_TEMPLATE_BUILDER_AUDIT.md` (the original V1 audit — the reason this whole effort exists)
- `XYZ.md` (the audit brief/questionnaire that commissioned it)
- `LANCERAOS_TEMPLATE_BUILDER_2_ARCHITECTURE_PLAN.md` (the original 10-phase plan — superseded in execution, but the reasoning is real history)
- All 24 `LANCERAOS_TEMPLATE_BUILDER_2_PHASE*.md` files (Phase 0 through 5.6, including both `_AUDIT` documents) — superseded by this document and the Master Blueprint as the thing to read first, but a genuine, detailed record of how each specific bug was found and fixed
- `LANCERAOS_TEMPLATE_BUILDER_2_MASTER_BLUEPRINT.md`, `LANCERAOS_TEMPLATE_BUILDER_2_COMPLETION_REPORT.md`, `LANCERAOS_TEMPLATE_BUILDER_2_PAGINATION_FIX_REPORT.md` (this session's own prior documents) — superseded by this document as the authoritative reference, but each records a real, independently-useful investigation (the pagination root-cause analysis in particular has standalone value)

**OBSOLETE — safe to consider for deletion, though none contain anything actively misleading if kept:** none identified. Every document in the HISTORICAL list still accurately describes what was true when it was written, and none makes a claim this document contradicts without that contradiction being explained here. **No document is recommended for outright deletion** — archiving (not deleting) is the recommended action, since several documents (the original audit, the phase-by-phase bug discoveries) have real forensic value if a similar defect class ever resurfaces.

**Documents outside this effort's scope, not touched by this classification:** `LANCERAOS_PRODUCTION_BASELINE_AUDIT.md`, `LANCERAOS_CLIENTS_INVOICES_PRODUCTION_AUDIT.md` — these cover the broader Invoices/Clients module, not Template Builder specifically.

**Nothing has been deleted or moved as part of this task**, per the explicit instruction — this is a proposal for the user's approval.

---

## 31. Final Implementation Workstreams

A finite program, not an open-ended phase sequence. Each workstream is meant to be completed once.

### Workstream 1 — Editor Architecture Split
**Objective:** separate real production UI from dev-diagnostic tooling.
**Scope:** split `DesignEditorV2.jsx` into a production editor + a dev harness (§9, §25); add the `beforeunload` unsaved-changes guard (§8, §23).
**Dependencies:** none — can start immediately once approved.
**Files:** `frontend/src/pages/design-editor-v2/*`, `frontend/src/App.jsx`.
**Acceptance:** the real route ships zero dev-only diagnostic UI; the dev sandbox route is unaffected; a real user is warned before losing unsaved work.

### Workstream 2 — Semantic & Renderability Validation (Layers C/D)
**Objective:** close the "a broken design can be shipped silently" gap.
**Scope:** implement Layer C (required-field presence check) and Layer D (real dry-run render against representative data) in `design_validation.py`; wire into the real save path — **as a warning, not yet a hard block**, pending the Draft/Publish decision in §35.
**Dependencies:** none technically; the Draft/Publish product decision affects whether this blocks or warns.
**Files:** `design_validation.py`, `views.py` (save path), `InvoiceDesignSerializer`.
**Acceptance:** a design missing a visible invoice number, client identity, or the mandatory table/totals surfaces a real, specific warning before being set as default.

### Workstream 3 — Multi-Select & Alignment
**Objective:** close the largest remaining canvas-interaction gap.
**Scope:** multi-select (shift-click, drag-select), alignment guides/snapping during drag.
**Dependencies:** Workstream 1 (cleaner codebase to build into).
**Files:** `componentTypes.js`, `DesignEditor.jsx` (post-split), `serialization.js`.
**Acceptance:** a user can select 2+ elements and move/align them together; dragging near another element's edge shows a real snap guide.

### Workstream 4 — Table Pagination Polish
**Objective:** close the two small, cheap pagination gaps found during the audit.
**Scope:** enable `thead` repetition on continuation pages; re-verify Minimal/Modern-specific pagination edge cases with the same rigor Professional received.
**Dependencies:** none.
**Files:** `_v2_table_head.html`, `design_renderer_v2.py`.
**Acceptance:** a real multi-page invoice's table shows its column headers on every page it spans.

### Workstream 5 — Concurrency Protection
**Objective:** close the silent-overwrite gap between two editing sessions.
**Scope:** a real optimistic-locking mechanism (e.g., a version/timestamp check on save, surfaced as a real "this design changed elsewhere, reload?" conflict).
**Dependencies:** none.
**Files:** `InvoiceDesignSerializer`, `views.py`, `DesignEditor.jsx`.
**Acceptance:** a real two-tab test shows the second save either succeeding cleanly or surfacing an explicit conflict — never a silent clobber.

### Workstream 6 — Version Rollback UI
**Objective:** make the already-real version history user-facing.
**Scope:** a real "Version history" panel + "Restore this version" action.
**Dependencies:** none.
**Files:** new frontend component, a new (or extended) real endpoint reading `InvoiceDesignVersion`.
**Acceptance:** a user can see prior versions of a design and restore one as the new live `design_data`.

### Workstream 7 — Mobile Editor Scope Decision + Build
**Objective:** stop leaving mobile silently broken.
**Scope:** **first, a real product decision** (§35) — likely "view + limited text edits, no drag/resize" per the Blueprint's own recommendation — then build to that scope.
**Dependencies:** the product decision itself.
**Files:** `DesignEditor.jsx`, responsive CSS.
**Acceptance:** the editor behaves intentionally (not accidentally) at real mobile viewport widths.

### Workstream 8 — End-to-End Test Adoption
**Objective:** close the standing "no real browser verification" gap.
**Scope:** adopt `@playwright/test`; port the highest-value ad hoc verification sequences from this project's own history (select/drag/resize/style/save/reload) into permanent, CI-run tests.
**Dependencies:** none technically; benefits from Workstream 1's cleaner split.
**Files:** new `e2e/` or equivalent test directory, `package.json`.
**Acceptance:** a real headless-browser suite runs in CI and covers the core interaction loop.

### Workstream 9 — Draft/Publish Lifecycle (conditional on §35 approval)
**Objective:** give Layers B/C/D somewhere real to gate.
**Scope:** add `InvoiceDesign.status` (draft/published or similar), a real Publish action, restrict "set as default"/invoice assignment to published designs only.
**Dependencies:** Workstream 2; **requires explicit product approval before starting (§35)** — this is the single largest schema/behavior change in this whole roadmap.
**Files:** `models.py` (new field + migration), `views.py`, `InvoiceDesignSerializer`, `DesignEditor.jsx`.
**Acceptance:** a design must be explicitly published before it can be assigned to a real invoice; an incomplete design can still be saved as a draft without blocking the user.

### Workstream 10 — GrapesJS Build-vs-Keep Decision (conditional on §35 approval)
**Objective:** resolve the recurring internal-bug pattern once, deliberately, rather than continuing to patch it.
**Scope:** **first, a real evaluation** (effort to replace vs. cost of continued patching) — then either commit to GrapesJS long-term or build a narrower, purpose-built canvas.
**Dependencies:** none technically; highest-risk workstream if approved, since it touches the entire interaction layer.
**Acceptance:** a documented decision either way, with a real justification — not a default continuation by omission.

### Workstream 11 — V1 → V2 Real Migration Rollout (conditional on §35 approval)
**Objective:** begin the actual cutover the Blueprint's §B.8 describes.
**Scope:** a real, opt-in "convert my existing design to the new editor" flow with a before/after visual comparison, using the now-fixed migration mapper.
**Dependencies:** Workstreams 1–3 at minimum (a real user should not be migrated into an editor still missing basic capability parity).
**Acceptance:** a real user can opt a real v1 design into v2 and see a fair, honest comparison before committing.

### Workstream 12 — Final Verification
**Objective:** the comprehensive audit the user has already stated will happen after implementation.
**Scope:** re-run every acceptance criterion in §33 against the finished product, end to end, real browser included (per Workstream 8).
**Dependencies:** all prior workstreams.
**Acceptance:** every item in §33 passes, or is explicitly, honestly disclosed as not passing with a reason.

---

## 32. Dependency Graph

```
WS1 (Editor Split) ─────────────┬──────────────┬───────────────┐
                                 ↓              ↓               ↓
                              WS3 (Multi-    WS8 (E2E)      WS7 (Mobile,
                              select)                        after product
                                 │                            decision)
WS2 (Validation) ──→ WS9 (Draft/Publish, after product decision)
WS4 (Table polish) — independent
WS5 (Concurrency) — independent
WS6 (Version rollback UI) — independent
WS10 (GrapesJS decision, after product decision) — highest risk, can run in parallel with WS3 if kept, or precede it if replaced
WS11 (Real migration rollout) ──requires── WS1, WS2, WS3 (basic capability parity first)
WS12 (Final Verification) ──requires── ALL of the above
```

No workstream requires modifying V1 or the existing LanceraOS product beyond the additive integration points already established and documented in §5–6.

---

## 33. Final Acceptance Criteria

A user must be able to, without serious defects:
- [ ] Open the editor (real route, real design or real builtin start)
- [ ] Create a design from scratch (add elements, no starting template)
- [ ] Manipulate elements (move, resize, duplicate, delete) — including multi-select (Workstream 3)
- [ ] Configure elements (bindings, labels)
- [ ] Style elements (font, color, weight, alignment, opacity)
- [ ] Build a complex layout (multiple side-by-side rows, custom elements) without silent overlap or loss
- [ ] Save and have a clear, truthful save-status indicator at all times
- [ ] Reload and see exactly what was saved
- [ ] See real version history and restore a prior version (Workstream 6)
- [ ] Assign the design (set as default, or a real per-invoice override if ever built)
- [ ] Generate a real invoice using it
- [ ] Generate a PDF with correct pagination for arbitrarily long content
- [ ] Open the client portal and see identical content to the PDF
- [ ] Edit or delete the design later without altering any already-finalized invoice's appearance

And separately, verified every time:
- [ ] Existing LanceraOS functionality (every module in CLAUDE.md's own build table) remains intact
- [ ] V1's own template editor and its 3 static templates remain fully functional, unmodified
- [ ] Every pre-existing real invoice/design/client record is untouched
- [ ] Database integrity holds (no orphaned versions, no corrupted snapshots)
- [ ] Existing permission/ownership boundaries are unchanged

---

## 34. Definition of DONE

Template Builder 2.0 is DONE when:

1. Every checkbox in §33 is checked, with real, repeatable test evidence (not a one-time manual claim) — including real end-to-end browser coverage (Workstream 8), not merely unit/integration tests.
2. Every open decision in §35 has been made explicitly, not defaulted into by omission.
3. The Final Verification workstream (§31, WS12) has run and its results are reported honestly, including anything that still doesn't pass.
4. V1 remains fully functional and untouched beyond the one already-disclosed shared utility (`boxes_overlap`) — reconfirmed, not merely assumed to still be true.
5. A real product decision has been made about V1's own retirement timeline (whether that decision is "not yet" or a concrete plan) — DONE does not require V1 actually being deleted, only that its fate is a decision, not an accident.

---

## 35. Open Decisions Requiring User Approval

**Updated 29 August 2026, post-cutover.** These were the decisions this document deliberately did
not make unilaterally as of 28 August 2026. Item 6 was resolved by the cutover itself; items 1 and
4 were resolved by the cutover's own explicit scope boundary (the directive that authorized it
named these as things NOT to build); the rest were not addressed by the cutover — which was a
naming/reachability/retirement pass, not a new-feature pass — and their status should be verified
directly against the current codebase before assuming either way, not inferred from this list:

1. **Draft/Publish lifecycle** — RESOLVED (by scope, cutover): not built. Every save remains
   immediately usable; validation stays advisory-only. Introducing Draft/Publish was explicitly
   named as out of scope for the cutover itself — if this is still wanted, it's a separate,
   later decision.
2. **Header overflow protection** — still open; not addressed by the cutover.
3. **GrapesJS build-vs-keep (Workstream 10)** — RESOLVED in practice: GrapesJS was kept, not
   replaced — the cutover's own authorizing directive explicitly excluded "auto-replacing
   GrapesJS" from its scope.
4. **Mobile editor scope (Workstream 7)** — RESOLVED (by scope, cutover): no mobile editor was
   built; explicitly named as out of scope for the cutover.
5. **`@playwright/test` adoption (Workstream 8)** — still open; no live browser/Playwright was
   available during the cutover pass either, so this remains unaddressed.
6. **V1 retirement timeline (Workstream 11, §29)** — RESOLVED: retired as of the 29 August 2026
   production cutover. The 3 static templates remain (they're still a real, live fallback render
   path for legacy-shaped designs and every schema-version-2 design without real customization —
   not v1's editor code, which IS what was retired). See DECISIONS.md's cutover entry for exactly
   what was deleted vs. kept-for-compatibility vs. renamed.
7. **Per-invoice design override at creation time** — still open; confirmed still genuinely
   absent as of the cutover (no wizard field exists to plug it into) — not addressed, not
   silently added as unplanned scope.
8. **Table header (`thead`) repetition on continuation pages (Workstream 4)** — status not
   re-verified by the cutover pass; check the current renderer directly rather than assuming
   either way from this entry.
9. **Concurrency protection's exact UX (Workstream 5)** — still open; not addressed by the
   cutover.
