import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { templateToDesignData, designDataToTemplate } from './designDataAdapter.js';
import { validateDesignDataAgainstPython } from './pyValidate.js';
import { initialTemplateState } from '../data/initialState.js';
import { createContentItem } from '../data/elementCatalog.js';
import { createShape } from '../data/shapeCatalog.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(HERE, '__fixtures__');

function loadFixture(name) {
  return JSON.parse(readFileSync(path.join(FIXTURES_DIR, `${name}.json`), 'utf-8'));
}

const SEEDS = ['professional', 'minimal', 'modern', 'blank'];

// ── 4. Schema validity: every design_data this adapter PRODUCES must
//    pass the real backend validator ──────────────────────────────────
describe('every produced design_data passes the real backend validator', () => {
  test('the editor default template', () => {
    const { designData } = templateToDesignData(initialTemplateState);
    const errors = validateDesignDataAgainstPython(designData);
    assert.deepEqual(errors, []);
  });

  for (const seed of SEEDS) {
    test(`re-exported ${seed} (design_data -> template -> design_data)`, () => {
      const original = loadFixture(seed);
      const { template } = designDataToTemplate(original);
      const { designData } = templateToDesignData(template);
      const errors = validateDesignDataAgainstPython(designData);
      assert.deepEqual(errors, []);
    });
  }

  test('a design with a rotated element', () => {
    const t = structuredClone(initialTemplateState);
    // Positioned in genuinely empty page space (below every default
    // item's own footprint) so this only ever exercises rotation, never
    // an incidental content overlap unrelated to what's being tested.
    const shape = createShape('roundedRect', { x: 20, y: 270 });
    shape.width = 20;
    shape.height = 15;
    shape.rotation = 37;
    t.items = [...t.items, shape];
    const { designData } = templateToDesignData(t);
    const errors = validateDesignDataAgainstPython(designData);
    assert.deepEqual(errors, []);
  });
});

// ── 1. Round-trip fidelity against every real production seed ─────────
describe('round trip against real production seeds (design_data -> template -> design_data)', () => {
  for (const seed of SEEDS) {
    test(`${seed}: page geometry is preserved exactly`, () => {
      const original = loadFixture(seed);
      const { template } = designDataToTemplate(original);
      const { designData } = templateToDesignData(template);
      assert.equal(designData.page.width_mm, original.page.width_mm);
      assert.equal(designData.page.height_mm, original.page.height_mm);
      // Modern's real seed omits background_color entirely (falls back to
      // the renderer's own #ffffff default) — the adapter always writes
      // it explicitly, so compare against the EFFECTIVE default rather
      // than requiring byte-identical presence/absence of the key.
      assert.equal(designData.page.background_color, original.page.background_color || '#ffffff');
    });

    test(`${seed}: cleanly-mapped element kinds present in the source survive with matching geometry`, () => {
      const original = loadFixture(seed);
      const { template, warnings } = designDataToTemplate(original);
      const { designData } = templateToDesignData(template);

      const findAll = (data, kind, type) =>
        [...data.header.elements, ...data.flow.elements].filter((e) => e.kind === kind && e.type === type);

      // The structural table always exists exactly once in every real seed
      // and maps cleanly both directions (kind='structural', type='table').
      const originalTables = findAll(original, 'structural', 'table');
      const roundTrippedTables = findAll(designData, 'structural', 'table');
      assert.equal(roundTrippedTables.length, originalTables.length, `table count mismatch (warnings: ${warnings.join(' | ')})`);
      assert.equal(roundTrippedTables[0].x, originalTables[0].x);
      assert.equal(roundTrippedTables[0].y, originalTables[0].y);
      assert.equal(roundTrippedTables[0].width, originalTables[0].width);
      assert.equal(roundTrippedTables[0].layout_mode, 'flow');
    });

    test(`${seed}: reports real, honest warnings for the header decomposition it cannot represent`, () => {
      const original = loadFixture(seed);
      const { warnings } = designDataToTemplate(original);
      // See report item 6 — this is the expected, documented incompatibility,
      // not a bug: the real seeds decompose header content (masthead/dates/
      // bill-to/from) into many independent generic:text elements the
      // editor's closed catalog has no per-field home for.
      if (seed !== 'blank') {
        assert.ok(warnings.length > 0, 'expected real, reported import warnings for a seed with decomposed header content');
      }
    });
  }
});

