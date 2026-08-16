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
// Also doubles as the EDIT surface for an already-existing draft
// (`editInvoiceId` prop) — every status=draft invoice in Invoices.jsx now
// opens here, not InvoiceDetailPanel (see DECISIONS.md): a draft is still
// being built, so it belongs in the same guided flow a brand-new one
// does, pre-filled with its real saved data instead of starting blank.
//
// 3 stages:
//   1. Client (search-driven — see InvoiceFormFields.jsx's ClientSearchField)
//      + due date — the stage the threshold gets crossed on.
//   2. Line items + currency/tax/discount, with a live running total.
//   3. Notes/terms + reminders/late-fee/recurring options.
// Preview PDF (available once stage 2 has ≥1 real item) and Finalise (only
// at stage 3, with a valid client AND ≥1 item) sit together in the bottom
// action row. Mark-as-Sent does NOT live here at all — marking something
// sent before it's even finalised makes no sense; it stays exactly where
// it already was, in InvoiceDetailPanel, for already-created invoices only.
//
// Both gates are checked on every render from `form`/`invoiceId` directly,
// not "the user probably won't click Back three times then click
// Finalise" — they can, and the buttons stay disabled if they do.
//
// Once Finalise succeeds, this hands off to the normal, already-correct
// InvoiceDetailPanel (onFinalised(id)) rather than growing its own copy
// of the post-draft tabs/timeline/lifecycle-actions UI — this
// component's only job is the pre-finalised creation/editing experience.
import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, CheckCircle2, Eye, Mail, X } from 'lucide-react'

import api from '@/lib/api'
import useInvoiceAutosave from '@/hooks/useInvoiceAutosave'
import FosAlert from './FosAlert'
import InvoiceFormFields from './InvoiceFormFields'
import { blankInvoiceForm, formToPayload, invoiceToForm } from '@/pages/invoiceHelpers'

const STAGES = [{ n: 1, label: 'Client & Dates' }, { n: 2, label: 'Line Items' }, { n: 3, label: 'Options' }]

function hasValidClient(form) {
  return !!form.client || (form.client_name.trim() !== '' && form.client_email.trim() !== '')
}

function hasValidItem(form) {
  return form.items.some((it) => it.description.trim() !== '')
}

// due_date is required and must be strictly after issue_date (item 6 of
// the verification pass) — mirrors InvoiceSerializer.validate on the
// backend (apps/invoices/serializers.py) so Finalise is disabled before a
// round trip would even confirm the same thing.
function hasValidDueDate(form) {
  return !!form.due_date && (!form.issue_date || form.due_date > form.issue_date)
}

