import React, { createContext, useCallback, useContext, useMemo, useReducer, useRef, useState } from 'react';
import api from '@/lib/api';
import { historyReducer, initialHistoryState } from './historyReducer';
import { initialTemplateState } from '../data/initialState';
import {
  ELEMENT_TYPES,
  createContentItem,
  isFreelyDuplicable,
  isBindingTakenIn,
  expandLinkedGroupSelection,
} from '../data/elementCatalog';
import { createShape } from '../data/shapeCatalog';
import { validateTemplate } from '../utils/validation';
import { templateToDesignData, designDataToTemplate } from '../adapter/designDataAdapter';
import { normalizeZOrder, appendRespectingZOrder, stepSelectionOnce } from '../utils/zorder';
import { MIN_ITEM_SIZE_MM } from '../utils/geometry';
import { roundMm } from '../utils/units';

// Phase 2a: the visible nudge applied to a duplicated/pasted item so the
// copy doesn't land exactly on top of its source (duplicateItems/
// addItemsFromClipboard below) — was a bare 16px. 16px is ~4.23mm at the
// straight conversion; retuned to a clean 4mm, a comfortably visible
// offset at any normal zoom level without being conversion-noise-precise.
const DUPLICATE_OFFSET_MM = 4;

const EditorStateContext = createContext(null);

