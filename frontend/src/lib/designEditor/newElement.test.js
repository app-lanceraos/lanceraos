// src/lib/designEditor/newElement.test.js
//
// Master Blueprint cutover — real unit coverage for the "add a new
// element" mechanism (computeNewElementPlacement/buildNewElementEntry,
// serialization.js), the single largest capability gap the blueprint's
// own audit confirmed (by direct grep, not assumption) was missing from
// every prior Template Builder 2.0 phase. Uses the same lightweight
// fake-editor strategy serialization.test.js already established, with
// one small addition (a real `append` on the fake container) so a
// realistic add-then-extract round trip can be tested end to end without
// a real GrapesJS instance or a live browser.
import { describe, expect, it } from 'vitest'

import { GENERIC_TYPE_DEFAULTS, ELEMENTS_CONTAINER_ID } from './constants'
import {
  buildNewElementEntry, buildV2ComponentTree, computeNewElementPlacement, extractV2DesignDataFromEditor,
} from './serialization'

function makeFakeComponent(def) {
  const attributes = def.attributes || {}
  const style = { ...(def.style || {}) }
  let children = (def.components || []).map(makeFakeComponent)

  const self = {
    getId: () => def.id,
    get: (key) => def[key],
    getAttributes: () => attributes,
    getStyle: () => style,
    components: () => ({
      map: (fn) => children.map(fn),
      forEach: (fn) => children.forEach(fn),
      filter: (fn) => children.filter(fn),
      length: children.length,
    }),
    append(childDef) {
      const child = makeFakeComponent(childDef)
      children = [...children, child]
      return [child]
    },
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

const BASE_DOC = {
  schema_version: 2,
  page: { size: 'A4', width_mm: 210, height_mm: 297, margin_top_mm: 16, margin_right_mm: 16, margin_bottom_mm: 16, margin_left_mm: 20, sidebar: null },
  header_elements: [
    { index: 0, kind: 'semantic', type: 'logo', x: 0, y: 1, width: 15, height: 15, style: {}, overrides: {}, binding: null, sidebar: false, css: 'position:absolute;left:0mm;top:1mm;width:15mm;height:15mm;', content_html: '<logo/>' },
  ],
  flow_elements: [
    { index: 0, kind: 'structural', type: 'table', x: 0, y: 76, width: 174, height: 45, style: {}, overrides: {}, binding: null, sidebar: false, css: 'position:absolute;left:0mm;top:76mm;width:174mm;height:45mm;', content_html: '<table/>' },
    { index: 1, kind: 'semantic', type: 'signature', x: 119, y: 234, width: 55, height: 8, style: {}, overrides: {}, binding: null, sidebar: false, css: 'position:absolute;left:119mm;top:234mm;width:55mm;height:8mm;', content_html: '<sig/>' },
  ],
  design_primary_color: '#1a2b42', design_secondary_color: '#a8813c', fonts: {},
}

describe('computeNewElementPlacement', () => {
  it('places a new element directly below the lowest existing element', () => {
    const editor = makeFakeEditor(buildV2ComponentTree(BASE_DOC))
    const { x, y } = computeNewElementPlacement(editor)
    // signature's own real bottom edge is 234 + 8 = 242mm; the table's is
    // 76 + 45 = 121mm — the lower of the two (signature) must win.
    expect(x).toBe(0)
    expect(y).toBeCloseTo(242 + 6, 0) // +6mm real gap; 0dp tolerance absorbs real mm<->px rounding noise
  })

  it('falls back to a small, sane default on a genuinely empty canvas', () => {
    const emptyDoc = { ...BASE_DOC, header_elements: [], flow_elements: [] }
    const editor = makeFakeEditor(buildV2ComponentTree(emptyDoc))
    const { x, y } = computeNewElementPlacement(editor)
    expect(x).toBe(10)
    expect(y).toBe(10)
  })

  it('never lands at the same hardcoded (20,20) spot regardless of what already exists — the TB-005 bug class this closes', () => {
    const editor1 = makeFakeEditor(buildV2ComponentTree(BASE_DOC))
    const denser = {
      ...BASE_DOC,
      flow_elements: [
        ...BASE_DOC.flow_elements,
        { index: 2, kind: 'generic', type: 'text', x: 0, y: 260, width: 60, height: 10, style: {}, overrides: {}, binding: null, sidebar: false, css: 'position:absolute;left:0mm;top:260mm;width:60mm;height:10mm;', content_html: '' },
      ],
    }
    const editor2 = makeFakeEditor(buildV2ComponentTree(denser))
    const p1 = computeNewElementPlacement(editor1)
    const p2 = computeNewElementPlacement(editor2)
    expect(p1.y).not.toBe(p2.y)
  })
})

describe('buildNewElementEntry + add-then-extract round trip', () => {
  it('a newly added bound text element appears correctly in the extracted design_data', () => {
    const doc = BASE_DOC
    const tree = buildV2ComponentTree(doc)
    const editor = makeFakeEditor(tree)

    const meta = GENERIC_TYPE_DEFAULTS.text
    const { x, y } = computeNewElementPlacement(editor)
    const componentDef = buildNewElementEntry({
      type: 'text', binding: 'client.name', x, y, width: meta.width, height: meta.height,
      contentHtml: '<p>Client Name</p>', index: 2, // flow_elements already has indices 0/1
    })

    const container = editor.getWrapper().find(`#${ELEMENTS_CONTAINER_ID}`)[0]
    container.append(componentDef)

    const result = extractV2DesignDataFromEditor(editor, doc)
    const added = result.flow.elements.find((el) => el.binding === 'client.name')
    expect(added).toBeTruthy()
    expect(added.kind).toBe('generic')
    expect(added.type).toBe('text')
    expect(added.x).toBe(x)
    expect(added.y).toBeCloseTo(y, 0) // px-rounding-tolerant, matching the codebase's own mm<->px conversion discipline
    expect(added.width).toBeCloseTo(meta.width, 0)
    expect(added.height).toBeCloseTo(meta.height, 0)

    // Every pre-existing element must survive completely unaffected —
    // the same "adding one element changes only that element" invariant
    // this codebase already enforces for style/geometry edits.
    expect(result.flow.elements).toHaveLength(3)
    expect(result.header.elements).toHaveLength(1)
    const table = result.flow.elements.find((el) => el.type === 'table')
    expect(table.x).toBe(0)
    expect(table.y).toBeCloseTo(76, 0)
  })

  it('a static (unbound) generic element has binding: null, never an empty string', () => {
    const doc = BASE_DOC
    const editor = makeFakeEditor(buildV2ComponentTree(doc))
    const meta = GENERIC_TYPE_DEFAULTS.rectangle
    const componentDef = buildNewElementEntry({
      type: 'rectangle', binding: null, x: 10, y: 10, width: meta.width, height: meta.height,
      contentHtml: '', index: 2,
    })
    editor.getWrapper().find(`#${ELEMENTS_CONTAINER_ID}`)[0].append(componentDef)
    const result = extractV2DesignDataFromEditor(editor, doc)
    const added = result.flow.elements.find((el) => el.type === 'rectangle')
    expect(added).toBeTruthy()
    expect(added.binding === null || added.binding === undefined).toBe(true)
  })
})
