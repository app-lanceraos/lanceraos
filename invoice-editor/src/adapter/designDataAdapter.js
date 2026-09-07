// apps/invoices/design_schema.py <-> editor `template` — Phase 2b.
//
// Two pure functions, no unit conversion anywhere in this file (Phase 2a
// made the editor mm-native — every x/y/width/height/rotation value below
// is read and written verbatim, in mm, exactly as design_schema.py itself
// stores it). No React, no EditorContext, no network calls: this module
// is called BY the editor's save/load code (a later phase), never the
// reverse.
//
//   templateToDesignData(template) -> design_data
//   designDataToTemplate(design_data) -> { template, warnings }
//
// `warnings` is a list of plain, human-readable strings describing
// anything the import could NOT represent losslessly — a production
// element with no editor-side home, a bundled element split into more
// than one editor item, a field silently dropped. Never silent: an
// import that drops something always says so, in this return value, not
// only in a code comment. See this module's own REPORT.md-equivalent —
// the Phase 2b report — for the full, audited list of what's here and
// why; this file's own comments cover the mechanism, not the inventory.
//
// THE CENTRAL, LOAD-BEARING FACT THIS FILE IS BUILT AROUND: the editor's
// item model is CLOSED — a small, fixed catalog of single-instance
// widgets (elementCatalog.js's ELEMENT_TYPES), each with baked-in fixed
// content and ONE bounding box (sub-parts like a block's title/lines
// style independently but do NOT position independently — they stack via
// ordinary CSS flow inside that one box). Production's model is OPEN — a
// design_data payload may contain any number of freely-positioned,
// individually-styled `generic:text` elements, each with its own
// binding, and the real BUILTIN_DESIGNS seeds actually USE that openness
// (header content is fully decomposed into many independent elements,
// not the bundled semantic types this adapter exports). These two facts
// together mean EXPORT (editor -> design_data) is fully deterministic and
// round-trips the editor's OWN output exactly, but IMPORT (design_data ->
// editor) of a hand-authored or seed-decomposed design is necessarily
// LOSSY for anything the closed catalog has no slot for — reported via
// `warnings`, never silently dropped, and never invented as a fake
// editor feature to paper over the gap (explicitly out of this phase's
// scope). See the Phase 2b report's own item 6 for the full accounting.

import { createContentItem } from '../data/elementCatalog';
import { createShape } from '../data/shapeCatalog';
import { DEFAULT_THEME } from '../utils/theme';
import { fontIdToProductionName, productionNameToFontId } from './fontMap';

const SCHEMA_VERSION_V2 = 2;

// ── Catalog-type placement: header vs flow ─────────────────────────────
// Mirrors the ORIGINAL zone_1/zone_2 spirit design_schema.py's own
// docstring describes (header = identity fields, flow = everything else)
// — the editor has no separate header/flow concept of its own (one flat,
// z-ordered `items` array), so this fixed set is what decides which
// production list each catalog type's exported element(s) land in.
const HEADER_CATALOG_TYPES = new Set([
  'logo', 'invoice', 'businessName', 'invoiceNumber', 'issueDate', 'dueDate', 'billTo', 'from',
]);

// ── Coordinate space: editor page-relative <-> production content-relative ─
//
// The editor's `.page-frame` IS the full physical page (0..page.width mm,
// top-left origin) — every item's x/y is measured from the true page
// corner, with no separate "content box" concept (PAGE_PADDING is a soft
// minimum-distance rule, not a hard coordinate-space boundary — see
// geometry.js). Production's x/y are deliberately NOT page-relative
// (design_schema.py's own _validate_page_bounds docstring is explicit
// about this): they're relative to the CONTENT area — the page inset by
// its own margins (and, for a sidebar-flagged element, relative to the
// separate, page-absolute sidebar column instead — design_templates.py's
// own Modern comment: "sidebar occupies page x=0..42mm regardless of the
// main content's own margin_left").
//
// The editor has no margin/sidebar EDITING UI at all yet (same "real
// field, no tooling yet" category as layout_mode) — `page.marginLeftMm`
// etc/`page.sidebar` only ever have a value here because an earlier
// import preserved one losslessly (see templateToDesignData's own
// passthrough). Defaulting every margin to 0 when absent is what makes a
// fresh editor template's own already-established page-relative layout
// (items positioned all the way out to near the true page edges — see
// elementCatalog.js's own defaultBoxes) export as valid, unshifted
// content-relative coordinates: explicitly writing margin_*_mm: 0 (never
// omitting them) is what turns off design_schema.py's own default-20mm/
// 16mm fallback, which would otherwise silently reinterpret the editor's
// already-correct page-relative x as a much narrower content box the
// editor was never actually respecting.
// Two variants, deliberately not one — `template.page` (editor shape)
// and `design_data.page` (production shape) name these fields
// differently (marginLeftMm vs margin_left_mm), and calling the wrong
// reader against the wrong shape would silently resolve to the `?? 0`
// fallback instead of a real value (exactly the bug this split fixes:
// an earlier single-function version read production's snake_case page
// with the editor's camelCase field names and got 0 every time).
function marginsOfEditorPage(page) {
  return {
    top: page.marginTopMm ?? 0,
    right: page.marginRightMm ?? 0,
    bottom: page.marginBottomMm ?? 0,
    left: page.marginLeftMm ?? 0,
    sidebarWidth: page.sidebar?.width_mm ?? 0,
  };
}

