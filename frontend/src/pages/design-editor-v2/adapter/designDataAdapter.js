// apps/invoices/design_schema.py <-> editor `template` — Phase 3c rewrite.
//
// Two pure functions, no unit conversion anywhere in this file (Phase 2a
// made the editor mm-native — every x/y/width/height/rotation value below
// is read and written verbatim, in mm, exactly as design_schema.py itself
// stores it). No React, no EditorContext, no network calls.
//
//   templateToDesignData(template) -> { designData, warnings }
//   designDataToTemplate(design_data) -> { template, warnings }
//
// ── Why this file exists (Phase 3c) ─────────────────────────────────────
// Phase 2b's adapter mapped the editor's closed, bundled catalog types
// onto production's SEMANTIC bundles (client_info/business_info/dates/
// signature/...) as single, atomic elements. That failed its own
// round-trip criterion: real BUILTIN_DESIGNS seeds (apps/invoices/
// design_templates.py) do NOT use those bundles for header content any
// more — Phase 4B/4B.3 decomposed business_info/client_info/dates into
// individually positioned, individually bound `generic:text` elements
// (one per real field), and further decomposed the old `qr_and_link`
// payment_info variant into two independent elements
// (`qr_code`/`online_payment_link`). This file's EXPORT direction now
// targets that same generic-element-plus-binding shape for exactly the
// content that real seeds decompose (header identity fields, dates,
// pay-online), while a DIRECT, VERIFIED READ of the current
// design_templates.py/design_schema.py/design_renderer.py confirms two
// things Phase 3c's own brief assumed but did NOT hold on inspection —
// see the two "VERIFIED DEVIATION" comments below (exportTotalsRow/
// exportNotesSection/exportPaymentInfo, and exportSignatureGroup) for the
// full reasoning on why those specific bundles are kept as real
// production `semantic:*` elements rather than force-decomposed.
//
// ── The "outer item box has no production counterpart" problem ─────────
// The editor's billTo/from/issueDate/dueDate/payOnline catalog items are
// each ONE draggable box containing several independently-styled but NOT
// independently-POSITIONED sub-parts (CSS-flow-stacked internally, see
// CanvasItem.jsx's 'block'/'label-value' rendering). Production's real
// decomposition gives each sub-part its own real x/y/width/height, with
// NO shared "outer box" concept at all. Two facts follow:
//   1. On IMPORT, an outer item box is synthesized (min/max over whatever
//      sub-elements were found) purely for the editor's own drag/resize
//      UX — production has no equivalent value to read this from.
//   2. On EXPORT, each sub-part's real x/y/width/height is derived from
//      the item's own current box via a PART LAYOUT FUNCTION (see
//      `BLOCK_LAYOUTS`/`datePartLayout`/`payOnlineLinkLayout` below), not
//      read back from anything "positional" stored on the sub-part
//      itself (there's nothing to read — the editor never grants
//      independent drag to a sub-part).
// A part layout function is written so that re-importing its OWN output
// (union of the produced sub-elements) recovers the EXACT original outer
// box — this is what makes "editor's own starter template survives an
// exact round trip" achievable despite (1)/(2), using "the last part's
// size is the remainder, not a fraction" so floating point can't drift
// the union sum. It does NOT, and cannot, guarantee that a REAL
// production seed's own per-line x/y offsets survive byte-for-byte
// UNLESS they were captured at import — which IS done, via each item's
// `_parts` bag (see `capturePartsFromEls` / `partAbs` below): whichever
// sub-elements a real import actually found have their EXACT relative
// offset+size captured, and EXPORT prefers that captured value over the
// computed layout function whenever it's present. A part layout function
// only ever runs for a part with NO captured data (a brand-new item, or
// a line a user re-enabled after it was never part of the original
// import).
import { createContentItem, createGenericTextItem } from '../data/elementCatalog';
import { createShape } from '../data/shapeCatalog';
import { DEFAULT_THEME } from '../utils/theme';
import { fontIdToProductionName, productionNameToFontId } from './fontMap';
import { BINDING_OPTIONS } from '../data/bindings';
import { roundMm } from '../utils/units';
import { normalizeZOrder } from '../utils/zorder';

const SCHEMA_VERSION_V2 = 2;

const HEADER_CATALOG_TYPES = new Set([
  'logo', 'invoice', 'businessName', 'invoiceNumber', 'issueDate', 'dueDate', 'billTo', 'from',
]);

// ── Coordinate space: editor page-relative <-> production content-relative ─
// (unchanged from Phase 2b — see that phase's own comment history for the
// full reasoning; still correct after this rewrite.)
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

// `roundMm` (2dp, matching design_schema.py's own stored precision
// convention exactly — see utils/units.js) is applied to every shifted
// result: an add-then-subtract (or vice versa) round trip through a
// margin value is otherwise a real, observed source of float noise
// (122.23 + 14 - 14 !== 122.23 in IEEE 754 double arithmetic) that would
// otherwise fail this file's own exact-round-trip bar for no reason
// other than binary floating point representation — never a genuine
// design difference.
function shiftToProduction(x, y, margins, isSidebar) {
  if (isSidebar) return { x: roundMm(x), y: roundMm(y) };
  return { x: roundMm(x - (margins.left + margins.sidebarWidth)), y: roundMm(y - margins.top) };
}

function shiftToEditor(x, y, margins, isSidebar) {
  if (isSidebar) return { x: roundMm(x), y: roundMm(y) };
  return { x: roundMm(x + (margins.left + margins.sidebarWidth)), y: roundMm(y + margins.top) };
}

// ── Color theme-link <-> production sentinel conversion (unchanged) ────

function colorToProduction(value) {
  if (value == null) return undefined;
  if (typeof value === 'object') {
    if (value.linked === 'primary') return 'theme_primary';
    if (value.linked === 'secondary') return 'theme_secondary';
    return undefined;
  }
  return value;
}

function colorFromProduction(value) {
  if (value == null) return undefined;
  if (value === 'theme_primary') return { linked: 'primary' };
  if (value === 'theme_secondary') return { linked: 'secondary' };
  return value;
}

// ── Font theme-link <-> production sentinel conversion ──────────────────
// Phase 3a added a real font-theme-link mechanism to production
// (design_renderer.py's resolve_theme_font_family/resolve_theme_font_weight,
// sentinels 'theme_heading_font'/'theme_body_font' on BOTH `style.font`
// and `style.font_weight`) — Phase 2b predates this and had to resolve a
// theme-linked editor font to its current literal value at export time
// (a real, one-directional loss, documented at length in that phase's own
// report). That loss is now closed: a linked fontFamily exports as the
// sentinel string on both style keys, and re-imports back into the exact
// same `{ linked: 'heading' | 'body' }` sentinel — no resolution, no loss.
function fontToProduction(fontFamilyValue, fontWeightValue) {
  if (fontFamilyValue && typeof fontFamilyValue === 'object' && fontFamilyValue.linked) {
    const sentinel = fontFamilyValue.linked === 'heading' ? 'theme_heading_font' : 'theme_body_font';
    return { font: sentinel, font_weight: sentinel };
  }
  const font = fontFamilyValue ? fontIdToProductionName(fontFamilyValue) : undefined;
  return { font, font_weight: fontWeightValue };
}

// Returns { fontFamily, fontWeight, matched, isThemeSentinel } — `matched`
// is true both for a real catalog hit AND for "nothing to match" (no
// style.font at all, or a theme sentinel); false only for a genuinely
// unrecognized literal font name (the only case a warning should fire for).
function fontFromProduction(styleFontValue, styleWeightValue) {
  if (styleFontValue === 'theme_heading_font' || styleFontValue === 'theme_body_font') {
    return {
      fontFamily: { linked: styleFontValue === 'theme_heading_font' ? 'heading' : 'body' },
      fontWeight: undefined,
      matched: true,
      isThemeSentinel: true,
    };
  }
  if (styleFontValue === undefined) {
    return { fontFamily: undefined, fontWeight: styleWeightValue, matched: true };
  }
  const { id, matched } = productionNameToFontId(styleFontValue);
  return { fontFamily: matched ? id : undefined, fontWeight: styleWeightValue, matched };
}

// ── Modeled vs. passthrough text style ──────────────────────────────────
// Every generic:text-shaped element the editor can produce has exactly
// these 5 style keys modeled by real editable UI (fontFamily/fontWeight ->
// font/font_weight, fontSize -> font_size_pt, textColor -> color,
// contentAlign -> align). Anything else in a real production element's
// style (letter_spacing_em/text_transform on the 3 fixed uppercase
// eyebrow labels, or any other field a hand-authored design might carry)
// has no editor UI at all — captured VERBATIM into a reserved `.extra`
// bag at import and merged back in, unchanged, at export, so it is never
// silently dropped and never fights a field the UI *can* edit (a key
// present in `.extra` never overlaps a modeled key, by construction: the
// capture step below explicitly excludes the 5 modeled keys from it).
const MODELED_TEXT_STYLE_KEYS = ['font', 'font_weight', 'font_size_pt', 'color', 'align'];
// `text` is never captured into `.extra` — every call site that cares
// about literal text content (unbound customText, the "Invoice"/"Bill
// to"/"From"/"Issue date"/"Due date" fixed labels) already reads
// `style.text` explicitly and handles it on its own terms; capturing it
// a second time into a generic passthrough bag would just be redundant,
// inert data with no real editor field to round-trip it through anyway
// (a fixed-content catalog item's own displayed text is baked in, never
// read from `.extra`).
const IGNORED_TEXT_STYLE_KEYS = ['text'];

function textStyleFromPart(part, label, ctx) {
  const style = {};
  const font = fontToProduction(part?.fontFamily, part?.fontWeight);
  if (font.font !== undefined) style.font = font.font;
  if (font.font_weight !== undefined) style.font_weight = font.font_weight;
  if (part?.fontSize) style.font_size_pt = part.fontSize;
  const color = colorToProduction(part?.textColor);
  if (color !== undefined) style.color = color;
  if (part?.contentAlign) style.align = part.contentAlign;
  return { ...style, ...(part?.extra || {}) };
}

