import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { templateToDesignData, designDataToTemplate } from './designDataAdapter.js';
import { validateDesignDataAgainstPython } from './pyValidate.js';
import { initialTemplateState } from '../data/initialState.js';
import { createContentItem, createGenericTextItem } from '../data/elementCatalog.js';
import { createShape } from '../data/shapeCatalog.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(HERE, '__fixtures__');

function loadFixture(name) {
  return JSON.parse(readFileSync(path.join(FIXTURES_DIR, `${name}.json`), 'utf-8'));
}

const SEEDS = ['professional', 'minimal', 'modern'];

// ── 1. THE bar: real deep equality, design_data -> template -> design_data,
//    against every real builtin seed. No sorting, no key-order games (plain
//    JS object equality is already key-order-insensitive) — a real,
//    recursive structural comparison of the actual round-tripped output
//    against the actual source fixture (regenerated straight from
//    apps.invoices.design_templates.BUILTIN_DESIGNS via the existing
//    subprocess bridge, scripts/py/dump_fixtures.py — never hand-edited).
describe('exact round trip against every real BUILTIN_DESIGNS seed', () => {
  for (const seed of SEEDS) {
    test(`${seed}: design_data -> template -> design_data is deep-equal to the original`, () => {
      const original = loadFixture(seed);
      const { template } = designDataToTemplate(original);
      const { designData } = templateToDesignData(template);
      assert.deepStrictEqual(designData, original);
    });
  }
});

// `blank` (get_blank_design_data('professional')) has an EMPTY
// header.elements — a real, distinct shape (no logo/business/client/date
// content at all) worth its own round-trip check, kept separate from the
// SEEDS loop above since it exercises a genuinely different code path
// (zero groups found).
test('blank professional starter: design_data -> template -> design_data is deep-equal', () => {
  const original = loadFixture('blank');
  const { template } = designDataToTemplate(original);
  const { designData } = templateToDesignData(template);
  assert.deepStrictEqual(designData, original);
});

// ── 2. The editor's OWN starter template survives an exact round trip ───
describe("the editor's own starter template", () => {
  test('template -> design_data -> template is exact', () => {
    const { designData } = templateToDesignData(initialTemplateState);
    const { template: reimported } = designDataToTemplate(designData);
    // Compared on the SAME projection both directions actually preserve:
    // every item's real, meaningful fields. Stripped before comparing,
    // each for its own documented reason (none of them a functional
    // regression — see this test suite's own report writeup):
    //  - `id` is regenerated on every import by design (nothing reads an
    //    id across a save/load boundary).
    //  - `_parts` is this file's own internal exact-geometry bookkeeping
    //    (see the module docstring) — real, but never present on an
    //    item that has never been through an import.
    //  - `.extra` on any sub-part — a from-scratch item's title/label
    //    parts have no `.extra` at all, but EXPORT always emits the 2
    //    fixed, non-editable eyebrow-typography keys (letter_spacing_em/
    //    text_transform) for "Invoice"/"Bill to"/"From"/date labels
    //    (matching every real production template), and REIMPORT
    //    faithfully captures whatever it just exported — a real,
    //    one-directional, entirely intentional normalization from
    //    "implicit default" to "explicit, matching production", not a
    //    content or behavior change.
    //  - `layoutMode` on table/totals/notes items — EXPORT always forces
    //    `layout_mode: 'flow'` for these 3 types (matching every real
    //    seed; a pre-existing Phase 2b convention, unchanged), which
    //    reimport then faithfully reflects; a from-scratch item simply
    //    has never had this explicit flag written yet. Rendering is
    //    identical either way (absent means the same 'pinned' default
    //    behavior these types already effectively use on a fresh page).
    //  - `contentAlign` on the 4 totals rows — EXPORT always writes
    //    `style.align = item.contentAlign || 'right'` (another
    //    pre-existing, unchanged Phase 2b convention: these rows are
    //    always right-aligned in every real template), so reimport
    //    always captures 'right' explicitly even when the source item
    //    never set it (implicit 'right' via CSS default either way).
    const NORMALIZED_LAYOUT_MODE_TYPES = ['itemsTable', 'subtotal', 'tax', 'discount', 'totalDue', 'notes', 'terms', 'paymentMethods'];
    const strip = (items) => items.map((it) => {
      const { id, _parts, extra, layoutMode, contentAlign, ...rest } = it;
      const cleaned = { ...rest };
      if (!NORMALIZED_LAYOUT_MODE_TYPES.includes(it.type) && layoutMode !== undefined) cleaned.layoutMode = layoutMode;
      if (!['subtotal', 'tax', 'discount', 'totalDue'].includes(it.type) && contentAlign !== undefined) cleaned.contentAlign = contentAlign;
      // Footer font theme-linking (design_schema.py/design_renderer.py's
      // font theme-link retrofit) closed what used to be a real,
      // documented, one-directional loss here: a theme-linked footer font
      // used to get resolved to its current literal value on export
      // (production's own footer validator never accepted a sentinel), so
      // this test had to strip fontFamily/fontWeight before comparing.
      // Both now round-trip losslessly through the same sentinel
      // mechanism every other themed font already uses — see the
      // dedicated 'footer font theme-link' test below for direct,
      // explicit coverage of exactly this.
      Object.keys(cleaned).forEach((k) => {
        const v = cleaned[k];
        if (v && typeof v === 'object' && !Array.isArray(v)) {
          const { extra: partExtra, ...vRest } = v;
          cleaned[k] = vRest;
        }
      });
      return cleaned;
    });
    assert.deepStrictEqual(strip(reimported.items), strip(initialTemplateState.items));
    assert.equal(reimported.page.width, initialTemplateState.page.width);
    assert.equal(reimported.page.height, initialTemplateState.page.height);
    assert.equal(reimported.page.backgroundColor, initialTemplateState.page.backgroundColor);
  });
});

