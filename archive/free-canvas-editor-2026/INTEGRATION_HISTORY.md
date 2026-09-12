# Free-Canvas Template Builder — Integration History

**Archived:** 12 September 2026, as part of the Full Reversion Plan (back to 3 static templates
only). This document is the permanent record of what was built, why it was reverted, what remains
live today, and where to look in this folder if any of it is ever revisited.

---

## What was built

Starting at Step 8 of the Invoices + Client CRM module (August 2026), LanceraOS grew a full visual
invoice-design system on top of the original 3 static PDF templates (Professional/Minimal/Modern):

- **Two generations of free-canvas editor.** The first was built on GrapesJS
  (`DesignEditor.jsx`, zone-aware drag/resize across two content zones — `zone_1`/`zone_2`). It was
  fully replaced by a second, standalone-project-merged editor (`design-editor-v2/`,
  `TemplateBuilderV2.jsx`) with a genuinely free-form canvas: drag/resize for every element
  including the invoice's own line-items table, a style/property panel, a Layers panel, multi-select
  with alignment/snap-to-grid, undo/redo, and non-destructive version history. The GrapesJS editor
  itself was fully removed in an earlier pass (confirmed directly — no trace of it existed in the
  codebase by the time this reversion began); only its data shape and the second editor survived to
  be reverted here.
- **A versioned `design_data` JSON contract** (`InvoiceDesign.design_data`, `apps/invoices/
  design_schema.py`) describing every element's position/size/style/data-binding, with two real
  schema generations (`schema_version: 2` production shape, plus a retired `zone_1`/`zone_2` shape
  kept read-compatible via `legacy_design_schema.py`/`legacy_design_renderer.py`) and a deterministic
  migrator between them (`design_migration.py`).
- **A canonical renderer** (`design_renderer.py`) shared by the PDF pipeline, the client portal, and
  the editor's own live canvas preview — one render path so what the editor showed and what a real
  invoice produced could never independently drift. Grew real capabilities over several dated
  phases: element rotation, an `ellipse` shape type, a configurable page footer, non-destructive
  image crop (Phase 1, 07 September 2026), then font theming, table styling (zebra rows, per-column
  alignment, cell padding), image borders, and 2 new data bindings (Phase 3a, same day).
- **AI-seeded design generation** (Path 3, `ai_design.py`) — upload a reference image, one real Groq
  vision call classifies it against the 3 base templates plus extracted colors and layout density,
  producing a real starting `InvoiceDesign` row. Classify-only, never full HTML generation.
- **Per-design color customization** (`color_variant`, 3 curated palettes per base template,
  `design_seeds.resolve_design_colors`) — wired into both the free-canvas renderer and, separately,
  the 3 static templates' own `design_primary_color`/`design_secondary_color` template variables.
- **Version history** (`InvoiceDesignVersion`) — every real save created an immutable snapshot, with
  a real restore action that copied a past version back onto the live design (itself creating a new
  version, so history only ever grew).
