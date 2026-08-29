// src/pages/DesignGallery.jsx
//
// The LanceraOS Template Builder's own "Manage Designs" gallery — Create
// (blank or a ready-made template), Edit, Duplicate-via-template,
// AI-seed, set-default, delete. Wired from Invoices.jsx's header (see
// that file's own comment on why there's no natural per-invoice design
// picker yet). Stays inside the normal AppShell frame — unlike the
// editor's own canvas, a gallery/list page is exactly what AppShell's
// standard layout already handles well; no reason to break that
// precedent here the way the canvas itself needed to.
//
// Production cutover: there is one editor, reached the same way whether
// a design started blank, from a template, or from an AI-seeded upload
// — no "try the new editor" concept, no separate legacy route.
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Copy, LayoutTemplate, Plus, Sparkles, Star, Trash2 } from 'lucide-react'

import api from '@/lib/api'
import useTitle from '@/hooks/useTitle'
import FosAlert from '@/components/FosAlert'
import DesignLivePreview from '@/components/design-editor/DesignLivePreview'
import { fetchBlankDesignData, fetchDesignTemplates } from '@/lib/designEditor/canvasApi'

// Real, friendly labels for the 3 production base templates — a small,
// static, never-drifting lookup (the real inventory itself, including
// each one's real color variants, comes from design_templates_list,
// fetched below — this is presentation-only).
const BASE_TEMPLATE_LABELS = { professional: 'Professional', minimal: 'Minimal', modern: 'Modern' }

function BuiltinTemplateCard({ baseTemplate, variants, onUse, busy }) {
  const [variant, setVariant] = useState(variants[0]?.key || '')

  return (
    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
        <DesignLivePreview baseTemplate={baseTemplate} colorVariant={variant} />
      </div>
      <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)', marginBottom: 8 }}>
        {BASE_TEMPLATE_LABELS[baseTemplate] || baseTemplate}
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {variants.map((v) => (
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

function SavedDesignCard({ design, baseTemplateLabels, onEdit, onSetDefault, onDelete }) {
  return (
    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
        <DesignLivePreview designId={design.id} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <span style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--text-primary)' }}>{design.name}</span>
        {design.is_default && <Star size={13} style={{ color: 'var(--accent)' }} fill="var(--accent)" />}
      </div>
      <div style={{ fontSize: '0.74rem', color: 'var(--text-tertiary)', marginBottom: 12 }}>
        Based on {baseTemplateLabels[design.base_template] || design.base_template} · {design.source}
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

  const [designs, setDesigns] = useState([])
  const [templates, setTemplates] = useState([])
  const [variantDetails, setVariantDetails] = useState({}) // { professional: [{key,label,primary,secondary}, ...], ... }
  const [loading, setLoading] = useState(true)
  const [busyTemplate, setBusyTemplate] = useState(null)
  const [startingBlank, setStartingBlank] = useState(false)
  const [error, setError] = useState('')
  const [justCreated, setJustCreated] = useState(null) // the design just created, awaiting edit-or-done choice
  const [aiSeeding, setAiSeeding] = useState(false)

  useEffect(() => {
    Promise.all([
      api.get('/invoices/designs/'),
      fetchDesignTemplates(),
    ])
      .then(([designsResp, templatesResp]) => {
        setDesigns(designsResp.data)
        setTemplates(templatesResp.templates)
        setVariantDetails(templatesResp.variant_details || {})
      })
      .catch(() => setError('Could not load your saved designs.'))
      .finally(() => setLoading(false))
  }, [])

  // Merges a just-set-default design into state — the shared bookkeeping
  // handleSetDefault/handleUseTemplate/handleAiSeedUpload/handleStartBlank
  // all need after a real POST /designs/{id}/set-default/ call (whichever
  // design comes back with is_default:true wins, every other design's
  // own is_default flips false locally to match, without a second fetch).
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
      // invoices use, matching what the button's own name promises.
      const { data: defaulted } = await api.post(`/invoices/designs/${data.id}/set-default/`)
      applyDefaultInState(defaulted)
      setJustCreated(defaulted)
    } catch {
      setError('Could not create a design from that template. Please try again.')
    } finally {
      setBusyTemplate(null)
    }
  }

  // The blank starting mode — deliberately NOT the same create-then-
  // set-default/"ready to use as-is" treatment "Use this template" and
  // the AI-seed upload get above. A blank design has zero header content
  // (get_blank_design_data returns header.elements: []) — no logo,
  // business info, client info, or dates — so it is never "ready to
  // use" and must never be silently activated as the account's default.
  // Straight to the editor instead, where there's actually something to
  // build. The blank design_data itself comes from the same production
  // template.get_blank_design_data (?blank=true) the editor's own
  // "Start blank" button calls directly — no separate client-side copy.
  async function handleStartBlank() {
    setStartingBlank(true)
    setError('')
    try {
      const designData = await fetchBlankDesignData('professional')
      const { data } = await api.post('/invoices/designs/', {
        name: 'Untitled design', base_template: 'professional', color_variant: '', design_data: designData,
      })
      setDesigns((prev) => [data, ...prev])
      navigate(`/invoices/designs/${data.id}/edit`)
    } catch {
      setError('Could not start a blank design. Please try again.')
    } finally {
      setStartingBlank(false)
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
      // Deliberately stays on this same page — the ready-made templates
      // and "Blank design" button above remain immediately visible/
      // clickable, never a dead end.
      setError(err.response?.data?.error || 'Could not create a design from that image. Please try again, or pick a template below instead.')
    } finally {
      setAiSeeding(false)
    }
  }

  // One editor for every design — blank, a ready-made template, an
  // AI-seeded upload, or a legacy design predating this cutover (the
  // editor's own load path migrates a legacy-shape design in memory on
  // open; nothing here needs to know which case it is).
  function handleEdit(design) {
    navigate(`/invoices/designs/${design.id}/edit`)
  }

  // Real, visible "which design is active" state — `is_default` is a
  // real, meaningful signal (apps.invoices.views.invoice_create/
  // _finalise_invoice both read it) rather than a write-only field
  // nothing ever consulted — this banner reflects that same real
  // backend behavior directly, not a separate, potentially-drifting
  // frontend guess.
  const activeDesign = designs.find((d) => d.is_default)
  const activeColorLabel = activeDesign
    ? (variantDetails[activeDesign.base_template] || []).find((v) => v.key === (activeDesign.color_variant || 'default'))?.label
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
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={handleStartBlank} disabled={startingBlank} className="fos-btn fos-btn-accent" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Plus size={15} /> {startingBlank ? 'Starting…' : 'Blank design'}
          </button>
        </div>
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
        {templates.map((baseTemplate) => (
          <BuiltinTemplateCard
            key={baseTemplate}
            baseTemplate={baseTemplate}
            variants={variantDetails[baseTemplate] || []}
            onUse={handleUseTemplate}
            busy={busyTemplate === baseTemplate}
          />
        ))}

        {/* AI-seeded design. Classify-only: uploads a reference image, one
            Groq vision call maps it onto the closest of the same 3 base
            templates + a couple of real colors + a coarse layout
            density, and design_ai_seed (backend) returns a real,
            already-saved, already-validated InvoiceDesign. Never a dead
            end on failure — the error banner above renders in place;
            the ready-made templates and "Blank design" stay clickable
            the whole time. */}
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
              baseTemplateLabels={BASE_TEMPLATE_LABELS}
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