function marginsOfProductionPage(page) {
  return {
    top: page.margin_top_mm ?? 0,
    right: page.margin_right_mm ?? 0,
    bottom: page.margin_bottom_mm ?? 0,
    left: page.margin_left_mm ?? 0,
    sidebarWidth: page.sidebar?.width_mm ?? 0,
  };
}

function shiftToProduction(x, y, margins, isSidebar) {
  if (isSidebar) return { x, y };
  return { x: x - (margins.left + margins.sidebarWidth), y: y - margins.top };
}

function shiftToEditor(x, y, margins, isSidebar) {
  if (isSidebar) return { x, y };
  return { x: x + (margins.left + margins.sidebarWidth), y: y + margins.top };
}

// ── Color / font theme-link <-> production sentinel conversion ─────────

function colorToProduction(value) {
  if (value == null) return undefined;
  if (typeof value === 'object') {
    if (value.linked === 'primary') return 'theme_primary';
    if (value.linked === 'secondary') return 'theme_secondary';
    return undefined; // a font-slot sentinel on a color field — defensive, never produced by the editor itself
  }
  return value; // literal hex
}

function colorFromProduction(value) {
  if (value == null) return undefined;
  if (value === 'theme_primary') return { linked: 'primary' };
  if (value === 'theme_secondary') return { linked: 'secondary' };
  return value; // literal hex, or any other string — passed through as-is
}

// Production has NO per-design theme/font-linking concept at all (no
// `theme_heading`/`theme_body` sentinel exists anywhere in
// design_renderer.py — confirmed directly, not assumed: resolve_style_value
// returns style/overrides values completely raw for `font`/`font_weight`,
// unlike resolve_theme_color's real sentinel handling for colors). A
// font-linked editor value is therefore RESOLVED to its current literal
// theme value at export time — this is a real, one-directional loss (see
// the Phase 2b report's item 6): re-importing a design can never recover
// "this was meant to track the theme's heading font," only the literal
// family/weight it happened to resolve to.
function fontToProduction(fontFamilyValue, fontWeightValue, theme, warnings, label) {
  let familyId = fontFamilyValue;
  let weight = fontWeightValue;
  if (fontFamilyValue && typeof fontFamilyValue === 'object' && fontFamilyValue.linked) {
    const slot = fontFamilyValue.linked === 'heading' ? theme.headingFont : theme.bodyFont;
    familyId = slot.family;
    weight = slot.weight;
    if (warnings) {
      warnings.push(
        `${label}: font was linked to the theme's ${fontFamilyValue.linked} font — production has no font-theme-link ` +
          `concept, so this was resolved to its current literal value (${fontIdToProductionName(familyId)}, weight ${weight}) ` +
          'and will not re-link if the theme changes later.'
      );
    }
  }
  const font = familyId ? fontIdToProductionName(familyId) : undefined;
  return { font, font_weight: weight };
}

// ── Small shared builders ───────────────────────────────────────────────

function baseElementFields(item, kind, type) {
  const el = {
    kind,
    type,
    x: item.x,
    y: item.y,
    width: item.width,
    height: item.height,
    style: {},
    overrides: {},
  };
  if (item.rotation) el.rotation = item.rotation;
  if (item.locked) el.locked = true;
  if (item.hidden) el.hidden = true;
  // Phase 2a/2b: the editor has no UI for this yet (Master Blueprint
  // §B.3's 'flow' layout mode) — a value only ever gets here by having
  // survived an earlier import verbatim (see importBaseFields below).
  // Must round-trip losslessly even though nothing in this codebase can
  // set it yet — see the Phase 2b report's item 4.
  if (item.layoutMode && item.layoutMode !== 'pinned') el.layout_mode = item.layoutMode;
  // Same "real field, no editing UI yet" precedent, for Modern's own real
  // sidebar content (see this file's own marginsOf/shiftToProduction
  // comment above) — read by templateToDesignData's own coordinate-shift
  // pass, not by any exporter function individually.
  if (item.sidebar) el.style.sidebar = true;
  return el;
}

function importBaseFields(prodEl) {
  const patch = { x: prodEl.x, y: prodEl.y, width: prodEl.width, height: prodEl.height };
  if (prodEl.rotation) patch.rotation = prodEl.rotation;
  if (prodEl.locked) patch.locked = true;
  if (prodEl.hidden) patch.hidden = true;
  if (prodEl.layout_mode) patch.layoutMode = prodEl.layout_mode;
  if (prodEl.style?.sidebar) patch.sidebar = true;
  return patch;
}

