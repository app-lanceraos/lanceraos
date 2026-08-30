// src/lib/designEditor/serialization.js
//
// The bidirectional mapping between a production canvas document
// (design_canvas.py's build_v2_canvas_document output) and the live
// GrapesJS component tree.
//
// THE CORE INVARIANT THIS FILE EXISTS TO SATISFY:
//   LOAD:  design A -> canvas
//   SAVE (no edits): canvas -> design B
//   B must be semantically equal to A.
//
// Coordinate convention: design_data is always mm; the canvas's own internal
// working unit is px (GrapesJS's drag/resize math is px-native); MM_TO_PX/
// PX_TO_MM convert ONLY at the two boundaries below — building the tree from
// a loaded canvas document (mm -> px) and reading the live tree back out on
// save (px -> mm). Nothing in between touches mm, and the ORIGINAL
// design_data object passed to buildV2ComponentTree/extractV2DesignDataFromEditor
// is never mutated in place — a fresh object is built at each boundary.
//
// Page-level geometry (page.size/width_mm/height_mm/margin_*_mm/sidebar)
// is READ from the loaded design and used to size/position the canvas's
// visual containers, but is NOT re-derived from the live DOM on save —
// this phase deliberately builds no interactive UI for editing page
// margins or the sidebar configuration itself, so there is nothing in the
// canvas for a user to change here. extractV2DesignDataFromEditor
// therefore passes `page` through unchanged from the design that was
// loaded, exactly like a real, honest no-op for a property this phase
// never lets the user touch — this is what makes a true no-op save exact
// for `page`, not merely approximate.
//
// Phase 4B.2 — the core structural rewrite (see design_schema.py's own
// docstring for the full architectural reasoning): header.elements and
// flow.elements are no longer two differently-shaped lists (absolute vs
// spacing-based) — every element in either list now carries the exact
// same real x/y/width/height shape, and the mandatory line-items table is
// one more element within flow.elements (kind='structural', type='table')
// instead of a special, non-positioned `flow.table` key. This file's own
// old headerElementComponent/flowElementComponent/tableComponent split
// (three separate build functions, two separate extraction functions, a
// dedicated table lookup) collapses into ONE elementComponent build
// function and ONE extractElementEntry function, reused identically for
// every element regardless of which original list it came from or
// whether it's the table — matching the backend's own prepare_element
// unification exactly, not a second, independently-shaped frontend model.
// The one thing this file still needs to track per element, since the
// backend still organizes design_data into two lists (header/flow, now
// purely organizational — see design_schema.py), is WHICH of those two
// lists a given element belongs to, so a save can put it back in the
// right one — carried as a real `data-el-list` attribute set once at
// load time from whichever backend array (`header_elements`/
// `flow_elements`) the element came from.
import { ELEMENTS_CONTAINER_ID, SIDEBAR_ELEMENTS_ID, SIDEBAR_ID, TABLE_ID, mmToPx, pxToMm } from './constants'

function parsePx(value, fallback = 0) {
  if (value == null) return fallback
  const n = parseFloat(String(value).replace('px', ''))
  return Number.isFinite(n) ? n : fallback
}

function readJsonAttr(attrs, key, fallback) {
  const raw = attrs[key]
  if (!raw) return fallback
  try {
    const parsed = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? parsed : fallback
  } catch {
    return fallback
  }
}

/**
 * Parses a flat `"prop:value;prop2:value2;"` CSS string (exactly what
 * design_renderer.py's prepare_element builds) into a `{prop: value}`
 * object GrapesJS's own `style` accepts directly (it already takes
 * kebab-case keys like 'font-family').
 *
 * Phase 3.2 fix (Part 6, canvas integrity — found during this phase's
 * own real-browser verification, not assumed): this used to build its
 * `style` object from scratch using ONLY el.x/y/width/height, silently
 * discarding every OTHER property the server already resolved into
 * `el.css` — text-align, font-family, font-size, font-weight, color,
 * border-radius. Reusing the server's own already-resolved CSS string
 * here (rather than re-deriving these properties from el.style on the
 * frontend, which would be a second, independent resolution
 * implementation) is what keeps the canvas from ever needing its own
 * font/color/align logic.
 */
