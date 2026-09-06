// Curated font choices for invoice content — a small, professional set (the
// existing project fonts plus a few more clean sans/serif/mono options in
// the same spirit as the original Django template's pairing), not an open
// text field. `weights` is exactly what's requested in the Google Fonts
// import (see editor.css), so the weight control can scope its options to
// what the chosen family actually ships.
export const FONT_FAMILIES = [
  { id: 'dm-sans', label: 'DM Sans', family: "'DM Sans', sans-serif", weights: [400, 500, 600, 700] },
  { id: 'dm-mono', label: 'DM Mono', family: "'DM Mono', monospace", weights: [400, 500] },
  { id: 'doto', label: 'Doto', family: "'Doto', sans-serif", weights: [600] },
  { id: 'inter', label: 'Inter', family: "'Inter', sans-serif", weights: [400, 500, 600, 700] },
  { id: 'source-serif-4', label: 'Source Serif 4', family: "'Source Serif 4', serif", weights: [400, 600, 700] },
  { id: 'ibm-plex-sans', label: 'IBM Plex Sans', family: "'IBM Plex Sans', sans-serif", weights: [400, 500, 600, 700] },
  { id: 'ibm-plex-mono', label: 'IBM Plex Mono', family: "'IBM Plex Mono', monospace", weights: [400, 500, 600] },
];

export const FONT_WEIGHT_LABELS = { 400: 'Regular', 500: 'Medium', 600: 'Semibold', 700: 'Bold' };

export function fontFamilyById(id) {
  return FONT_FAMILIES.find((f) => f.id === id) || FONT_FAMILIES[0];
}

// CSS font-family value for a stored id, or undefined if unset — so
// callers can spread it straight into an inline style and fall back to
// ordinary inheritance when no explicit choice has been made.
export function fontFamilyCSS(id) {
  if (!id) return undefined;
  const f = FONT_FAMILIES.find((x) => x.id === id);
  return f ? f.family : undefined;
}
