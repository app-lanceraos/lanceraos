// src/lib/designEditor/componentTypes.js
//
// Registers the 5 custom GrapesJS component types the canvas is built from,
// matching serialization.js's attribute/style conventions exactly. This is
// where the schema's real constraints (zone_1 free drag/resize vs. zone_2
// flow-reorder-only, the mandatory non-removable table/totals, drag
// containment per zone) become actual editor behavior rather than a save-
// time-only check.
import { PAIRABLE_ZONE_2_TYPES, ZONE_1_TYPE_META, ZONE_2_TYPE_META } from './constants'
import { isTotalsElementRemovable } from './rules'
import { TABLE_COMPONENT_ID, ZONE1_CONTAINER_ID, ZONE2_CONTAINER_ID } from './serialization'

function countSiblingsOfType(component, elType) {
  const parent = component.parent()
  if (!parent) return 0
  return parent.components().filter((c) => c.getAttributes()['data-el-type'] === elType).length
}

/**
 * GrapesJS's own delete command (and its toolbar delete button) checks
 * `component.get('removable')` as a plain property read — NOT a method
 * call — confirmed directly against this project's actual installed
 * grapesjs/dist/grapes.mjs (core/commands, core:component-delete) rather
 * than assumed from docs. A function stored there is read back as a
 * truthy value, never invoked — so "removable only while another totals
 * sibling exists" (a live count, not a static flag) has to be enforced by
 * actively setting the real `removable` property on every totals sibling
 * whenever zone_2's children change, not by overriding a check method
 * (an earlier version of this file tried exactly that and it silently did
 * nothing — caught by this step's own Playwright verification, not
 * assumed correct from reading GrapesJS's docs alone).
 */
export function refreshTotalsRemovability(zone2Component) {
  if (!zone2Component) return
  const allTypes = zone2Component.components().map((c) => c.getAttributes()['data-el-type'])
  zone2Component.components()
    .filter((c) => c.getAttributes()['data-el-type'] === 'totals')
    .forEach((c) => c.set('removable', isTotalsElementRemovable('totals', allTypes)))
}

