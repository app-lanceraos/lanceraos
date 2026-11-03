// src/pages/ProposalEditor.jsx
//
// One proposal, at /proposals/:id. A draft is edited in place with autosave
// (useProposalAutosave.js — there is no Save button, DECISIONS.md D3); anything
// else renders read-only (ProposalReadOnlyView.jsx).
//
// Three rules this page keeps that are easy to break:
//   * The server's reply to a save never overwrites what the person typed.
//     `handleSaved` merges only server-COMPUTED values (score, word count,
//     totals, timestamps); adopting the echoed text would eat keystrokes typed
//     while the request was in flight.
//   * The score is shown as returned, never computed here (D4).
//   * Money shown while typing is computed with the exact arithmetic the
//     server uses (D6); if a save ever comes back with different totals, the
//     server's are shown and the mismatch is logged once.
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Copy, FileX, MoreHorizontal, RefreshCw, Sparkles, Trash2, X } from 'lucide-react'

import api from '@/lib/api'
import useTitle from '@/hooks/useTitle'
import useTimedMessage from '@/hooks/useTimedMessage'
import useProposalAutosave from '@/hooks/useProposalAutosave'
import Card from '@/components/Card'
import DropdownMenu from '@/components/DropdownMenu'
import FormSelect from '@/components/FormSelect'
import FosAlert from '@/components/FosAlert'
import ProposalClientFields from '@/components/ProposalClientFields'
import ProposalColumns from '@/components/ProposalColumns'
import { ProposalCounter, ProposalTextArea, ProposalTextField } from '@/components/ProposalFields'
import ProposalItemsEditor from '@/components/ProposalItemsEditor'
import ProposalReadOnlyView from '@/components/ProposalReadOnlyView'
import ProposalSaveIndicator from '@/components/ProposalSaveIndicator'
import ProposalScopeEditor from '@/components/ProposalScopeEditor'
import ProposalScoreCard from '@/components/ProposalScoreCard'
import ProposalStatusBadge from '@/components/ProposalStatusBadge'
import ProposalTipsCard from '@/components/ProposalTipsCard'
import { CURRENCY_OPTIONS } from './clientHelpers'
import { todayInPlatformTimezone } from './invoiceHelpers'
import {
  AI_REQUEST_TIMEOUT_MS, LIMITS, TONE_OPTIONS, buildSavePayload, charCount, computeProposalTotals, errorMessage,
  formatProposalMoney, proposalToForm, wordCount,
} from './proposalHelpers'

const NOT_DRAFT_NOTICE = 'This proposal was sent or changed from another window, so your latest edits were not saved. Here is its current state.'

// ══════════════════════════════════════════════════════════════════
// Loader — owns fetching, and the not-found / error / reload states
// ══════════════════════════════════════════════════════════════════

export default function ProposalEditor() {
  const { id } = useParams()
  // Keyed by id so moving between two proposals starts from clean state.
  return <ProposalLoader key={id} id={id} />
}

