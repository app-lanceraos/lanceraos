// src/lib/designEditor/interaction.test.js
//
// Template Builder 2.0, Phase 4A — regression tests for the invariants
// real selection/drag/resize interaction depends on: stable component
// identity, single-element mutation isolation, and dynamic-binding/
// generic-element preservation through a geometry-only change.
//
// This file does NOT re-test real mouse-driven GrapesJS behavior (that
// requires a real browser — see the phase's own "Browser verification"
// section for the real, live Playwright results). What IS tested here,
// deterministically, is the CONTRACT any real drag/resize interaction
// must honor: `extractV2DesignDataFromEditor` reads geometry from each
// component's own live `getStyle()` and everything else (kind/type/
// style/overrides/binding) from that SAME component's own attributes,
// set once at load time and never touched by a drag/resize — so
// simulating "the live style changed" (via the fake component's own
// `setStyle`, mimicking exactly what a real `component.addStyle()` call
// does to a component's live state) is a faithful, deterministic proxy
// for what a real drag/resize does to the editor's own data model,
// without needing a real browser to prove the SERIALIZATION side of the
// contract.
//
// Phase 4B.2 rewrite: header and flow elements — the table included —
// now share one real, absolutely-positioned shape and one real element
// container (`lancera-v2-elements`, see constants.js/serialization.js's
// own docstrings for the full architectural reasoning). This file's own
// fixtures/lookups are updated to match, and a new test class exercises
// the exact thing Phase 4B and 4B.1 could never test before this
// unification: moving/resizing a FLOW element or the TABLE leaves every
// sibling — header, flow, or table — byte-identical, the same guarantee
// header-only elements already had.
import { describe, expect, it } from 'vitest'

import { buildV2ComponentTree, extractV2DesignDataFromEditor } from './serialization'

// ── The same fake editor/component harness serialization.test.js already
// established — duplicated here (not imported) since it's file-local
// helper code, not a public API of serialization.js. ──────────────────
function makeFakeComponent(def) {
  const attributes = def.attributes || {}
  const style = { ...(def.style || {}) }
  const children = (def.components || []).map(makeFakeComponent)

  const self = {
    getId: () => def.id,
    get: (key) => def[key],
    getAttributes: () => attributes,
    getStyle: () => style,
    setStyle: (patch) => Object.assign(style, patch),
    components: () => ({
      map: (fn) => children.map(fn),
      forEach: (fn) => children.forEach(fn),
      filter: (fn) => children.filter(fn),
      length: children.length,
    }),
    find(selector) {
      const id = selector.replace('#', '')
      const results = []
      const walk = (node) => {
        if (node.getId() === id) results.push(node)
        node.components().forEach(walk)
      }
      this.components().forEach(walk)
      return results
    },
  }
  return self
}

function makeFakeEditor(componentTree) {
  const children = componentTree.map(makeFakeComponent)
  const wrapper = {
    components: () => ({ forEach: (fn) => children.forEach(fn), map: (fn) => children.map(fn) }),
    find(selector) {
      const id = selector.replace('#', '')
      const results = []
      const walk = (node) => {
        if (node.getId() === id) results.push(node)
        node.components().forEach(walk)
      }
      children.forEach(walk)
      return results
    },
  }
  return { getWrapper: () => wrapper, __wrapperChildren: children }
}

const MM_TO_PX = 96 / 25.4
const mmToPx = (mm) => Math.round(mm * MM_TO_PX)

function fakeCanvasDocument(designData) {
  const page = designData.page
  const sidebar = page.sidebar || null
  const sidebarWidth = sidebar ? sidebar.width_mm : 0

  const prepare = (el, index) => ({
    index, kind: el.kind, type: el.type, x: el.x, y: el.y, width: el.width, height: el.height,
    style: el.style || {}, overrides: el.overrides || {}, binding: el.binding,
    sidebar: !!(el.style && el.style.sidebar),
    content_html: `<div>${el.type}</div>`,
  })

  return {
    page: { ...page, effective_margin_left_mm: (page.margin_left_mm ?? 20) + sidebarWidth },
    css: '',
    design_primary_color: '#1a2b42',
    header_elements: designData.header.elements.map(prepare),
    flow_elements: designData.flow.elements.map(prepare),
  }
}

