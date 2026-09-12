import { ELEMENT_TYPES } from '../data/elementCatalog';
import { SHAPE_TYPES } from '../data/shapeCatalog';
import { rotatedBoundingBox, getItemBounds, getFooterTop, isImagePixelated, EDGE_CONTACT_EPSILON_MM } from './geometry';
import { resolveItemTheme } from './theme';

// A manually-set width/height is a MINIMUM for text (Prompt 14) — the
// measured `effectiveSizes` entry (when the canvas has actually rendered
// and measured this item) is what's really on screen, so every geometric
// check below reads that instead of the item's own possibly-stale stored
// box, same source collision-during-gesture already reads from (see
// CanvasItem.jsx's `withEffectiveSize`).
function withEffectiveSize(item, effectiveSizes) {
  const eff = effectiveSizes[item.id];
  return eff ? { ...item, width: eff.width, height: eff.height } : item;
}

function itemLabel(item) {
  if (item.kind === 'shape') return SHAPE_TYPES[item.type]?.label || item.type;
  if (item.kind === 'image') return 'Image';
  return ELEMENT_TYPES[item.type]?.label || item.type;
}

// ---------- Pairwise overlap (error) ----------
//
// Enforced live during gestures (CanvasItem.jsx's resolveMoveCollision/
// resolveResizeCollision, via geometry.js) but never verified at save — a
// template can reach an overlapping state through paths that bypass
// gesture clamping (a numeric width/height typed directly into the
// properties panel, a theme change altering measured text size, undo/redo
// landing on a stale arrangement, external data loaded by a future
// adapter). Shapes and images are collision-exempt by design, same as
// during a live gesture — only content items are checked against each
// other. Reuses the same rotated-bounding-box math the live gesture uses
// (`rotatedBoundingBox`) rather than a second axis-aligned approximation —
// but NOT the live gesture's own breathing-room margin (see this
// function's own real-backend-integration-fix comment below for why).
function checkOverlaps(template, effectiveSizes, issues) {
  const contentItems = template.items
    .filter((i) => i.kind === 'content' && !i.hidden)
    .map((i) => withEffectiveSize(i, effectiveSizes));

  // Real-backend-integration fix: this used to expand every box by
  // +COLLISION_MARGIN (the same small buffer a LIVE DRAG gesture keeps as
  // breathing room so two items don't visually glue together) before
  // testing intersection — correct for a drag-in-progress, but wrong here.
  // Every real production seed (design_templates.py's BUILTIN_DESIGNS)
  // places its totals rows (subtotal/tax/discount/total due) flush,
  // zero-gap, by design — a real, first-real-backend-integration-test
  // finding: importing ANY of them and calling this unmodified reliably
  // flagged every adjacent flush pair as "overlapping" and blocked Save
  // outright, even with zero edits and zero measurement drift (verified
  // directly with effectiveSizes={}, ruling out text-measurement as the
  // cause). This is the SAME "touching is fine, only genuine intersection
  // isn't" tolerance checkBounds already applies at its own page-edge
  // boundary via EDGE_CONTACT_EPSILON_MM — applied here as a shrink
  // instead of a grow, so two items that are merely flush/touching no
  // longer register as overlapping, while two that genuinely intersect
  // still do.
  const expanded = contentItems.map((item) => {
    const b = rotatedBoundingBox(item);
    return {
      minX: b.minX + EDGE_CONTACT_EPSILON_MM,
      maxX: b.maxX - EDGE_CONTACT_EPSILON_MM,
      minY: b.minY + EDGE_CONTACT_EPSILON_MM,
      maxY: b.maxY - EDGE_CONTACT_EPSILON_MM,
    };
  });

  for (let a = 0; a < contentItems.length; a++) {
    for (let b = a + 1; b < contentItems.length; b++) {
      const boxA = expanded[a];
      const boxB = expanded[b];
      const overlaps = boxA.minX < boxB.maxX && boxA.maxX > boxB.minX && boxA.minY < boxB.maxY && boxA.maxY > boxB.minY;
      if (overlaps) {
        issues.push({
          level: 'error',
          message: `"${itemLabel(contentItems[a])}" and "${itemLabel(contentItems[b])}" overlap.`,
        });
      }
    }
  }
}

