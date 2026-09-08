import { ELEMENT_TYPES, createContentItem } from './elementCatalog';
import { DEFAULT_THEME } from '../utils/theme';

// Minimum distance a content item is ever allowed from a page edge (move or
// resize) — shapes ignore this and can still sit flush at the true edge
// (a decorative bar/divider along a page edge is a legitimate design
// choice on its own merits, independent of any padding rule). Easy to tune.
//
// Phase 2a: was 24px (~6.35mm at the CSS 96/25.4 mm<->px ratio). Retuned
// to a clean 6mm rather than the raw conversion — a deliberate print
// margin value (roughly what "a comfortable invoice margin" means in mm,
// the unit a real print/PDF margin is actually specified in), not a
// mechanically-rounded px artifact. Close enough to the original 6.35mm
// that the existing default layout (elementCatalog.js's defaultBoxes,
// converted the same pass) still clears it with the same margin it
// always had.
export const PAGE_PADDING = 6;

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
  // Phase 2a: genuine A4 in mm (210 x 297) — the old 794 x 1123 was
  // already just a px-at-96dpi APPROXIMATION of A4 (793.7 x 1122.5), used
  // only because px was the editor's sole unit; production's own
  // design_data page.width_mm/height_mm is the real thing this now
  // matches exactly. backgroundColor is a per-template value (not the
  // global --page-bg token) so different templates can have different
  // page colors; this default matches the token's current cream tone so
  // existing templates don't visually change.
  page: { width: 210, height: 297, backgroundColor: '#FAF9F6' },
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
