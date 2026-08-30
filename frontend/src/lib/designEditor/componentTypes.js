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
import { clampToBoundsMm, mmToPx } from './constants'

const ELEMENT_DROP_TARGET_TYPES = ['lancera-v2-elements', 'lancera-v2-sidebar-elements']
const ELEMENT_COMPONENT_TYPES = ['lancera-v2-element', 'lancera-v2-table']

// Phase 5.1 client-side bounds clamp — mirrors design_schema.py's
// _validate_page_bounds exactly (x >= 0, y >= 0, x + width <= the real
// content/sidebar width), so a resize can never leave the canvas in a
// state the backend will reject at save time. `getElementBoundWidthMm`
// is passed in from DesignEditor.jsx rather than imported directly (it
// needs live access to the currently-loaded canvasDoc's own real,
// already-server-resolved page.content_width_mm/page.sidebar.width_mm —
// the exact same values design_schema.py's own margin fallback chain
// produces, never a second, independently-hardcoded copy of those
// margins here). Deliberately only ever shrinks width to fit (never
// repositions `l` to compensate) — a resize handle capping at the page
// edge is the same behavior as design_schema.py's own bound (it doesn't
// care which edge is the "anchor", only that both x>=0 and
// x+width<=bound hold afterward). No bottom-edge (y+height) ceiling,
// matching the backend's own deliberate non-enforcement of one (content
// may legitimately flow onto a second page — see design_schema.py's own
// docstring on this).
export function registerComponentTypes(editor, getElementBoundWidthMm, getZoom) {
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
  // Phase 2 real fix — the resize-handle/zoom desync (DECISIONS.md's own
  // "resize-handle/zoom desync" entry has the full investigation).
  // Root-caused via an isolated GrapesJS harness (not assumed): dragging
  // a component via `dmode:'absolute'` (GrapesJS's own internal Sorter)
  // is ALREADY zoom-correct under this app's CSS-`transform:scale(zoom)`
  // canvas wrapper — live-measured across zoom 1/0.65/0.8/0.4, matching
  // `screenDelta / zoom` exactly. Resize alone was broken, because
  // `updateTarget` above writes GrapesJS's own computed `rect` directly
  // as raw px — and that rect is computed from the Resizer's DEFAULT
  // `mousePosFetcher` (`ev.clientX/clientY`, unscaled), which has no way
  // to know about an external CSS transform applied outside the canvas
  // iframe it doesn't control. `mousePosFetcher` is a real, documented
  // `ResizerOptions` field (`grapesjs/dist/index.d.ts`'s own
  // `mousePosFetcher?: (ev: Event) => Position`) — dividing by the
  // CURRENT zoom here makes every subsequent delta the Resizer computes
  // internally already zoom-correct, without touching GrapesJS's own
  // rect/delta computation, handle rendering, or event wiring (the exact
  // same "real, supported override" precedent `updateTarget` above
  // already established for a different broken internal step).
  //
  // A native `Canvas.setZoom()` alternative was prototyped and rejected —
  // NOT because the API doesn't exist, but because live Playwright
  // testing found it corrupts a plain bottom-right-handle resize: left/
  // top shift by tens of px (should always stay 0,0 — a BR-handle drag
  // never moves the anchor corner) at every non-100% zoom level tested,
  // reproduced both mid-session (switch zoom, resize again) and as the
  // very first action in a fresh session — a real regression, not a
  // theoretical one, and confirmed NOT caused by canvas panning
  // (`Canvas.getCoords()` reports the same `{x:0,y:0}` before and after
  // `setZoom()`). `getZoom` is passed in from DesignEditor.jsx rather
  // than imported directly (it needs live access to the CURRENT `zoom`
  // React state via a ref, the same cross-file-bridge pattern
  // `getElementBoundWidthMm` above already uses, for the same reason —
  // this function is attached once at component-type registration and
  // must never close over a stale value).
  function resizableConfig() {
    return {
      tl: 1, tc: 1, tr: 1, cl: 1, cr: 1, bl: 1, bc: 1, br: 1, silentFrames: true,
      mousePosFetcher: (ev) => {
        const zoom = getZoom ? getZoom() : 1
        return { x: ev.clientX / zoom, y: ev.clientY / zoom }
      },
      updateTarget: (el, rect, options) => {
        const comp = editor.getSelected()
        let { l, t, w, h } = rect
        if (comp && getElementBoundWidthMm) {
          const boundWMm = getElementBoundWidthMm(comp)
          // clampToBoundsMm is unit-agnostic (pure ratio/comparison math)
          // despite its name — passing the bound converted to px once and
          // the live rect as-is (already px, GrapesJS's own Resizer unit)
          // avoids round-tripping every intermediate drag frame through
          // mm and back, unlike the drag-commit/nudge call sites below,
          // which already work in mm natively.
          const boundWPx = boundWMm == null ? null : mmToPx(boundWMm)
          const clamped = clampToBoundsMm({ x: l, y: t, width: w, height: h }, boundWPx, 'resize')
          l = clamped.x; t = clamped.y; w = clamped.width; h = clamped.height
        }
        el.style.left = `${l}px`
        el.style.top = `${t}px`
        el.style.width = `${w}px`
        el.style.height = `${h}px`
        if (comp && comp.getEl && comp.getEl() === el) {
          comp.addStyle(
            { left: `${l}px`, top: `${t}px`, width: `${w}px`, height: `${h}px` },
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
