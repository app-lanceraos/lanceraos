import React, { useState } from 'react';
import { useEditor } from '../../state/EditorContext';
import { RotateIcon, SELECTION_OUTLINE_INSET } from './CanvasItem';
import { beginDragSelectGuard } from '../../utils/dragGuard';
import {
  RESIZE_HANDLES,
  rotatedBoundingBox,
  resizeRotatedBox,
  clampResizeToPage,
  resolveResizeCollision,
  getItemBounds,
  getFooterTop,
  snapRotation,
  rotateVector,
  MIN_ITEM_SIZE_MM,
  MIN_SCALED_ITEM_SIZE_MM,
} from '../../utils/geometry';
import { pxToMm, mm } from '../../utils/units';

// Prompt 24 item 3: square handles straddling the group box's own visible
// selection outline (`.group-selection-box::after`, same `-4px` inset as
// an individual item's own outline — see CanvasItem's SELECTION_OUTLINE_
// INSET), same convention as CanvasItem's individual-item handles — no
// adaptive-neighbor shrinking here (a synthetic group box has no single
// "neighbor" of its own to stay clear of the way an individual item's
// handle does), so the offset is just the fixed ideal reach, unconditionally.
function groupHandleOffset(f) {
  return f === 0.5 ? 0 : f === 1 ? SELECTION_OUTLINE_INSET : -SELECTION_OUTLINE_INSET;
}

// Prompt 18 item 2: a whole-item-level property is a MINIMUM for text
// (Prompt 14), but a multi-select resize is a genuine SCALE transform —
// deliberately the one place that rule doesn't apply — so every absolute-
// pixel style value on a member scales right along with its box. Scanned
// generically (rather than hardcoded per element type) so it reaches
// every variant: top-level fontSize/borderWidth/cornerRadius/table
// fields, AND any nested sub-part style object (label/value/title/line-
// keys/body) carrying its own fontSize/borderWidth override.
function scaleItemStyle(item, fontScale) {
  const patch = {};
  if (item.fontSize) patch.fontSize = item.fontSize * fontScale;
  if (item.borderWidth) patch.borderWidth = item.borderWidth * fontScale;
  if (item.cornerRadius) patch.cornerRadius = item.cornerRadius * fontScale;
  if (item.radius) patch.radius = item.radius * fontScale; // shapes (roundedRect)
  if (item.headerFontSize) patch.headerFontSize = item.headerFontSize * fontScale;
  if (item.rowBorderWidth !== undefined) patch.rowBorderWidth = item.rowBorderWidth * fontScale;
  if (item.cellPadding !== undefined) patch.cellPadding = item.cellPadding * fontScale;
  Object.keys(item).forEach((key) => {
    const val = item[key];
    if (val && typeof val === 'object' && !Array.isArray(val) && (val.fontSize || val.borderWidth)) {
      patch[key] = {
        ...val,
        ...(val.fontSize ? { fontSize: val.fontSize * fontScale } : {}),
        ...(val.borderWidth ? { borderWidth: val.borderWidth * fontScale } : {}),
      };
    }
  });
  return patch;
}

