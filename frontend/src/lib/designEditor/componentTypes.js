// src/lib/designEditor/componentTypes.js
//
// Registers the GrapesJS component types the production canvas is built
// from — namespaced `lancera-v2-*` throughout (see constants.js), a
// leftover of this schema's own internal naming history but functionally
// just a stable type-id prefix; not visible anywhere in the product.
//
// Draggable predicates use the SAME fixed, two-argument
// `(source, destination) => ...` signature v1's own 21 August 2026 SEV1
// fix established (designEditor/componentTypes.js's own long comment on
// this — GrapesJS calls `draggable(source, destination, index)`, and an
// earlier version of that fix, tested only via the toolbar move icon,
// missed that the toolbar path never calls this predicate as a function
// at all; a real body/block-panel drag does). Reusing the already-proven,
// already-audited signature here rather than re-deriving it.
//
// Phase 4B.2 — the core structural change (see design_schema.py's own
// docstring for the full architectural reasoning): header and flow
// elements — the mandatory line-items table included — now share ONE
// real, absolutely-positioned, drag+resize-anywhere shape and go through
// the exact same interaction code path. This is a DELIBERATE fix for the
// resize→drag desync bug class Phase 4B.1 found surviving in longer
// interaction chains: flow elements and the table used to have no x/y/
// resize interaction of their own at all (flow was spacing-only, the
// table wasn't a real element), so they never exercised — and never
// benefited from — the same commit/resync fixes header elements already
// had. Unifying the type removes that second, differently-behaved code
// path entirely rather than patching it a second time.
const ELEMENT_DROP_TARGET_TYPES = ['lancera-v2-elements', 'lancera-v2-sidebar-elements']
const ELEMENT_COMPONENT_TYPES = ['lancera-v2-element', 'lancera-v2-table']

