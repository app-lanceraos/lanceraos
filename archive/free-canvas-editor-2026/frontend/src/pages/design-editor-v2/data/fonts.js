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
  // Phase 3c: weights for the 4 production font families below (Source
  // Serif 4, IBM Plex Sans, IBM Plex Mono, Space Grotesk) were re-verified
  // directly against apps/invoices/pdf_generator.py's real FONT_CONTEXT
  // (~line 76) rather than trusted from the prior grep-based guess —
  // WeasyPrint only ever embeds the weights named there (400/600 for the
  // 3 IBM Plex/Source Serif faces, 400/700 for Space Grotesk's single
  // variable-font file); the prior 500/700 entries on Source Serif 4 and
  // IBM Plex Sans, and the 500 entry on IBM Plex Mono, had no matching
  // @font-face anywhere and are removed. Confirmed no `Caveat` entry
  // exists here — that font file sits on disk (apps/invoices/static/
  // invoices/fonts/) but is referenced by zero real @font-face rule
  // (pdf_generator.py's own FONT_CONTEXT comment says so directly), so it
  // correctly has no editor catalog entry.
  { id: 'source-serif-4', label: 'Source Serif 4', family: "'Source Serif 4', serif", weights: [400, 600] },
  { id: 'ibm-plex-sans', label: 'IBM Plex Sans', family: "'IBM Plex Sans', sans-serif", weights: [400, 600] },
  { id: 'ibm-plex-mono', label: 'IBM Plex Mono', family: "'IBM Plex Mono', monospace", weights: [400, 600] },
  // Real production font (apps/invoices/templates/invoices/modern.html's
  // own @font-face + masthead) — confirmed via a direct grep of the
  // backend templates, not assumed. Weights match pdf_generator.py's
  // FONT_CONTEXT: a single variable-font file (SpaceGrotesk[wght].ttf)
  // serving both 400 and 700.
  { id: 'space-grotesk', label: 'Space Grotesk', family: "'Space Grotesk', sans-serif", weights: [400, 700] },
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