// ── 3. Schema validity: every design_data this adapter PRODUCES must
//    pass the real backend validator (subprocess bridge, never a JS
//    reimplementation) ─────────────────────────────────────────────────
describe('every produced design_data passes the real backend validator', () => {
  test('the editor default template', () => {
    const { designData } = templateToDesignData(initialTemplateState);
    const errors = validateDesignDataAgainstPython(designData);
    assert.deepEqual(errors, []);
  });

  for (const seed of [...SEEDS, 'blank']) {
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
    const shape = createShape('roundedRect', { x: 20, y: 270 });
    shape.width = 20;
    shape.height = 15;
    shape.rotation = 37;
    t.items = [...t.items, shape];
    const { designData } = templateToDesignData(t);
    const errors = validateDesignDataAgainstPython(designData);
    assert.deepEqual(errors, []);
  });

  test('a design with a bound customText element (Phase 3a binding)', () => {
    const t = structuredClone(initialTemplateState);
    const custom = createGenericTextItem({ x: 20, y: 260, width: 60, height: 8, binding: 'invoice.tax_rate' });
    t.items = [...t.items, custom];
    const { designData } = templateToDesignData(t);
    const errors = validateDesignDataAgainstPython(designData);
    assert.deepEqual(errors, []);
  });

  test('a design with an unbound customText element carrying arbitrary user text', () => {
    const t = structuredClone(initialTemplateState);
    const custom = createGenericTextItem({ x: 20, y: 260, width: 60, height: 8, text: 'Thanks!\nSee you soon.' });
    t.items = [...t.items, custom];
    const { designData } = templateToDesignData(t);
    const errors = validateDesignDataAgainstPython(designData);
    assert.deepEqual(errors, []);
  });
});

