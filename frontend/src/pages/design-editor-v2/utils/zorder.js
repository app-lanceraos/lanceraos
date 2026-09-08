// Prompt 26: the single place that encodes "an ordinary shape never
// renders above content" — every entry point that changes item order
// (item creation, drag-reorder in the layers panel, front/forward/
// backward/back) funnels through this, so the rule can't be silently
// bypassed by a future mutation that forgets to check it. An item with
// `allowFreeLayering: true` (nothing sets this yet — see elementCatalog/
// shapeCatalog — it's here so Prompt 27's image kind can opt in without
// touching this file again) is exempt entirely: it can sit anywhere in
// the stack, including above content.
//
// `items` is always `template.items` in back-to-front paint order (index
// 0 renders first/behind, last index renders last/in front) — the same
// order CanvasLayer now renders directly, single pass, no more hardcoded
// shape-then-content grouping.

export function isConstrainedShape(item) {
  return item.kind === 'shape' && !item.allowFreeLayering;
}

// Deliberately "not a constrained shape" rather than "kind === 'content'"
// — any future kind that doesn't explicitly opt into allowFreeLayering
// defaults to behaving like content (rendered above ordinary shapes),
// matching this prompt's framing that today's two kinds "both keep the
// current hard rule" until a kind deliberately opts out.
export function isConstrainedNonShape(item) {
  return item.kind !== 'shape' && !item.allowFreeLayering;
}

// Re-sorts ONLY the constrained items (shapes before non-shapes),
// preserving each group's own relative order, while leaving every
// allowFreeLayering item exactly where it already was — a constrained
// item only ever moves into a slot another constrained item vacated, so
// this can't disturb a free item's arbitrary position. Returns the same
// array reference when nothing needed fixing (cheap no-op check for
// callers that want to know whether a requested reorder got clamped).
export function normalizeZOrder(items) {
  const constrainedIdx = [];
  items.forEach((item, idx) => {
    if (!item.allowFreeLayering) constrainedIdx.push(idx);
  });
  const constrainedItems = constrainedIdx.map((idx) => items[idx]);
  const fixed = [
    ...constrainedItems.filter(isConstrainedShape),
    ...constrainedItems.filter((i) => !isConstrainedShape(i)),
  ];
  const changed = fixed.some((item, i) => item !== constrainedItems[i]);
  if (!changed) return items;
  const result = [...items];
  constrainedIdx.forEach((idx, i) => {
    result[idx] = fixed[i];
  });
  return result;
}

// Inserts freshly-created items into `items`, respecting the same
// invariant — used by addShape/duplicateItems/paste so a brand-new shape
// can't land above existing content just because it was appended at the
// array's literal end. Non-shape (or free-layering) new items still just
// append at the very end — "new stuff appears on top" is the sensible
// default everywhere the shape/content rule doesn't force otherwise.
export function appendRespectingZOrder(items, newItems) {
  const shapesToInsert = newItems.filter(isConstrainedShape);
  const restToAppend = newItems.filter((i) => !isConstrainedShape(i));
  if (shapesToInsert.length === 0) return [...items, ...restToAppend];
  const firstContentIdx = items.findIndex(isConstrainedNonShape);
  if (firstContentIdx === -1) return [...items, ...shapesToInsert, ...restToAppend];
  return [
    ...items.slice(0, firstContentIdx),
    ...shapesToInsert,
    ...items.slice(firstContentIdx),
    ...restToAppend,
  ];
}

// Moves every id in `ids` one slot toward the front (dir=1) or back
// (dir=-1). Processing the frontmost-first for dir>0 (and backmost-first
// for dir<0) lets a multi-item selection each advance by exactly one
// slot without two selected items swapping past each other or fighting
// over the same target slot.
export function stepSelectionOnce(items, ids, dir) {
  const idSet = new Set(ids);
  const arr = [...items];
  const order = arr.map((_, i) => i);
  if (dir > 0) order.reverse();
  order.forEach((i) => {
    if (!idSet.has(arr[i].id)) return;
    const j = i + dir;
    if (j < 0 || j >= arr.length) return;
    if (idSet.has(arr[j].id)) return; // neighbor already part of the block
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  });
  return arr;
}
