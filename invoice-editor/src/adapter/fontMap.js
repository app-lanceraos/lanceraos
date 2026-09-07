// Phase 2b — font-id (editor, src/data/fonts.js) <-> font-family string
// (production, style.font / page.footer.style.font_family — a plain,
// unconstrained CSS font-family string, no id/catalog concept on that
// side at all). Editor font ids and the exact family label strings
// FONT_FAMILIES already stores line up 1:1 by construction (fontFamilyById
// returns the same catalog entries this map is built from), so this is
// generated FROM that catalog, not a second, independently-typed list
// that could drift from it.
import { FONT_FAMILIES } from '../data/fonts';

// id -> production family string (e.g. 'ibm-plex-mono' -> 'IBM Plex Mono')
export const FONT_ID_TO_PRODUCTION_NAME = Object.fromEntries(
  FONT_FAMILIES.map((f) => [f.id, f.label])
);

// production family string -> id, case-insensitive (a hand-authored
// design_data's `style.font` is a free string; matching case-insensitively
// is a small, deliberate leniency, not a schema requirement — production
// itself never lowercases/normalizes this value).
const PRODUCTION_NAME_TO_FONT_ID = Object.fromEntries(
  FONT_FAMILIES.map((f) => [f.label.toLowerCase(), f.id])
);

export function fontIdToProductionName(id) {
  return FONT_ID_TO_PRODUCTION_NAME[id];
}

// Returns { id, matched } — `matched: false` means the production font
// name has no editor catalog entry (e.g. "Space Grotesk", used by the
// real Modern seed's masthead — confirmed absent from FONT_FAMILIES) and
// `id` falls back to undefined, letting the caller decide whether to
// silently drop it (fontFamilyById's own fallback to FONT_FAMILIES[0]/
// 'DM Sans' would otherwise happen invisibly) or record it as a reported
// import gap. This function itself never guesses.
export function productionNameToFontId(name) {
  if (!name) return { id: undefined, matched: false };
  const id = PRODUCTION_NAME_TO_FONT_ID[name.toLowerCase()];
  return { id, matched: !!id };
}
