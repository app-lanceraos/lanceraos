// src/components/NewInvoiceWizard.jsx
//
// The "New Invoice" entry point — replaces the old Gmail-compose-style
// "create a real empty draft the instant you click the button" flow (see
// DECISIONS.md for the full reversal reasoning: an empty draft invoice is
// a real row in a business list, not a disposable compose window, so it
// shouldn't exist in the database until it means something).
//
// Form state lives here, in React only, until a real threshold is
// crossed — at least a client (an existing client selected, OR a
// one-time client's name+email both entered). Crossing it fires the
// real POST /invoices/ with the current form data and switches into the
// exact same continuous-autosave behavior InvoiceDetailPanel.jsx already
// has for an existing draft (useInvoiceAutosave, shared — not
// reimplemented a second time). Closing before the threshold is crossed
// discards everything; nothing was ever created, nothing to clean up.
//
// 3 stages, matching the task's own explicit boundaries (not v1's exact
// grouping — see InvoiceFormFields.jsx's own comment):
//   1. Client + due date — the stage the threshold gets crossed on.
//   2. Line items (+ a real "Preview PDF" action once ≥1 item exists).
//   3. Currency/tax/discount/notes/terms/options — Finalise and Mark as
//      Sent live here, and ONLY here: both are disabled until stage 3
//      AND a valid client AND at least one real item — a genuine UI-state
//      guarantee (checked on every render from `form` + `invoiceId`, not
//      "the user probably won't click Back three times then click
//      Finalise" — they can, and the buttons stay disabled if they do).
//
// Once Finalise/Mark-as-Sent succeeds, this hands off to the normal,
// already-correct InvoiceDetailPanel (onFinalised(id)) rather than
// growing its own copy of the post-draft tabs/timeline/lifecycle-actions
// UI — this component's only job is the pre-finalised creation
// experience.
import { useState } from 'react'
import { ArrowLeft, ArrowRight, CheckCircle2, Eye, Send, X } from 'lucide-react'

import api from '@/lib/api'
import useInvoiceAutosave from '@/hooks/useInvoiceAutosave'
import FosAlert from './FosAlert'
import InvoiceFormFields from './InvoiceFormFields'
import { blankInvoiceForm, formToPayload } from '@/pages/invoiceHelpers'

const STAGES = [{ n: 1, label: 'Client & Dates' }, { n: 2, label: 'Line Items' }, { n: 3, label: 'Options' }]

function hasValidClient(form) {
  if (form.clientMode === 'existing') return !!form.client
  return form.client_name.trim() !== '' && form.client_email.trim() !== ''
}

function hasValidItem(form) {
  return form.items.some((it) => it.description.trim() !== '')
}

