// src/pages/design-editor-v2/components/Canvas/CanvasItem.signatureSelection.test.jsx
//
// Part 7 (grouped move, independent everything else) — proves the actual
// UI-level selection/transform behavior change, not just the pure
// expandLinkedGroupSelection helper (data/elementCatalog.signatureGroup.test.js)
// or the adapter-level round-trip (adapter/designDataAdapter.test.js).
//
// Before this task: clicking ANY ONE of the 3 signature parts (image/
// divider/label) selected all 3 together (elementCatalog.js's
// expandLinkedGroupSelection, applied at EditorContext.jsx's setSelection
// choke point on every selection change) — showing the shared
// GroupSelectionOverlay's combined handles instead of that one part's own,
// and scaling/aligning/styling all 3 as one unit.
//
// After: clicking one part selects only that part (its own
// `.item__resize-handle`s render on that item alone, matching
// showIndividualHandles's `selectedMovableCount <= 1` gate) — grouping is
// now enforced ONLY inside beginMove's own local, per-gesture
// expandLinkedGroupSelection call, never in committed selection state.
import { render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import MockAdapter from 'axios-mock-adapter'
import { fireEvent } from '@testing-library/react'

import api from '@/lib/api'
import { invalidateProfileAssetsCache } from '@/hooks/useProfileAssets'
import { EditorProvider, useEditor } from '../../state/EditorContext'
import { createContentItem } from '../../data/elementCatalog'
import { DEFAULT_THEME } from '../../utils/theme'
import CanvasItem from './CanvasItem'

let mock

beforeEach(() => {
  mock = new MockAdapter(api, { delayResponse: 0 })
  mock.onGet('/auth/profile/').reply(200, { logo: '', signature_url: '' })
  invalidateProfileAssetsCache()
})

afterEach(() => {
  mock.restore()
})

// Real, non-overlapping positions for the 3 parts (mm, well inside the
// default 210x297 A4 page) — distinct sizes/x/y so this also incidentally
// proves nothing in the selection/handle logic secretly depends on the
// parts sharing the catalog's own default stacked arrangement.
function buildSignatureTrio() {
  const image = createContentItem('signatureImage', { x: 20, y: 20, width: 30, height: 20 });
  const divider = createContentItem('signatureDivider', { x: 20, y: 45, width: 40, height: 2 });
  const label = createContentItem('signatureLabel', { x: 20, y: 55, width: 60, height: 10 });
  return { image, divider, label };
}

function buildTemplate(items) {
  return {
    items,
    page: { width: 210, height: 297, backgroundColor: '#FAF9F6' },
    theme: DEFAULT_THEME,
    meta: {},
  };
}

// A thin debug readout so the test can assert on committed EditorContext
// selection state directly, alongside the real rendered CanvasItems.
function SelectionDebug() {
  const { selection } = useEditor();
  return <div data-testid="selection-debug">{selection.ids.join(',')}</div>;
}

// Reads real, LIVE committed positions back out of context state — the
// `image`/`divider`/`label` objects a test builds are just the initial
// seed; `updateItems` (beginGroupMove's own commit) produces fresh item
// objects in `template.items`, never mutates those originals in place.
function ItemsDebug() {
  const { template } = useEditor();
  const byId = {};
  template.items.forEach((i) => { byId[i.id] = { x: i.x, y: i.y }; });
  return <div data-testid="items-debug">{JSON.stringify(byId)}</div>;
}

function renderTrio(items) {
  const template = buildTemplate(Object.values(items));
  return render(
    <EditorProvider initialTemplate={template}>
      <SelectionDebug />
      <ItemsDebug />
      {Object.values(items).map((item) => (
        <CanvasItem key={item.id} item={item} />
      ))}
    </EditorProvider>,
  );
}

function click(el) {
  fireEvent.mouseDown(el, { clientX: 0, clientY: 0, button: 0 });
  // End the gesture (beginMove/beginGroupMove both attach real window
  // mousemove/mouseup listeners) so nothing leaks into the next test.
  fireEvent.mouseUp(window);
}

describe('CanvasItem — signature trio: independent selection, grouped move only', () => {
  it('clicking one part selects only that part (not its siblings)', () => {
    const { image, divider, label } = buildSignatureTrio();
    const { container, getByTestId } = renderTrio({ image, divider, label });
    const imageEl = container.querySelectorAll('.item')[0];
    click(imageEl);
    expect(getByTestId('selection-debug').textContent).toBe(image.id);
  });

  it('the selected part alone renders resize/rotate handles — siblings render none', () => {
    const { image, divider, label } = buildSignatureTrio();
    const { container } = renderTrio({ image, divider, label });
    const [imageEl, dividerEl, labelEl] = container.querySelectorAll('.item');
    click(imageEl);
    expect(imageEl.querySelectorAll('.item__resize-handle').length).toBeGreaterThan(0);
    expect(imageEl.querySelector('.item__rotate-handle')).not.toBeNull();
    expect(dividerEl.querySelectorAll('.item__resize-handle').length).toBe(0);
    expect(labelEl.querySelectorAll('.item__resize-handle').length).toBe(0);
  });

  it('selecting the divider instead selects only the divider', () => {
    const { image, divider, label } = buildSignatureTrio();
    const { container, getByTestId } = renderTrio({ image, divider, label });
    const dividerEl = container.querySelectorAll('.item')[1];
    click(dividerEl);
    expect(getByTestId('selection-debug').textContent).toBe(divider.id);
  });

  it('dragging one part still moves all three by the same shared delta', () => {
    const { image, divider, label } = buildSignatureTrio();
    const { container, getByTestId } = renderTrio({ image, divider, label });
    const imageEl = container.querySelectorAll('.item')[0];

    const before = JSON.parse(getByTestId('items-debug').textContent);

    fireEvent.mouseDown(imageEl, { clientX: 100, clientY: 100, button: 0 });
    fireEvent.mouseMove(window, { clientX: 130, clientY: 115 }); // +30px x, +15px y on screen
    fireEvent.mouseUp(window);

    const after = JSON.parse(getByTestId('items-debug').textContent);

    // Real page-unit deltas depend on pxToMm/zoom, which this test isn't
    // asserting exactly — what matters is that all 3 items moved by the
    // IDENTICAL delta, preserving their relative arrangement.
    const dxImage = after[image.id].x - before[image.id].x;
    const dyImage = after[image.id].y - before[image.id].y;
    expect(dxImage !== 0 || dyImage !== 0).toBe(true); // a real move happened
    expect(after[divider.id].x - before[divider.id].x).toBeCloseTo(dxImage, 5);
    expect(after[divider.id].y - before[divider.id].y).toBeCloseTo(dyImage, 5);
    expect(after[label.id].x - before[label.id].x).toBeCloseTo(dxImage, 5);
    expect(after[label.id].y - before[label.id].y).toBeCloseTo(dyImage, 5);
  });
});
