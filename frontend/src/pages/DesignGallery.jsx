// src/pages/DesignGallery.jsx
//
// Full Reversion Plan (back to 3 static templates only) — the free-canvas
// editor, its version history, AI-seeding, and per-design color variants
// are gone (see DECISIONS.md's removal entry). This page is back to its
// original, pre-editor shape: pick one of the 3 static templates, name
// it, and optionally mark it your default for new invoices. No Edit
// action, no Blank action, no AI-seed upload, no theme/color picker —
// a template is used exactly as it's provided.
import { useEffect, useState } from 'react'
import { Copy, FileText, LayoutTemplate, Star, Trash2 } from 'lucide-react'

import api from '@/lib/api'
import useTitle from '@/hooks/useTitle'
import FosAlert from '@/components/FosAlert'

// Real, friendly labels + accent color for the 3 static templates — a
// small, static, never-drifting lookup. The colors mirror
// pdf_generator.DEFAULT_TEMPLATE_COLORS exactly (each template's own
// single real accent) purely so this card's thumbnail reads as "that
// template" at a glance — never a customization control, just a label.
const BASE_TEMPLATES = [
  { key: 'professional', label: 'Professional', color: '#a8813c' },
  { key: 'minimal', label: 'Minimal', color: '#6b8570' },
  { key: 'modern', label: 'Modern', color: '#2d2a6e' },
]
const BASE_TEMPLATE_LABELS = Object.fromEntries(BASE_TEMPLATES.map((t) => [t.key, t.label]))

function TemplateThumbnail({ color }) {
  return (
    <div style={{
      width: '100%', maxWidth: 200, aspectRatio: '210 / 297', background: '#fff',
      border: '1px solid var(--border-default)', borderRadius: 6, overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ height: '18%', background: color, flexShrink: 0 }} />
      <div style={{ flex: 1, padding: '10%', display: 'flex', flexDirection: 'column', gap: '10%' }}>
        <div style={{ height: 6, width: '70%', background: 'var(--border-default)', borderRadius: 3 }} />
        <div style={{ height: 6, width: '90%', background: 'var(--border-subtle)', borderRadius: 3 }} />
        <div style={{ height: 6, width: '55%', background: 'var(--border-subtle)', borderRadius: 3 }} />
      </div>
    </div>
  )
}

function BuiltinTemplateCard({ baseTemplate, label, color, onUse, busy }) {
  return (
    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
        <TemplateThumbnail color={color} />
      </div>
      <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)', marginBottom: 12 }}>
        {label}
      </div>
      <button
        onClick={() => onUse(baseTemplate)}
        disabled={busy}
        className="fos-btn fos-btn-accent fos-btn-full"
      >
        {busy ? 'Adding…' : 'Use this template'}
      </button>
    </div>
  )
}

function SavedDesignCard({ design, baseTemplateLabels, onSetDefault, onDelete }) {
  return (
    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
      <FileText size={20} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--text-primary)' }}>{design.name}</span>
          {design.is_default && <Star size={13} style={{ color: 'var(--accent)' }} fill="var(--accent)" />}
        </div>
        <div style={{ fontSize: '0.74rem', color: 'var(--text-tertiary)' }}>
          {baseTemplateLabels[design.base_template] || design.base_template}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        {!design.is_default && (
          <button onClick={() => onSetDefault(design)} aria-label="Set as default" className="fos-btn fos-btn-ghost" style={{ padding: 8 }}>
            <Star size={14} />
          </button>
        )}
        <button onClick={() => onDelete(design)} aria-label="Delete design" className="fos-btn fos-btn-ghost" style={{ padding: 8, color: 'var(--status-red)' }}>
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  )
}

