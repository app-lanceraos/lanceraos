import React, { useState } from 'react';
import { useEditor } from '../../state/EditorContext';
import { detectRail } from '../../data/shapeCatalog';
import { beginDragSelectGuard } from '../../utils/dragGuard';
import { rotatedBoundingBox } from '../../utils/geometry';
import CanvasItem from './CanvasItem';
import GroupSelectionOverlay from './GroupSelectionOverlay';

// Single free-positioning canvas for every item — shape or content. Shapes
// still paint as background decoration: the shape group is painted first,
// the content group after, so content always sits visually above shapes
// regardless of where either sits in the underlying flat `template.items`
// array (which only orders items relative to their own kind-group).
export default function CanvasLayer({ readOnly = false }) {
  const { template, selection, setSelection, guides, zoom, setContextMenu } = useEditor();
  const [marquee, setMarquee] = useState(null); // {x,y,w,h} while dragging on empty canvas, in PAGE units

  // Prompt 26 item 3: painted in a SINGLE pass, in `template.items`'s own
  // array order (index 0 = back, last = front) — the shape-behind-content
  // guarantee is no longer an artifact of two hardcoded render groups; it
  // now comes entirely from EditorContext keeping that array order itself
  // correct (see utils/zorder.js's normalizeZOrder, applied by every
  // mutation that can change order or add items). This is what actually
  // lets a future allowFreeLayering item interleave above content —
  // painting two fixed groups back-to-front could never do that no
  // matter what the array said.
  // Prompt 26 item 1: hidden items are filtered out here — they don't
  // render, aren't selectable (nothing to click), and (being absent from
  // this same list) never appear in the rail-detection or marquee hit-
  // test below either.
  const visibleItems = template.items.filter((i) => !i.hidden);
  const shapes = visibleItems.filter((i) => i.kind === 'shape');

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
    // here converts the cursor's screen-pixel offset within it into true
    // PAGE units, which is what `marquee` is now tracked in throughout
    // (matching every item's own x/y/width/height) so both the live
    // rendering below and the final hit-test compare page-units to
    // page-units consistently, not screen-pixels to page-units.
    const scale = zoom / 100;
    const rect = e.currentTarget.getBoundingClientRect();
    const start = { x: (e.clientX - rect.left) / scale, y: (e.clientY - rect.top) / scale };
    setSelection({ ids: [], part: null });

    let currentBox = null; // tracked locally, not via React state, so onUp can
    // read the final box synchronously instead of nesting a cross-component
    // setSelection call inside setMarquee's own updater function.

    const onMove = (ev) => {
      const cur = { x: (ev.clientX - rect.left) / scale, y: (ev.clientY - rect.top) / scale };
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
    if (readOnly) return;
    if (selection.ids.length < 2) return;
    const selectedItems = template.items.filter((i) => selection.ids.includes(i.id));
    if (selectedItems.length < 2) return;
    const scale = zoom / 100;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = (e.clientX - rect.left) / scale;
    const py = (e.clientY - rect.top) / scale;
    const boxes = selectedItems.map(rotatedBoundingBox);
    const minX = Math.min(...boxes.map((b) => b.minX));
    const maxX = Math.max(...boxes.map((b) => b.maxX));
    const minY = Math.min(...boxes.map((b) => b.minY));
    const maxY = Math.max(...boxes.map((b) => b.maxY));
    if (px >= minX && px <= maxX && py >= minY && py <= maxY) {
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({ x: e.clientX, y: e.clientY });
    }
  };

  // Live rail preview: while a selected shape is near an edge, show the
  // dashed safe-area indicator (approximated from committed shape state —
  // good enough since rail recognition only matters once released).
  const rails = !readOnly && shapes
    .map((shape) => ({ shape, rail: detectRail(shape, template.page) }))
    .filter((r) => r.rail && selection.ids.includes(r.shape.id));

  return (
    <div
      className="canvas-layer"
      onMouseDown={readOnly ? undefined : startMarquee}
      onContextMenu={readOnly ? undefined : handleContextMenu}
    >
      {visibleItems.map((item) => (
        <CanvasItem key={item.id} item={item} readOnly={readOnly} />
      ))}

      {!readOnly && <GroupSelectionOverlay />}

      {!readOnly && rails.map(({ shape, rail }) => (
        <div
          key={shape.id}
          className="rail-overlay"
          style={{
            left: rail.edge === 'right' ? undefined : rail.edge === 'left' ? rail.thickness : 0,
            right: rail.edge === 'right' ? rail.thickness : rail.edge === 'left' ? undefined : 0,
            top: rail.edge === 'bottom' ? undefined : rail.edge === 'top' ? rail.thickness : 0,
            bottom: rail.edge === 'bottom' ? rail.thickness : rail.edge === 'top' ? undefined : 0,
          }}
        />
      ))}

      {!readOnly && marquee && (
        <div
          className="rail-overlay"
          style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h, borderStyle: 'solid' }}
        />
      )}

      {/* Smart guides (Prompt 6/14, rebuilt Prompt 19): transient, only
          while a drag/resize gesture is active (see CanvasItem's
          resolveAxisSnap use) — alignment lines, equal-spacing markers,
          and live distance labels. Explicitly gated on readOnly too, not
          just left to "guides is null outside a drag" — Preview must
          never show them even if a gesture somehow left stale guide
          state behind in the shared context.
          Line spans are bounded (`from`/`to`) rather than page-edge-to-
          edge — full page width/height only for a genuine page-center
          match (see geometry.js's guideSpan) — so a guide reads as "these
          two things align," not decoration stretched across empty page. */}
      {!readOnly && guides?.vertical.map((g, i) => (
        <div key={`gv-${i}`} className="align-guide align-guide--vertical" style={{ left: g.value, top: g.from, height: g.to - g.from }} />
      ))}
      {!readOnly && guides?.horizontal.map((g, i) => (
        <div key={`gh-${i}`} className="align-guide align-guide--horizontal" style={{ top: g.value, left: g.from, width: g.to - g.from }} />
      ))}
      {!readOnly && guides?.labels.map((l, i) => (
        <div key={`gl-${i}`} className="align-guide-label" style={{ left: l.x, top: l.y }}>{l.text}</div>
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
      {!readOnly && guides?.spacing.map((s, i) => (
        <div
          key={`gs-line-${i}`}
          className={`align-guide ${s.axis === 'x' ? 'align-guide--horizontal' : 'align-guide--vertical'}`}
          style={
            s.axis === 'x'
              ? { top: s.cross, left: s.from, width: s.to - s.from }
              : { left: s.cross, top: s.from, height: s.to - s.from }
          }
        />
      ))}
      {!readOnly && guides?.spacing.map((s, i) => (
        <div
          key={`gs-label-${i}`}
          className="align-guide-label"
          style={{
            left: s.axis === 'x' ? (s.from + s.to) / 2 : s.cross,
            top: s.axis === 'x' ? s.cross : (s.from + s.to) / 2,
          }}
        >
          {s.text}
        </div>
      ))}
    </div>
  );
}
