// src/lib/designEditor/serialization.js
//
// The bidirectional mapping between apps/invoices/design_schema.py's
// design_data JSON and the live GrapesJS component tree. This is the real
// engineering core of Step 8b — everything else (palette, traits, preview)
// is UI wrapped around this contract.
//
// Coordinate convention: design_data is always mm (the schema's own unit —
// see design_schema.py's module docstring). GrapesJS's drag/resize math is
// px-native (its Resizer computes deltas in px), so the canvas itself edits
// in px internally; MM_TO_PX/PX_TO_MM convert only at the two boundaries —
// building the initial component tree from a loaded design_data (mm -> px),
// and reading the live tree back out on save (px -> mm). Nothing in between
// touches mm.
import { MM_TO_PX, PAGE_WIDTH_MM, PX_TO_MM, ZONE_1_HEIGHT_MM } from './constants'

export const ZONE1_CONTAINER_ID = 'lancera-zone1'
export const ZONE2_CONTAINER_ID = 'lancera-zone2'
export const TABLE_COMPONENT_ID = 'lancera-table'

const mmToPx = (mm) => Math.round(mm * MM_TO_PX)
const pxToMm = (px) => Math.round((px * PX_TO_MM) * 100) / 100 // 2dp, matches the schema's own rounding elsewhere

function parsePx(value, fallback = 0) {
  if (value == null) return fallback
  const n = parseFloat(String(value).replace('px', ''))
  return Number.isFinite(n) ? n : fallback
}

// ── design_data -> GrapesJS component-definition tree (load) ──────────────

function zone1ElementComponent(element, content) {
  const { type, x, y, width, height, style = {} } = element
  return {
    type: 'lancera-zone1-element',
    // Real CSS class names (editor_canvas.html's own .lancera-el/.dyn-zone1-el
    // rules — the default thin outline plus the sidebar-badge attribute
    // selector, both loaded once into the canvas iframe head, see
    // DesignEditor.jsx) — never a JS-computed inline style for these.
    classes: ['lancera-el', 'dyn-zone1-el'],
    attributes: {
      'data-el-type': type,
      'data-style-json': JSON.stringify(style),
      ...(style.sidebar ? { 'data-sidebar': 'true' } : {}),
    },
    style: {
      position: 'absolute',
      left: `${mmToPx(x)}px`,
      top: `${mmToPx(y)}px`,
      width: `${mmToPx(width)}px`,
      height: `${mmToPx(height)}px`,
    },
    // Real rendered HTML (apps/invoices/design_renderer.py's own
    // per-element content, see realContent.js) — GrapesJS's own
    // documented "raw content, not parsed into child components"
    // mechanism. Falls back to an empty string only when no real
    // content was fetched (e.g. a brand-new element just dropped from
    // the palette, before its first content fetch resolves).
    content: content || '',
  }
}

function zone2ElementComponent(element, content) {
  const { type, spacing_after_previous = 0, style = {}, paired_side_by_side = false } = element
  return {
    type: 'lancera-zone2-element',
    classes: ['lancera-el', 'dyn-zone2-el'],
    attributes: {
      'data-el-type': type,
      'data-style-json': JSON.stringify(style),
      'data-paired': paired_side_by_side ? 'true' : 'false',
      ...(style.sidebar ? { 'data-sidebar': 'true' } : {}),
    },
    style: {
      'margin-top': `${mmToPx(spacing_after_previous)}px`,
    },
    content: content || '',
  }
}

// Mirrors apps/invoices/design_renderer.py's own _table_style_css exactly
// (the only table-level style property that function computes is
// font-family, from table.style.font) — read directly off design_data
// here rather than re-parsed out of the fetched real HTML's own style
// attribute, since design_data already has it and this is simpler/more
// robust than a CSS-string parser for one property.
function tableStyleObject(tableStyle) {
  return tableStyle?.font ? { 'font-family': `'${tableStyle.font}'` } : {}
}

function tableComponent(table, realContent) {
  const style = (table && table.style) || {}
  return {
    type: 'lancera-table',
    tagName: 'table',
    id: TABLE_COMPONENT_ID,
    classes: ['dyn-items'], // the real class name design_renderer.py's own <table class="dyn-items"> uses
    style: tableStyleObject(style),
    attributes: {
      'data-style-json': JSON.stringify(style),
      'data-sample-rows': '3',
      'data-row-cell-css': realContent ? realContent.tableRowCellCss : '',
    },
    // Real <thead> markup (design_renderer.py's own real header cell
    // colors/borders/font) plus an empty <tbody> for the sample-row
    // generator (componentTypes.js) to populate — sample line items are
    // the one deliberate, task-approved placeholder exception (real line
    // items don't exist yet at design-edit time).
    content: `${realContent ? realContent.tableHeadHtml : '<thead></thead>'}<tbody></tbody>`,
  }
}