function newId(kind) {
  return `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// ── EXPORT: one function per catalog type ───────────────────────────────
// Each returns an ARRAY of production elements (usually one; zero or many
// for the documented exceptions — see the Phase 2b report's mapping
// table). `ctx = { theme, warnings }`.

function exportLogo(item, _ctx) {
  const el = baseElementFields(item, 'semantic', 'logo');
  const shape = item.logoShape || 'square';
  // Production's logo only has one style knob: a fixed mm border-radius
  // (`_element_content.html`'s `el.style.border_radius_mm`) — no true
  // "circle" concept. A large-enough radius renders as a true circle for
  // a square box (CSS clamps border-radius to the box's own half-size),
  // which is what the editor's own 'circle' mask visually IS — so this
  // is an exact visual match, not an approximation, despite using a
  // different mechanism than the editor's CSS `border-radius: 50%`.
  if (shape === 'circle') el.style.border_radius_mm = 9999;
  else if (shape === 'rounded' && item.logoRadiusMm) el.style.border_radius_mm = item.logoRadiusMm;
  else if (shape === 'rounded') el.style.border_radius_mm = 2.65; // the editor's own fixed "rounded" mask value (see CanvasItem.jsx's logoMaskRadius)
  return [el];
}

function textStyleFromItem(item, theme, warnings, label) {
  const style = {};
  const font = fontToProduction(item.fontFamily, item.fontWeight, theme, warnings, label);
  if (font.font) style.font = font.font;
  if (font.font_weight) style.font_weight = font.font_weight;
  if (item.fontSize) style.font_size_pt = item.fontSize; // already pt-native since Phase 2a
  const color = colorToProduction(item.textColor);
  if (color) style.color = color;
  if (item.contentAlign) style.align = item.contentAlign;
  return style;
}

function exportStaticText(item, text, extraStyle, ctx, label) {
  const el = baseElementFields(item, 'generic', 'text');
  el.binding = null;
  // Merged, not replaced — baseElementFields may already have set
  // el.style.sidebar (from item.sidebar); overwriting el.style wholesale
  // here would silently discard it (a real, confirmed bug this comment
  // documents rather than lets recur — see the Phase 2b report's item 6
  // note on Modern's sidebar round trip).
  el.style = { ...el.style, ...textStyleFromItem(item, ctx.theme, ctx.warnings, label), ...extraStyle, text };
  return [el];
}

function exportBoundText(item, binding, ctx, label) {
  const el = baseElementFields(item, 'generic', 'text');
  el.binding = binding;
  el.style = { ...el.style, ...textStyleFromItem(item, ctx.theme, ctx.warnings, label) };
  return [el];
}

// issueDate/dueDate: the editor's label-value box ("Issue date:" + a
// bound value, ONE box, laid out via CSS flex) has no single-element
// production home — production's only bundled date type ('dates') is
// atomic (it always shows BOTH issue and due date together, plus an
// optional invoice number, with no way to show just one — confirmed
// directly against `_element_content.html`'s `el.type == 'dates'`
// branch, which has no per-row filter the way `totals`/`notes` do). The
// editor keeps issueDate/dueDate as two INDEPENDENTLY toggleable catalog
// items, so forcing them into one shared 'dates' element would coordinate
// state across items that are meant to be independent. Exported as a
// single bound generic:text instead — the static "Issue date:"/"Due
// date:" label text is DROPPED, a real, reported, one-directional loss
// (see the Phase 2b report's item 2).
function exportDateRow(item, binding, ctx, label) {
  ctx.warnings.push(`${label}: the static label text ("Issue date:"/"Due date:") has no production element to live on and was dropped — only the bound date value is exported.`);
  return exportBoundText(item, binding, ctx, label);
}

function exportClientInfo(item, ctx) {
  const el = baseElementFields(item, 'semantic', 'client_info');
  // production's client_info has no field for the block/lines' OWN
  // font/color styling the way a generic:text does — it's rendered via
  // fixed CSS classes (.v2-label/.v2-partyname/.v2-line). The editor's
  // per-sub-part style (billTo's title/clientName/clientCompany/address/
  // email each independently colorable/fontable) has nowhere to go here.
  if (item.title?.textColor || item.clientName?.fontFamily || item.email?.textColor) {
    ctx.warnings.push('billTo: per-line text color/font overrides have no production field on client_info and were dropped (only the block-level position/frame survive).');
  }
  return [el];
}

function exportBusinessInfoSenderRepeat(item, ctx) {
  const el = baseElementFields(item, 'semantic', 'business_info');
  el.style.variant = 'sender_repeat';
  if (item.title?.textColor || item.businessName?.fontFamily || item.email?.textColor) {
    ctx.warnings.push('from: per-line text color/font overrides have no production field on business_info(sender_repeat) and were dropped.');
  }
  return [el];
}

function exportTable(item, ctx) {
  const el = baseElementFields(item, 'structural', 'table');
  el.layout_mode = el.layout_mode || 'flow'; // matches every real seed's own table (see design_templates.py's _table helper)
  const font = fontToProduction(item.fontFamily, item.fontWeight, ctx.theme, ctx.warnings, 'itemsTable');
  if (font.font) el.style.font = font.font;
  const headerBorder = colorToProduction(item.headerTextColor); // editor has no dedicated header-border color; see warning below
  if (item.headerBg) ctx.warnings.push('itemsTable: header background color has no production table style field and was dropped.');
  if (item.headerTextColor) el.style.header_color = colorToProduction(item.headerTextColor);
  if (headerBorder) el.style.header_border_color = headerBorder;
  if (item.rowBorderColor) el.style.row_border_color = colorToProduction(item.rowBorderColor);
  // Production's table type has real column REORDERING/NARROWING
  // (`style.columns`) but the editor always shows all 4 in the fixed
  // Description/Qty/Rate/Amount order (no UI to change it) — always
  // exported as the full default set. Conversely, the editor's own
  // per-column alignment, alternating-row shading, and cell padding have
  // NO production table field at all (row_cell_css only ever resolves
  // row_border_color — confirmed directly against design_renderer.py) —
  // dropped, reported, in the direction production is the poorer model.
  if (item.altRowShading || item.columnAlign || item.cellPadding !== undefined) {
    ctx.warnings.push('itemsTable: per-column alignment, alternating-row shading, and cell padding have no production table style field and were dropped.');
  }
  return [el];
}

function exportTotalsRow(item, row, _ctx) {
  const el = baseElementFields(item, 'semantic', 'totals');
  el.layout_mode = el.layout_mode || 'flow'; // matches every real seed's own decomposed totals rows
  el.style.align = item.contentAlign || 'right';
  el.style.rows = [row];
  return [el];
}

function exportNotesSection(item, section, _ctx) {
  const el = baseElementFields(item, 'semantic', 'notes');
  el.layout_mode = el.layout_mode || 'flow';
  el.style.sections = [section];
  return [el];
}

function exportPaymentInfo(item, ctx) {
  const el = baseElementFields(item, 'semantic', 'payment_info');
  el.layout_mode = el.layout_mode || 'flow';
  el.style.variant = 'bank_methods';
  el.style.label = 'Payment methods';
  ctx.warnings.push('paymentMethods: the editor shows a fixed 2-method preview (Bank transfer, Payoneer); production shows whichever of up to 5 real methods are actually configured — the exported element always represents the full real bundle, not just the 2 previewed.');
  return [el];
}

function exportPayOnline(item, ctx) {
  const el = baseElementFields(item, 'semantic', 'qr_code');
  ctx.warnings.push('payOnline: the "Pay online" title text has no home on qr_code alone (production\'s title lives on the separate online_payment_link type) and was dropped — only the QR image is exported.');
  return [el];
}

// signatureImage + signatureDivider + signatureLabel -> ONE production
// `signature` element. A genuine, non-invertible 3-editor-items-into-1
// collapse — see the Phase 2b report's item 6. `items` is the full
// template.items list (needed to find the sibling parts).
function exportSignatureGroup(imageItem, dividerItem, labelItem, ctx) {
  // Union bounding box of whichever of the 3 parts are actually present
  // — production's `signature` is one box, so this is the best-effort
  // single box to represent all 3 editor items' combined footprint.
  const parts = [imageItem, dividerItem, labelItem].filter(Boolean);
  const minX = Math.min(...parts.map((p) => p.x));
  const minY = Math.min(...parts.map((p) => p.y));
  const maxX = Math.max(...parts.map((p) => p.x + p.width));
  const maxY = Math.max(...parts.map((p) => p.y + p.height));
  const el = {
    kind: 'semantic',
    type: 'signature',
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
    style: {},
    overrides: {},
  };
  if (labelItem) el.style.label = 'Authorised Signature';
  if (labelItem?.contentAlign) el.style.align = labelItem.contentAlign;
  el.style.has_signature_image = !!imageItem;
  ctx.warnings.push(
    'signatureImage/signatureDivider/signatureLabel: collapsed into one production `signature` element (its box is the union of ' +
      "all 3 editor items' own boxes). The divider's own color/thickness has no production field on `signature` (that type's " +
      'own "line" is fixed CSS, not configurable) and was dropped. This collapse cannot be reversed exactly — see report item 6.'
  );
  return el;
}

function exportShape(item, ctx) {
  if (item.type === 'roundedRect') {
    const el = baseElementFields(item, 'generic', 'rectangle');
    const bg = colorToProduction(item.fill);
    if (bg) el.style.background_color = bg;
    const border = colorToProduction(item.borderColor);
    if (border) el.style.border_color = border;
    if (item.borderWidth) el.style.border_width_mm = item.borderWidth;
    if (item.radius) ctx.warnings.push('roundedRect: corner radius has no field on production\'s generic "rectangle" type (only "ellipse" gets a forced, non-configurable 50% radius) and was dropped.');
    return [el];
  }
  if (item.type === 'ellipse') {
    const el = baseElementFields(item, 'generic', 'ellipse');
    const bg = colorToProduction(item.fill);
    if (bg) el.style.background_color = bg;
    const border = colorToProduction(item.borderColor);
    if (border) el.style.border_color = border;
    if (item.borderWidth) el.style.border_width_mm = item.borderWidth;
    return [el];
  }
  // 'line'
  const el = baseElementFields(item, 'generic', 'divider');
  const color = colorToProduction(item.fill);
  if (color) el.style.color = color;
  el.style.thickness_mm = item.height;
  return [el];
}

function exportImage(item, ctx) {
  const el = baseElementFields(item, 'generic', 'image');
  el.style.src = item.dataUrl;
  if (item.borderColor || item.borderWidth || item.cornerRadius) {
    ctx.warnings.push('image: border color/width/corner-radius have no field on production\'s generic "image" type and were dropped.');
  }
  ctx.warnings.push('image: exported as a literal (likely large) data: URI — production has no separate asset-upload step for editor-authored images yet.');
  return [el];
}

// ── Footer: page-level config, not an element ───────────────────────────

function exportFooter(footerItem, ctx) {
  const style = {};
  if (footerItem.textColor) style.text_color = colorToProduction(footerItem.textColor);
  if (footerItem.bgColor) style.background_color = colorToProduction(footerItem.bgColor);
  if (footerItem.dividerColor) style.divider_color = colorToProduction(footerItem.dividerColor);
  const font = fontToProduction(footerItem.fontFamily, footerItem.fontWeight, ctx.theme, ctx.warnings, 'footer');
  if (font.font) style.font_family = font.font;
  if (footerItem.fontSize) style.font_size_pt = footerItem.fontSize;
  if (font.font_weight) style.font_weight = font.font_weight;
  return { style };
}

// ── EXPORT: whole template -> design_data ───────────────────────────────

export function templateToDesignData(template) {
  const warnings = [];
  const theme = template.theme || DEFAULT_THEME;
  const ctx = { theme, warnings };

  const header = [];
  const flow = [];
  const margins = marginsOfEditorPage(template.page);

  const footerItem = template.items.find((i) => i.type === 'footer');
  const signatureImage = template.items.find((i) => i.type === 'signatureImage');
  const signatureDivider = template.items.find((i) => i.type === 'signatureDivider');
  const signatureLabel = template.items.find((i) => i.type === 'signatureLabel');
  const signatureHandled = new Set([signatureImage, signatureDivider, signatureLabel].filter(Boolean).map((i) => i.id));

  if (signatureImage || signatureDivider || signatureLabel) {
    const signatureEl = exportSignatureGroup(signatureImage, signatureDivider, signatureLabel, ctx);
    const shifted = shiftToProduction(signatureEl.x, signatureEl.y, margins, false);
    signatureEl.x = shifted.x;
    signatureEl.y = shifted.y;
    flow.push(signatureEl);
  }

  template.items.forEach((item) => {
    if (item.type === 'footer') return;
    if (signatureHandled.has(item.id)) return;

    let produced = [];
    if (item.kind === 'shape') {
      produced = exportShape(item, ctx);
    } else if (item.kind === 'image') {
      produced = exportImage(item, ctx);
    } else {
      switch (item.type) {
        case 'logo': produced = exportLogo(item, ctx); break;
        case 'invoice': produced = exportStaticText(item, 'Invoice', { font: 'IBM Plex Mono' }, ctx, 'invoice'); break;
        case 'businessName': produced = exportBoundText(item, 'business.name', ctx, 'businessName'); break;
        case 'invoiceNumber': produced = exportBoundText(item, 'invoice.number', ctx, 'invoiceNumber'); break;
        case 'issueDate': produced = exportDateRow(item, 'invoice.issue_date', ctx, 'issueDate'); break;
        case 'dueDate': produced = exportDateRow(item, 'invoice.due_date', ctx, 'dueDate'); break;
        case 'billTo': produced = exportClientInfo(item, ctx); break;
        case 'from': produced = exportBusinessInfoSenderRepeat(item, ctx); break;
        case 'itemsTable': produced = exportTable(item, ctx); break;
        case 'subtotal': produced = exportTotalsRow(item, 'subtotal', ctx); break;
        case 'tax': produced = exportTotalsRow(item, 'tax', ctx); break;
        case 'discount': produced = exportTotalsRow(item, 'discount', ctx); break;
        case 'totalDue': produced = exportTotalsRow(item, 'total', ctx); break;
        case 'currencyConversion':
          ctx.warnings.push('currencyConversion: production has no matching binding at all (confirmed against SUPPORTED_BINDINGS) — exported as static, non-live placeholder text.');
          produced = exportStaticText(item, 'Currency conversion', {}, ctx, 'currencyConversion');
          break;
        case 'notes': produced = exportNotesSection(item, 'notes', ctx); break;
        case 'terms': produced = exportNotesSection(item, 'terms', ctx); break;
        case 'paymentMethods': produced = exportPaymentInfo(item, ctx); break;
        case 'payOnline': produced = exportPayOnline(item, ctx); break;
        default:
          warnings.push(`${item.type}: unrecognized editor catalog type — dropped from export.`);
      }
    }

    produced.forEach((el) => {
      const shifted = shiftToProduction(el.x, el.y, margins, !!el.style?.sidebar);
      el.x = shifted.x;
      el.y = shifted.y;
    });

    const target = HEADER_CATALOG_TYPES.has(item.type) ? header : flow;
    target.push(...produced);
  });

  const page = {
    size: 'A4',
    width_mm: template.page.width,
    height_mm: template.page.height,
    background_color: template.page.backgroundColor,
    // Phase 2b: ALWAYS written explicitly, never omitted — the editor has
    // no margin/sidebar editing UI yet, so `page.margin*Mm` only ever
    // carries a value here having survived an earlier import verbatim
    // (same "lossless passthrough of an as-yet-uneditable field"
    // precedent as layout_mode — see report item 3), defaulting to 0
    // otherwise. Explicit 0 (not omission) matters: design_schema.py's
    // own validator falls back to a real default margin (20mm left/16mm
    // right) whenever the key is ABSENT, not zero — which would silently
    // reinterpret the editor's own page-relative item positions (already
    // laid out edge-to-edge against the true page, see elementCatalog.js)
    // as a much narrower content box the editor was never respecting,
    // and every element would fail the right-edge bounds check.
    margin_top_mm: margins.top,
    margin_right_mm: margins.right,
    margin_bottom_mm: margins.bottom,
    margin_left_mm: margins.left,
  };
  if (template.page.sidebar) page.sidebar = template.page.sidebar;
  if (footerItem) page.footer = exportFooter(footerItem, ctx);

  const designData = {
    schema_version: SCHEMA_VERSION_V2,
    page,
    header: { elements: header },
    flow: { elements: flow },
  };

  return { designData, warnings };
}

// ── IMPORT: one production element -> zero or more editor items ────────

function importLogo(el, _ctx) {
  const item = createContentItem('logo');
  Object.assign(item, importBaseFields(el));
  const radius = el.style?.border_radius_mm;
  if (radius >= 9999) item.logoShape = 'circle';
  else if (radius) {
    item.logoShape = 'rounded';
    item.logoRadiusMm = radius;
  } else {
    item.logoShape = 'square';
  }
  return [item];
}

function importFontOnto(item, style, ctx, label) {
  if (style?.font) {
    const { id, matched } = productionNameToFontId(style.font);
    if (matched) item.fontFamily = id;
    else ctx.warnings.push(`${label}: font "${style.font}" has no matching editor font catalog entry and was dropped (will fall back to the editor's default font).`);
  }
  if (style?.font_weight) item.fontWeight = style.font_weight;
  if (style?.font_size_pt) item.fontSize = style.font_size_pt;
}

