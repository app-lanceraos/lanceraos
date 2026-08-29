// src/pages/design-editor/StylePanel.jsx
//
// Template Builder 2.0, Phase 4B — the real style/property panel,
// replacing DesignEditor.jsx's previous 100%-read-only "Selection"
// block. Every meaningful design object gets controls appropriate to its
// own kind/type (a capability table below, not "every property on every
// object" — a QR code has no font, the table has no font/color at all).
// Phase 4B.2: every element (flow and the table included) now has real
// x/y/width/height, shown uniformly and edited via the shared resize
// handles every element type carries — see capabilitiesFor's own comment
// for why a separate text-width control was removed rather than kept.
//
// Every change writes into the element's OWN `overrides` (never `style`)
// — design_renderer.resolve_style_value's existing overrides-wins-
// over-style precedence is what makes this meaningful; `style` stays
// exactly what the template/seed originally specified (the "initial
// template = starting state only" rule). Two effects fire per change:
//   1. `comp.addStyle({...})` — instant visual feedback, going through
//      the exact mechanism Phase 4A.1's `selectorManager.componentFirst`
//      fix protects (never a parallel styling path that could
//      reintroduce cross-component CSS corruption).
//   2. A debounced re-fetch of this ONE element's real content
//      (fetchElementContent, already-built-but-previously-unused
//      plumbing) — necessary because some style keys (pill_color,
//      resolved_label, per-field font sizes on inner children) are
//      applied by the Django template to specific inner nodes a
//      wrapper-level addStyle() alone can never reach. This mirrors
//      designEditor/DesignEditor.jsx's own proven `refreshComponentContent`
//      pattern (`comp.set('content', html)` + direct DOM innerHTML write)
//      exactly, not a newly-invented mechanism.
import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { fetchElementContent } from '@/lib/designEditor/canvasApi'

const FONT_OPTIONS = ['', 'IBM Plex Sans', 'IBM Plex Mono', 'Source Serif 4', 'Space Grotesk']
const COLOR_OPTIONS = [
  { value: '', label: 'Default' },
  { value: 'theme_primary', label: 'Theme primary' },
  { value: 'theme_secondary', label: 'Theme secondary' },
  { value: 'custom', label: 'Custom…' },
]

const TABLE_COLUMNS = [
  { key: 'description', label: 'Description' },
  { key: 'quantity', label: 'Qty' },
  { key: 'unit_price', label: 'Rate' },
  { key: 'total', label: 'Amount' },
]

// Which controls apply to which selected element. Deliberately NOT "every
// property on every object" (Part 9's own requirement) — a decomposed
// generic text field gets real typography controls; other semantic
// elements get only what their own renderer functions actually support
// (align, plus a couple of type-specific extras below).
//
// Phase 4B.2: `width` is REMOVED from every capability set below — see
// design_renderer.prepare_element, which builds an element's CSS
// `width` exclusively from its own real `element['width']` geometry field
// (never from `style.width`/`overrides.width`), confirmed directly (no
// call anywhere resolves a `width` style key for CSS sizing purposes).
// Before this phase, flow-zone elements had no geometry of their own at
// all, so `style.width` genuinely WAS how their box size was set — this
// text control existed specifically for that case, gated by
// `!selected.resizable` to hide it for header elements (which already had
// real geometry and real resize handles). Now every element (flow and the
// table included) has real x/y/width/height and the same shared resize
// handles header elements always had — a second, separate text-width
// control would silently write a CSS `width` value the renderer never
// reads, while conflicting with the resize handles' own real geometry
// write to the same DOM `style.width` property. Sizing is fully covered
// by drag-resize now, uniformly, for every type.
//
// The table is a real, positioned/resizable element too (see
// design_schema.py's own docstring) — its own capability set is
// deliberately narrow: position/size come from the shared resize handles
// every element already has, plus a `columns` toggle for which real
// InvoiceItem fields show; no font/color controls, since it's a
// structural container rendering real invoice data, not free-form text.
function capabilitiesFor(kind, type) {
  if (kind === 'structural' && type === 'table') return ['columns']
  if (kind === 'generic' && type === 'text') {
    return ['font', 'fontSize', 'fontWeight', 'color', 'backgroundColor', 'opacity', 'align', 'text']
  }
  if (kind === 'generic' && type === 'image') return ['opacity']
  if (type === 'logo') return ['borderRadius', 'opacity']
  if (type === 'signature') return ['label', 'align']
  if (type === 'qr_code') return ['align']
  if (type === 'online_payment_link') return ['label', 'align']
  if (type === 'payment_info') return ['label', 'align']
  if (type === 'totals') return ['align', 'pillColor']
  if (type === 'notes') return ['notesLabel', 'termsLabel']
  return ['align']
}

