// src/pages/DesignGallery.jsx
//
// Post-Reversion Polish (12 September 2026) — the per-user InvoiceDesign
// row-per-template model is gone (see DECISIONS.md's removal entry): a
// saved design carried nothing but a name and which of the 3 static
// templates it was, so clicking "Use this template" repeatedly just
// duplicated identical rows. This page is now a single preference
// picker — "Use this template" is a direct PUT to
// FreelancerProfile.invoice_template (GET/PUT /api/auth/profile/, the
// same general-purpose partial-update endpoint every other Settings
// section already uses), never a new row. No Edit action, no Blank
// action, no AI-seed upload, no theme/color picker — a template is used
// exactly as it's provided.
import { useEffect, useState } from 'react'
import { LayoutTemplate, Star } from 'lucide-react'

import api from '@/lib/api'
import useTitle from '@/hooks/useTitle'
import FosAlert from '@/components/FosAlert'

// Real, friendly labels for the 3 static templates — a small, static,
// never-drifting lookup; the preview images below are the real thing,
// this is presentation-only.
const BASE_TEMPLATES = [
  { key: 'professional', label: 'Professional' },
  { key: 'minimal', label: 'Minimal' },
  { key: 'modern', label: 'Modern' },
]
const BASE_TEMPLATE_LABELS = Object.fromEntries(BASE_TEMPLATES.map((t) => [t.key, t.label]))

// One-time, pre-generated real renders of each template with realistic
// sample data (see apps/invoices/management/commands/
// generate_template_previews.py) — never rendered live. Plain static
// assets served from frontend/public/, no backend round-trip needed.
function previewSrc(baseTemplate) {
  return `/design-previews/${baseTemplate}.png`
}

function TemplateCard({ baseTemplate, label, isActive, onUse, busy }) {
  return (
    <div style={{
      background: 'var(--bg-surface)', border: isActive ? '2px solid var(--accent)' : '1px solid var(--border-subtle)',
      borderRadius: 'var(--radius-lg)', padding: 16, position: 'relative',
    }}>
      {isActive && (
        <div style={{
          position: 'absolute', top: 12, right: 12, display: 'flex', alignItems: 'center', gap: 4,
          background: 'var(--accent)', color: 'var(--accent-contrast, #fff)', borderRadius: 999,
          padding: '3px 10px', fontSize: '0.7rem', fontWeight: 700,
        }}>
          <Star size={11} fill="currentColor" /> Active
        </div>
      )}
      <div style={{
        marginBottom: 12, border: '1px solid var(--border-default)', borderRadius: 6, overflow: 'hidden',
        background: '#fff', aspectRatio: '210 / 297',
      }}>
        <img
          src={previewSrc(baseTemplate)} alt={`${label} template preview`}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          loading="lazy"
        />
      </div>
      <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)', marginBottom: 12 }}>
        {label}
      </div>
      <button
        onClick={() => onUse(baseTemplate)}
        disabled={busy || isActive}
        className="fos-btn fos-btn-accent fos-btn-full"
      >
        {isActive ? 'Currently active' : busy ? 'Setting…' : 'Use this template'}
      </button>
    </div>
  )
}

export default function DesignGallery() {
  useTitle('Manage Designs — LanceraOS')

  const [activeTemplate, setActiveTemplate] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busyTemplate, setBusyTemplate] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api.get('/auth/profile/')
      .then(({ data }) => setActiveTemplate(data.invoice_template || 'professional'))
      .catch(() => setError('Could not load your current template preference.'))
      .finally(() => setLoading(false))
  }, [])

  async function handleUseTemplate(baseTemplate) {
    setBusyTemplate(baseTemplate)
    setError('')
    try {
      await api.put('/auth/profile/', { invoice_template: baseTemplate })
      setActiveTemplate(baseTemplate)
    } catch {
      setError('Could not switch templates. Please try again.')
    } finally {
      setBusyTemplate(null)
    }
  }

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
        <Star size={15} style={{ color: 'var(--accent)', flexShrink: 0 }} fill="var(--accent)" />
        <span>
          <strong style={{ color: 'var(--text-primary)' }}>Currently active for new invoices:</strong>{' '}
          {loading ? 'Loading…' : (BASE_TEMPLATE_LABELS[activeTemplate] || activeTemplate)}
        </span>
      </div>

      {error && <FosAlert type="error" onDismiss={() => setError('')} style={{ marginBottom: 16 }}>{error}</FosAlert>}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '8px 0 12px' }}>
        <LayoutTemplate size={16} style={{ color: 'var(--text-tertiary)' }} />
        <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          Templates
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
        {BASE_TEMPLATES.map(({ key, label }) => (
          <TemplateCard
            key={key}
            baseTemplate={key}
            label={label}
            isActive={activeTemplate === key}
            onUse={handleUseTemplate}
            busy={busyTemplate === key}
          />
        ))}
      </div>
    </div>
  )
}