function importBoundTextAs(catalogType, el, ctx) {
  const item = createContentItem(catalogType);
  Object.assign(item, importBaseFields(el));
  importFontOnto(item, el.style, ctx, catalogType);
  const color = colorFromProduction(el.style?.color);
  if (color) item.textColor = color;
  if (el.style?.align) item.contentAlign = el.style.align;
  return [item];
}

// Both `invoice` (the "Invoice" eyebrow) and `currencyConversion` export
// as unbound (binding=null) static generic:text — the only thing that
// tells them apart on import is their literal, fixed `style.text`
// content (both catalog types always export the exact same string — see
// exportStaticText's own call sites). Any other unbound text (a
// hand-authored design's own literal caption, say) has no editor slot at
// all — dropped, reported. Each of the two recognized labels is still a
// single-instance catalog type, tracked in `seenStaticLabels`.
const STATIC_TEXT_LABEL_TO_CATALOG_TYPE = {
  Invoice: 'invoice',
  'Currency conversion': 'currencyConversion',
};

function importStaticText(el, ctx, seenStaticLabels) {
  const text = el.style?.text;
  const catalogType = STATIC_TEXT_LABEL_TO_CATALOG_TYPE[text];
  if (!catalogType) {
    ctx.warnings.push(`generic:text (static, "${text}"): no editor catalog type recognizes this literal text — dropped.`);
    return [];
  }
  if (seenStaticLabels.has(catalogType)) {
    ctx.warnings.push(`generic:text (static, "${text}"): the editor's "${catalogType}" is a single-instance catalog type — a second occurrence was dropped.`);
    return [];
  }
  seenStaticLabels.add(catalogType);
  const item = createContentItem(catalogType);
  Object.assign(item, importBaseFields(el));
  importFontOnto(item, el.style, ctx, catalogType);
  return [item];
}