// ---------- Page bounds (error) ----------
//
// Reuses getItemBounds' own content-vs-shape padding distinction rather
// than re-deriving it. The footer is excluded: it's fixed page chrome
// (locked, never moved by the user) whose own `y` is what DEFINES the
// footer-top boundary every OTHER item is measured against (see
// getFooterTop) — testing it against a boundary it itself produces would
// always "fail" by construction, and the live app never subjects it to
// this test either (beginMove/beginResize both short-circuit on
// item.locked before ever calling getItemBounds for it).
function checkBounds(template, effectiveSizes, issues) {
  const footerTop = getFooterTop(template.items, template.page);
  template.items
    .filter((i) => !i.hidden && i.type !== 'footer')
    .forEach((item) => {
      const sized = withEffectiveSize(item, effectiveSizes);
      const bounds = getItemBounds(sized, template.page, footerTop);
      const bbox = rotatedBoundingBox(sized);
      const outside =
        bbox.minX < bounds.minX - EDGE_CONTACT_EPSILON_MM ||
        bbox.maxX > bounds.maxX + EDGE_CONTACT_EPSILON_MM ||
        bbox.minY < bounds.minY - EDGE_CONTACT_EPSILON_MM ||
        bbox.maxY > bounds.maxY + EDGE_CONTACT_EPSILON_MM;
      if (outside) {
        issues.push({ level: 'error', message: `"${itemLabel(sized)}" is positioned outside the page's allowed area.` });
      }
    });
}