// ── 4. Theme links (color AND font) round-trip losslessly ───────────────
describe('theme links round-trip losslessly', () => {
  test('a color linked to theme primary/secondary survives export -> import', () => {
    const t = structuredClone(initialTemplateState);
    const item = createContentItem('customText', { x: 20, y: 260, width: 60, height: 8, text: 'Linked' });
    item.textColor = { linked: 'secondary' };
    t.items = [...t.items, item];
    const { designData } = templateToDesignData(t);
    const el = designData.flow.elements.find((e) => e.style?.text === 'Linked');
    assert.equal(el.style.color, 'theme_secondary');
    const { template: reimported } = designDataToTemplate(designData);
    const reimportedItem = reimported.items.find((i) => i.text === 'Linked');
    assert.deepEqual(reimportedItem.textColor, { linked: 'secondary' });
  });

  test('a font linked to theme heading/body survives export -> import (Phase 3a sentinel)', () => {
    const t = structuredClone(initialTemplateState);
    const item = createContentItem('customText', { x: 20, y: 260, width: 60, height: 8, text: 'Linked font' });
    item.fontFamily = { linked: 'heading' };
    t.items = [...t.items, item];
    const { designData } = templateToDesignData(t);
    const el = designData.flow.elements.find((e) => e.style?.text === 'Linked font');
    assert.equal(el.style.font, 'theme_heading_font');
    assert.equal(el.style.font_weight, 'theme_heading_font');
    const { template: reimported } = designDataToTemplate(designData);
    const reimportedItem = reimported.items.find((i) => i.text === 'Linked font');
    assert.deepEqual(reimportedItem.fontFamily, { linked: 'heading' });
  });

  test('page.footer font theme-linking round-trips losslessly (retrofit closing the footer-specific gap)', () => {
    const t = structuredClone(initialTemplateState);
    const footerItem = t.items.find((i) => i.type === 'footer');
    footerItem.fontFamily = { linked: 'heading' };
    const { designData } = templateToDesignData(t);
    // design_schema.py's own footer validator previously required a
    // plain number for font_weight and never accepted a sentinel string —
    // exercise the real backend validator directly, not just this
    // adapter's own JS logic, to prove that gap is actually closed.
    const errors = validateDesignDataAgainstPython(designData);
    assert.deepEqual(errors, []);
    assert.equal(designData.page.footer.style.font_family, 'theme_heading_font');
    assert.equal(designData.page.footer.style.font_weight, 'theme_heading_font');
    const { template: reimported } = designDataToTemplate(designData);
    const reimportedFooter = reimported.items.find((i) => i.type === 'footer');
    assert.deepEqual(reimportedFooter.fontFamily, { linked: 'heading' });
    assert.equal(reimportedFooter.fontWeight, undefined);
  });

  test('a literal (unlinked) font/color still resolves and round-trips as a plain value', () => {
    const t = structuredClone(initialTemplateState);
    const item = createContentItem('customText', { x: 20, y: 260, width: 60, height: 8, text: 'Literal' });
    item.textColor = '#ff0000';
    item.fontFamily = 'ibm-plex-mono';
    item.fontWeight = 600;
    t.items = [...t.items, item];
    const { designData } = templateToDesignData(t);
    const el = designData.flow.elements.find((e) => e.style?.text === 'Literal');
    assert.equal(el.style.color, '#ff0000');
    assert.equal(el.style.font, 'IBM Plex Mono');
    assert.equal(el.style.font_weight, 600);
    const { template: reimported } = designDataToTemplate(designData);
    const reimportedItem = reimported.items.find((i) => i.text === 'Literal');
    assert.equal(reimportedItem.textColor, '#ff0000');
    assert.equal(reimportedItem.fontFamily, 'ibm-plex-mono');
    assert.equal(reimportedItem.fontWeight, 600);
  });
});