function ProposalLoader({ id }) {
  useTitle('LanceraOS | Proposal')
  const [view, setView] = useState({ status: 'loading', detail: null })
  const [version, setVersion] = useState(0)
  const [reloadToken, setReloadToken] = useState(0)
  const [notice, setNotice] = useState(null)

  // Every change of `reloadToken` (a retry, or the server saying this is no
  // longer a draft) fetches again; a response that arrives after the effect
  // was cleaned up — another reload started, or the page was left — is dropped.
  useEffect(() => {
    let stale = false
    api.get(`/proposals/${id}/`)
      .then(({ data }) => {
        if (stale) return
        setView({ status: 'ready', detail: data })
        // A new version remounts the editor from the fresh detail.
        setVersion((v) => v + 1)
      })
      .catch((error) => {
        if (stale) return
        setView({ status: error.response?.status === 404 ? 'notfound' : 'error', detail: null })
      })
    return () => { stale = true }
  }, [id, reloadToken])

  const retry = useCallback(() => {
    setView({ status: 'loading', detail: null })
    setReloadToken((t) => t + 1)
  }, [])

  // The server said this is no longer a draft (sent from another window, or a
  // draft-only action was refused): reload what it actually is and say why.
  const handleNotDraft = useCallback(() => {
    setNotice(NOT_DRAFT_NOTICE)
    setReloadToken((t) => t + 1)
  }, [])
  const handleNotFound = useCallback(() => setView({ status: 'notfound', detail: null }), [])

  if (view.status === 'loading') return <EditorSkeleton />

  if (view.status === 'notfound') {
    return (
      <div style={{ textAlign: 'center', padding: '48px 24px', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)' }}>
        <FileX size={28} style={{ color: 'var(--text-tertiary)', marginBottom: 10 }} />
        <p style={{ margin: 0, fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.95rem' }}>This proposal doesn&apos;t exist or was deleted.</p>
        <Link to="/proposals" className="fos-btn fos-btn-ghost" style={{ marginTop: 16 }}>
          <ArrowLeft size={14} /> Back to proposals
        </Link>
      </div>
    )
  }

  if (view.status === 'error') {
    return (
      <div style={{ padding: 32, textAlign: 'center' }}>
        <FosAlert type="error" style={{ display: 'inline-flex', marginBottom: 12 }}>We couldn&apos;t load this proposal. Please try again.</FosAlert>
        <br />
        <button className="fos-btn fos-btn-ghost" onClick={retry}>Retry</button>
      </div>
    )
  }

  const shared = { notice, onDismissNotice: () => setNotice(null), onNotDraft: handleNotDraft }
  return view.detail.is_editable
    ? <DraftEditor key={version} detail={view.detail} onNotFound={handleNotFound} onReload={retry} {...shared} />
    : <SentProposal key={version} detail={view.detail} {...shared} />
}

function EditorSkeleton() {
  const block = { background: 'var(--bg-surface-3)', borderRadius: 'var(--radius-lg)', animation: 'skeleton-pulse 1.4s ease-in-out infinite' }
  return (
    <div aria-hidden="true">
      <div style={{ ...block, height: 44, marginBottom: 16, maxWidth: 520 }} />
      <ProposalColumns
        main={<><div style={{ ...block, height: 150, marginBottom: 16 }} /><div style={{ ...block, height: 280, marginBottom: 16 }} /></>}
        aside={<div style={{ ...block, height: 320 }} />}
      />
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════
// Shared header actions: Duplicate (any status), Delete (drafts)
// ══════════════════════════════════════════════════════════════════

function useProposalActions({ detail, onNotDraft, beforeDuplicate, pauseSaving, resumeSaving }) {
  const navigate = useNavigate()
  const { message, show, clear } = useTimedMessage()
  const [busy, setBusy] = useState(null) // null | 'duplicate' | 'delete'

  function failed(error, fallback) {
    const { message: text, status } = errorMessage(error, fallback)
    // A draft-only action refused because the proposal is no longer a draft.
    if (status === 403) onNotDraft()
    else show('error', text)
  }

  async function duplicate() {
    setBusy('duplicate')
    clear()
    try {
      if (beforeDuplicate && !(await beforeDuplicate())) {
        show('error', "We couldn't save your latest changes first, so nothing was copied. Please try again.")
        return
      }
      const { data } = await api.post(`/proposals/${detail.id}/duplicate/`)
      navigate(`/proposals/${data.id}`, { state: { flash: 'Copied as a new draft. Set a new valid-until date before sending.' } })
    } catch (error) {
      failed(error, "We couldn't copy this proposal. Please try again.")
    } finally {
      setBusy(null)
    }
  }

  async function remove() {
    setBusy('delete')
    clear()
    // A save landing on a proposal that is about to be deleted would 404.
    pauseSaving?.()
    try {
      await api.delete(`/proposals/${detail.id}/`)
      navigate('/proposals', { state: { flash: 'Proposal deleted.' } })
      return true
    } catch (error) {
      resumeSaving?.()
      failed(error, "We couldn't delete this proposal. Please try again.")
      setBusy(null)
      return false
    }
  }

  return { busy, message, clear, show, duplicate, remove, failed }
}

function ProposalHeader({ detail, titleField, saveIndicator, onDuplicate, onDelete, busy }) {
  const items = [{ key: 'duplicate', label: 'Duplicate', Icon: Copy, onClick: onDuplicate, disabled: busy !== null }]
  if (onDelete) items.push({ key: 'delete', label: 'Delete', Icon: Trash2, onClick: onDelete, danger: true, disabled: busy !== null })
  return (
    <div style={{ marginBottom: 16 }}>
      <Link to="/proposals" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 12, fontSize: '0.82rem', color: 'var(--text-secondary)', textDecoration: 'none' }}>
        <ArrowLeft size={14} /> Proposals
      </Link>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 280px', minWidth: 0 }}>{titleField}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', minHeight: 40 }}>
          <ProposalStatusBadge status={detail.status} expired={detail.is_expired} />
          {detail.proposal_number && <span style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>{detail.proposal_number}</span>}
          <DropdownMenu
            trigger={<MoreHorizontal size={17} />} triggerLabel="More actions" bareTrigger
            triggerStyle={{ width: 40, height: 40, borderRadius: 'var(--radius-md)', color: 'var(--text-secondary)', border: '1.5px solid var(--border-subtle)' }}
            items={items}
          />
        </div>
      </div>
      {saveIndicator && <div style={{ marginTop: 8 }}>{saveIndicator}</div>}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════
// A proposal that is no longer a draft
// ══════════════════════════════════════════════════════════════════

function SentProposal({ detail, notice, onDismissNotice, onNotDraft }) {
  const actions = useProposalActions({ detail, onNotDraft })
  return (
    <div style={{ maxWidth: 1180 }}>
      {notice && <FosAlert type="info" onDismiss={onDismissNotice} style={{ marginBottom: 16 }}>{notice}</FosAlert>}
      {actions.message && (
        <FosAlert type={actions.message.type} onDismiss={actions.clear} style={{ marginBottom: 16 }}>{actions.message.text}</FosAlert>
      )}
      <ProposalHeader
        detail={detail} busy={actions.busy} onDuplicate={actions.duplicate}
        titleField={<h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>{detail.title}</h1>}
      />
      <ProposalReadOnlyView detail={detail} />
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════
// The draft editor
// ══════════════════════════════════════════════════════════════════

function serverValuesOf(detail) {
  return {
    status: detail.status, ai_tips: detail.ai_tips || [], ai_generated: detail.ai_generated, quality: detail.quality,
    word_count: detail.word_count, subtotal: detail.subtotal, tax_amount: detail.tax_amount, total: detail.total,
    updated_at: detail.updated_at,
  }
}

const pricingSignature = (payload) => JSON.stringify([payload.items, payload.tax_rate, payload.discount_amount])

function DraftEditor({ detail, notice, onDismissNotice, onNotDraft, onNotFound, onReload }) {
  const [initial] = useState(() => {
    const form = proposalToForm(detail)
    return { form, snapshot: buildSavePayload(form) }
  })
  const [form, setForm] = useState(initial.form)
  const [server, setServer] = useState(() => serverValuesOf(detail))
  const [serverPricing, setServerPricing] = useState(null)
  const [dialog, setDialog] = useState(null) // null | 'delete' | 'regenerate'
  const [regen, setRegen] = useState({ busy: false, elapsed: 0, error: null, ambiguous: false })
  const mismatchWarnedRef = useRef(false)

  const patchForm = useCallback((patch) => setForm((current) => ({ ...current, ...patch })), [])

  function handleSaved(data, sent) {
    setServer((previous) => ({
      ...previous,
      status: data.status, quality: data.quality, word_count: data.word_count, subtotal: data.subtotal,
      tax_amount: data.tax_amount, total: data.total, updated_at: data.updated_at,
    }))
    if (!('items' in sent || 'tax_rate' in sent || 'discount_amount' in sent)) return
    // What the server now holds is the snapshot (already merged with `sent`).
    const held = autosave.getSnapshot()
    const local = computeProposalTotals(held.items, held.tax_rate, held.discount_amount)
    if (local.total === data.total && local.subtotal === data.subtotal && local.tax_amount === data.tax_amount) {
      setServerPricing(null)
      return
    }
    if (!mismatchWarnedRef.current) {
      mismatchWarnedRef.current = true
      console.warn('[proposals] Locally computed totals differ from the server\'s; showing the server\'s.', { local: local.total, server: data.total })
    }
    setServerPricing({ signature: pricingSignature(held), subtotal: data.subtotal, tax_amount: data.tax_amount, total: data.total })
  }

  const autosave = useProposalAutosave({
    proposalId: detail.id, form, initialSnapshot: initial.snapshot, enabled: true,
    onSaved: handleSaved, onNotDraft, onNotFound,
  })

  const actions = useProposalActions({
    detail, onNotDraft, beforeDuplicate: autosave.flushNow, pauseSaving: autosave.pause, resumeSaving: autosave.resume,
  })

  // ── Regeneration ──
  useEffect(() => {
    if (!regen.busy) return undefined
    const startedAt = Date.now()
    const timer = setInterval(() => setRegen((r) => ({ ...r, elapsed: Math.floor((Date.now() - startedAt) / 1000) })), 1000)
    const warn = (event) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => { clearInterval(timer); window.removeEventListener('beforeunload', warn) }
  }, [regen.busy])

  async function regenerate() {
    setRegen({ busy: true, elapsed: 0, error: null, ambiguous: false })
    // Whatever is unsaved goes first, so the request is made against the
    // server's current state. If that flush discovers the proposal is no longer
    // a draft the page is already reloading — don't fire a request that will 403.
    await autosave.flushNow()
    if (autosave.isStopped()) return
    autosave.pause()
    let resume = true
    try {
      const { data } = await api.post(
        `/proposals/${detail.id}/generate-ai/`,
        { job_description: form.job_description, tone: form.tone, my_experience: form.my_experience, confirm_overwrite: true },
        { timeout: AI_REQUEST_TIMEOUT_MS },
      )
      const replaced = { body: data.body, tone: data.tone, job_description: data.job_description, my_experience: data.my_experience }
      patchForm(replaced)
      setServer((previous) => ({
        ...previous,
        ai_tips: data.ai_tips || [], ai_generated: data.ai_generated, quality: data.quality, word_count: data.word_count,
        updated_at: data.updated_at,
      }))
      autosave.commitSnapshot(replaced)
      setDialog(null)
      setRegen({ busy: false, elapsed: 0, error: null, ambiguous: false })
      actions.show('success', 'Proposal text regenerated. Read it through before you send it.')
    } catch (error) {
      const { message, status, reason } = errorMessage(error, "We couldn't regenerate your proposal. Please try again.")
      setDialog(null)
      if (status === 403) {
        // No longer a draft: the page reloads into its real state, so there is
        // nothing left here to resume.
        resume = false
        onNotDraft()
        return
      }
      const ambiguous = !error.response || [408, 502, 504].includes(status) || (status >= 500 && !reason)
      setRegen({
        busy: false, elapsed: 0, ambiguous,
        error: ambiguous
          ? "We lost the connection before getting an answer, so the new text may have been saved. Reload this proposal to see what's there."
          : message,
      })
    } finally {
      if (resume) autosave.resume()
    }
  }

  // On failure the dialog closes, so the error shown on the page is not hidden
  // behind its overlay.
  const confirmDelete = async () => {
    if (!(await actions.remove())) setDialog(null)
  }

  const startRegenerate = () => {
    if (form.body.trim()) setDialog('regenerate')
    else regenerate()
  }

  // ── Derived display values ──
  const payload = useMemo(() => buildSavePayload(form), [form])
  const totals = useMemo(() => computeProposalTotals(form.items, form.tax_rate, form.discount_amount), [form.items, form.tax_rate, form.discount_amount])
  const shownTotals = serverPricing && serverPricing.signature === pricingSignature(payload) ? serverPricing : totals

  const busy = regen.busy || actions.busy !== null
  const errors = autosave.validation
  const serverErrors = autosave.serverErrors
  const fieldError = (key) => errors[key] || serverErrors[key]
  const scorePending = autosave.dirtyKeys.includes('body') || autosave.dirtyKeys.includes('job_description')
  const jobLength = charCount(form.job_description.trim())
  const jobTooShort = jobLength < LIMITS.jobDescriptionMinForAi
  const currencyOptions = CURRENCY_OPTIONS.some((o) => o.value === form.currency)
    ? CURRENCY_OPTIONS
    : [...CURRENCY_OPTIONS, { value: form.currency, label: form.currency }]
  const hasBody = Boolean(form.body.trim())

  const main = (
    <>
      <Card title="Client">
        <ProposalClientFields
          value={form} onChange={patchForm} disabled={busy}
          errors={{
            client: serverErrors.client, client_name: fieldError('client_name'),
            client_email: fieldError('client_email'), client_company: fieldError('client_company'),
          }}
        />
      </Card>

      <Card title="Job post & AI" subtitle="The AI writes from this. It sees only the job post, your experience notes, and your name, business name and profession.">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <ProposalTextArea
            label="Job post" rows={6} value={form.job_description} disabled={busy}
            onChange={(text) => patchForm({ job_description: text })}
            placeholder="Paste the client's job description here"
            error={fieldError('job_description')}
            counter={<ProposalCounter count={charCount(form.job_description)} max={LIMITS.jobDescription} min={LIMITS.jobDescriptionMinForAi} />}
          />
          <ProposalTextArea
            label="Your experience" rows={3} value={form.my_experience} disabled={busy}
            onChange={(text) => patchForm({ my_experience: text })}
            hint="Only write what is true — the AI is told not to invent anything beyond this."
            error={fieldError('my_experience')}
            counter={<ProposalCounter count={charCount(form.my_experience)} max={LIMITS.myExperience} />}
          />
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 180px', maxWidth: 240 }}>
              <FormSelect label="Tone" value={form.tone} options={TONE_OPTIONS} disabled={busy} onChange={(e) => patchForm({ tone: e.target.value })} />
            </div>
            <button type="button" className="fos-btn fos-btn-accent" onClick={startRegenerate} disabled={busy || jobTooShort}>
              {regen.busy ? <span className="fos-spinner" aria-hidden="true" /> : hasBody ? <RefreshCw size={15} /> : <Sparkles size={15} />}
              {regen.busy ? `Generating… ${regen.elapsed}s` : hasBody ? 'Regenerate with AI' : 'Generate with AI'}
            </button>
          </div>
          {jobTooShort && !regen.busy && (
            <p className="fos-hint" style={{ margin: 0 }}>Paste the job post (at least {LIMITS.jobDescriptionMinForAi} characters) to use AI.</p>
          )}
          {regen.busy && <p role="status" style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>This usually takes 10–40 seconds. Please keep this page open.</p>}
          {regen.error && (
            <FosAlert type={regen.ambiguous ? 'warning' : 'error'} onDismiss={() => setRegen((r) => ({ ...r, error: null }))}>
              {regen.error}
              {regen.ambiguous && <> <button type="button" className="fos-btn fos-btn-ghost" style={{ padding: '2px 10px', marginLeft: 6 }} onClick={onReload}>Reload proposal</button></>}
            </FosAlert>
          )}
        </div>
      </Card>

      <Card
        title="Proposal text"
        action={server.ai_generated ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.72rem', fontWeight: 600, padding: '3px 8px', borderRadius: 'var(--radius-full)', background: 'var(--status-blue-bg)', color: 'var(--status-blue-text)' }}>
            <Sparkles size={11} /> AI-assisted draft
          </span>
        ) : null}
      >
        <ProposalTextArea
          label="What you'll say to the client" rows={14} value={form.body} disabled={busy}
          onChange={(text) => patchForm({ body: text })}
          error={fieldError('body')}
          counter={<ProposalCounter count={charCount(form.body)} max={LIMITS.body} />}
          hint={`${wordCount(form.body)} words`}
        />
        {server.ai_generated && (
          <p style={{ margin: '10px 0 0', fontSize: '0.78rem', color: 'var(--status-amber-text)', lineHeight: 1.5 }}>
            AI drafts can say things you never told it. Read the whole text and correct anything that isn&apos;t true.
          </p>
        )}
      </Card>

      <Card title="Scope" subtitle="Optional sections: deliverables, timeline, what is not included.">
        <ProposalScopeEditor
          sections={form.scope_sections} onChange={(sections) => patchForm({ scope_sections: sections })} disabled={busy}
          errors={errors.scope_sections} serverError={serverErrors.scope_sections}
        />
      </Card>

      <Card title="Pricing">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ maxWidth: 200 }}>
            <FormSelect label="Currency" value={form.currency} options={currencyOptions} disabled={busy} onChange={(e) => patchForm({ currency: e.target.value })} />
          </div>
          <ProposalItemsEditor
            items={form.items} onChange={(items) => patchForm({ items })} currency={form.currency} lineTotals={totals.lines}
            errors={errors.items} serverError={serverErrors.items} disabled={busy}
          />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
            <ProposalTextField
              label="Tax rate (%)" inputMode="decimal" value={form.tax_rate} disabled={busy}
              onChange={(text) => patchForm({ tax_rate: text })} error={fieldError('tax_rate')}
            />
            <ProposalTextField
              label={`Discount (${form.currency})`} inputMode="decimal" value={form.discount_amount} disabled={busy}
              onChange={(text) => patchForm({ discount_amount: text })} error={fieldError('discount_amount')}
            />
          </div>
          <div style={{ background: 'var(--bg-surface-2)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <TotalRow label="Subtotal" value={formatProposalMoney(shownTotals.subtotal, form.currency)} />
            {Number(shownTotals.tax_amount) > 0 && <TotalRow label={`Tax (${form.tax_rate}%)`} value={formatProposalMoney(shownTotals.tax_amount, form.currency)} />}
            {Number(form.discount_amount) > 0 && <TotalRow label="Discount" value={`−${formatProposalMoney(form.discount_amount, form.currency)}`} />}
            <div style={{ borderTop: '1px solid var(--border-subtle)', marginTop: 4, paddingTop: 6 }}>
              <TotalRow label="Total" value={formatProposalMoney(shownTotals.total, form.currency)} bold />
            </div>
          </div>
        </div>
      </Card>

      <Card title="Terms & validity">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <ProposalTextArea
            label="Payment terms" rows={3} value={form.payment_terms} disabled={busy}
            onChange={(text) => patchForm({ payment_terms: text })}
            placeholder="e.g. 50% upfront, 50% on delivery. Payable within 14 days."
            error={fieldError('payment_terms')}
            counter={<ProposalCounter count={charCount(form.payment_terms)} max={LIMITS.paymentTerms} />}
          />
          <div style={{ maxWidth: 240 }}>
            <ProposalTextField
              label="Valid until" type="date" value={form.valid_until} disabled={busy}
              min={todayInPlatformTimezone()} onChange={(text) => patchForm({ valid_until: text })}
              error={fieldError('valid_until')} hint="Required before the proposal can be sent"
            />
          </div>
        </div>
      </Card>
    </>
  )

  const aside = (
    <>
      <ProposalScoreCard quality={server.quality} pending={scorePending} />
      <ProposalTipsCard tips={server.ai_tips} />
    </>
  )

  return (
    <div style={{ maxWidth: 1180 }}>
      {notice && <FosAlert type="info" onDismiss={onDismissNotice} style={{ marginBottom: 16 }}>{notice}</FosAlert>}
      {actions.message && (
        <FosAlert type={actions.message.type} onDismiss={actions.clear} style={{ marginBottom: 16 }}>{actions.message.text}</FosAlert>
      )}

      <ProposalHeader
        detail={{ ...detail, status: server.status }} busy={actions.busy}
        onDuplicate={actions.duplicate} onDelete={() => setDialog('delete')}
        titleField={(
          <ProposalTextField
            label="Title" value={form.title} disabled={busy} required
            onChange={(text) => patchForm({ title: text })} error={fieldError('title')}
            style={{ fontSize: '1.05rem', fontWeight: 700 }}
          />
        )}
        saveIndicator={(
          <ProposalSaveIndicator
            status={autosave.status} retrying={autosave.retrying} rateLimited={autosave.rateLimited}
            withheld={autosave.withheld} dirty={autosave.dirty} onRetry={autosave.retry}
          />
        )}
      />

      <ProposalColumns main={main} aside={aside} />

      {dialog === 'delete' && (
        <ProposalDialog title="Delete this proposal?" busy={actions.busy === 'delete'} onClose={() => setDialog(null)}>
          <p style={dialogText}>This permanently deletes the draft. This cannot be undone.</p>
          <DialogButtons
            busy={actions.busy === 'delete'} onClose={() => setDialog(null)}
            confirm={(
              <button type="button" className="fos-btn fos-btn-danger" onClick={confirmDelete} disabled={actions.busy === 'delete'}>
                {actions.busy === 'delete' ? <span className="fos-spinner" aria-hidden="true" /> : <Trash2 size={14} />} Delete
              </button>
            )}
          />
        </ProposalDialog>
      )}

      {dialog === 'regenerate' && (
        <ProposalDialog title="Regenerate the proposal text?" busy={regen.busy} onClose={() => setDialog(null)}>
          <p style={dialogText}>This replaces the proposal text and the tips. Edits you made to the text will be lost.</p>
          <DialogButtons
            busy={regen.busy} onClose={() => setDialog(null)}
            confirm={(
              <button type="button" className="fos-btn fos-btn-accent" onClick={regenerate} disabled={regen.busy}>
                {regen.busy ? <span className="fos-spinner" aria-hidden="true" /> : <RefreshCw size={14} />}
                {regen.busy ? `Generating… ${regen.elapsed}s` : 'Regenerate'}
              </button>
            )}
          />
        </ProposalDialog>
      )}
    </div>
  )
}

function TotalRow({ label, value, bold }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: bold ? '0.95rem' : '0.8rem', fontWeight: bold ? 700 : 400, color: 'var(--text-primary)' }}>
      <span style={{ color: bold ? 'var(--text-primary)' : 'var(--text-secondary)' }}>{label}</span>
      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  )
}

// ── Dialogs (DESIGN.md "Centered modal" recipe). Written here rather than as a
// shared Modal on purpose (DESIGN.md Section 12). Escape and the close button
// do nothing while a request is running: closing would hide a pending action
// the person cannot then cancel. ──
const dialogText = { margin: '0 0 20px', fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.6 }

function ProposalDialog({ title, busy, onClose, children }) {
  const titleId = useId()
  const dialogRef = useRef(null)

  useEffect(() => { dialogRef.current?.focus() }, [])

  useEffect(() => {
    const onKeyDown = (event) => { if (event.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [busy, onClose])

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div
        ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
        style={{ background: 'var(--bg-surface)', borderRadius: 'var(--radius-xl)', boxShadow: '0 8px 40px rgba(0,0,0,0.25)', padding: '24px 28px', width: '100%', maxWidth: 440, maxHeight: '90vh', overflowY: 'auto', outline: 'none', animation: 'modal-in 0.2s cubic-bezier(0.22,1,0.36,1)' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h3 id={titleId} style={{ margin: 0, fontSize: '1.02rem', fontWeight: 700, color: 'var(--text-primary)' }}>{title}</h3>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close" className="fos-btn fos-btn-ghost" style={{ padding: 6 }}><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

function DialogButtons({ busy, onClose, confirm }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
      <button type="button" className="fos-btn fos-btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
      {confirm}
    </div>
  )
}
