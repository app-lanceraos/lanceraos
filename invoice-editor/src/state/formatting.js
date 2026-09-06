import { ELEMENT_TYPES } from '../data/elementCatalog';

const KEY = 'invoice-editor:format-clipboard';

// The "format painter" (Prompt 15) — a second, separate clipboard from
// clipboard.js's whole-item copy/paste, holding STYLE only: nothing about
// position, size, rotation, or the item's fixed baked-in content ever
// enters this. Field names are shared across every place a style value
// can live (a content item's own top-level fields, a shape's fields, or a
// sub-part's own style object like item.title/item.label) — copying is
// just "read whichever of these are present", pasting is "read whichever
// of these the TARGET can actually use", so the two naturally compose
// without needing to know which specific pairing is involved.
const TEXT_STYLE_KEYS = ['textColor', 'bgColor', 'borderColor', 'borderWidth', 'fontFamily', 'fontWeight', 'fontSize', 'contentAlign'];
const WHOLE_ITEM_ONLY_KEYS = ['cornerRadius', 'contentAlignY'];
const SHAPE_KEYS = ['fill', 'borderColor', 'borderWidth', 'radius'];
// Prompt 27: `image` styles its frame like a content item (bgColor/
// borderColor/borderWidth/cornerRadius — see CanvasItem's frameStyle),
// but has none of a content item's text/alignment fields — a dedicated
// key list rather than falling through the generic content-item path
// keeps copy/paste formatting from writing dead textColor/font/
// contentAlign fields onto it that its own rendering never reads.
const IMAGE_KEYS = ['bgColor', 'borderColor', 'borderWidth', 'cornerRadius'];
const TABLE_KEYS = ['headerBg', 'headerTextColor', 'headerFontWeight', 'headerFontSize', 'rowBorderColor', 'rowBorderWidth', 'altRowShading', 'altRowColor', 'cellPadding', 'columnAlign'];
const FOOTER_KEYS = ['dividerColor'];

// Variants whose text lives entirely in sub-parts (see item[part] in
// CanvasItem.jsx) — a whole-item copy skips font/align fields for these,
// since item.fontFamily etc. at the top level has no effect on them.
const SUB_PART_VARIANTS = new Set(['block', 'qr', 'label-value']);
const ALIGNABLE_VARIANTS = new Set(['text', 'note', 'block', 'label-value']);

export function copyFormatting(style) {
  try {
    localStorage.setItem(KEY, JSON.stringify(style));
  } catch (e) {
    console.warn('Format clipboard persist failed', e);
  }
}

export function readFormatting() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// What to actually read off the SOURCE. `part`, when given, captures that
// sub-part's own style object instead of the whole item's — a part's
// style object always has the same shape (TEXT_STYLE_KEYS) regardless of
// which specific part key it is, so copying "From"'s title formatting
// onto "Bill To"'s title (or any other block's title/line) works the same
// way copying one whole item's formatting onto another does.
export function captureFormatting(item, part) {
  const style = {};
  if (part) {
    const s = item[part] || {};
    TEXT_STYLE_KEYS.forEach((k) => { if (s[k] !== undefined) style[k] = s[k]; });
    return style;
  }
  if (item.kind === 'shape') {
    SHAPE_KEYS.forEach((k) => { if (item[k] !== undefined) style[k] = item[k]; });
    return style;
  }
  if (item.kind === 'image') {
    IMAGE_KEYS.forEach((k) => { if (item[k] !== undefined) style[k] = item[k]; });
    return style;
  }
  const def = ELEMENT_TYPES[item.type];
  const keys = [...TEXT_STYLE_KEYS, ...WHOLE_ITEM_ONLY_KEYS];
  if (def?.variant === 'table') keys.push(...TABLE_KEYS);
  if (def?.variant === 'footer') keys.push(...FOOTER_KEYS);
  keys.forEach((k) => { if (item[k] !== undefined) style[k] = item[k]; });
  return style;
}

// Which of TEXT_STYLE_KEYS/WHOLE_ITEM_ONLY_KEYS/etc. the TARGET can
// actually use — pasting formatting from a text item onto a shape, say,
// should only apply what's applicable (fill/border) and just quietly
// leave out the rest (font, text align) rather than writing dead fields
// the target's own rendering never reads.
function applicableKeys(target, part) {
  if (part) return new Set(TEXT_STYLE_KEYS);
  if (target.kind === 'shape') {
    return new Set(target.type === 'roundedRect' ? SHAPE_KEYS : SHAPE_KEYS.filter((k) => k !== 'radius'));
  }
  if (target.kind === 'image') {
    return new Set(IMAGE_KEYS);
  }
  const def = ELEMENT_TYPES[target.type];
  const variant = def?.variant;
  const keys = ['textColor', 'bgColor', 'borderColor', 'borderWidth', 'cornerRadius', 'contentAlignY'];
  const hasWholeItemText = variant && !SUB_PART_VARIANTS.has(variant) && variant !== 'divider' && variant !== 'image';
  if (hasWholeItemText) keys.push('fontFamily', 'fontWeight', 'fontSize');
  if (variant && ALIGNABLE_VARIANTS.has(variant)) keys.push('contentAlign');
  if (variant === 'table') keys.push(...TABLE_KEYS);
  if (variant === 'footer') keys.push(...FOOTER_KEYS);
  return new Set(keys);
}

// The actual patch to apply to `target` (or `target[part]`) — every
// captured field the target can use, nothing it can't.
export function formattingPatch(capturedStyle, target, part) {
  const applicable = applicableKeys(target, part);
  const patch = {};
  Object.entries(capturedStyle).forEach(([k, v]) => {
    if (applicable.has(k)) patch[k] = v;
  });
  return patch;
}
