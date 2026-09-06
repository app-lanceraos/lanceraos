import React, { createContext, useCallback, useContext, useMemo, useReducer, useRef, useState } from 'react';
import { historyReducer, initialHistoryState } from './historyReducer';
import { ELEMENT_TYPES, createContentItem } from '../data/elementCatalog';
import { createShape } from '../data/shapeCatalog';
import { validateTemplate } from '../utils/validation';
import { normalizeZOrder, appendRespectingZOrder, stepSelectionOnce } from '../utils/zorder';

const EditorStateContext = createContext(null);

export function EditorProvider({ children }) {
  const [history, dispatch] = useReducer(historyReducer, initialHistoryState);
  // Selection is intentionally NOT part of undo history — selecting things
  // isn't a content edit. `ids` are unified item ids (shape or content,
  // doesn't matter which — look up `kind` on the item itself when it
  // matters). `part` is only ever set for a single selected content item
  // whose title/body sub-part is being styled: { id, key: 'title'|'body' }.
  const [selection, setSelection] = useState({ ids: [], part: null });
  const [saveState, setSaveState] = useState({ status: 'idle', issues: [] }); // idle | saved | blocked
  // Transient, not history: which page edge(s) an in-progress drag/resize
  // is currently touching, for the edge-contact highlight. null when idle.
  const [edgeHighlight, setEdgeHighlight] = useState(null);
  // Transient, not history: smart alignment guides + live distance labels
  // + equal-spacing markers for an in-progress drag/resize (Prompt 6/14,
  // rebuilt Prompt 19 — see geometry.js's resolveAxisSnap/
  // detectEqualSpacing, driven by CanvasItem) — { vertical, horizontal,
  // labels, spacing } | null. Separate from edgeHighlight since guides
  // are item-to-item/page-center, not page-boundary.
  const [guides, setGuides] = useState(null);
  // Transient, not history: a text-bearing item's actual rendered size,
  // when it's larger than its own stored width/height (Prompt 14) — a
  // manually-set size is a MINIMUM for text, not a hard cap (see
  // CanvasItem.jsx's measurement hook), so this is what collision
  // detection reads instead of the raw stored size, keeping "no overlap"
  // true for what's actually on screen rather than the stale box a user
  // once dragged. Written by each CanvasItem instance as it measures its
  // own content (not by the item being dragged — every OTHER item's entry
  // is what a move/resize gesture reads). Keyed by item id; an item with
  // no entry (never measured, or not a growing variant) just falls back
  // to its own stored width/height at the read site.
  const [effectiveSizes, setEffectiveSizes] = useState({});
  const setEffectiveSize = useCallback((id, size) => {
    setEffectiveSizes((prev) => {
      const existing = prev[id];
      if (existing && existing.width === size.width && existing.height === size.height) return prev;
      return { ...prev, [id]: size };
    });
  }, []);
  // Transient, not history: live preview positions for items being
  // cascade-pushed by ANOTHER item's in-progress move/resize/align gesture
  // (Prompt 16) — { [id]: { x, y } }, recomputed fresh every frame from the
  // gesture's own start snapshot (never accumulated), so a pushed item's
  // own CanvasItem instance can render the shove in real time even though
  // it isn't the one being dragged. Cleared back to {} on gesture end,
  // right when the real positions get committed via updateItems.
  const [pushPreview, setPushPreview] = useState({});
  // Transient, not history: the right-click context menu (Prompt 15) —
  // { x, y } screen position, or null when closed. Deliberately just a
  // position: which actions it shows is derived fresh from whatever
  // `selection` holds at render time (right-clicking updates selection
  // first — see CanvasItem's onContextMenu — so the two never disagree).
  const [contextMenu, setContextMenu] = useState(null);
  // Prompt 22: canvas zoom is a VIEW preference, not saved document data —
  // deliberately its own plain useState, never touching `template`/
  // history, so zooming in and out is never an undo-able action and never
  // changes a single stored x/y/width/height. A percentage, clamped to a
  // sensible [25,200] range; every mouse-driven gesture divides its own
  // raw screen-pixel delta by `zoom/100` before touching page-unit data
  // (see CanvasItem.jsx/GroupSelectionOverlay.jsx/CanvasLayer.jsx).
  const [zoom, setZoomRaw] = useState(100);
  const setZoom = useCallback((value) => {
    setZoomRaw(Math.min(200, Math.max(25, Math.round(value))));
  }, []);
  // The live `.canvas-scroll` DOM node, shared via ref rather than state
  // (its dimensions/scroll position are read imperatively, on demand, by
  // EditorCanvas's own wheel-zoom handler and by Toolbar's "Fit to
  // screen" — neither needs to re-render when the OTHER touches it).
  const canvasViewportRef = useRef(null);
  // Prompt 23 item 1: whether each sidebar is collapsed — a VIEW
  // preference, same category as `zoom` above, not `template` data:
  // collapsing a panel is never an undo-able action and never touches a
  // single stored item field, so it's a plain useState independent of
  // history/commit, same reasoning as zoom's own comment.
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false);
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false);
  const toggleLeftPanel = useCallback(() => setLeftPanelCollapsed((v) => !v), []);
  const toggleRightPanel = useCallback(() => setRightPanelCollapsed((v) => !v), []);
  // Prompt 26 item 3: transient (not history) feedback that a requested
  // z-order change (drag-reorder in the layers panel, or a front/forward/
  // backward/back action from anywhere) got clamped by the shape-behind-
  // content rule — surfaced by LayersPanel regardless of which surface
  // triggered the reorder, so the rule reads as deliberate, not a bug,
  // no matter how the user tried to violate it. Auto-clears itself.
  const [zOrderClamped, setZOrderClampedRaw] = useState(false);
  const zOrderClampTimeout = useRef(null);
  const flagZOrderClamped = useCallback(() => {
    setZOrderClampedRaw(true);
    if (zOrderClampTimeout.current) clearTimeout(zOrderClampTimeout.current);
    zOrderClampTimeout.current = setTimeout(() => setZOrderClampedRaw(false), 2200);
  }, []);

  const template = history.present;

  const commit = useCallback((next) => dispatch({ type: 'COMMIT', next }), []);
  const undo = useCallback(() => dispatch({ type: 'UNDO' }), []);
  const redo = useCallback(() => dispatch({ type: 'REDO' }), []);

  const itemsById = useMemo(() => {
    const map = new Map();
    template.items.forEach((item) => map.set(item.id, item));
    return map;
  }, [template.items]);

  // ---- content item on/off (library panel) ----
  // Content types are toggled as a presence/absence concept — "on" means at
  // least one instance of that type exists. Turning on adds one fresh
  // instance at its catalog default box; turning off removes every
  // instance of that type (blocked entirely for `required` types, same
  // "can't be turned off" rule as before).

  const toggleContentItem = useCallback(
    (type) => {
      const def = ELEMENT_TYPES[type];
      const existing = template.items.filter((i) => i.kind === 'content' && i.type === type);
      if (existing.length > 0) {
        if (def.required) return; // required elements can't be removed entirely
        commit({ ...template, items: template.items.filter((i) => !existing.includes(i)) });
      } else {
        // Content always appends at the very end (top of the whole
        // stack) — never violates the shape/content rule (content is
        // never below anything by default), so a plain append is
        // already correct; appendRespectingZOrder would do the same
        // thing here, just with an unnecessary extra pass.
        commit({ ...template, items: [...template.items, createContentItem(type)] });
      }
    },
    [template, commit]
  );

  // ---- unified item actions (shape or content) ----

  const updateItem = useCallback(
    (id, patch) => {
      commit({ ...template, items: template.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) });
    },
    [template, commit]
  );

  const updateItems = useCallback(
    (ids, patchFn) => {
      commit({
        ...template,
        items: template.items.map((i) => (ids.includes(i.id) ? { ...i, ...patchFn(i) } : i)),
      });
    },
    [template, commit]
  );

  // Sub-part style (title/body) for block/qr-variant content items — kept
  // nested directly on the item alongside its flat whole-item props
  // (bgColor/borderColor/borderWidth/x/y/width/height/rotation/...).
  const updateItemPart = useCallback(
    (id, part, patch) => {
      commit({
        ...template,
        items: template.items.map((i) =>
          i.id === id ? { ...i, [part]: { ...(i[part] || {}), ...patch } } : i
        ),
      });
    },
    [template, commit]
  );

  // Deletes are blocked per-item, not per-call: a locked item never goes,
  // and a required content type can't be deleted down to zero instances
  // (deleting one of several duplicates of a required type is fine).
  const canDeleteItem = useCallback(
    (id, remainingItems) => {
      const item = itemsById.get(id);
      if (!item) return false;
      if (item.locked) return false;
      if (item.kind === 'content' && ELEMENT_TYPES[item.type]?.required) {
        const stillPresent = remainingItems.some((i) => i.kind === 'content' && i.type === item.type);
        if (!stillPresent) return false;
      }
      return true;
    },
    [itemsById]
  );

  // Prompt 25: "can any of these actually be deleted" for a whole
  // SELECTION (not just one item) — the same remaining-items snapshot
  // deleteItems itself computes (every id in the selection removed at
  // once, not one at a time — see that function's own comment on why a
  // required type's LAST TWO selected instances can't both go even
  // though either alone could), reused here so a UI affordance's
  // enabled/disabled state can never drift from what deleteItems will
  // actually do with the same ids.
  const canDeleteSelection = useCallback(
    (ids) => {
      const remaining = template.items.filter((i) => !ids.includes(i.id));
      return ids.some((id) => canDeleteItem(id, remaining));
    },
    [template, canDeleteItem]
  );

  const deleteItems = useCallback(
    (ids) => {
      const remaining = template.items.filter((i) => !ids.includes(i.id));
      const toDelete = ids.filter((id) => canDeleteItem(id, remaining));
      if (toDelete.length === 0) return;
      commit({ ...template, items: template.items.filter((i) => !toDelete.includes(i.id)) });
      setSelection({ ids: [], part: null });
    },
    [template, commit, canDeleteItem]
  );

  // Whether one optional line of a block-variant item could be removed —
  // factored out of deleteBlockLine so a UI affordance (PropertiesPanel's
  // "Delete this line" button, the Toolbar/keyboard Delete action when a
  // part happens to be selected) can ask the exact same question
  // deleteBlockLine itself will, rather than re-deriving these same
  // guard conditions a second time and risking the two drifting apart.
  const canDeleteBlockLine = useCallback(
    (itemId, lineKey) => {
      if (lineKey === 'title') return false;
      const item = itemsById.get(itemId);
      if (!item || item.kind !== 'content') return false;
      const def = ELEMENT_TYPES[item.type];
      if (def.variant !== 'block') return false;
      const line = def.render().lines.find((l) => l.key === lineKey);
      if (!line || line.required) return false;
      if ((item.hiddenLines || []).includes(lineKey)) return false;
      return true;
    },
    [itemsById]
  );

  // Removes one optional line from a block-variant item's rendered body
  // (title is never a removable line) — blocked the same way deleteItems
  // blocks a required top-level item, just at line granularity. The
  // item's currently-hidden lines are tracked as a plain list on the
  // item itself, alongside its other flat props.
  const deleteBlockLine = useCallback(
    (itemId, lineKey) => {
      if (!canDeleteBlockLine(itemId, lineKey)) return;
      const item = itemsById.get(itemId);
      const hiddenLines = [...(item.hiddenLines || []), lineKey];
      commit({ ...template, items: template.items.map((i) => (i.id === itemId ? { ...i, hiddenLines } : i)) });
      setSelection({ ids: [itemId], part: null });
    },
    [template, commit, itemsById, canDeleteBlockLine]
  );

  // Prompt 21 item 2: content items are single-instance, full stop — a
  // content item is silently excluded from duplication (never an error,
  // never a partial/confusing duplicate of just its "container") rather
  // than blocking the whole gesture, so duplicating a mixed shape+
  // content selection still duplicates the shape(s) in it. Shapes are
  // completely unaffected — this only ever narrows `source`, and only
  // when a content item is present.
  // Prompt 27: `image` items are single-instance in the same sense a
  // shape is (freely multipliable, no "one Logo only" rule) — included
  // here alongside shape, not treated like content.
  const duplicateItems = useCallback(
    (ids) => {
      const source = template.items.filter(
        (i) => ids.includes(i.id) && !i.locked && (i.kind === 'shape' || i.kind === 'image')
      );
      if (source.length === 0) return;
      const copies = source.map((i) => ({
        ...i,
        id: `${i.kind}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        x: i.x + 16,
        y: i.y + 16,
      }));
      // Prompt 26: a plain append would land these AFTER any existing
      // content in the array, i.e. rendered ON TOP of it — appending at
      // the literal end stopped being safe once render order became the
      // real array order (Prompt 26 item 3) rather than a hardcoded
      // shapes-then-content split. This inserts them just above the
      // other shapes instead, same as `addShape` below.
      commit({ ...template, items: appendRespectingZOrder(template.items, copies) });
      setSelection({ ids: copies.map((c) => c.id), part: null });
    },
    [template, commit]
  );

  // Pasting whatever was copied earlier (this session or from another
  // template) — always adds fresh instances offset slightly so they're
  // visible rather than stacked exactly on the originals. `itemsData` is
  // always an array (see clipboard.js) — a single copied item is just a
  // one-element array, and a multi-item copy pastes the WHOLE group in
  // one commit, each item getting the exact same offset so their
  // relative positions to each other are preserved (Prompt 16 item 6)
  // rather than every pasted item landing stacked on the same spot.
  // Prompt 21 item 2: content items are single-instance — filtered out
  // here too (not just at copy time), a defensive second gate since a
  // clipboard entry could be stale (copied before this rule existed, or
  // from another tab/session via the shared localStorage clipboard).
  const addItemsFromClipboard = useCallback(
    (itemsData) => {
      // Prompt 27: `image` travels through the same internal item
      // clipboard shapes already use — copy/paste is a "shape-like"
      // capability, per duplicateItems' own comment above.
      const shapesOnly = (itemsData || []).filter((d) => d.kind === 'shape' || d.kind === 'image');
      if (shapesOnly.length === 0) return;
      const stamp = Date.now();
      const pasted = shapesOnly.map((itemData, i) => ({
        ...itemData,
        id: `${itemData.kind}-${stamp}-${i}-${Math.random().toString(36).slice(2, 7)}`,
        x: itemData.x + 16,
        y: itemData.y + 16,
      }));
      // Prompt 26: see duplicateItems' own comment — pasted shapes need
      // the same z-order-respecting insertion, not a plain end-append.
      commit({ ...template, items: appendRespectingZOrder(template.items, pasted) });
      setSelection({ ids: pasted.map((p) => p.id), part: null });
    },
    [template, commit]
  );

  // ---- shape creation ----

  const addShape = useCallback(
    (type) => {
      const shape = createShape(type);
      // Prompt 26: inserted just below existing content (never a plain
      // end-append — see appendRespectingZOrder's own comment) so a new
      // shape can never accidentally render on top of content just
      // because array order is now genuine paint order.
      commit({ ...template, items: appendRespectingZOrder(template.items, [shape]) });
      setSelection({ ids: [shape.id], part: null });
    },
    [template, commit]
  );

  // Prompt 27: a third top-level kind, `image` — a user-provided picture
  // (file picker or OS clipboard paste, see ShapeLibraryPanel/
  // useKeyboardShortcuts), stored as an in-memory data URL. Explicitly
  // local-only per this prompt: no upload to any storage backend — that's
  // deferred to the real backend integration phase. `sourceWidth`/
  // `sourceHeight` are the image's TRUE decoded pixel dimensions,
  // captured once here and never touched again — CanvasItem compares the
  // item's current rendered width/height against these to drive the
  // pixelation warning as it's resized. `naturalWidth`/`naturalHeight`
  // (the DISPLAY size chosen here, capped/aspect-preserved) are the same
  // "size the box was authored at, scaled via CSS transform" convention
  // every other item already uses — unrelated to `sourceWidth/Height`,
  // which is about detecting upscaling, not rendering.
  // `allowFreeLayering: true` is what makes this the first real user of
  // Prompt 26's flag — an image can be reordered above content on
  // purpose (a "PAID" stamp, say); `appendRespectingZOrder` still
  // inserts it (via its "not a constrained shape" branch) at the very
  // end by default, since new-item-on-top is the sensible default
  // absent any other instruction, and nothing stops the layers panel
  // from moving it later anyway.
  const addImageItem = useCallback(
    (dataUrl, sourceWidth, sourceHeight) => {
      const MAX_DISPLAY_DIM = 200;
      const scale = Math.min(1, MAX_DISPLAY_DIM / Math.max(sourceWidth, sourceHeight));
      const width = Math.max(16, Math.round(sourceWidth * scale));
      const height = Math.max(16, Math.round(sourceHeight * scale));
      const item = {
        id: `image-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        kind: 'image',
        dataUrl,
        x: Math.round((template.page.width - width) / 2),
        y: Math.round((template.page.height - height) / 2),
        width,
        height,
        naturalWidth: width,
        naturalHeight: height,
        sourceWidth,
        sourceHeight,
        rotation: 0,
        allowFreeLayering: true,
        cornerRadius: 0,
      };
      commit({ ...template, items: appendRespectingZOrder(template.items, [item]) });
      setSelection({ ids: [item.id], part: null });
    },
    [template, commit]
  );

  // Prompt 26 item 2/3: moves the current SELECTION's stacking position.
  // `direction` is 'front' | 'back' | 'forward' | 'backward'. Always
  // computes the naive requested reorder first, then runs it through
  // normalizeZOrder before committing — a single shared enforcement point
  // (rather than each direction having its own bespoke clamping logic)
  // that also means the caller can tell whether the rule actually kicked
  // in (the boolean return — see LayersPanel/ContextMenu) by comparing
  // the requested vs. normalized order.
  const moveSelectionZ = useCallback(
    (ids, direction) => {
      if (!ids || ids.length === 0) return false;
      let requested;
      if (direction === 'front') {
        requested = [
          ...template.items.filter((i) => !ids.includes(i.id)),
          ...template.items.filter((i) => ids.includes(i.id)),
        ];
      } else if (direction === 'back') {
        requested = [
          ...template.items.filter((i) => ids.includes(i.id)),
          ...template.items.filter((i) => !ids.includes(i.id)),
        ];
      } else if (direction === 'forward') {
        requested = stepSelectionOnce(template.items, ids, 1);
      } else if (direction === 'backward') {
        requested = stepSelectionOnce(template.items, ids, -1);
      } else {
        return false;
      }
      const normalized = normalizeZOrder(requested);
      const wasClamped = normalized.some((item, i) => item !== requested[i]);
      if (wasClamped) flagZOrderClamped();
      commit({ ...template, items: normalized });
      return wasClamped;
    },
    [template, commit, flagZOrderClamped]
  );

  // Prompt 26 item 2: applies a full drag-to-reorder from the layers
  // panel — `backToFrontIds` is the COMPLETE desired item order (every
  // id, not just the moved one), already translated from whatever
  // front-first order the panel displays. Same normalize-then-commit
  // shape as moveSelectionZ, and the same reasoning for returning
  // whether it was clamped.
  const reorderItems = useCallback(
    (backToFrontIds) => {
      const requested = backToFrontIds.map((id) => itemsById.get(id)).filter(Boolean);
      if (requested.length !== template.items.length) return false; // stale ids — refuse rather than silently drop items
      const normalized = normalizeZOrder(requested);
      const wasClamped = normalized.some((item, i) => item !== requested[i]);
      if (wasClamped) flagZOrderClamped();
      commit({ ...template, items: normalized });
      return wasClamped;
    },
    [template, commit, itemsById, flagZOrderClamped]
  );

  // Prompt 26 item 1: locked/hidden are now settable on ANY item via the
  // layers panel (previously only ever set once, hardcoded, on the
  // footer at creation) — every OTHER place that already checks
  // `item.locked` (move/resize/rotate/delete/duplicate/group eligibility)
  // was already written generically, so toggling it here is the entire
  // fix for "locked reachable on any item," no other code needed to
  // change. Hiding also drops the item from selection — a hidden item
  // isn't rendered/selectable on canvas, so leaving it "selected" behind
  // the scenes would show its properties for something invisible.
  //
  // Prompt 31: reverses that generality for exactly one item. The footer
  // is fixed page chrome by original design (Prompt 4) — always locked,
  // always visible, no exceptions — and Prompt 30 item 2 was wrong to
  // make it toggleable. Guarded here, at the two shared mutation
  // functions themselves, rather than only in the Layers panel's UI, so
  // the rule lives in exactly one place regardless of how many surfaces
  // ever call these (today just the Layers panel, which additionally
  // disables its own buttons for this row so it LOOKS fixed, not just
  // silently ignores clicks).
  const toggleItemLocked = useCallback(
    (id) => {
      const item = itemsById.get(id);
      if (!item) return;
      if (item.type === 'footer') return;
      updateItem(id, { locked: !item.locked });
    },
    [itemsById, updateItem]
  );

  const toggleItemHidden = useCallback(
    (id) => {
      const item = itemsById.get(id);
      if (!item) return;
      if (item.type === 'footer') return;
      const hidden = !item.hidden;
      updateItem(id, { hidden });
      if (hidden) {
        setSelection((prev) => ({
          ids: prev.ids.filter((i) => i !== id),
          part: prev.part && prev.part.id === id ? null : prev.part,
        }));
      }
    },
    [itemsById, updateItem]
  );

  // Page background is a per-template value (not the global --page-bg
  // token), so different templates can each have their own page color.
  const updatePageBackground = useCallback(
    (color) => {
      commit({ ...template, page: { ...template.page, backgroundColor: color } });
    },
    [template, commit]
  );

  // Prompt 28 item 4: a shallow merge into `template.theme` — every item
  // linked to whichever slot(s) `patch` touches re-resolves and re-
  // renders on the very next paint (CanvasItem reads `template.theme`
  // directly via resolveItemTheme), with no per-item action needed. Goes
  // through the normal commit/history path, same as any other template
  // edit — a theme change is undoable like everything else.
  const updateTheme = useCallback(
    (patch) => {
      commit({ ...template, theme: { ...template.theme, ...patch } });
    },
    [template, commit]
  );

  const runSave = useCallback(() => {
    const issues = validateTemplate(template, effectiveSizes);
    const hasErrors = issues.some((i) => i.level === 'error');
    setSaveState({ status: hasErrors ? 'blocked' : 'saved', issues });
    return !hasErrors;
  }, [template, effectiveSizes]);

  const value = {
    template,
    itemsById,
    saveState,
    runSave,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    undo,
    redo,
    selection,
    setSelection,
    edgeHighlight,
    setEdgeHighlight,
    guides,
    setGuides,
    effectiveSizes,
    setEffectiveSize,
    pushPreview,
    setPushPreview,
    contextMenu,
    setContextMenu,
    zoom,
    setZoom,
    canvasViewportRef,
    leftPanelCollapsed,
    toggleLeftPanel,
    rightPanelCollapsed,
    toggleRightPanel,
    zOrderClamped,
    toggleContentItem,
    updateItem,
    updateItems,
    updateItemPart,
    deleteItems,
    canDeleteSelection,
    deleteBlockLine,
    canDeleteBlockLine,
    duplicateItems,
    addItemsFromClipboard,
    addShape,
    addImageItem,
    moveSelectionZ,
    reorderItems,
    toggleItemLocked,
    toggleItemHidden,
    updatePageBackground,
    updateTheme,
  };

  return <EditorStateContext.Provider value={value}>{children}</EditorStateContext.Provider>;
}

export function useEditor() {
  const ctx = useContext(EditorStateContext);
  if (!ctx) throw new Error('useEditor must be used within EditorProvider');
  return ctx;
}