// ── 2. Reverse round trip: template -> design_data -> template, for the
//    editor's OWN default template ──────────────────────────────────────
describe('reverse round trip for the editor default template', () => {
  test('item count and catalog types are preserved exactly', () => {
    const { designData } = templateToDesignData(initialTemplateState);
    const { template: reimported, warnings } = designDataToTemplate(designData);
    // The ONE documented exception (report item 6): signatureImage/
    // signatureDivider/signatureLabel collapse into one production
    // element on export and cannot be split back exactly — this is the
    // adapter's one known, reported, non-invertible case, not a bug.
    assert.deepEqual(warnings, [
      "signature: one production element was expanded into three editor items (signatureImage/signatureDivider/signatureLabel), all sharing an approximated position derived from the single source box — this is not the inverse of the editor's own export (see report item 6) and will not round-trip exactly.",
    ]);
    const originalTypes = initialTemplateState.items.map((i) => i.type).sort();
    const reimportedTypes = reimported.items.map((i) => i.type).sort();
    assert.deepEqual(reimportedTypes, originalTypes);
  });

  test('every item\'s geometry survives exactly (x/y/width/height)', () => {
    const { designData } = templateToDesignData(initialTemplateState);
    const { template: reimported } = designDataToTemplate(designData);
    const byType = (items) => Object.fromEntries(items.map((i) => [i.type, i]));
    const before = byType(initialTemplateState.items);
    const after = byType(reimported.items);
    for (const type of Object.keys(before)) {
      // signature is the one documented, non-invertible exception (3 editor
      // items collapse into 1 production element and back into 3 approximated
      // ones) — every other type must match exactly.
      if (['signatureImage', 'signatureDivider', 'signatureLabel'].includes(type)) continue;
      assert.equal(after[type].x, before[type].x, `${type}.x`);
      assert.equal(after[type].y, before[type].y, `${type}.y`);
      assert.equal(after[type].width, before[type].width, `${type}.width`);
      assert.equal(after[type].height, before[type].height, `${type}.height`);
    }
  });

  test('a second export of the re-imported template is stable (design_data -> template -> design_data -> template)', () => {
    const { designData: first } = templateToDesignData(initialTemplateState);
    const { template: reimported } = designDataToTemplate(first);
    const { designData: second } = templateToDesignData(reimported);
    // Not asserting deepEqual(first, second) directly, since ids differ —
    // compare structurally instead.
    assert.equal(second.header.elements.length, first.header.elements.length);
    assert.equal(second.flow.elements.length, first.flow.elements.length);
  });
});

