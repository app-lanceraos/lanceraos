import React, { useLayoutEffect, useRef } from 'react';
import { useEditor } from '../../state/EditorContext';
import CanvasLayer from './CanvasLayer';
import { mmToPx } from '../../utils/units';

// `readOnly` is how PreviewModal reuses this exact tree without leaking the
// live editor's selection into it: Preview shares the SAME EditorContext
// (deliberately — no separate render path to drift from what's actually on
// the page), so without this flag, whatever's selected behind the modal
// would still show its outline/handles/guides inside the "clean" preview.
// Prompt 22: zoom is likewise a live-editor-only concern — Preview forces
// `scale` to 1 regardless of the editor's current zoom (it already has its
// own independent 0.85 scale wrapper in PreviewModal.jsx; compounding that
// with whatever the editor happens to be zoomed to would be a surprising,
// unrelated visual side effect, not a real feature).
export default function EditorCanvas({ readOnly = false }) {
  const { template, setSelection, edgeHighlight, zoom, setZoom, canvasViewportRef } = useEditor();
  const scale = readOnly ? 1 : zoom / 100;
  const pageFrameRef = useRef(null);
  // Holds the cursor-relative anchor point captured the instant a wheel-
  // zoom fires, consumed by the layout effect below once the DOM has
  // re-rendered at the new scale — see handleWheel's own comment for why
  // this needs two passes instead of computing scroll position inline.
  const pendingZoomAnchor = useRef(null);

  // Prompt 22 item 2: trackpad pinch arrives as a wheel event with
  // ctrlKey:true (a browser convention, not the literal Ctrl key) —
  // Ctrl/Cmd+scroll is the explicit keyboard-modified equivalent for
  // users without a trackpad. Anything else is a normal scroll and must
  // be left completely alone (no preventDefault) so the page still pans
  // normally.
  const handleWheel = (e) => {
    if (readOnly || !(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const scrollEl = canvasViewportRef.current;
    const frameEl = pageFrameRef.current;
    if (!scrollEl || !frameEl) return;
    // Where the cursor sits as a FRACTION of the page-frame's current
    // on-screen box (0..1 on each axis) — independent of scroll position,
    // padding, or the flex-centering `.canvas-scroll` does, so it's the
    // one measurement that survives the zoom level actually changing
    // underneath it a moment later.
    const rect = frameEl.getBoundingClientRect();
    const fracX = (e.clientX - rect.left) / rect.width;
    const fracY = (e.clientY - rect.top) / rect.height;
    // Exponential (not linear) step: trackpad pinch delivers a stream of
    // small deltaY values, a mouse-wheel-plus-Ctrl delivers occasional
    // large ones — scaling multiplicatively keeps both feeling like the
    // same "zoom speed" regardless of the raw delta's magnitude.
    const factor = Math.exp(-e.deltaY * 0.01);
    const newZoom = Math.min(200, Math.max(25, Math.round(zoom * factor)));
    if (newZoom === zoom) return;
    pendingZoomAnchor.current = { fracX, fracY, clientX: e.clientX, clientY: e.clientY, targetZoom: newZoom };
    setZoom(newZoom);
  };

  // Runs after the zoom state change above has already re-rendered the
  // page-frame at its new size — re-measures the (now different) on-
  // screen rect and adjusts scroll so the SAME fractional point captured
  // in handleWheel lands back under the cursor's actual screen position,
  // which is what "zoom centered on the cursor" means in practice.
  useLayoutEffect(() => {
    const pending = pendingZoomAnchor.current;
    if (!pending || pending.targetZoom !== zoom) return;
    pendingZoomAnchor.current = null;
    const scrollEl = canvasViewportRef.current;
    const frameEl = pageFrameRef.current;
    if (!scrollEl || !frameEl) return;
    const rect = frameEl.getBoundingClientRect();
    const desiredLeft = pending.clientX - pending.fracX * rect.width;
    const desiredTop = pending.clientY - pending.fracY * rect.height;
    scrollEl.scrollLeft += rect.left - desiredLeft;
    scrollEl.scrollTop += rect.top - desiredTop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom]);

  return (
    <div
      className="canvas-scroll"
      ref={readOnly ? undefined : canvasViewportRef}
      onWheel={readOnly ? undefined : handleWheel}
    >
      <div
        className="page-zoom-wrapper"
        style={{ width: mmToPx(template.page.width) * scale, height: mmToPx(template.page.height) * scale }}
      >
        <div
          ref={pageFrameRef}
          className="page-frame"
          style={{ background: template.page.backgroundColor, transform: `scale(${scale})` }}
          onMouseDown={
            readOnly
              ? undefined
              : (e) => {
                  // Prompt 29 item 6: a right/middle-click headed for the
                  // native contextmenu event must never clear the
                  // selection first — see CanvasLayer's startMarquee for
                  // the matching fix on the layer just inside this frame.
                  if (e.button !== 0) return;
                  setSelection({ ids: [], part: null });
                }
          }
        >
          <CanvasLayer readOnly={readOnly} />
          {!readOnly && edgeHighlight?.top && <div className="page-edge-glow page-edge-glow--top" />}
          {!readOnly && edgeHighlight?.bottom && <div className="page-edge-glow page-edge-glow--bottom" />}
          {!readOnly && edgeHighlight?.left && <div className="page-edge-glow page-edge-glow--left" />}
          {!readOnly && edgeHighlight?.right && <div className="page-edge-glow page-edge-glow--right" />}
        </div>
      </div>
    </div>
  );
}
