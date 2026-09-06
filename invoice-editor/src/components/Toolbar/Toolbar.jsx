import React from 'react';
import { useEditor } from '../../state/EditorContext';
import { LogoSVG, WordmarkSVG } from '../Brand';

export default function Toolbar({ onPreview }) {
  const {
    canUndo, canRedo, undo, redo, runSave,
    template, selection, deleteItems, canDeleteSelection, deleteBlockLine, canDeleteBlockLine,
    duplicateItems, groupItems,
    zoom, setZoom, canvasViewportRef,
  } = useEditor();

  // Prompt 22 item 4: fits `template.page.width/height` into whatever the
  // canvas viewport currently measures, whichever axis is more
  // constraining, with a fixed margin so the page never touches the
  // viewport edges exactly.
  const fitToScreen = () => {
    const vp = canvasViewportRef.current;
    if (!vp) return;
    const margin = 48;
    const availW = Math.max(50, vp.clientWidth - margin * 2);
    const availH = Math.max(50, vp.clientHeight - margin * 2);
    const fit = Math.min(availW / template.page.width, availH / template.page.height);
    setZoom(fit * 100);
  };
  const ZOOM_PRESETS = [50, 75, 100, 125, 150, 200];

  // Prompt 25: mirrors handleDelete's own branching below — a single
  // selected sub-part's own line-level deletability when one is selected,
  // otherwise whether ANY item in the whole selection would actually be
  // removed (a required/locked item, or a mixed selection made entirely
  // of them, must show as disabled here rather than clickable-but-inert).
  const canDelete =
    selection.part && selection.ids.length === 1
      ? canDeleteBlockLine(selection.ids[0], selection.part.key)
      : canDeleteSelection(selection.ids);
  const canGroup = selection.ids.length >= 2;
  // Prompt 21 item 2: content items are single-instance and can't be
  // duplicated — reflect that in the button's own enabled state (rather
  // than leaving it clickable-but-a-no-op) the same way ContextMenu's
  // equivalent check does; a mixed shape+content selection still enables
  // it, since duplicateItems already only acts on the shape(s)/image(s)
  // in it. Prompt 27: `image` is shape-like here too (freely
  // multipliable, no single-instance rule).
  const canDuplicate = selection.ids.some((id) => {
    const item = template.items.find((i) => i.id === id);
    return item && (item.kind === 'shape' || item.kind === 'image') && !item.locked;
  });

  const handleDelete = () => {
    if (selection.part && selection.ids.length === 1) {
      deleteBlockLine(selection.ids[0], selection.part.key);
    } else {
      deleteItems(selection.ids);
    }
  };

  return (
    <div className="toolbar">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginRight: 12 }}>
        <LogoSVG size={22} />
        <WordmarkSVG width={107} height={16} />
      </div>

      <button className="tbtn" disabled={!canUndo} onClick={undo}>
        Undo <span className="tbtn__key">⌘Z</span>
      </button>
      <button className="tbtn" disabled={!canRedo} onClick={redo}>
        Redo <span className="tbtn__key">⌘Y</span>
      </button>

      <button className="tbtn" disabled={!canGroup} onClick={() => groupItems(selection.ids)}>
        Group <span className="tbtn__key">⌘G</span>
      </button>

      <button className="tbtn" disabled={!canDuplicate} onClick={() => duplicateItems(selection.ids)}>
        Duplicate <span className="tbtn__key">⌘D</span>
      </button>

      <button className="tbtn" disabled={!canDelete} onClick={handleDelete}>
        Delete <span className="tbtn__key">Del</span>
      </button>

      <div className="toolbar__spacer" />

      {/* Prompt 22 item 1: zoom is a view preference (EditorContext's own
          `zoom` state, never `template`) — +/- step by 10, clamped to
          [25,200] by setZoom itself; the dropdown offers the common
          preset stops plus whatever odd value trackpad/wheel zoom (or
          Fit) last landed on, so the display is never out of sync with
          the actual live zoom level. */}
      <div className="zoom-controls">
        <button className="tbtn" onClick={() => setZoom(zoom - 10)} aria-label="Zoom out">−</button>
        <select className="zoom-select" value={zoom} onChange={(e) => setZoom(Number(e.target.value))}>
          {!ZOOM_PRESETS.includes(zoom) && <option value={zoom}>{zoom}%</option>}
          {ZOOM_PRESETS.map((z) => (
            <option key={z} value={z}>{z}%</option>
          ))}
        </select>
        <button className="tbtn" onClick={() => setZoom(zoom + 10)} aria-label="Zoom in">+</button>
        <button className="tbtn" onClick={fitToScreen}>Fit</button>
      </div>

      <button className="tbtn" onClick={onPreview}>
        Preview <span className="tbtn__key">P</span>
      </button>
      <button className="tbtn tbtn--primary" onClick={runSave}>
        Save <span className="tbtn__key" style={{ borderColor: 'rgba(255,255,255,0.3)', color: 'rgba(255,255,255,0.8)' }}>⌘S</span>
      </button>
    </div>
  );
}
