import React, { useState } from 'react';
import { useEditor } from '../../state/EditorContext';
import { beginDragSelectGuard } from '../../utils/dragGuard';
import { rotatedBoundingBox } from '../../utils/geometry';
import { pxToMm, mm } from '../../utils/units';
import CanvasItem from './CanvasItem';
import GroupSelectionOverlay from './GroupSelectionOverlay';

// Single free-positioning canvas for every item — shape or content, painted
// in a SINGLE pass, in `template.items`'s own array order (index 0 = back,
// last = front) — the shape-behind-content guarantee is not an artifact of
// two hardcoded render groups; it comes entirely from EditorContext keeping
// that array order itself correct (see utils/zorder.js's normalizeZOrder,
// applied by every mutation that can change order or add items). This is
// what actually lets an allowFreeLayering item (e.g. a user-placed image)
// interleave above content — painting two fixed groups back-to-front could
// never do that no matter what the array said.
export default function CanvasLayer() {
  const { template, selection, setSelection, guides, zoom, setContextMenu } = useEditor();
  const [marquee, setMarquee] = useState(null); // {x,y,w,h} while dragging on empty canvas, in PAGE units

  // Prompt 26 item 1: hidden items are filtered out here — they don't
  // render, aren't selectable (nothing to click), and (being absent from
  // this same list) never appear in the marquee hit-test below either.
  const visibleItems = template.items.filter((i) => !i.hidden);

  const startMarquee = (e) => {
    // Prompt 29 item 6: a right (or middle) click on empty canvas must
    // never clear the selection or start a marquee — it's headed for the
    // native `contextmenu` event right after this same `mousedown`, and
    // clearing the selection here would wipe out a multi-selection before
    // handleContextMenu below ever gets a chance to see it.
    if (e.button !== 0) return;
    if (e.target !== e.currentTarget) return; // only start on empty canvas, not on an item
    const restoreSelection = beginDragSelectGuard();
    // Prompt 22: `.canvas-layer` is itself a child of the CSS-zoomed
    // `.page-frame`, so its OWN getBoundingClientRect() already comes
    // back at the current on-screen (zoomed) size — dividing by `scale`
    // here converts the cursor's screen-pixel offset within it into
    // page-frame-local CSS px; Phase 2a additionally converts THAT into
    // true mm (pxToMm) before it ever reaches `marquee`, which is what
    // every item's own x/y/width/height are now stored in — so both the
    // live rendering below and the final hit-test compare mm to mm
    // consistently, not screen-pixels to mm.
    const scale = zoom / 100;
    const rect = e.currentTarget.getBoundingClientRect();
    const start = { x: pxToMm((e.clientX - rect.left) / scale), y: pxToMm((e.clientY - rect.top) / scale) };
    setSelection({ ids: [], part: null });

    let currentBox = null; // tracked locally, not via React state, so onUp can
    // read the final box synchronously instead of nesting a cross-component
    // setSelection call inside setMarquee's own updater function.

    const onMove = (ev) => {
      const cur = { x: pxToMm((ev.clientX - rect.left) / scale), y: pxToMm((ev.clientY - rect.top) / scale) };
      currentBox = {
        x: Math.min(start.x, cur.x),
        y: Math.min(start.y, cur.y),
        w: Math.abs(cur.x - start.x),
        h: Math.abs(cur.y - start.y),
      };
      setMarquee(currentBox);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (currentBox) {
        const hits = visibleItems.filter((i) => {
          return (
            i.x < currentBox.x + currentBox.w &&
            i.x + i.width > currentBox.x &&
            i.y < currentBox.y + currentBox.h &&
            i.y + i.height > currentBox.y
          );
        });
        if (hits.length) setSelection({ ids: hits.map((i) => i.id), part: null });
      }
      setMarquee(null);
      restoreSelection();
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // Prompt 29 item 6: right-clicking directly on a selected item already
  // opens the (Prompt 15) common-capability context menu via that item's
  // own onContextMenu (CanvasItem's beginContextMenu, which stops
  // propagation) — but right-clicking in the EMPTY gap between members of
  // a multi-selection (inside the Prompt 18 group overlay's bounding box,
  // which is itself `pointer-events: none` so nothing catches it there)
  // used to bubble all the way up with no handler at all, doing nothing.
  // This catches exactly that gap: only 2+ selected items even have a
  // meaningful "bounding area" to be "inside," and only when nothing
  // closer to the actual target already handled it.
  const handleContextMenu = (e) => {
    if (selection.ids.length < 2) return;
    const selectedItems = template.items.filter((i) => selection.ids.includes(i.id));
    if (selectedItems.length < 2) return;
    const scale = zoom / 100;
    const rect = e.currentTarget.getBoundingClientRect();
    const cursorXMm = pxToMm((e.clientX - rect.left) / scale);
    const cursorYMm = pxToMm((e.clientY - rect.top) / scale);
    const boxes = selectedItems.map(rotatedBoundingBox);
    const minX = Math.min(...boxes.map((b) => b.minX));
    const maxX = Math.max(...boxes.map((b) => b.maxX));
    const minY = Math.min(...boxes.map((b) => b.minY));
    const maxY = Math.max(...boxes.map((b) => b.maxY));
    if (cursorXMm >= minX && cursorXMm <= maxX && cursorYMm >= minY && cursorYMm <= maxY) {
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({ x: e.clientX, y: e.clientY });
    }
  };

  return (
    <div className="canvas-layer" onMouseDown={startMarquee} onContextMenu={handleContextMenu}>
      {visibleItems.map((item) => (
        <CanvasItem key={item.id} item={item} />
      ))}

      <GroupSelectionOverlay />

      {marquee && (
        <div
          className="selection-box"
          style={{ left: mm(marquee.x), top: mm(marquee.y), width: mm(marquee.w), height: mm(marquee.h) }}
        />
      )}

      {/* Smart guides (Prompt 6/14, rebuilt Prompt 19): transient, only
          while a drag/resize gesture is active (see CanvasItem's
          resolveAxisSnap use) — alignment lines, equal-spacing markers,
          and live distance labels.
          Line spans are bounded (`from`/`to`) rather than page-edge-to-
          edge — full page width/height only for a genuine page-center
          match (see geometry.js's guideSpan) — so a guide reads as "these
          two things align," not decoration stretched across empty page. */}
      {guides?.vertical.map((g, i) => (
        <div key={`gv-${i}`} className="align-guide align-guide--vertical" style={{ left: mm(g.value), top: mm(g.from), height: mm(g.to - g.from) }} />
      ))}
      {guides?.horizontal.map((g, i) => (
        <div key={`gh-${i}`} className="align-guide align-guide--horizontal" style={{ top: mm(g.value), left: mm(g.from), width: mm(g.to - g.from) }} />
      ))}
      {guides?.labels.map((l, i) => (
        <div key={`gl-${i}`} className="align-guide-label" style={{ left: mm(l.x), top: mm(l.y) }}>{l.text}</div>
      ))}
      {/* Equal-spacing markers (Prompt 19 item 2, the flagship feature;
          per-segment rendering fixed in Prompt 20 item 1): ONE short
          segment + pill per individual gap that's part of the matched
          rhythm — bounded to that single gap's own `from`/`to` span, the
          same way an ordinary alignment line is now bounded (never one
          line stretching across the whole line of items — ANY number of
          equalized gaps show as that many independent small indicators,
          matching Canva's actual look, not a single spanning line). A
          gap reading e.g. "24px" here means every OTHER marker sharing
          that same rhythm reads the same value, at the instant they
          actually match. */}
      {guides?.spacing.map((s, i) => (
        <div
          key={`gs-line-${i}`}
          className={`align-guide ${s.axis === 'x' ? 'align-guide--horizontal' : 'align-guide--vertical'}`}
          style={
            s.axis === 'x'
              ? { top: mm(s.cross), left: mm(s.from), width: mm(s.to - s.from) }
              : { left: mm(s.cross), top: mm(s.from), height: mm(s.to - s.from) }
          }
        />
      ))}
      {guides?.spacing.map((s, i) => (
        <div
          key={`gs-label-${i}`}
          className="align-guide-label"
          style={{
            left: mm(s.axis === 'x' ? (s.from + s.to) / 2 : s.cross),
            top: mm(s.axis === 'x' ? s.cross : (s.from + s.to) / 2),
          }}
        >
          {s.text}
        </div>
      ))}
    </div>
  );
}