export default function NewInvoiceWizard({ clients = [], onClose, onFinalised }) {
  const [form, setForm] = useState(blankInvoiceForm())
  const [stage, setStage] = useState(1)
  const [invoiceId, setInvoiceId] = useState(null)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  const [busyKey, setBusyKey] = useState(null)
  const [actionError, setActionError] = useState('')

  const { saveState, saveErrors, setSaveErrors, flushPendingSave } = useInvoiceAutosave(invoiceId, form, true)

  const clientValid = hasValidClient(form)
  const itemValid = hasValidItem(form)
  const canFinalise = !!invoiceId && stage === 3 && clientValid && itemValid

  function routeErrorsToStage(errors) {
    if (errors.client_name || errors.client_email || errors.due_date) { setStage(1); return }
    if (errors.items || Object.keys(errors).some((k) => k.startsWith('item_'))) { setStage(2); return }
    setStage(3)
  }

  // Stage 1's own "Next" — the one real place the creation threshold is
  // crossed. If an invoiceId already exists (the user went Back to stage
  // 1 after creating it, then forward again), this is just navigation —
  // no second POST, autosave already covers any edits made while here.
  async function handleNextFromStage1() {
    if (invoiceId) { setStage(2); return }

    if (!clientValid) {
      setCreateError('Enter a client — pick an existing one, or fill in name + email for a one-time client.')
      return
    }

    setCreating(true)
    setCreateError('')
    try {
      const { data } = await api.post('/invoices/', formToPayload(form))
      setInvoiceId(data.id)
      setStage(2)
    } catch (e) {
      const body = e.response?.data
      if (body && typeof body === 'object') {
        setSaveErrors(Object.fromEntries(Object.entries(body).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])))
      }
      setCreateError(body?.error || 'Could not create this invoice. Please check the fields above and try again.')
    } finally {
      setCreating(false)
    }
  }

  // Discards local state and closes if the threshold was never crossed
  // (nothing to flush, nothing was ever created) — otherwise flushes the
  // pending autosave first, exactly like InvoiceDetailPanel's own close.
  async function handleClose() {
    if (invoiceId) await flushPendingSave()
    onClose(invoiceId)
  }

  async function handlePreviewPdf() {
    if (!invoiceId) return
    setActionError('')
    // Real bug, found by testing this in an actual browser, not trusted
    // from v1's identical-looking pattern on faith: the original
    // approach (await a blob GET via axios, then window.open() the
    // resulting blob: URL) opened a real tab but Chrome never actually
    // navigated it — confirmed directly (tab.closed stayed false,
    // tab.location was set, but the tab's own url stayed about:blank
    // indefinitely, with no console error). blob: URLs are scoped to the
    // document that created them; sharing one into a separate top-level
    // browsing context via window.open doesn't reliably work. Fixed by
    // skipping the blob step entirely — the tab navigates directly to
    // the real, authenticated GET endpoint (a normal top-level
    // navigation, so the httpOnly auth cookie rides along on
    // same-site — :5173/:8000 on localhost share a registrable domain —
    // exactly like clicking a real link, not an XHR this app's own
    // withCredentials config would otherwise need to matter for).
    // Opened synchronously, before any await, so it's still a direct
    // result of the click (a tab opened only after an await is what
    // popup blockers actually target).
    const tab = window.open('about:blank', '_blank')
    try {
      await flushPendingSave()
      const targetUrl = `${api.defaults.baseURL}/invoices/${invoiceId}/pdf/`
      if (tab) tab.location.href = targetUrl
    } catch (e) {
      tab?.close()
      setActionError('Could not generate a preview. Please try again.')
    }
  }

  async function handleFinalise() {
    if (!canFinalise) return
    setBusyKey('finalise')
    setActionError('')
    try {
      await flushPendingSave()
      const { data } = await api.post(`/invoices/${invoiceId}/finalise/`)
      onFinalised(data.id, 'Invoice finalised.')
    } catch (e) {
      const errors = e.response?.data
      if (errors && typeof errors === 'object') routeErrorsToStage(errors)
      setActionError(e.response?.data?.error || 'Could not finalise this invoice.')
    } finally {
      setBusyKey(null)
    }
  }

  async function handleMarkSent() {
    if (!canFinalise) return
    setBusyKey('mark_sent')
    setActionError('')
    try {
      await flushPendingSave()
      const { data } = await api.post(`/invoices/${invoiceId}/mark-sent/`, { confirm: true, send_reminders: form.reminders_enabled })
      onFinalised(data.id, 'Marked as sent.')
    } catch (e) {
      const errors = e.response?.data
      if (errors && typeof errors === 'object') routeErrorsToStage(errors)
      setActionError(e.response?.data?.error || 'Could not mark this invoice as sent.')
    } finally {
      setBusyKey(null)
    }
  }

  const busy = busyKey !== null

  return (
    <>
      <div onClick={handleClose} style={overlayStyle} />
      <div style={panelStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 24px 0' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-primary)' }}>New Invoice</h2>
            <p style={{ margin: '2px 0 0', fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>
              {!invoiceId ? 'Not saved yet — add a client to start.' : saveState === 'saving' ? 'Saving…' : 'Draft saved'}
            </p>
          </div>
          <button onClick={handleClose} aria-label="Close" className="fos-btn fos-btn-ghost" style={{ padding: 8 }}><X size={16} /></button>
        </div>

        {/* ── Stage tabs ── */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border-subtle)', margin: '16px 0 0' }}>
          {STAGES.map((s) => (
            <button
              key={s.n}
              onClick={() => setStage(s.n)}
              disabled={!invoiceId && s.n !== 1}
              style={{
                flex: 1, padding: '10px 6px', border: 'none', background: 'transparent',
                borderBottom: `2px solid ${stage === s.n ? 'var(--accent)' : 'transparent'}`,
                cursor: (!invoiceId && s.n !== 1) ? 'not-allowed' : 'pointer',
                fontSize: '0.78rem', fontWeight: stage === s.n ? 700 : 500,
                color: stage === s.n ? 'var(--accent)' : (!invoiceId && s.n !== 1) ? 'var(--text-disabled)' : 'var(--text-secondary)',
              }}
            >
              {s.n}. {s.label}
            </button>
          ))}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px 24px' }}>
          {createError && <FosAlert type="error" onDismiss={() => setCreateError('')} style={{ marginBottom: 14 }}>{createError}</FosAlert>}
          {actionError && <FosAlert type="error" onDismiss={() => setActionError('')} style={{ marginBottom: 14 }}>{actionError}</FosAlert>}

          <InvoiceFormFields form={form} setForm={setForm} errors={saveErrors} clients={clients} stage={stage} />

          {stage === 2 && (
            <div style={{ marginTop: 14 }}>
              <button
                onClick={handlePreviewPdf}
                disabled={!invoiceId || !itemValid}
                className="fos-btn fos-btn-ghost"
                style={{ display: 'flex', alignItems: 'center', gap: 6, opacity: (!invoiceId || !itemValid) ? 0.5 : 1 }}
              >
                <Eye size={14} /> Preview PDF
              </button>
            </div>
          )}
        </div>

        {/* ── Footer: stage nav + (stage 3 only) Finalise/Mark as Sent ── */}
        <div style={{ position: 'sticky', bottom: 0, padding: '12px 24px', borderTop: '1px solid var(--border-subtle)', background: 'var(--bg-surface)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <button
              onClick={() => setStage((s) => Math.max(1, s - 1))}
              disabled={stage === 1}
              className="fos-btn fos-btn-ghost"
              style={{ display: 'flex', alignItems: 'center', gap: 6, opacity: stage === 1 ? 0.4 : 1 }}
            >
              <ArrowLeft size={14} /> Back
            </button>

            {stage < 3 ? (
              <button
                onClick={stage === 1 ? handleNextFromStage1 : () => setStage((s) => s + 1)}
                disabled={creating}
                className="fos-btn fos-btn-primary"
                style={{ display: 'flex', alignItems: 'center', gap: 6 }}
              >
                {creating ? <span className="fos-spinner" /> : <>Next <ArrowRight size={14} /></>}
              </button>
            ) : (
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={handleFinalise}
                  disabled={!canFinalise || busy}
                  className="fos-btn fos-btn-primary"
                  style={{ display: 'flex', alignItems: 'center', gap: 6, opacity: !canFinalise ? 0.5 : 1 }}
                  title={!canFinalise ? 'Add a client and at least one line item first.' : undefined}
                >
                  {busyKey === 'finalise' ? <span className="fos-spinner" /> : <CheckCircle2 size={14} />} Finalise
                </button>
                <button
                  onClick={handleMarkSent}
                  disabled={!canFinalise || busy}
                  className="fos-btn fos-btn-accent"
                  style={{ display: 'flex', alignItems: 'center', gap: 6, opacity: !canFinalise ? 0.5 : 1 }}
                  title={!canFinalise ? 'Add a client and at least one line item first.' : undefined}
                >
                  {busyKey === 'mark_sent' ? <span className="fos-spinner" /> : <Send size={14} />} Mark as Sent
                </button>
              </div>
            )}
          </div>
          {stage === 3 && !canFinalise && (
            <p style={{ margin: '8px 0 0', fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>
              {!clientValid ? 'Add a client on stage 1' : !itemValid ? 'Add at least one line item on stage 2' : ''} before finalising or marking sent.
            </p>
          )}
        </div>
      </div>
    </>
  )
}

const overlayStyle = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)', zIndex: 100 }
const panelStyle = {
  position: 'fixed', top: 'var(--header-h)', right: 0, bottom: 0, width: '100%', maxWidth: 600,
  background: 'var(--bg-surface)', boxShadow: '-8px 0 32px rgba(0,0,0,0.2)', zIndex: 101,
  overflowY: 'auto', animation: 'panel-slide-in 0.2s cubic-bezier(0.22,1,0.36,1)',
  display: 'flex', flexDirection: 'column',
}