// ── 5. layout_mode / rotation / crop / locked / hidden round-trip ────────
describe('layout_mode, rotation, crop, locked, hidden round-trip losslessly', () => {
  test('layout_mode: flow survives (a real field with no editing UI yet)', () => {
    const original = loadFixture('professional');
    const { template } = designDataToTemplate(original);
    const { designData } = templateToDesignData(template);
    const originalTable = original.flow.elements.find((e) => e.type === 'table');
    const roundTrippedTable = designData.flow.elements.find((e) => e.type === 'table');
    assert.equal(roundTrippedTable.layout_mode, originalTable.layout_mode);
  });

  test('rotation survives on a shape', () => {
    const t = structuredClone(initialTemplateState);
    const shape = createShape('roundedRect', { x: 20, y: 270 });
    shape.width = 20;
    shape.height = 10;
    shape.rotation = 15;
    t.items = [...t.items, shape];
    const { designData } = templateToDesignData(t);
    const el = designData.flow.elements.find((e) => e.type === 'rectangle');
    assert.equal(el.rotation, 15);
    const { template: reimported } = designDataToTemplate(designData);
    const reimportedShape = reimported.items.find((i) => i.type === 'roundedRect');
    assert.equal(reimportedShape.rotation, 15);
  });

  test('crop survives on an image (Phase 3a: non-destructive, fraction-based)', () => {
    const t = structuredClone(initialTemplateState);
    const image = {
      id: 'image-test', kind: 'image', dataUrl: 'data:image/png;base64,AAAA',
      x: 20, y: 260, width: 30, height: 20, naturalWidth: 30, naturalHeight: 20,
      rotation: 0, allowFreeLayering: true, cornerRadius: 0, sourceWidth: 30, sourceHeight: 20,
      crop: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 },
    };
    t.items = [...t.items, image];
    const { designData } = templateToDesignData(t);
    const el = designData.flow.elements.find((e) => e.type === 'image');
    assert.deepEqual(el.crop, { x: 0.1, y: 0.1, width: 0.5, height: 0.5 });
    const errors = validateDesignDataAgainstPython(designData);
    assert.deepEqual(errors, []);
    const { template: reimported } = designDataToTemplate(designData);
    const reimportedImage = reimported.items.find((i) => i.kind === 'image');
    assert.deepEqual(reimportedImage.crop, { x: 0.1, y: 0.1, width: 0.5, height: 0.5 });
  });

  test('locked and hidden survive on a content item', () => {
    const t = structuredClone(initialTemplateState);
    const item = createContentItem('customText', { x: 20, y: 260, width: 60, height: 8, text: 'Locked+hidden', locked: true, hidden: true });
    t.items = [...t.items, item];
    const { designData } = templateToDesignData(t);
    const el = designData.flow.elements.find((e) => e.style?.text === 'Locked+hidden');
    assert.equal(el.locked, true);
    assert.equal(el.hidden, true);
    const { template: reimported } = designDataToTemplate(designData);
    const reimportedItem = reimported.items.find((i) => i.text === 'Locked+hidden');
    assert.equal(reimportedItem.locked, true);
    assert.equal(reimportedItem.hidden, true);
  });
});