function parseCssDeclarations(css) {
  const result = {}
  ;(css || '').split(';').forEach((decl) => {
    const idx = decl.indexOf(':')
    if (idx === -1) return
    const prop = decl.slice(0, idx).trim()
    const value = decl.slice(idx + 1).trim()
    if (prop && value) result[prop] = value
  })
  return result
}

// ── canvas document -> GrapesJS component-definition tree (load) ──────────

/**
 * ONE build function for every element — semantic, generic, or the one
 * structural type (the table) — regardless of which original list
 * (`header_elements`/`flow_elements`) it came from. Position/size are
 * recomputed here (mm -> px, the canvas's own interactive-geometry
 * boundary — GrapesJS's drag/resize math is px-native); everything else
 * in el.css (text-align, font-family, font-size, font-weight, color,
 * border-radius) passes through verbatim from the server's own
 * already-resolved CSS string. `list` is the ORIGINAL backend array name
 * ('header' or 'flow') this element came from — carried as a data
 * attribute purely so a save can reassemble the same two-list shape,
 * never read for any positioning/interaction decision (every element
 * behaves identically regardless of which list it's in).
 */
export function elementComponent(el, list) {
  const extra = parseCssDeclarations(el.css)
  delete extra.position
  delete extra.left
  delete extra.top
  delete extra.width
  delete extra.height

  const isTable = el.type === 'table'

  return {
    type: isTable ? 'lancera-v2-table' : 'lancera-v2-element',
    ...(isTable ? { id: TABLE_ID } : {}),
    classes: ['lancera-v2-el'],
    attributes: {
      'data-el-index': String(el.index),
      'data-el-list': list,
      'data-el-kind': el.kind,
      'data-el-type': el.type,
      'data-style-json': JSON.stringify(el.style || {}),
      'data-overrides-json': JSON.stringify(el.overrides || {}),
      ...(el.binding ? { 'data-binding': el.binding } : {}),
      ...(el.sidebar ? { 'data-sidebar': 'true' } : {}),
      // Green-Light directive — the Layers panel's lock/hide toggles.
      // Only emitted when true (matching `data-binding`'s own "absent
      // means the falsy default" convention) — reloading a design_data
      // payload that predates this feature (every existing real design)
      // has neither key, exactly like a freshly-added element.
      ...(el.locked ? { 'data-locked': 'true' } : {}),
      ...(el.hidden ? { 'data-hidden': 'true' } : {}),
    },
    // A locked element can still be SELECTED (so it can be unlocked again
    // from the Layers panel) but never dragged/resized on the canvas.
    //
    // Phase 2 real bug found and fixed while investigating why the
    // resize-handle/zoom fix (componentTypes.js's resizableConfig, its
    // own `mousePosFetcher`) never actually ran: this line used to be
    // `resizable: !el.locked` unconditionally — a plain BOOLEAN set on
    // EVERY element instance, not just locked ones. Per Backbone Model's
    // own defaults semantics, an explicit instance-level attribute always
    // shadows the TYPE's own `defaults.resizable` (confirmed directly via
    // `comp.resizable`/`comp.get('resizable')` both reporting a bare
    // boolean, never the rich object, for a real element loaded through
    // this exact function) — meaning `resizableConfig()`'s `silentFrames`/
    // `updateTarget`/`mousePosFetcher` had never actually been the real
    // resize configuration for ANY element loaded via buildV2ComponentTree
    // since whichever pass added the lock/hide toggle after the original
    // Phase 4A/4B fix, despite that fix's own extensive live-verified
    // documentation (it WAS correct and verified at the time it was
    // written — this is a real regression introduced later, not a false
    // historical claim). Fixed by only ever setting `resizable` at all
    // when actually locked (`false`, disabling resize outright) —
    // otherwise the key is omitted entirely, letting Backbone's own
    // defaults fallback apply the type's real `resizableConfig()` object
    // as originally intended.
    draggable: !el.locked,
    ...(el.locked ? { resizable: false } : {}),
    style: {
      ...extra,
      position: 'absolute',
      left: `${mmToPx(el.x)}px`,
      top: `${mmToPx(el.y)}px`,
      width: `${mmToPx(el.width)}px`,
      height: `${mmToPx(el.height)}px`,
      // A hidden element still renders (dimmed, click-through) in the
      // CANVAS — the canonical renderer is what actually excludes it from
      // real output (design_renderer._element_has_real_content). Real
      // opacity/pointer-events, not `display:none` — this element stays a
      // real DOM node the Layers panel can address (by data-el-list/
      // data-el-index, not by clicking it on the canvas surface, which
      // pointer-events:none deliberately disables) to un-hide it again.
      ...(el.hidden ? { opacity: 0.35, 'pointer-events': 'none' } : {}),
    },
    // Real backend-rendered content (design_canvas.py's own per-element
    // render, the exact same invoices/v2/_v2_element_content.html partial
    // the canonical renderer includes) — GrapesJS's own documented "raw
    // content, not parsed into child components" mechanism. For the table
    // specifically, this content_html is already the complete, real
    // `<table>...</table>` markup (head + sample rows) — no separate
    // table-content build path exists anywhere in this file anymore.
    content: el.content_html || '',
  }
}

