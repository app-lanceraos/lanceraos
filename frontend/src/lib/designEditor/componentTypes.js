// src/lib/designEditor/componentTypes.js
//
// Registers the 5 custom GrapesJS component types the canvas is built from,
// matching serialization.js's attribute/style conventions exactly. This is
// where the schema's real constraints (zone_1 free drag/resize vs. zone_2
// flow-reorder-only, the mandatory non-removable table/totals, drag
// containment per zone) become actual editor behavior rather than a save-
// time-only check.
//
// 20 August 2026 rework (see DECISIONS.md's "canvas must render the real
// thing" entry): the two element types' own onRender used to OVERWRITE
// el.innerHTML with a synthetic gray-box-and-label placeholder on every
// render — exactly the "generic abstraction, not the real thing" this
// pass replaces. Real content now comes from each component's own
// `content` property (set at creation from realContent.js's fetched
// markup, or live-refreshed via DesignEditor.jsx's own debounced fetch on
// a style-panel change) — GrapesJS's own documented mechanism for "raw
// HTML content, not re-parsed into child components." The visual badges
// (sidebar/paired/required) are no longer JS-computed inline styles
// either — they're real CSS attribute-selector rules
// (apps/invoices/templates/invoices/editor_canvas.html's own <style>
// block, loaded once into the canvas iframe by DesignEditor.jsx) matching
// the SAME data-sidebar/data-paired/data-sole-totals attributes
// serialization.js already sets — the browser re-applies them
// automatically the moment an attribute value changes, no onRender/
// re-render round-trip needed at all.
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
 *
 * Also toggles the real `data-sole-totals` attribute (20 August 2026) —
 * the "Required" badge is now a plain CSS attribute-selector rule in
 * editor_canvas.html's own stylesheet, not a JS-computed innerHTML
 * string; setting the attribute is all this function needs to do for the
 * badge to appear/disappear, the same way it always did for
 * removability itself.
 */
export function refreshTotalsRemovability(zone2Component) {
  if (!zone2Component) return
  const totalsSiblings = zone2Component.components().filter((c) => c.getAttributes()['data-el-type'] === 'totals')
  const sole = totalsSiblings.length <= 1
  totalsSiblings.forEach((c) => {
    c.set('removable', !sole)
    c.addAttributes({ 'data-sole-totals': sole ? 'true' : 'false' })
  })
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
        //
        // 21 August 2026 SEV1 fix: GrapesJS calls this predicate as
        // `draggable(source, destination, index)` — confirmed directly
        // against grapesjs/dist/grapes.mjs's own ComponentManager.canMove
        // (`draggable(srcModel, target, index)`) and the library's own
        // property docstring ("target and destination components are
        // passed as arguments" — GrapesJS's doc terminology calls the
        // DRAGGED component "target", confusingly). The previous version
        // of this function took only ONE parameter and named it `target`
        // as if it were the destination container — it was actually
        // receiving the dragged element itself (always type
        // 'lancera-zone1-element'), so the check `target.get('type') ===
        // 'lancera-zone1'` could never be true. This made `canMove()`
        // return false for EVERY real drag, which the toolbar "move" icon
        // path never exercises (`tlb-move` only truthy-checks the raw
        // `draggable` property, never calls it as a function) but any
        // direct-body drag AND every block-panel drop DOES exercise (via
        // DropLocationDeterminer.getValidParent's `targetNode.canMove(...)`
        // — see DECISIONS.md's 21 August 2026 SEV1 entry for the full
        // trace. This is why the prior round's own drag verification
        // (the toolbar move icon) appeared to work while a real user's
        // direct drag never could.
        draggable: (source, destination) => !!(destination && destination.get && destination.get('type') === 'lancera-zone1'),
        resizable: { tl: 1, tc: 1, tr: 1, cl: 1, cr: 1, bl: 1, bc: 1, br: 1 },
        droppable: false,
        // Real free-form x/y drag, not GrapesJS's normal in-flow reorder —
        // this is the actual API this step's Puck-vs-GrapesJS research
        // confirmed only GrapesJS's core supports (see DECISIONS.md).
        dmode: 'absolute',
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
        // Same argument-order fix as lancera-zone1-element above — see its comment.
        draggable: (source, destination) => !!(destination && destination.get && destination.get('type') === 'lancera-zone2'),
        droppable: false,
        resizable: false, // zone_2 has no x/y/width/height at all — spacing only
      },
    },
  })

  // ── The mandatory line-items table — a fixed, standalone sibling ────
  // Real header (the actual <thead> HTML design_renderer.py produces —
  // real CSS classes/colors, see serialization.js's tableComponent) with
  // sample rows generated in JS using those SAME real classes — a
  // deliberate, task-approved exception (line items are "inherently
  // invoice-specific and don't exist yet at design-edit time," per this
  // pass's own instructions), not a leftover placeholder.
  DomComponents.addType('lancera-table', {
    model: {
      defaults: {
        name: 'Line Items Table',
        draggable: false,
        droppable: false,
        removable: false,
        copyable: false,
      },
      init() {
        this.on('change:attributes:data-sample-rows', () => this.view && this.view.renderSampleRows())
      },
    },
    view: {
      onRender() {
        this.renderSampleRows()
      },
      renderSampleRows() {
        const el = this.el
        const tbody = el.querySelector('tbody')
        if (!tbody) return
        const attrs = this.model.getAttributes()
        const rows = parseInt(attrs['data-sample-rows'], 10) || 3
        const rowCellCss = attrs['data-row-cell-css'] || ''
        tbody.innerHTML = Array.from({ length: rows }).map((_, i) => `
          <tr>
            <td style="${rowCellCss}">Sample line item ${i + 1}</td>
            <td class="dyn-num-col" style="${rowCellCss}">1</td>
            <td class="dyn-num-col" style="${rowCellCss}">$100.00</td>
            <td class="dyn-num-col" style="${rowCellCss}">$100.00</td>
          </tr>
        `).join('')
      },
    },
  })
}

export { ZONE1_CONTAINER_ID, ZONE2_CONTAINER_ID, TABLE_COMPONENT_ID }