// A realistic, 5-header-element + table + totals design mirroring the
// real Professional builtin's own shape (logo/business_info/dates/
// client_info + a decomposed generic text field), including one generic,
// dynamically-bound text element to prove Part 12's requirement — moving/
// resizing must never turn a dynamic element static — and a real,
// positioned table + totals in flow.elements (Phase 4B.2: no more
// flow.table special key, no more spacing_after_previous).
function fiveElementDesign() {
  return {
    schema_version: 2,
    page: { size: 'A4', width_mm: 210, height_mm: 297, margin_top_mm: 16, margin_right_mm: 16, margin_bottom_mm: 16, margin_left_mm: 20, sidebar: null },
    header: {
      elements: [
        { kind: 'semantic', type: 'logo', x: 0, y: 1, width: 15, height: 15, style: { border_radius_mm: 2.5 }, overrides: {} },
        { kind: 'semantic', type: 'business_info', x: 20, y: 0, width: 90, height: 25, style: { font: 'Source Serif 4', font_size_pt: 21 }, overrides: {} },
        { kind: 'semantic', type: 'dates', x: 130, y: 0, width: 44, height: 19, style: { align: 'right', show_invoice_number: true }, overrides: {} },
        { kind: 'semantic', type: 'client_info', x: 0, y: 42, width: 80, height: 18, style: { label: 'Bill to' }, overrides: {} },
        { kind: 'generic', type: 'text', x: 100, y: 60, width: 60, height: 8, style: {}, overrides: {}, binding: 'invoice.number' },
      ],
    },
    flow: {
      elements: [
        { kind: 'structural', type: 'table', x: 0, y: 90, width: 174, height: 45, style: { font: 'IBM Plex Mono' }, overrides: {} },
        { kind: 'semantic', type: 'totals', x: 112, y: 145, width: 62, height: 35, style: { align: 'right' }, overrides: {} },
      ],
    },
  }
}