// Writes fontFamily/fontWeight/fontSize/textColor/contentAlign + `.extra`
// onto `target` (an item, or a named sub-part object) from a real
// production `style` object. Mutates `target` in place; returns nothing.
function captureTextStyleOnto(target, style, ctx, label) {
  // `createContentItem` (the base every import* function starts from)
  // seeds a brand-new item with sensible THEME-LINKED defaults for a
  // user building from scratch (elementCatalog.js's own
  // defaultWholeItemStyle/defaultPartStyles) — those defaults must never
  // leak into an IMPORTED item's real style: a real production element
  // that genuinely has no `color`/`font` key means "no explicit color/
  // font", not "linked to the theme". Every one of the 5 modeled fields
  // is therefore unconditionally DELETED first, then re-set only when
  // the source style actually carries the corresponding key — never
  // "set if present, else silently keep whatever createContentItem
  // already put there".
  delete target.fontFamily;
  delete target.fontWeight;
  delete target.fontSize;
  delete target.textColor;
  delete target.contentAlign;
  const fontInfo = fontFromProduction(style?.font, style?.font_weight);
  if (fontInfo.fontFamily !== undefined) target.fontFamily = fontInfo.fontFamily;
  if (fontInfo.fontWeight !== undefined) target.fontWeight = fontInfo.fontWeight;
  if (style?.font_size_pt !== undefined) target.fontSize = style.font_size_pt;
  const color = colorFromProduction(style?.color);
  if (color !== undefined) target.textColor = color;
  if (style?.align !== undefined) target.contentAlign = style.align;
  if (style?.font && !fontInfo.matched) {
    ctx.warnings.push(`${label}: font "${style.font}" has no matching editor font catalog entry and was dropped (will fall back to the editor's default font).`);
  }
  const extra = {};
  Object.keys(style || {}).forEach((k) => {
    if (!MODELED_TEXT_STYLE_KEYS.includes(k) && !IGNORED_TEXT_STYLE_KEYS.includes(k)) extra[k] = style[k];
  });
  if (Object.keys(extra).length) target.extra = extra;
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
  if (item.layoutMode && item.layoutMode !== 'pinned') el.layout_mode = item.layoutMode;
  if (item.sidebar) el.style.sidebar = true;
  // 09 September 2026 (Part 2) — `style.page_pinned` (design_renderer.
  // is_page_pinned_element): the sidebar-independent sibling of
  // `style.sidebar` above, backing Professional's real spine bar/accent
  // line (design_templates.py). Same page-absolute coordinate-space
  // treatment as `sidebar` throughout this file (see shiftToProduction/
  // shiftToEditor below) — a real, separate flag because Professional has
  // no `page.sidebar` config at all, and giving it one purely to reuse
  // that mechanism would also incorrectly reserve real horizontal space
  // for main content (a genuine sidebar's own side effect this element
  // must not have).
  if (item.pagePinned) el.style.page_pinned = true;
  return el;
}

function importBaseFields(prodEl) {
  const patch = { x: prodEl.x, y: prodEl.y, width: prodEl.width, height: prodEl.height };
  if (prodEl.rotation) patch.rotation = prodEl.rotation;
  if (prodEl.locked) patch.locked = true;
  if (prodEl.hidden) patch.hidden = true;
  if (prodEl.layout_mode) patch.layoutMode = prodEl.layout_mode;
  if (prodEl.style?.sidebar) patch.sidebar = true;
  if (prodEl.style?.page_pinned) patch.pagePinned = true;
  return patch;
}