/**
 * Builds the top-level component definitions (`editor.setComponents([...])`
 * -ready) from a real V2 canvas document. Document size, margins, and
 * sidebar are read directly from `doc.page` — a real, deterministic
 * mm -> px conversion, never an arbitrary/hardcoded pixel size. The
 * sidebar, when present, is a real, separate, absolutely-positioned
 * full-page-height box — never a template-specific branch (nothing here
 * checks a template name; it checks `doc.page.sidebar`, the same generic
 * mechanism ANY design could use).
 *
 * Phase 4B.2: header_elements and flow_elements are combined into ONE
 * flat list (each tagged with which array it came from), then split only
 * by real coordinate space — sidebar vs main content — exactly mirroring
 * design_renderer.render_v2_design_html's own `page_elements_raw`/
 * `sidebar_elements_raw` split. There is no more header-container vs
 * flow-container distinction — one `lancera-v2-elements` container holds
 * every non-sidebar element (the table included) as independent,
 * absolutely-positioned siblings, and one `lancera-v2-sidebar-elements`
 * container does the same for sidebar-flagged elements.
 */
export function buildV2ComponentTree(doc) {
  const { page } = doc
  const allElements = [
    ...doc.header_elements.map((el) => ({ el, list: 'header' })),
    ...doc.flow_elements.map((el) => ({ el, list: 'flow' })),
  ]
  const pageElements = allElements.filter(({ el }) => !el.sidebar)
  const sidebarElements = allElements.filter(({ el }) => el.sidebar)

  const elementsContainer = {
    type: 'lancera-v2-elements',
    id: ELEMENTS_CONTAINER_ID,
    style: {
      position: 'relative', width: '100%', height: `${mmToPx(page.height_mm)}px`, 'pointer-events': 'auto',
    },
    components: pageElements.map(({ el, list }) => elementComponent(el, list)),
  }

  // The main content column — its own width is the FULL page width (a
  // sidebar sits visually alongside it, not instead of it); the sidebar's
  // width is already folded into `page.effective_margin_left_mm` by the
  // backend (design_canvas.py), so this padding alone is what pushes
  // every real element clear of a real sidebar without this file needing
  // to know sidebar geometry twice.
  //
  // Phase 4A.1 real fix, still needed post-unification: this box's own
  // OUTER width is always the full page width regardless of a sidebar
  // (see comment above), so whenever `page.sidebar` exists, this
  // transparent padding region physically overlaps the sidebar's own
  // column beneath it. Since this node is LATER in DOM order than the
  // sidebar (siblings under the same wrapper) and neither establishes a
  // z-index, it paints on top and — confirmed via a real Playwright click
  // test — silently swallows every click meant for a real, visible
  // sidebar element. `content` itself is never a real interactive target
  // (componentTypes.js gives it draggable/removable/droppable: false), so
  // making it click-through and re-enabling pointer-events on its one
  // real child (already pushed clear of the sidebar by this same padding)
  // costs nothing and lets clicks fall through to whatever real element
  // is actually behind the empty padding area.
  const content = {
    type: 'lancera-v2-content',
    style: {
      position: 'relative',
      width: `${mmToPx(page.width_mm)}px`,
      'min-height': `${mmToPx(page.height_mm)}px`,
      'padding-top': `${mmToPx(page.margin_top_mm)}px`,
      'padding-right': `${mmToPx(page.margin_right_mm)}px`,
      'padding-bottom': `${mmToPx(page.margin_bottom_mm)}px`,
      'padding-left': `${mmToPx(page.effective_margin_left_mm)}px`,
      'pointer-events': 'none',
    },
    components: [elementsContainer],
  }

  const tree = []

  if (page.sidebar) {
    const sidebarElementsContainer = {
      type: 'lancera-v2-sidebar-elements',
      id: SIDEBAR_ELEMENTS_ID,
      style: { position: 'relative', width: '100%', height: `${mmToPx(page.height_mm)}px` },
      components: sidebarElements.map(({ el, list }) => elementComponent(el, list)),
    }
    tree.push({
      type: 'lancera-v2-sidebar',
      id: SIDEBAR_ID,
      style: {
        position: 'absolute', top: '0', left: '0',
        width: `${mmToPx(page.sidebar.width_mm)}px`,
        height: `${mmToPx(page.height_mm)}px`,
        // `sidebar.color: null` means "use the design's own resolved theme
        // color" (design_schema.py's own explicit, valid meaning for a
        // null sidebar color) — resolved here from the same
        // design_primary_color the rest of the canvas already uses,
        // never a second, independently-guessed default.
        background: page.sidebar.color || doc.design_primary_color || '#1a2b42',
      },
      components: [sidebarElementsContainer],
    })
  }

  tree.push(content)
  return tree
}

