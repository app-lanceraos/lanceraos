// src/lib/designEditor/serialization.test.js
//
// Template Builder 2.0, Phase 3 — the no-op save / round-trip regression
// test for the V2 canvas adapter (Part 14's own mandatory requirement).
// Uses a lightweight fake editor/component object mimicking the real
// GrapesJS API surface serialization.js actually calls (getWrapper/find/
// getAttributes/getStyle/components) — the identical testing strategy
// designEditor/serialization.test.js (v1) already established and this
// project's own Phase 2/3 precedent for "unit tests of the data layer,
// real browser-driven verification separately" — real live GrapesJS
// interaction is covered by this phase's own Playwright verification.
//
// Unlike v1's fake `find` (a shallow, direct-children-only lookup — v1's
// tree only ever needed that), this fake `find` is genuinely recursive,
// matching real GrapesJS's own Component.find behavior (a deep query
// scoped to a component's whole subtree) — V2's tree nests the elements
// container one level inside a `lancera-v2-content` wrapper, and (when a
// sidebar exists) inside `lancera-v2-sidebar` too, so a shallow find
// would silently miss them.
//
// Phase 4B.2 rewrite (see design_schema.py's own docstring for the
// full architectural reasoning): header.elements and flow.elements no
// longer have different shapes (absolute x/y/width/height vs.
// spacing_after_previous/paired_side_by_side) — every element in either
// list now carries the same real geometry, and the mandatory line-items
// table is a real, positioned element (kind='structural', type='table')
// within flow.elements instead of a separate `flow.table` key. This
// file's own fixtures/assertions are rewritten to match.
import { describe, expect, it } from 'vitest'

import { buildV2ComponentTree, extractV2DesignDataFromEditor } from './serialization'

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
  return { getWrapper: () => wrapper }
}

function roundTrip(designData, doc) {
  const tree = buildV2ComponentTree(doc)
  const editor = makeFakeEditor(tree)
  return extractV2DesignDataFromEditor(editor, designData)
}

// Fabricates a canvas-document shape matching what design_canvas.py's
// build_v2_canvas_document really returns, directly from a real V2
// design_data payload — this test module doesn't hit a real backend
// (that's the browser/Playwright verification's job), but the SHAPE it
// fabricates here matches the real endpoint's response exactly (page/
// header_elements/flow_elements/css), proven by the backend's own
// test_design_canvas.py asserting that exact shape.
function fakeCanvasDocument(designData) {
  const page = designData.page
  const sidebar = page.sidebar || null
  const sidebarWidth = sidebar ? sidebar.width_mm : 0

  const prepare = (el, index) => ({
    index, kind: el.kind, type: el.type, x: el.x, y: el.y, width: el.width, height: el.height,
    style: el.style || {}, overrides: el.overrides || {}, binding: el.binding,
    sidebar: !!(el.style && el.style.sidebar),
    hidden: !!el.hidden, locked: !!el.locked,
    content_html: `<div>${el.type}</div>`,
  })

  return {
    page: {
      ...page,
      effective_margin_left_mm: (page.margin_left_mm ?? 20) + sidebarWidth,
    },
    css: '',
    design_primary_color: '#1a2b42',
    header_elements: designData.header.elements.map(prepare),
    flow_elements: designData.flow.elements.map(prepare),
  }
}

const PX_TOLERANCE_MM = 0.3 // identical, already-accepted mm<->px rounding tolerance v1's own test uses

function baseV2Design(overrides = {}) {
  return {
    schema_version: 2,
    page: { size: 'A4', width_mm: 210, height_mm: 297, margin_top_mm: 16, margin_right_mm: 16, margin_bottom_mm: 16, margin_left_mm: 20, sidebar: null },
    header: {
      elements: [
        { kind: 'semantic', type: 'logo', x: 0, y: 1, width: 15, height: 15, style: {}, overrides: {} },
        { kind: 'semantic', type: 'business_info', x: 20, y: 0, width: 90, height: 25, style: { font: 'Source Serif 4', eyebrow: 'Invoice' }, overrides: {} },
      ],
    },
    flow: {
      elements: [
        { kind: 'structural', type: 'table', x: 0, y: 76, width: 174, height: 45, style: { font: 'IBM Plex Mono' }, overrides: {} },
        { kind: 'semantic', type: 'totals', x: 112, y: 124, width: 62, height: 35, style: { align: 'right' }, overrides: {} },
        { kind: 'semantic', type: 'signature', x: 119, y: 222, width: 55, height: 8, style: {}, overrides: {} },
        { kind: 'semantic', type: 'payment_info', x: 0, y: 198, width: 40, height: 27, style: { variant: 'qr_and_link' }, overrides: {} },
      ],
    },
    ...overrides,
  }
}