// Backend integration: `initialTemplate`/`designId`/`designMeta` are only
// ever passed by TemplateBuilderV2 once a real GET /invoices/designs/{id}/
// has already succeeded and been converted via designDataToTemplate — this
// provider never fetches anything itself. `designId` absent (the bare
// /invoices/designs/editor-v2 sandbox route, still reachable and
// unchanged) means Save stays a purely local validation pass, exactly as
// before this integration — there is nowhere to persist to.
export function EditorProvider({ children, initialTemplate, designId = null, designMeta = null }) {
  const [history, dispatch] = useReducer(
    historyReducer,
    undefined,
    () => ({ past: [], present: initialTemplate || initialTemplateState, future: [] }),
  );
  // The exact template object reference last confirmed to match the
  // server (or, in sandbox mode, the one this session started from) —
  // `dirty` below is real reference inequality against this, not a
  // separate boolean that could itself drift out of sync. Updated after
  // the initial load, after every successful real save, and after a
  // version restore (all three are "the canvas now matches something
  // real and already-persisted").
  const savedSnapshotRef = useRef(initialTemplate || initialTemplateState);
  // Design metadata from the real GET this session loaded — name/
  // base_template/color_variant are all real InvoiceDesign columns the v2
  // editor has no UI to change; they're carried through unedited on every
  // real PUT so a no-op round trip touches none of them.
  const [meta] = useState(designMeta);
  const [versions, setVersions] = useState([]);
  // Selection is intentionally NOT part of undo history — selecting things
  // isn't a content edit. `ids` are unified item ids (shape or content,
  // doesn't matter which — look up `kind` on the item itself when it
  // matters). `part` is only ever set for a single selected content item
  // whose title/body sub-part is being styled: { id, key: 'title'|'body' }.
  const [selection, setSelectionRaw] = useState({ ids: [], part: null });
  // idle | saving | saved | blocked (client-side validation errors) |
  // error (server rejected the save, or the request itself failed) —
  // `message`, when present, is a real user-facing string for the
  // `error` status (a generic server/network message, since specific
  // server-side validation failures are already represented as their own
  // `error`-level entries in `issues` instead).
  const [saveState, setSaveState] = useState({ status: 'idle', issues: [] });
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

  // Real image upload — a per-item, transient (not history) status for
  // the background upload every newly-added image item now kicks off:
  // 'uploading' | 'error' | absent (settled: either it finished — the
  // item's own `dataUrl` is already the real Cloudinary URL by then, see
  // uploadImageForItem below — or it was never a real upload to begin
  // with, e.g. an item restored from a saved design that already carries
  // a real URL). Deliberately outside `template`/history, same category
  // as `effectiveSizes`/`pushPreview` above — this is infrastructure
  // catching up to something the user already did, not a new edit of
  // its own.
  const [imageUploads, setImageUploads] = useState({});
  // Always-current template, read by uploadImageForItem's async
  // callback — that callback can resolve long after the render that
  // started it, so closing over `template` directly would risk
  // clobbering every edit made in between with a stale snapshot.
  const templateRef = useRef(template);
  templateRef.current = template;
  // The real File object behind each in-flight/failed upload, keyed by
  // item id — kept in a ref (never triggers a render on its own) purely
  // so retryImageUpload can re-send the exact same bytes without asking
  // the caller to hand the File back a second time (the properties
  // panel/canvas retry affordance only knows the item id).
  const pendingFilesRef = useRef({});

  // Uploads one image item's real file to the design-image endpoint and,
  // on success, silently swaps that item's `dataUrl` from the local
  // `data:` URI to the real returned `secure_url` — `exportImage`
  // (designDataAdapter.js) needs no change since it already just reads
  // `item.dataUrl` directly. On failure, leaves `dataUrl` exactly as it
  // was (the local preview keeps working) and flags 'error' so the
  // canvas can offer a retry — calling this again with the same
  // (itemId, file) is exactly that retry.
  const uploadImageForItem = useCallback((itemId, file) => {
    pendingFilesRef.current[itemId] = file;
    setImageUploads((prev) => ({ ...prev, [itemId]: 'uploading' }));
    const formData = new FormData();
    formData.append('image', file);
    api
      .post('/invoices/designs/upload-image/', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      .then(({ data }) => {
        const current = templateRef.current;
        dispatch({
          type: 'SILENT_PATCH',
          next: {
            ...current,
            items: current.items.map((i) => (i.id === itemId ? { ...i, dataUrl: data.secure_url } : i)),
          },
        });
        delete pendingFilesRef.current[itemId];
        setImageUploads((prev) => {
          const next = { ...prev };
          delete next[itemId];
          return next;
        });
      })
      .catch(() => {
        setImageUploads((prev) => ({ ...prev, [itemId]: 'error' }));
      });
  }, []);

  // Retries an item's upload using the exact same File this session
  // already has in hand (pendingFilesRef) — a no-op if that item was
  // never a real pending upload (e.g. stale id, or a double-click on the
  // retry affordance racing its own success).
  const retryImageUpload = useCallback((itemId) => {
    const file = pendingFilesRef.current[itemId];
    if (!file) return;
    uploadImageForItem(itemId, file);
  }, [uploadImageForItem]);

  // Every consumer in this app reaches selection-setting through this one
  // wrapper (exposed below as `setSelection`, same name/shape as before —
  // no call site elsewhere needed to change) so the signature trio's
  // "always select/transform together" rule (elementCatalog.js's
  // expandLinkedGroupSelection) is enforced at the single real choke point
  // selection ever passes through, accepting the exact same object-or-
  // updater-function argument the raw setState already did.
  const setSelection = useCallback(
    (update) => {
      setSelectionRaw((prev) => {
        const next = typeof update === 'function' ? update(prev) : update;
        if (!next || !next.ids) return next;
        const expandedIds = expandLinkedGroupSelection(next.ids, template.items);
        return expandedIds === next.ids ? next : { ...next, ids: expandedIds };
      });
    },
    [template.items]
  );

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
      // Insert-palette rework: a multiInstance type (customText) has no
      // "on/off" concept — presence/absence stopped being a meaningful
      // question the moment more than one instance became possible.
      // ElementLibraryPanel no longer even renders a toggle for these
      // (it calls insertContentItem instead) — this guard is a defensive
      // second gate in case some other future caller reaches for the
      // wrong function.
      if (def.multiInstance) return;
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

  // Insert-palette counterpart to toggleContentItem, for multiInstance
  // types only — always adds a genuinely NEW instance (never toggles an
  // existing one off), same "always insert" behavior addShape already
  // has. `overrides` lets a caller (a future paste/import path, or a
  // test) hand-place the new item instead of taking its catalog default
  // box — see elementCatalog.js's createContentItem for what's accepted.
  const insertContentItem = useCallback(
    (type, overrides) => {
      const def = ELEMENT_TYPES[type];
      if (!def?.multiInstance) return null; // singleton types go through toggleContentItem instead
      const item = createContentItem(type, overrides);
      commit({ ...template, items: [...template.items, item] });
      setSelection({ ids: [item.id], part: null });
      return item;
    },
    [template, commit]
  );

  // ---- text binding (split instance rule) ----
  //
  // Whether `binding` is available to assign to `excludeItemId` right
  // now — false only when a DIFFERENT customText item already carries
  // this exact binding value. Unbound (binding falsy) is never "taken" —
  // unlimited static-text instances is the entire point of this type;
  // only the BOUND half of the split instance rule is single-instance.
  // Scoped to `type === 'customText'` specifically (not "any content
  // item with a binding field") — the original fixed catalog types
  // (businessName, invoiceNumber, issueDate, dueDate, ...) already
  // enforce their own single-instance-per-TYPE rule via
  // toggleContentItem/ELEMENT_TYPES[type].required and don't carry an
  // item.binding field at all; unifying the two mechanisms is a real,
  // separate, larger change (not attempted here — see this prompt's own
  // report for the explicit scope note).
  const isBindingTaken = useCallback(
    (binding, excludeItemId) => isBindingTakenIn(template.items, binding, excludeItemId),
    [template]
  );

  // ---- unified item actions (shape or content) ----
  // Real-backend-integration fix: these two were declared BELOW
  // setItemBinding below despite setItemBinding referencing `updateItem`
  // both in its own body and its useCallback dependency array — a
  // genuine pre-existing `const` temporal-dead-zone bug (evaluating that
  // dependency array reads `updateItem` before its own `const` runs),
  // confirmed live: it threw "Cannot access 'updateItem' before
  // initialization" and crashed the whole EditorProvider the moment this
  // editor was actually opened in a real browser for the first time (this
  // route was never live-browser-tested before this integration pass —
  // every existing automated test mocks or never reaches this far).
  // Moved above setItemBinding, unchanged otherwise.
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

  // Returns true on success, false when the binding is already taken by
  // another item (the caller — PropertiesPanel's binding picker — is
  // responsible for surfacing that as a real, visible message; this
  // function itself just refuses the write rather than silently letting
  // two items share a binding). Clearing a binding (binding falsy) always
  // succeeds and hands the item back a real, empty editable `text` field.
  const setItemBinding = useCallback(
    (itemId, binding) => {
      if (binding) {
        if (isBindingTaken(binding, itemId)) return false;
        updateItem(itemId, { binding, text: undefined });
        return true;
      }
      updateItem(itemId, { binding: null, text: itemsById.get(itemId)?.text || '' });
      return true;
    },
    [isBindingTaken, updateItem, itemsById]
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
  // (text/bindings prompt): a multiInstance, UNBOUND content item
  // (customText with no binding) joins that same freely-multipliable set
  // — see elementCatalog.js's isFreelyDuplicable for the full reasoning,
  // including why a BOUND customText item stays excluded (single-instance
  // per binding).
  const duplicateItems = useCallback(
    (ids) => {
      const source = template.items.filter((i) => ids.includes(i.id) && !i.locked && isFreelyDuplicable(i));
      if (source.length === 0) return;
      const copies = source.map((i) => ({
        ...i,
        id: `${i.kind}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        x: i.x + DUPLICATE_OFFSET_MM,
        y: i.y + DUPLICATE_OFFSET_MM,
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
      // capability, per duplicateItems' own comment above. (text/bindings
      // prompt): an unbound multiInstance content item joins the same
      // set, same isFreelyDuplicable reasoning as duplicateItems.
      const shapesOnly = (itemsData || []).filter(isFreelyDuplicable);
      if (shapesOnly.length === 0) return;
      const stamp = Date.now();
      const pasted = shapesOnly.map((itemData, i) => ({
        ...itemData,
        id: `${itemData.kind}-${stamp}-${i}-${Math.random().toString(36).slice(2, 7)}`,
        x: itemData.x + DUPLICATE_OFFSET_MM,
        y: itemData.y + DUPLICATE_OFFSET_MM,
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
  // Real image upload: `file` (added this pass) is the actual browser
  // File behind `dataUrl` (a file-picker File, or a Blob reconstructed
  // from an OS clipboard paste — both are real File/Blob instances
  // FormData can send directly) — when present, a real background
  // upload to POST /invoices/designs/upload-image/ starts immediately
  // after the item is created, so the local data: URI this function has
  // always used for instant canvas feedback gets replaced with the real
  // Cloudinary secure_url the moment it's ready (uploadImageForItem
  // above), rather than staying a data: URI (and getting exported/saved
  // as one — designDataAdapter.js's own exportImage warning) forever.
  // `file` stays optional so a caller with no real File (there is none
  // today, but nothing forces every future caller to have one) still
  // gets exactly the old local-only behavior.
  const addImageItem = useCallback(
    (dataUrl, sourceWidth, sourceHeight, file) => {
      // Phase 2a: `sourceWidth`/`sourceHeight` stay real image PIXELS
      // (they always were, and always will be — see this function's own
      // comment above on what they're actually for), but the display cap
      // this scale is computed against now needs to land in mm, not px —
      // was a bare 200 (page-unit == px, before this pass). Retuned to a
      // clean 50mm (a sensible max initial size for a pasted image on an
      // invoice page) rather than the raw conversion's 52.92mm — this is
      // a UX default, not a precision-sensitive constant.
      const MAX_DISPLAY_DIM_MM = 50;
      const scale = Math.min(1, MAX_DISPLAY_DIM_MM / Math.max(sourceWidth, sourceHeight));
      const width = Math.max(MIN_ITEM_SIZE_MM, roundMm(sourceWidth * scale));
      const height = Math.max(MIN_ITEM_SIZE_MM, roundMm(sourceHeight * scale));
      const item = {
        id: `image-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        kind: 'image',
        dataUrl,
        x: roundMm((template.page.width - width) / 2),
        y: roundMm((template.page.height - height) / 2),
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
      if (file) uploadImageForItem(item.id, file);
      return item;
    },
    [template, commit, uploadImageForItem]
  );

  // Real crop UI: commits `item.crop` (fractions 0-1 of the source
  // image's own sourceWidth/sourceHeight, exactly what design_data.crop
  // and design_renderer.py's own crop_css math already expect — see
  // designDataAdapter.js's exportImage) — `null` clears it back to
  // uncropped, same as any other optional-field clear elsewhere in this
  // file. A genuine user content edit, so this goes through the normal
  // updateItem -> commit -> history path, unlike the silent upload-URL
  // swap above.
  const setItemCrop = useCallback(
    (itemId, crop) => updateItem(itemId, { crop }),
    [updateItem]
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
  // Phase 3c: a template imported from a real production design_data
  // that omitted `page.background_color` entirely (e.g. Modern, which
  // relies on the renderer's own default) carries
  // `page._backgroundColorExplicit === false` so the adapter's own
  // export can omit the key again, byte-for-byte, on an untouched
  // re-save (see designDataAdapter.js's templateToDesignData). The
  // instant a user actually picks a color here, that byte-for-byte
  // omission is no longer what they want — flip the flag true so it
  // exports explicitly from now on.
  const updatePageBackground = useCallback(
    (color) => {
      commit({ ...template, page: { ...template.page, backgroundColor: color, _backgroundColorExplicit: true } });
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

  // Real backend save. Client-side validation (validateTemplate) always
  // runs first and is authoritative for blocking — an `error`-level issue
  // stops the save outright (status: 'blocked'), matching this app's
  // existing pre-integration behavior exactly; a `warning`-level issue is
  // shown but never blocks, also unchanged. Only once that local check
  // passes does this actually reach the network — with no `designId`
  // (the bare sandbox route) there is nothing to PUT to, so it stops
  // there too, exactly as before this integration (status: 'saved',
  // purely local).
  const runSave = useCallback(async () => {
    // Real image upload: refuse to save (and, critically, to export/PUT
    // whatever `dataUrl` an in-flight item currently holds) while any
    // image is still mid-upload — that item's real Cloudinary URL isn't
    // known yet, so a save started right now would persist the throwaway
    // local data: URI as if it were final. A settled 'error' state does
    // NOT block (its dataUrl is still the perfectly valid local preview —
    // the user can retry the upload later, or just save with the local
    // preview if they don't care about that specific asset being
    // permanent), matching this function's own existing "client-side
    // issues block, nothing else does" shape.
    if (Object.values(imageUploads).some((status) => status === 'uploading')) {
      setSaveState({
        status: 'blocked',
        issues: [{ level: 'error', message: 'An image is still uploading — wait a moment and try again.' }],
      });
      return false;
    }
    const issues = validateTemplate(template, effectiveSizes);
    const hasErrors = issues.some((i) => i.level === 'error');
    if (hasErrors) {
      setSaveState({ status: 'blocked', issues });
      return false;
    }
    if (!designId) {
      setSaveState({ status: 'saved', issues });
      return true;
    }

    setSaveState({ status: 'saving', issues });
    const { designData, warnings } = templateToDesignData(template);
    const exportIssues = warnings.map((w) => ({ level: 'warning', message: w }));
    try {
      await api.put(`/invoices/designs/${designId}/`, {
        name: meta?.name,
        base_template: meta?.base_template,
        color_variant: meta?.color_variant || '',
        design_data: designData,
      });
      savedSnapshotRef.current = template;
      setSaveState({ status: 'saved', issues: [...issues, ...exportIssues] });
      return true;
    } catch (err) {
      // InvoiceDesignSerializer.validate_design_data raises a plain list
      // of specific violation strings, which DRF surfaces as
      // {"design_data": ["...", "..."]} — the real, specific messages a
      // v2-shape payload could still fail on server-side (this adapter is
      // verified round-trip-correct for real builtin seeds, but a
      // hand-edited canvas is real new input the server has never seen).
      const serverDesignDataErrors = err.response?.data?.design_data;
      const serverErrors = Array.isArray(serverDesignDataErrors)
        ? serverDesignDataErrors.map((m) => ({ level: 'error', message: String(m) }))
        : [];
      const message = serverErrors.length
        ? null
        : err.response
          ? 'The server rejected this save. Please try again.'
          : 'Could not reach the server. Check your connection and try again.';
      setSaveState({
        status: 'error',
        issues: [...issues, ...exportIssues, ...serverErrors],
        message,
      });
      return false;
    }
  }, [template, effectiveSizes, designId, meta, imageUploads]);

  // Version history — real GET/POST against
  // apps.invoices.views.design_versions_list/design_version_restore.
  // Meaningless (and never called) without a real designId.
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [restoringVersionId, setRestoringVersionId] = useState(null);
  const [versionsError, setVersionsError] = useState(null);

  const fetchVersions = useCallback(async () => {
    if (!designId) return;
    setVersionsLoading(true);
    setVersionsError(null);
    try {
      const { data } = await api.get(`/invoices/designs/${designId}/versions/`);
      setVersions(data);
    } catch {
      setVersionsError('Could not load version history right now.');
    } finally {
      setVersionsLoading(false);
    }
  }, [designId]);

  // design_version_restore is non-destructive on the server (confirmed
  // directly in apps/invoices/views.py: it copies the chosen version's
  // design_data onto the live row and saves, which itself creates a NEW
  // version for the restored content via InvoiceDesign's own
  // _create_version_if_content_changed — so restoring never deletes or
  // overwrites history, "undo the restore" is just restoring whichever
  // version came right before it, and the version list only ever grows).
  const restoreVersion = useCallback(
    async (versionId) => {
      if (!designId) return false;
      setRestoringVersionId(versionId);
      setVersionsError(null);
      try {
        const { data } = await api.post(`/invoices/designs/${designId}/versions/${versionId}/restore/`);
        const { template: restored } = designDataToTemplate(data.design_data);
        dispatch({ type: 'LOAD', template: restored });
        savedSnapshotRef.current = restored;
        setSelection({ ids: [], part: null });
        setSaveState({ status: 'idle', issues: [] });
        await fetchVersions();
        return true;
      } catch {
        setVersionsError('Could not restore this version right now.');
        return false;
      } finally {
        setRestoringVersionId(null);
      }
    },
    [designId, fetchVersions]
  );

  const value = {
    template,
    itemsById,
    saveState,
    runSave,
    designId,
    designMeta: meta,
    dirty: template !== savedSnapshotRef.current,
    versions,
    versionsLoading,
    versionsError,
    restoringVersionId,
    fetchVersions,
    restoreVersion,
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
    insertContentItem,
    isBindingTaken,
    setItemBinding,
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
    imageUploads,
    retryImageUpload,
    setItemCrop,
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
