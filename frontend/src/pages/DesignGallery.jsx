// src/pages/DesignGallery.jsx
//
// Step 8b's Path 1 (ready-made templates) + Path 2 (custom editor) entry
// point — "Manage Designs", wired from Invoices.jsx's header (see that
// file's own comment on why there's no natural per-invoice design picker
// yet). Stays inside the normal AppShell frame — unlike DesignEditor.jsx's
// canvas, a gallery/list page is exactly what AppShell's standard layout
// already handles well, per DESIGN.md Section 5; no reason to break that
// precedent here the way the canvas itself needed to.
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Copy, LayoutTemplate, Plus, Sparkles, Star, Trash2 } from 'lucide-react'

import api from '@/lib/api'
import useTitle from '@/hooks/useTitle'
import useAuthStore from '@/store/authStore'
import FosAlert from '@/components/FosAlert'
import DesignCanvasPreview from '@/components/design-editor/DesignCanvasPreview'
import { BASE_TEMPLATE_LABELS, BUILTIN_DESIGN_DATA, COLOR_VARIANTS } from '@/lib/designEditor/builtinDesigns'
import { BLANK_DESIGN_DATA } from '@/lib/designEditor/constants'

function BuiltinTemplateCard({ baseTemplate, logoUrl, onUse, busy }) {
  const [variant, setVariant] = useState(COLOR_VARIANTS[baseTemplate][0].key)

  return (
    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
        <DesignCanvasPreview designData={BUILTIN_DESIGN_DATA[baseTemplate]} logoUrl={logoUrl} />
      </div>
      <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)', marginBottom: 8 }}>
        {BASE_TEMPLATE_LABELS[baseTemplate]}
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {COLOR_VARIANTS[baseTemplate].map((v) => (
          <button
            key={v.key}
            onClick={() => setVariant(v.key)}
            aria-label={v.label}
            title={v.label}
            style={{
              width: 22, height: 22, borderRadius: '50%', cursor: 'pointer',
              border: variant === v.key ? '2px solid var(--accent)' : '2px solid transparent',
              background: `linear-gradient(135deg, ${v.primary} 50%, ${v.secondary} 50%)`,
            }}
          />
        ))}
      </div>
      <button
        onClick={() => onUse(baseTemplate, variant)}
        disabled={busy}
        className="fos-btn fos-btn-accent fos-btn-full"
      >
        Use this template
      </button>
    </div>
  )
}

