import React, { useState } from 'react';
import { useEditor } from '../../state/EditorContext';
import { ELEMENT_TYPES } from '../../data/elementCatalog';
import { SHAPE_TYPES } from '../../data/shapeCatalog';
import { EyeIcon, EyeOffIcon, LockIcon, UnlockIcon } from '../Icons';
import Tooltip from '../Tooltip';

// Prompt 26 item 2: every item's display label — the catalog's own name
// for content (single-instance per type, so it's already unambiguous),
// disambiguated with a running number for shapes/images (a page can have
// several of the same shape type, or several uploaded pictures — Prompt
// 27). Numbering is stable against the item's own position among same-
// group peers in `template.items` (back-to-front array order), not
// against however the panel currently displays them — reordering
// unrelated items never renumbers a shape or image.
function baseLabel(item) {
  if (item.kind === 'shape') return SHAPE_TYPES[item.type]?.label || item.type;
  if (item.kind === 'image') return 'Image';
  return ELEMENT_TYPES[item.type]?.label || item.type;
}

// A grouping key for the "how many of this exact thing exist" count —
// every image shares one group ('image', no per-type split the way
// shapes have roundedRect/ellipse/line), a shape groups by its own type.
function numberingGroup(item) {
  if (item.kind === 'shape') return `shape:${item.type}`;
  if (item.kind === 'image') return 'image';
  return null; // content: never numbered, single-instance per type already
}

function computeLabels(items) {
  const totalByGroup = {};
  items.forEach((item) => {
    const g = numberingGroup(item);
    if (g) totalByGroup[g] = (totalByGroup[g] || 0) + 1;
  });
  const runningByGroup = {};
  const labels = new Map();
  items.forEach((item) => {
    const g = numberingGroup(item);
    if (g) {
      runningByGroup[g] = (runningByGroup[g] || 0) + 1;
      labels.set(item.id, totalByGroup[g] > 1 ? `${baseLabel(item)} ${runningByGroup[g]}` : baseLabel(item));
    } else {
      labels.set(item.id, baseLabel(item));
    }
  });
  return labels;
}

export default function LayersPanel() {
  const { template, selection, setSelection, moveSelectionZ, reorderItems, toggleItemLocked, toggleItemHidden, zOrderClamped } =
    useEditor();
  const [dragId, setDragId] = useState(null);
  const [overId, setOverId] = useState(null);

  const labels = computeLabels(template.items);
  // Displayed front-most first (Prompt 26 item 2's own spec) — the
  // reverse of `template.items`' back-to-front storage/paint order.
  const frontFirst = [...template.items].reverse();

  const selectItem = (e, id) => {
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      setSelection((prev) => ({
        ids: prev.ids.includes(id) ? prev.ids.filter((x) => x !== id) : [...prev.ids, id],
        part: null,
      }));
    } else {
      setSelection({ ids: [id], part: null });
    }
  };

  // Drop `dragId` immediately before `targetId` in the FRONT-FIRST
  // display order, then hand the reversed (back-to-front) result to
  // EditorContext — which runs it through the same normalizeZOrder every
  // other reorder path uses, so a shape dropped above content clamps
  // back below it exactly the same way Bring to Front etc. already do.
  const handleDrop = (targetId) => {
    if (!dragId || dragId === targetId) {
      setDragId(null);
      setOverId(null);
      return;
    }
    const frontIds = frontFirst.map((i) => i.id);
    const withoutDragged = frontIds.filter((id) => id !== dragId);
    const targetIdx = withoutDragged.indexOf(targetId);
    withoutDragged.splice(targetIdx, 0, dragId);
    reorderItems([...withoutDragged].reverse());
    setDragId(null);
    setOverId(null);
  };

  return (
    <>
      <div className="panel__section-title">Layers</div>
      {zOrderClamped && (
        <p className="layers-clamp-hint">Shapes always render behind content — position clamped.</p>
      )}
      {frontFirst.length === 0 && <p className="empty-hint">Nothing on the canvas yet.</p>}
      <div className="layers-list">
        {frontFirst.map((item) => {
          const isSelected = selection.ids.includes(item.id);
          // Prompt 32 item 1 (revises Prompt 31's disabled-buttons take):
          // the footer is permanently locked/visible (fixed page chrome,
          // Prompt 4) — its row shows NO lock/eye controls at all, rather
          // than a disabled pair. EditorContext's toggleItemLocked/
          // toggleItemHidden still guard `type === 'footer'` regardless,
          // so this is purely about what the row displays.
          const isFooter = item.type === 'footer';
          return (
            <div
              key={item.id}
              className={`layer-row${isSelected ? ' layer-row--selected' : ''}${overId === item.id ? ' layer-row--over' : ''}${item.hidden ? ' layer-row--hidden' : ''}`}
              draggable
              onDragStart={() => setDragId(item.id)}
              onDragOver={(e) => {
                e.preventDefault();
                if (overId !== item.id) setOverId(item.id);
              }}
              onDragLeave={() => setOverId((prev) => (prev === item.id ? null : prev))}
              onDrop={() => handleDrop(item.id)}
              onDragEnd={() => {
                setDragId(null);
                setOverId(null);
              }}
              onClick={(e) => selectItem(e, item.id)}
            >
              <span className={`layer-row__kind layer-row__kind--${item.kind}`} aria-hidden="true" />
              <Tooltip label={labels.get(item.id)} className="tooltip-wrap--flex-fill">
                <span className="layer-row__label">{labels.get(item.id)}</span>
              </Tooltip>
              {!isFooter && (
                <Tooltip label={item.hidden ? 'Show' : 'Hide'}>
                  <button
                    type="button"
                    className="layer-row__icon-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleItemHidden(item.id);
                    }}
                    aria-label={item.hidden ? 'Show layer' : 'Hide layer'}
                  >
                    {item.hidden ? <EyeOffIcon /> : <EyeIcon />}
                  </button>
                </Tooltip>
              )}
              {!isFooter && (
                <Tooltip label={item.locked ? 'Unlock' : 'Lock'}>
                  <button
                    type="button"
                    className="layer-row__icon-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleItemLocked(item.id);
                    }}
                    aria-label={item.locked ? 'Unlock layer' : 'Lock layer'}
                  >
                    {item.locked ? <LockIcon /> : <UnlockIcon />}
                  </button>
                </Tooltip>
              )}
            </div>
          );
        })}
      </div>
      {selection.ids.length > 0 && (
        <div className="align-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)', marginTop: 10 }}>
          <button className="tbtn" onClick={() => moveSelectionZ(selection.ids, 'front')}>Bring to Front</button>
          <button className="tbtn" onClick={() => moveSelectionZ(selection.ids, 'forward')}>Bring Forward</button>
          <button className="tbtn" onClick={() => moveSelectionZ(selection.ids, 'backward')}>Send Backward</button>
          <button className="tbtn" onClick={() => moveSelectionZ(selection.ids, 'back')}>Send to Back</button>
        </div>
      )}
    </>
  );
}
