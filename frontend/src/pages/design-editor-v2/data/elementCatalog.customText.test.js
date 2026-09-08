// Tests for the open, multi-instance "customText" catalog type (text +
// bindings prompt) — the pure, React-free surface: catalog shape,
// createContentItem/createGenericTextItem construction, the split
// instance-rule predicates (isFreelyDuplicable, isBindingTakenIn). The
// EditorContext-level wiring (insertContentItem/setItemBinding/
// duplicateItems/addItemsFromClipboard as actually exercised through
// React state) is integration behavior on top of these same functions —
// this file proves the underlying decisions are correct independent of
// React, matching this repo's existing test convention (see
// adapter/designDataAdapter.test.js, also a pure-function test file with
// no React renderer involved).
import { test, describe } from 'vitest';
import assert from 'node:assert/strict';

import {
  ELEMENT_TYPES,
  createContentItem,
  createGenericTextItem,
  isFreelyDuplicable,
  isBindingTakenIn,
} from './elementCatalog.js';
import { createShape } from './shapeCatalog.js';
import { BINDING_OPTIONS, bindingSample, bindingLabel, isKnownBinding } from './bindings.js';

describe('customText catalog entry', () => {
  test('is registered, unlimited-instance, and text-variant', () => {
    const def = ELEMENT_TYPES.customText;
    assert.ok(def, 'customText must exist in ELEMENT_TYPES');
    assert.equal(def.multiInstance, true);
    assert.equal(def.variant, 'text');
    assert.equal(def.required, false);
    assert.equal(def.defaultOn, false); // never silently added to the default 21-item layout
  });

  test('render(item) reflects typed content for an unbound item', () => {
    const item = createContentItem('customText', { text: 'Hello invoice' });
    assert.equal(ELEMENT_TYPES.customText.render(item), 'Hello invoice');
  });

  test('render(item) falls back to a placeholder when no text has been typed yet', () => {
    const item = createContentItem('customText');
    assert.equal(ELEMENT_TYPES.customText.render(item), 'Text');
  });

  test('render(item) shows the binding sample for a bound item, ignoring any stale .text', () => {
    const item = createContentItem('customText', { binding: 'client.email', text: 'should be ignored' });
    assert.equal(ELEMENT_TYPES.customText.render(item), bindingSample('client.email'));
  });
});

describe('createContentItem: unlimited instances, each independently editable', () => {
  test('two calls produce two distinct, independently-textable items', () => {
    const a = createContentItem('customText', { text: 'First' });
    const b = createContentItem('customText', { text: 'Second' });
    assert.notEqual(a.id, b.id);
    assert.equal(ELEMENT_TYPES.customText.render(a), 'First');
    assert.equal(ELEMENT_TYPES.customText.render(b), 'Second');
  });

  test('overrides patch position/size without disturbing the catalog default for other fields', () => {
    const item = createContentItem('customText', { x: 12.5, y: 40, width: 60, height: 8 });
    assert.equal(item.x, 12.5);
    assert.equal(item.y, 40);
    assert.equal(item.width, 60);
    assert.equal(item.height, 8);
    assert.equal(item.naturalWidth, 60); // stays consistent with the overridden box, not the catalog default
    assert.equal(item.kind, 'content');
    assert.equal(item.type, 'customText');
  });

  test('overrides can never smuggle in a caller-supplied id', () => {
    const item = createContentItem('customText', { id: 'attacker-controlled-id', text: 'x' });
    assert.notEqual(item.id, 'attacker-controlled-id');
  });
});

describe('createGenericTextItem: constructs a working item from arbitrary production data', () => {
  test('an unfamiliar binding, never seen in BINDING_OPTIONS, still produces a working, editable item', () => {
    const unfamiliarBinding = 'client.some_new_field_added_after_this_editor_was_built';
    assert.equal(isKnownBinding(unfamiliarBinding), false, 'the test binding must genuinely be unrecognized');

    const item = createGenericTextItem({
      x: 17.3, y: 88.1, width: 42, height: 9, rotation: 12,
      binding: unfamiliarBinding,
      fontFamily: 'ibm-plex-mono', fontWeight: 600, fontSize: 8.5,
      textColor: '#123456', contentAlign: 'right',
    });

    // A real, fully-formed canvas item — same shape as every other
    // content item (kind/type/id present, geometry copied verbatim).
    assert.equal(item.kind, 'content');
    assert.equal(item.type, 'customText');
    assert.ok(item.id);
    assert.equal(item.x, 17.3);
    assert.equal(item.y, 88.1);
    assert.equal(item.width, 42);
    assert.equal(item.height, 9);
    assert.equal(item.rotation, 12);
    assert.equal(item.binding, unfamiliarBinding);
    assert.equal(item.fontFamily, 'ibm-plex-mono');
    assert.equal(item.fontWeight, 600);
    assert.equal(item.fontSize, 8.5);
    assert.equal(item.textColor, '#123456');
    assert.equal(item.contentAlign, 'right');

    // Genuinely renderable (the whole point of "working, editable canvas
    // item") — the unfamiliar binding still resolves to SOME real display
    // text, never throws, never renders blank/undefined.
    const rendered = ELEMENT_TYPES.customText.render(item);
    assert.equal(typeof rendered, 'string');
    assert.ok(rendered.length > 0);
    assert.equal(rendered, `[${unfamiliarBinding}]`);
  });

  test('an unbound item with arbitrary typed text and no catalog precedent', () => {
    const item = createGenericTextItem({ x: 0, y: 0, width: 30, height: 6, text: 'Arbitrary imported caption' });
    assert.equal(item.binding, null);
    assert.equal(ELEMENT_TYPES.customText.render(item), 'Arbitrary imported caption');
  });

  test('a known binding resolves to its real curated sample, not the generic bracket fallback', () => {
    const item = createGenericTextItem({ x: 0, y: 0, width: 30, height: 6, binding: 'business.name' });
    assert.equal(ELEMENT_TYPES.customText.render(item), bindingSample('business.name'));
    assert.notEqual(ELEMENT_TYPES.customText.render(item), '[business.name]');
  });
});