// Prompt 18: replaces every selected item's own individual resize/rotate
// handles with ONE shared box + handle set around the whole selection —
// professional-tool convention (Figma/Illustrator/Sketch/Canva). Rendered
// once by CanvasLayer, entirely separate from any single CanvasItem
// instance, since it acts on the WHOLE group rather than belonging to one
// item. Renders nothing (falls back to each item's own handles, via
// CanvasItem's own selectedMovableCount check) once fewer than 2 movable
// items are selected — locked items are still individually
// selected/outlined by their own CanvasItem, just never counted here and
// never moved/resized/rotated by this overlay.
export default function GroupSelectionOverlay() {
  const {
    template,
    selection,
    effectiveSizes,
    pushPreview,
    updateItems,
    setPushPreview,
    setEdgeHighlight,
    setGuides,
    zoom,
  } = useEditor();

  const movableMembers = template.items.filter((i) => selection.ids.includes(i.id) && !i.locked);
  const [rotationSnapped, setRotationSnapped] = useState(false);

  if (movableMembers.length <= 1) return null;

  const withEffectiveSize = (o) => {
    const eff = effectiveSizes[o.id];
    return eff ? { ...o, width: eff.width, height: eff.height } : o;
  };
  // A group move/resize/rotate gesture already in progress (this
  // component's own, or CanvasItem's beginGroupMove) drives every
  // affected member through the shared pushPreview channel, never any
  // single item's own private state — reading it here too is what lets
  // the box/handles visually track that gesture instead of staying
  // frozen at the pre-gesture layout.
  const withLivePreview = (o) => (pushPreview[o.id] ? { ...o, ...pushPreview[o.id] } : o);

  const sizedMembers = movableMembers.map(withEffectiveSize).map(withLivePreview);
  const memberBoxes = sizedMembers.map(rotatedBoundingBox);
  const groupBox = {
    x: Math.min(...memberBoxes.map((b) => b.minX)),
    y: Math.min(...memberBoxes.map((b) => b.minY)),
    width: Math.max(...memberBoxes.map((b) => b.maxX)) - Math.min(...memberBoxes.map((b) => b.minX)),
    height: Math.max(...memberBoxes.map((b) => b.maxY)) - Math.min(...memberBoxes.map((b) => b.minY)),
  };

  const memberIdSet = new Set(movableMembers.map((m) => m.id));
  const footerTop = getFooterTop(template.items, template.page);
  const contentMembers = movableMembers.filter((m) => m.kind === 'content');
  const outsideContent = template.items
    .filter((i) => i.kind === 'content' && !i.hidden && !memberIdSet.has(i.id))
    .map(withEffectiveSize);
  const bounds = contentMembers.length ? getItemBounds(contentMembers[0], template.page, footerTop) : null;

  // Prompt 18 item 2: a true proportional scale around the handle's fixed
  // anchor (opposite corner/edge, same axis-lock convention as single-
  // item resize) — every member's position AND size scale together, and
  // (unlike a single item's own Prompt-13 box resize) so does every
  // absolute-pixel style value via scaleItemStyle. Collision reuses the
  // exact same cascading-push machinery a single item's resize already
  // uses (Prompt 16/17) — the group's own CONTENT members' combined
  // envelope stands in for "the box being resized" against items outside
  // the selection; members never collide with each other.
  const beginGroupResize = (e, handle) => {
    e.stopPropagation();
    e.preventDefault();
    const restoreSelection = beginDragSelectGuard();
    const startBox = { ...groupBox, rotation: 0 };
    const startMouse = { x: e.clientX, y: e.clientY };
    const scale = zoom / 100; // Prompt 22 — see CanvasItem's beginMove comment
    const starts = movableMembers.map((m) => ({
      id: m.id,
      item: m,
      origX: m.x,
      origY: m.y,
      origWidth: m.width,
      origHeight: m.height,
    }));

    let finalPatches = null;

    const onMove = (ev) => {
      // Prompt 22: screen-pixel delta -> page units before it reaches the
      // group box's own resize math.
      const raw = resizeRotatedBox(startBox, handle, pxToMm((ev.clientX - startMouse.x) / scale), pxToMm((ev.clientY - startMouse.y) / scale), MIN_ITEM_SIZE_MM);
      let box = { x: raw.x, y: raw.y, width: raw.width, height: raw.height, rotation: 0 };
      let edges = null;
      if (bounds) {
        const clamped = clampResizeToPage(raw, handle, bounds);
        box = { x: clamped.x, y: clamped.y, width: clamped.width, height: clamped.height, rotation: 0 };
        edges = clamped.edges;
      }
      let pushed = new Map();
      if (bounds && outsideContent.length) {
        const resolved = resolveResizeCollision(startBox, box, handle, outsideContent, bounds);
        box = resolved;
        pushed = resolved.pushed;
      }

      const scaleX = box.width / startBox.width;
      const scaleY = box.height / startBox.height;
      const fontScale = Math.sqrt(Math.abs(scaleX * scaleY)) || 1;
      const anchorX = handle.fx === 0 ? startBox.x + startBox.width : startBox.x;
      const anchorY = handle.fy === 0 ? startBox.y + startBox.height : startBox.y;

      const patches = new Map();
      starts.forEach((s) => {
        patches.set(s.id, {
          x: anchorX + (s.origX - anchorX) * scaleX,
          y: anchorY + (s.origY - anchorY) * scaleY,
          width: Math.max(MIN_SCALED_ITEM_SIZE_MM, s.origWidth * scaleX),
          height: Math.max(MIN_SCALED_ITEM_SIZE_MM, s.origHeight * scaleY),
          ...scaleItemStyle(s.item, fontScale),
        });
      });
      pushed.forEach((pos, id) => patches.set(id, pos));

      finalPatches = patches;
      setEdgeHighlight(edges);
      setPushPreview(Object.fromEntries(patches));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (finalPatches) updateItems([...finalPatches.keys()], (i) => finalPatches.get(i.id));
      setPushPreview({});
      setEdgeHighlight(null);
      setGuides(null);
      restoreSelection();
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // Prompt 18 item 3: the whole selection orbits the group box's shared
  // center — every member's own rotation increases by the drag's delta
  // angle, AND its position orbits that same delta around the shared
  // center (not each item spinning in place). No collision handling here
  // — matches the existing precedent that a SINGLE item's own rotate
  // already has none either; a rotating hull's collision against outside
  // items is a materially harder problem than the linear cascades used
  // everywhere else, deliberately out of scope for this pass.
  //
  // Prompt 22 audit finding: this had a real, PRE-EXISTING bug (not
  // itself caused by zoom, but exposed by the same audit) — the angle
  // math mixed `pageCenter` (page-unit space, from groupBox) directly
  // with `e.clientX/clientY` (screen/viewport-pixel space) in the same
  // atan2 call. Those coordinate spaces are never the same (the page-
  // frame never sits at screen (0,0) — scroll position, panel widths,
  // and canvas padding all offset it), so the computed angle was already
  // subtly wrong before zoom ever entered the picture, and zoom would
  // only have compounded it further. Fixed the same way a single item's
  // own beginRotate already gets this right: a SEPARATE screen-space
  // center, measured via getBoundingClientRect on the group box's own
  // DOM node (which already reflects any CSS zoom transform, same
  // reasoning as beginRotate's own comment) — used ONLY for the angle.
  // The page-unit `pageCenter` is kept, unchanged, for the actual
  // position-orbit math below, since every member's stored x/y is in
  // page units too.
  const beginGroupRotate = (e) => {
    e.stopPropagation();
    e.preventDefault();
    const restoreSelection = beginDragSelectGuard();
    const pageCenter = { x: groupBox.x + groupBox.width / 2, y: groupBox.y + groupBox.height / 2 };
    const screenRect = e.currentTarget.parentElement.getBoundingClientRect();
    const screenCenter = { x: screenRect.left + screenRect.width / 2, y: screenRect.top + screenRect.height / 2 };
    const starts = movableMembers.map((m) => ({
      id: m.id,
      origX: m.x,
      origY: m.y,
      width: m.width,
      height: m.height,
      origRotation: m.rotation || 0,
    }));
    const startAngle = Math.round((Math.atan2(e.clientY - screenCenter.y, e.clientX - screenCenter.x) * 180) / Math.PI + 90);
    let finalPatches = null;

    const onMove = (ev) => {
      const rawAngle = Math.round((Math.atan2(ev.clientY - screenCenter.y, ev.clientX - screenCenter.x) * 180) / Math.PI + 90);
      const { value: delta, snapped } = snapRotation(rawAngle - startAngle);
      setRotationSnapped(snapped);

      const patches = new Map();
      starts.forEach((s) => {
        const relX = s.origX + s.width / 2 - pageCenter.x;
        const relY = s.origY + s.height / 2 - pageCenter.y;
        const rotated = rotateVector(relX, relY, delta);
        patches.set(s.id, {
          x: pageCenter.x + rotated.x - s.width / 2,
          y: pageCenter.y + rotated.y - s.height / 2,
          rotation: s.origRotation + delta,
        });
      });
      finalPatches = patches;
      setPushPreview(Object.fromEntries(patches));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (finalPatches) updateItems([...finalPatches.keys()], (i) => finalPatches.get(i.id));
      setPushPreview({});
      setRotationSnapped(false);
      restoreSelection();
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <div
      className="group-selection-box"
      style={{ position: 'absolute', left: mm(groupBox.x), top: mm(groupBox.y), width: mm(groupBox.width), height: mm(groupBox.height) }}
    >
      {RESIZE_HANDLES.map((h) => (
        <div
          key={h.key}
          className="item__resize-handle"
          style={{
            left: `calc(${h.fx * 100}% + ${groupHandleOffset(h.fx)}px)`,
            top: `calc(${h.fy * 100}% + ${groupHandleOffset(h.fy)}px)`,
            cursor: h.cursor,
            pointerEvents: 'auto',
          }}
          onMouseDown={(e) => beginGroupResize(e, h)}
        />
      ))}
      <div
        className={`item__rotate-handle${rotationSnapped ? ' item__rotate-handle--snapped' : ''}`}
        style={{ pointerEvents: 'auto' }}
        onMouseDown={beginGroupRotate}
      >
        {RotateIcon}
      </div>
    </div>
  );
}