function expectDesignDataCloseTo(actual, expected) {
  expect(actual.page).toEqual(expected.page) // page passes through byte-identical — see serialization.js's own docstring

  expect(actual.header.elements).toHaveLength(expected.header.elements.length)
  actual.header.elements.forEach((el, i) => {
    const exp = expected.header.elements[i]
    expect(el.kind).toBe(exp.kind)
    expect(el.type).toBe(exp.type)
    expect(el.style).toEqual(exp.style)
    expect(el.overrides).toEqual(exp.overrides || {})
    for (const field of ['x', 'y', 'width', 'height']) {
      expect(Math.abs(el[field] - exp[field])).toBeLessThan(PX_TOLERANCE_MM)
    }
  })

  expect(actual.flow.elements).toHaveLength(expected.flow.elements.length)
  actual.flow.elements.forEach((el, i) => {
    const exp = expected.flow.elements[i]
    expect(el.kind).toBe(exp.kind)
    expect(el.type).toBe(exp.type)
    expect(el.style).toEqual(exp.style)
    for (const field of ['x', 'y', 'width', 'height']) {
      expect(Math.abs(el[field] - exp[field])).toBeLessThan(PX_TOLERANCE_MM)
    }
  })
}

describe('V2 canvas document <-> GrapesJS round-trip (no-op save protection)', () => {
  it('round-trips a real V2 design with no sidebar (types/kind/style/overrides/geometry exact, coords within 1px), the table included', () => {
    const design = baseV2Design()
    const result = roundTrip(design, fakeCanvasDocument(design))
    expectDesignDataCloseTo(result, design)
  })

  it('round-trips a real V2 design WITH a sidebar — sidebar elements merge back into the same flat arrays, correctly re-sorted by original index', () => {
    const design = baseV2Design({
      page: { size: 'A4', width_mm: 210, height_mm: 297, margin_top_mm: 14, margin_right_mm: 16, margin_bottom_mm: 16, margin_left_mm: 16, sidebar: { width_mm: 42, color: null } },
      header: {
        elements: [
          { kind: 'semantic', type: 'logo', x: 6, y: 14, width: 15, height: 15, style: { sidebar: true }, overrides: {} },
          { kind: 'semantic', type: 'dates', x: 0, y: 0, width: 136, height: 18, style: {}, overrides: {} },
          { kind: 'semantic', type: 'client_info', x: 0, y: 35, width: 63, height: 18, style: {}, overrides: {} },
        ],
      },
      flow: {
        elements: [
          { kind: 'semantic', type: 'payment_info', x: 6, y: 60, width: 20, height: 20, style: { sidebar: true, variant: 'qr_and_link' }, overrides: {} },
          { kind: 'structural', type: 'table', x: 0, y: 72, width: 136, height: 45, style: {}, overrides: {} },
          { kind: 'semantic', type: 'totals', x: 74, y: 135, width: 62, height: 30, style: { variant: 'total_pill' }, overrides: {} },
        ],
      },
    })
    const result = roundTrip(design, fakeCanvasDocument(design))
    expectDesignDataCloseTo(result, design)

    // The sidebar-flagged elements must still be at their ORIGINAL array
    // positions (index 0 among header elements, index 0 among flow
    // elements) after the merge-and-resort, not appended at the end.
    expect(result.header.elements[0].type).toBe('logo')
    expect(result.flow.elements[0].type).toBe('payment_info')
    // The table survives the round-trip at its own original index too —
    // no special-casing separates it from any other flow element.
    expect(result.flow.elements[1].type).toBe('table')
  })

  it('preserves a generic text element\'s binding and static-text style through the round-trip', () => {
    const design = baseV2Design({
      header: {
        elements: [
          { kind: 'generic', type: 'text', x: 10, y: 10, width: 40, height: 8, style: {}, overrides: {}, binding: 'invoice.number' },
          { kind: 'generic', type: 'text', x: 10, y: 20, width: 40, height: 8, style: { text: 'Static label' }, overrides: {} },
        ],
      },
    })
    const result = roundTrip(design, fakeCanvasDocument(design))
    expect(result.header.elements[0].binding).toBe('invoice.number')
    expect(result.header.elements[1].binding).toBeUndefined()
    expect(result.header.elements[1].style.text).toBe('Static label')
  })

  it('preserves the Layers panel\'s hidden/locked flags through the round-trip, omitting them when falsy', () => {
    const design = baseV2Design({
      header: {
        elements: [
          { kind: 'semantic', type: 'logo', x: 0, y: 1, width: 15, height: 15, style: {}, overrides: {}, hidden: true },
          { kind: 'semantic', type: 'business_info', x: 20, y: 0, width: 90, height: 25, style: {}, overrides: {}, locked: true },
        ],
      },
    })
    const result = roundTrip(design, fakeCanvasDocument(design))
    expect(result.header.elements[0].hidden).toBe(true)
    expect(result.header.elements[0].locked).toBeUndefined()
    expect(result.header.elements[1].locked).toBe(true)
    expect(result.header.elements[1].hidden).toBeUndefined()
  })

  it('a locked element is built with draggable/resizable both false', () => {
    const doc = fakeCanvasDocument(baseV2Design())
    doc.header_elements[0].locked = true
    const tree = buildV2ComponentTree(doc)
    const content = tree.find((c) => c.type === 'lancera-v2-content')
    const elements = content.components.find((c) => c.type === 'lancera-v2-elements')
    const lockedComp = elements.components.find((c) => c.attributes['data-el-index'] === '0' && c.attributes['data-el-list'] === 'header')
    expect(lockedComp.draggable).toBe(false)
    expect(lockedComp.resizable).toBe(false)
  })

  it('preserves a non-empty overrides dict through the round-trip', () => {
    const design = baseV2Design({
      header: {
        elements: [
          { kind: 'semantic', type: 'logo', x: 0, y: 0, width: 15, height: 15, style: {}, overrides: { border_radius_mm: 5 } },
        ],
      },
    })
    const result = roundTrip(design, fakeCanvasDocument(design))
    expect(result.header.elements[0].overrides).toEqual({ border_radius_mm: 5 })
  })

  it('preserves generic element types (rectangle/divider/image/container) through the round-trip', () => {
    const design = baseV2Design({
      header: {
        elements: [
          { kind: 'generic', type: 'image', x: 0, y: 0, width: 20, height: 20, style: { src: 'https://example.com/x.png' }, overrides: {} },
          { kind: 'generic', type: 'rectangle', x: 30, y: 0, width: 20, height: 20, style: { background_color: '#eee' }, overrides: {} },
        ],
      },
      flow: {
        elements: [
          { kind: 'structural', type: 'table', x: 0, y: 76, width: 174, height: 45, style: {}, overrides: {} },
          { kind: 'semantic', type: 'totals', x: 112, y: 124, width: 62, height: 35, style: {}, overrides: {} },
          { kind: 'generic', type: 'divider', x: 0, y: 165, width: 174, height: 2, style: { color: '#ccc' }, overrides: {} },
        ],
      },
    })
    const result = roundTrip(design, fakeCanvasDocument(design))
    expect(result.header.elements.map((e) => e.type)).toEqual(['image', 'rectangle'])
    expect(result.flow.elements.map((e) => e.type)).toEqual(['table', 'totals', 'divider'])
  })

  it('preserves the table\'s own style dict exactly, as a real flow element', () => {
    const design = baseV2Design()
    const result = roundTrip(design, fakeCanvasDocument(design))
    const table = result.flow.elements.find((e) => e.type === 'table')
    const expectedTable = design.flow.elements.find((e) => e.type === 'table')
    expect(table.style).toEqual(expectedTable.style)
    expect(table.kind).toBe('structural')
  })

  it('preserves flow element ordering exactly, the table included', () => {
    const design = baseV2Design()
    const result = roundTrip(design, fakeCanvasDocument(design))
    expect(result.flow.elements.map((e) => e.type)).toEqual(design.flow.elements.map((e) => e.type))
  })

  it('does not mutate the original design_data object passed in', () => {
    const design = baseV2Design()
    const snapshot = JSON.parse(JSON.stringify(design))
    roundTrip(design, fakeCanvasDocument(design))
    expect(design).toEqual(snapshot)
  })
})

