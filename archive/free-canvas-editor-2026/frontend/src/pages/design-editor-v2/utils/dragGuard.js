// Prompt 17 items 1/2: while any drag/resize/rotate/marquee gesture is in
// progress, the mouse can move faster than the clamped/pushed position
// it's actually producing — e.g. right at a page/collision boundary,
// where the item's own position stops changing but the pointer keeps
// moving — and the browser reads that continued movement as a normal
// click-and-drag TEXT selection instead. Disabling selection on the
// whole page for the gesture's duration (not just the canvas) is what
// actually covers every case, since a fast drag can carry the pointer
// outside the canvas entirely before the next mousemove is even handled.
//
// Call at the very start of a gesture (mousedown), keep the returned
// function, and call it again on mouseup to restore whatever `user-select`
// value was there before (almost always none, but never assume).
//
// Prompt 30 item 5: also blurs whatever currently has focus. Some
// gestures (rotate/resize handles) call `e.preventDefault()` on their own
// mousedown — which, as a side effect, suppresses the browser's normal
// "blur whatever's focused" behavior for a click on a non-focusable
// target (a plain `<div>` handle). If a properties-panel number input
// was left focused from an earlier click, it stayed focused right
// through the entire gesture and after — which made
// useKeyboardShortcuts.js's own "don't hijack typing in an input" guard
// silently swallow Ctrl+Z afterward, even though the toolbar's Undo
// button (a plain onClick with no focus check) undid the exact same
// state correctly. Blurring here, at the one shared entry point every
// canvas gesture already calls (move/resize/rotate, single or group,
// column-resize, marquee), fixes it at the root rather than adding a
// preventDefault-side-effect workaround to each gesture individually.
export function beginDragSelectGuard() {
  const active = document.activeElement;
  if (active && active !== document.body && typeof active.blur === 'function') {
    active.blur();
  }
  const prev = document.body.style.userSelect;
  document.body.style.userSelect = 'none';
  return () => {
    document.body.style.userSelect = prev;
  };
}