function newId(kind) {
  return `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// ── Multi-element decomposition: capture + layout ───────────────────────
//
// `item._parts[key] = { dx, dy, width, height, hidden }` — an exact,
// item-relative (dx/dy measured from item.x/item.y) record of where a
// real production sub-element sat, captured at import. `dx`/`dy` are
// used (not absolute x/y) so the whole group still moves together when
// the user drags the outer item.
//
// Absent for a brand-new item (never imported) — EXPORT then calls the
// catalog type's own layout function instead (BLOCK_LAYOUTS /
// datePartLayout / payOnlineLinkLayout below), each written so that
// reimporting ITS OWN output recovers the exact original item.x/y/width/
// height (every part's dx=0 unless documented otherwise, and the LAST
// part's height/width is always a remainder subtraction, never a
// fraction — see this file's own header comment).

function capturePartsFromEls(item, partEls, originX, originY) {
  const parts = {};
  Object.entries(partEls).forEach(([key, el]) => {
    if (!el) return;
    parts[key] = { dx: el.x - originX, dy: el.y - originY, width: el.width, height: el.height };
    if (el.hidden) parts[key].hidden = true;
  });
  item._parts = parts;
}

function partAbs(item, key, layoutFn) {
  const stored = item._parts && item._parts[key];
  const part = stored || layoutFn(item)[key];
  return { x: item.x + part.dx, y: item.y + part.dy, width: part.width, height: part.height, hidden: !!part.hidden };
}

// billTo: title + 4 lines, each spanning the item's full width, dividing
// item.height into 5 equal bands — the last band's height is
// `H - 4*(H/5)` (a subtraction, not `H/5` again), so the 5 bands' union
// always sums to EXACTLY item.height with no float-accumulation risk.
// Every layout function below rounds each computed value to the same
// 2dp `roundMm` precision the rest of this file's coordinates use —
// see signaturePartsFromBox's own comment for why (a real, observed
// binary-float drift caught by this file's own starter-template
// round-trip test before this fix).
function billToLayout(item) {
  const W = item.width;
  const H = item.height;
  const band = roundMm(H / 5);
  return {
    title: { dx: 0, dy: 0, width: W, height: band },
    clientName: { dx: 0, dy: band, width: W, height: band },
    clientCompany: { dx: 0, dy: roundMm(2 * band), width: W, height: band },
    address: { dx: 0, dy: roundMm(3 * band), width: W, height: band },
    email: { dx: 0, dy: roundMm(4 * band), width: W, height: roundMm(H - 4 * band) },
  };
}

// from: title + 3 lines, same "equal bands, last is a remainder" scheme.
function fromLayout(item) {
  const W = item.width;
  const H = item.height;
  const band = roundMm(H / 4);
  return {
    title: { dx: 0, dy: 0, width: W, height: band },
    businessName: { dx: 0, dy: band, width: W, height: band },
    address: { dx: 0, dy: roundMm(2 * band), width: W, height: band },
    email: { dx: 0, dy: roundMm(3 * band), width: W, height: roundMm(H - 3 * band) },
  };
}

const BLOCK_LAYOUTS = { billTo: billToLayout, from: fromLayout };
const BLOCK_LINE_KEYS = {
  billTo: ['title', 'clientName', 'clientCompany', 'address', 'email'],
  from: ['title', 'businessName', 'address', 'email'],
};
const BLOCK_LINE_BINDING = {
  billTo: { clientName: 'client.name', clientCompany: 'client.company', address: 'client.address', email: 'client.email' },
  from: { businessName: 'business.name', address: 'business.address_line1', email: 'business.email' },
};
const BLOCK_TITLE_TEXT = { billTo: 'Bill to', from: 'From' };
// Fixed, non-editable eyebrow typography — real, constant across all 3
// production templates for both "Bill to" and "From" (letter_spacing_em
// 0.16, text_transform uppercase) and for the "Invoice" masthead label
// (0.22, uppercase) below. Not modeled as editable UI (no such control
// exists in PropertiesPanel) — used as the DEFAULT `.extra` whenever a
// title has never been imported; a real imported value (even a
// deliberately different one from a hand-authored design) is captured
// into `.extra` exactly like any other unmodeled style key and always
// wins over this default.
const BLOCK_TITLE_EXTRA_DEFAULT = { letter_spacing_em: 0.16, text_transform: 'uppercase' };
const INVOICE_EYEBROW_EXTRA_DEFAULT = { letter_spacing_em: 0.22, text_transform: 'uppercase' };

// issueDate/dueDate: label + value, dividing item.width into thirds (label
// gets 1/3, value gets the exact remainder) — item.height is shared,
// unsplit, by both parts (this matches how label-value already lays out
// visually: side-by-side, not stacked).
function datePartLayout(item) {
  const W = item.width;
  const H = item.height;
  const labelW = roundMm(W / 3);
  return {
    label: { dx: 0, dy: 0, width: labelW, height: H },
    value: { dx: labelW, dy: 0, width: roundMm(W - labelW), height: H },
  };
}

// payOnline: qr (a square, item.x/y is ITS origin) + link, stacked
// vertically with the link taking the exact remaining height.
function payOnlineLayout(item) {
  const W = item.width;
  const H = item.height;
  const qrSize = roundMm(Math.min(W, H * 0.6));
  return {
    qr: { dx: 0, dy: 0, width: qrSize, height: qrSize },
    link: { dx: 0, dy: qrSize, width: W, height: roundMm(H - qrSize) },
  };
}

// Part 6 (per-part signature geometry/style) — signaturePartsFromBox is
// now a LEGACY-IMPORT-ONLY fallback: the ratio-split it computes is used
// solely to reconstruct a reasonable starting layout for a production
// `semantic:signature` element that predates `style.parts` (every design
// saved before this feature, and any hand-authored design that never sets
// it) — see importSignature below. It is NEVER used on export any more:
// a real production element's per-part geometry now comes straight from
// `style.parts` (round-tripped byte-for-byte via each editor item's own
// real x/y/width/height/rotation, captured/restored directly — no ratio
// inference of any kind once a design actually has `style.parts`).
// Derived directly from the editor's own default catalog boxes
// (elementCatalog.js: image 37x35, divider 70x2 (10mm gap below image),
// label 110x16 (7mm gap below divider)) — image=35/70 of height,
// gap1=10/70, divider=2/70, gap2=7/70, and label's height is the
// REMAINDER of all 4 (not a fraction) so the 5-part sum is always exactly
// H, matching this file's own "last part is a subtraction" rule. Widths:
// image=37/110 of width, divider=70/110, label=width itself (labels
// always span the full box).
function signaturePartsFromBox(x, y, width, height) {
  const imageH = roundMm(height * 0.5);
  const gap1 = roundMm(height * (10 / 70));
  const dividerH = roundMm(height * (2 / 70));
  const gap2 = roundMm(height * (7 / 70));
  const labelH = roundMm(height - imageH - gap1 - dividerH - gap2);
  const imageW = roundMm(width * (37 / 110));
  const dividerW = roundMm(width * (70 / 110));
  return {
    image: { x, y, width: imageW, height: imageH },
    divider: { x, y: roundMm(y + imageH + gap1), width: dividerW, height: dividerH },
    label: { x, y: roundMm(y + imageH + gap1 + dividerH + gap2), width, height: labelH },
  };
}

// ── EXPORT: one function per catalog type ───────────────────────────────

function exportLogo(item, _ctx) {
  const el = baseElementFields(item, 'semantic', 'logo');
  const shape = item.logoShape || 'square';
  if (shape === 'circle') el.style.border_radius_mm = 9999;
  else if (shape === 'rounded' && item.logoRadiusMm) el.style.border_radius_mm = item.logoRadiusMm;
  else if (shape === 'rounded') el.style.border_radius_mm = 2.65;
  return [el];
}

function exportEyebrowText(item, text, extraDefault, ctx, label) {
  const el = baseElementFields(item, 'generic', 'text');
  el.binding = null;
  const style = textStyleFromPart(item.extra ? item : { ...item, extra: extraDefault }, label, ctx);
  el.style = { ...el.style, ...style, text };
  return [el];
}

function exportBoundText(item, binding, ctx, label) {
  const el = baseElementFields(item, 'generic', 'text');
  el.binding = binding;
  el.style = { ...el.style, ...textStyleFromPart(item, label, ctx) };
  return [el];
}

function exportDateRow(item, binding, labelText, ctx, label) {
  const labelPos = partAbs(item, 'label', datePartLayout);
  const valuePos = partAbs(item, 'value', datePartLayout);
  const labelEl = {
    kind: 'generic', type: 'text', x: labelPos.x, y: labelPos.y, width: labelPos.width, height: labelPos.height,
    style: { ...textStyleFromPart(item.label, `${label}.label`, ctx), text: labelText }, overrides: {}, binding: null,
  };
  if (labelPos.hidden) labelEl.hidden = true;
  const valueEl = {
    kind: 'generic', type: 'text', x: valuePos.x, y: valuePos.y, width: valuePos.width, height: valuePos.height,
    style: { ...textStyleFromPart(item.value, `${label}.value`, ctx) }, overrides: {}, binding,
  };
  if (valuePos.hidden) valueEl.hidden = true;
  if (item.rotation) { labelEl.rotation = item.rotation; valueEl.rotation = item.rotation; }
  if (item.locked) { labelEl.locked = true; valueEl.locked = true; }
  return [labelEl, valueEl];
}

function exportBlockGroup(item, blockType, ctx) {
  const keys = BLOCK_LINE_KEYS[blockType];
  const layout = BLOCK_LAYOUTS[blockType];
  const hidden = item.hiddenLines || [];
  const out = [];
  keys.forEach((key) => {
    if (key !== 'title' && hidden.includes(key)) return;
    const pos = partAbs(item, key, layout);
    const isTitle = key === 'title';
    const part = item[key];
    const style = isTitle
      ? textStyleFromPart(part?.extra ? part : { ...part, extra: BLOCK_TITLE_EXTRA_DEFAULT }, `${blockType}.title`, ctx)
      : textStyleFromPart(part, `${blockType}.${key}`, ctx);
    const el = {
      kind: 'generic', type: 'text', x: pos.x, y: pos.y, width: pos.width, height: pos.height,
      style: isTitle ? { ...style, text: BLOCK_TITLE_TEXT[blockType] } : style,
      overrides: {},
      binding: isTitle ? null : BLOCK_LINE_BINDING[blockType][key],
    };
    if (pos.hidden) el.hidden = true;
    if (item.rotation) el.rotation = item.rotation;
    if (item.locked) el.locked = true;
    out.push(el);
  });
  return out;
}

function exportTable(item, ctx) {
  const el = baseElementFields(item, 'structural', 'table');
  el.binding = null;
  el.layout_mode = el.layout_mode || 'flow';
  const font = fontToProduction(item.fontFamily, item.fontWeight);
  if (font.font) el.style.font = font.font;
  if (item.headerTextColor) el.style.header_color = colorToProduction(item.headerTextColor);
  if (item.headerBg) ctx.warnings.push('itemsTable: header background color has no production table style field and was dropped.');
  if (item.rowBorderColor) el.style.row_border_color = colorToProduction(item.rowBorderColor);
  // Every real seed always authors the full default 4-column list
  // explicitly (design_templates.py's own `_table` helper) — the editor
  // has no column reordering/narrowing UI, so this is always the same
  // constant default, never omitted.
  el.style.columns = ['description', 'quantity', 'unit_price', 'total'];
  // `header_border_color` has NO dedicated editor field of its own
  // (only `headerTextColor`/`rowBorderColor` are real, live-editable
  // fields; a previous version of this function incorrectly read
  // `header_border_color` from the SAME `headerTextColor` field as
  // `header_color`, which is wrong — confirmed directly against
  // Professional's real seed, which sets header_border_color WITHOUT
  // header_color at all) — real, constant passthrough via
  // `item._tableExtra`, captured verbatim at import, merged back in
  // unchanged.
  Object.assign(el.style, item._tableExtra || {});
  // Table WYSIWYG parity fix — `item.columnAlign`/`altRowShading`/
  // `altRowColor`/`cellPadding` used to be treated as "editor-only
  // preview controls with no production field," dropped on every export
  // with a warning, even though Phase 3a gave every one of them a real
  // production field (`column_alignments`/`zebra_enabled`/`zebra_color`/
  // `cell_padding_mm`, apps/invoices/design_renderer.py's
  // resolve_table_columns/thead_cell_css/row_cell_css) — that pairing was
  // simply never wired up. Mapped here for real now, applied AFTER the
  // `_tableExtra` passthrough merge above so a live edit through these
  // fields always wins over stale extra data from an earlier import
  // (importTable below now excludes these 4 keys from `_tableExtra` for
  // the same reason). Each omitted, not written as a default/falsy value,
  // whenever the editor's own field was never touched — matching the
  // established "absent means production's own class-default" rule every
  // other optional style key in this file already follows.
  if (item.columnAlign) el.style.column_alignments = item.columnAlign;
  if (item.altRowShading) {
    el.style.zebra_enabled = true;
    if (item.altRowColor) el.style.zebra_color = colorToProduction(item.altRowColor);
  }
  if (item.cellPadding !== undefined) el.style.cell_padding_mm = item.cellPadding;
  return [el];
}

function exportTotalsRow(item, row, ctx) {
  const el = baseElementFields(item, 'semantic', 'totals');
  el.layout_mode = el.layout_mode || 'flow';
  el.style.align = item.contentAlign || 'right';
  el.style.rows = [row];
  Object.assign(el.style, item._extra || {});
  return [el];
}

function exportNotesSection(item, section, ctx) {
  const el = baseElementFields(item, 'semantic', 'notes');
  el.layout_mode = el.layout_mode || 'flow';
  el.style.sections = [section];
  Object.assign(el.style, item._extra || {});
  return [el];
}

// VERIFIED DEVIATION FROM THE PROMPT'S OWN "generic elements everywhere"
// framing — checked directly against apps/invoices/design_templates.py's
// real BUILTIN_DESIGNS (not assumed): totals/notes/payment_info are still
// real, current, CURRENTLY-RENDERED `semantic:*` bundles in every one of
// the 3 real seeds (each narrowed to exactly one row/section via
// `style.rows`/`style.sections`, per Phase 4B.3 — never decomposed into
// bound generic:text). Exporting these as anything else would fail this
// phase's own hard round-trip-against-real-seeds bar for no functional
// gain (totals/notes bindings exist in SUPPORTED_BINDINGS but nothing in
// design_templates.py actually uses them that way) — kept as semantic
// bundles, matching reality, with a real `._extra` passthrough added for
// forward-compatibility (Minimal's `total_due_display`/Modern's
// `total_pill` variants use exactly this passthrough — see
// exportTotalsRow above).
function exportPaymentInfo(item, ctx) {
  const el = baseElementFields(item, 'semantic', 'payment_info');
  el.layout_mode = el.layout_mode || 'flow';
  el.style.variant = 'bank_methods';
  el.style.label = 'Payment methods';
  ctx.warnings.push('paymentMethods: the editor shows a fixed 2-method preview (Bank transfer, Payoneer); production shows whichever of up to 5 real methods are actually configured — the exported element always represents the full real bundle, not just the 2 previewed.');
  Object.assign(el.style, item._extra || {});
  return [el];
}

// Pay Online now exports the two independent elements production
// actually has (`qr_code` + `online_payment_link` — confirmed real and
// separate in every one of the 3 BUILTIN_DESIGNS seeds, closing Phase
// 2b's own dropped-online_payment_link gap). `item.x/y` IS the qr_code's
// own box; the link's box is derived via payOnlineLinkLayout unless a
// real import captured its own exact offset (see partAbs).
function exportPayOnline(item, ctx) {
  const out = [];
  if (item._hasQr !== false) {
    const pos = partAbs(item, 'qr', payOnlineLayout);
    const qrEl = {
      kind: 'semantic', type: 'qr_code', x: pos.x, y: pos.y, width: pos.width, height: pos.height,
      style: {}, overrides: {},
    };
    if (pos.hidden) qrEl.hidden = true;
    if (item.rotation) qrEl.rotation = item.rotation;
    if (item.locked) qrEl.locked = true;
    if (item.sidebar) qrEl.style.sidebar = true;
    out.push(qrEl);
  }
  if (item._hasLink !== false) {
    const pos = partAbs(item, 'link', payOnlineLayout);
    const linkEl = {
      kind: 'semantic', type: 'online_payment_link', x: pos.x, y: pos.y, width: pos.width, height: pos.height,
      style: { label: 'Pay online', ...(item._linkExtra || {}) }, overrides: {},
    };
    if (pos.hidden) linkEl.hidden = true;
    if (item.rotation) linkEl.rotation = item.rotation;
    if (item.locked) linkEl.locked = true;
    if (item.sidebar) linkEl.style.sidebar = true;
    out.push(linkEl);
  }
  return out;
}

// VERIFIED DEVIATION FROM THE PROMPT'S OWN EXPLICIT SPEC — checked
// directly against design_renderer.py before implementing the prompt's
// literal "3 independent generic elements" instruction: production's
// generic:image type ONLY EVER resolves a literal `style.src`
// (design_renderer._element_has_real_content's own
// `kind=='generic' and el_type=='image'` branch reads nothing but
// `resolve_style_value(element, 'src')`) — there is NO mechanism for a
// generic:image to bind to a live, per-invoice value. The real
// `semantic:signature` type, by contrast, resolves
// `context['freelancer'].signature_url` LIVE at render time
// (design_renderer.py ~line 355). Decomposing signature into 3 generic
// elements as the prompt describes would therefore not be a lossless
// architectural improvement — it would PERMANENTLY BREAK every real
// invoice's signature (baking in whatever static image happened to be
// on canvas at design time instead of showing the actual freelancer's
// own uploaded signature). Kept as a real `semantic:signature` bundle,
// matching every one of the 3 BUILTIN_DESIGNS seeds exactly (including
// their real casing, "Authorised signature" — Phase 2b's own
// "Authorised Signature" was wrong). Geometry: the union of whichever of
// the 3 editor items exist.
//
// HISTORICAL, SUPERSEDED BY PART 6/PART 7 (kept for context, not current
// behavior): this used to be a lossy union-box export, "fixed" by forcing
// selection/move/resize/rotate to always act on the whole trio as one
// unit through the UI (elementCatalog.js's expandLinkedGroupSelection +
// EditorContext.jsx's setSelection wrapper + CanvasItem.jsx's beginMove).
// Part 6 replaced the union-box export itself with exact per-part
// `style.parts` geometry/style (see the comment below this one), which
// removed the NEED for that lock — resize/rotate stopped being lossy
// once each part's own real box round-trips directly. Part 7 then
// removed the lock everywhere it was no longer earning its keep:
// EditorContext.jsx's setSelection is now a plain passthrough (clicking
// one part selects only that part; resize/rotate/align/style all apply
// to it alone), and `expandLinkedGroupSelection` survives ONLY inside
// CanvasItem.jsx's beginMove, scoped to keeping the three parts
// TRANSLATING together on a drag — a deliberate product choice (moving
// "the signature block" shouldn't require dragging each part
// separately), not a data-integrity requirement any more.
//
// Rotation is captured per part now too (`style.parts.<part>.rotation`,
// Part 6) rather than forced to one shared bundle-level value — each
// part's own current rotation IS the real data, no shared-pivot
// reconstruction needed, and no cross-part rotation coupling exists in
// the editor any more (Part 7 treats rotation the same as resize/style:
// independent per part). The bundle-level `el.rotation` field below is
// therefore only ever set from whichever part happens to report one
// (`parts.reduce((found, p) => found || p.rotation || 0, 0)`, unchanged
// from before) — a legacy top-level fallback for callers that don't look
// inside `style.parts`, not a claim that all 3 parts share one rotation.
// Part 6 (per-part signature geometry/style) — each of the 3 signature
// items is a real, independently-positioned/-sized top-level item (unlike
// billTo/dates/payOnline's own single-item-with-internal-parts shape), so
// there is no ratio-split or layout function needed here at all: every
// part's own CURRENT x/y/width/height/rotation IS the real, exact data —
// captured directly into `style.parts.{image,divider,label}.{dx,dy,width,
// height,rotation}` (dx/dy relative to the shared anchor, `el.x`/`el.y`,
// so the group still moves together when the anchor is translated — see
// design_schema._validate_signature_style's own docstring), plus each
// part's own real style (image: border_color/border_width_mm/
// border_radius_mm from the exact same generic borderColor/borderWidth/
// cornerRadius fields every other content item already exposes; divider:
// color from item.bgColor, the same field CanvasItem.jsx's own 'divider'
// case already renders with; label: font/font_weight/font_size_pt/color/
// align via the same textStyleFromPart every other text-shaped part in
// this file already uses, so any of its own unmodeled keys still land in
// a real `.extra` passthrough, never silently dropped).
function exportSignatureGroup(imageItem, dividerItem, labelItem, ctx) {
  const parts = [imageItem, dividerItem, labelItem].filter(Boolean);
  const rotation = parts.reduce((found, p) => found || p.rotation || 0, 0);
  const minX = Math.min(...parts.map((p) => p.x));
  const minY = Math.min(...parts.map((p) => p.y));
  const maxX = Math.max(...parts.map((p) => p.x + p.width));
  const maxY = Math.max(...parts.map((p) => p.y + p.height));
  const el = {
    kind: 'semantic', type: 'signature',
    x: roundMm(minX), y: roundMm(minY), width: roundMm(maxX - minX), height: roundMm(maxY - minY),
    style: {}, overrides: {},
  };
  if (rotation) el.rotation = rotation;
  el.style.label = 'Authorised signature';
  if (labelItem?.contentAlign) el.style.align = labelItem.contentAlign;
  const extraSource = labelItem || dividerItem || imageItem;
  // `has_signature_image` is only written when a real import actually
  // HAD the key (captured verbatim into `_hasSignatureImageKey`, see
  // importSignature) — real Professional never sets it at all (only
  // Minimal/Modern do), so a from-scratch export defaults to writing it
  // (matching a fresh item's own "always show all 3 parts" intent),
  // while a re-export of an imported design matches whatever the source
  // actually did, byte for byte.
  if (extraSource?._hasSignatureImageKey !== false) {
    el.style.has_signature_image = !!imageItem;
  }
  Object.assign(el.style, extraSource?._extra || {});

  const partsOut = {};
  if (imageItem) {
    const image = {
      dx: roundMm(imageItem.x - minX), dy: roundMm(imageItem.y - minY),
      width: imageItem.width, height: imageItem.height,
    };
    if (imageItem.rotation) image.rotation = imageItem.rotation;
    const borderColor = colorToProduction(imageItem.borderColor);
    if (borderColor !== undefined) image.border_color = borderColor;
    if (imageItem.borderWidth) image.border_width_mm = imageItem.borderWidth;
    if (imageItem.cornerRadius) image.border_radius_mm = imageItem.cornerRadius;
    partsOut.image = image;
  }
  if (dividerItem) {
    const divider = {
      dx: roundMm(dividerItem.x - minX), dy: roundMm(dividerItem.y - minY),
      width: dividerItem.width, height: dividerItem.height,
    };
    if (dividerItem.rotation) divider.rotation = dividerItem.rotation;
    const color = colorToProduction(dividerItem.bgColor);
    if (color !== undefined) divider.color = color;
    partsOut.divider = divider;
  }
  if (labelItem) {
    const label = {
      dx: roundMm(labelItem.x - minX), dy: roundMm(labelItem.y - minY),
      width: labelItem.width, height: labelItem.height,
      ...textStyleFromPart(labelItem, 'signature.label', ctx),
    };
    if (labelItem.rotation) label.rotation = labelItem.rotation;
    partsOut.label = label;
  }
  el.style.parts = partsOut;

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
    // Phase 3a — rectangle corner radius now reuses `style.border_radius_mm`
    // (design_renderer.py: the same fill/border resolution rectangle and
    // container already share). Previously reported as dropped; real now.
    if (item.radius) el.style.border_radius_mm = item.radius;
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
  if (item.type === 'container') {
    // Genuinely the same fill/border/radius resolution as 'roundedRect'
    // above (design_renderer.py shares one code path for rectangle and
    // container, SHAPE_TYPES_WITH_OWN_FILL) — a distinct editor shape
    // catalog entry only so a design author can express the semantic
    // choice, never a second, independently-invented rendering.
    const el = baseElementFields(item, 'generic', 'container');
    const bg = colorToProduction(item.fill);
    if (bg) el.style.background_color = bg;
    const border = colorToProduction(item.borderColor);
    if (border) el.style.border_color = border;
    if (item.borderWidth) el.style.border_width_mm = item.borderWidth;
    if (item.radius) el.style.border_radius_mm = item.radius;
    return [el];
  }
  const el = baseElementFields(item, 'generic', 'divider');
  el.binding = null;
  const color = colorToProduction(item.fill);
  if (color) el.style.color = color;
  el.style.thickness_mm = item.height;
  // design_templates.py's own `_divider` helper: the element's outer box
  // height is ALWAYS a fixed, near-zero 1mm "hit box" — the real visible
  // line comes entirely from `style.thickness_mm`'s own CSS border-top,
  // never the box height itself (confirmed directly, not assumed). The
  // editor's own canvas still uses `item.height` as the line's visual
  // thickness for on-canvas display (unchanged) — these are two
  // genuinely independent numbers, only conflated before this fix.
  el.height = 1;
  return [el];
}

function exportImage(item, ctx) {
  const el = baseElementFields(item, 'generic', 'image');
  el.style.src = item.dataUrl;
  // Phase 3a — image border/radius now reuse the same border_color/
  // border_width_mm/border_radius_mm fields rectangle/logo already use
  // (design_renderer.py's own comment: "the same 3 field names
  // rectangle/container/logo already established"). Previously reported
  // as dropped; real now.
  const border = colorToProduction(item.borderColor);
  if (border) el.style.border_color = border;
  if (item.borderWidth) el.style.border_width_mm = item.borderWidth;
  if (item.cornerRadius) el.style.border_radius_mm = item.cornerRadius;
  // Phase 3a — non-destructive crop, a stored rectangle (fractions 0-1 of
  // the source image), never a re-encoded asset. No cropping UI exists
  // yet (unchanged from Phase 2b) — but the stored value itself now
  // round-trips losslessly rather than being silently dropped.
  if (item.crop) el.crop = item.crop;
  ctx.warnings.push('image: exported as a literal (likely large) data: URI — production has no separate asset-upload step for editor-authored images yet.');
  return [el];
}

// Font theme-linking retrofit (closes a previously VERIFIED DEVIATION):
// page.footer's own validator (design_schema.py's `_validate_footer`)
// used to require `style.font_weight` to be a plain number and never
// called resolve_theme_font_family/resolve_theme_font_weight at all — the
// Phase 3a theme-font-sentinel mechanism had been added for ordinary
// elements only, never retrofitted onto the footer's own, earlier,
// separate style validation, so a theme-linked footer font used to get
// silently RESOLVED to its current literal value here and would never
// re-link if the theme changed later. `design_schema.py` now accepts the
// same 'theme_heading_font'/'theme_body_font' sentinel on
// `page.footer.style.font_weight` (font_family already accepted any
// non-empty string) and `design_renderer.py`'s footer-style construction
// now resolves both through the exact same resolve_theme_font_family/
// resolve_theme_font_weight functions every ordinary element already
// uses — so this export can now reuse `fontToProduction` (the same
// sentinel-emitting conversion every ordinary text style already goes
// through) instead of resolving to a literal, exactly like the deviation
// comment above used to have to do.
function exportFooter(footerItem, ctx) {
  const style = {};
  if (footerItem.textColor) style.text_color = colorToProduction(footerItem.textColor);
  if (footerItem.bgColor) style.background_color = colorToProduction(footerItem.bgColor);
  if (footerItem.dividerColor) style.divider_color = colorToProduction(footerItem.dividerColor);
  const { font, font_weight: weight } = fontToProduction(footerItem.fontFamily, footerItem.fontWeight);
  if (font) style.font_family = font;
  if (footerItem.fontSize) style.font_size_pt = footerItem.fontSize;
  if (weight) style.font_weight = weight;
  // Byte-identical round-trip for the real "default-styled footer" case
  // (`page.footer: {}`, design_schema.py's own documented-valid shape,
  // all 3 real builtin seeds' Professional entry uses exactly this) —
  // an empty `style` object is semantically identical to an absent one
  // (design_renderer.py's `(footer or {}).get('style') or {}` treats them
  // the same either way) but only omitting it here matches what
  // importFooter actually received, rather than always re-wrapping a
  // no-op `{style: {}}` around it.
  return Object.keys(style).length ? { style } : {};
}

// customText: bound -> generic:text with a real binding (any of
// BINDING_OPTIONS, or an arbitrary string preserved verbatim from an
// earlier import the editor's own catalog never recognized); unbound ->
// generic:text with the user's own literal typed string. Real,
// unlimited multi-instance (elementCatalog.js's own `multiInstance`
// flag) — unlike every other catalog type in this file, more than one
// of these may exist in a single template, each independently exported.
function exportCustomText(item, ctx) {
  const el = baseElementFields(item, 'generic', 'text');
  el.binding = item.binding || null;
  const style = textStyleFromPart(item, 'text', ctx);
  if (!item.binding) style.text = item.text ?? '';
  el.style = { ...el.style, ...style };
  return [el];
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
  const signatureParts = [signatureImage, signatureDivider, signatureLabel].filter(Boolean);
  const signatureHandled = new Set(signatureParts.map((i) => i.id));
  // Emitted at whichever of the 3 signature parts comes FIRST in
  // template.items (real array/z-order) — not unconditionally first in
  // `flow`, which would silently scramble every real seed's own element
  // order (signature is always the LAST flow element in all 3
  // BUILTIN_DESIGNS seeds) and, more importantly, would misrepresent the
  // group's real paint position for a user who deliberately layered it
  // earlier in the stack.
  let signatureEmitted = false;

  template.items.forEach((item) => {
    if (item.type === 'footer') return;
    if (signatureHandled.has(item.id)) {
      if (signatureEmitted) return;
      signatureEmitted = true;
      const signatureEl = exportSignatureGroup(signatureImage, signatureDivider, signatureLabel, ctx);
      const shifted = shiftToProduction(signatureEl.x, signatureEl.y, margins, false);
      signatureEl.x = shifted.x;
      signatureEl.y = shifted.y;
      flow.push(signatureEl);
      return;
    }

    let produced = [];
    if (item.kind === 'shape') {
      produced = exportShape(item, ctx);
    } else if (item.kind === 'image') {
      produced = exportImage(item, ctx);
    } else {
      switch (item.type) {
        case 'logo': produced = exportLogo(item, ctx); break;
        case 'invoice': produced = exportEyebrowText(item, 'Invoice', INVOICE_EYEBROW_EXTRA_DEFAULT, ctx, 'invoice'); break;
        case 'businessName': produced = exportBoundText(item, 'business.name', ctx, 'businessName'); break;
        case 'invoiceNumber': produced = exportBoundText(item, 'invoice.number', ctx, 'invoiceNumber'); break;
        case 'issueDate': produced = exportDateRow(item, 'invoice.issue_date', 'Issue date', ctx, 'issueDate'); break;
        case 'dueDate': produced = exportDateRow(item, 'invoice.due_date', 'Due date', ctx, 'dueDate'); break;
        case 'billTo': produced = exportBlockGroup(item, 'billTo', ctx); break;
        case 'from': produced = exportBlockGroup(item, 'from', ctx); break;
        case 'itemsTable': produced = exportTable(item, ctx); break;
        case 'subtotal': produced = exportTotalsRow(item, 'subtotal', ctx); break;
        case 'tax': produced = exportTotalsRow(item, 'tax', ctx); break;
        case 'discount': produced = exportTotalsRow(item, 'discount', ctx); break;
        case 'totalDue': produced = exportTotalsRow(item, 'total', ctx); break;
        // Phase 3a added a real binding for this (invoice.client_currency_
        // conversion) — Phase 2b's own "no production binding exists"
        // warning/static-placeholder fallback is gone; this is now a
        // real, live, bound value like every other financial figure.
        case 'currencyConversion': produced = exportBoundText(item, 'invoice.client_currency_conversion', ctx, 'currencyConversion'); break;
        case 'notes': produced = exportNotesSection(item, 'notes', ctx); break;
        case 'terms': produced = exportNotesSection(item, 'terms', ctx); break;
        case 'paymentMethods': produced = exportPaymentInfo(item, ctx); break;
        case 'payOnline': produced = exportPayOnline(item, ctx); break;
        case 'customText': produced = exportCustomText(item, ctx); break;
        default:
          warnings.push(`${item.type}: unrecognized editor catalog type — dropped from export.`);
      }
    }

    produced.forEach((el) => {
      // `page_pinned` (Part 2) shares `sidebar`'s own page-absolute
      // coordinate space — neither shifts by margin/sidebar-width.
      const shifted = shiftToProduction(el.x, el.y, margins, !!(el.style?.sidebar || el.style?.page_pinned));
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
    margin_top_mm: margins.top,
    margin_right_mm: margins.right,
    margin_bottom_mm: margins.bottom,
    margin_left_mm: margins.left,
  };
  // Only written when the source actually had one (a real seed like
  // Modern's own real page has NO background_color key at all, relying
  // on the renderer's own default) — `_backgroundColorExplicit` is
  // false ONLY for a template imported from such a source and never
  // since edited via updatePageBackground (see EditorContext.jsx, which
  // flips this flag true the instant a user actually picks a color).
  if (template.page._backgroundColorExplicit !== false) {
    page.background_color = template.page.backgroundColor;
  }
  if (template.page.sidebar) page.sidebar = template.page.sidebar;
  if (template.page.spine) page.spine = template.page.spine;
  if (footerItem) page.footer = exportFooter(footerItem, ctx);

  const designData = {
    schema_version: SCHEMA_VERSION_V2,
    page,
    header: { elements: header },
    flow: { elements: flow },
  };

  return { designData, warnings };
}

// ── IMPORT: production design_data -> editor template ───────────────────

function importLogo(el, _ctx) {
  const item = createContentItem('logo');
  Object.assign(item, importBaseFields(el));
  const radius = el.style?.border_radius_mm;
  if (radius >= 9999) item.logoShape = 'circle';
  else if (radius) {
    item.logoShape = 'rounded';
    item.logoRadiusMm = radius;
  }
  // else: leave logoShape unset — 'square' is the render-time fallback,
  // and the editor's own starter-template logo item has no logoShape key
  // at all either (matches exactly, no extra explicit key introduced).
  return [item];
}

function importEyebrowText(catalogType, el, ctx) {
  const item = createContentItem(catalogType);
  Object.assign(item, importBaseFields(el));
  captureTextStyleOnto(item, el.style, ctx, catalogType);
  return [item];
}

function importBoundTextAs(catalogType, el, ctx) {
  const item = createContentItem(catalogType);
  Object.assign(item, importBaseFields(el));
  captureTextStyleOnto(item, el.style, ctx, catalogType);
  return [item];
}

// One production `generic:text` (unbound, literal) + one bound to
// `binding` -> one `issueDate`/`dueDate` editor item. Either half may be
// missing (a hand-authored design that dropped the label, say) — handled
// gracefully, using whichever real geometry is available for the
// captured `_parts` origin.
function importDatePair(catalogType, labelEl, valueEl, ctx) {
  const item = createContentItem(catalogType);
  const present = [labelEl, valueEl].filter(Boolean);
  const originX = Math.min(...present.map((e) => e.x));
  const originY = Math.min(...present.map((e) => e.y));
  const maxX = Math.max(...present.map((e) => e.x + e.width));
  const maxY = Math.max(...present.map((e) => e.y + e.height));
  item.x = originX;
  item.y = originY;
  item.width = roundMm(maxX - originX);
  item.height = roundMm(maxY - originY);
  const originEl = labelEl || valueEl;
  if (originEl.rotation) item.rotation = originEl.rotation;
  if (originEl.locked) item.locked = true;
  capturePartsFromEls(item, { label: labelEl, value: valueEl }, originX, originY);
  const setPart = (key, el) => {
    const target = {};
    if (el) captureTextStyleOnto(target, el.style, ctx, `${catalogType}.${key}`);
    if (Object.keys(target).length) item[key] = target;
  };
  setPart('label', labelEl);
  setPart('value', valueEl);
  if (!labelEl) ctx.warnings.push(`${catalogType}: no static label element found in the source — the editor will still show its own fixed label text, but no imported style/geometry backs it.`);
  if (!valueEl) ctx.warnings.push(`${catalogType}: no bound value element found in the source — the editor will still show a placeholder value, but no imported style/geometry backs it.`);
  return [item];
}

// A billTo/from GROUP found in the source -> one editor item, capturing
// each present line's exact geometry+style, and marking any REQUIRED-
// present-but-actually-optional line absent from the source as hidden
// (`hiddenLines`) so re-export doesn't invent content that wasn't there.
function importBlockGroup(blockType, titleEl, lineEls, ctx) {
  const catalogType = blockType;
  const item = createContentItem(catalogType);
  const present = [titleEl, ...Object.values(lineEls)].filter(Boolean);
  const originX = Math.min(...present.map((e) => e.x));
  const originY = Math.min(...present.map((e) => e.y));
  const maxX = Math.max(...present.map((e) => e.x + e.width));
  const maxY = Math.max(...present.map((e) => e.y + e.height));
  item.x = originX;
  item.y = originY;
  item.width = roundMm(maxX - originX);
  item.height = roundMm(maxY - originY);
  const partEls = { title: titleEl, ...lineEls };
  capturePartsFromEls(item, partEls, originX, originY);
  const hiddenLines = [];
  BLOCK_LINE_KEYS[blockType].forEach((key) => {
    if (key === 'title') return;
    const el = lineEls[key];
    if (!el) {
      hiddenLines.push(key);
      item[key] = {};
      return;
    }
    item[key] = {};
    captureTextStyleOnto(item[key], el.style, ctx, `${blockType}.${key}`);
  });
  item.title = {};
  if (titleEl) {
    captureTextStyleOnto(item.title, titleEl.style, ctx, `${blockType}.title`);
    if (titleEl.style?.label && titleEl.style.label !== BLOCK_TITLE_TEXT[blockType]) {
      ctx.warnings.push(`${blockType}: custom label text has no editor field (the block's title text is fixed) and was dropped.`);
    }
  } else {
    ctx.warnings.push(`${blockType}: no static title element found in the source.`);
  }
  if (hiddenLines.length) item.hiddenLines = hiddenLines;
  return [item];
}

function importTable(el, ctx) {
  const item = createContentItem('itemsTable');
  Object.assign(item, importBaseFields(el));
  const font = fontFromProduction(el.style?.font, undefined);
  if (font.fontFamily !== undefined) item.fontFamily = font.fontFamily;
  if (el.style?.font && !font.matched) ctx.warnings.push(`itemsTable: font "${el.style.font}" has no matching editor font catalog entry and was dropped.`);
  if (el.style?.header_color) item.headerTextColor = colorFromProduction(el.style.header_color);
  if (el.style?.row_border_color) item.rowBorderColor = colorFromProduction(el.style.row_border_color);
  const DEFAULT_COLUMNS = ['description', 'quantity', 'unit_price', 'total'];
  if (el.style?.columns && JSON.stringify(el.style.columns) !== JSON.stringify(DEFAULT_COLUMNS)) {
    ctx.warnings.push(`itemsTable: production's narrowed/reordered column list (${JSON.stringify(el.style.columns)}) has no editor equivalent — all 4 default columns will show instead.`);
  }
  // Table WYSIWYG parity fix — `column_alignments`/`zebra_enabled`/
  // `zebra_color`/`cell_padding_mm` (Phase 3a) now map onto this editor's
  // own real, already-rendering `columnAlign`/`altRowShading`/
  // `altRowColor`/`cellPadding` fields (CanvasItem.jsx's table case
  // already applies all 4 visually — the gap was these fields never
  // being POPULATED from a real import, not the rendering itself) instead
  // of silently falling into the opaque `_tableExtra` passthrough bag.
  //
  // `column_alignments` cycling: mirrors design_renderer.resolve_table_
  // columns' own `alignments[i % len(alignments)]` policy EXACTLY, but
  // applied over the editor's own fixed 4-column DISPLAY order (this
  // editor can't narrow/reorder columns at all — the warning above
  // already covers that gap) rather than production's real (possibly
  // narrowed/reordered) column list, since that's the only column order
  // this editor could ever paint the result against.
  if (el.style?.column_alignments?.length) {
    const alignments = el.style.column_alignments;
    item.columnAlign = DEFAULT_COLUMNS.map((_, i) => alignments[i % alignments.length]);
  }
  if (el.style?.zebra_enabled) {
    item.altRowShading = true;
    if (el.style.zebra_color) item.altRowColor = colorFromProduction(el.style.zebra_color);
  }
  if (el.style?.cell_padding_mm !== undefined) item.cellPadding = el.style.cell_padding_mm;
  // `header_border_color` has no dedicated editor field (only
  // `headerTextColor`/`rowBorderColor` are real, live-editable fields) —
  // real, constant passthrough via `_tableExtra`.
  const modeled = [
    'font', 'header_color', 'row_border_color', 'columns',
    'column_alignments', 'zebra_enabled', 'zebra_color', 'cell_padding_mm',
  ];
  const extra = {};
  Object.keys(el.style || {}).forEach((k) => {
    if (!modeled.includes(k)) extra[k] = el.style[k];
  });
  if (Object.keys(extra).length) item._tableExtra = extra;
  return [item];
}

function importTotalsRow(el, ctx) {
  const rows = el.style?.rows || ['subtotal', 'tax', 'discount', 'total'];
  if (rows.length !== 1) {
    ctx.warnings.push(`totals (rows=${JSON.stringify(rows)}): only a single-row totals element maps cleanly to one editor catalog type — dropped.`);
    return [];
  }
  const catalogByRow = { subtotal: 'subtotal', tax: 'tax', discount: 'discount', total: 'totalDue' };
  const item = createContentItem(catalogByRow[rows[0]]);
  Object.assign(item, importBaseFields(el));
  if (el.style?.align) item.contentAlign = el.style.align;
  const extra = {};
  Object.keys(el.style || {}).forEach((k) => {
    if (k !== 'align' && k !== 'rows') extra[k] = el.style[k];
  });
  if (Object.keys(extra).length) item._extra = extra;
  return [item];
}

function importNotes(el, ctx) {
  const sections = el.style?.sections || ['notes', 'terms'];
  const items = [];
  const extra = {};
  Object.keys(el.style || {}).forEach((k) => {
    if (k !== 'sections') extra[k] = el.style[k];
  });
  if (sections.includes('notes')) {
    const item = createContentItem('notes');
    Object.assign(item, importBaseFields(el));
    if (Object.keys(extra).length) item._extra = extra;
    items.push(item);
  }
  if (sections.includes('terms')) {
    const item = createContentItem('terms');
    Object.assign(item, importBaseFields(el));
    if (Object.keys(extra).length) item._extra = extra;
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
    item._hasLink = false;
    return [item];
  }
  const item = createContentItem('paymentMethods');
  Object.assign(item, importBaseFields(el));
  const extra = {};
  Object.keys(el.style || {}).forEach((k) => {
    if (k !== 'variant' && k !== 'label') extra[k] = el.style[k];
  });
  if (Object.keys(extra).length) item._extra = extra;
  return [item];
}

// One `qr_code` element (+ optionally a sibling `online_payment_link`) ->
// one `payOnline` editor item. Either may be absent.
function importPayOnline(qrEl, linkEl, ctx) {
  const item = createContentItem('payOnline');
  const present = [qrEl, linkEl].filter(Boolean);
  const originX = Math.min(...present.map((e) => e.x));
  const originY = Math.min(...present.map((e) => e.y));
  const maxX = Math.max(...present.map((e) => e.x + e.width));
  const maxY = Math.max(...present.map((e) => e.y + e.height));
  item.x = originX;
  item.y = originY;
  item.width = roundMm(maxX - originX);
  item.height = roundMm(maxY - originY);
  const origin = qrEl || linkEl;
  if (origin.rotation) item.rotation = origin.rotation;
  if (origin.locked) item.locked = true;
  if (origin.style?.sidebar) item.sidebar = true;
  // Only recorded when false — absence means "present" (the common
  // case), matching every other item's own catalog default and keeping
  // a from-scratch item free of these keys entirely (see this file's own
  // starter-template round-trip test).
  if (!qrEl) item._hasQr = false;
  if (!linkEl) item._hasLink = false;
  capturePartsFromEls(item, { qr: qrEl, link: linkEl }, originX, originY);
  if (linkEl) {
    const extra = {};
    Object.keys(linkEl.style || {}).forEach((k) => {
      if (k !== 'label' && k !== 'sidebar') extra[k] = linkEl.style[k];
    });
    if (Object.keys(extra).length) item._linkExtra = extra;
    if (linkEl.style?.label && linkEl.style.label !== 'Pay online') {
      ctx.warnings.push('payOnline: custom "Pay online" label text has no editor field and was dropped.');
    }
  }
  if (!qrEl) ctx.warnings.push('payOnline: no qr_code element found alongside online_payment_link — the editor will still show its own fixed QR pattern, but no imported geometry backs it.');
  return [item];
}

function importSignature(el, ctx) {
  const style = el.style || {};
  const partsStyle = style.parts;
  const hasRealParts = partsStyle && typeof partsStyle === 'object';

  // Part 6 (per-part signature geometry/style) — a real `style.parts`
  // dict means every part's own x/y/width/height/rotation/style is read
  // straight off the production data, no ratio-split inference at all.
  // Absent (every design that predates this field) falls all the way
  // back to the original signaturePartsFromBox ratio-split, completely
  // unchanged from before this feature existed.
  const geometry = hasRealParts
    ? null
    : signaturePartsFromBox(el.x, el.y, el.width, el.height);

  let image = null;
  let divider = null;
  let label = null;

  if (hasRealParts) {
    const imagePart = partsStyle.image;
    if (imagePart && typeof imagePart === 'object') {
      image = createContentItem('signatureImage');
      image.x = roundMm(el.x + (imagePart.dx || 0));
      image.y = roundMm(el.y + (imagePart.dy || 0));
      image.width = imagePart.width;
      image.height = imagePart.height;
      if (imagePart.rotation) image.rotation = imagePart.rotation;
      // Same leak class captureTextStyleOnto's own docstring documents —
      // `createContentItem` seeds a theme-linked `borderColor` default
      // for every item; delete it first so it can never survive into a
      // re-export as a border the source data never actually had.
      delete image.borderColor;
      const borderColor = colorFromProduction(imagePart.border_color);
      if (borderColor !== undefined) image.borderColor = borderColor;
      if (imagePart.border_width_mm) image.borderWidth = imagePart.border_width_mm;
      if (imagePart.border_radius_mm) image.cornerRadius = imagePart.border_radius_mm;
    }
    const dividerPart = partsStyle.divider;
    if (dividerPart && typeof dividerPart === 'object') {
      divider = createContentItem('signatureDivider');
      divider.x = roundMm(el.x + (dividerPart.dx || 0));
      divider.y = roundMm(el.y + (dividerPart.dy || 0));
      divider.width = dividerPart.width;
      divider.height = dividerPart.height;
      if (dividerPart.rotation) divider.rotation = dividerPart.rotation;
      const color = colorFromProduction(dividerPart.color);
      if (color !== undefined) divider.bgColor = color;
    }
    const labelPart = partsStyle.label;
    if (labelPart && typeof labelPart === 'object') {
      label = createContentItem('signatureLabel');
      label.x = roundMm(el.x + (labelPart.dx || 0));
      label.y = roundMm(el.y + (labelPart.dy || 0));
      label.width = labelPart.width;
      label.height = labelPart.height;
      if (labelPart.rotation) label.rotation = labelPart.rotation;
      // `align` falls back to the outer bundle's own `style.align` when a
      // part omits its own — matching the pre-existing top-level
      // behavior for any design that only ever set the OUTER key.
      // Real bug found while testing a non-default arrangement: `labelPart`
      // itself carries geometry keys (dx/dy/width/height/rotation)
      // alongside its style keys — passing it straight to
      // captureTextStyleOnto would sweep those geometry keys into
      // `label.extra` as "unmodeled style," and exportSignatureGroup's
      // own `textStyleFromPart` (which spreads `.extra` back in) would
      // then clobber the freshly (and correctly) computed dx/dy/width/
      // height with these STALE imported values on the very next export.
      // Only the real style keys are ever passed through.
      const { dx: _dx, dy: _dy, width: _w, height: _h, rotation: _r, ...labelStyleOnly } = labelPart;
      captureTextStyleOnto(label, { ...labelStyleOnly, align: labelPart.align ?? style.align }, ctx, 'signature.label');
    }
    // Unmodeled OUTER `el.style` keys (anything besides label/align/
    // has_signature_image/parts, which all have their own real handling
    // above) — the same passthrough-never-drop guarantee the legacy
    // branch below already gives, captured onto whichever part exists so
    // a re-export still merges it back in (exportSignatureGroup's own
    // `extraSource?._extra` read).
    const outerExtra = {};
    Object.keys(style).forEach((k) => {
      if (!['label', 'align', 'has_signature_image', 'parts'].includes(k)) outerExtra[k] = style[k];
    });
    if (Object.keys(outerExtra).length) {
      const extraTarget = label || divider || image;
      if (extraTarget) extraTarget._extra = outerExtra;
    }
  } else {
    image = createContentItem('signatureImage');
    Object.assign(image, geometry.image);
    // `createContentItem` seeds every item with a theme-LINKED
    // `borderColor` default (elementCatalog.defaultWholeItemStyle) for a
    // user building from scratch — this legacy (no `style.parts`) import
    // path has no real border data to back that default with (the
    // production element never carried a border at all before this
    // feature existed), so it must be deleted rather than silently kept
    // and later leaked into a re-export by exportSignatureGroup's own
    // real border_color read — the identical class of bug
    // captureTextStyleOnto's own docstring already documents and guards
    // against for text styling.
    delete image.borderColor;
    divider = createContentItem('signatureDivider');
    Object.assign(divider, geometry.divider);
    label = createContentItem('signatureLabel');
    Object.assign(label, geometry.label);
    // Same leak, for the label's own theme-linked `fontFamily`/
    // `textColor` defaults (elementCatalog.defaultWholeItemStyle/
    // defaultPartStyles — the 'text' variant gets both): no real font/
    // color data backs them in this legacy path either.
    delete label.fontFamily;
    delete label.textColor;
    delete label.borderColor;
    if (style.align) label.contentAlign = style.align;
    const extra = {};
    Object.keys(style).forEach((k) => {
      if (!['label', 'align', 'has_signature_image', 'parts'].includes(k)) extra[k] = style[k];
    });
    if (Object.keys(extra).length) label._extra = extra;
  }

  if (el.rotation) {
    if (image) image.rotation = image.rotation || el.rotation;
    if (divider) divider.rotation = divider.rotation || el.rotation;
    if (label) label.rotation = label.rotation || el.rotation;
  }
  if (el.locked) {
    if (image) image.locked = true;
    if (divider) divider.locked = true;
    if (label) label.locked = true;
  }
  // See exportSignatureGroup's own comment: Professional's real seed
  // never sets `has_signature_image` at all (only Minimal/Modern do) —
  // recorded here (on whichever part exists) so a re-export omits it too,
  // byte for byte, rather than always (re-)writing it.
  const flagTarget = label || divider || image;
  if (flagTarget && !('has_signature_image' in style)) flagTarget._hasSignatureImageKey = false;
  if (style.label && style.label !== 'Authorised signature') {
    ctx.warnings.push(`signature: custom label "${style.label}" has no editor field (signatureLabel's text is fixed) and was dropped.`);
  }
  if (style.has_signature_image === false) {
    ctx.warnings.push('signature: has_signature_image is explicitly false but a signatureImage editor item was still created (the editor has no way to represent "signature block present but image absent") — reconsider before re-saving if this matters.');
  }
  return [image, divider, label].filter(Boolean);
}

// Fix (Part 2, found while importing Professional/Modern's real new
// generic:rectangle elements — the first real production `rectangle`s
// ever round-tripped through this path, none of the 3 seeds having used
// this type before): `createShape` seeds a brand-new shape with
// sensible theme-LINKED defaults for a user building from scratch
// (shapeCatalog.js's own `fill`/`borderColor: { linked: 'primary' }`) —
// those defaults must never leak into an IMPORTED element's real style,
// exactly the same class of bug captureTextStyleOnto's own docstring
// already documents and guards against for text styling. A real
// production rectangle/ellipse/container with NO `border_color` key at
// all used to round-trip back OUT with a spurious
// `border_color: 'theme_primary'` it never had, because
// `colorToProduction({ linked: 'primary' })` is truthy regardless of
// whether the import step ever explicitly touched `borderColor`. Fixed
// by deleting both color fields first, then re-setting only when the
// source style actually carries the corresponding key — never "leave
// whatever createShape already put there".
function importShapeFillAndBorder(shape, el) {
  delete shape.fill;
  delete shape.borderColor;
  if (el.style?.background_color) shape.fill = colorFromProduction(el.style.background_color);
  if (el.style?.border_color) shape.borderColor = colorFromProduction(el.style.border_color);
  if (el.style?.border_width_mm) shape.borderWidth = el.style.border_width_mm;
}

function importGenericShape(el, ctx) {
  if (el.type === 'rectangle') {
    const shape = createShape('roundedRect', { x: el.x, y: el.y });
    Object.assign(shape, importBaseFields(el), { radius: el.style?.border_radius_mm || 0 });
    importShapeFillAndBorder(shape, el);
    return [shape];
  }
  if (el.type === 'ellipse') {
    const shape = createShape('ellipse', { x: el.x, y: el.y });
    Object.assign(shape, importBaseFields(el));
    importShapeFillAndBorder(shape, el);
    return [shape];
  }
  if (el.type === 'divider') {
    const thickness = el.style?.thickness_mm ?? 0.5;
    const shape = createShape('line', { x: el.x, y: el.y });
    Object.assign(shape, importBaseFields(el), { height: thickness, naturalHeight: thickness });
    delete shape.fill;
    if (el.style?.color) shape.fill = colorFromProduction(el.style.color);
    return [shape];
  }
  if (el.type === 'container') {
    const shape = createShape('container', { x: el.x, y: el.y });
    Object.assign(shape, importBaseFields(el), { radius: el.style?.border_radius_mm || 0 });
    importShapeFillAndBorder(shape, el);
    return [shape];
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
    cornerRadius: el.style?.border_radius_mm || 0,
    sourceWidth: el.width,
    sourceHeight: el.height,
  };
  if (el.style?.border_color) item.borderColor = colorFromProduction(el.style.border_color);
  if (el.style?.border_width_mm) item.borderWidth = el.style.border_width_mm;
  if (el.crop) item.crop = el.crop;
  return [item];
}

function importFooter(page, ctx) {
  const item = createContentItem('footer');
  // createContentItem seeds a brand-new footer with a theme-linked
  // fontFamily default (elementCatalog.js's defaultWholeItemStyle, 'footer'
  // is one of the 3 variants that gets one) — the same leak
  // captureTextStyleOnto's own docstring warns about for ordinary text
  // items, and importFooter used to miss it: a real production footer with
  // NO font_family key at all (e.g. `page.footer: {}`, the exact shape all
  // 3 real builtin seeds use, see design_templates.py's 09 September 2026
  // footer fix) was silently round-tripping back out as an explicit
  // `theme_body_font` sentinel instead of staying absent. Deleted first,
  // then re-set only when the source style actually carries a font key —
  // matching captureTextStyleOnto's own established convention exactly.
  delete item.fontFamily;
  delete item.fontWeight;
  const style = page.footer?.style || {};
  if (style.text_color) item.textColor = colorFromProduction(style.text_color);
  if (style.background_color && style.background_color !== 'transparent') item.bgColor = colorFromProduction(style.background_color);
  if (style.divider_color) item.dividerColor = colorFromProduction(style.divider_color);
  const font = fontFromProduction(style.font_family, style.font_weight);
  if (font.fontFamily !== undefined) item.fontFamily = font.fontFamily;
  if (font.fontWeight !== undefined) item.fontWeight = font.fontWeight;
  if (style.font_size_pt !== undefined) item.fontSize = style.font_size_pt;
  if (style.font_family && !font.matched) ctx.warnings.push(`footer: font "${style.font_family}" has no matching editor font catalog entry and was dropped.`);
  if (style.show_wordmark === false) ctx.warnings.push('page.footer.style.show_wordmark=false: the editor\'s footer always shows the wordmark (no hide toggle) — ignored.');
  return item;
}

const BOUND_TEXT_CATALOG_BY_BINDING = {
  'business.name': 'businessName',
  'invoice.number': 'invoiceNumber',
  'invoice.client_currency_conversion': 'currencyConversion',
};

const KNOWN_BINDING_VALUES = new Set(BINDING_OPTIONS.map((b) => b.value));

// A generic:text this file's own dedicated importers didn't already
// claim (not a date value/label, not a billTo/from line, not one of the
// 3 fixed BOUND_TEXT_CATALOG_BY_BINDING slots, not the "Invoice" eyebrow
// literal) -> a real `customText` item (Phase 3b), bound or unbound.
// This is the general escape hatch that replaces Phase 2b's narrow
// "only 2 recognized static literals, everything else dropped" rule —
// ANY static text and ANY binding (recognized by this editor's own
// bindings.js or not) now has a real home.
function importAsCustomText(el, ctx, seenCustomBindings) {
  if (el.binding && seenCustomBindings.has(el.binding)) {
    ctx.warnings.push(`generic:text bound to "${el.binding}": a customText item with this exact binding already exists (single-instance per binding) — a second occurrence was dropped.`);
    return [];
  }
  if (el.binding) seenCustomBindings.add(el.binding);
  if (el.binding && !KNOWN_BINDING_VALUES.has(el.binding)) {
    ctx.warnings.push(`generic:text bound to "${el.binding}": not one of this editor's own known bindings (bindings.js) — imported anyway (customText tolerates any binding string), shown with a generic placeholder.`);
  }
  const item = createGenericTextItem({
    x: el.x, y: el.y, width: el.width, height: el.height,
    rotation: el.rotation, binding: el.binding || null, text: el.style?.text ?? '',
    locked: el.locked, hidden: el.hidden,
  });
  captureTextStyleOnto(item, el.style, ctx, 'customText');
  return [item];
}

// ── Grouping: pull multi-element groups out of the combined element list ─

function extractByBinding(elements, binding) {
  const idx = elements.findIndex((e) => e.binding === binding);
  return idx === -1 ? null : elements.splice(idx, 1)[0];
}

function extractUnboundLiteral(elements, text) {
  const idx = elements.findIndex((e) => e.kind === 'generic' && e.type === 'text' && !e.binding && e.style?.text === text);
  return idx === -1 ? null : elements.splice(idx, 1)[0];
}

// billTo/from: found by locating the fixed title literal, then claiming
// whichever of that block's own known bindings sit in the SAME x-column
// as the title (within a small tolerance) and below it — this is what
// correctly disambiguates "From"'s own business.name line from the
// wholly separate standalone masthead business.name element elsewhere
// in the header (both real, both present in Professional/Minimal — see
// this file's own module docstring).
function extractBlockGroup(elements, blockType) {
  const titleText = BLOCK_TITLE_TEXT[blockType];
  const title = extractUnboundLiteral(elements, titleText);
  const lineEls = {};
  const bindingByKey = BLOCK_LINE_BINDING[blockType];
  Object.entries(bindingByKey).forEach(([key, binding]) => {
    const candidates = elements
      .map((e, i) => ({ e, i }))
      .filter(({ e }) => e.binding === binding);
    if (!candidates.length) return;
    let chosen = candidates[0];
    if (title && candidates.length > 1) {
      chosen = candidates.reduce((best, cur) =>
        Math.abs(cur.e.x - title.x) < Math.abs(best.e.x - title.x) ? cur : best
      );
    } else if (title) {
      chosen = candidates[0];
    }
    lineEls[key] = elements.splice(chosen.i, 1)[0];
  });
  if (!title && !Object.keys(lineEls).length) return null;
  return { title, lineEls };
}

export function designDataToTemplate(designData) {
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
  const seenCustomBindings = new Set();

  const margins = marginsOfProductionPage(designData.page);
  let nextOrigIndex = 0;
  const shiftedEl = (el) => {
    // `page_pinned` (Part 2) shares `sidebar`'s own page-absolute
    // coordinate space — see shiftToProduction's identical treatment.
    const shifted = shiftToEditor(el.x, el.y, margins, !!(el.style?.sidebar || el.style?.page_pinned));
    // `_origIndex` — this element's position in the COMBINED header-then-
    // flow sequence, stamped once here before any group extraction
    // reorders the working `pool` array. Used purely to restore the
    // real, meaningful WITHIN-region z-order (array position IS paint
    // order — see CanvasLayer.jsx) once the group-extraction passes
    // below are done: extracting billTo/from/dates/pay-online out of
    // sequence (so real per-line style/geometry can be captured
    // correctly — see extractBlockGroup's own comment on the ambiguous
    // "business.name appears twice" case) would otherwise scramble the
    // reconstructed template's item order, and therefore the RE-EXPORTED
    // element order, relative to the original source. See this file's
    // own module docstring + the Phase 3c report's cross-list z-order
    // section for why this fixes WITHIN-region order but cannot fix
    // CROSS-region (header-vs-flow) stacking — that is a separate,
    // structural limitation of the renderer's own two-sibling-container
    // HTML (apps/invoices/templates/invoices/canonical/canonical.html:
    // `.v2-header` and its flow rows are two non-overlapping siblings in
    // normal document flow, not one shared stacking context), verified
    // directly, not assumed, and out of an adapter-only phase's scope to
    // restructure.
    return { ...el, x: shifted.x, y: shifted.y, _origIndex: nextOrigIndex++ };
  };

  // One combined, mutable working list — header vs. flow membership only
  // ever mattered for EXPORT placement (HEADER_CATALOG_TYPES); import
  // produces one flat editor item list regardless of which production
  // list an element came from, and every group-extraction helper below
  // is written to work over a single list so a hand-authored design that
  // (validly, per design_schema.HEADER_TYPES/FLOW_TYPES) puts a generic
  // element in the "wrong" list still imports correctly.
  const pool = [...(designData.header?.elements || []), ...(designData.flow?.elements || [])].map(shiftedEl);

  // { sortKey, item } pairs — sorted back into original order at the end
  // (see `_origIndex` above) rather than appended in extraction order.
  const ordered = [];
  const pushOrdered = (sortKey, newItems) => newItems.forEach((item) => ordered.push({ sortKey, item }));
  const minOrigIndex = (...els) => Math.min(...els.filter(Boolean).map((e) => e._origIndex));

  // 1. Multi-element groups first, so their consumed elements can never
  //    be misread as a standalone item afterward (see extractBlockGroup's
  //    own comment on the ambiguous "business.name appears twice" case).
  const billTo = extractBlockGroup(pool, 'billTo');
  if (billTo) {
    const els = [billTo.title, ...Object.values(billTo.lineEls)];
    pushOrdered(minOrigIndex(...els), importBlockGroup('billTo', billTo.title, billTo.lineEls, ctx));
  }

  const from = extractBlockGroup(pool, 'from');
  if (from) {
    const els = [from.title, ...Object.values(from.lineEls)];
    pushOrdered(minOrigIndex(...els), importBlockGroup('from', from.title, from.lineEls, ctx));
  }

  const issueLabel = extractUnboundLiteral(pool, 'Issue date');
  const issueValue = extractByBinding(pool, 'invoice.issue_date');
  if (issueLabel || issueValue) pushOrdered(minOrigIndex(issueLabel, issueValue), importDatePair('issueDate', issueLabel, issueValue, ctx));

  const dueLabel = extractUnboundLiteral(pool, 'Due date');
  const dueValue = extractByBinding(pool, 'invoice.due_date');
  if (dueLabel || dueValue) pushOrdered(minOrigIndex(dueLabel, dueValue), importDatePair('dueDate', dueLabel, dueValue, ctx));

  const qrEl = (() => {
    const idx = pool.findIndex((e) => e.kind === 'semantic' && e.type === 'qr_code');
    return idx === -1 ? null : pool.splice(idx, 1)[0];
  })();
  const linkEl = (() => {
    const idx = pool.findIndex((e) => e.kind === 'semantic' && e.type === 'online_payment_link');
    return idx === -1 ? null : pool.splice(idx, 1)[0];
  })();
  if (qrEl || linkEl) pushOrdered(minOrigIndex(qrEl, linkEl), importPayOnline(qrEl, linkEl, ctx));

  const invoiceEyebrow = extractUnboundLiteral(pool, 'Invoice');
  if (invoiceEyebrow) pushOrdered(invoiceEyebrow._origIndex, importEyebrowText('invoice', invoiceEyebrow, ctx));

  // 2. Everything else, one production element -> zero or more items.
  pool.forEach((el) => {
    if (el.kind === 'semantic') {
      switch (el.type) {
        case 'logo': pushOrdered(el._origIndex, importLogo(el, ctx)); return;
        case 'client_info':
          pushOrdered(el._origIndex, importLegacyClientInfo(el, ctx));
          return;
        case 'business_info':
          pushOrdered(el._origIndex, importLegacyBusinessInfo(el, ctx));
          return;
        case 'totals': pushOrdered(el._origIndex, importTotalsRow(el, ctx)); return;
        case 'notes': pushOrdered(el._origIndex, importNotes(el, ctx)); return;
        case 'payment_info': pushOrdered(el._origIndex, importPaymentInfo(el, ctx)); return;
        case 'signature': pushOrdered(el._origIndex, importSignature(el, ctx)); return;
        case 'dates':
          ctx.warnings.push('dates (bundled, legacy): no single editor catalog type represents this atomic bundle (the editor keeps invoiceNumber/issueDate/dueDate as independent items) — dropped.');
          return;
        default:
          ctx.warnings.push(`semantic:${el.type}: unrecognized — dropped.`);
          return;
      }
    }
    if (el.kind === 'structural' && el.type === 'table') { pushOrdered(el._origIndex, importTable(el, ctx)); return; }
    if (el.kind === 'generic') {
      if (el.type === 'text') {
        if (el.binding && BOUND_TEXT_CATALOG_BY_BINDING[el.binding]) {
          pushOrdered(el._origIndex, importBoundTextAs(BOUND_TEXT_CATALOG_BY_BINDING[el.binding], el, ctx));
          return;
        }
        pushOrdered(el._origIndex, importAsCustomText(el, ctx, seenCustomBindings));
        return;
      }
      if (el.type === 'image') { pushOrdered(el._origIndex, importImage(el, ctx)); return; }
      pushOrdered(el._origIndex, importGenericShape(el, ctx));
      return;
    }
    ctx.warnings.push(`${el.kind}:${el.type}: unrecognized element kind/type combination — dropped.`);
  });

  ordered.sort((a, b) => a.sortKey - b.sortKey);
  let items = ordered.map((o) => o.item);

  if (designData.page?.footer) {
    items.push(importFooter(designData.page, ctx));
  }

  // Part 2 — a real shape element (Professional's spine bar/accent line,
  // Modern's sidebar background rectangle, or any hand-authored design's
  // own decorative shape) is only guaranteed to reconstruct in its
  // authored `_origIndex` position, which has no relationship to the
  // editor's own "a shape never renders above content" invariant
  // (utils/zorder.js's isConstrainedShape) — that invariant is otherwise
  // enforced only on an EXPLICIT reorder action (LayersPanel drag,
  // front/back stepping; see EditorContext.jsx), never automatically on
  // load. Without this, a freshly imported design with a shape anywhere
  // but the very front of its own list would visibly paint over real
  // content the instant it's opened, until the user happened to trigger
  // any reorder. Safe for exact round-trip: normalizeZOrder only moves
  // shapes AS A GROUP to the front, preserving both groups' own relative
  // order — and every real BUILTIN_DESIGNS seed's own shape elements are
  // already authored at the front of their containing list for exactly
  // this reason (see design_templates.py's own comments on this).
  items = normalizeZOrder(items);

  const page = {
    width: designData.page?.width_mm,
    height: designData.page?.height_mm,
    backgroundColor: designData.page?.background_color ?? '#ffffff',
    _backgroundColorExplicit: designData.page?.background_color !== undefined,
  };
  ['margin_top_mm', 'margin_right_mm', 'margin_bottom_mm', 'margin_left_mm'].forEach((prodKey, i) => {
    const key = ['marginTopMm', 'marginRightMm', 'marginBottomMm', 'marginLeftMm'][i];
    if (designData.page?.[prodKey] !== undefined) page[key] = designData.page[prodKey];
  });
  if (designData.page?.sidebar) page.sidebar = designData.page.sidebar;
  if (designData.page?.spine) page.spine = designData.page.spine;

  const template = {
    items,
    page,
    theme: DEFAULT_THEME,
  };

  return { template, warnings };
}

// ── Legacy (pre-Phase-4B) semantic bundle import ────────────────────────
// `client_info`/`business_info` (the old bundled masthead/bill-to types)
// are RETIRED from every real export path (Phase 4B decomposed both into
// generic:text) but are still valid schema types (HEADER_SEMANTIC_TYPES
// still lists them) — a pre-existing saved design from before that
// decomposition may still carry one. Imported as a real billTo/from
// group (best-effort — no per-line style survives, since the bundle
// never had one), never silently dropped, so opening an old design in
// the editor still shows something editable; RE-EXPORTING it produces
// the new decomposed generic form, matching this file's own explicit
// import/export asymmetry (see module docstring: only import preserves
// support for retired shapes, export always standardizes on the current
// real shape).
function importLegacyClientInfo(el, ctx) {
  ctx.warnings.push('client_info (legacy bundle): imported as a real billTo group with default per-line styling — this bundle has no per-line style/geometry of its own to preserve. Re-saving will export the current decomposed generic form.');
  const item = createContentItem('billTo');
  Object.assign(item, importBaseFields(el));
  if (el.style?.label && el.style.label !== 'Bill to') {
    ctx.warnings.push(`client_info: custom label "${el.style.label}" has no editor field and was dropped.`);
  }
  return [item];
}

function importLegacyBusinessInfo(el, ctx) {
  if (el.style?.variant === 'sender_repeat') {
    ctx.warnings.push('business_info (legacy sender_repeat bundle): imported as a real "from" group with default per-line styling. Re-saving will export the current decomposed generic form.');
    const item = createContentItem('from');
    Object.assign(item, importBaseFields(el));
    if (el.style?.label && el.style.label !== 'From') {
      ctx.warnings.push(`business_info: custom label "${el.style.label}" has no editor field and was dropped.`);
    }
    return [item];
  }
  ctx.warnings.push('business_info (legacy masthead variant): no editor catalog type represents the bundled masthead business_info element (the editor decomposes this into separate "invoice"/"businessName" items instead) — dropped.');
  return [];
}