describe('canvas applies the server-computed css string, not just geometry (Phase 3.2 regression)', () => {
  // Real, live-browser-caught bug: the old headerElementComponent/
  // flowElementComponent used to build their `style` object from scratch
  // using ONLY x/y/width/height, silently discarding every other property
  // (text-align, font-family, font-size, font-weight, color, border-radius)
  // the server had already resolved into el.css — meaning the canonical
  // renderer's own real font fix never reached the canvas at all,
  // confirmed directly with a real Playwright session. These tests build
  // the real component tree (not a full round-trip) and inspect the
  // resulting style objects directly.
  //
  // Phase 4B.2: there is only ONE elements container now
  // (`lancera-v2-elements`, see constants.js) — header and flow elements
  // both render as its direct children, the table included.
  it('applies a header element\'s real font-family/font-size/text-align from el.css', () => {
    const doc = {
      page: { width_mm: 210, height_mm: 297, margin_top_mm: 16, margin_right_mm: 16, margin_bottom_mm: 16, margin_left_mm: 20, sidebar: null },
      css: '',
      design_primary_color: '#1a2b42',
      header_elements: [{
        index: 0, kind: 'semantic', type: 'business_info', x: 20, y: 0, width: 90, height: 25,
        style: { font: 'Source Serif 4', font_size_pt: 21 }, overrides: {}, sidebar: false,
        css: "position:absolute;left:20mm;top:0mm;width:90mm;height:25mm;font-family:'Source Serif 4';font-size:21pt;",
        content_html: '<div class="v2-bizname">Test</div>',
      }],
      flow_elements: [],
    }
    const tree = buildV2ComponentTree(doc)
    const content = tree.find((c) => c.type === 'lancera-v2-content')
    const elements = content.components.find((c) => c.type === 'lancera-v2-elements')
    const el = elements.components[0]
    expect(el.style['font-family']).toBe("'Source Serif 4'")
    expect(el.style['font-size']).toBe('21pt')
    // Geometry must still be the canvas's own px-converted values, not the
    // raw mm strings from el.css.
    expect(el.style.left).toMatch(/px$/)
    expect(el.style.width).toMatch(/px$/)
  })

  it('applies a right-aligned flow element\'s real text-align from el.css, positioned absolutely like every other element', () => {
    const doc = {
      page: { width_mm: 210, height_mm: 297, margin_top_mm: 16, margin_right_mm: 16, margin_bottom_mm: 16, margin_left_mm: 20, sidebar: null },
      css: '',
      design_primary_color: '#1a2b42',
      header_elements: [],
      flow_elements: [{
        index: 0, kind: 'semantic', type: 'totals', x: 112, y: 124, width: 62, height: 35,
        style: { align: 'right' }, overrides: {}, sidebar: false,
        css: 'position:absolute;left:112mm;top:124mm;width:62mm;height:35mm;text-align:right;',
        content_html: '<div class="v2-row">Subtotal</div>',
      }],
    }
    const tree = buildV2ComponentTree(doc)
    const content = tree.find((c) => c.type === 'lancera-v2-content')
    const elements = content.components.find((c) => c.type === 'lancera-v2-elements')
    const el = elements.components[0]
    expect(el.style['text-align']).toBe('right')
    // Geometry must still be the canvas's own px-converted values, not the
    // raw mm strings from el.css.
    expect(el.style.left).toMatch(/px$/)
    expect(el.style.width).toMatch(/px$/)
  })

  it('renders the table as a real lancera-v2-table component with its full content_html, alongside ordinary elements', () => {
    const doc = {
      page: { width_mm: 210, height_mm: 297, margin_top_mm: 16, margin_right_mm: 16, margin_bottom_mm: 16, margin_left_mm: 20, sidebar: null },
      css: '',
      design_primary_color: '#1a2b42',
      header_elements: [],
      flow_elements: [{
        index: 0, kind: 'structural', type: 'table', x: 0, y: 76, width: 174, height: 45,
        style: {}, overrides: {}, sidebar: false,
        css: 'position:absolute;left:0mm;top:76mm;width:174mm;height:45mm;',
        content_html: '<table class="v2-items"><thead></thead><tbody></tbody></table>',
      }],
    }
    const tree = buildV2ComponentTree(doc)
    const content = tree.find((c) => c.type === 'lancera-v2-content')
    const elements = content.components.find((c) => c.type === 'lancera-v2-elements')
    const el = elements.components[0]
    expect(el.type).toBe('lancera-v2-table')
    expect(el.content).toContain('<table')
    expect(el.style.left).toMatch(/px$/)
  })

  it('never lets a passthrough css declaration override the canvas\'s own geometry', () => {
    // Even if el.css contained a conflicting position/left/top/width/height
    // (it never legitimately would, but this proves the merge order is
    // safe either way), the canvas's own computed geometry must win.
    const doc = {
      page: { width_mm: 210, height_mm: 297, margin_top_mm: 16, margin_right_mm: 16, margin_bottom_mm: 16, margin_left_mm: 20, sidebar: null },
      css: '',
      design_primary_color: '#1a2b42',
      header_elements: [{
        index: 0, kind: 'semantic', type: 'logo', x: 0, y: 1, width: 15, height: 15,
        style: {}, overrides: {}, sidebar: false,
        css: 'position:absolute;left:999mm;top:999mm;width:999mm;height:999mm;',
        content_html: '',
      }],
      flow_elements: [],
    }
    const tree = buildV2ComponentTree(doc)
    const content = tree.find((c) => c.type === 'lancera-v2-content')
    const elements = content.components.find((c) => c.type === 'lancera-v2-elements')
    const el = elements.components[0]
    expect(el.style.left).not.toContain('999')
  })
})
