// src/lib/designEditor/serialization.test.js
//
// Round-trip test for the design_data <-> GrapesJS mapping (serialization.js)
// against the real schema shape apps/invoices/design_schema.py validates.
// Uses a lightweight fake editor/component object mimicking the exact
// GrapesJS API surface serialization.js actually calls (getWrapper/find/
// getAttributes/getStyle/components) — not a real live GrapesJS instance
// (which needs a real browser canvas/iframe; that side is covered by the
// Playwright browser verification instead, per the task's own split between
// "unit tests of the data layer" and "real browser-driven verification").
import { describe, expect, it } from 'vitest'

import { BUILTIN_DESIGN_DATA } from './builtinDesigns'
import { BLANK_DESIGN_DATA } from './constants'
import { buildComponentTreeFromDesignData, extractDesignDataFromEditor, TABLE_COMPONENT_ID } from './serialization'

// ── Fake GrapesJS component/editor, built directly from the component
//    -definition tree buildComponentTreeFromDesignData produces — enough
//    surface for extractDesignDataFromEditor to operate on unmodified. ──

function makeFakeComponent(def) {
  const attributes = def.attributes || {}
  const style = def.style || {}
  const childDefs = def.components || []
  const children = childDefs.map(makeFakeComponent)

  return {
    getId: () => def.id,
    getAttributes: () => attributes,
    getStyle: () => style,
    components: () => ({
      map: (fn) => children.map(fn),
      forEach: (fn) => children.forEach(fn),
      filter: (fn) => children.filter(fn),
    }),
    find: (selector) => {
      const id = selector.replace('#', '')
      const match = children.find((c) => c.getId() === id)
      return match ? [match] : []
    },
  }
}

function makeFakeEditor(componentTree) {
  const [zone1Def, tableDef, zone2Def] = componentTree
  const byId = {
    [zone1Def.id]: makeFakeComponent(zone1Def),
    [tableDef.id]: makeFakeComponent(tableDef),
    [zone2Def.id]: makeFakeComponent(zone2Def),
  }
  const wrapper = {
    find: (selector) => {
      const id = selector.replace('#', '')
      return byId[id] ? [byId[id]] : []
    },
  }
  return { getWrapper: () => wrapper }
}

function roundTrip(designData) {
  const tree = buildComponentTreeFromDesignData(designData)
  const editor = makeFakeEditor(tree)
  return extractDesignDataFromEditor(editor)
}

// mm -> px -> mm is inherently lossy by design: the canvas's internal
// working unit is px (GrapesJS's own drag/resize math is px-native, see
// serialization.js's module docstring), rounded to whole pixels at build
// time. A real mouse drag in a real browser has the exact same ~1px
// granularity, so this isn't a test artifact to "fix" — it's an honest
// property of a px-based canvas backing a mm-based schema. One px at
// MM_TO_PX's 96dpi assumption is ~0.264mm; asserting within that tolerance
// (rather than a false exact match) is what real round-trip fidelity
// actually looks like here.
const PX_TOLERANCE_MM = 0.3

function expectDesignDataCloseTo(actual, expected) {
  expect(actual.zone_1.elements).toHaveLength(expected.zone_1.elements.length)
  actual.zone_1.elements.forEach((el, i) => {
    const exp = expected.zone_1.elements[i]
    expect(el.type).toBe(exp.type)
    expect(el.style).toEqual(exp.style)
    for (const field of ['x', 'y', 'width', 'height']) {
      expect(Math.abs(el[field] - exp[field])).toBeLessThan(PX_TOLERANCE_MM)
    }
  })

  expect(actual.zone_2.table.style).toEqual(expected.zone_2.table.style)
  expect(actual.zone_2.elements).toHaveLength(expected.zone_2.elements.length)
  actual.zone_2.elements.forEach((el, i) => {
    const exp = expected.zone_2.elements[i]
    expect(el.type).toBe(exp.type)
    expect(el.style).toEqual(exp.style)
    expect(!!el.paired_side_by_side).toBe(!!exp.paired_side_by_side)
    expect(Math.abs(el.spacing_after_previous - exp.spacing_after_previous)).toBeLessThan(PX_TOLERANCE_MM)
  })
}

describe('design_data <-> GrapesJS round-trip', () => {
  it('round-trips the blank starting design_data exactly (no coordinates to round)', () => {
    const result = roundTrip(BLANK_DESIGN_DATA)
    expectDesignDataCloseTo(result, BLANK_DESIGN_DATA)
  })

  it.each(Object.keys(BUILTIN_DESIGN_DATA))('round-trips the real "%s" builtin seed (types/style/order exact, coords within 1px)', (name) => {
    const original = BUILTIN_DESIGN_DATA[name]
    const result = roundTrip(original)
    expectDesignDataCloseTo(result, original)
  })

  it('preserves zone_1 element x/y/width/height precisely enough to survive mm->px->mm', () => {
    const design = {
      zone_1: { elements: [{ type: 'logo', x: 20, y: 16, width: 15, height: 15, style: {} }] },
      zone_2: { table: { style: {} }, elements: [{ type: 'totals', spacing_after_previous: 6, style: {} }] },
    }
    const result = roundTrip(design)
    const el = result.zone_1.elements[0]
    expect(el.x).toBeCloseTo(20, 0)
    expect(el.y).toBeCloseTo(16, 0)
    expect(el.width).toBeCloseTo(15, 0)
    expect(el.height).toBeCloseTo(15, 0)
  })

  it('preserves free-form style dict contents through data-style-json', () => {
    const design = {
      zone_1: {
        elements: [{
          type: 'business_info', x: 39, y: 16, width: 90, height: 17,
          style: { font: 'Source Serif 4', font_size_pt: 21, color: '#1a2b42', eyebrow: 'Invoice', show_tagline: true },
        }],
      },
      zone_2: { table: { style: {} }, elements: [{ type: 'totals', spacing_after_previous: 0, style: {} }] },
    }
    const result = roundTrip(design)
    expect(result.zone_1.elements[0].style).toEqual(design.zone_1.elements[0].style)
  })

  it('preserves paired_side_by_side on the exact two elements set, omits it elsewhere', () => {
    const result = roundTrip(BUILTIN_DESIGN_DATA.professional)
    const paired = result.zone_2.elements.filter((e) => e.paired_side_by_side)
    expect(paired).toHaveLength(2)
    expect(paired.map((e) => e.type).sort()).toEqual(['payment_info', 'signature'])
    const unpaired = result.zone_2.elements.filter((e) => !e.paired_side_by_side)
    unpaired.forEach((e) => expect(e.paired_side_by_side).toBeUndefined())
  })

  it('never includes the synthetic table component id among zone_2 elements', () => {
    const result = roundTrip(BUILTIN_DESIGN_DATA.modern)
    expect(result.zone_2.elements.every((e) => e.type !== undefined)).toBe(true)
    // The table itself must never leak into the elements array as a fake element.
    expect(result.zone_2.elements.some((e) => e.id === TABLE_COMPONENT_ID)).toBe(false)
  })

  it('preserves the table style dict', () => {
    const result = roundTrip(BUILTIN_DESIGN_DATA.minimal)
    expect(result.zone_2.table.style).toEqual(BUILTIN_DESIGN_DATA.minimal.zone_2.table.style)
  })

  it('preserves zone_2 element ordering exactly', () => {
    const result = roundTrip(BUILTIN_DESIGN_DATA.professional)
    const types = result.zone_2.elements.map((e) => e.type)
    const originalTypes = BUILTIN_DESIGN_DATA.professional.zone_2.elements.map((e) => e.type)
    expect(types).toEqual(originalTypes)
  })
})
