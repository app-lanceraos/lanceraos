// src/pages/design-editor/DesignEditor.jsx
//
// The full-screen, shell-less canvas editor (Step 8b) — deliberately NOT
// wrapped in AppShell, same "standalone" routing pattern DeletionReview.jsx
// already established in this codebase (see App.jsx). A drag-and-drop
// canvas genuinely needs more room than AppShell's standard main-content
// frame gives every other page, and precedent for a shell-less authenticated
// route already exists here rather than being invented for this step — see
// DECISIONS.md for the full reasoning and the "obvious way back" this page
// provides (the top bar's persistent "Designs" back button, always visible,
// including in preview mode).
//
// Built on GrapesJS core (not Puck — see DECISIONS.md's Step 8b entry for
// why: Puck's own docs confirm a slot/zone-only component model with no
// absolute-positioning support at all, a hard blocker for Zone 1's genuine
// coordinate-based requirement; GrapesJS's core, free, open-source API
// supports real per-component `dmode:'absolute'` drag and `resizable`
// handles, confirmed directly against this project's actual installed
// version's source, not assumed from docs alone).
//
// 20 August 2026 rework (see DECISIONS.md's "canvas must render the real
// thing" entry) — a real, direct SEV1 report: the canvas used to be a
// disconnected abstract representation (generic gray boxes/labels, system
// fallback fonts, sample data unrelated to the real freelancer) that
// didn't match what actually gets rendered, causing resize/reflow
// decisions made in the canvas to visibly break the real invoice output.
// The canvas now loads the ACTUAL rendered markup for the design being
// edited (apps/invoices/design_renderer.py's own real per-element output,
// via the new /invoices/designs/editor-canvas/ endpoint — real freelancer
// profile, real fonts, real resolved colors, sample-but-realistic
// invoice-specific content) as each element's real `content`, and
// refreshes it live (debounced, /invoices/designs/editor-element/) on
// every style-panel change — see realContent.js for the full mechanism.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import GjsEditor, { Canvas } from '@grapesjs/react'
import grapesjs from 'grapesjs'
import 'grapesjs/dist/css/grapes.min.css'

import api from '@/lib/api'
import useTitle from '@/hooks/useTitle'
import FosAlert from '@/components/FosAlert'
import { registerBlocks } from '@/lib/designEditor/blocks'
import { refreshTotalsRemovability, registerComponentTypes } from '@/lib/designEditor/componentTypes'
import { BLANK_DESIGN_DATA, MM_TO_PX, PAGE_WIDTH_MM, PX_TO_MM } from '@/lib/designEditor/constants'
import { fetchRealCanvasContent, fetchRealElementContent } from '@/lib/designEditor/realContent'
import {
  buildComponentTreeFromDesignData, extractDesignDataFromEditor,
  TABLE_COMPONENT_ID, ZONE2_CONTAINER_ID,
} from '@/lib/designEditor/serialization'
import EditorTopBar from './EditorTopBar'
import ElementSettingsPanel from './ElementSettingsPanel'

const CONTENT_REFRESH_DEBOUNCE_MS = 400

function parsePx(value) {
  const n = parseFloat(String(value || '0').replace('px', ''))
  return Number.isFinite(n) ? n : 0
}

function countPaired(editor) {
  const zone2 = editor.getWrapper().find(`#${ZONE2_CONTAINER_ID}`)[0]
  if (!zone2) return 0
  let n = 0
  zone2.components().forEach((c) => {
    if (c.getAttributes()['data-paired'] === 'true') n += 1
  })
  return n
}