// ── Real "add a new element" support (Master Blueprint cutover) ──────────

/**
 * A real, deterministic, non-overlapping-by-construction default position
 * for a brand-new element: directly below the lowest real existing
 * element currently on the canvas (main content area only — never the
 * sidebar, which has its own, separate coordinate space), plus a small
 * fixed real gap. This is the direct fix for the exact bug class named
 * TB-005 in the original V1 audit (a dropped element always landing at a
 * hardcoded (20,20) regardless of what's already there, sometimes
 * overlapping existing content) — a truly empty canvas gets a small,
 * sane default near the top-left instead of (0,0), which real content
 * almost always starts at anyway.
 */
export function computeNewElementPlacement(editor) {
  const GAP_MM = 6
  const DEFAULT_XY_MM = 10
  const wrapper = editor.getWrapper()
  const container = wrapper.find(`#${ELEMENTS_CONTAINER_ID}`)[0]

  let maxBottomMm = null
  if (container) {
    container.components().forEach((comp) => {
      const style = comp.getStyle() || {}
      const topMm = pxToMm(parsePx(style.top))
      const heightMm = pxToMm(parsePx(style.height))
      // A chain member (Master Blueprint §B.3's own render-time-only
      // mechanism) has no fixed `height` at design time — this canvas
      // never groups chains at all (that's a canonical-renderer-only
      // concept, see design_renderer.py's own docstring), so every
      // real canvas component always carries a real height here.
      const bottomMm = topMm + heightMm
      if (maxBottomMm === null || bottomMm > maxBottomMm) maxBottomMm = bottomMm
    })
  }

  if (maxBottomMm === null) return { x: DEFAULT_XY_MM, y: DEFAULT_XY_MM }
  return { x: 0, y: maxBottomMm + GAP_MM }
}

