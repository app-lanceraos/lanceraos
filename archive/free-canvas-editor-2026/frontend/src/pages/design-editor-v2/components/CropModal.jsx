// Real crop UI (data model/schema/adapter/renderer already existed —
// this pass adds only the interaction, per the task's own framing). A
// self-contained modal, deliberately independent of the live canvas's
// own move/resize gesture machinery (snapping/collision/group-select —
// none of that applies to a crop rectangle sitting alone against its own
// source image) — but it REUSES that machinery's actual geometry
// primitives, RESIZE_HANDLES/resizeRotatedBox/clampResizeToPage
// (utils/geometry.js), rather than hand-rolling a second drag/resize
// implementation, per this task's own explicit instruction.
//
// The crop rectangle is edited in the MODAL'S OWN local pixel space (the
// displayed, uncropped image's own on-screen box, computed below from
// the item's real sourceWidth/sourceHeight) — never page mm. That's safe
// specifically because a crop is a pure ratio: dividing the committed
// rectangle by the display box's own width/height yields the exact same
// x/y/width/height FRACTIONS regardless of what pixel size the image
// happens to be displayed at, which is exactly the shape design_data.crop
// / design_renderer.py's crop_css math expect (0-1 fractions of the
// SOURCE image, see designDataAdapter.js's exportImage).
import React, { useMemo, useRef, useState } from 'react';
import { RESIZE_HANDLES, resizeRotatedBox, clampResizeToPage } from '../utils/geometry';
import { CloseIcon } from './Icons';

const MAX_STAGE_PX = 560;
const MIN_CROP_PX = 24;
const FULL_EPSILON_PX = 0.5;

function computeDisplaySize(item) {
  const sw = item.sourceWidth || item.width || 1;
  const sh = item.sourceHeight || item.height || 1;
  const scale = Math.min(MAX_STAGE_PX / sw, MAX_STAGE_PX / sh);
  return { displayWidth: sw * scale, displayHeight: sh * scale };
}

export default function CropModal({ item, onApply, onClose }) {
  const { displayWidth, displayHeight } = useMemo(() => computeDisplaySize(item), [item]);

  const initialBox = useMemo(() => {
    if (item.crop) {
      return {
        x: item.crop.x * displayWidth,
        y: item.crop.y * displayHeight,
        width: item.crop.width * displayWidth,
        height: item.crop.height * displayHeight,
      };
    }
    return { x: 0, y: 0, width: displayWidth, height: displayHeight };
  }, [item.crop, displayWidth, displayHeight]);

  const [box, setBox] = useState(initialBox);
  const bounds = { minX: 0, maxX: displayWidth, minY: 0, maxY: displayHeight };

  // Reuses resizeRotatedBox exactly as CanvasItem's own beginResize does
  // (rotation is always 0 here — a crop rectangle never rotates), then
  // clampResizeToPage against this stage's own bounds instead of the
  // page's — the same shared geometry function, a different bounds
  // object, exactly the reuse this task asked for.
  const beginResize = (e, handle) => {
    e.preventDefault();
    e.stopPropagation();
    const start = { x: box.x, y: box.y, width: box.width, height: box.height, rotation: 0 };
    const startMouse = { x: e.clientX, y: e.clientY };
    const onMove = (ev) => {
      const dx = ev.clientX - startMouse.x;
      const dy = ev.clientY - startMouse.y;
      const raw = resizeRotatedBox(start, handle, dx, dy, MIN_CROP_PX);
      const clamped = clampResizeToPage(raw, handle, bounds, MIN_CROP_PX);
      setBox({ x: clamped.x, y: clamped.y, width: clamped.width, height: clamped.height });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const beginMove = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const start = { x: box.x, y: box.y, width: box.width, height: box.height };
    const startMouse = { x: e.clientX, y: e.clientY };
    const onMove = (ev) => {
      const dx = ev.clientX - startMouse.x;
      const dy = ev.clientY - startMouse.y;
      const x = Math.min(Math.max(0, start.x + dx), displayWidth - start.width);
      const y = Math.min(Math.max(0, start.y + dy), displayHeight - start.height);
      setBox((b) => ({ ...b, x, y }));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const handleReset = () => setBox({ x: 0, y: 0, width: displayWidth, height: displayHeight });

  const handleApply = () => {
    const isFull =
      Math.abs(box.x) < FULL_EPSILON_PX &&
      Math.abs(box.y) < FULL_EPSILON_PX &&
      Math.abs(box.width - displayWidth) < FULL_EPSILON_PX &&
      Math.abs(box.height - displayHeight) < FULL_EPSILON_PX;
    if (isFull) {
      onApply(null); // no real crop — clears any existing one rather than storing a redundant full-frame rect
      return;
    }
    onApply({
      x: box.x / displayWidth,
      y: box.y / displayHeight,
      width: box.width / displayWidth,
      height: box.height / displayHeight,
    });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-actions">
        <button className="modal-btn" onClick={(e) => { e.stopPropagation(); handleReset(); }}>
          Reset
        </button>
        <button className="modal-btn" onClick={(e) => { e.stopPropagation(); handleApply(); }}>
          Apply crop
        </button>
        <button className="modal-btn" onClick={onClose}>
          Cancel <CloseIcon size={12} />
        </button>
      </div>
      <div
        className="crop-modal__stage"
        style={{ width: displayWidth, height: displayHeight }}
        onClick={(e) => e.stopPropagation()}
      >
        <img src={item.dataUrl} alt="" draggable={false} className="crop-modal__image" />
        <div
          className="crop-modal__rect"
          style={{ left: box.x, top: box.y, width: box.width, height: box.height }}
          onMouseDown={beginMove}
        >
          {RESIZE_HANDLES.map((h) => (
            <div
              key={h.key}
              className="item__resize-handle"
              style={{ left: `${h.fx * 100}%`, top: `${h.fy * 100}%`, cursor: h.cursor }}
              onMouseDown={(e) => beginResize(e, h)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
