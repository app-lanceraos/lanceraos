// Prompt 28: the template-level theme — two colors + a heading/body font
// pairing, reusing the existing font catalog (data/fonts.js) rather than
// a second one. `primaryColor` matches the app's existing dominant ink/
// border tone (#262420 — used as the default-fallback border/text color
// in several places already); `secondaryColor` matches the existing
// accent tone used for block/qr titles (#a2896b).
//
// Prompt 30 item 6: heading and body fonts are deliberately DIFFERENT —
// Source Serif 4 Bold for headings (distinctive, reads as a heading
// treatment on its own), DM Sans Regular for body (the app's plain,
// original default) — so a fresh template's theme already reads as an
// intentional pairing, not two identical dropdowns. This is a deliberate
// reversal of Prompt 28's own "start identical so nothing visually
// changes yet" choice, since that constraint was specific to *introducing*
// the theme without disturbing the template that predated it — this
// prompt explicitly asks for the two to differ out of the box instead.
export const DEFAULT_THEME = {
  primaryColor: '#262420',
  secondaryColor: '#a2896b',
  headingFont: { family: 'source-serif-4', weight: 700 },
  bodyFont: { family: 'dm-sans', weight: 400 },
};

// A linkable property's stored value is either a literal (string, or
// undefined = "unset, use whatever hardcoded fallback the render site
// itself supplies") or a sentinel `{ linked: 'primary' | 'secondary' |
// 'heading' | 'body' }` — resolved to the theme's current value at
// render/display time. Detected structurally (not by import identity),
// since it round-trips through plain JSON (localStorage clipboard,
// undo history) and must still be recognized after that.
export function isLinked(value) {
  return !!(value && typeof value === 'object' && typeof value.linked === 'string');
}

export function resolveColorValue(value, theme) {
  if (isLinked(value)) {
    if (value.linked === 'primary') return theme.primaryColor;
    if (value.linked === 'secondary') return theme.secondaryColor;
    return undefined;
  }
  return value;
}

// Family and weight always resolve TOGETHER as one pair when linked (a
// "heading font" IS a family+weight combination) — the item's own
// `fontWeight` field is irrelevant/ignored whenever `fontFamily` is
// linked, exactly mirroring how the two are meant to travel as a unit.
export function resolveFontValue(familyValue, weightValue, theme) {
  if (isLinked(familyValue)) {
    const slot = familyValue.linked === 'heading' ? theme.headingFont : theme.bodyFont;
    return { fontFamily: slot.family, fontWeight: slot.weight };
  }
  return { fontFamily: familyValue, fontWeight: weightValue };
}

// Resolves every linkable field on a whole item AND on every sub-part
// style object it carries, against the current theme — returns a NEW
// plain-literal-valued item so every downstream renderer (ContentBody,
// ShapeBody, partInlineStyle, frameStyle, ...) can stay completely
// unaware that linking exists at all; they just see ordinary strings/
// numbers, same as before this prompt.
//
// Sub-parts are dynamic (block line keys vary per catalog entry — see
// elementCatalog.js), so they're found structurally: any OWN key whose
// value is a plain object carrying at least one of the linkable style
// fields (the same "does this look like a part style blob" heuristic
// GroupSelectionOverlay's scaleItemStyle already uses for fontSize/
// borderWidth scaling).
export function resolveItemTheme(item, theme) {
  const wholeFont = resolveFontValue(item.fontFamily, item.fontWeight, theme);
  const resolved = {
    ...item,
    textColor: resolveColorValue(item.textColor, theme),
    bgColor: resolveColorValue(item.bgColor, theme),
    borderColor: resolveColorValue(item.borderColor, theme),
    fill: resolveColorValue(item.fill, theme),
    fontFamily: wholeFont.fontFamily,
    fontWeight: wholeFont.fontWeight,
  };

  Object.keys(item).forEach((key) => {
    const val = item[key];
    if (
      val &&
      typeof val === 'object' &&
      !Array.isArray(val) &&
      ('textColor' in val || 'bgColor' in val || 'borderColor' in val || 'fontFamily' in val)
    ) {
      const partFont = resolveFontValue(val.fontFamily, val.fontWeight, theme);
      resolved[key] = {
        ...val,
        textColor: resolveColorValue(val.textColor, theme),
        bgColor: resolveColorValue(val.bgColor, theme),
        borderColor: resolveColorValue(val.borderColor, theme),
        fontFamily: partFont.fontFamily,
        fontWeight: partFont.fontWeight,
      };
    }
  });

  return resolved;
}