export default function DesignGallery() {
  useTitle('Manage Designs — LanceraOS')

  const [designs, setDesigns] = useState([])
  const [loading, setLoading] = useState(true)
  const [busyTemplate, setBusyTemplate] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api.get('/invoices/designs/')
      .then(({ data }) => setDesigns(data))
      .catch(() => setError('Could not load your saved designs.'))
      .finally(() => setLoading(false))
  }, [])

  // Merges a just-set-default design into state — the shared bookkeeping
  // handleSetDefault/handleUseTemplate both need after a real
  // POST /designs/{id}/set-default/ call.
  function applyDefaultInState(defaultedDesign) {
    setDesigns((prev) => prev.map((d) => (d.id === defaultedDesign.id ? defaultedDesign : { ...d, is_default: false })))
  }

  async function handleUseTemplate(baseTemplate) {
    setBusyTemplate(baseTemplate)
    setError('')
    try {
      const { data } = await api.post('/invoices/designs/duplicate/', { base_template: baseTemplate })
      setDesigns((prev) => [data, ...prev])
      // "Use this template" is a real call-to-action — it immediately
      // becomes the active design new invoices use, matching what the
      // button's own name promises.
      const { data: defaulted } = await api.post(`/invoices/designs/${data.id}/set-default/`)
      applyDefaultInState(defaulted)
    } catch {
      setError('Could not create a design from that template. Please try again.')
    } finally {
      setBusyTemplate(null)
    }
  }

  async function handleSetDefault(design) {
    try {
      const { data } = await api.post(`/invoices/designs/${design.id}/set-default/`)
      applyDefaultInState(data)
    } catch {
      setError('Could not set that design as default.')
    }
  }

  async function handleDelete(design) {
    if (!window.confirm(`Delete "${design.name}"? This can't be undone.`)) return
    try {
      await api.delete(`/invoices/designs/${design.id}/`)
      setDesigns((prev) => prev.filter((d) => d.id !== design.id))
    } catch {
      setError('Could not delete that design.')
    }
  }

  // Real, visible "which design is active" state — `is_default` is a
  // real, meaningful signal (apps.invoices.views.invoice_create/
  // _finalise_invoice both read it) rather than a write-only field
  // nothing ever consulted.
  const activeDesign = designs.find((d) => d.is_default)

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 800, color: 'var(--text-primary)' }}>Manage Designs</h1>
        <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: '0.88rem' }}>
          Pick which invoice template new invoices use.
        </p>
      </div>

      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, padding: '10px 14px',
        background: 'var(--bg-surface-2)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)',
        fontSize: '0.85rem', color: 'var(--text-secondary)',
      }}>
        <Star size={15} style={{ color: activeDesign ? 'var(--accent)' : 'var(--text-tertiary)', flexShrink: 0 }} fill={activeDesign ? 'var(--accent)' : 'none'} />
        {activeDesign ? (
          <span>
            <strong style={{ color: 'var(--text-primary)' }}>Currently active for new invoices:</strong>{' '}
            {activeDesign.name} ({BASE_TEMPLATE_LABELS[activeDesign.base_template] || activeDesign.base_template})
          </span>
        ) : (
          <span>
            <strong style={{ color: 'var(--text-primary)' }}>Currently active for new invoices:</strong>{' '}
            Professional (default) — no design has been set as your default yet.
          </span>
        )}
      </div>

      {error && <FosAlert type="error" onDismiss={() => setError('')} style={{ marginBottom: 16 }}>{error}</FosAlert>}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '8px 0 12px' }}>
        <LayoutTemplate size={16} style={{ color: 'var(--text-tertiary)' }} />
        <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          Templates
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 32 }}>
        {BASE_TEMPLATES.map(({ key, label, color }) => (
          <BuiltinTemplateCard
            key={key}
            baseTemplate={key}
            label={label}
            color={color}
            onUse={handleUseTemplate}
            busy={busyTemplate === key}
          />
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '8px 0 12px' }}>
        <Copy size={16} style={{ color: 'var(--text-tertiary)' }} />
        <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          Your designs
        </span>
      </div>
      {loading ? (
        <div style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem' }}>Loading…</div>
      ) : designs.length === 0 ? (
        <div style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem' }}>
          No saved designs yet — use a template above.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {designs.map((design) => (
            <SavedDesignCard
              key={design.id}
              design={design}
              baseTemplateLabels={BASE_TEMPLATE_LABELS}
              onSetDefault={handleSetDefault}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  )
}
