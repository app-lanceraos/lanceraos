// src/pages/design-editor/ElementSettingsPanel.jsx
//
// The "font/color/alignment when an element is selected, writing into that
// element's free-form style dict" panel the task asked for — deliberately
// a plain React form, not GrapesJS's own Trait Manager UI (which is a
// Backbone-view API; a custom React panel keeps this consistent with the
// rest of the app's inline-style/lucide-icon conventions and gives full
// control over the pairing-toggle restriction below). See DECISIONS.md.
import { PAIRABLE_ZONE_2_TYPES } from '../../lib/designEditor/constants'
import { pairingStatusMessage } from '../../lib/designEditor/rules'

const FONT_OPTIONS = ['IBM Plex Sans', 'IBM Plex Mono', 'Source Serif 4', 'Space Grotesk']
const ALIGN_OPTIONS = ['left', 'center', 'right']

const FIELD_DEFS = {
  logo: [
    { key: 'border_radius_mm', label: 'Border radius (mm)', kind: 'number' },
  ],
  business_info: [
    { key: 'label', label: 'Label (e.g. "From")', kind: 'text' },
    { key: 'align', label: 'Alignment', kind: 'select', options: ALIGN_OPTIONS },
    { key: 'font', label: 'Font', kind: 'select', options: FONT_OPTIONS },
    { key: 'font_size_pt', label: 'Font size (pt)', kind: 'number' },
    { key: 'color', label: 'Text color', kind: 'color' },
    { key: 'eyebrow', label: 'Eyebrow text', kind: 'text' },
    { key: 'show_tagline', label: 'Show tagline', kind: 'checkbox' },
  ],
  client_info: [
    { key: 'label', label: 'Label (e.g. "Bill to")', kind: 'text' },
    { key: 'align', label: 'Alignment', kind: 'select', options: ALIGN_OPTIONS },
  ],
  dates: [
    { key: 'align', label: 'Alignment', kind: 'select', options: ALIGN_OPTIONS },
    { key: 'font', label: 'Font', kind: 'select', options: FONT_OPTIONS },
    { key: 'show_invoice_number', label: 'Show invoice number', kind: 'checkbox' },
  ],
  totals: [
    { key: 'align', label: 'Alignment', kind: 'select', options: ALIGN_OPTIONS },
    { key: 'width', label: 'Width (mm)', kind: 'number' },
  ],
  notes: [
    { key: 'width', label: 'Width (mm)', kind: 'number' },
  ],
  signature: [
    { key: 'label', label: 'Label', kind: 'text' },
    { key: 'align', label: 'Alignment', kind: 'select', options: ALIGN_OPTIONS },
    { key: 'has_signature_image', label: 'Show signature image', kind: 'checkbox' },
  ],
  payment_info: [
    { key: 'label', label: 'Label', kind: 'text' },
    { key: 'width', label: 'Width (mm)', kind: 'number' },
    { key: 'variant', label: 'Variant', kind: 'select', options: ['bank_methods', 'qr_and_link'] },
  ],
}

// Available on every zone_1 element type (not schema-restricted to any
// one), and rendered distinctly in the canvas itself via componentTypes.js's
// view (the sidebar-region visual, not a second droppable region) —
// see DECISIONS.md for why a trait + visual guide rather than a second
// drop target was the pragmatic choice here.
const SIDEBAR_FIELD = { key: 'sidebar', label: 'Render in sidebar region', kind: 'checkbox' }

function FieldInput({ field, value, onChange }) {
  const common = {
    style: {
      width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border-default)',
      background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: '0.82rem',
    },
  }
  if (field.kind === 'checkbox') {
    return (
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.82rem', color: 'var(--text-secondary)', cursor: 'pointer' }}>
        <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
        {field.label}
      </label>
    )
  }
  if (field.kind === 'select') {
    return (
      <select {...common} value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {field.options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    )
  }
  if (field.kind === 'color') {
    return <input type="color" value={value || '#000000'} onChange={(e) => onChange(e.target.value)} style={{ width: '100%', height: 32, padding: 0, border: 'none', borderRadius: 6 }} />
  }
  if (field.kind === 'number') {
    return <input {...common} type="number" value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))} />
  }
  return <input {...common} type="text" value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
}

function Field({ field, style, onChangeStyle }) {
  return (
    <div style={{ marginBottom: 12 }}>
      {field.kind !== 'checkbox' && (
        <label style={{ display: 'block', fontSize: '0.76rem', fontWeight: 600, color: 'var(--text-tertiary)', marginBottom: 4 }}>
          {field.label}
        </label>
      )}
      <FieldInput
        field={field}
        value={style[field.key]}
        onChange={(v) => onChangeStyle({ ...style, [field.key]: v === undefined ? undefined : v })}
      />
    </div>
  )
}

/**
 * `selected` shape: { zone: 'zone1'|'zone2', elType, style, spacingMm, paired, pairCount } | null
 * `pairCount` (total elements in zone_2 currently marked paired) is passed
 * down so the panel can show the live "1/2, needs exactly 2" hint per the
 * task's own requirement to not just let the user attempt anything.
 */
export default function ElementSettingsPanel({ selected, onChangeStyle, onChangeSpacing, onTogglePaired }) {
  if (!selected) {
    return (
      <div style={{ padding: 20, color: 'var(--text-tertiary)', fontSize: '0.85rem' }}>
        Select an element on the canvas to edit its style.
      </div>
    )
  }

  if (selected.kind === 'table') {
    return (
      <div style={{ padding: 20, color: 'var(--text-tertiary)', fontSize: '0.85rem' }}>
        The line-items table is required and always sits at the start of Zone 2 — it can't be moved,
        resized, or removed.
      </div>
    )
  }

  const fields = FIELD_DEFS[selected.elType] || []
  const isZone1 = selected.kind === 'zone1'
  const isPairable = PAIRABLE_ZONE_2_TYPES.includes(selected.elType)

  return (
    <div style={{ padding: 16, overflowY: 'auto' }}>
      <div style={{ fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 12 }}>
        {selected.elType.replace('_', ' ')}
      </div>

      {fields.map((field) => (
        <Field key={field.key} field={field} style={selected.style} onChangeStyle={onChangeStyle} />
      ))}

      {isZone1 && <Field field={SIDEBAR_FIELD} style={selected.style} onChangeStyle={onChangeStyle} />}

      {!isZone1 && (
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', fontSize: '0.76rem', fontWeight: 600, color: 'var(--text-tertiary)', marginBottom: 4 }}>
            Spacing above (mm)
          </label>
          <input
            type="number" min={0} value={selected.spacingMm ?? 0}
            onChange={(e) => onChangeSpacing(Number(e.target.value))}
            style={{
              width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border-default)',
              background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: '0.82rem',
            }}
          />
        </div>
      )}

      {isPairable && (
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border-subtle)' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.82rem', color: 'var(--text-secondary)', cursor: 'pointer' }}>
            <input type="checkbox" checked={!!selected.paired} onChange={(e) => onTogglePaired(e.target.checked)} />
            Pair side-by-side with another element
          </label>
          <p style={{ fontSize: '0.74rem', color: 'var(--text-tertiary)', marginTop: 6 }}>
            Only Signature and Payment Info can be paired — {pairingStatusMessage(selected.pairCount)}
          </p>
        </div>
      )}
    </div>
  )
}
