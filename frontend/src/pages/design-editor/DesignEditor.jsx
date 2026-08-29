// src/pages/design-editor/DesignEditor.jsx
//
// The LanceraOS Template Builder — the one production invoice-design
// editor. Reached via /invoices/designs/:id/edit (App.jsx), linked from
// DesignGallery.jsx's Create/Edit actions. Real selection/drag/resize
// interaction is native GrapesJS behavior (see componentTypes.js's own
// comments for the resizable-config bug fixes this codebase found along
// the way) — nothing in this file drives drag/resize directly, it only
// surfaces what GrapesJS's own interaction already produces (selection
// info, dirty state, undo/redo).
//
// A real `:id` route param is always present (a real InvoiceDesign uuid,
// or the literal `new`) — `isRealMode` is therefore always true; kept as
// a named flag rather than removed outright since several branches below
// still read it for clarity at their own call site.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import GjsEditor, { Canvas } from '@grapesjs/react'
import grapesjs from 'grapesjs'
import 'grapesjs/dist/css/grapes.min.css'

import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react'

import api from '@/lib/api'
import useTitle from '@/hooks/useTitle'
import FosAlert from '@/components/FosAlert'
import { fetchBlankDesignData, fetchBuiltinDesignData, fetchDesignTemplates, fetchCanvasDocument, fetchElementContent, fetchDesignValidation } from '@/lib/designEditor/canvasApi'
import { registerComponentTypes } from '@/lib/designEditor/componentTypes'
import { BINDING_OPTIONS, ELEMENTS_CONTAINER_ID, GENERIC_TYPE_DEFAULTS, SIDEBAR_ELEMENTS_ID, mmToPx, pxToMm } from '@/lib/designEditor/constants'
import { computeAlignedPositions, computeDistributedPositions } from '@/lib/designEditor/alignment'
import {
  buildNewElementEntry, buildV2ComponentTree, computeNewElementPlacement, extractV2DesignDataFromEditor,
} from '@/lib/designEditor/serialization'
import StylePanel from './StylePanel'

const ZOOM_LEVELS = [0.4, 0.5, 0.65, 0.8, 1]

// Phase 4A Part 17 — a small, generic nudge amount for arrow-key movement.
// 1mm (not 1px) so the smallest keyboard nudge is a real, meaningful,
// document-space unit — matching the V2 coordinate model's own mm-native
// convention rather than an arbitrary pixel count that would mean a
// different real-world distance at every zoom level (zoom never affects
// document geometry — see this file's own zoom-wrapper comment below).
const KEYBOARD_NUDGE_MM = 1

// A design environment shows what a field REPRESENTS ("Client Name")
// rather than a real user's own data, and never collapses to zero size
// just because a real field happens to be blank. Not yet a user-facing
// toggle (no product need identified for a "preview with real data"
// mode) — a single constant, not a magic string repeated at every call site.
const CONTENT_MODE = 'alias'

// Phase 5.5b — the exact tolerance approved by Phase 5.4 (not a separately
// tuned value). Absorbs subpixel rounding only; not a real "how much
// overflow is acceptable" threshold.
const OVERFLOW_TOLERANCE_PX = 2

