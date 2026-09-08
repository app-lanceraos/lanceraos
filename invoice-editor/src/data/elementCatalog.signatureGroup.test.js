// Tests for the signature trio's move/resize/rotate-as-one-unit lock
// (Task 4 — see designDataAdapter.js's exportSignatureGroup docstring for
// the full "why": production's semantic:signature is one bundle whose
// geometry the adapter derives from the union of 3 editor items, only
// invertible while they stay in their default relative arrangement).
// This is the pure, React-free core of that lock — `expandLinkedGroupSelection`
// is the single choke point EditorContext.jsx's setSelection wrapper and
// CanvasItem.jsx's beginMove both call, so proving it here proves the
// selection-state behavior independent of React, matching this repo's own
// established pure-function test convention (see elementCatalog.customText.test.js).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { createContentItem, expandLinkedGroupSelection, SIGNATURE_GROUP_TYPES } from './elementCatalog.js';

function makeTrio() {
  const image = createContentItem('signatureImage');
  const divider = createContentItem('signatureDivider');
  const label = createContentItem('signatureLabel');
  return { image, divider, label, items: [image, divider, label] };
}

describe('expandLinkedGroupSelection: the signature trio always selects/transforms together', () => {
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