function SavedDesignCard({ design, onEdit, onSetDefault, onDelete, logoUrl }) {
  return (
    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
        <DesignCanvasPreview designData={design.design_data} logoUrl={logoUrl} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <span style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--text-primary)' }}>{design.name}</span>
        {design.is_default && <Star size={13} style={{ color: 'var(--accent)' }} fill="var(--accent)" />}
      </div>
      <div style={{ fontSize: '0.74rem', color: 'var(--text-tertiary)', marginBottom: 12 }}>
        Based on {BASE_TEMPLATE_LABELS[design.base_template] || design.base_template} · {design.source}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={() => onEdit(design)} className="fos-btn fos-btn-ghost" style={{ flex: 1 }}>Edit</button>
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
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const logoUrl = user?.profile_logo || null

  const [designs, setDesigns] = useState([])
  const [loading, setLoading] = useState(true)
  const [busyTemplate, setBusyTemplate] = useState(null)
  const [error, setError] = useState('')
  const [justCreated, setJustCreated] = useState(null) // the design just duplicated/AI-seeded, awaiting edit-or-done choice
  const [aiSeeding, setAiSeeding] = useState(false)

  useEffect(() => {
    api.get('/invoices/designs/')
      .then(({ data }) => setDesigns(data))
      .catch(() => setError('Could not load your saved designs.'))
      .finally(() => setLoading(false))
  }, [])

  // Merges a just-set-default design into state — the shared bookkeeping
  // handleSetDefault/handleUseTemplate/handleAiSeedUpload all need after a
  // real POST /designs/{id}/set-default/ call (whichever design comes
  // back with is_default:true wins, every other design's own is_default
  // flips false locally to match, without a second fetch).
  function applyDefaultInState(defaultedDesign) {
    setDesigns((prev) => prev.map((d) => (d.id === defaultedDesign.id ? defaultedDesign : { ...d, is_default: false })))
  }

  async function handleUseTemplate(baseTemplate, colorVariant) {
    setBusyTemplate(baseTemplate)
    setError('')
    try {
      const { data } = await api.post('/invoices/designs/duplicate/', {
        base_template: baseTemplate, color_variant: colorVariant,
      })
      setDesigns((prev) => [data, ...prev])
      setJustCreated(data)
      // "Use this template" is a real call-to-action, not just "add this to
      // a pile of designs" — it immediately becomes the active design new
      // invoices use, matching what the button's own name promises. Real,
      // confirmed SEV1 finding this closes: previously nothing ever made a
      // newly-duplicated design the one anything actually used (see
      // DECISIONS.md's 19 August 2026 "design assignment gap" entry) — a
      // saved design existed but had zero effect on any real invoice.
      const { data: defaulted } = await api.post(`/invoices/designs/${data.id}/set-default/`)
      applyDefaultInState(defaulted)
      setJustCreated(defaulted)
    } catch {
      setError('Could not create a design from that template. Please try again.')
    } finally {
      setBusyTemplate(null)
    }
  }

  async function handleAiSeedUpload(e) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file if the user retries
    if (!file) return

    setAiSeeding(true)
    setError('')
    try {
      const formData = new FormData()
      formData.append('image', file)
      const { data } = await api.post('/invoices/designs/ai-seed/', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setDesigns((prev) => [data, ...prev])
      // Same immediate-activation treatment as handleUseTemplate above —
      // an AI-seeded design is just as much a real, direct "use this" pick
      // as a ready-made template, not a second-class candidate that sits
      // unused until a separate manual step.
      let created = data
      try {
        const { data: defaulted } = await api.post(`/invoices/designs/${data.id}/set-default/`)
        applyDefaultInState(defaulted)
        created = defaulted
      } catch {
        // Non-fatal — the design itself was created successfully (the
        // banner below still offers Customize/Done); only the auto-default
        // convenience step failed, silently falling back to the pre-
        // existing manual "Set as default" star the user can still click.
      }
      setJustCreated(created)
    } catch (err) {
      // Deliberately stays on this same page — Path 1's templates and the
      // "Blank design" button above remain immediately visible/clickable,
      // never a dead end, per Step 9's own explicit requirement.
      setError(err.response?.data?.error || 'Could not create a design from that image. Please try again, or pick a template below instead.')
    } finally {
      setAiSeeding(false)
    }
  }

  function handleStartBlank() {
    navigate('/invoices/designs/new/edit', {
      state: { seedDesign: { name: 'Untitled design', base_template: 'professional', source: 'custom', color_variant: '', design_data: BLANK_DESIGN_DATA } },
    })
  }

  function handleEdit(design) {
    navigate(`/invoices/designs/${design.id}/edit`)
  }

  // Real, visible "which design is active" state — a genuine gap until
  // this pass (SEV1 report, 19 August 2026): there was previously no way
  // to see, anywhere in this gallery, which design (if any) new invoices
  // would actually use. `is_default` is now a real, meaningful signal
  // (apps.invoices.views.invoice_create/_finalise_invoice both read it,
  // see DECISIONS.md) rather than a write-only field nothing ever
  // consulted — this banner reflects that same real backend behavior
  // directly, not a separate, potentially-drifting frontend guess.
  const activeDesign = designs.find((d) => d.is_default)
  const activeColorLabel = activeDesign
    ? (COLOR_VARIANTS[activeDesign.base_template] || []).find((v) => v.key === (activeDesign.color_variant || 'default'))?.label
    : null

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

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 800, color: 'var(--text-primary)' }}>Manage Designs</h1>
          <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: '0.88rem' }}>
            Pick a ready-made template or build your own invoice layout.
          </p>
        </div>
        <button onClick={handleStartBlank} className="fos-btn fos-btn-accent" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Plus size={15} /> Blank design
        </button>
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
            {activeDesign.name} ({BASE_TEMPLATE_LABELS[activeDesign.base_template] || activeDesign.base_template}
            {activeColorLabel ? ` — ${activeColorLabel}` : ''})
          </span>
        ) : (
          <span>
            <strong style={{ color: 'var(--text-primary)' }}>Currently active for new invoices:</strong>{' '}
            Professional (default) — no design has been set as your default yet.
          </span>
        )}
      </div>

      {error && <FosAlert type="error" onDismiss={() => setError('')} style={{ marginBottom: 16 }}>{error}</FosAlert>}

      {justCreated && (
        <FosAlert type="success" onDismiss={() => setJustCreated(null)} style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <span>"{justCreated.name}" is ready to use as-is, or you can customize it further.</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setJustCreated(null)} className="fos-btn fos-btn-ghost">Done</button>
              <button onClick={() => handleEdit(justCreated)} className="fos-btn fos-btn-accent">Customize</button>
            </div>
          </div>
        </FosAlert>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '8px 0 12px' }}>
        <LayoutTemplate size={16} style={{ color: 'var(--text-tertiary)' }} />
        <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          Ready-made templates
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16, marginBottom: 32 }}>
        {Object.keys(BUILTIN_DESIGN_DATA).map((baseTemplate) => (
          <BuiltinTemplateCard
            key={baseTemplate}
            baseTemplate={baseTemplate}
            logoUrl={logoUrl}
            onUse={handleUseTemplate}
            busy={busyTemplate === baseTemplate}
          />
        ))}

        {/* Path 3 — AI-seeded design (Step 9). Classify-only: uploads a
            reference image, one Groq vision call maps it onto the closest
            of the same 3 base templates + a couple of real colors + a
            coarse layout density, and design_ai_seed (backend) returns a
            real, already-saved, already-validated InvoiceDesign. Never a
            dead end on failure — the error banner above renders in place;
            Path 1's templates and "Blank design" stay clickable the whole
            time. */}
        <label
          htmlFor="ai-seed-upload"
          style={{
            background: 'var(--bg-surface-2)', border: '1px dashed var(--border-default)', borderRadius: 'var(--radius-lg)',
            padding: 16, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8,
            color: 'var(--text-tertiary)', minHeight: 200, cursor: aiSeeding ? 'wait' : 'pointer',
          }}
        >
          {aiSeeding ? <span className="fos-spinner" /> : <Sparkles size={22} />}
          <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            {aiSeeding ? 'Reading your design…' : 'AI-seeded design'}
          </span>
          <span style={{ fontSize: '0.74rem', textAlign: 'center' }}>
            {aiSeeding ? 'This calls a real AI model and can take a few seconds.' : 'Upload a logo, letterhead, or old invoice — we\'ll match the closest style.'}
          </span>
          <input
            id="ai-seed-upload" type="file" accept="image/png,image/jpeg,image/webp"
            onChange={handleAiSeedUpload} disabled={aiSeeding} style={{ display: 'none' }}
          />
        </label>
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
          No saved designs yet — use a ready-made template above or start a blank one.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
          {designs.map((design) => (
            <SavedDesignCard
              key={design.id}
              design={design}
              logoUrl={logoUrl}
              onEdit={handleEdit}
              onSetDefault={handleSetDefault}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  )
}