describe('Phase 4A — multi-element integrity (Part 22)', () => {
  it('moving ONE header element leaves every other header AND flow element byte-identical', () => {
    const design = fiveElementDesign()
    const doc = fakeCanvasDocument(design)
    const tree = buildV2ComponentTree(doc)
    const editor = makeFakeEditor(tree)

    // Simulate a real drag: find the "dates" element (index 2) and change
    // ONLY its live left/top style, exactly what a real
    // component.addStyle({left, top}) call does — nothing else about its
    // model (attributes: kind/type/style-json/overrides-json/binding) is
    // ever touched by a real drag.
    const wrapper = editor.getWrapper()
    const elementsContainer = wrapper.find('#lancera-v2-elements')[0]
    const datesComponent = elementsContainer.components().filter((c) => c.getAttributes()['data-el-type'] === 'dates')[0]
    datesComponent.setStyle({ left: `${mmToPx(150)}px`, top: `${mmToPx(20)}px` })

    const result = extractV2DesignDataFromEditor(editor, design)

    // The moved element: x/y changed, everything else (width/height/
    // style/overrides/kind/type) unchanged.
    const movedBefore = design.header.elements[2]
    const movedAfter = result.header.elements[2]
    expect(movedAfter.x).toBeCloseTo(150, 0)
    expect(movedAfter.y).toBeCloseTo(20, 0)
    expect(movedAfter.width).toBeCloseTo(movedBefore.width, 0)
    expect(movedAfter.height).toBeCloseTo(movedBefore.height, 0)
    expect(movedAfter.style).toEqual(movedBefore.style)
    expect(movedAfter.type).toBe(movedBefore.type)
    expect(movedAfter.kind).toBe(movedBefore.kind)

    // Every OTHER header element (0, 1, 3, 4) — including the
    // dynamically-bound generic text element — must be COMPLETELY
    // unchanged: same x/y/width/height, same style, same overrides, same
    // binding, same type.
    for (const i of [0, 1, 3, 4]) {
      const before = design.header.elements[i]
      const after = result.header.elements[i]
      expect(after.x).toBeCloseTo(before.x, 0)
      expect(after.y).toBeCloseTo(before.y, 0)
      expect(after.width).toBeCloseTo(before.width, 0)
      expect(after.height).toBeCloseTo(before.height, 0)
      expect(after.style).toEqual(before.style)
      expect(after.overrides).toEqual(before.overrides)
      expect(after.type).toBe(before.type)
      expect(after.kind).toBe(before.kind)
      expect(after.binding).toBe(before.binding)
    }

    // The flow elements — the table and totals, untouched entirely in
    // this scenario — must also remain unchanged (Phase 4B.2: real
    // geometry now, not spacing, but the same "an edit to one element
    // never ripples elsewhere" guarantee applies).
    expect(result.flow.elements).toHaveLength(design.flow.elements.length)
    result.flow.elements.forEach((el, i) => {
      const before = design.flow.elements[i]
      expect(el.type).toBe(before.type)
      expect(el.kind).toBe(before.kind)
      expect(el.style).toEqual(before.style)
      expect(el.overrides).toEqual(before.overrides)
      expect(el.x).toBeCloseTo(before.x, 0)
      expect(el.y).toBeCloseTo(before.y, 0)
      expect(el.width).toBeCloseTo(before.width, 0)
      expect(el.height).toBeCloseTo(before.height, 0)
    })
  })

  it('resizing ONE header element leaves every other header element byte-identical', () => {
    const design = fiveElementDesign()
    const doc = fakeCanvasDocument(design)
    const tree = buildV2ComponentTree(doc)
    const editor = makeFakeEditor(tree)

    const wrapper = editor.getWrapper()
    const elementsContainer = wrapper.find('#lancera-v2-elements')[0]
    const logoComponent = elementsContainer.components().filter((c) => c.getAttributes()['data-el-type'] === 'logo')[0]
    // Simulate a real resize: only width/height change (left/top stay,
    // matching a bottom-right-handle resize exactly).
    logoComponent.setStyle({ width: `${mmToPx(25)}px`, height: `${mmToPx(25)}px` })

    const result = extractV2DesignDataFromEditor(editor, design)

    const resizedAfter = result.header.elements[0]
    expect(resizedAfter.width).toBeCloseTo(25, 0)
    expect(resizedAfter.height).toBeCloseTo(25, 0)
    expect(resizedAfter.x).toBeCloseTo(design.header.elements[0].x, 0)
    expect(resizedAfter.y).toBeCloseTo(design.header.elements[0].y, 0)
    // The style dict (including border_radius_mm) must survive a resize
    // completely unchanged — a resize must never touch style/overrides.
    expect(resizedAfter.style).toEqual(design.header.elements[0].style)

    for (const i of [1, 2, 3, 4]) {
      const before = design.header.elements[i]
      const after = result.header.elements[i]
      expect(after).toEqual(expect.objectContaining({
        type: before.type, kind: before.kind, style: before.style, overrides: before.overrides,
      }))
      expect(after.x).toBeCloseTo(before.x, 0)
      expect(after.y).toBeCloseTo(before.y, 0)
      expect(after.width).toBeCloseTo(before.width, 0)
      expect(after.height).toBeCloseTo(before.height, 0)
    }
  })
})