- Supporting tooling: a Cloudinary-backed image upload endpoint for editor-authored images, a
  structured validation framework (`design_validation.py`) backing a "Template Health" endpoint, a
  live gallery-card preview renderer (`design_preview.py`, real backend HTML reused by
  `DesignLivePreview.jsx`'s scaled iframe), management commands for auditing/migrating/backing up
  designs at scale, and (in the merged standalone project) a Python-subprocess bridge
  (`frontend/scripts/py/validate_design_data.py`) letting the editor's own JS test suite call the
  real backend validator directly.

This was a substantial, multi-week effort spanning many dated passes (see `DECISIONS.md`'s own
19 August through 07 September 2026 entries for the full blow-by-blow, including several real SEV1
bug-fix rounds — the design-to-invoice assignment gap, gallery preview/color wiring, and the canvas
editor being disconnected from the real renderer).

## Why it was reverted

Real time invested against real progress — a deliberate decision to ship the simpler, already-working
thing now rather than keep carrying an increasingly elaborate customization system forward. The
concrete signal, checked directly rather than assumed: **a database audit before any removal began
found 0 of 113 real invoices in the dev database ever ended up with an `InvoiceDesign` actually
assigned** (`Invoice.design_id` was `NULL` on every single row), despite the system having existed
since Step 8 and gone through multiple dedicated bug-fix passes. The customization the system existed
to provide was never actually reaching a real invoice. That's the signal that made this reversion the
right call rather than a premature one — stated plainly, the way this project's own documentation
style prefers.

## What this reversion actually did (Parts 1–6)

1. **Database** (`apps/invoices/migrations/0012_verify_design_data_before_reversion.py` +
   `0013_reversion_drop_design_editor_schema.py`): a real integrity gate (every `base_template` valid,
   no orphaned `Invoice.design_id`, no populated `Invoice.rendered_design_snapshot`) followed by the
   actual schema change — `InvoiceDesign.design_data`/`source`/`color_variant` columns dropped, the
   `InvoiceDesignVersion` table dropped entirely. `InvoiceDesign` is now exactly `id`/`user`/`name`/
   `base_template`/`is_default`/`created_at`/`updated_at`. Verified with real before/after checksums
   over every invoice's identity/PDF-provenance fields (see Part 6 below) — byte-for-byte unchanged.
   Reversibility tested for real: rolled the schema back to 0012 and forward to 0013 again — the
   *schema* reverses cleanly via `migrate`, but the actual `design_data`/`color_variant`/version
   content is gone for good the moment 0013 runs, recoverable only from the pre-reversion database
   dump (`backups/lanceraos_pre_reversion_20260912_120404.dump`), not from a migration rollback alone.

2. **Backend code**: all 14 modules/commands listed below moved here; `pdf_generator.py`'s render
   path collapsed from a 3-way dispatch (static / legacy-dynamic / v2 canonical) to a single, direct
   static-template render. `_effective_design` no longer consults `Invoice.rendered_design_snapshot`
   — that mechanism existed solely to protect a finalized invoice's render from a *later* edit to a
   design's free-canvas content; with no free-canvas content left to edit, it had nothing left to
   protect against. The field itself stays on the `Invoice` model, untouched. `color_variant`'s
   removal was a deliberate, explicit call (see "The color_variant trade-off" below) — the exact same
   hex values every template already rendered were ported directly into a small
   `DEFAULT_TEMPLATE_COLORS` constant in `pdf_generator.py`, so no invoice's actual appearance changed.

3. **Frontend code**: the entire `design-editor-v2/` tree, `DesignLivePreview.jsx`, and
   `designTemplatesApi.js` moved here. `DesignGallery.jsx` was rebuilt to its original, much simpler
   shape — list the 3 templates, "Use this template" (creates + sets default), list saved designs
   with set-default/delete. No Edit action, no Blank action, no AI-seed upload, no color picker. The
   gallery's per-template preview cards, which used to iframe a real backend render, are now a small
   static CSS thumbnail (a colored header bar in that template's one real accent color) — honest about
   not being a live render, since there's only one possible look per template now. The `qrcode` npm
   package (used only by the removed editor's element catalog for a QR-shape preview) was removed
   from `frontend/package.json`.

4. **The footer design** (business identity left, page counter center — multi-page only — wordmark
   right) turned out to already be live, native `@page` CSS in all 3 static templates, independent of
   anything in this reversion (traced to a standalone commit predating the free-canvas editor's own
   footer capability). No code change was needed — verified instead, with real rendered PDFs
   (single-page and multi-page, all 3 templates) confirming the natural-flow-first page-counting rule
   still holds.

5. **Dead-code sweep**: unused imports cleaned from `views.py` (some caused by this reversion,
   a few pre-existing and unrelated, found by the same `pyflakes` pass); a real bug found and fixed —
   `InvoiceDesignVersion`'s own dead body fragments (a stray `indexes`/`unique_together` local
   assignment and a duplicate `__str__`) had been accidentally left stranded inside
   `InvoiceDesign.save()` during the initial field-removal edit, caught by `pyflakes`, not by any
   test. `CLAUDE.md`, `DATABASE.md`, and `DECISIONS.md` all updated with dated corrections pointing
   here, following this project's own convention of appending/prepending a clear correction rather
   than silently rewriting history.

6. **Full regression verification**: a real invoice created end-to-end through the actual API for
   each of the 3 templates (login → pick template → create invoice with real line items → finalise →
   fetch PDF), each one's real rendered content checked (client name, correct line total) via
   PyMuPDF; the public client-portal endpoint confirmed to serve the identical frozen bytes for all 3;
   every pre-existing real invoice's identity/PDF-provenance fields checksummed byte-for-byte against
   a restored pre-reversion database backup — identical. Final counts: 923 backend tests passing
   (full project), 212 frontend tests passing, production build clean.

## The `color_variant` trade-off

This was the one genuinely hard call in this reversion, surfaced explicitly rather than assumed:
`color_variant` was not dead weight — it was real, live, and wired into the 3 static templates' own
rendering via `design_primary_color`/`design_secondary_color`. Dropping it removes a real, working
feature (letting a static template render in more than one accent color), which is customization by
another name — exactly what this reversion's own "no customization of any kind" goal argues against.
Given that explicit trade-off, the decision was to drop it entirely rather than keep it as a bare,
unused field or port the full per-template palette logic forward. Every template now renders the one
accent color it always defaulted to — zero visual change for any invoice that was already using a
template's default color (the overwhelming majority, since only 1 of the 12 real `InvoiceDesign` rows
in the dev database had a non-default color set).

## What remains live today

- The 3 static templates (`professional.html`/`minimal.html`/`modern.html`), each rendering its one
  real default accent color, with the business-identity/page-counter/wordmark footer unchanged.
- `InvoiceDesign` — a name plus which of the 3 templates it renders as, nothing more. A user can
  create one per template (or several, though there's little reason to), set one as their default,
  and delete one. That default is what a new invoice picks up automatically.
- `pdf_generator.py`'s single, direct static-template render path — no dispatch, no design-content
  resolution beyond "which of 3 templates."
- The Profile page's own logo/signature upload (`SignatureCard.jsx`, `signature_tool.py`,
  `/api/invoices/signature/`) — always out of scope for this entire effort, confirmed untouched.

## Full archive manifest (89 files, organized by original path)

**Backend — `apps/invoices/`** (11 modules): `ai_design.py`, `design_migration.py`,
`design_preview.py`, `design_renderer.py`, `design_schema.py`, `design_seeds.py`,
`design_templates.py`, `design_validation.py`, `legacy_design_renderer.py`, `legacy_design_schema.py`,
`views_design_editor.py`

**Backend — management commands** (3): `audit_template_design_migration.py`,
`export_invoice_designs_backup.py`, `migrate_invoice_designs_to_production_schema.py`

**Backend — data fixture** (1): `data/blank_design_rich_elements.json`

**Backend — tests** (20, design-system-only; a further 5 files that touched `InvoiceDesign` but
weren't purely-for-this — `test_recurring.py`, `test_design_assignment.py`, `test_pdf_pipeline.py`,
`test_new_models.py`, and the two still-relevant test classes ported out of
`test_design_color_and_preview.py` before it was archived — were edited in place in the live tree
instead, not archived): `test_ai_design.py`, `test_design_color_and_preview.py`,
`test_design_cutover.py`, `test_design_layout_mode.py`, `test_design_management_commands.py`,
`test_design_migration.py`, `test_design_missing_data.py`, `test_design_pagination.py`,
`test_design_phase1_extensions.py`, `test_design_phase3a_extensions.py`, `test_design_renderer.py`,
`test_design_renderer_phase3_2.py`, `test_design_schema.py`, `test_design_template_data.py`,
`test_design_templates_golden.py`, `test_design_upload_image.py`,
`test_design_validation_framework.py`, `test_design_version_and_snapshot_foundation.py`,
`test_designs.py`, `test_legacy_design_renderer.py`

**Frontend — `design-editor-v2/`** (48 files): the complete standalone-project-merged editor —
`TemplateBuilderV2.jsx`, its adapter (incl. 4 golden fixtures + the Python-validation bridge),
Canvas/Panels/Toolbar components, data catalogs, state management, styles, and utils.

**Frontend — other** (2): `components/design-editor/DesignLivePreview.jsx`,
`lib/designTemplatesApi.js`

**Frontend — tooling** (3): `scripts/py/validate_design_data.py`, `scripts/py/dump_fixtures.py`,
`scripts/js/dump_blank_design_elements.mjs`

**Documentation** (1): `LANCERAOS_TEMPLATE_BUILDER_ARCHITECTURE.md` — the original 892-line
architecture/investigation report, entirely describing the removed system as current production
architecture by the time this reversion began.

## Where to look if this is ever revisited

- The full build history, phase by phase, with real before/after evidence for each: `DECISIONS.md`'s
  dated entries from 19 August 2026 (`design_schema.py`'s original build) through 07 September 2026
  (Phase 3a), plus this file's own 12 September 2026 entry for the reversion itself.
- The `design_data` schema contract, both generations, and the migration between them: this folder's
  `design_schema.py` (production `schema_version: 2`) and `legacy_design_schema.py` (the retired
  shape), with `design_migration.py`'s `migrate_v1_to_v2` as the deterministic converter.
- The canonical renderer's own architecture (why one render path serves the PDF/portal/editor
  preview alike): `design_renderer.py`'s own module docstring, and
  `LANCERAOS_TEMPLATE_BUILDER_ARCHITECTURE.md` for the full original design reasoning.
- Real production data as it stood at the moment of reversion: `backups/
  lanceraos_pre_reversion_20260912_120404.dump` (repo-root, gitignored) — a full Postgres dump taken
  before migration 0012 ran, the only way to recover actual `design_data`/`color_variant`/version
  content, since the schema migration's own reversal restores structure, not data.
