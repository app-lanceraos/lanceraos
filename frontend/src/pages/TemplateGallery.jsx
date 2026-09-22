// src/pages/TemplateGallery.jsx
//
// Renamed from DesignGallery.jsx (Template Gallery Foundation, 13
// September 2026) — "Design" was residue from the free-canvas era, when a
// design was a user-owned editable artifact; it's now a template you
// pick, so the page (and its route, /invoices/templates) is named for
// what it actually does. Still a single preference picker — "Use this
// template" is a direct PUT to FreelancerProfile.invoice_template
// (GET/PUT /api/auth/profile/, the same general-purpose partial-update
// endpoint every other Settings section already uses), never a new row.
// No Edit action, no Blank action, no AI-seed upload, no theme/color
// picker — a template is used exactly as it's provided.
//
// The template list itself is no longer hardcoded here — it's fetched
// from GET /api/invoices/templates/ (apps.invoices.template_manifest,
// the one authoritative backend source; see that module's own docstring
// for why a second hardcoded frontend copy would just be one more place
// to edit for each of the 20 templates a later pass imports).
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, LayoutTemplate, Star } from 'lucide-react'

import api from '@/lib/api'
import useTitle from '@/hooks/useTitle'
import FosAlert from '@/components/FosAlert'

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

export default function TemplateGallery() {
  useTitle('LanceraOS | Template Gallery')

  const [templates, setTemplates] = useState([])
  const [activeTemplate, setActiveTemplate] = useState(null)
  const [brandingEnabled, setBrandingEnabled] = useState(true)
  const [loading, setLoading] = useState(true)
  const [busyTemplate, setBusyTemplate] = useState(null)
  const [brandingSaving, setBrandingSaving] = useState(false)
  const [error, setError] = useState('')
  const [brandingError, setBrandingError] = useState('')

  useEffect(() => {
    Promise.all([
      api.get('/invoices/templates/'),
      api.get('/auth/profile/'),
    ])
      .then(([templatesRes, profileRes]) => {
        setTemplates(templatesRes.data.templates || [])
        setActiveTemplate(profileRes.data.invoice_template || 'professional')
        setBrandingEnabled(profileRes.data.show_lanceraos_branding !== false)
      })
      .catch(() => setError('Could not load your template settings.'))
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

  // STANDARDS.md's save convention: no optimistic UI — the toggle only
  // reflects a server-confirmed value, and a failed write surfaces a
  // real error rather than silently reverting the switch to where it
  // was (there's nothing to "revert" since it was never flipped in the
  // UI until the PUT actually succeeds).
  async function handleToggleBranding() {
    setBrandingSaving(true)
    setBrandingError('')
    const next = !brandingEnabled
    try {
      const { data } = await api.put('/auth/profile/', { show_lanceraos_branding: next })
      setBrandingEnabled(data.show_lanceraos_branding !== false)
    } catch {
      setBrandingError('Could not update this setting. Please try again.')
    } finally {
      setBrandingSaving(false)
    }
  }

  const activeLabel = templates.find((t) => t.key === activeTemplate)?.label || activeTemplate

  return (
    <div>
      {/* Footer Refinement pass (15 September 2026) — a real path back to
          Invoices; there was none before. Kept minimal (plain text + a
          link) since no breadcrumb pattern existed anywhere else in the
          app to match — this is the first one, not a heavyweight new
          shared component for a single call site. */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 4, marginBottom: 10,
        fontSize: '0.8rem', color: 'var(--text-tertiary)',
      }}>
        <Link to="/invoices" style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}>Invoices</Link>
        <ChevronRight size={13} />
        <span>Template Gallery</span>
      </div>

      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, padding: '10px 14px',
        background: 'var(--bg-surface-2)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)',
        fontSize: '0.85rem', color: 'var(--text-secondary)',
      }}>
        <Star size={15} style={{ color: 'var(--accent)', flexShrink: 0 }} fill="var(--accent)" />
        <span>
          <strong style={{ color: 'var(--text-primary)' }}>Currently active for new invoices:</strong>{' '}
          {loading ? 'Loading…' : (activeLabel || activeTemplate)}
        </span>
      </div>

      {error && <FosAlert type="error" onDismiss={() => setError('')} style={{ marginBottom: 16 }}>{error}</FosAlert>}
      {brandingError && <FosAlert type="error" onDismiss={() => setBrandingError('')} style={{ marginBottom: 12 }}>{brandingError}</FosAlert>}

      {/* Template Gallery Polish Pass (14 September 2026) — moved above
          the grid (was a full-width card below it) and shrunk to a
          compact one-line inline row per Ali's real, direct feedback on
          the Foundation pass's UI. Behavior unchanged: reads/writes
          show_lanceraos_branding via the same /auth/profile/ PUT, no
          optimistic flip, a real inline error on failure. */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        marginBottom: 20, padding: '8px 14px',
        background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)',
        fontSize: '0.82rem',
      }}>
        <span style={{ color: 'var(--text-secondary)' }}>
          <strong style={{ color: 'var(--text-primary)', fontWeight: 700 }}>Show &quot;Generated by LanceraOS&quot;</strong>
          {' '} appears in the invoice footer
        </span>
        <button
          role="switch"
          aria-checked={brandingEnabled}
          aria-label="Show Generated by LanceraOS on invoices"
          onClick={handleToggleBranding}
          disabled={loading || brandingSaving}
          className="fos-btn fos-btn-ghost"
          style={{ flexShrink: 0, padding: '4px 12px', fontSize: '0.8rem' }}
        >
          {brandingSaving ? 'Saving…' : brandingEnabled ? 'On' : 'Off'}
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '8px 0 12px' }}>
        <LayoutTemplate size={16} style={{ color: 'var(--text-tertiary)' }} />
        <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          Templates
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
        {templates.map(({ key, label }) => (
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