/**
 * Builds a real, ready-to-append GrapesJS component definition for a
 * brand-new generic element — reuses elementComponent (the SAME function
 * every loaded element already goes through), so a freshly-added element
 * is structurally indistinguishable from one that was loaded from a real
 * saved design. `contentHtml` is the real backend-rendered content for
 * this element (fetched via canvasApi.fetchElementContent, the exact
 * same live-refresh endpoint the style panel already uses) — never a
 * client-side placeholder guess.
 */
export function buildNewElementEntry({ type, binding, x, y, width, height, contentHtml, index }) {
  const el = {
    index, kind: 'generic', type, x, y, width, height,
    style: {}, overrides: {}, binding: binding || null, sidebar: false,
    css: '', content_html: contentHtml || '',
  }
  return elementComponent(el, 'flow')
}

// ── Live editor component tree -> V2 design_data (save) ───────────────────

/**
 * The inverse of elementComponent — one extraction function for every
 * element regardless of type or which original list it came from.
 * `data-el-list` (set once at load time) is what lets the save path put
 * this element back into the correct one of design_data's two output
 * arrays.
 */
function extractElementEntry(component) {
  const attrs = component.getAttributes()
  const style = component.getStyle() || {}
  const element = {
    kind: attrs['data-el-kind'],
    type: attrs['data-el-type'],
    x: pxToMm(parsePx(style.left)),
    y: pxToMm(parsePx(style.top)),
    width: pxToMm(parsePx(style.width)),
    height: pxToMm(parsePx(style.height)),
    style: readJsonAttr(attrs, 'data-style-json', {}),
    overrides: readJsonAttr(attrs, 'data-overrides-json', {}),
  }
  if (attrs['data-binding']) element.binding = attrs['data-binding']
  if (attrs['data-locked']) element.locked = true
  if (attrs['data-hidden']) element.hidden = true
  return { list: attrs['data-el-list'], index: parseInt(attrs['data-el-index'], 10), element }
}

/**
 * Reads the live GrapesJS editor state back into a real V2 design_data
 * payload — the inverse of buildV2ComponentTree. Elements are collected
 * from BOTH the main and sidebar containers (an element never changes
 * which coordinate space it lives in during this phase — no drag-between-
 * spaces interaction was built) and split back into design_data's own two
 * arrays purely by each element's own `data-el-list` tag, then re-sorted
 * by `data-el-index` (set at load time from the canvas document's own
 * index, itself equal to the original design_data array position) — this
 * is what makes the merge-and-resplit exact regardless of which visual
 * container an element renders in or what order GrapesJS's own DOM
 * traversal returns them.
 *
 * `originalDesignData.page` is passed through unchanged — see this file's
 * own module docstring for why that's correct, not a shortcut.
 */
export function extractV2DesignDataFromEditor(editor, originalDesignData) {
  const wrapper = editor.getWrapper()

  const elementsContainer = wrapper.find(`#${ELEMENTS_CONTAINER_ID}`)[0]
  const sidebarElementsContainer = wrapper.find(`#${SIDEBAR_ELEMENTS_ID}`)[0]

  const allEntries = [
    ...(elementsContainer ? elementsContainer.components().map(extractElementEntry) : []),
    ...(sidebarElementsContainer ? sidebarElementsContainer.components().map(extractElementEntry) : []),
  ]

  const headerEntries = allEntries.filter((entry) => entry.list === 'header').sort((a, b) => a.index - b.index)
  const flowEntries = allEntries.filter((entry) => entry.list === 'flow').sort((a, b) => a.index - b.index)

  return {
    schema_version: 2,
    page: originalDesignData.page,
    header: { elements: headerEntries.map((entry) => entry.element) },
    flow: { elements: flowEntries.map((entry) => entry.element) },
  }
}