// ── 6. Real production capabilities land correctly ───────────────────────
describe('real production element decompositions', () => {
  test('professional: signature imports as 3 items and re-exports as ONE semantic:signature element, byte-identical', () => {
    const original = loadFixture('professional');
    const { template } = designDataToTemplate(original);
    assert.ok(template.items.some((i) => i.type === 'signatureImage'));
    assert.ok(template.items.some((i) => i.type === 'signatureDivider'));
    assert.ok(template.items.some((i) => i.type === 'signatureLabel'));
    const { designData } = templateToDesignData(template);
    const originalSig = original.flow.elements.find((e) => e.type === 'signature');
    const roundTrippedSig = designData.flow.elements.find((e) => e.type === 'signature');
    assert.deepStrictEqual(roundTrippedSig, originalSig);
  });

  test('professional: Pay Online imports/exports as two real elements (qr_code + online_payment_link)', () => {
    const original = loadFixture('professional');
    const { template } = designDataToTemplate(original);
    const payOnline = template.items.find((i) => i.type === 'payOnline');
    assert.ok(payOnline);
    const { designData } = templateToDesignData(template);
    const qr = designData.flow.elements.find((e) => e.type === 'qr_code');
    const link = designData.flow.elements.find((e) => e.type === 'online_payment_link');
    assert.ok(qr);
    assert.ok(link);
    assert.equal(link.style.label, 'Pay online');
  });

  test('professional: billTo/from decompose into independent per-line generic:text elements', () => {
    const original = loadFixture('professional');
    const { template } = designDataToTemplate(original);
    const billTo = template.items.find((i) => i.type === 'billTo');
    assert.ok(billTo);
    const { designData } = templateToDesignData(template);
    const clientLines = [...designData.header.elements].filter((e) =>
      ['client.name', 'client.company', 'client.address', 'client.email'].includes(e.binding)
    );
    assert.equal(clientLines.length, 4);
  });

  test('per-line style override on a billTo line survives round trip', () => {
    const original = loadFixture('professional');
    const { template } = designDataToTemplate(original);
    const billTo = template.items.find((i) => i.type === 'billTo');
    billTo.clientName.textColor = '#123456';
    const { designData } = templateToDesignData(template);
    const nameEl = designData.header.elements.find((e) => e.binding === 'client.name');
    assert.equal(nameEl.style.color, '#123456');
  });

  test('issueDate/dueDate export as two independent elements each (label text + bound value)', () => {
    const original = loadFixture('professional');
    const { template } = designDataToTemplate(original);
    const { designData } = templateToDesignData(template);
    const issueLabel = designData.header.elements.find((e) => !e.binding && e.style?.text === 'Issue date');
    const issueValue = designData.header.elements.find((e) => e.binding === 'invoice.issue_date');
    assert.ok(issueLabel);
    assert.ok(issueValue);
  });

  test('currencyConversion now exports as a real bound element (Phase 3a binding), not a static placeholder', () => {
    const t = structuredClone(initialTemplateState);
    const { designData } = templateToDesignData(t);
    const el = [...designData.header.elements, ...designData.flow.elements].find((e) => e.binding === 'invoice.client_currency_conversion');
    assert.ok(el, 'expected a generic:text bound to invoice.client_currency_conversion');
  });

  test('a fresh customText item bound to a Phase 3a binding round-trips', () => {
    const t = structuredClone(initialTemplateState);
    const item = createGenericTextItem({ x: 20, y: 260, width: 60, height: 8, binding: 'invoice.tax_rate' });
    t.items = [...t.items, item];
    const { designData } = templateToDesignData(t);
    const el = [...designData.header.elements, ...designData.flow.elements].find((e) => e.binding === 'invoice.tax_rate');
    assert.ok(el);
    const { template: reimported } = designDataToTemplate(designData);
    const reimportedItem = reimported.items.find((i) => i.binding === 'invoice.tax_rate');
    assert.ok(reimportedItem);
    assert.equal(reimportedItem.type, 'customText');
  });

  test('a duplicate customText binding on import is dropped with a warning, never silently kept twice', () => {
    const original = loadFixture('professional');
    const withDupe = structuredClone(original);
    const extra = withDupe.flow.elements.find((e) => e.binding === 'invoice.tax_rate' || e.type === 'divider');
    // Inject a synthetic duplicate of an existing customText-shaped binding.
    withDupe.flow.elements.push({
      kind: 'generic', type: 'text', x: 5, y: 5, width: 10, height: 5,
      style: {}, overrides: {}, binding: 'invoice.tax_rate',
    });
    withDupe.flow.elements.push({
      kind: 'generic', type: 'text', x: 6, y: 6, width: 10, height: 5,
      style: {}, overrides: {}, binding: 'invoice.tax_rate',
    });
    const { template, warnings } = designDataToTemplate(withDupe);
    const matches = template.items.filter((i) => i.binding === 'invoice.tax_rate');
    assert.equal(matches.length, 1);
    assert.ok(warnings.some((w) => w.includes('invoice.tax_rate') && w.includes('dropped')));
  });

  test('an unrecognized binding string imports as customText with a warning (not dropped)', () => {
    const original = loadFixture('professional');
    const withUnknown = structuredClone(original);
    withUnknown.flow.elements.push({
      kind: 'generic', type: 'text', x: 5, y: 5, width: 10, height: 5,
      style: { text: 'placeholder' }, overrides: {}, binding: 'invoice.some_future_field',
    });
    const { template, warnings } = designDataToTemplate(withUnknown);
    const item = template.items.find((i) => i.binding === 'invoice.some_future_field');
    assert.ok(item);
    assert.equal(item.type, 'customText');
    assert.ok(warnings.some((w) => w.includes('invoice.some_future_field')));
  });

  test('table Phase 3a styling (column_alignments/zebra/cell_padding) maps onto real, canvas-rendering editor fields and round-trips', () => {
    const original = loadFixture('professional');
    const withExtras = structuredClone(original);
    const table = withExtras.flow.elements.find((e) => e.type === 'table');
    table.style.column_alignments = ['left', 'right', 'right', 'right'];
    table.style.zebra_enabled = true;
    table.style.zebra_color = '#eeeeee';
    table.style.cell_padding_mm = 3;
    const { template } = designDataToTemplate(withExtras);
    // WYSIWYG parity fix: these must land on the SAME real fields
    // CanvasItem.jsx's own table case already renders with
    // (columnAlign/altRowShading/altRowColor/cellPadding) — not an opaque
    // `_tableExtra` passthrough bag invisible to the canvas.
    const importedTableItem = template.items.find((i) => i.type === 'itemsTable');
    assert.deepEqual(importedTableItem.columnAlign, ['left', 'right', 'right', 'right']);
    assert.equal(importedTableItem.altRowShading, true);
    assert.equal(importedTableItem.altRowColor, '#eeeeee');
    assert.equal(importedTableItem.cellPadding, 3);
    assert.equal(importedTableItem._tableExtra?.column_alignments, undefined);
    assert.equal(importedTableItem._tableExtra?.zebra_enabled, undefined);
    const { designData } = templateToDesignData(template);
    const roundTrippedTable = designData.flow.elements.find((e) => e.type === 'table');
    assert.deepEqual(roundTrippedTable.style.column_alignments, ['left', 'right', 'right', 'right']);
    assert.equal(roundTrippedTable.style.zebra_enabled, true);
    assert.equal(roundTrippedTable.style.zebra_color, '#eeeeee');
    assert.equal(roundTrippedTable.style.cell_padding_mm, 3);
    const errors = validateDesignDataAgainstPython(designData);
    assert.deepEqual(errors, []);
  });

  test('table column_alignments cycles by index modulo when its length does not match the column count, mirroring resolve_table_columns exactly', () => {
    const original = loadFixture('professional');
    const withExtras = structuredClone(original);
    const table = withExtras.flow.elements.find((e) => e.type === 'table');
    // 2 entries applied to the editor's fixed 4 columns should cycle
    // 0,1,0,1 — the exact policy design_renderer.resolve_table_columns
    // documents for a real production render.
    table.style.column_alignments = ['center', 'left'];
    const { template } = designDataToTemplate(withExtras);
    const importedTableItem = template.items.find((i) => i.type === 'itemsTable');
    assert.deepEqual(importedTableItem.columnAlign, ['center', 'left', 'center', 'left']);
  });

  test('rectangle border_radius_mm (Phase 3a) round-trips', () => {
    const t = structuredClone(initialTemplateState);
    const shape = createShape('roundedRect', { x: 20, y: 270 });
    shape.width = 20;
    shape.height = 15;
    shape.radius = 3.5;
    t.items = [...t.items, shape];
    const { designData } = templateToDesignData(t);
    const el = designData.flow.elements.find((e) => e.type === 'rectangle');
    assert.equal(el.style.border_radius_mm, 3.5);
    const { template: reimported } = designDataToTemplate(designData);
    const reimportedShape = reimported.items.find((i) => i.type === 'roundedRect');
    assert.equal(reimportedShape.radius, 3.5);
  });

  test('generic:container round-trips as a real editor shape, not dropped (Phase 4 catalog gap closed)', () => {
    const t = structuredClone(initialTemplateState);
    const shape = createShape('container', { x: 20, y: 270 });
    shape.width = 60;
    shape.height = 40;
    shape.radius = 4;
    shape.fill = '#eeeeee';
    shape.borderColor = '#222222';
    shape.borderWidth = 0.5;
    t.items = [...t.items, shape];
    const { designData } = templateToDesignData(t);
    const el = designData.flow.elements.find((e) => e.type === 'container');
    assert.ok(el, 'generic:container must actually be exported, not dropped');
    assert.equal(el.kind, 'generic');
    assert.equal(el.style.background_color, '#eeeeee');
    assert.equal(el.style.border_color, '#222222');
    assert.equal(el.style.border_width_mm, 0.5);
    assert.equal(el.style.border_radius_mm, 4);
    const errors = validateDesignDataAgainstPython(designData);
    assert.deepEqual(errors, []);
    const { template: reimported, warnings } = designDataToTemplate(designData);
    assert.ok(!warnings.some((w) => w.includes('generic:container')), 'container must not warn as unsupported on import');
    const reimportedShape = reimported.items.find((i) => i.type === 'container');
    assert.ok(reimportedShape, 'container must be reconstructed as a real editor shape on import');
    assert.equal(reimportedShape.kind, 'shape');
    assert.equal(reimportedShape.radius, 4);
    assert.equal(reimportedShape.fill, '#eeeeee');
    assert.equal(reimportedShape.borderColor, '#222222');
    assert.equal(reimportedShape.borderWidth, 0.5);
  });

  test('image border_color/border_width_mm/border_radius_mm (Phase 3a) round-trip', () => {
    const t = structuredClone(initialTemplateState);
    const image = {
      id: 'image-test-2', kind: 'image', dataUrl: 'data:image/png;base64,AAAA',
      x: 20, y: 260, width: 30, height: 20, naturalWidth: 30, naturalHeight: 20,
      rotation: 0, allowFreeLayering: true, cornerRadius: 2, sourceWidth: 30, sourceHeight: 20,
      borderColor: '#000000', borderWidth: 0.5,
    };
    t.items = [...t.items, image];
    const { designData } = templateToDesignData(t);
    const el = designData.flow.elements.find((e) => e.type === 'image');
    assert.equal(el.style.border_color, '#000000');
    assert.equal(el.style.border_width_mm, 0.5);
    assert.equal(el.style.border_radius_mm, 2);
  });
});