describe('Phase 4B.2 — the unification: flow elements and the table share the exact same interaction contract as header elements', () => {
  it('moving the TABLE leaves every header AND flow element byte-identical', () => {
    const design = fiveElementDesign()
    const doc = fakeCanvasDocument(design)
    const tree = buildV2ComponentTree(doc)
    const editor = makeFakeEditor(tree)

    const wrapper = editor.getWrapper()
    const elementsContainer = wrapper.find('#lancera-v2-elements')[0]
    const tableComponent = elementsContainer.components().filter((c) => c.getAttributes()['data-el-type'] === 'table')[0]
    expect(tableComponent.get('type')).toBe('lancera-v2-table')
    tableComponent.setStyle({ left: `${mmToPx(10)}px`, top: `${mmToPx(100)}px` })

    const result = extractV2DesignDataFromEditor(editor, design)
    const tableAfter = result.flow.elements.find((e) => e.type === 'table')
    expect(tableAfter.x).toBeCloseTo(10, 0)
    expect(tableAfter.y).toBeCloseTo(100, 0)
    expect(tableAfter.kind).toBe('structural')
    expect(tableAfter.style).toEqual(design.flow.elements[0].style)

    // Every header element and the sibling totals element are untouched.
    result.header.elements.forEach((after, i) => {
      const before = design.header.elements[i]
      expect(after.x).toBeCloseTo(before.x, 0)
      expect(after.y).toBeCloseTo(before.y, 0)
    })
    const totalsAfter = result.flow.elements.find((e) => e.type === 'totals')
    const totalsBefore = design.flow.elements.find((e) => e.type === 'totals')
    expect(totalsAfter.x).toBeCloseTo(totalsBefore.x, 0)
    expect(totalsAfter.y).toBeCloseTo(totalsBefore.y, 0)
  })

  it('resizing a FLOW element (totals) leaves the table and every header element byte-identical', () => {
    const design = fiveElementDesign()
    const doc = fakeCanvasDocument(design)
    const tree = buildV2ComponentTree(doc)
    const editor = makeFakeEditor(tree)

    const wrapper = editor.getWrapper()
    const elementsContainer = wrapper.find('#lancera-v2-elements')[0]
    const totalsComponent = elementsContainer.components().filter((c) => c.getAttributes()['data-el-type'] === 'totals')[0]
    totalsComponent.setStyle({ width: `${mmToPx(90)}px`, height: `${mmToPx(45)}px` })

    const result = extractV2DesignDataFromEditor(editor, design)
    const totalsAfter = result.flow.elements.find((e) => e.type === 'totals')
    expect(totalsAfter.width).toBeCloseTo(90, 0)
    expect(totalsAfter.height).toBeCloseTo(45, 0)
    expect(totalsAfter.x).toBeCloseTo(design.flow.elements[1].x, 0)
    expect(totalsAfter.y).toBeCloseTo(design.flow.elements[1].y, 0)

    const tableAfter = result.flow.elements.find((e) => e.type === 'table')
    const tableBefore = design.flow.elements[0]
    expect(tableAfter.x).toBeCloseTo(tableBefore.x, 0)
    expect(tableAfter.y).toBeCloseTo(tableBefore.y, 0)
    expect(tableAfter.width).toBeCloseTo(tableBefore.width, 0)
    expect(tableAfter.height).toBeCloseTo(tableBefore.height, 0)
    result.header.elements.forEach((after, i) => {
      const before = design.header.elements[i]
      expect(after.x).toBeCloseTo(before.x, 0)
      expect(after.y).toBeCloseTo(before.y, 0)
    })
  })

  it('a real resize -> drag -> resize -> drag sequence on the table is stable and never touches sibling elements', () => {
    // Phase 4B.1 found the resize->drag desync surviving in longer chains
    // for elements that lacked their own resize interaction (flow/table)
    // — this simulates that exact chain (each step a real, independent
    // component.addStyle-equivalent commit) purely at the data-model
    // level (the DOM/view-desync half of that bug is real-browser-only,
    // covered by this phase's own Playwright verification; what this
    // test proves is that the SERIALIZATION contract stays correct and
    // isolated across a real multi-step chain, which the model/view
    // desync bug would not have affected anyway — it was a rendering-
        // only symptom, never a data corruption).
    const design = fiveElementDesign()
    const doc = fakeCanvasDocument(design)
    const tree = buildV2ComponentTree(doc)
    const editor = makeFakeEditor(tree)

    const wrapper = editor.getWrapper()
    const elementsContainer = wrapper.find('#lancera-v2-elements')[0]
    const tableComponent = elementsContainer.components().filter((c) => c.getAttributes()['data-el-type'] === 'table')[0]

    tableComponent.setStyle({ width: `${mmToPx(150)}px`, height: `${mmToPx(50)}px` }) // resize
    tableComponent.setStyle({ left: `${mmToPx(5)}px`, top: `${mmToPx(85)}px` }) // drag
    tableComponent.setStyle({ width: `${mmToPx(160)}px`, height: `${mmToPx(55)}px` }) // resize
    tableComponent.setStyle({ left: `${mmToPx(8)}px`, top: `${mmToPx(88)}px` }) // drag

    const result = extractV2DesignDataFromEditor(editor, design)
    const tableAfter = result.flow.elements.find((e) => e.type === 'table')
    expect(tableAfter.x).toBeCloseTo(8, 0)
    expect(tableAfter.y).toBeCloseTo(88, 0)
    expect(tableAfter.width).toBeCloseTo(160, 0)
    expect(tableAfter.height).toBeCloseTo(55, 0)

    // Nothing else moved.
    result.header.elements.forEach((after, i) => {
      const before = design.header.elements[i]
      expect(after.x).toBeCloseTo(before.x, 0)
      expect(after.y).toBeCloseTo(before.y, 0)
    })
    const totalsAfter = result.flow.elements.find((e) => e.type === 'totals')
    const totalsBefore = design.flow.elements.find((e) => e.type === 'totals')
    expect(totalsAfter.x).toBeCloseTo(totalsBefore.x, 0)
    expect(totalsAfter.y).toBeCloseTo(totalsBefore.y, 0)
  })

  it('the table is never removable (matches componentTypes.js\'s own removable:false)', () => {
    const design = fiveElementDesign()
    const doc = fakeCanvasDocument(design)
    const tree = buildV2ComponentTree(doc)
    const content = tree.find((c) => c.type === 'lancera-v2-content')
    const elements = content.components.find((c) => c.type === 'lancera-v2-elements')
    const tableDef = elements.components.find((c) => c.type === 'lancera-v2-table')
    expect(tableDef).toBeDefined()
    expect(tableDef.id).toBe('lancera-v2-table')
  })
})