describe('split instance rule: isFreelyDuplicable', () => {
  test('shapes and images are always freely duplicable (unchanged pre-existing behavior)', () => {
    const shape = createShape('roundedRect', { x: 0, y: 0 });
    assert.equal(isFreelyDuplicable(shape), true);
    const image = { kind: 'image', dataUrl: 'data:image/png;base64,x' };
    assert.equal(isFreelyDuplicable(image), true);
  });

  test('an unbound customText item is freely duplicable (unlimited static-text instances)', () => {
    const item = createContentItem('customText', { text: 'Static caption' });
    assert.equal(isFreelyDuplicable(item), true);
  });

  test('a BOUND customText item is NOT freely duplicable (single-instance per binding)', () => {
    const item = createContentItem('customText', { binding: 'client.email' });
    assert.equal(isFreelyDuplicable(item), false);
  });

  test('every other (legacy, single-instance-per-type) content type stays excluded, unchanged', () => {
    const dueDate = createContentItem('dueDate');
    assert.equal(isFreelyDuplicable(dueDate), false);
    const billTo = createContentItem('billTo');
    assert.equal(isFreelyDuplicable(billTo), false);
  });
});

describe('split instance rule: isBindingTakenIn', () => {
  test('an unbound binding value (null/undefined) is never "taken"', () => {
    assert.equal(isBindingTakenIn([], null, 'x'), false);
    assert.equal(isBindingTakenIn([createContentItem('customText', { binding: 'client.email' })], null, 'other'), false);
  });

  test('a binding already used by another customText item is taken', () => {
    const a = createContentItem('customText', { binding: 'client.email' });
    assert.equal(isBindingTakenIn([a], 'client.email', 'some-other-id'), true);
  });

  test('a binding is NOT taken by itself (excludeItemId scoping)', () => {
    const a = createContentItem('customText', { binding: 'client.email' });
    assert.equal(isBindingTakenIn([a], 'client.email', a.id), false);
  });

  test('two different bindings never collide with each other', () => {
    const a = createContentItem('customText', { binding: 'client.email' });
    assert.equal(isBindingTakenIn([a], 'client.name', 'x'), false);
  });

  test('a legacy singleton content type (not customText) never counts toward this check', () => {
    // businessName is conceptually "bound to business.name" in production
    // terms, but it doesn't carry an item.binding field or type ===
    // 'customText' — a known, documented scope line (see EditorContext's
    // own isBindingTaken comment): this check is scoped to customText
    // items specifically, not every content item that happens to
    // represent bound data.
    const businessName = createContentItem('businessName');
    assert.equal(isBindingTakenIn([businessName], 'business.name', 'x'), false);
  });
});

describe('split instance rule: delete is unaffected by binding state', () => {
  // EditorContext's canDeleteItem (not itself a pure export — it closes
  // over live template state) blocks deletion for exactly two reasons:
  // item.locked, or "this is the last remaining instance of a REQUIRED
  // content type." customText is never required (asserted above), so
  // neither a bound nor an unbound instance is ever delete-blocked by
  // that rule — deleting a bound instance is precisely how its binding
  // becomes available again for a different item (isBindingTakenIn
  // excludes the item being checked, and once it's gone from
  // template.items entirely, no item is holding that binding at all).
  // This documents that deliberate non-interaction rather than
  // special-casing binding state into the delete guard.
  test('customText is never "required", so neither a bound nor unbound instance blocks deletion', () => {
    assert.equal(ELEMENT_TYPES.customText.required, false);
  });

  test('freeing a binding is just removing the item — isBindingTakenIn reflects an empty list correctly', () => {
    const bound = createContentItem('customText', { binding: 'client.name' });
    assert.equal(isBindingTakenIn([bound], 'client.name', 'unrelated'), true);
    // Simulates the post-delete state: the item is no longer in the list.
    assert.equal(isBindingTakenIn([], 'client.name', 'unrelated'), false);
  });
});

describe('bindings.js', () => {
  test('BINDING_OPTIONS is non-empty and every entry has a label and sample', () => {
    assert.ok(BINDING_OPTIONS.length > 10);
    BINDING_OPTIONS.forEach((b) => {
      assert.ok(b.value);
      assert.ok(b.label);
      assert.ok(b.sample);
    });
  });

  test('bindingLabel falls back to the raw value for an unknown binding', () => {
    assert.equal(bindingLabel('totally.unknown'), 'totally.unknown');
  });

  test('bindingSample never returns blank/undefined, even for an unknown binding', () => {
    const sample = bindingSample('totally.unknown');
    assert.equal(typeof sample, 'string');
    assert.ok(sample.length > 0);
  });

  test('isKnownBinding is accurate for both a real and a fake binding', () => {
    assert.equal(isKnownBinding('client.email'), true);
    assert.equal(isKnownBinding('totally.unknown'), false);
  });
});