export function registerComponentTypes(editor) {
  const { DomComponents } = editor

  // ── The optional, real, full-height sidebar column ───────────────────
  DomComponents.addType('lancera-v2-sidebar', {
    model: {
      defaults: {
        name: 'Sidebar',
        draggable: false,
        removable: false,
        copyable: false,
        // No drag-between-coordinate-spaces interaction is built — an
        // element's main-content-vs-sidebar membership is fixed at load
        // time, matching the real design_data it came from (its own
        // style.sidebar flag).
        droppable: false,
      },
    },
  })

  DomComponents.addType('lancera-v2-sidebar-elements', {
    model: {
      defaults: {
        name: 'Sidebar elements',
        draggable: false,
        removable: false,
        copyable: false,
        droppable: (source) => !!(source && source.get && ELEMENT_COMPONENT_TYPES.includes(source.get('type'))),
      },
    },
  })

  // ── The main page content column ─────────────────────────────────────
  DomComponents.addType('lancera-v2-content', {
    model: {
      defaults: {
        name: 'Page content',
        draggable: false,
        removable: false,
        copyable: false,
        droppable: false,
      },
    },
  })

  // ── The ONE real coordinate-space container for every non-sidebar
  //    element (absolutely-positioned, drag+resize within its own
  //    container only) — replacing the old separate header/flow
  //    containers now that both share one shape. ───────────────────────
  DomComponents.addType('lancera-v2-elements', {
    model: {
      defaults: {
        name: 'Elements',
        draggable: false,
        removable: false,
        copyable: false,
        droppable: (source) => !!(source && source.get && ELEMENT_COMPONENT_TYPES.includes(source.get('type'))),
      },
    },
  })

  // Phase 4A real-browser fix, generalized in 4B.2 to every element type
  // (previously header-only): GrapesJS's own Resizer defaults to
  // `silentFrames: false` (grapesjs/dist/grapes.mjs's own Resizer class)
  // — meaning it does NOT disable pointer-events on the canvas iframe
  // while a resize drag is in progress. Since the resize handles render
  // as an overlay in the MAIN document while the actual element being
  // resized sits INSIDE the canvas iframe, a real mouse drag that
  // crosses over the iframe's own bounding box has its pointermove
  // events captured by the iframe's own document instead of reaching
  // the Resizer's document-level listener — the resize silently stops
  // tracking partway through. Confirmed directly, not assumed: a live
  // Playwright drag on the bottom-right handle produced a
  // `.gjs-resizing` body class (proving the Resizer genuinely started)
  // but zero width/height change at every intermediate step and at
  // mouseup. This is a real, environment-independent DOM event-routing
  // behavior — it affects a genuine human mouse drag identically, not
  // just automated input. GrapesJS's own internal PanelView resizer
  // (used for its layout-panel resize handles) already sets this exact
  // option for the same reason, confirmed directly in its own source.
  // `resizable` here is spread verbatim into the Resizer's own options
  // object (confirmed via ComponentsView.initResize's own
  // `isObject(resizableResult) ? resizableResult : {}` merge), so this
  // is a real, supported per-component override, not a hack.
  //
  // A second, separate real bug, found by patching GrapesJS's own
  // Resizer.prototype.stop/updateRect directly to log its internal
  // state (silentFrames alone was not sufficient): the built-in resize
  // command's own final commit path
  // (`em.Styles.getModelToStyle(component).addStyle(...)`) receives the
  // exactly-correct final rect and `store:true` — confirmed directly,
  // logged live — yet the change never reaches the real component model
  // or the rendered DOM. A direct `component.addStyle(...)` call (the
  // same API extractV2DesignDataFromEditor's own save path already
  // trusts) was independently confirmed to work correctly. `updateTarget`
  // below is a real, documented Resizer option (see Resizer.ts's own
  // `this.updateTarget = opts.updateTarget`) — providing our own bypasses
  // only the broken internal commit step, not the Resizer's own
  // (already-proven-correct) delta/rect computation, handle rendering, or
  // event wiring. Applies the live rect directly to the DOM on every call
  // (immediate visual feedback during the drag) and additionally commits
  // it to the real component model via addStyle — matching GrapesJS's own
  // intended avoidStore semantics (`store` is only true on the final
  // mouseup call).
  function resizableConfig() {
    return {
      tl: 1, tc: 1, tr: 1, cl: 1, cr: 1, bl: 1, bc: 1, br: 1, silentFrames: true,
      updateTarget: (el, rect, options) => {
        el.style.left = `${rect.l}px`
        el.style.top = `${rect.t}px`
        el.style.width = `${rect.w}px`
        el.style.height = `${rect.h}px`
        const comp = editor.getSelected()
        if (comp && comp.getEl && comp.getEl() === el) {
          comp.addStyle(
            { left: `${rect.l}px`, top: `${rect.t}px`, width: `${rect.w}px`, height: `${rect.h}px` },
            { avoidStore: !options.store },
          )
          // Phase 4B.1 real fix (found via live model/DOM inspection, not
          // assumed): on the FINAL commit only (options.store),
          // comp.addStyle() above correctly updates the component's own
          // MODEL — confirmed directly, comp.getStyle() always showed the
          // right values — but the component's VIEW does not re-sync the
          // DOM to match, breaking every SUBSEQUENT interaction on this
          // same element (confirmed both directions: a later drag
          // silently stops moving it visually, and — symmetrically — a
          // resize right after a plain drag shows the identical desync).
          // Manually forcing view.render() immediately snaps the DOM back
          // to the correct model position. window.__v2ResyncView
          // (DesignEditor.jsx) is the one shared implementation — this
          // is the resize-commit call site; the drag-mouseup call site
          // lives in that same file. Phase 4B.2: since every element type
          // (flow/table included) now shares this exact same
          // resizableConfig(), this fix — and the resync it depends on —
          // automatically covers every element, not just header ones,
          // which is the direct structural fix for the desync bug
          // surviving in longer chains against flow/table elements.
          if (options.store && typeof window !== 'undefined' && window.__v2ResyncView) {
            window.__v2ResyncView(comp)
          }
        }
      },
    }
  }

  function draggableIntoElementContainer(source, destination) {
    return !!(destination && destination.get && ELEMENT_DROP_TARGET_TYPES.includes(destination.get('type')))
  }

  // ── The one shared element type — every semantic/generic element,
  //    header or flow alike, real x/y/width/height, drag+resize
  //    anywhere within its own coordinate-space container. ─────────────
  DomComponents.addType('lancera-v2-element', {
    model: {
      defaults: {
        removable: true,
        copyable: false,
        draggable: draggableIntoElementContainer,
        resizable: resizableConfig(),
        droppable: false,
        dmode: 'absolute',
      },
    },
  })

  // ── The mandatory line-items table — the SAME real position/resize
  //    interaction as every other element (Phase 4B.2: no longer a
  //    fixed, non-positioned special case), just never removable and
  //    never carrying its own font/color controls (see StylePanel.jsx's
  //    own capabilitiesFor). Dynamic invoice row/column data stays
  //    dynamic — this type only ever governs the table's own position/
  //    size, never explodes into per-row/per-cell components. ─────────
  DomComponents.addType('lancera-v2-table', {
    model: {
      defaults: {
        name: 'Line Items Table',
        removable: false,
        copyable: false,
        draggable: draggableIntoElementContainer,
        resizable: resizableConfig(),
        droppable: false,
        dmode: 'absolute',
      },
    },
  })
}