export default function NewInvoiceWizard({ editInvoiceId = null, onClose, onFinalised }) {
  const [form, setForm] = useState(editInvoiceId ? null : blankInvoiceForm())
  const [stage, setStage] = useState(1)
  const [invoiceId, setInvoiceId] = useState(editInvoiceId)
  const [loadingExisting, setLoadingExisting] = useState(!!editInvoiceId)
  const [loadError, setLoadError] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  const [busyKey, setBusyKey] = useState(null)
  const [actionError, setActionError] = useState('')
  const [duplicateClientError, setDuplicateClientError] = useState('')
  const [showFinaliseAndSend, setShowFinaliseAndSend] = useState(false)

  const { saveState, saveErrors, setSaveErrors, flushPendingSave, skipNextAutosave } = useInvoiceAutosave(invoiceId, form, true)

  // Loads an existing draft's real saved data instead of starting blank —
  // lands on stage 1 if the client isn't valid yet, stage 2 if the client
  // is set but items aren't, or stage 1 as the reasonable default once
  // everything's already filled in (nothing further to prompt for).
  useEffect(() => {
    if (!editInvoiceId) return
    let cancelled = false
    api.get(`/invoices/${editInvoiceId}/`).then(({ data }) => {
      if (cancelled) return
      const loaded = invoiceToForm(data)
      skipNextAutosave()
      setForm(loaded)
      setStage(!hasValidClient(loaded) ? 1 : !hasValidItem(loaded) ? 2 : 1)
      setLoadingExisting(false)
    }).catch(() => {
      if (!cancelled) { setLoadError('Failed to load this draft. Please try again.'); setLoadingExisting(false) }
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editInvoiceId])

  const clientValid = form ? hasValidClient(form) : false
  const itemValid = form ? hasValidItem(form) : false
  const dueDateValid = form ? hasValidDueDate(form) : false
  const canFinalise = !!invoiceId && stage === 3 && clientValid && itemValid && dueDateValid
  const canPreview = !!invoiceId && stage >= 2 && itemValid

  function routeErrorsToStage(errors) {
    if (errors.client_name || errors.client_email || errors.due_date) { setStage(1); return }
    if (errors.items || errors.currency || errors.tax_rate || errors.discount_amount || Object.keys(errors).some((k) => k.startsWith('item_'))) { setStage(2); return }
    setStage(3)
  }

  // Stage 1's own "Next" — the one real place the creation threshold is
  // crossed. If an invoiceId already exists (a loaded existing draft, or
  // the user went Back to stage 1 after creating it, then forward again),
  // this is just navigation — no second POST, autosave already covers any
  // edits made while here.
  async function handleNextFromStage1() {
    if (invoiceId) { setStage(2); return }

    if (!clientValid) {
      setCreateError('Enter a client — search for an existing one, or fill in name + email for a one-time client.')
      return
    }

    setCreating(true)
    setCreateError('')
    setDuplicateClientError('')
    try {
      let payload = formToPayload(form)

      // "Save this as a new client" — creates the real Client record
      // FIRST, so the invoice's own `client` FK can point to it from the
      // moment it's created, rather than a follow-up PUT. A duplicate-
      // email rejection here stops before the invoice is created at all —
      // staying on stage 1 with a real error, never a silently-created
      // second Client record.
      if (form.save_as_new_client && !form.client) {
        try {
          const { data: newClient } = await api.post('/clients/', {
            name: form.client_name, email: form.client_email,
            company: form.client_company, address: form.client_address, phone: form.client_phone,
            default_currency: form.currency, default_payment_terms: 30,
          })
          payload = { ...payload, client: newClient.id }
        } catch (e) {
          const body = e.response?.data
          setDuplicateClientError(body?.email?.[0] || body?.error || 'Could not save this client. Please try again.')
          setCreating(false)
          return
        }
      }

      const { data } = await api.post('/invoices/', payload)
      setInvoiceId(data.id)
      if (payload.client) setForm((f) => ({ ...f, client: payload.client }))
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
    // navigated it. Fixed by skipping the blob step entirely — the tab
    // navigates directly to the real, authenticated GET endpoint (a
    // normal top-level navigation, so the httpOnly auth cookie rides
    // along on same-site). Opened synchronously, before any await, so
    // it's still a direct result of the click.
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

  // Combined finalise-and-send — a real send happens in this same
  // request (apps/invoices/views.py's invoice_finalise_and_send), unlike
  // handleFinalise above which never sends anything. `sendReminders` is
  // written explicitly via a direct PUT (not through setForm +
  // flushPendingSave, which would read the pre-update `form` closure —
  // see handleSaveAsPreset's own stale-closure note in
  // InvoiceDetailPanel.jsx) so the backend's own force_reminders_off=False
  // path sees exactly the value the user just confirmed, not a stale one.
  //
  // On any error, re-fetches the invoice rather than guessing what
  // happened from the error shape: invoice_finalise_and_send runs
  // _finalise_invoice (an unconditional, already-committed DB write)
  // BEFORE attempting the send, so a send-side failure (502) still means
  // the invoice really is finalised now, just not sent — this stays in
  // the wizard for a genuine pre-finalise failure (still draft), but
  // hands off to the normal InvoiceDetailPanel (which has its own retry-
  // capable Send button) the moment the real data shows status has
  // already moved past draft.
  async function handleFinaliseAndSend(sendReminders) {
    if (!canFinalise) return
    setBusyKey('finalise_and_send')
    setActionError('')
    try {
      await flushPendingSave()
      if (sendReminders !== form.reminders_enabled) {
        await api.put(`/invoices/${invoiceId}/`, { reminders_enabled: sendReminders })
      }
      const { data } = await api.post(`/invoices/${invoiceId}/finalise-and-send/`, { confirm: true })
      setShowFinaliseAndSend(false)
      onFinalised(data.id, 'Invoice finalised and sent.')
    } catch (e) {
      // The real backend error, not a generic string — includes which
      // delivery path(s) failed and makes clear nothing was sent (see
      // _send_invoice_now's own error copy, apps/invoices/views.py).
      const backendError = e.response?.data?.error || 'Could not finalise and send this invoice. It has not been sent.'
      try {
        const { data: current } = await api.get(`/invoices/${invoiceId}/`)
        if (current.status !== 'draft') {
          setShowFinaliseAndSend(false)
          onFinalised(current.id, { type: 'warning', text: `Invoice finalised, but sending failed: ${backendError}` })
          return
        }
      } catch { /* fall through to the normal in-wizard error below */ }
      const errors = e.response?.data
      if (errors && typeof errors === 'object' && !errors.error) routeErrorsToStage(errors)
      setActionError(backendError)
    } finally {
      setBusyKey(null)
    }
  }

  const busy = busyKey !== null

  if (loadingExisting) {
    return (
      <>
        <div style={overlayStyle} />
        <div style={panelStyle}><div style={{ padding: '20px 24px' }}><WizardSkeleton /></div></div>
      </>
    )
  }

  if (loadError || !form) {
    return (
      <>
        <div onClick={() => onClose(null)} style={overlayStyle} />
        <div style={panelStyle}>
          <div style={{ padding: '20px 24px' }}>
            <button onClick={() => onClose(null)} aria-label="Close" className="fos-btn fos-btn-ghost" style={{ padding: 8, marginBottom: 12 }}><X size={16} /></button>
            <FosAlert type="error">{loadError || 'Something went wrong.'}</FosAlert>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <div onClick={handleClose} style={overlayStyle} />
      <div style={panelStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 24px 0' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              {editInvoiceId ? 'Edit Draft' : 'New Invoice'}
            </h2>
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

          <InvoiceFormFields
            form={form} setForm={setForm} errors={saveErrors} stage={stage}
            allowSaveAsNewClient={!invoiceId}
            duplicateClientError={duplicateClientError}
            onDismissDuplicateClientError={() => setDuplicateClientError('')}
          />
        </div>

        {/* ── Footer: stage nav + Preview PDF (stage 2+) + Finalise (stage 3) ── */}
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

            <div style={{ display: 'flex', gap: 8 }}>
              {stage >= 2 && (
                <button
                  onClick={handlePreviewPdf}
                  disabled={!canPreview}
                  className="fos-btn fos-btn-ghost"
                  style={{ display: 'flex', alignItems: 'center', gap: 6, opacity: !canPreview ? 0.5 : 1 }}
                  title={!canPreview ? 'Add at least one line item first.' : undefined}
                >
                  <Eye size={14} /> Preview PDF
                </button>
              )}
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
                <button
                  onClick={handleFinalise}
                  disabled={!canFinalise || busy}
                  className="fos-btn fos-btn-primary"
                  style={{ display: 'flex', alignItems: 'center', gap: 6, opacity: !canFinalise ? 0.5 : 1 }}
                  title={!canFinalise ? 'Add a client, a valid due date, and at least one line item first.' : undefined}
                >
                  {busyKey === 'finalise' ? <span className="fos-spinner" /> : <CheckCircle2 size={14} />} Finalise
                </button>
              )}
              {stage === 3 && (
                <button
                  onClick={() => setShowFinaliseAndSend(true)}
                  disabled={!canFinalise || busy}
                  className="fos-btn fos-btn-accent"
                  style={{ display: 'flex', alignItems: 'center', gap: 6, opacity: !canFinalise ? 0.5 : 1 }}
                  title={!canFinalise ? 'Add a client, a valid due date, and at least one line item first.' : undefined}
                >
                  {busyKey === 'finalise_and_send' ? <span className="fos-spinner" /> : <Mail size={14} />} Finalise & Send
                </button>
              )}
            </div>
          </div>
          {stage === 3 && !canFinalise && (
            <p style={{ margin: '8px 0 0', fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>
              {!clientValid ? 'Add a client on stage 1' : !dueDateValid ? 'Add a valid due date on stage 1' : !itemValid ? 'Add at least one line item on stage 2' : ''} before finalising.
            </p>
          )}
        </div>
      </div>

      {showFinaliseAndSend && (
        <FinaliseAndSendModal
          invoice={form}
          busy={busyKey === 'finalise_and_send'}
          onConfirm={handleFinaliseAndSend}
          onClose={() => setShowFinaliseAndSend(false)}
        />
      )}
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

// Same confirm-step shape as InvoiceDetailPanel's own MarkSentModal/
// SendModal (not imported from there — neither is exported, and this
// component's local needs are simple enough not to warrant it), but
// combining both real actions into one: it explains a real email goes
// out AND lets the user set reminders_enabled right here before that
// happens, defaulting to the invoice's own current toggle value so
// re-confirming something they already set on stage 3 isn't required.
function FinaliseAndSendModal({ invoice, busy, onConfirm, onClose }) {
  const [sendReminders, setSendReminders] = useState(!!invoice.reminders_enabled)
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: 'var(--bg-surface)', borderRadius: 'var(--radius-xl)', boxShadow: '0 8px 40px rgba(0,0,0,0.25)', padding: '24px 28px', width: '100%', maxWidth: 420, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <h3 style={{ margin: 0, fontSize: '1.02rem', fontWeight: 700, color: 'var(--text-primary)' }}>Finalise & Send</h3>
          <button onClick={onClose} aria-label="Close" className="fos-btn fos-btn-ghost" style={{ padding: 6 }}><X size={16} /></button>
        </div>
        <p style={{ margin: '0 0 14px', fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          This finalises the invoice (assigns its number, freezes the PDF) and immediately emails{' '}
          <strong>{invoice.client_name || 'the client'}</strong> at <strong>{invoice.client_email}</strong> through
          LanceraOS in one step. You're cc'd on the email.
        </p>
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', padding: '10px 12px', background: 'var(--bg-surface-2)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', marginBottom: 20 }}>
          <input type="checkbox" checked={sendReminders} onChange={(e) => setSendReminders(e.target.checked)} style={{ marginTop: 3, accentColor: 'var(--accent)', width: 14, height: 14 }} />
          <div>
            <p style={{ margin: 0, fontSize: '0.82rem', fontWeight: 500, color: 'var(--text-primary)' }}>Enable reminders</p>
            <p style={{ margin: '2px 0 0', fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>Starts the escalating reminder schedule once overdue.</p>
          </div>
        </label>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button className="fos-btn fos-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="fos-btn fos-btn-accent" onClick={() => onConfirm(sendReminders)} disabled={busy}>
            {busy ? <span className="fos-spinner" /> : <Mail size={14} />} Finalise & Send
          </button>
        </div>
      </div>
    </div>
  )
}

function WizardSkeleton() {
  return (
    <div>
      <div style={{ width: '40%', height: 22, background: 'var(--bg-surface-3)', borderRadius: 'var(--radius-sm)', animation: 'skeleton-pulse 1.4s ease-in-out infinite', marginBottom: 16 }} />
      {[1, 2, 3].map((i) => (
        <div key={i} style={{ height: 44, background: 'var(--bg-surface-3)', borderRadius: 'var(--radius-md)', animation: 'skeleton-pulse 1.4s ease-in-out infinite', marginBottom: 10 }} />
      ))}
    </div>
  )
}