const BOUND_TEXT_CATALOG_BY_BINDING = {
  'business.name': 'businessName',
  'invoice.number': 'invoiceNumber',
  'invoice.issue_date': 'issueDate',
  'invoice.due_date': 'dueDate',
};

function importClientInfo(el, ctx) {
  const item = createContentItem('billTo');
  Object.assign(item, importBaseFields(el));
  if (el.style?.label && el.style.label !== 'Bill to') {
    ctx.warnings.push(`billTo: custom label "${el.style.label}" has no editor field (the block's title text is fixed "Bill To") and was dropped.`);
  }
  return [item];
}

function importBusinessInfo(el, ctx) {
  if (el.style?.variant === 'sender_repeat') {
    const item = createContentItem('from');
    Object.assign(item, importBaseFields(el));
    if (el.style?.label && el.style.label !== 'From') {
      ctx.warnings.push(`from: custom label "${el.style.label}" has no editor field (the block's title text is fixed "From") and was dropped.`);
    }
    return [item];
  }
  ctx.warnings.push('business_info (masthead variant): no editor catalog type represents the bundled masthead business_info element (the editor decomposes this into separate "invoice"/"businessName" items instead) — dropped.');
  return [];
}

function importTable(el, ctx) {
  const item = createContentItem('itemsTable');
  Object.assign(item, importBaseFields(el));
  importFontOnto(item, el.style, ctx, 'itemsTable');
  if (el.style?.header_color) item.headerTextColor = colorFromProduction(el.style.header_color);
  if (el.style?.header_border_color) ctx.warnings.push('itemsTable: header_border_color has no editor field and was dropped.');
  if (el.style?.row_border_color) item.rowBorderColor = colorFromProduction(el.style.row_border_color);
  if (el.style?.columns && el.style.columns.length && el.style.columns.length !== 4) {
    ctx.warnings.push(`itemsTable: production's narrowed/reordered column list (${JSON.stringify(el.style.columns)}) has no editor equivalent — all 4 default columns will show instead.`);
  }
  return [item];
}