// ── 7. Legacy shapes still open/edit correctly (import-only support) ────
describe('legacy semantic:client_info / business_info / dates still import (never produced by export)', () => {
  test('a legacy client_info bundle imports as a real billTo group', () => {
    const legacy = structuredClone(loadFixture('professional'));
    // Replace the decomposed billTo elements with the OLD bundled shape.
    legacy.header.elements = legacy.header.elements.filter((e) =>
      !['client.name', 'client.company', 'client.address', 'client.email'].includes(e.binding) &&
      e.style?.text !== 'Bill to'
    );
    legacy.header.elements.push({
      kind: 'semantic', type: 'client_info', x: 0, y: 42, width: 80, height: 25,
      style: { label: 'Bill to' }, overrides: {},
    });
    const { template, warnings } = designDataToTemplate(legacy);
    assert.ok(template.items.some((i) => i.type === 'billTo'));
    assert.ok(warnings.some((w) => w.includes('client_info')));
    const { designData } = templateToDesignData(template);
    // Re-export always standardizes on the decomposed generic form.
    assert.ok(!([...designData.header.elements].some((e) => e.type === 'client_info')));
    assert.ok([...designData.header.elements].some((e) => e.binding === 'client.name'));
  });
});

// ── 8. Cross-list z-order ─────────────────────────────────────────────
// See this adapter's own `_origIndex` mechanism (designDataToTemplate)
// and the Phase 3c report's own dedicated write-up for the full
// investigation. Summary: WITHIN one region (header-vs-header,
// flow-vs-flow) real stacking order now round-trips exactly — proven
// below by inserting a shape between two flow elements and confirming
// it stays between them, and implicitly by every seed's own full-array
// deepStrictEqual passing above (which would fail immediately on any
// reordering). CROSS-region (a flow element rendering "under" a header
// element or vice versa) is a separate, VERIFIED STRUCTURAL LIMITATION
// of the renderer's own HTML (apps/invoices/templates/invoices/canonical/
// canonical.html: `.v2-header` is a fixed-height box, flow rows are
// separate siblings immediately after it in normal document flow — two
// non-overlapping containers, not one shared stacking context) — no
// array-order fix on either side of this adapter can change that; it
// would require restructuring the renderer's own HTML/CSS (a Python/
// Django-template change, out of this JS-adapter-only phase's scope).
describe('cross-list z-order', () => {
  test('within the flow region, a shape inserted between two flow elements keeps that exact position after a round trip', () => {
    const original = loadFixture('professional');
    const { template } = designDataToTemplate(original);
    const divider = template.items.find((i) => i.type === 'divider' || i.kind === 'shape');
    const tableIdx = template.items.findIndex((i) => i.type === 'itemsTable');
    const shape = createShape('roundedRect', { x: 60, y: 61 });
    shape.width = 10;
    shape.height = 5;
    // Insert directly before the table — between the divider (which
    // exports earlier) and the table (which exports right after) in the
    // real flow stacking order.
    template.items.splice(tableIdx, 0, shape);
    const { designData } = templateToDesignData(template);
    const flowTypes = designData.flow.elements.map((e) => e.type);
    const shapeIdx = flowTypes.indexOf('rectangle');
    const tablePos = flowTypes.indexOf('table');
    assert.ok(shapeIdx !== -1 && tablePos !== -1);
    assert.ok(shapeIdx < tablePos, 'the inserted shape must still paint before the table it was placed before');
    if (divider) {
      const dividerPos = flowTypes.indexOf('divider');
      assert.ok(dividerPos < shapeIdx, 'the shape must still paint after the divider it was placed after');
    }
  });
});