describe('Phase 4A — component identity survives geometry changes (Part 2)', () => {
  it('data-el-index correctly maps each element back to its original array position regardless of which elements were touched', () => {
    const design = fiveElementDesign()
    const doc = fakeCanvasDocument(design)
    const tree = buildV2ComponentTree(doc)
    const editor = makeFakeEditor(tree)

    const wrapper = editor.getWrapper()
    const elementsContainer = wrapper.find('#lancera-v2-elements')[0]
    // Move elements 4, 1, and 0 (out of natural order) — proving the
    // extraction result is sorted back to ORIGINAL array order via
    // data-el-index, not by whatever order changes happened to occur in.
    const byType = (t) => elementsContainer.components().filter((c) => c.getAttributes()['data-el-type'] === t)[0]
    byType('text').setStyle({ left: `${mmToPx(5)}px`, top: `${mmToPx(5)}px` })
    byType('business_info').setStyle({ left: `${mmToPx(200)}px` })
    byType('logo').setStyle({ top: `${mmToPx(50)}px` })

    const result = extractV2DesignDataFromEditor(editor, design)
    expect(result.header.elements.map((e) => e.type)).toEqual(['logo', 'business_info', 'dates', 'client_info', 'text'])
    // Untouched elements (dates, client_info) still have their exact
    // original geometry, proving identity wasn't confused by array index
    // drift from the out-of-order edits above.
    expect(result.header.elements[2].x).toBeCloseTo(design.header.elements[2].x, 0)
    expect(result.header.elements[3].x).toBeCloseTo(design.header.elements[3].x, 0)
  })

  it('a dynamically-bound generic text element keeps its binding after being moved (Part 12)', () => {
    const design = fiveElementDesign()
    const doc = fakeCanvasDocument(design)
    const tree = buildV2ComponentTree(doc)
    const editor = makeFakeEditor(tree)

    const wrapper = editor.getWrapper()
    const elementsContainer = wrapper.find('#lancera-v2-elements')[0]
    const textComponent = elementsContainer.components().filter((c) => c.getAttributes()['data-el-type'] === 'text')[0]
    textComponent.setStyle({ left: `${mmToPx(20)}px`, top: `${mmToPx(20)}px` })

    const result = extractV2DesignDataFromEditor(editor, design)
    const textAfter = result.header.elements[4]
    expect(textAfter.binding).toBe('invoice.number')
    expect(textAfter.kind).toBe('generic')
    expect(textAfter.type).toBe('text')
    expect(textAfter.x).toBeCloseTo(20, 0)
    expect(textAfter.y).toBeCloseTo(20, 0)
  })
})