function importTotalsRow(el, ctx) {
  const rows = el.style?.rows || ['subtotal', 'tax', 'discount', 'total'];
  const variant = el.style?.variant;
  if (rows.length !== 1 || variant) {
    ctx.warnings.push(`totals (rows=${JSON.stringify(rows)}${variant ? `, variant=${variant}` : ''}): only a single-row, no-variant totals element maps cleanly to one editor catalog type — dropped.`);
    return [];
  }
  const catalogByRow = { subtotal: 'subtotal', tax: 'tax', discount: 'discount', total: 'totalDue' };
  const item = createContentItem(catalogByRow[rows[0]]);
  Object.assign(item, importBaseFields(el));
  if (el.style?.align) item.contentAlign = el.style.align;
  return [item];
}

function importNotes(el, ctx) {
  const sections = el.style?.sections || ['notes', 'terms'];
  const items = [];
  if (sections.includes('notes')) {
    const item = createContentItem('notes');
    Object.assign(item, importBaseFields(el));
    items.push(item);
  }
  if (sections.includes('terms')) {
    const item = createContentItem('terms');
    Object.assign(item, importBaseFields(el));
    items.push(item);
  }
  if (sections.includes('notes') && sections.includes('terms')) {
    ctx.warnings.push('notes (sections=[notes,terms]): one combined production element was split into two editor items (notes + terms), both given the SAME box — position them independently by hand if needed.');
  }
  return items;
}

