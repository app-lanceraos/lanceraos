// Tests for the pure `expandLinkedGroupSelection` helper itself — the
// signature trio's grouped-MOVE-only mechanism (Part 7; see
// elementCatalog.js's own comment above SIGNATURE_GROUP_TYPES for the
// current "why"). This function's own id-expansion behavior is unchanged
// from when it originally backed a fuller (selection-wide) lock — what
// changed is WHERE it's called: only CanvasItem.jsx's beginMove calls it
// now, locally, scoped to one drag gesture's own groupMembers
// computation, gated on the dragged item itself being a signature part —
// never EditorContext.jsx's setSelection (now a plain passthrough, so
// clicking one part selects only that part). These tests exercise the
// helper's own pure logic independent of React, matching this repo's own
// established pure-function test convention (see elementCatalog.customText.test.js).
import { test, describe } from 'vitest';
import assert from 'node:assert/strict';

import { createContentItem, expandLinkedGroupSelection, SIGNATURE_GROUP_TYPES } from './elementCatalog.js';

function makeTrio() {
  const image = createContentItem('signatureImage');
  const divider = createContentItem('signatureDivider');
  const label = createContentItem('signatureLabel');
  return { image, divider, label, items: [image, divider, label] };
}

describe('expandLinkedGroupSelection: pure id-expansion helper backing the signature trio\'s grouped move', () => {
  test('selecting just one signature part expands to every other PRESENT part', () => {
    const { image, divider, label, items } = makeTrio();
    const expanded = expandLinkedGroupSelection([image.id], items);
    assert.deepEqual(new Set(expanded), new Set([image.id, divider.id, label.id]));
  });

  test('a selection with no signature member is left completely untouched (same array reference)', () => {
    const other = createContentItem('businessName');
    const ids = [other.id];
    const expanded = expandLinkedGroupSelection(ids, [other]);
    assert.equal(expanded, ids); // same reference — a true no-op, not just an equal array
  });

  test('an already-fully-expanded selection is a no-op (same array reference)', () => {
    const { image, divider, label, items } = makeTrio();
    const ids = [image.id, divider.id, label.id];
    const expanded = expandLinkedGroupSelection(ids, items);
    assert.equal(expanded, ids);
  });

  test('only 2 of the 3 parts present (e.g. image deleted) still expand to exactly those 2', () => {
    const { divider, label } = makeTrio();
    const items = [divider, label];
    const expanded = expandLinkedGroupSelection([divider.id], items);
    assert.deepEqual(new Set(expanded), new Set([divider.id, label.id]));
  });

  test('a hidden signature sibling is never pulled into the selection (matches: hidden items are unselectable on canvas)', () => {
    const { image, divider, label, items } = makeTrio();
    label.hidden = true;
    const expanded = expandLinkedGroupSelection([image.id], items);
    assert.deepEqual(new Set(expanded), new Set([image.id, divider.id]));
    assert.ok(!expanded.includes(label.id));
  });

  test('selecting a signature part alongside an unrelated item keeps the unrelated item AND expands the group', () => {
    const { image, divider, label, items } = makeTrio();
    const other = createContentItem('businessName');
    const expanded = expandLinkedGroupSelection([image.id, other.id], [...items, other]);
    assert.deepEqual(new Set(expanded), new Set([image.id, divider.id, label.id, other.id]));
  });

  test('every signature catalog type used by the app is covered by SIGNATURE_GROUP_TYPES', () => {
    assert.deepEqual(new Set(SIGNATURE_GROUP_TYPES), new Set(['signatureImage', 'signatureDivider', 'signatureLabel']));
  });
});