function readOverrides(comp) {
  try { return JSON.parse(comp.getAttributes()['data-overrides-json'] || '{}') } catch { return {} }
}

function readStyle(comp) {
  try { return JSON.parse(comp.getAttributes()['data-style-json'] || '{}') } catch { return {} }
}

export default function StylePanel({ editor, selected, baseTemplate, colorVariant, contentMode, onChange, onMeasureOverflow, designPrimaryColor, designSecondaryColor, onDuplicate }) {
  const [overrides, setOverrides] = useState({})
  const refreshTimer = useRef(null)

  const comp = editor && editor.getSelected ? editor.getSelected() : null
  const kind = selected?.kind
  const type = selected?.type
  const capabilities = useMemo(() => capabilitiesFor(kind, type), [kind, type])

  useEffect(() => {
    if (comp) setOverrides(readOverrides(comp))
    else setOverrides({})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.index, selected?.type])

  if (!selected || !comp) {
    return (
      <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', marginBottom: 12 }}>
        Nothing selected — click an element on the canvas.
      </div>
    )
  }

  const style = readStyle(comp)
  const effective = (key, fallback) => (key in overrides ? overrides[key] : (style[key] ?? fallback))

  function commit(patch, cssPatch) {
    const nextOverrides = { ...overrides, ...patch }
    setOverrides(nextOverrides)
    comp.addAttributes({ 'data-overrides-json': JSON.stringify(nextOverrides) })
    if (cssPatch) comp.addStyle(cssPatch)

    if (refreshTimer.current) clearTimeout(refreshTimer.current)
    refreshTimer.current = setTimeout(async () => {
      try {
        // Phase 4B.3 real bug fix (PHASE4B2_AUDIT.md finding C1): pass the
        // element's own real `binding` through — without it, the backend
        // had no way to resolve a bound field's alias label, and this
        // debounced refresh silently overwrote the canvas with blank
        // content on every style edit. `selected.binding` is only ever
        // set for a real, currently-bound generic text element (see
        // DesignEditor.jsx's own readSelection); every other element
        // type/an unbound text element correctly passes null, unchanged
        // from before.
        const html = await fetchElementContent(kind, type, style, nextOverrides, baseTemplate, colorVariant, contentMode, selected.binding)
        comp.set('content', html)
        const domEl = comp.getEl && comp.getEl()
        if (domEl) domEl.innerHTML = html
        // Phase 5.5b — re-measure overflow against the REAL, settled DOM
        // content (not whatever was on screen before this refresh landed),
        // directly on THIS specific `comp` closure reference rather than
        // "whatever is currently selected" — necessary because the user
        // may have already selected a different element while this
        // debounce was still pending (edge case: selection changes during/
        // around the debounce period). onMeasureOverflow applies/clears the
        // DOM indicator on the correct element unconditionally; onChange
        // additionally refreshes the Style Panel's own displayed warning,
        // which only matters if `comp` is still the current selection.
        onMeasureOverflow?.(comp)
        onChange?.()
      } catch {
        // Non-fatal — the canvas keeps showing whatever content it already had.
      }
    }, 300)
    onChange?.()
  }

  function handleDelete() {
    if (!comp.get('removable')) return
    if (type === 'totals') {
      const siblingTotals = editor.getWrapper().find('[data-el-type="totals"]')
      if (siblingTotals.length <= 1) {
        // eslint-disable-next-line no-alert
        window.alert('At least one Totals element must remain on the invoice.')
        return
      }
    }
    comp.remove()
    onChange?.()
  }

  const colorValue = (key) => {
    const v = effective(key, '')
    if (v === 'theme_primary' || v === 'theme_secondary' || v === '') return v
    return 'custom'
  }

  return (
    <div data-testid="v2-style-panel" style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginBottom: 12 }}>
      <div style={{ padding: 8, background: 'var(--accent-glow)', borderRadius: 6, marginBottom: 8 }}>
        <div><strong>{selected.type}</strong> ({selected.kind}, index {selected.index})</div>
        {/* Phase 4B.2: every real element type has real x/y/width/height
            now (see design_schema.py's own docstring) — no more
            resizable-vs-spacing-only distinction to branch on here. */}
        <div>x={selected.geometry.x.toFixed(1)}mm y={selected.geometry.y.toFixed(1)}mm w={selected.geometry.width.toFixed(1)}mm h={selected.geometry.height.toFixed(1)}mm</div>
        {/* Phase 5.5b — design-time-only, non-blocking overflow signal.
            selected.overflow comes from DesignEditor.jsx's own
            measureAndMarkOverflow (the ONE overflow-measurement
            implementation, also responsible for the DOM's own
            data-v2-overflow attribute/outline) — never a second,
            independently-computed value. N is the larger of the two
            excess dimensions actually measured, never a separate estimate. */}
        {selected.overflow?.isOverflowing && (
          <div
            data-testid="v2-overflow-warning"
            style={{ marginTop: 6, display: 'flex', alignItems: 'flex-start', gap: 4, color: '#b45309', fontWeight: 600 }}
          >
            <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>
              Content exceeds this box by {Math.max(0, Math.round(Math.max(selected.overflow.excessWidth, selected.overflow.excessHeight)))}px — may overlap other elements when rendered.
            </span>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {capabilities.includes('text') && (
          <label>Static text
            <input
              type="text"
              data-testid="v2-style-text"
              disabled={!!selected.binding}
              value={selected.binding ? `(bound: ${selected.binding})` : effective('text', '')}
              onChange={(e) => commit({ text: e.target.value })}
              style={{ width: '100%' }}
            />
          </label>
        )}

        {(capabilities.includes('label') || capabilities.includes('notesLabel')) && capabilities.includes('notesLabel') && (
          <>
            <label>Notes label
              <input type="text" value={effective('notes_label', 'Notes')} onChange={(e) => commit({ notes_label: e.target.value })} style={{ width: '100%' }} />
            </label>
            <label>Terms label
              <input type="text" value={effective('terms_label', 'Terms')} onChange={(e) => commit({ terms_label: e.target.value })} style={{ width: '100%' }} />
            </label>
          </>
        )}

        {capabilities.includes('label') && !capabilities.includes('notesLabel') && (
          <label>Label
            <input type="text" value={effective('label', '')} onChange={(e) => commit({ label: e.target.value })} style={{ width: '100%' }} />
          </label>
        )}

        {capabilities.includes('font') && (
          <label>Font
            <select data-testid="v2-style-font" value={effective('font', '')} onChange={(e) => commit({ font: e.target.value }, e.target.value ? { 'font-family': `'${e.target.value}'` } : { 'font-family': '' })} style={{ width: '100%' }}>
              {FONT_OPTIONS.map((f) => <option key={f} value={f}>{f || 'Default'}</option>)}
            </select>
          </label>
        )}

        {capabilities.includes('fontSize') && (
          <label>Font size (pt)
            <input
              type="number" min="4" max="72" data-testid="v2-style-font-size"
              value={effective('font_size_pt', '')}
              onChange={(e) => {
                const v = e.target.value ? Number(e.target.value) : ''
                commit({ font_size_pt: v }, { 'font-size': v ? `${v}pt` : '' })
              }}
              style={{ width: '100%' }}
            />
          </label>
        )}

        {capabilities.includes('fontWeight') && (
          <label>Font weight
            <select
              value={effective('font_weight', '')}
              onChange={(e) => {
                const v = e.target.value
                commit({ font_weight: v ? Number(v) : '' }, { 'font-weight': v || '' })
              }}
              style={{ width: '100%' }}
            >
              <option value="">Default</option>
              <option value="400">Regular (400)</option>
              <option value="600">Semibold (600)</option>
              <option value="700">Bold (700)</option>
            </select>
          </label>
        )}

        {capabilities.includes('color') && (
          <label>Text color
            <select
              data-testid="v2-style-color"
              value={colorValue('color')}
              onChange={(e) => {
                const v = e.target.value
                if (v === 'custom') return
                commit({ color: v }, { color: v === 'theme_primary' || v === 'theme_secondary' ? undefined : v })
              }}
              style={{ width: '100%' }}
            >
              {COLOR_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
            {colorValue('color') === 'custom' && (
              <input
                type="color"
                value={/^#/.test(effective('color', '')) ? effective('color', '#000000') : '#000000'}
                onChange={(e) => commit({ color: e.target.value }, { color: e.target.value })}
                style={{ width: '100%' }}
              />
            )}
          </label>
        )}

        {capabilities.includes('backgroundColor') && (
          <label>Background color
            <input
              type="color"
              value={/^#/.test(effective('background_color', '')) ? effective('background_color', '#ffffff') : '#ffffff'}
              onChange={(e) => commit({ background_color: e.target.value }, { 'background-color': e.target.value })}
              style={{ width: '100%' }}
            />
            <button type="button" className="fos-btn fos-btn-ghost" style={{ marginTop: 4 }} onClick={() => commit({ background_color: '' }, { 'background-color': '' })}>
              Clear
            </button>
          </label>
        )}

        {capabilities.includes('pillColor') && (
          <label>Pill color
            <input
              type="color"
              // Phase 6 (style/theme cascade): the effective value can now
              // genuinely be the 'theme_primary'/'theme_secondary'
              // sentinel (design_templates.py's own real seeds use these —
              // see that file's own comments) — this control has no
              // Default/Theme-primary/Theme-secondary dropdown of its own
              // (unlike the `color` control above), so its swatch must at
              // least DISPLAY the real, currently-resolved theme color
              // rather than a hardcoded, template-agnostic literal.
              // designPrimaryColor/designSecondaryColor come straight from
              // the canvas document's own already-resolved values
              // (DesignEditor.jsx's canvasDoc) — never re-derived here,
              // consistent with "color resolution stays server-side."
              value={(() => {
                const raw = effective('pill_color', '')
                if (raw === 'theme_primary') return designPrimaryColor || '#a8813c'
                if (raw === 'theme_secondary') return designSecondaryColor || '#a8813c'
                return /^#/.test(raw) ? raw : '#a8813c'
              })()}
              onChange={(e) => commit({ pill_color: e.target.value })}
              style={{ width: '100%' }}
            />
          </label>
        )}

        {capabilities.includes('borderRadius') && (
          <label>Corner radius (mm)
            <input
              type="number" min="0" max="50"
              value={effective('border_radius_mm', '')}
              onChange={(e) => commit({ border_radius_mm: e.target.value ? Number(e.target.value) : '' })}
              style={{ width: '100%' }}
            />
          </label>
        )}

        {capabilities.includes('opacity') && (
          <label>Opacity
            <input
              type="range" min="0" max="1" step="0.05"
              value={effective('opacity', 1)}
              onChange={(e) => commit({ opacity: Number(e.target.value) }, { opacity: e.target.value })}
              style={{ width: '100%' }}
            />
          </label>
        )}

        {capabilities.includes('align') && (
          <label>Alignment
            <select
              value={effective('align', 'left')}
              onChange={(e) => commit({ align: e.target.value }, { 'text-align': e.target.value })}
              style={{ width: '100%' }}
            >
              <option value="left">Left</option>
              <option value="right">Right</option>
              <option value="center">Center</option>
            </select>
          </label>
        )}

        {capabilities.includes('columns') && (
          <div>
            <div style={{ marginBottom: 4 }}>Columns</div>
            {TABLE_COLUMNS.map((col) => {
              const current = effective('columns', TABLE_COLUMNS.map((c) => c.key))
              const checked = current.includes(col.key)
              return (
                <label key={col.key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => {
                      const next = e.target.checked
                        ? [...current, col.key]
                        : current.filter((k) => k !== col.key)
                      // Real, always-real content refresh (fetchElementContent
                      // resolves table_columns/thead_cell_css/row_cell_css
                      // server-side, the exact same computation the canonical
                      // renderer uses) — no cssPatch here since a column
                      // toggle changes rendered markup, not a wrapper style.
                      commit({ columns: next })
                    }}
                  />
                  {col.label}
                </label>
              )
            })}
          </div>
        )}
      </div>

      {/* Master Blueprint cutover — Duplicate. Same removable-guard as
          Delete (the mandatory table can't be duplicated either — a
          second one would immediately fail the "exactly one table"
          schema check on save). Actual duplication logic lives in
          DesignEditor.jsx (onDuplicate) so index assignment stays in
          the one place that already computes it for "Add element". */}
      <button
        type="button"
        className="fos-btn fos-btn-ghost"
        data-testid="v2-style-duplicate"
        disabled={!comp.get('removable')}
        onClick={onDuplicate}
        style={{ marginTop: 12, width: '100%' }}
      >
        Duplicate this element
      </button>
      <button
        type="button"
        className="fos-btn fos-btn-ghost"
        data-testid="v2-style-delete"
        disabled={!comp.get('removable')}
        onClick={handleDelete}
        style={{ marginTop: 8, color: 'var(--error)', width: '100%' }}
      >
        Delete this element
      </button>
    </div>
  )
}