// ---------- Text contrast (warning, never blocking) ----------
//
// WCAG 2.x relative-luminance contrast ratio between a text run's
// resolved color and its effective background. Colors here are always
// plain #rrggbb/#rgb strings (every color control in this app is a native
// <input type="color">, and template.theme's own defaults are hex too) —
// an unparseable value (nothing recognized, e.g. left genuinely blank
// with no fallback available) is treated as "can't judge" rather than a
// false warning.
function hexToRgb(hex) {
  if (typeof hex !== 'string') return null;
  const m = hex.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const num = parseInt(h, 16);
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

function channelLuminance(c) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function relativeLuminance({ r, g, b }) {
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

function contrastRatio(fg, bg) {
  const fgRgb = hexToRgb(fg);
  const bgRgb = hexToRgb(bg);
  if (!fgRgb || !bgRgb) return null;
  const l1 = relativeLuminance(fgRgb);
  const l2 = relativeLuminance(bgRgb);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

const MIN_CONTRAST = 4.5;

// The same hardcoded per-part fallback colors CanvasItem.jsx's ContentBody
// actually paints with once a part has no color of its own AND no theme
// link resolves one (partInlineStyle's own fallbackColor arguments, and
// the footer case's `item.textColor || '#a09a89'`) — kept in sync with
// that file so this judges exactly what would render, not an approximation.
const DEFAULT_TEXT_COLOR = '#262420'; // CSS --page-text / DEFAULT_THEME.primaryColor
const BLOCK_TITLE_FALLBACK = '#a2896b';
const BLOCK_LINE_FALLBACK = '#55524a';
const FOOTER_TEXT_FALLBACK = '#a09a89';

function pushContrastWarning(issues, label, textColor, bgColor) {
  const ratio = contrastRatio(textColor, bgColor);
  if (ratio !== null && ratio < MIN_CONTRAST) {
    issues.push({
      level: 'warning',
      message: `${label} text may be hard to read against its background (contrast ${ratio.toFixed(2)}:1, recommended ${MIN_CONTRAST}:1).`,
    });
  }
}

// Resolution order, matching CanvasItem.jsx's own reads exactly: a
// sub-part's own literal color (resolveItemTheme leaves a literal
// untouched) beats the item's/part's theme link (resolveItemTheme
// resolves this to the theme's current value), which beats the
// hardcoded default a real render falls back to when neither is set.
function checkContrast(item, def, theme, pageBackground, issues) {
  const current = resolveItemTheme(item, theme);
  const bg = current.bgColor || pageBackground;
  const label = def.label;

  switch (def.variant) {
    case 'text':
    case 'note':
      pushContrastWarning(issues, label, current.textColor || DEFAULT_TEXT_COLOR, bg);
      break;
    case 'label-value': {
      const labelPart = current.label || {};
      const valuePart = current.value || {};
      pushContrastWarning(issues, `${label} (label)`, labelPart.textColor || DEFAULT_TEXT_COLOR, bg);
      pushContrastWarning(issues, `${label} (value)`, valuePart.textColor || DEFAULT_TEXT_COLOR, bg);
      break;
    }
    case 'block': {
      const titlePart = current.title || {};
      pushContrastWarning(issues, `${label} (title)`, titlePart.textColor || BLOCK_TITLE_FALLBACK, bg);
      const hidden = item.hiddenLines || [];
      def
        .render()
        .lines.filter((line) => !hidden.includes(line.key))
        .forEach((line) => {
          const linePart = current[line.key] || {};
          pushContrastWarning(issues, `${label} (${line.label})`, linePart.textColor || BLOCK_LINE_FALLBACK, bg);
        });
      break;
    }
    case 'qr': {
      const titlePart = current.title || {};
      pushContrastWarning(issues, `${label} (title)`, titlePart.textColor || BLOCK_TITLE_FALLBACK, bg);
      break;
    }
    case 'footer':
      pushContrastWarning(issues, label, current.textColor || FOOTER_TEXT_FALLBACK, bg);
      break;
    case 'table': {
      const headerBg = current.headerBg || bg;
      pushContrastWarning(issues, `${label} (header)`, current.headerTextColor || DEFAULT_TEXT_COLOR, headerBg);
      const rowBg = current.altRowShading ? current.altRowColor || bg : bg;
      pushContrastWarning(issues, `${label} (rows)`, current.textColor || DEFAULT_TEXT_COLOR, rowBg);
      break;
    }
    default:
      break;
  }
}

// ---------- Image resolution (warning) ----------
//
// The live per-item pixelation badge (isImagePixelated, geometry.js) is
// transient and only ever visible while that one item happens to be on
// screen at its current size — surfaced here too so it's caught at save
// time regardless of whether anyone happened to notice the badge.
function checkImageResolution(template, effectiveSizes, issues) {
  template.items
    .filter((i) => i.kind === 'image' && !i.hidden)
    .forEach((item) => {
      const sized = withEffectiveSize(item, effectiveSizes);
      if (isImagePixelated(sized, sized.width, sized.height)) {
        issues.push({ level: 'warning', message: 'An image is stretched beyond its real resolution and may look pixelated.' });
      }
    });
}

export function validateTemplate(template, effectiveSizes = {}) {
  const issues = [];

  // 1. every required element must have at least one instance on the canvas
  Object.entries(ELEMENT_TYPES).forEach(([type, def]) => {
    if (!def.required) return;
    const present = template.items.some((i) => i.kind === 'content' && i.type === type);
    if (!present) issues.push({ level: 'error', message: `Required element "${def.label}" is missing.` });
  });

  // 2. optional block enabled but structurally empty — genuinely reachable
  //    now that individual optional lines can be deleted per-item (see
  //    item.hiddenLines), not just theoretical placeholder-content guarding.
  const paymentItem = template.items.find((i) => i.kind === 'content' && i.type === 'paymentMethods');
  if (paymentItem) {
    const hidden = paymentItem.hiddenLines || [];
    const visibleCount = ELEMENT_TYPES.paymentMethods.render().lines.filter((l) => !hidden.includes(l.key)).length;
    if (visibleCount === 0) {
      issues.push({ level: 'warning', message: 'Payment methods block is enabled but has no methods.' });
    }
  }

  // 3. no two content items may overlap
  checkOverlaps(template, effectiveSizes, issues);

  // 4. every item must sit within its own kind's allowed page bounds
  checkBounds(template, effectiveSizes, issues);

  // 5. text contrast against its effective background
  template.items
    .filter((i) => i.kind === 'content' && !i.hidden)
    .forEach((item) => {
      const def = ELEMENT_TYPES[item.type];
      if (def) checkContrast(item, def, template.theme, template.page.backgroundColor, issues);
    });

  // 6. an image stretched well past its real resolution
  checkImageResolution(template, effectiveSizes, issues);

  return issues;
}