function importPaymentInfo(el, ctx) {
  if (el.style?.variant === 'qr_and_link') {
    ctx.warnings.push('payment_info (legacy qr_and_link variant): imported as payOnline (QR only) — the payment-link text this variant also shows has no editor field and was dropped.');
    const item = createContentItem('payOnline');
    Object.assign(item, importBaseFields(el));
    return [item];
  }
  const item = createContentItem('paymentMethods');
  Object.assign(item, importBaseFields(el));
  return [item];
}

function importQrCode(el, _ctx) {
  const item = createContentItem('payOnline');
  Object.assign(item, importBaseFields(el));
  return [item];
}

function importSignature(el, ctx) {
  ctx.warnings.push('signature: one production element was expanded into three editor items (signatureImage/signatureDivider/signatureLabel), all sharing an approximated position derived from the single source box — this is not the inverse of the editor\'s own export (see report item 6) and will not round-trip exactly.');
  const { x, y, width, height } = el;
  const image = createContentItem('signatureImage');
  Object.assign(image, { x, y, width: Math.min(width, 37), height: Math.min(height, 35) });
  const divider = createContentItem('signatureDivider');
  Object.assign(divider, { x, y: y + Math.min(height, 35) + 2, width: Math.min(width, 70), height: 0.53 });
  const label = createContentItem('signatureLabel');
  Object.assign(label, { x, y: y + Math.min(height, 35) + 4, width, height: 4.23 });
  if (el.style?.label && el.style.label !== 'Authorised Signature') {
    // no editor field carries custom signature label text either (it's fixed baked content) — same class of gap as billTo/from labels
    ctx.warnings.push(`signature: custom label "${el.style.label}" has no editor field (signatureLabel's text is fixed) and was dropped.`);
  }
  return [image, divider, label];
}

function importGenericShape(el, ctx) {
  if (el.type === 'rectangle') {
    const shape = createShape('roundedRect', { x: el.x, y: el.y });
    Object.assign(shape, importBaseFields(el), { radius: 0 });
    if (el.style?.background_color) shape.fill = colorFromProduction(el.style.background_color);
    if (el.style?.border_color) shape.borderColor = colorFromProduction(el.style.border_color);
    if (el.style?.border_width_mm) shape.borderWidth = el.style.border_width_mm;
    return [shape];
  }
  if (el.type === 'ellipse') {
    const shape = createShape('ellipse', { x: el.x, y: el.y });
    Object.assign(shape, importBaseFields(el));
    if (el.style?.background_color) shape.fill = colorFromProduction(el.style.background_color);
    if (el.style?.border_color) shape.borderColor = colorFromProduction(el.style.border_color);
    if (el.style?.border_width_mm) shape.borderWidth = el.style.border_width_mm;
    return [shape];
  }
  if (el.type === 'divider') {
    const thickness = el.style?.thickness_mm ?? 0.5;
    const shape = createShape('line', { x: el.x, y: el.y });
    Object.assign(shape, importBaseFields(el), { height: thickness, naturalHeight: thickness });
    if (el.style?.color) shape.fill = colorFromProduction(el.style.color);
    return [shape];
  }
  if (el.type === 'container') {
    ctx.warnings.push('generic:container: no editor equivalent (not even in the shape catalog) — dropped.');
    return [];
  }
  return [];
}

function importImage(el, ctx) {
  if (!el.style?.src) {
    ctx.warnings.push('generic:image with no style.src — nothing to import, dropped.');
    return [];
  }
  const item = {
    id: newId('image'),
    kind: 'image',
    dataUrl: el.style.src,
    ...importBaseFields(el),
    naturalWidth: el.width,
    naturalHeight: el.height,
    rotation: el.rotation || 0,
    allowFreeLayering: true,
    cornerRadius: 0,
    sourceWidth: el.width,
    sourceHeight: el.height,
  };
  if (el.crop) ctx.warnings.push('generic:image: non-destructive crop has no editor rendering support yet (no cropping UI exists) — the image imports uncropped.');
  return [item];
}

