// Phase 2a — the editor's one canonical unit boundary.
//
// Every stored geometric value (x/y/width/height, naturalWidth/Height,
// page.width/height, collision/snap/padding constants, border width,
// corner radius, cell padding, crop rects) lives in MILLIMETRES from here
// on — matching design_data's own contract exactly (see design_schema.py/
// design_renderer.py: position/size are already mm, and — checked
// directly, not assumed — `border_width_mm`/`border_radius_mm` are mm too,
// while `font_size_pt` is the one field production expresses in points
// instead). Nothing in this app's internal math (geometry.js, the
// gesture handlers in CanvasItem/GroupSelectionOverlay/CanvasLayer,
// validation.js) ever touches px — px only exists at two boundaries:
//   1. INPUT — a raw mouse delta (MouseEvent clientX/clientY, always
//      physical CSS px) or a measured DOM size (ResizeObserver's
//      contentRect, also always CSS px regardless of what unit the
//      element's own style was authored in) gets converted to mm via
//      pxToMm() the instant it's read.
//   2. OUTPUT — nothing needs an explicit mm->px conversion at all: CSS
//      itself defines `mm` as a native absolute length unit at exactly
//      96/25.4 px per mm (the CSS spec's own reference-pixel definition,
//      which is exactly MM_TO_PX below) — so every geometric inline style
//      in this app is authored as a `"<value>mm"` STRING (see the `mm()`
//      helper) and the browser performs the identical conversion itself,
//      with no separate rounding step to drift out of sync with it.
//      mmToPx() still exists for the few cases that need a real JS number
//      in page-frame-local px space (none in this app render geometry
//      that way after this pass, but callers doing ad hoc pixel math —
//      e.g. a future feature — have it available without re-deriving the
//      constant).
//
// This exact factor (not a second, independently-drifting one) mirrors
// frontend/src/lib/designEditor/constants.js's own MM_TO_PX/PX_TO_MM —
// the production canvas adapter's identical boundary-conversion constant.
export const MM_TO_PX = 96 / 25.4;
export const PX_TO_MM = 25.4 / 96;

// Raw scale conversions — no rounding, since these run on hot paths
// (every mousemove frame of a drag/resize/marquee gesture) where
// intermediate rounding would only accumulate drift, not prevent it.
// Rounding happens exactly once, at the point a value is actually
// COMMITTED to stored state (see roundMm below) — never mid-gesture.
export function pxToMm(px) {
  return (px || 0) * PX_TO_MM;
}

export function mmToPx(mm) {
  return (mm || 0) * MM_TO_PX;
}

// 2dp — matches design_schema.py/constants.js's own stored precision
// convention exactly (pxToMm's own comment: "matches design_schema.py's
// own numbers"). Used when a value is about to be written into
// template state from a raw measurement or a live gesture's final
// commit (never mid-gesture — see CanvasItem's updateItem/updateItems
// calls), so stored mm values stay clean rather than accumulating
// float noise from repeated px<->mm round trips.
export function roundMm(mm) {
  return Math.round(mm * 100) / 100;
}

// CSS length-string helper — the one place `mm` gets turned into an
// inline-style value. Every geometric style in this app (left/top/width/
// height/border-width/border-radius/padding) is authored this way rather
// than as a bare number (which React/CSS would silently interpret as
// PIXELS) — see this file's own header comment for why no numeric
// mm->px conversion is needed for the output direction at all.
// Guards undefined/null through as-is (see pt()'s own matching comment
// below) — 0 is a legitimate mm value (e.g. an item flush against the
// page edge, or a genuinely-zero border width a caller didn't already
// filter out) and renders as the valid `"0mm"`, so only nullish values
// short-circuit.
export function mm(value) {
  return value === undefined || value === null ? value : `${value}mm`;
}

// Points — the one field production expresses in a different physical
// unit (font_size_pt, design_renderer.py). 1pt = 1/72in, CSS px is
// defined at 96/in, so 1pt = 96/72 = 4/3 px — this is a real, exact
// physical-unit ratio, not an approximation.
export const PT_PER_PX = 72 / 96; // 0.75
export const PX_PER_PT = 96 / 72; // 1.3(3)

export function pxToPt(px) {
  return px * PT_PER_PX;
}

// Like mm() above: CSS natively supports `pt` as an absolute length unit
// and the ancestor `.page-frame`'s zoom transform scales it exactly the
// same way it scales `mm`/`px` — so this is a plain string helper, no
// numeric conversion needed at the render boundary.
// Guards undefined/null through as-is (rather than the string
// "undefinedpt") — several callers (e.g. partInlineStyle's qr 'body'
// part, which carries no text at all) legitimately have no font size to
// report, and React/CSS already treat an undefined style value as "not
// set," so this preserves that instead of turning it into a real,
// invalid CSS value.
export function pt(value) {
  return value === undefined || value === null ? value : `${value}pt`;
}