export default function DesignEditor() {
  const { id } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  useTitle('Design Editor — LanceraOS')

  const [editor, setEditor] = useState(null)
  const [design, setDesign] = useState(null)
  const [realContent, setRealContent] = useState(null)
  const [loading, setLoading] = useState(true)
  const [contentError, setContentError] = useState(false)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState([])
  const [selected, setSelected] = useState(null)
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [sampleRows, setSampleRows] = useState(3)

  const blocksPanelRef = useRef(null)
  const loadedRef = useRef(false)
  const refreshTimerRef = useRef(null)

  // ── Step 1: load the design's own metadata (unchanged) ──────────────
  useEffect(() => {
    let cancelled = false
    async function load() {
      if (id && id !== 'new') {
        try {
          const { data } = await api.get(`/invoices/designs/${id}/`)
          if (!cancelled) setDesign(data)
        } catch {
          if (!cancelled) setErrors(['Could not load this design.'])
        }
      } else {
        const seed = location.state?.seedDesign || {
          name: 'Untitled design', base_template: 'professional', source: 'custom',
          color_variant: '', design_data: BLANK_DESIGN_DATA,
        }
        if (!cancelled) setDesign(seed)
      }
    }
    load()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // ── Step 2: fetch the REAL rendered markup for that design — real
  // freelancer profile, real fonts, real resolved color, sample-but-
  // realistic invoice content. Runs independently of GrapesJS's own
  // init (doesn't need `editor` to exist yet) so both can proceed in
  // parallel; the tree-building effect below waits for both. ─────────
  useEffect(() => {
    if (!design) return
    let cancelled = false
    async function loadRealContent() {
      try {
        const content = await fetchRealCanvasContent(design.design_data, design.base_template, design.color_variant, sampleRows)
        if (!cancelled) { setRealContent(content); setContentError(false) }
      } catch {
        if (!cancelled) setContentError(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    loadRealContent()
    return () => { cancelled = true }
    // Deliberately only on `design` itself loading, not `sampleRows` —
    // the sample-row COUNT is a pure client-side regeneration
    // (componentTypes.js's renderSampleRows, real CSS classes already
    // loaded) once the table's real header/classes are fetched once;
    // re-fetching the whole canvas over a row-count change would be
    // real, unnecessary backend load for content that doesn't change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [design])

  const updateSelectedFromEditor = useCallback((ed) => {
    const comp = ed.getSelected()
    if (!comp) { setSelected(null); return }
    const type = comp.get('type')

    if (type === 'lancera-table') { setSelected({ kind: 'table' }); return }
    if (type !== 'lancera-zone1-element' && type !== 'lancera-zone2-element') { setSelected(null); return }

    const attrs = comp.getAttributes()
    let style = {}
    try { style = JSON.parse(attrs['data-style-json'] || '{}') } catch { /* keep {} */ }

    if (type === 'lancera-zone1-element') {
      setSelected({ kind: 'zone1', elType: attrs['data-el-type'], style })
    } else {
      const compStyle = comp.getStyle() || {}
      setSelected({
        kind: 'zone2',
        elType: attrs['data-el-type'],
        style,
        spacingMm: Math.round(parsePx(compStyle['margin-top']) * PX_TO_MM * 100) / 100,
        paired: attrs['data-paired'] === 'true',
        pairCount: countPaired(ed),
      })
    }
  }, [])

  // Fetches real content for one component and applies it directly to
  // the live DOM node (plus keeping the model's own `content` in sync,
  // in case GrapesJS ever re-renders this view from the model later —
  // e.g. undo/redo). Shared by the debounced style-panel refresh and the
  // immediate fetch for a freshly-dropped palette block.
  const refreshComponentContent = useCallback(async (comp, elType, style) => {
    if (!design) return
    try {
      const html = await fetchRealElementContent(elType, style, design.base_template, design.color_variant)
      comp.set('content', html)
      const domEl = comp.getEl && comp.getEl()
      if (domEl) domEl.innerHTML = html
    } catch {
      // Non-fatal — the canvas keeps showing whatever content it already had.
    }
  }, [design])

  const onEditorInit = useCallback((ed) => {
    setEditor(ed)
    registerComponentTypes(ed)
    registerBlocks(ed)

    ed.on('component:selected', () => updateSelectedFromEditor(ed))
    ed.on('component:deselected', () => setSelected(null))
    ed.on('component:update', () => updateSelectedFromEditor(ed))
    const refreshUndoState = () => {
      setCanUndo(ed.UndoManager.hasUndo())
      setCanRedo(ed.UndoManager.hasRedo())
    }
    ed.on('component:add component:remove component:update', refreshUndoState)
    ed.on('undo redo', refreshUndoState)

    // Real editor-level events (fire for any change anywhere in the tree),
    // unlike the component-level 'add'/'remove' a first attempt at this
    // tried listening for directly on the zone_2 container model — those
    // fire on the child *collection*, not the model, and never bubble; see
    // componentTypes.js's own comment on that dead end.
    const refreshTotals = () => {
      const zone2 = ed.getWrapper().find(`#${ZONE2_CONTAINER_ID}`)[0]
      refreshTotalsRemovability(zone2)
    }
    ed.on('component:add component:remove', refreshTotals)

    // A freshly-dropped palette block (blocks.js) has no real content
    // yet — fetch it immediately, the same real per-element endpoint a
    // style-panel edit already uses. Guarded on `data-style-json`
    // presence rather than a one-shot flag, since this needs to fire
    // exactly once per genuinely new element, not on every 'component:add'
    // (which also fires for the initial tree load itself).
    ed.on('component:add', (comp) => {
      const type = comp.get('type')
      if (type !== 'lancera-zone1-element' && type !== 'lancera-zone2-element') return
      if (comp.get('content')) return // already has real content — not a fresh drop
      const attrs = comp.getAttributes()
      let style = {}
      try { style = JSON.parse(attrs['data-style-json'] || '{}') } catch { /* keep {} */ }
      refreshComponentContent(comp, attrs['data-el-type'], style)
    })
  }, [updateSelectedFromEditor, refreshComponentContent])

  // ── Step 3: once BOTH GrapesJS and the real content are ready, inject
  // the real CSS (fonts + design-specific rules) into the canvas iframe's
  // own <head>, then build the component tree with real content. ─────
  useEffect(() => {
    if (editor && design && realContent && !loadedRef.current) {
      loadedRef.current = true

      const canvasDoc = editor.Canvas.getDocument()
      if (canvasDoc) {
        const styleEl = canvasDoc.createElement('style')
        styleEl.textContent = realContent.cssText
        canvasDoc.head.appendChild(styleEl)
      }

      const tree = buildComponentTreeFromDesignData(design.design_data, realContent)
      editor.setComponents(tree)
      // Belt-and-suspenders: the zone2 container's own 'add' listener
      // should already do this as the initial tree is constructed, but an
      // explicit call after load costs nothing and doesn't depend on
      // event-ordering assumptions holding across GrapesJS versions.
      refreshTotalsRemovability(editor.getWrapper().find(`#${ZONE2_CONTAINER_ID}`)[0])
      editor.UndoManager.clear()
      setCanUndo(false)
      setCanRedo(false)
    }
  }, [editor, design, realContent])

  useEffect(() => {
    if (editor && blocksPanelRef.current) {
      const panelEl = editor.BlockManager.render(undefined, { external: true })
      blocksPanelRef.current.innerHTML = ''
      blocksPanelRef.current.appendChild(panelEl)
    }
  }, [editor])

  function handleChangeStyle(newStyle) {
    if (!editor) return
    const comp = editor.getSelected()
    if (!comp) return
    comp.addAttributes({ 'data-style-json': JSON.stringify(newStyle) })
    updateSelectedFromEditor(editor)

    // Debounced real-content refresh — a color-picker drag or fast
    // typing in a text field fires this many times a second; only the
    // LAST value in a burst is worth a real backend round trip.
    const elType = comp.getAttributes()['data-el-type']
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
    refreshTimerRef.current = setTimeout(() => {
      refreshComponentContent(comp, elType, newStyle)
    }, CONTENT_REFRESH_DEBOUNCE_MS)
  }

  function handleChangeSpacing(mm) {
    if (!editor) return
    const comp = editor.getSelected()
    if (!comp) return
    comp.addStyle({ 'margin-top': `${Math.round(mm * MM_TO_PX)}px` })
    updateSelectedFromEditor(editor)
  }

  function handleTogglePaired(paired) {
    if (!editor) return
    const comp = editor.getSelected()
    if (!comp) return
    comp.addAttributes({ 'data-paired': paired ? 'true' : 'false' })
    updateSelectedFromEditor(editor)
  }

  function handleSampleRowsChange(n) {
    setSampleRows(n)
    if (!editor) return
    const table = editor.getWrapper().find(`#${TABLE_COMPONENT_ID}`)[0]
    if (table) table.addAttributes({ 'data-sample-rows': String(n) })
  }

  function handleTogglePreview() {
    if (!editor) return
    if (previewing) editor.stopCommand('preview')
    else editor.runCommand('preview')
    setPreviewing((v) => !v)
  }

  async function handleSave() {
    if (!editor || !design) return
    setSaving(true)
    setErrors([])
    const design_data = extractDesignDataFromEditor(editor)
    const payload = {
      name: design.name || 'Untitled design',
      base_template: design.base_template,
      color_variant: design.color_variant || '',
      design_data,
    }
    try {
      if (design.id) {
        const { data } = await api.put(`/invoices/designs/${design.id}/`, payload)
        setDesign(data)
      } else {
        const { data } = await api.post('/invoices/designs/', payload)
        setDesign(data)
        navigate(`/invoices/designs/${data.id}/edit`, { replace: true })
      }
    } catch (err) {
      // Surfaces design_schema.py's real, specific per-violation messages
      // directly (via InvoiceDesignSerializer.validate_design_data) —
      // deliberately not swallowed into a generic "invalid design" string.
      // If this list is ever non-empty, it also means the canvas UI itself
      // let through a state the backend rejects — worth investigating, not
      // just displaying and moving on (see this file's own summary notes).
      const data = err.response?.data
      if (Array.isArray(data?.design_data)) setErrors(data.design_data)
      else if (data?.name) setErrors(Array.isArray(data.name) ? data.name : [data.name])
      else setErrors(['Could not save this design. Please try again.'])
    } finally {
      setSaving(false)
    }
  }

  if (loading || !design) {
    return (
      <div style={{
        position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--bg-page)', color: 'var(--text-secondary)',
      }}>
        Loading design…
      </div>
    )
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9000, display: 'flex', flexDirection: 'column', background: 'var(--bg-page)' }}>
      <EditorTopBar
        name={design.name}
        onNameChange={(name) => setDesign((d) => ({ ...d, name }))}
        onBack={() => navigate('/invoices/designs')}
        onUndo={() => editor?.UndoManager.undo()}
        onRedo={() => editor?.UndoManager.redo()}
        canUndo={canUndo}
        canRedo={canRedo}
        sampleRows={sampleRows}
        onSampleRowsChange={handleSampleRowsChange}
        previewing={previewing}
        onTogglePreview={handleTogglePreview}
        onSave={handleSave}
        saving={saving}
      />

      {contentError && (
        <div style={{ padding: '10px 16px 0' }}>
          <FosAlert type="error" onDismiss={() => setContentError(false)}>
            Could not load the real preview for this design — the canvas below is showing its last known
            state. Reload the page to try again before making further changes.
          </FosAlert>
        </div>
      )}

      {errors.length > 0 && (
        <div style={{ padding: '10px 16px 0' }}>
          <FosAlert type="error" onDismiss={() => setErrors([])}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>This design can't be saved yet:</div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {errors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          </FosAlert>
        </div>
      )}

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
        {!previewing && (
          <div style={{ width: 230, flexShrink: 0, borderRight: '1px solid var(--border-default)', overflowY: 'auto', background: 'var(--bg-surface)' }}>
            <div style={{ padding: '12px 14px 4px', fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>
              Drag onto canvas
            </div>
            <div ref={blocksPanelRef} />
          </div>
        )}

        <div style={{ flex: 1, overflow: 'auto', background: '#d8d8e0', display: 'flex', justifyContent: 'center', padding: 24, minWidth: 0 }}>
          <div style={{ background: '#fff', boxShadow: '0 4px 24px rgba(0,0,0,0.18)', width: Math.round(PAGE_WIDTH_MM * MM_TO_PX) }}>
            <GjsEditor
              grapesjs={grapesjs}
              options={{ height: '1400px', width: `${Math.round(PAGE_WIDTH_MM * MM_TO_PX)}px`, storageManager: false }}
              onEditor={onEditorInit}
            >
              <Canvas />
            </GjsEditor>
          </div>
        </div>

        {!previewing && (
          <div style={{ width: 280, flexShrink: 0, borderLeft: '1px solid var(--border-default)', overflowY: 'auto', background: 'var(--bg-surface)' }}>
            <ElementSettingsPanel
              selected={selected}
              onChangeStyle={handleChangeStyle}
              onChangeSpacing={handleChangeSpacing}
              onTogglePaired={handleTogglePaired}
            />
          </div>
        )}
      </div>
    </div>
  )
}