function importFooter(page, ctx) {
  const item = createContentItem('footer');
  const style = page.footer?.style || {};
  if (style.text_color) item.textColor = colorFromProduction(style.text_color);
  if (style.background_color && style.background_color !== 'transparent') item.bgColor = colorFromProduction(style.background_color);
  if (style.divider_color) item.dividerColor = colorFromProduction(style.divider_color);
  importFontOnto(item, style, ctx, 'footer');
  if (style.show_wordmark === false) ctx.warnings.push('page.footer.style.show_wordmark=false: the editor\'s footer always shows the wordmark (no hide toggle) — ignored.');
  return item;
}

function importOneElement(el, ctx, seenStaticLabels) {
  if (el.kind === 'semantic') {
    switch (el.type) {
      case 'logo': return importLogo(el, ctx);
      case 'client_info': return importClientInfo(el, ctx);
      case 'business_info': return importBusinessInfo(el, ctx);
      case 'totals': return importTotalsRow(el, ctx);
      case 'notes': return importNotes(el, ctx);
      case 'payment_info': return importPaymentInfo(el, ctx);
      case 'qr_code': return importQrCode(el, ctx);
      case 'online_payment_link':
        ctx.warnings.push('online_payment_link: no standalone editor catalog type (the editor only offers this bundled with a QR code, as payOnline) — dropped.');
        return [];
      case 'signature': return importSignature(el, ctx);
      case 'dates':
        ctx.warnings.push('dates (bundled): no single editor catalog type represents this atomic bundle (the editor keeps invoiceNumber/issueDate/dueDate as independent items) — dropped.');
        return [];
      default:
        ctx.warnings.push(`semantic:${el.type}: unrecognized — dropped.`);
        return [];
    }
  }
  if (el.kind === 'structural' && el.type === 'table') return importTable(el, ctx);
  if (el.kind === 'generic') {
    if (el.type === 'text') {
      if (el.binding && BOUND_TEXT_CATALOG_BY_BINDING[el.binding]) {
        return importBoundTextAs(BOUND_TEXT_CATALOG_BY_BINDING[el.binding], el, ctx);
      }
      if (el.binding) {
        ctx.warnings.push(`generic:text bound to "${el.binding}": no editor catalog type exposes this binding individually — dropped.`);
        return [];
      }
      return importStaticText(el, ctx, seenStaticLabels);
    }
    if (el.type === 'image') return importImage(el, ctx);
    return importGenericShape(el, ctx);
  }
  ctx.warnings.push(`${el.kind}:${el.type}: unrecognized element kind/type combination — dropped.`);
  return [];
}

// ── IMPORT: whole design_data -> template ───────────────────────────────

export function designDataToTemplate(designData) {
  // Explicit, loud rejection of anything that isn't real v2 design_data —
  // never silently mangled into a nonsense template. A legacy-shaped
  // payload's migration is design_migration.py's job (explicitly out of
  // this phase's scope, per the prompt) — this adapter only ever accepts
  // its real input contract.
  if (!designData || typeof designData !== 'object' || designData.schema_version !== SCHEMA_VERSION_V2) {
    throw new Error(
      `designDataToTemplate expects real schema_version: 2 design_data, got schema_version=${designData?.schema_version}. ` +
        'A legacy-shaped payload must be migrated first (design_migration.py) — this adapter does not do that conversion.'
    );
  }
  if (!designData.header || !designData.flow || !designData.page) {
    throw new Error('designDataToTemplate expects design_data.header, .flow, and .page to all be present.');
  }

  const warnings = [];
  const ctx = { warnings };
  const seenStaticLabels = new Set();

  const items = [];
  const headerEls = designData.header?.elements || [];
  const flowEls = designData.flow?.elements || [];
  const margins = marginsOfProductionPage(designData.page);

  // Shift every element from production's content/sidebar-relative space
  // into the editor's single page-relative space BEFORE classification —
  // every import* function below then just reads el.x/el.y directly,
  // already in editor coordinates, with no per-type shift logic needed.
  const shiftedEl = (el) => {
    const shifted = shiftToEditor(el.x, el.y, margins, !!el.style?.sidebar);
    return { ...el, x: shifted.x, y: shifted.y };
  };

  headerEls.forEach((el) => items.push(...importOneElement(shiftedEl(el), ctx, seenStaticLabels)));
  flowEls.forEach((el) => items.push(...importOneElement(shiftedEl(el), ctx, seenStaticLabels)));

  items.push(importFooter(designData.page || {}, ctx));

  const page = {
    width: designData.page?.width_mm,
    height: designData.page?.height_mm,
    // '#ffffff' matches design_canvas.py's own real fallback
    // (`page.get('background_color', '#ffffff')`) — NOT the editor's own
    // arbitrary cream default (initialState.js's '#FAF9F6'), so an
    // omitted background_color (e.g. the real Modern seed) imports as
    // what production actually renders, not a color the editor invented.
    backgroundColor: designData.page?.background_color || '#ffffff',
  };
  ['margin_top_mm', 'margin_right_mm', 'margin_bottom_mm', 'margin_left_mm'].forEach((prodKey, i) => {
    const key = ['marginTopMm', 'marginRightMm', 'marginBottomMm', 'marginLeftMm'][i];
    if (designData.page?.[prodKey] !== undefined) page[key] = designData.page[prodKey];
  });
  if (designData.page?.sidebar) page.sidebar = designData.page.sidebar;

  const template = {
    items,
    page,
    theme: DEFAULT_THEME,
  };

  return { template, warnings };
}
