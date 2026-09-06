import { ELEMENT_TYPES, createContentItem } from './elementCatalog';
import { DEFAULT_THEME } from '../utils/theme';

// Minimum distance a content item is ever allowed from a page edge (move or
// resize) — shapes ignore this and can still sit flush at the true edge
// (a decorative bar/divider along a page edge is a legitimate design
// choice on its own merits, independent of any padding rule). Easy to tune.
export const PAGE_PADDING = 24;

// Build the starting item list: every content type with defaultOn:true gets
// one instance, in catalog order. Shapes start empty — the user adds those
// deliberately from the shape library.
function buildInitialItems() {
  return Object.keys(ELEMENT_TYPES)
    .filter((type) => ELEMENT_TYPES[type].defaultOn)
    .map((type) => createContentItem(type));
}

export const initialTemplateState = {
  // One flat list of canvas items — shapes and content elements alike,
  // each `{ id, kind: 'content' | 'shape', type, x, y, width, height,
  // rotation, naturalWidth, naturalHeight, ...style }`. Paint/stacking
  // order IS array order (index 0 = back, last = front) — a single pass,
  // see CanvasLayer.jsx — with the shape-behind-content guarantee kept by
  // utils/zorder.js's normalizeZOrder rather than by two hardcoded render
  // groups.
  items: buildInitialItems(),
  // ~A4 at 96dpi, used for the boundary clamp. backgroundColor is a
  // per-template value (not the global --page-bg token) so different
  // templates can have different page colors; this default matches the
  // token's current cream tone so existing templates don't visually change.
  page: { width: 794, height: 1123, backgroundColor: '#FAF9F6' },
  // Prompt 28: template-level theme — primary/secondary colors + a
  // heading/body font pairing that per-item style fields can link to
  // instead of holding a literal value (see utils/theme.js). Both fonts
  // start identical to the app's actual pre-existing default (DM Sans,
  // weight 400 — what every item already rendered at when fontFamily/
  // fontWeight were simply unset), and the two colors match the
  // hardcoded fallback tones already used across the app today, so
  // introducing this changes nothing visually until the theme panel is
  // actually touched.
  theme: DEFAULT_THEME,
};