// ── 3. Every field individually ─────────────────────────────────────────
describe('individual field round trips', () => {
  test('rotation survives on a shape', () => {
    const t = structuredClone(initialTemplateState);
    const shape = createShape('roundedRect', { x: 20, y: 20 });
    shape.rotation = 42.5;
    t.items = [...t.items, shape];
    const { designData } = templateToDesignData(t);
    const rect = designData.flow.elements.find((e) => e.type === 'rectangle');
    assert.equal(rect.rotation, 42.5);
    const { template: reimported } = designDataToTemplate(designData);
    const reimportedShape = reimported.items.find((i) => i.type === 'roundedRect');
    assert.equal(reimportedShape.rotation, 42.5);
  });

  test('locked and hidden survive on a shape', () => {
    const t = structuredClone(initialTemplateState);
    const shape = createShape('ellipse', { x: 20, y: 20 });
    shape.locked = true;
    shape.hidden = true;
    t.items = [...t.items, shape];
    const { designData } = templateToDesignData(t);
    const el = designData.flow.elements.find((e) => e.type === 'ellipse');
    assert.equal(el.locked, true);
    assert.equal(el.hidden, true);
    const { template: reimported } = designDataToTemplate(designData);
    const reimportedShape = reimported.items.find((i) => i.type === 'ellipse');
    assert.equal(reimportedShape.locked, true);
    assert.equal(reimportedShape.hidden, true);
  });

  test('layout_mode round-trips losslessly even with no editor UI for it (import -> export)', () => {
    const original = loadFixture('professional');
    const table = original.flow.elements.find((e) => e.type === 'table');
    assert.equal(table.layout_mode, 'flow', 'sanity check: the real seed\'s table is flow-layout');
    const { template } = designDataToTemplate(original);
    const editorTable = template.items.find((i) => i.type === 'itemsTable');
    assert.equal(editorTable.layoutMode, 'flow', 'layout_mode must survive import onto the editor item');
    const { designData: reexported } = templateToDesignData(template);
    const reexportedTable = reexported.flow.elements.find((e) => e.type === 'table');
    assert.equal(reexportedTable.layout_mode, 'flow', 'layout_mode must survive re-export');
  });

  test('a pinned element (no layout_mode key) stays pinned (no key) on export', () => {
    const { designData } = templateToDesignData(initialTemplateState);
    const logo = designData.header.elements.find((e) => e.type === 'logo');
    assert.equal('layout_mode' in logo, false);
  });

  test('theme color links (primary/secondary) convert to theme_primary/theme_secondary and back', () => {
    const t = structuredClone(initialTemplateState);
    const shape = createShape('roundedRect', { x: 10, y: 10 });
    shape.fill = { linked: 'primary' };
    shape.borderColor = { linked: 'secondary' };
    shape.borderWidth = 0.5;
    t.items = [...t.items, shape];
    const { designData } = templateToDesignData(t);
    const rect = designData.flow.elements.find((e) => e.type === 'rectangle');
    assert.equal(rect.style.background_color, 'theme_primary');
    assert.equal(rect.style.border_color, 'theme_secondary');
    const { template: reimported } = designDataToTemplate(designData);
    const reimportedShape = reimported.items.find((i) => i.type === 'roundedRect');
    assert.deepEqual(reimportedShape.fill, { linked: 'primary' });
    assert.deepEqual(reimportedShape.borderColor, { linked: 'secondary' });
  });

  test('a literal (non-linked) color passes through unchanged', () => {
    const t = structuredClone(initialTemplateState);
    const shape = createShape('roundedRect', { x: 10, y: 10 });
    shape.fill = '#123456';
    t.items = [...t.items, shape];
    const { designData } = templateToDesignData(t);
    const rect = designData.flow.elements.find((e) => e.type === 'rectangle');
    assert.equal(rect.style.background_color, '#123456');
    const { template: reimported } = designDataToTemplate(designData);
    assert.equal(reimported.items.find((i) => i.type === 'roundedRect').fill, '#123456');
  });

  test('bindings: every clean 1:1 catalog type exports the correct binding', () => {
    const { designData } = templateToDesignData(initialTemplateState);
    const findBound = (binding) => [...designData.header.elements, ...designData.flow.elements].find((e) => e.binding === binding);
    assert.ok(findBound('business.name'));
    assert.ok(findBound('invoice.number'));
    assert.ok(findBound('invoice.issue_date'));
    assert.ok(findBound('invoice.due_date'));
  });

  test('header/flow split: identity fields land in header, everything else in flow', () => {
    const { designData } = templateToDesignData(initialTemplateState);
    const headerTypes = designData.header.elements.map((e) => e.type);
    const flowTypes = designData.flow.elements.map((e) => e.type);
    assert.ok(headerTypes.includes('logo'));
    assert.ok(headerTypes.includes('client_info'));
    assert.ok(flowTypes.includes('table'));
    assert.ok(flowTypes.includes('totals'));
  });

  test('z-order: within-list item order is preserved on export', () => {
    const { designData } = templateToDesignData(initialTemplateState);
    // logo is defined before businessName in elementCatalog.js's own key
    // order (both real items, both in `header`) — the exported array
    // order must preserve that, since array order IS z-order.
    const logoIndex = designData.header.elements.findIndex((e) => e.type === 'logo');
    const businessNameIndex = designData.header.elements.findIndex((e) => e.binding === 'business.name');
    assert.ok(logoIndex >= 0 && businessNameIndex >= 0);
    assert.ok(logoIndex < businessNameIndex);
  });

  test('page.footer round-trips its style fields', () => {
    const t = structuredClone(initialTemplateState);
    const footer = t.items.find((i) => i.type === 'footer');
    footer.textColor = '#abcdef';
    footer.fontSize = 6;
    const { designData } = templateToDesignData(t);
    assert.equal(designData.page.footer.style.text_color, '#abcdef');
    assert.equal(designData.page.footer.style.font_size_pt, 6);
    const { template: reimported } = designDataToTemplate(designData);
    const reimportedFooter = reimported.items.find((i) => i.type === 'footer');
    assert.equal(reimportedFooter.textColor, '#abcdef');
    assert.equal(reimportedFooter.fontSize, 6);
  });
});

// ── 5. Adversarial cases ─────────────────────────────────────────────────
describe('adversarial cases', () => {
  test('an empty-ish design (blank seed) imports and re-exports without throwing', () => {
    const original = loadFixture('blank');
    const { template } = designDataToTemplate(original);
    const { designData } = templateToDesignData(template);
    const errors = validateDesignDataAgainstPython(designData);
    assert.deepEqual(errors, []);
  });

  test('a design with only the required elements (table + totals) validates', () => {
    const t = {
      items: [
        createContentItem('itemsTable'),
        createContentItem('totalDue'),
      ],
      page: { width: 210, height: 297, backgroundColor: '#ffffff' },
      theme: initialTemplateState.theme,
    };
    t.items[1].x = 100; t.items[1].y = 200;
    const { designData } = templateToDesignData(t);
    const errors = validateDesignDataAgainstPython(designData);
    assert.deepEqual(errors, []);
  });

  test('an element at exact page bounds (x=0) validates', () => {
    const t = structuredClone(initialTemplateState);
    const logo = t.items.find((i) => i.type === 'logo');
    logo.x = 0;
    logo.y = 0;
    const { designData } = templateToDesignData(t);
    const errors = validateDesignDataAgainstPython(designData);
    assert.deepEqual(errors, []);
  });

  test('a legacy-shaped payload (no schema_version) is rejected by the v2 path, not silently mangled', () => {
    // designDataToTemplate is only ever meant to receive real v2 data (the
    // migration from legacy is design_migration.py's job, explicitly out
    // of this phase's scope) — feeding it a legacy shape must not crash
    // with a confusing error or silently produce a nonsense template.
    const legacy = { zone_1: { elements: [] }, zone_2: { elements: [] } };
    assert.throws(() => designDataToTemplate(legacy));
  });
});
