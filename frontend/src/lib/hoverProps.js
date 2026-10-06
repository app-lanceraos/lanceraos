// src/lib/hoverProps.js
//
// Props for a JS-driven hover effect (an inline style set on enter and reset
// on leave) that is safe on touch screens. The old pattern was
// onMouseEnter/onMouseLeave: on a tap a touch browser fires the compatibility
// `mouseenter` but no `mouseleave` until some OTHER element is tapped, so the
// "hovered" look (a highlighted background, a scaled icon) stayed stuck.
// Pointer events carry `pointerType`, so a touch pointer is simply ignored —
// the same policy useAppTooltip.js follows: hover is a mouse/pen concept.
//
// Usage: <button {...hoverProps(onEnter, onLeave)} />. Handlers receive the
// React pointer event (use e.currentTarget as before). For a hover effect
// that can be written in plain CSS, prefer a :hover rule inside
// `@media (hover: hover)` instead (STANDARDS.md) — this helper exists for the
// places that must compute the style in JS.
export function hoverProps(onEnter, onLeave) {
  return {
    onPointerEnter: (e) => { if (e.pointerType !== 'touch') onEnter(e) },
    onPointerLeave: (e) => { if (e.pointerType !== 'touch') onLeave(e) },
  }
}