export function registerComponentTypes(editor) {
  const { DomComponents } = editor

  // ── Zone 1 — the fixed-height, free-form canvas region ──────────────
  DomComponents.addType('lancera-zone1', {
    model: {
      defaults: {
        name: 'Zone 1 (fixed layout)',
        draggable: false,
        removable: false,
        copyable: false,
        droppable: (source) => source.get && source.get('type') === 'lancera-zone1-element',
        attributes: { 'data-lancera-zone1': 'true' },
      },
    },
  })

  DomComponents.addType('lancera-zone1-element', {
    model: {
      defaults: {
        removable: true,
        copyable: false,
        // Only draggable back into the same Zone 1 container — never into Zone 2.
        draggable: (target) => target.get && target.get('type') === 'lancera-zone1',
        resizable: { tl: 1, tc: 1, tr: 1, cl: 1, cr: 1, bl: 1, bc: 1, br: 1 },
        droppable: false,
        // Real free-form x/y drag, not GrapesJS's normal in-flow reorder —
        // this is the actual API this step's Puck-vs-GrapesJS research
        // confirmed only GrapesJS's core supports (see DECISIONS.md).
        dmode: 'absolute',
      },
      init() {
        this.on('change:attributes:data-style-json', () => this.view && this.view.render())
      },
    },
    view: {
      onRender() {
        const attrs = this.model.getAttributes()
        const elType = attrs['data-el-type']
        const meta = ZONE_1_TYPE_META[elType]
        let style = {}
        try { style = JSON.parse(attrs['data-style-json'] || '{}') } catch { /* keep {} */ }

        const el = this.el
        el.style.display = 'flex'
        el.style.alignItems = 'center'
        el.style.justifyContent = 'center'
        el.style.overflow = 'hidden'
        el.style.fontSize = '11px'
        el.style.fontFamily = 'var(--font, sans-serif)'
        el.style.textAlign = 'center'
        el.style.padding = '4px'
        el.style.boxSizing = 'border-box'
        el.style.background = style.sidebar ? 'rgba(45,42,110,0.12)' : 'rgba(0,200,150,0.10)'
        el.style.border = style.sidebar ? '1.5px dashed #2d2a6e' : '1.5px dashed #00a87e'
        el.style.borderRadius = '4px'
        el.style.color = style.sidebar ? '#2d2a6e' : '#00654a'
        el.innerHTML = `<span>${style.label || (meta ? meta.label : elType)}${style.sidebar ? ' 🗄' : ''}</span>`
      },
    },
  })

  // ── Zone 2 — the flow-only, spacing-based region below the table ────
  DomComponents.addType('lancera-zone2', {
    model: {
      defaults: {
        name: 'Zone 2 (flow layout)',
        draggable: false,
        removable: false,
        copyable: false,
        droppable: (source) => source.get && source.get('type') === 'lancera-zone2-element',
      },
      // NOT wired here via this.on('add remove', ...) — a real first
      // attempt at exactly that silently did nothing: 'add'/'remove' fire
      // on the child *collection* (this.components()), not on the
      // container model itself, and Backbone doesn't bubble collection
      // events onto the model that owns it. Confirmed by this step's own
      // Playwright verification (a second totals element stayed
      // removable after its sibling was deleted) before being traced to
      // this cause — refreshTotalsRemovability is instead called from
      // DesignEditor.jsx's editor-level 'component:add'/'component:remove'
      // listeners, which really do fire for every change anywhere in the
      // tree. See DECISIONS.md.
    },
  })

  DomComponents.addType('lancera-zone2-element', {
    model: {
      defaults: {
        copyable: false,
        // Only draggable/sortable back into the same Zone 2 container — never Zone 1.
        draggable: (target) => target.get && target.get('type') === 'lancera-zone2',
        droppable: false,
        resizable: false, // zone_2 has no x/y/width/height at all — spacing only
      },
      init() {
        this.on('change:attributes:data-style-json change:attributes:data-paired', () => this.view && this.view.render())
      },
    },
    view: {
      onRender() {
        const attrs = this.model.getAttributes()
        const elType = attrs['data-el-type']
        const meta = ZONE_2_TYPE_META[elType]
        let style = {}
        try { style = JSON.parse(attrs['data-style-json'] || '{}') } catch { /* keep {} */ }
        const paired = attrs['data-paired'] === 'true'

        const el = this.el
        el.style.display = 'flex'
        el.style.alignItems = 'center'
        el.style.gap = '8px'
        el.style.padding = '10px 12px'
        el.style.fontSize = '12px'
        el.style.fontFamily = 'var(--font, sans-serif)'
        el.style.boxSizing = 'border-box'
        el.style.background = 'rgba(0,120,255,0.08)'
        el.style.border = paired ? '1.5px solid #6656cf' : '1.5px dashed #3d7fd9'
        el.style.borderRadius = '6px'
        el.style.color = '#1a3a5f'
        const mandatoryBadge = elType === 'totals' && countSiblingsOfType(this.model, 'totals') <= 1
          ? ' <span style="opacity:.6">(required)</span>' : ''
        const pairedBadge = paired ? ' <span style="color:#6656cf">⇄ paired</span>' : ''
        el.innerHTML = `<span>${style.label || (meta ? meta.label : elType)}${mandatoryBadge}${pairedBadge}</span>`
      },
    },
  })

  // ── The mandatory line-items table — a fixed, standalone sibling ────
  // Real rows rendered from `data-sample-rows` (default 3, set by the
  // editor's sample-row-count toggle) — the whole point is that changing
  // this genuinely changes the table's rendered height, which pushes
  // Zone 2's real, normal-flow siblings down exactly the way a heavier
  // real invoice would, per the task's own "make sure it's a real
  // functional check, not decorative" requirement.
  DomComponents.addType('lancera-table', {
    model: {
      defaults: {
        name: 'Line Items Table',
        draggable: false,
        droppable: false,
        removable: false,
        copyable: false,
        attributes: { id: TABLE_COMPONENT_ID, 'data-sample-rows': '3' },
      },
      init() {
        this.on('change:attributes:data-sample-rows', () => this.view && this.view.render())
      },
    },
    view: {
      onRender() {
        const el = this.el
        const rows = parseInt(this.model.getAttributes()['data-sample-rows'], 10) || 3
        el.style.fontFamily = 'var(--font, sans-serif)'
        el.style.fontSize = '11px'
        el.style.margin = '4px 0'
        el.style.border = '2px solid var(--border-strong, #999)'
        el.style.borderRadius = '6px'
        el.style.overflow = 'hidden'
        el.style.color = 'var(--text-primary, #222)'

        const header = `<div style="display:flex;justify-content:space-between;padding:6px 10px;background:rgba(0,0,0,0.06);font-weight:700;">
          <span>Line Items Table (required)</span><span>${rows} sample rows</span>
        </div>`
        const rowDivs = Array.from({ length: rows }).map((_, i) => `
          <div style="display:flex;justify-content:space-between;padding:5px 10px;border-top:1px solid rgba(0,0,0,0.08);">
            <span>Sample line item ${i + 1}</span><span>$100.00</span>
          </div>
        `).join('')
        el.innerHTML = header + rowDivs
      },
    },
  })
}

export { PAIRABLE_ZONE_2_TYPES, ZONE1_CONTAINER_ID, ZONE2_CONTAINER_ID, TABLE_COMPONENT_ID }