export default function DesignEditor() {
  useTitle('Template Builder — LanceraOS')

  const { id } = useParams()
  const navigate = useNavigate()
  const isRealMode = id !== undefined

  const [builtins, setBuiltins] = useState({ templates: [], variants: {} })
  const [template, setTemplate] = useState('professional')
  const [variant, setVariant] = useState('')
  const [designData, setDesignData] = useState(null)
  const [canvasDoc, setCanvasDoc] = useState(null)
  const [editor, setEditor] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [zoom, setZoom] = useState(0.5)
  const [log, setLog] = useState([])
  // Real-persistence state (isRealMode only) — a real design's own name,
  // its real InvoiceDesign id once one exists (null until the first real
  // save, matching V1 DesignEditor.jsx's own new-id-on-first-save
  // convention), and a save-status string for real user feedback.
  const [name, setName] = useState('Untitled design')
  const [savedDesignId, setSavedDesignId] = useState(id && id !== 'new' ? id : null)
  const [saveStatus, setSaveStatus] = useState('idle')
  // Real "add a new element" panel state (Master Blueprint cutover —
  // closes the single largest confirmed-absent capability: no phase ever
  // built a way to add a brand-new element to a V2 design).
  const [newElementType, setNewElementType] = useState('text')
  const [newElementBinding, setNewElementBinding] = useState('')
  // Green-Light directive — Template Health (validation Layers A/C/D).
  // `null` = never checked yet this load; otherwise {valid, errors, warnings}
  // exactly as views_design_editor.design_validate returns.
  const [healthResult, setHealthResult] = useState(null)
  const [healthChecking, setHealthChecking] = useState(false)
  // Green-Light directive — version history + rollback UI. `versions` is
  // only ever populated in real mode, for an already-persisted design
  // (savedDesignId set) — a brand-new, never-saved design has no version
  // rows to show yet (its first Save is what creates version 1).
  const [versions, setVersions] = useState([])
  const [versionsOpen, setVersionsOpen] = useState(false)
  const [restoringVersionId, setRestoringVersionId] = useState(null)
  // Green-Light directive — the Layers panel (order/lock/hide).
  // `layersList` is a snapshot (via handleSerialize(), the same live-
  // editor-state extraction every other real action already uses),
  // refreshed after every layer action so the panel never shows stale
  // order/lock/hide state.
  const [layersOpen, setLayersOpen] = useState(false)
  const [layersList, setLayersList] = useState([])
  // Green-Light directive — multi-select for alignment. A plain Set of
  // "list-index" keys, checked from the Layers panel — deliberately NOT
  // canvas Shift+click (see alignment.js's own module docstring for why:
  // this codebase's drag/resize interaction code has a documented history
  // of bugs only a live browser could catch, and none is available here).
  const [alignSelection, setAlignSelection] = useState(new Set())
  // Phase 4A — selection/interaction state. All of this is EDITOR state
  // (Part 3's own requirement: "selection must NOT alter the saved V2
  // design"), never written into designData/canvasDoc/lastSaved.
  const [selected, setSelected] = useState(null)
  const [dirty, setDirty] = useState(false)
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  // Green-Light directive — autosave. A timestamp, not a plain boolean:
  // `dirty` alone only flips false->true ONCE per edit session, so an
  // effect keyed on it would arm a single debounce timer on the FIRST
  // edit and never reset it on subsequent edits made before it fires —
  // exactly the "per-mouse-movement" vs "genuinely debounced" distinction
  // the directive calls out. Updated on every real edit (same call sites
  // as setDirty(true), see refreshUndoState), so the autosave effect
  // below re-arms its timer on each one.
  const [lastEditAt, setLastEditAt] = useState(0)
  // Phase 5.5c — the reload advisory's own state: a discrete, page-level
  // aggregate (never per-element — see StylePanel.jsx / 5.5b's own
  // data-v2-overflow attribute + outline for the per-element signal,
  // which this does not replace). { count: 0 } renders no banner.
  const [overflowScan, setOverflowScan] = useState({ count: 0, elements: [] })

  const loadedDesignRef = useRef(null)

  useEffect(() => {
    fetchDesignTemplates().then(setBuiltins).catch(() => setError('Could not load the builtin inventory.'))
  }, [])

  // Real-mode load: an existing real InvoiceDesign (id !== 'new') loads
  // its OWN real design_data/base_template/color_variant/name through
  // the same production endpoint (GET /invoices/designs/:id/) every
  // design uses — one fetch path, not a version-branched one. A brand
  // new real design (id === 'new') needs no fetch at all; the user picks
  // a starting builtin via the template/variant selectors below.
  useEffect(() => {
    if (!isRealMode || id === 'new') return
    let cancelled = false
    async function loadExisting() {
      setLoading(true)
      try {
        const { data } = await api.get(`/invoices/designs/${id}/`)
        if (cancelled) return
        setName(data.name)
        setTemplate(data.base_template)
        setVariant(data.color_variant || '')
        const doc = await fetchCanvasDocument(data.design_data, data.base_template, data.color_variant, CONTENT_MODE)
        if (cancelled) return
        setDesignData(data.design_data)
        setCanvasDoc(doc)
        loadedDesignRef.current = data.design_data
      } catch {
        if (!cancelled) setError('Could not load this design.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    loadExisting()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRealMode, id])

  const appendLog = useCallback((message) => {
    setLog((prev) => [...prev.slice(-19), `${new Date().toLocaleTimeString()} — ${message}`])
  }, [])

  const loadIntoCanvas = useCallback(async (data, tmpl, colorVariant) => {
    setLoading(true)
    setError(null)
    try {
      const doc = await fetchCanvasDocument(data, tmpl, colorVariant, CONTENT_MODE)
      setDesignData(data)
      setCanvasDoc(doc)
      loadedDesignRef.current = data
      appendLog(`Loaded ${tmpl}/${colorVariant || 'default'} — ${doc.header_elements.length} header + ${doc.flow_elements.length} flow element(s).`)
    } catch (err) {
      setError(err.response?.data?.error || 'Could not build the canvas document for this design.')
    } finally {
      setLoading(false)
    }
  }, [appendLog])

  async function handleLoadBuiltin() {
    try {
      const data = await fetchBuiltinDesignData(template)
      await loadIntoCanvas(data, template, variant)
    } catch {
      setError('Could not fetch this builtin design.')
    }
  }

  // Green-Light directive — the editor's second first-class starting
  // mode. `template` still picks the underlying color/typography
  // foundation (a blank document still has an underlying stylesheet,
  // same as a builtin) — only the pre-arranged content differs.
  async function handleLoadBlank() {
    try {
      const data = await fetchBlankDesignData(template)
      await loadIntoCanvas(data, template, variant)
    } catch {
      setError('Could not start a blank design for this template.')
    }
  }

  // Phase 5.5b — the editor-only overflow indicator's ONE measurement
  // implementation (Option D from Phase 5.4). Reused by every call site
  // below (initial selection, live geometry/style updates, and
  // StylePanel.jsx's own debounced content-refresh settle) rather than a
  // second, independently-invented copy. Design-time-only: applies/removes
  // a plain DOM attribute directly on the element's own real node inside
  // the canvas iframe — never on the GrapesJS component model/attributes,
  // which DO serialize into design_data (see serialization.js's
  // extractV2DesignDataFromEditor) — so this can never leak into a saved
  // design or the canonical renderer's own output.
  //
  // Per Phase 5.4's own established finding (reused, not re-derived):
  // scrollWidth/scrollHeight and the element's own declared CSS box size
  // are already comparable directly in the canvas iframe's unscaled px
  // space — the outer `zoom` state is a CSS transform applied OUTSIDE this
  // iframe entirely (see the page-frame wrapper below), so it never
  // affects getComputedStyle()/scrollHeight/scrollWidth values read from
  // inside it. No ratio conversion is applied here, deliberately.
  //
  // Declared here, ABOVE the canvasDoc-load effect below (a real bug this
  // phase's own live verification caught: a `const` referenced inside that
  // effect's own dependency array before its declaration throws
  // "Cannot access before initialization" — this is not merely a style
  // preference, moving it below breaks the page outright).
  const measureAndMarkOverflow = useCallback((comp) => {
    if (!comp || !comp.getEl) return null
    const domEl = comp.getEl()
    if (!domEl) return null
    const view = domEl.ownerDocument && domEl.ownerDocument.defaultView
    if (!view) return null
    const cs = view.getComputedStyle(domEl)
    const declaredWidth = parseFloat(cs.width) || 0
    const declaredHeight = parseFloat(cs.height) || 0
    const scrollWidth = domEl.scrollWidth
    const scrollHeight = domEl.scrollHeight
    const excessWidth = scrollWidth - declaredWidth
    const excessHeight = scrollHeight - declaredHeight
    const isOverflowing = excessHeight > OVERFLOW_TOLERANCE_PX || excessWidth > OVERFLOW_TOLERANCE_PX
    // The approved mechanism: a plain data attribute on the real DOM node,
    // paired with a scoped CSS rule injected into this same iframe's own
    // <head> (see the canvasDoc-load effect below) — never a React-driven
    // inline style, so this never fights GrapesJS's own style writes to
    // the same node (left/top/width/height via addStyle).
    if (isOverflowing) domEl.setAttribute('data-v2-overflow', 'true')
    else domEl.removeAttribute('data-v2-overflow')
    return { isOverflowing, excessWidth, excessHeight, declaredWidth, declaredHeight, scrollWidth, scrollHeight }
  }, [])

  // Phase 5.5c — the reload advisory's own aggregate scan. Reuses
  // measureAndMarkOverflow (the ONE overflow-measurement implementation,
  // unchanged since Phase 5.5b) against every REAL, persisted V2 element —
  // enumerated via the exact same two containers
  // (#lancera-v2-elements / #lancera-v2-sidebar-elements) and the exact
  // same `.components()` call serialization.js's own
  // extractV2DesignDataFromEditor already trusts as the authoritative
  // element boundary for save. This deliberately never touches GrapesJS UI
  // chrome, resize handles, selection overlays, or the container/wrapper
  // nodes themselves — none of which live inside these two containers —
  // so there is no risk of measuring something that isn't a real,
  // persisted design element.
  //
  // This is a discrete, point-in-time computation, called only from the
  // specific lifecycle moments below (post-load, a completed resize/drag
  // commit, a settled Style Panel edit, undo/redo) — never on a timer,
  // never on every keystroke/frame, and never via a MutationObserver. See
  // this function's own call sites for why each one is a natural,
  // low-frequency settle/commit point rather than continuous scanning.
  const scanAllElementsForOverflow = useCallback((ed) => {
    if (!ed) return { count: 0, elements: [] }
    const wrapper = ed.getWrapper()
    const elementsContainer = wrapper.find(`#${ELEMENTS_CONTAINER_ID}`)[0]
    const sidebarElementsContainer = wrapper.find(`#${SIDEBAR_ELEMENTS_ID}`)[0]
    const overflowing = []
    const measureContainer = (container) => {
      if (!container) return
      container.components().forEach((comp) => {
        const result = measureAndMarkOverflow(comp)
        if (result && result.isOverflowing) {
          const attrs = comp.getAttributes()
          overflowing.push({ type: attrs['data-el-type'], index: attrs['data-el-index'] })
        }
      })
    }
    measureContainer(elementsContainer)
    measureContainer(sidebarElementsContainer)
    return { count: overflowing.length, elements: overflowing }
  }, [measureAndMarkOverflow])

  // ── Once GrapesJS + the canvas document are both ready, inject the
  // real CSS (fonts + design-specific rules — the SAME partial the
  // canonical renderer itself includes, see design_canvas.py) into the
  // canvas iframe's own <head>, then build the real component tree.
  // Real fonts must be present in the iframe's own document BEFORE real
  // content renders, or every element's computed font falls back to a
  // browser default (a real bug caught and fixed by live Playwright
  // verification during this editor's original build). ────────────────
  useEffect(() => {
    if (editor && canvasDoc) {
      const canvasDocument = editor.Canvas.getDocument()
      if (canvasDocument) {
        const styleEl = canvasDocument.createElement('style')
        styleEl.textContent = canvasDoc.css || ''
        canvasDocument.head.appendChild(styleEl)

        // Phase 5.5b — the overflow indicator's CSS. Injected here, in
        // React, directly into THIS canvas iframe only — deliberately NOT
        // added to _v2_page_styles.html (canvasDoc.css above), which is the
        // same partial the canonical /v2-preview/ renderer and real PDF/
        // portal output include. Since the canonical renderer never runs
        // this effect (it has no GrapesJS canvas at all), this rule is
        // structurally incapable of leaking into real invoice output.
        const overflowStyleEl = canvasDocument.createElement('style')
        overflowStyleEl.setAttribute('data-v2-editor-only', 'true')
        overflowStyleEl.textContent = '[data-v2-overflow="true"] { outline: 1.5px dashed #d97706; }'
        canvasDocument.head.appendChild(overflowStyleEl)

        // Green-Light directive (§18-22's own broader "non-designer-first"
        // framing) — a static-vs-bound visual distinction directly in the
        // canvas, not just StylePanel's own disabled "(bound: ...)" text
        // input that only appears once an element is already selected.
        // `data-binding` is already set on every generic text element's
        // real DOM node by elementComponent() (serialization.js) whenever
        // design_data itself declares a `binding` — semantic elements
        // (logo/qr_code/table/etc.) never carry one at all, so this
        // selector naturally never matches them. Editor-only, same
        // `data-v2-editor-only` marker/injection point as the overflow
        // indicator immediately above — structurally incapable of leaking
        // into real invoice output, since the canonical renderer has no
        // GrapesJS canvas to run this effect against.
        const bindingStyleEl = canvasDocument.createElement('style')
        bindingStyleEl.setAttribute('data-v2-editor-only', 'true')
        bindingStyleEl.textContent = `
          [data-binding] { position: absolute; }
          [data-binding]::before {
            content: '';
            position: absolute;
            top: -4px;
            left: -4px;
            width: 7px;
            height: 7px;
            border-radius: 50%;
            background: #2563eb;
            border: 1px solid #ffffff;
            pointer-events: none;
          }
        `
        canvasDocument.head.appendChild(bindingStyleEl)
      }
      editor.setComponents(buildV2ComponentTree(canvasDoc))
      // A fresh load (including "Reload from serialized", Part 14's own
      // no-op-save verification action) is the real "clean" baseline —
      // clearing history here is what makes hasUndo() a correct, honest
      // dirty-state signal (Part 15): true only once a REAL interactive
      // change has happened since this exact load, never carried over
      // from a previous template.
      editor.UndoManager.clear()
      setDirty(false)
      setCanUndo(false)
      setCanRedo(false)
      setSelected(null)
      // Phase 5.5c — the reload advisory's post-load scan. This is the
      // ONLY point in this codebase where a design is (re)populated into
      // the canvas — a fresh "Load", a template/variant switch, and the
      // pre-existing "Reload from serialized" round trip (handleReload
      // FromSerialized, this file's own real, no-op-save/reload mechanism
      // — see this file's own top-of-file docstring) all funnel through
      // this exact effect, so no separate "reload" concept needed to be
      // invented. Deferred one tick past setComponents() above, matching
      // this file's own established window.__v2ResyncView idiom (let
      // GrapesJS's own synchronous rendering finish its own call stack
      // first) — empirically verified unnecessary via a dedicated timing
      // diagnostic (scrollHeight/scrollWidth were already exactly correct
      // at 0ms after the canvas iframe existed, since every element's real
      // content arrives in ONE upfront bulk fetch before setComponents is
      // ever called, unlike StylePanel's own per-edit refresh, which does
      // need its 300ms debounce for a fresh network round trip) — kept
      // anyway as a zero-cost safety margin. See the phase report's own
      // §4/§17 for the full investigation.
      setTimeout(() => setOverflowScan(scanAllElementsForOverflow(editor)), 0)
    }
  }, [editor, canvasDoc, scanAllElementsForOverflow])

  // Element content is fetched once, in bulk, at load time
  // (loadIntoCanvas -> fetchCanvasDocument). The single-element refresh
  // function (canvasApi.js's own fetchElementContent, backed by the real,
  // tested design_canvas_element endpoint) is what StylePanel.jsx's own
  // debounced per-edit refresh calls directly, below.
  //
  // Selection tracking (editor state only, never written into the design),
  // dirty-state via UndoManager.hasUndo(), undo/redo button state, and a
  // keyboard nudge for the selected element are all live below.
  //
  // Phase 4B.2: every real element type (`lancera-v2-element` and the
  // table's own `lancera-v2-table`) now carries real x/y/width/height —
  // there is no more spacing-only flow shape to branch on (see
  // componentTypes.js's own docstring), so geometry is always the same
  // 4-number shape regardless of which type is selected. measureAndMark
  // Overflow/scanAllElementsForOverflow are declared earlier in this file
  // (above the canvasDoc-load effect that references the latter in its own
  // dependency array) — see that declaration's own comment.
  const readSelection = useCallback((ed) => {
    const comp = ed.getSelected()
    if (!comp) { setSelected(null); return }
    const type = comp.get('type')
    if (type !== 'lancera-v2-element' && type !== 'lancera-v2-table') { setSelected(null); return }
    const attrs = comp.getAttributes()
    const style = comp.getStyle() || {}
    const geometry = {
      x: pxToMm(parseFloat(style.left) || 0), y: pxToMm(parseFloat(style.top) || 0),
      width: pxToMm(parseFloat(style.width) || 0), height: pxToMm(parseFloat(style.height) || 0),
    }
    // Phase 4B.3 real bug fix (PHASE4B2_AUDIT.md finding C1's second, compounding
    // bug): `binding` was never read into `selected` at all, so StylePanel's own
    // "Static text" input logic (which branches on `selected.binding`) could
    // never actually detect a bound field — and, critically, the content-refresh
    // call (StylePanel's `commit()`) had no `binding` value to forward to the
    // backend. Reading it here is what makes both fixes real.
    // Phase 5.5b — measure THIS element (the one just selected, or whose
    // geometry/content just changed — component:update/styleUpdate already
    // route back through readSelection, see onEditorInit below) uniformly
    // for every kind/type, never scanning any other element on the canvas.
    const overflow = measureAndMarkOverflow(comp)
    setSelected({
      kind: attrs['data-el-kind'], type: attrs['data-el-type'], index: attrs['data-el-index'],
      binding: attrs['data-binding'] || null, geometry, overflow,
    })
  }, [measureAndMarkOverflow])

  const refreshUndoState = useCallback((ed) => {
    setCanUndo(ed.UndoManager.hasUndo())
    setCanRedo(ed.UndoManager.hasRedo())
    // Green-Light directive (unsaved-changes warning) — real bug found
    // while wiring this up: `dirty` used to be a bare alias of
    // UndoManager.hasUndo(), which stays true forever after the FIRST
    // real edit, including right after a successful Save — GrapesJS's
    // own undo stack is never cleared by saving (only by a fresh
    // load/reload, see the load effect above). Every real call site of
    // this function (component:update/styleUpdate, undo/redo, add/
    // duplicate-element, StylePanel's onChange) fires only on an actual
    // edit, never a bare selection change, so "this function ran" is a
    // safe, real "something changed" signal — `dirty` now means "changed
    // since the last load or save" specifically, explicitly cleared by
    // both (see the load effect's setDirty(false) and handleSaveReal's
    // own reset on success), independent of hasUndo()'s own unrelated
    // "is there ANY undo history at all" meaning (still used for
    // canUndo/canRedo's button-disabled state, unchanged).
    setDirty(true)
    setLastEditAt(Date.now())
  }, [])

  const onEditorInit = useCallback((ed) => {
    setEditor(ed)
    registerComponentTypes(ed)
    // A real, live GrapesJS editor reference on `window` — genuinely
    // useful for direct console-level debugging and for any future
    // Playwright coverage that needs to inspect internal editor state
    // beyond what the DOM alone exposes. Harmless in production: nothing
    // reads this global except a developer's own devtools console.
    if (typeof window !== 'undefined') window.__templateBuilderEditor = ed

    ed.on('component:selected', () => readSelection(ed))
    ed.on('component:deselected', () => setSelected(null))
    // Phase 4B.2 real bug found via this phase's own Playwright
    // verification (not assumed, not present in any prior phase's
    // report): a completed RESIZE writes the correct final geometry into
    // both the component's own model (`comp.getStyle()`) and the real
    // DOM (confirmed directly, live — both already correct immediately
    // after mouseup) — so this is NOT the model/DOM desync Phase 4B.1
    // fixed. It's a narrower, previously-undetected gap: GrapesJS's
    // resize commit fires `component:styleUpdate`, never `component:
    // update` — and this listener only ever re-read selection on the
    // latter, so the React sidebar's own displayed x/y/w/h silently kept
    // showing the PRE-resize geometry until some unrelated event (a new
    // selection, a drag) happened to fire `component:update` afterward.
    // A real, user-visible staleness bug, masked in earlier phases
    // because their own verification checked `comp.getStyle()`/the DOM
    // directly rather than the rendered sidebar text a real user reads.
    ed.on('component:update component:styleUpdate', () => readSelection(ed))
    ed.on('component:styleUpdate component:update', () => refreshUndoState(ed))
    // Phase 5.5c — undo/redo is a discrete, low-frequency event (never
    // per-frame), and CAN change overflow (undoing a resize/style edit
    // that was causing overflow, or redoing one) — a real rescan here,
    // not just the pre-existing refreshUndoState.
    ed.on('undo redo', () => { refreshUndoState(ed); setOverflowScan(scanAllElementsForOverflow(ed)) })

    // Phase 4B.1 real fix — a confirmed GrapesJS model/view desync, found
    // via direct model-vs-DOM inspection (comp.getStyle() vs comp.getEl()'s
    // own inline style attribute), not assumed from symptoms alone: after
    // a committed drag OR resize on a header element, that same element's
    // own VIEW stops re-syncing the DOM to match its MODEL on the next
    // DIFFERENT interaction — reproduced in both directions (resize-then-
    // drag and drag-then-resize each leave the following interaction's
    // real screen position frozen at the pre-interaction value while
    // comp.getStyle() silently reports the correct new one underneath).
    // Manually forcing view.render() immediately snaps the DOM back to the
    // correct model position. Phase 4B.2: flow elements and the table now
    // go through this exact same `lancera-v2-element`/`lancera-v2-table`
    // interaction code path (componentTypes.js) header elements always
    // did, so this one fix — and the resync it depends on — automatically
    // covers every element type, closing the broader resize→drag desync
    // Phase 4B.1 found surviving in longer interaction chains against
    // flow/table elements specifically (they previously had no resize
    // interaction of their own to desync in the first place).
    //
    // A GrapesJS-event-based hook (component:styleUpdate / component:
    // update) was tried first and abandoned — confirmed live, with a
    // wrapped view.render() logging every real call, that these events
    // fire unreliably for this specific purpose: many redundant firings
    // during a single drag, and literally zero after a resize's own final
    // commit despite the model updating correctly moments later. What
    // actually works is calling this at the two real, concrete commit
    // points instead: this file's own canvas mouseup handler below
    // (covers drag — its mouseup always lands inside the canvas iframe)
    // and componentTypes.js's resize updateTarget (covers resize — its
    // handle's mouseup lands in the MAIN document instead, outside this
    // file's iframe-scoped listener entirely, so it needs its own call
    // site). Exposed on window so componentTypes.js can reach the same
    // one implementation without a new import cycle between the two
    // files. setTimeout(0), not synchronous: confirmed directly that
    // calling view.render() synchronously, still inside the triggering
    // interaction's own mouseup call stack (GrapesJS's Resizer/Sorter),
    // corrupts THAT SAME interaction's own final visual commit — its own
    // handle/drag-state bookkeeping is still mid-cleanup. Deferring past
    // the current call stack lets the native interaction finish first,
    // then re-syncs the view for whatever comes next.
    window.__v2ResyncView = (comp) => {
      if (!comp) return
      setTimeout(() => {
        const view = comp.getView && comp.getView()
        if (view && view.render) view.render()
        // Phase 5.5b real bug, found via live Playwright verification (a
        // genuine resize-while-overflowing test, not assumed): view.render()
        // above — the Phase 4B.1 desync fix, unrelated to and unmodified by
        // this phase — regenerates this component's DOM node from its
        // GrapesJS-tracked model/attributes, which has the side effect of
        // silently wiping the `data-v2-overflow` attribute measureAndMark
        // Overflow sets directly on the raw DOM node (deliberately NOT part
        // of the GrapesJS component model — see that function's own comment
        // on why it must stay DOM-only). Confirmed live: without this line,
        // completing a resize (or a drag, which calls this same resync from
        // this file's own canvas mouseup handler below) on a genuinely
        // overflowing element reset its indicator to "safe" at the exact
        // moment the interaction committed — the single moment the
        // indicator matters most. Re-running the same measurement
        // immediately after view.render() restores it; this is the ONE
        // measurement implementation, not a second copy.
        measureAndMarkOverflow(comp)
        // Phase 5.5c — recompute the reload-advisory aggregate once per
        // COMPLETED resize/drag commit (this callback fires exactly once
        // per finished interaction — never per intermediate frame; the
        // per-frame component:styleUpdate events during a live drag do
        // NOT call this). Note: for the plain-DRAG call site specifically
        // (this file's own canvas mouseup handler below), this rescan is
        // provably a no-op — a drag only ever changes left/top, and
        // overflow is purely a function of an element's own width/height
        // vs. its own content, never its position — but since this is the
        // ONE shared resync implementation both the resize and drag call
        // sites use, keeping it unconditional here is simpler and still
        // cheap (once per commit, not per-frame) rather than branching to
        // distinguish which interaction triggered it.
        setOverflowScan(scanAllElementsForOverflow(ed))
      }, 0)
    }

    // A small, generic keyboard nudge for whatever element is currently
    // selected — every real element type has real x/y geometry to nudge
    // now (Phase 4B.2, see componentTypes.js's own docstring). Attached to
    // the CANVAS IFRAME's own document, since that's where real keydown
    // focus lands after a click-to-select inside the canvas.
    ed.on('load', () => {
      const canvasDocument = ed.Canvas.getDocument()
      if (!canvasDocument) return

      // Phase 4B real-browser fix: a confirmed GrapesJS-internal bug, not
      // a CSS/DOM hit-testing issue (verified directly — elementFromPoint
      // at the real click coordinates, correctly converted through the
      // zoom transform, always resolves to the intended element's own
      // DOM node). Immediately after a `dmode:'absolute'` drag completes,
      // the VERY NEXT click on a DIFFERENT header/flow element fails to
      // change GrapesJS's own selection (stays on the just-dragged
      // element) even though the click physically lands on the right
      // node — a second identical click then succeeds. This directly
      // breaks the core "select → drag → resize" loop this whole phase
      // is built around (move one field, then click a different one).
      // Root-causing GrapesJS's own internal Sorter/ComponentDrag click-
      // suppression state was not completed in the time available (this
      // is a materially deeper investigation than Phase 4A.1's own
      // Resizer `silentFrames` fix, since it involves the drag/mousedown
      // lifecycle rather than a documented, exposed config option) — so
      // this is a supplementary, explicit backstop rather than a root-
      // layer fix: on every mouseup inside the canvas, resolve the real
      // element under the pointer to its GrapesJS component via the
      // real `id` GrapesJS itself already assigns (the same identifier
      // `extractHeaderEntry`/`extractFlowEntry` already trust for save),
      // and force selection via `ed.select()` if it disagrees with
      // whatever GrapesJS's own handler left selected. A no-op when
      // GrapesJS's own click handling already got it right (the common
      // case), so this never fights the native behavior — only backstops
      // its one confirmed failure mode.
      canvasDocument.addEventListener('mouseup', (e) => {
        let node = e.target
        while (node && node !== canvasDocument.body) {
          if (node.hasAttribute && node.hasAttribute('data-el-type') && node.id) {
            const comp = ed.getWrapper().find(`#${node.id}`)[0]
            if (comp && ed.getSelected() !== comp) ed.select(comp)
            // Phase 4B.1: the same real model/view desync componentTypes.js's
            // resize updateTarget now fixes (see that file's own comment)
            // also happens after a plain DRAG, confirmed directly — and a
            // drag's own mouseup always lands inside this iframe (unlike a
            // resize handle's mouseup, which lands in the MAIN document,
            // outside this listener's reach entirely — that direction is
            // covered by componentTypes.js's own updateTarget instead).
            // window.__v2ResyncView is the one shared implementation both
            // paths call, deferred past this event's own call stack so it
            // never fights whichever native interaction just committed.
            if (comp && window.__v2ResyncView) window.__v2ResyncView(comp)
            break
          }
          node = node.parentElement
        }
      })

      canvasDocument.addEventListener('keydown', (e) => {
        const comp = ed.getSelected()
        if (!comp) return
        const type = comp.get('type')
        if (type !== 'lancera-v2-element' && type !== 'lancera-v2-table') return

        // Phase 4B: Delete/Backspace removes the selected element — the
        // same keydown listener arrow-nudge already uses, extended
        // rather than adding a second listener. Gated on the model's own
        // `removable` (the table sets this to false, see
        // componentTypes.js) so the mandatory table can't be deleted via
        // keyboard either.
        if (e.key === 'Delete' || e.key === 'Backspace') {
          if (!comp.get('removable')) return
          e.preventDefault()
          comp.remove()
          setSelected(null)
          return
        }

        // Phase 4B.2: every element type now has real x/y (no more
        // "flow elements have no geometry to nudge" restriction — see
        // componentTypes.js's own docstring), so the arrow-key nudge
        // applies uniformly to whatever is selected, the table included.
        const deltas = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }
        const delta = deltas[e.key]
        if (!delta) return
        e.preventDefault()
        const style = comp.getStyle() || {}
        const leftMm = pxToMm(parseFloat(style.left) || 0) + delta[0] * KEYBOARD_NUDGE_MM
        const topMm = pxToMm(parseFloat(style.top) || 0) + delta[1] * KEYBOARD_NUDGE_MM
        comp.addStyle({ left: `${mmToPx(leftMm)}px`, top: `${mmToPx(topMm)}px` })
        readSelection(ed)
      })
    })
  }, [readSelection, refreshUndoState, measureAndMarkOverflow, scanAllElementsForOverflow])

  function handleSerialize() {
    if (!editor || !loadedDesignRef.current) return null
    const result = extractV2DesignDataFromEditor(editor, loadedDesignRef.current)
    return result
  }

  // Master Blueprint cutover — the real save path. Persists through the
  // exact same production InvoiceDesignSerializer/InvoiceDesign CRUD
  // endpoints (design_list/design_detail, apps/invoices/views.py) a v1
  // design already uses — the serializer's own version-dispatched
  // validator (validate_design_data_schema_by_version) is what makes a
  // schema_version:2 payload valid there at all (see
  // apps/invoices/serializers.py's InvoiceDesignSerializer.validate_design_data).
  async function handleSaveReal() {
    const result = handleSerialize()
    if (!result) return
    setSaveStatus('saving')
    setError(null)
    try {
      const payload = { name, base_template: template, color_variant: variant, design_data: result }
      const { data } = savedDesignId
        ? await api.put(`/invoices/designs/${savedDesignId}/`, payload)
        : await api.post('/invoices/designs/', payload)
      setSavedDesignId(data.id)
      setSaveStatus('saved')
      setDirty(false) // real bug fix — see refreshUndoState's own comment on why this couldn't rely on hasUndo()
      appendLog(`Saved "${data.name}" (design ${data.id}).`)
      if (id === 'new') navigate(`/invoices/designs/${data.id}/edit`, { replace: true })
    } catch (err) {
      setSaveStatus('error')
      setError(err.response?.data?.design_data?.join?.(' ') || err.response?.data?.name || 'Could not save this design.')
    }
  }

  // Green-Light directive — autosave. Scoped deliberately narrow:
  // real mode AND an already-persisted design (`savedDesignId` set) only.
  // A brand-new, never-saved design (id === 'new') is NEVER autosaved —
  // silently creating a real InvoiceDesign row on a user's account before
  // they ever clicked Save would be a surprising side effect ("where did
  // this design come from"), not a safety net; the unsaved-changes
  // browser warning above already covers that case. Debounced via
  // `lastEditAt` (see its own declaration comment) — 4s of no further
  // edits, reset on every new one, never firing mid-drag.
  useEffect(() => {
    if (!isRealMode || !dirty || !savedDesignId || lastEditAt === 0) return
    const timer = setTimeout(() => { handleSaveReal() }, 4000)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleSaveReal closes over live editor state on purpose; re-declaring it every render (not memoized) is what makes this always save the CURRENT canvas, not a stale snapshot from when the effect first armed.
  }, [isRealMode, dirty, savedDesignId, lastEditAt])

  // Green-Light directive — Template Health. Runs Layers A/C/D against
  // whatever is on screen RIGHT NOW (handleSerialize(), the same live-
  // state extraction handleSaveReal already uses — a design never needs
  // to be saved first to check its own health).
  async function handleCheckHealth() {
    const live = handleSerialize()
    if (!live) return
    setHealthChecking(true)
    try {
      const result = await fetchDesignValidation(live, template, variant)
      setHealthResult(result)
      appendLog(`Template Health: ${result.errors.length} issue(s), ${result.warnings.length} suggestion(s).`)
    } catch {
      setError('Could not check this design\'s health right now.')
    } finally {
      setHealthChecking(false)
    }
  }

  // Green-Light directive — version history. Real GET against
  // apps.invoices.views.design_versions_list; only meaningful once a
  // design has actually been saved once (savedDesignId set).
  async function handleToggleVersions() {
    if (!versionsOpen && savedDesignId) {
      try {
        const { data } = await api.get(`/invoices/designs/${savedDesignId}/versions/`)
        setVersions(data)
      } catch {
        setError('Could not load version history right now.')
        return
      }
    }
    setVersionsOpen((open) => !open)
  }

  async function handleRestoreVersion(versionId, versionNumber) {
    if (!savedDesignId) return
    if (!window.confirm(
      `Restore version ${versionNumber}? Your current unsaved canvas edits (if any) will be replaced — ` +
      'this creates a new version rather than deleting history, so today\'s version stays reachable too.',
    )) return
    setRestoringVersionId(versionId)
    try {
      const { data } = await api.post(`/invoices/designs/${savedDesignId}/versions/${versionId}/restore/`)
      appendLog(`Restored to version ${versionNumber}.`)
      await loadIntoCanvas(data.design_data, data.base_template, data.color_variant)
      const { data: freshVersions } = await api.get(`/invoices/designs/${savedDesignId}/versions/`)
      setVersions(freshVersions)
    } catch {
      setError(`Could not restore version ${versionNumber} right now.`)
    } finally {
      setRestoringVersionId(null)
    }
  }

  // Unsaved-changes browser warning, gated on `isRealMode` (always true —
  // see this file's own header comment). `dirty` is a genuine "changed
  // since last load/save" signal (see refreshUndoState's
  // own comment on the real bug this fixed), not a bare alias of
  // GrapesJS's own hasUndo() — a stale reading here would have meant this
  // warning fired even immediately after a successful save.
  useEffect(() => {
    if (!isRealMode) return
    function handleBeforeUnload(e) {
      if (!dirty) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [isRealMode, dirty])

  function handleUndo() {
    editor?.UndoManager.undo()
  }

  function handleRedo() {
    editor?.UndoManager.redo()
  }

  // Master Blueprint cutover — real "add a new element" support. The
  // single largest gap this blueprint's own audit confirmed (by direct
  // grep, not assumption) was absent from every prior phase: a way to
  // add a brand-new element to a V2 design, rather than only rearranging/
  // restyling what a builtin template already contains.
  function nextIndexForList(ed, list) {
    const container = ed.getWrapper().find(`#${ELEMENTS_CONTAINER_ID}`)[0]
    const sidebarContainer = ed.getWrapper().find(`#${SIDEBAR_ELEMENTS_ID}`)[0]
    let max = -1
    const scan = (c) => {
      if (!c) return
      c.components().forEach((comp) => {
        const attrs = comp.getAttributes()
        if (attrs['data-el-list'] === list) {
          const idx = parseInt(attrs['data-el-index'], 10)
          if (!Number.isNaN(idx) && idx > max) max = idx
        }
      })
    }
    scan(container)
    scan(sidebarContainer)
    return max + 1
  }

  async function handleAddElement() {
    if (!editor) return
    const meta = GENERIC_TYPE_DEFAULTS[newElementType]
    const { x, y } = computeNewElementPlacement(editor)
    const index = nextIndexForList(editor, 'flow')
    let contentHtml = ''
    try {
      contentHtml = await fetchElementContent(
        'generic', newElementType, {}, {}, template, variant, CONTENT_MODE, newElementBinding || null,
      )
    } catch {
      // Non-fatal — the new element starts with empty content; the next
      // style-panel edit's own debounced refresh (StylePanel.jsx's
      // commit()) fills it in, the same real recovery path every
      // existing element's content refresh already relies on.
    }
    const componentDef = buildNewElementEntry({
      type: newElementType, binding: newElementBinding || null,
      x, y, width: meta.width, height: meta.height, contentHtml, index,
    })
    const container = editor.getWrapper().find(`#${ELEMENTS_CONTAINER_ID}`)[0]
    if (!container) return
    const added = container.append(componentDef)
    const newComp = Array.isArray(added) ? added[0] : added
    editor.select(newComp)
    readSelection(editor)
    refreshUndoState(editor)
    setOverflowScan(scanAllElementsForOverflow(editor))
    appendLog(`Added a new ${meta.label} element at x=${x}mm y=${Math.round(y * 10) / 10}mm.`)
  }

  // Green-Light directive — the Layers panel (order/lock/hide).
  const NOTES_SECTION_LABELS = { notes: 'Notes', terms: 'Terms' }
  function labelForLayerElement(el) {
    if (el.kind === 'generic' && el.type === 'text' && el.binding) {
      return BINDING_OPTIONS.find((o) => o.value === el.binding)?.label || el.binding
    }
    if (el.kind === 'generic') return GENERIC_TYPE_DEFAULTS[el.type]?.label || el.type
    if (el.type === 'notes') {
      const sections = el.style?.sections || []
      return sections.map((s) => NOTES_SECTION_LABELS[s] || s).join(' & ') || 'Notes'
    }
    const FRIENDLY_TYPE_LABELS = {
      logo: 'Logo', business_info: 'Business Info', client_info: 'Client Info', dates: 'Dates',
      totals: 'Totals', signature: 'Signature', payment_info: 'Payment Info',
      qr_code: 'QR Code', online_payment_link: 'Pay Online Link', table: 'Line Items Table',
    }
    return FRIENDLY_TYPE_LABELS[el.type] || el.type
  }

  // Real, live snapshot (handleSerialize(), not stale `designData`/
  // `canvasDoc` state) — refreshed after every layer action so the panel
  // always reflects the actual current canvas, not what it looked like
  // when first opened.
  function refreshLayers() {
    const live = handleSerialize()
    if (!live) return
    const entries = [
      ...live.header.elements.map((el, index) => ({ list: 'header', index, el })),
      ...live.flow.elements.map((el, index) => ({ list: 'flow', index, el })),
    ]
    setLayersList(entries)
  }

  function handleToggleLayers() {
    if (!layersOpen) refreshLayers()
    setLayersOpen((open) => !open)
  }

  // Live components are addressed by (data-el-list, data-el-index) — the
  // exact same scheme nextIndexForList already scans (both the main and
  // sidebar containers, since a sidebar-flagged element can appear in
  // either), never by DOM position (extraction sorts by this index, not
  // DOM order — see serialization.js's extractV2DesignDataFromEditor).
  function findLiveComponent(list, index) {
    const container = editor.getWrapper().find(`#${ELEMENTS_CONTAINER_ID}`)[0]
    const sidebarContainer = editor.getWrapper().find(`#${SIDEBAR_ELEMENTS_ID}`)[0]
    for (const c of [container, sidebarContainer]) {
      if (!c) continue
      const match = c.components().find((comp) => {
        const attrs = comp.getAttributes()
        return attrs['data-el-list'] === list && parseInt(attrs['data-el-index'], 10) === index
      })
      if (match) return match
    }
    return null
  }

  function handleMoveLayer(list, index, direction) {
    if (!editor) return
    const targetIndex = index + direction
    const current = findLiveComponent(list, index)
    const target = findLiveComponent(list, targetIndex)
    if (!current || !target) return // already at the top/bottom of its own list
    // Swap data-el-index — this alone changes stacking/paint order AND
    // extraction order (both read this attribute, never DOM position),
    // with zero geometry change to either element.
    current.addAttributes({ 'data-el-index': String(targetIndex) })
    target.addAttributes({ 'data-el-index': String(index) })
    setDirty(true)
    setLastEditAt(Date.now())
    refreshLayers()
  }

  function handleToggleLock(list, index) {
    if (!editor) return
    const comp = findLiveComponent(list, index)
    if (!comp) return
    const nowLocked = !comp.getAttributes()['data-locked']
    if (nowLocked) comp.addAttributes({ 'data-locked': 'true' })
    else comp.removeAttributes('data-locked')
    comp.set({ draggable: !nowLocked, resizable: !nowLocked })
    setDirty(true)
    setLastEditAt(Date.now())
    refreshLayers()
  }

  function handleToggleHide(list, index) {
    if (!editor) return
    const comp = findLiveComponent(list, index)
    if (!comp) return
    const nowHidden = !comp.getAttributes()['data-hidden']
    if (nowHidden) comp.addAttributes({ 'data-hidden': 'true' })
    else comp.removeAttributes('data-hidden')
    comp.addStyle(nowHidden ? { opacity: '0.35', 'pointer-events': 'none' } : { opacity: '1', 'pointer-events': 'auto' })
    setDirty(true)
    setLastEditAt(Date.now())
    refreshLayers()
    setOverflowScan(scanAllElementsForOverflow(editor))
  }

  function alignKey(list, index) {
    return `${list}-${index}`
  }

  function handleToggleAlignSelection(list, index) {
    setAlignSelection((prev) => {
      const next = new Set(prev)
      const key = alignKey(list, index)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // Every checked entry, resolved back against the current layersList —
  // deliberately re-derived on each render (not memoized) since
  // layersList itself only changes when refreshLayers() runs, which
  // already happens after every action that could invalidate it.
  const alignSelectedEntries = layersList.filter((e) => alignSelection.has(alignKey(e.list, e.index)))
  const alignSelectionSameList = alignSelectedEntries.length >= 2
    && alignSelectedEntries.every((e) => e.list === alignSelectedEntries[0].list)

  function applyPositionDeltas(entries, deltas) {
    if (!editor) return
    entries.forEach((entry, i) => {
      const delta = deltas[i]
      if (!delta || (delta.x === undefined && delta.y === undefined)) return
      const comp = findLiveComponent(entry.list, entry.index)
      if (!comp) return
      const style = {}
      if (delta.x !== undefined) style.left = `${mmToPx(delta.x)}px`
      if (delta.y !== undefined) style.top = `${mmToPx(delta.y)}px`
      comp.addStyle(style)
    })
    setDirty(true)
    setLastEditAt(Date.now())
    refreshLayers()
    setOverflowScan(scanAllElementsForOverflow(editor))
  }

  function handleAlign(mode) {
    if (!alignSelectionSameList) return
    const deltas = computeAlignedPositions(alignSelectedEntries.map((e) => e.el), mode)
    applyPositionDeltas(alignSelectedEntries, deltas)
  }

  function handleDistribute(axis) {
    if (alignSelectedEntries.length < 3 || !alignSelectionSameList) return
    const deltas = computeDistributedPositions(alignSelectedEntries.map((e) => e.el), axis)
    applyPositionDeltas(alignSelectedEntries, deltas)
  }

  // Master Blueprint cutover — "Duplicate" (StylePanel.jsx's own button,
  // wired here rather than reimplemented there, so index assignment stays
  // in the one place that already computes it for "Add"). Uses GrapesJS's
  // own native `comp.clone()` (preserves style/attributes/content
  // completely — the table's own real markup included, if it were ever
  // duplicable) rather than reconstructing a component definition by
  // hand; only position (offset so it's visibly distinct from the
  // original) and a fresh, real `data-el-index` are corrected afterward.
  function handleDuplicateSelected() {
    if (!editor) return
    const comp = editor.getSelected()
    if (!comp || !comp.get('removable')) return // mirrors Delete's own guard — the mandatory table can't be duplicated either
    const parent = comp.parent()
    if (!parent) return
    const style = comp.getStyle() || {}
    const leftMm = pxToMm(parseFloat(style.left) || 0)
    const topMm = pxToMm(parseFloat(style.top) || 0) + 8 // a small, real, visible offset — never on top of the original
    const clone = comp.clone()
    const added = parent.append(clone)
    const newComp = Array.isArray(added) ? added[0] : added
    // clone() already preserves data-el-list/data-el-kind/data-el-type/
    // data-style-json/data-overrides-json/data-binding verbatim — only
    // data-el-index needs a fresh, real value (a clone starts with an
    // exact copy of the original's index, which would collide with it).
    const list = comp.getAttributes()['data-el-list'] || 'flow'
    newComp.addAttributes({ 'data-el-index': String(nextIndexForList(editor, list)) })
    newComp.addStyle({ left: `${mmToPx(leftMm)}px`, top: `${mmToPx(topMm)}px` })
    editor.select(newComp)
    readSelection(editor)
    refreshUndoState(editor)
    setOverflowScan(scanAllElementsForOverflow(editor))
    appendLog(`Duplicated the selected ${comp.getAttributes()['data-el-type']} element.`)
  }

  const pageWidthPx = canvasDoc ? mmToPx(canvasDoc.page.width_mm) : 0
  const pageHeightPx = canvasDoc ? mmToPx(canvasDoc.page.height_mm) : 0

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9000, display: 'flex', flexDirection: 'column', background: 'var(--bg-page)' }}>
      <div style={{
        // Phase 4B.2 real bug found via this phase's own Playwright
        // verification: `height: 56` (fixed) combined with `flexWrap:
        // 'wrap'` meant that once enough toolbar items were present at
        // once (confirmed directly: the real "Unsaved changes" badge
        // plus the full button set at a real 1600px viewport width) to
        // wrap onto a second/third row, the overflowing rows rendered
        // BELOW this bar's own fixed box — invisible and unclickable,
        // silently covered by the canvas viewport area's own div
        // painting on top of them (confirmed directly: Reload from
        // serialized/Show canonical reference became permanently
        // unreachable by real mouse clicks once wrapped this way).
        // `minHeight` lets the bar grow to fit however many rows it
        // actually needs, pushing the canvas area down instead.
        minHeight: 56, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px',
        background: 'var(--bg-surface)', borderBottom: '1px solid var(--border-default)', flexWrap: 'wrap', rowGap: 8,
      }}
      >
        <strong style={{ fontSize: '0.85rem' }}>Template Builder</strong>
        {dirty && (
          <span data-testid="v2-dirty-badge" style={{ fontSize: '0.7rem', color: 'var(--accent-dim)', background: 'var(--accent-glow)', padding: '2px 8px', borderRadius: 999 }}>
            Unsaved changes
          </span>
        )}
        <div style={{ width: 1, height: 24, background: 'var(--border-default)' }} />

        {isRealMode && (
          <>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Design name"
              data-testid="v2-real-name-input"
              style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border-default)' }}
            />
            <button
              className="fos-btn fos-btn-accent"
              onClick={handleSaveReal}
              disabled={!editor || !canvasDoc || saveStatus === 'saving'}
              data-testid="v2-real-save-btn"
            >
              {saveStatus === 'saving' ? 'Saving…' : 'Save'}
            </button>
            {saveStatus === 'saved' && (
              <span style={{ fontSize: '0.72rem', color: 'var(--success, #2f9e44)' }}>Saved</span>
            )}
            <button
              className="fos-btn fos-btn-ghost"
              onClick={() => {
                // `beforeunload` (above) only catches an actual tab close/
                // refresh/URL navigation — React Router's client-side
                // navigate() bypasses it entirely, so an in-app "Back"
                // click needs its own, equivalent confirmation.
                if (dirty && !window.confirm('You have unsaved changes. Leave this page and discard them?')) return
                navigate('/invoices/designs')
              }}
              data-testid="v2-real-back-btn"
            >
              Back to designs
            </button>
            <div style={{ width: 1, height: 24, background: 'var(--border-default)' }} />
          </>
        )}

        <select value={template} onChange={(e) => { setTemplate(e.target.value); setVariant('') }} data-testid="v2-template-select">
          {builtins.templates.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={variant} onChange={(e) => setVariant(e.target.value)} data-testid="v2-variant-select">
          <option value="">default</option>
          {(builtins.variants[template] || []).filter((v) => v !== 'default').map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>
        <button className="fos-btn fos-btn-accent" onClick={handleLoadBuiltin} disabled={loading} data-testid="v2-load-btn">
          {loading ? 'Loading…' : 'Load'}
        </button>
        <button className="fos-btn fos-btn-ghost" onClick={handleLoadBlank} disabled={loading} data-testid="v2-load-blank-btn">
          Start blank
        </button>

        <div style={{ width: 1, height: 24, background: 'var(--border-default)' }} />

        <span style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>Zoom</span>
        {ZOOM_LEVELS.map((z) => (
          <button
            key={z}
            onClick={() => setZoom(z)}
            data-testid={`v2-zoom-${z}`}
            style={{
              padding: '4px 8px', borderRadius: 6, fontSize: '0.75rem', cursor: 'pointer',
              border: zoom === z ? '1px solid var(--accent)' : '1px solid var(--border-default)',
              background: zoom === z ? 'var(--accent-glow)' : 'transparent',
            }}
          >
            {Math.round(z * 100)}%
          </button>
        ))}

        <div style={{ width: 1, height: 24, background: 'var(--border-default)' }} />

        <button className="fos-btn fos-btn-ghost" onClick={handleUndo} disabled={!canUndo} data-testid="v2-undo-btn">
          Undo
        </button>
        <button className="fos-btn fos-btn-ghost" onClick={handleRedo} disabled={!canRedo} data-testid="v2-redo-btn">
          Redo
        </button>

        <div style={{ width: 1, height: 24, background: 'var(--border-default)' }} />

        <button
          className="fos-btn fos-btn-ghost"
          onClick={handleCheckHealth}
          disabled={!editor || !canvasDoc || healthChecking}
          data-testid="v2-health-btn"
        >
          {healthChecking ? 'Checking…' : 'Check design health'}
        </button>
      </div>

      {error && (
        <div style={{ padding: '8px 16px 0' }}>
          <FosAlert type="error" onDismiss={() => setError(null)}>{error}</FosAlert>
        </div>
      )}

      {/* Phase 5.5c — the reload/editor-level advisory. Page-level and
          aggregate, distinct from 5.5b's own per-element data-v2-overflow
          attribute/outline/Style-Panel-warning (which this does NOT
          replace) — see this file's own scanAllElementsForOverflow.
          Deliberately non-dismissible: it reflects a live, currently-true
          condition (recomputed at every settle point above), not a
          one-time notification — dismissing a still-true status banner
          would misrepresent the design's actual current state, and
          nothing about this signal genuinely requires a dismiss
          affordance (FosAlert only renders one when onDismiss is passed;
          omitted here on purpose). */}
      {overflowScan.count > 0 && (
        <div data-testid="v2-reload-advisory" style={{ padding: '8px 16px 0' }}>
          <FosAlert type="warning">
            {overflowScan.count} element{overflowScan.count === 1 ? '' : 's'} currently exceed{overflowScan.count === 1 ? 's' : ''} {overflowScan.count === 1 ? 'its' : 'their'} design box — review the highlighted elements (dashed amber outline) before relying on this design. Based on content currently rendered in the editor; it does not predict every future invoice.
          </FosAlert>
        </div>
      )}

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
        <div style={{ flex: 1, overflow: 'auto', background: '#d8d8e0', padding: 24, display: 'flex', justifyContent: 'center' }}>
          {canvasDoc ? (
            // Viewport-scale wrapper — the ONLY thing `zoom` affects. The
            // inner box below has a real, fixed, document-derived px size
            // (mmToPx(page.width_mm/height_mm), never an arbitrary
            // constant and never dependent on the browser's own viewport
            // width — Phase 3 Part 2/3's own requirement). Changing `zoom`
            // never touches canvasDoc, designData, or the live GrapesJS
            // component tree in any way — purely a CSS transform applied
            // OUTSIDE the document's own coordinate space.
            <div style={{ transform: `scale(${zoom})`, transformOrigin: 'top center', transition: 'transform 0.15s ease' }}>
              <div
                data-testid="v2-page-frame"
                data-page-width-px={pageWidthPx}
                data-page-height-px={pageHeightPx}
                style={{ width: pageWidthPx, minHeight: pageHeightPx, background: '#fff', boxShadow: '0 4px 24px rgba(0,0,0,0.18)' }}
              >
                <GjsEditor
                  grapesjs={grapesjs}
                  options={{
                    height: `${pageHeightPx}px`,
                    width: `${pageWidthPx}px`,
                    storageManager: false,
                    // Phase 4A.1 real fix: every V2 canvas element shares one
                    // generic chrome class (`lancera-v2-el`, componentTypes.js)
                    // used for nothing but editor styling. GrapesJS's
                    // SelectorManager defaults to targeting a component's
                    // CLASS-based selector over its own ID-based one whenever
                    // classes are present (confirmed directly in the installed
                    // grapesjs/dist bundle) — so componentTypes.js's
                    // `updateTarget`'s own `comp.addStyle()` call (Phase 4A's
                    // resize-commit fix) was writing resize geometry into a
                    // SHARED `.lancera-v2-el { ... }` rule instead of that
                    // one component's own `#<id> { ... }` rule, live-verified
                    // via a real Playwright resize: resizing one Zone 1 header
                    // element silently overwrote position/size on 5 unrelated
                    // Zone 2 elements at once. `componentFirst: true` is
                    // GrapesJS's own documented option for exactly this case
                    // — it forces every style write to target the component's
                    // own rule regardless of shared classes.
                    selectorManager: { componentFirst: true },
                  }}
                  onEditor={onEditorInit}
                >
                  <Canvas />
                </GjsEditor>
              </div>
            </div>
          ) : (
            <div style={{ color: 'var(--text-secondary)', padding: 40 }}>
              Pick a template above, then either "Load" a ready-made layout or "Start blank" and build your own from scratch.
            </div>
          )}
        </div>

        <div style={{ width: 260, flexShrink: 0, borderLeft: '1px solid var(--border-default)', background: 'var(--bg-surface)', overflowY: 'auto', padding: 10 }}>
          {/* Master Blueprint cutover — real "add a new element" support.
              Confirmed absent from every prior phase (direct grep, not
              assumption) — without this, the editor could only
              rearrange/restyle a loaded builtin template, never build a
              genuinely custom design from scratch. */}
          <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-tertiary)', marginBottom: 6 }}>Add element</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12, paddingBottom: 12, borderBottom: '1px solid var(--border-default)' }}>
            <select
              value={newElementType}
              onChange={(e) => setNewElementType(e.target.value)}
              data-testid="v2-new-element-type"
              style={{ fontSize: '0.75rem' }}
            >
              {Object.entries(GENERIC_TYPE_DEFAULTS).map(([type, meta]) => (
                <option key={type} value={type}>{meta.label}</option>
              ))}
            </select>
            {newElementType === 'text' && (
              <select
                value={newElementBinding}
                onChange={(e) => setNewElementBinding(e.target.value)}
                data-testid="v2-new-element-binding"
                style={{ fontSize: '0.75rem' }}
              >
                {BINDING_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </select>
            )}
            <button
              type="button"
              className="fos-btn fos-btn-accent"
              onClick={handleAddElement}
              disabled={!editor || !canvasDoc}
              data-testid="v2-add-element-btn"
            >
              Add to canvas
            </button>
          </div>

          {/* Green-Light directive (§18-22's "non-designer-first" framing)
              — plain-language legend for the canvas's own blue-dot marker
              (injected as editor-only CSS, [data-binding]::before, above),
              so "why does this box have a dot and this one doesn't" has an
              answer without opening StylePanel and reading a raw binding
              key like "client.name". */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, padding: '6px 8px',
            fontSize: '0.68rem', color: 'var(--text-secondary)', background: 'var(--bg-page)', borderRadius: 4,
          }}>
            <span style={{
              display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
              background: '#2563eb', border: '1px solid #ffffff', flexShrink: 0,
            }} />
            <span>Blue dot = fills in automatically from real invoice data</span>
          </div>

          <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-tertiary)', marginBottom: 6 }}>Selection</div>
          <StylePanel
            editor={editor}
            selected={selected}
            baseTemplate={template}
            colorVariant={variant}
            contentMode={CONTENT_MODE}
            designPrimaryColor={canvasDoc?.design_primary_color}
            designSecondaryColor={canvasDoc?.design_secondary_color}
            onDuplicate={handleDuplicateSelected}
            onChange={() => {
              // Phase 5.5c: this fires both synchronously (right after
              // comp.addStyle(), before the debounced content refresh
              // lands) and again 300ms later once it settles (StylePanel's
              // own commit()) — the synchronous call can transiently scan
              // stale (pre-refresh) content for whichever element was just
              // edited, but the settled call 300ms later always corrects
              // it, exactly mirroring how the pre-existing 5.5b per-element
              // indicator already behaves under the same debounce.
              if (editor) { readSelection(editor); refreshUndoState(editor); setOverflowScan(scanAllElementsForOverflow(editor)) }
            }}
            onMeasureOverflow={measureAndMarkOverflow}
          />

          {/* Green-Light directive — Template Health (validation Layers
              A/C/D via design_validate). Plain-language findings, no
              raw codes/categories shown — severity communicated by icon
              + color, matching this codebase's icon-not-emoji rule. */}
          <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-tertiary)', marginBottom: 6 }}>Template health</div>
          <div data-testid="v2-health-panel" style={{ marginBottom: 12, paddingBottom: 12, borderBottom: '1px solid var(--border-default)' }}>
            {!healthResult && (
              <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>
                Not checked yet — click "Check design health" above.
              </div>
            )}
            {healthResult && healthResult.errors.length === 0 && healthResult.warnings.length === 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', color: 'var(--success-text)' }}>
                <CheckCircle2 size={14} />
                <span>Looks good — no issues found.</span>
              </div>
            )}
            {healthResult && (healthResult.errors.length > 0 || healthResult.warnings.length > 0) && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {healthResult.errors.map((finding, i) => (
                  <div key={`err-${i}`} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: '0.72rem', color: 'var(--danger)' }}>
                    <XCircle size={13} style={{ marginTop: 1, flexShrink: 0 }} />
                    <span>{finding.message}</span>
                  </div>
                ))}
                {healthResult.warnings.map((finding, i) => (
                  <div key={`warn-${i}`} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: '0.72rem', color: 'var(--warning-text)' }}>
                    <AlertTriangle size={13} style={{ marginTop: 1, flexShrink: 0 }} />
                    <span>{finding.message}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Green-Light directive — the Layers panel (order/lock/hide).
              Available whenever a canvas is loaded, real or diagnostic
              mode — this is pure editor-canvas manipulation, no backend
              call involved (unlike Template Health/version history). */}
          {editor && canvasDoc && (
            <div style={{ marginBottom: 12, paddingBottom: 12, borderBottom: '1px solid var(--border-default)' }}>
              <button
                type="button"
                className="fos-btn fos-btn-ghost"
                onClick={handleToggleLayers}
                data-testid="v2-layers-toggle-btn"
                style={{ width: '100%', textAlign: 'left', fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-tertiary)' }}
              >
                {layersOpen ? 'Hide layers' : 'Show layers'}
              </button>
              {layersOpen && (
                <div data-testid="v2-layers-panel" style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {['header', 'flow'].map((listName) => {
                    const entries = layersList.filter((e) => e.list === listName)
                    if (entries.length === 0) return null
                    return (
                      <div key={listName}>
                        <div style={{ fontSize: '0.66rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', margin: '4px 0 2px' }}>
                          {listName === 'header' ? 'Header' : 'Body'}
                        </div>
                        {entries.map(({ list, index, el }) => (
                          <div
                            key={`${list}-${index}`}
                            data-testid={`v2-layer-${list}-${index}`}
                            style={{
                              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4,
                              fontSize: '0.72rem', padding: '2px 0', opacity: el.hidden ? 0.55 : 1,
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={alignSelection.has(alignKey(list, index))}
                              onChange={() => handleToggleAlignSelection(list, index)}
                              title="Select for alignment"
                              data-testid={`v2-layer-select-${list}-${index}`}
                              style={{ flexShrink: 0 }}
                            />
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                              {labelForLayerElement(el)}
                            </span>
                            <span style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                              <button
                                type="button" className="fos-btn fos-btn-ghost"
                                onClick={() => handleMoveLayer(list, index, -1)}
                                disabled={index === 0}
                                title="Move up (in front)"
                                data-testid={`v2-layer-up-${list}-${index}`}
                                style={{ fontSize: '0.66rem', padding: '1px 5px' }}
                              >↑</button>
                              <button
                                type="button" className="fos-btn fos-btn-ghost"
                                onClick={() => handleMoveLayer(list, index, 1)}
                                disabled={index === entries.length - 1}
                                title="Move down (behind)"
                                data-testid={`v2-layer-down-${list}-${index}`}
                                style={{ fontSize: '0.66rem', padding: '1px 5px' }}
                              >↓</button>
                              <button
                                type="button" className="fos-btn fos-btn-ghost"
                                onClick={() => handleToggleLock(list, index)}
                                title={el.locked ? 'Unlock' : 'Lock'}
                                data-testid={`v2-layer-lock-${list}-${index}`}
                                style={{ fontSize: '0.66rem', padding: '1px 5px', color: el.locked ? 'var(--accent)' : undefined }}
                              >{el.locked ? 'Locked' : 'Lock'}</button>
                              <button
                                type="button" className="fos-btn fos-btn-ghost"
                                onClick={() => handleToggleHide(list, index)}
                                // The line-items table is mandatory and
                                // non-removable everywhere else in this
                                // editor (design_schema's own required-
                                // elements rule) — hiding it would produce
                                // the exact same broken-invoice outcome as
                                // deleting it, so the same rule applies here.
                                disabled={el.type === 'table'}
                                title={el.type === 'table' ? 'The line-items table cannot be hidden' : el.hidden ? 'Show' : 'Hide'}
                                data-testid={`v2-layer-hide-${list}-${index}`}
                                style={{ fontSize: '0.66rem', padding: '1px 5px', color: el.hidden ? 'var(--warning-text)' : undefined }}
                              >{el.hidden ? 'Hidden' : 'Hide'}</button>
                            </span>
                          </div>
                        ))}
                      </div>
                    )
                  })}
                  {alignSelectedEntries.length >= 2 && (
                    <div data-testid="v2-align-toolbar" style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--border-default)' }}>
                      {!alignSelectionSameList ? (
                        <div style={{ fontSize: '0.68rem', color: 'var(--warning-text)' }}>
                          Select elements from the same section (Header or Body) to align them together.
                        </div>
                      ) : (
                        <>
                          <div style={{ fontSize: '0.66rem', color: 'var(--text-tertiary)', marginBottom: 4 }}>
                            Align {alignSelectedEntries.length} selected
                          </div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                            {[
                              ['left', 'Left'], ['center-h', 'Center'], ['right', 'Right'],
                              ['top', 'Top'], ['middle-v', 'Middle'], ['bottom', 'Bottom'],
                            ].map(([mode, label]) => (
                              <button
                                key={mode} type="button" className="fos-btn fos-btn-ghost"
                                onClick={() => handleAlign(mode)}
                                data-testid={`v2-align-${mode}`}
                                style={{ fontSize: '0.66rem', padding: '2px 6px' }}
                              >{label}</button>
                            ))}
                          </div>
                          {alignSelectedEntries.length >= 3 && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 4 }}>
                              <button
                                type="button" className="fos-btn fos-btn-ghost"
                                onClick={() => handleDistribute('horizontal')}
                                data-testid="v2-distribute-horizontal"
                                style={{ fontSize: '0.66rem', padding: '2px 6px' }}
                              >Distribute horizontally</button>
                              <button
                                type="button" className="fos-btn fos-btn-ghost"
                                onClick={() => handleDistribute('vertical')}
                                data-testid="v2-distribute-vertical"
                                style={{ fontSize: '0.66rem', padding: '2px 6px' }}
                              >Distribute vertically</button>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {isRealMode && savedDesignId && (
            <div style={{ marginBottom: 12, paddingBottom: 12, borderBottom: '1px solid var(--border-default)' }}>
              <button
                type="button"
                className="fos-btn fos-btn-ghost"
                onClick={handleToggleVersions}
                data-testid="v2-versions-toggle-btn"
                style={{ width: '100%', textAlign: 'left', fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-tertiary)' }}
              >
                {versionsOpen ? 'Hide version history' : 'Show version history'}
              </button>
              {versionsOpen && (
                <div data-testid="v2-versions-panel" style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {versions.length === 0 && (
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>No saved versions yet.</div>
                  )}
                  {versions.map((v) => (
                    <div
                      key={v.id}
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.72rem', gap: 6 }}
                    >
                      <span>
                        Version {v.version_number}
                        {' — '}
                        <span style={{ color: 'var(--text-tertiary)' }}>{new Date(v.created_at).toLocaleString()}</span>
                      </span>
                      <button
                        type="button"
                        className="fos-btn fos-btn-ghost"
                        onClick={() => handleRestoreVersion(v.id, v.version_number)}
                        disabled={restoringVersionId !== null}
                        data-testid={`v2-restore-version-${v.version_number}`}
                        style={{ fontSize: '0.68rem', padding: '2px 8px', flexShrink: 0 }}
                      >
                        {restoringVersionId === v.id ? 'Restoring…' : 'Restore'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-tertiary)', marginBottom: 6 }}>Activity</div>
          <div data-testid="v2-log" style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {log.map((line, i) => <div key={i}>{line}</div>)}
          </div>
          {canvasDoc && (
            <div style={{ marginTop: 12, fontSize: '0.72rem', color: 'var(--text-secondary)' }} data-testid="v2-page-meta">
              <div>Page: {canvasDoc.page.width_mm}×{canvasDoc.page.height_mm}mm</div>
              <div>Margins: {canvasDoc.page.margin_top_mm}/{canvasDoc.page.margin_right_mm}/{canvasDoc.page.margin_bottom_mm}/{canvasDoc.page.margin_left_mm}mm</div>
              <div>Sidebar: {canvasDoc.page.sidebar ? `${canvasDoc.page.sidebar.width_mm}mm` : 'none'}</div>
              <div>Zoom (viewport only): {Math.round(zoom * 100)}% — document unchanged</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