/**
 * Builds the top-level component definitions (`editor.setComponents([...])`
 * -ready) from a real design_data payload. The mandatory table is a
 * standalone sibling between zone_1 and the zone_2 elements list —
 * deliberately NOT a reorderable child of the zone_2 container, so "the
 * table always starts zone_2" is true by construction (it isn't in the
 * sortable list at all) rather than something a drag-reorder edge case
 * could ever leapfrog past.
 *
 * `realContent` (20 August 2026 — see realContent.js) is
 * fetchRealCanvasContent's own return shape — each zone1/zone2 element's
 * `content` comes from there, indexed by array position, matching
 * design_data's own element order exactly. Optional (falls back to blank
 * content) so this function still works for the brief window before the
 * first real fetch resolves, or in any test that doesn't need real markup.
 */
export function buildComponentTreeFromDesignData(designData, realContent) {
  const zone1Elements = (designData?.zone_1?.elements || []).map(
    (el, i) => zone1ElementComponent(el, realContent?.zone1Content?.[i]),
  )
  const zone2Elements = (designData?.zone_2?.elements || []).map(
    (el, i) => zone2ElementComponent(el, realContent?.zone2Content?.[i]),
  )
  const table = tableComponent(designData?.zone_2?.table, realContent)

  return [
    {
      type: 'lancera-zone1',
      id: ZONE1_CONTAINER_ID,
      style: {
        position: 'relative',
        width: `${mmToPx(PAGE_WIDTH_MM)}px`,
        height: `${mmToPx(ZONE_1_HEIGHT_MM)}px`,
      },
      components: zone1Elements,
    },
    table,
    {
      type: 'lancera-zone2',
      id: ZONE2_CONTAINER_ID,
      style: {
        width: `${mmToPx(PAGE_WIDTH_MM)}px`,
      },
      components: zone2Elements,
    },
  ]
}

// ── Live editor component tree -> design_data (save) ──────────────────────

function readStyleJson(component) {
  const raw = component.getAttributes()['data-style-json']
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? parsed : {}
  } catch {
    return {}
  }
}

function extractZone1Element(component) {
  const attrs = component.getAttributes()
  const style = component.getStyle() || {}
  return {
    type: attrs['data-el-type'],
    x: pxToMm(parsePx(style.left)),
    y: pxToMm(parsePx(style.top)),
    width: pxToMm(parsePx(style.width)),
    height: pxToMm(parsePx(style.height)),
    style: readStyleJson(component),
  }
}

function extractZone2Element(component) {
  const attrs = component.getAttributes()
  const style = component.getStyle() || {}
  const element = {
    type: attrs['data-el-type'],
    spacing_after_previous: pxToMm(parsePx(style['margin-top'], 0)),
    style: readStyleJson(component),
  }
  if (attrs['data-paired'] === 'true') {
    element.paired_side_by_side = true
  }
  return element
}

/**
 * Reads the live GrapesJS editor state back into a real design_data payload,
 * matching design_schema.py's contract exactly (same shape validate_design_data_schema
 * expects) — the inverse of buildComponentTreeFromDesignData. The table is
 * looked up as a standalone root-level sibling (see that function's own
 * comment on why it's not a zone_2 child), never among zone_2's elements.
 */
export function extractDesignDataFromEditor(editor) {
  const wrapper = editor.getWrapper()
  const zone1 = wrapper.find(`#${ZONE1_CONTAINER_ID}`)[0]
  const zone2 = wrapper.find(`#${ZONE2_CONTAINER_ID}`)[0]
  const tableComp = wrapper.find(`#${TABLE_COMPONENT_ID}`)[0]

  const zone1Elements = zone1 ? zone1.components().map((c) => extractZone1Element(c)) : []
  const zone2Elements = zone2 ? zone2.components().map((c) => extractZone2Element(c)) : []
  const tableStyle = tableComp ? readStyleJson(tableComp) : {}

  return {
    zone_1: { elements: zone1Elements },
    zone_2: { table: { style: tableStyle }, elements: zone2Elements },
  }
}
