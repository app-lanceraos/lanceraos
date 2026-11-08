// src/components/PaymentLinkModal.jsx
//
// "Link to invoice", opened from a payment's side panel (Prompt 11, F8). Candidates come from the server
// (GET /payments/<id>/link-candidates/): only open invoices in the payment's own currency, issued on or before its date,
// at most 20, the best match first. A visible line says so — the server cannot link across currencies and the dialog does
// not pretend otherwise. Choosing a row fills the amount with the smaller of "what is left of the payment" and "what
// the invoice still owes" (computed in cents); the person can change it, and anything above either limit is refused
// before a request is sent.
import { useEffect, useRef, useState } from 'react'
import { Link2, Search } from 'lucide-react'

import api from '@/lib/api'
import FormField from './FormField'
import FosAlert from './FosAlert'
import InvoiceStatusBadge from './InvoiceStatusBadge'
import { PaymentDialog, PaymentDialogButtons, paymentDialogText } from './PaymentDialog'
import { STATUS_BADGE_STYLE, badgeBaseStyle } from '@/pages/clientHelpers'
import { formatIsoDate } from '@/pages/dashboardHelpers'
import { INVOICE_STATUS_META } from '@/pages/invoiceHelpers'
import { defaultLinkAmount, errorMessage, formatExact, isExactMatch, validateLinkAmount } from '@/pages/paymentsHelpers'

export default function PaymentLinkModal({ payment, onLinked, onClose }) {
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [candidates, setCandidates] = useState(null) // null while loading
  const [loadError, setLoadError] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [amount, setAmount] = useState('')
  const [amountError, setAmountError] = useState('')
  const [submitError, setSubmitError] = useState('')
  const [busy, setBusy] = useState(false)
  const latest = useRef(0)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 300)
    return () => clearTimeout(timer)
  }, [search])

  async function load(term) {
    const requestId = ++latest.current
    setLoadError('')
    try {
      const { data } = await api.get(`/payments/${payment.id}/link-candidates/`, { params: term ? { search: term } : {} })
      if (requestId !== latest.current) return
      const results = data.results || []
      setCandidates(results)
      setSelectedId((current) => (results.some((c) => c.id === current) ? current : null))
    } catch (error) {
      if (requestId !== latest.current) return
      setCandidates((current) => current || [])
      setLoadError(errorMessage(error, 'Could not load your invoices. Please try again.'))
    }
  }

  useEffect(() => { load(debounced) }, [debounced]) // eslint-disable-line react-hooks/exhaustive-deps

  const selected = (candidates || []).find((c) => c.id === selectedId) || null

  function choose(candidate) {
    setSelectedId(candidate.id)
    setAmount(defaultLinkAmount(payment.remaining_amount, candidate.outstanding_amount))
    setAmountError('')
    setSubmitError('')
  }

  async function submit(event) {
    event.preventDefault()
    if (!selected || busy) return
    const result = validateLinkAmount(amount, payment.remaining_amount, selected.outstanding_amount, payment.currency)
    if (!result.ok) { setAmountError(result.error); return }
    setBusy(true)
    setSubmitError('')
    try {
      const { data } = await api.post(`/payments/${payment.id}/link-invoice/`, { invoice_id: selected.id, amount: result.value })
      onLinked(data.payment, selected.invoice_number)
    } catch (error) {
      setSubmitError(errorMessage(error, 'Could not link this payment. Please try again.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <PaymentDialog title="Link to invoice" busy={busy} onClose={onClose} maxWidth={540}>
      <form onSubmit={submit} noValidate>
        <p style={{ ...paymentDialogText, marginBottom: 8 }}>
          Only open invoices in {payment.currency} issued on or before {formatIsoDate(payment.payment_date)} are listed.
          Left to link from this payment: <strong>{formatExact(payment.remaining_amount, payment.currency)}</strong>.
        </p>
        <div style={{ position: 'relative', marginBottom: 10 }}>
          <Search size={15} aria-hidden="true" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)', pointerEvents: 'none' }} />
          <input type="text" className="fos-input" style={{ paddingLeft: 36 }} placeholder="Search by invoice number or client…" aria-label="Search invoices" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {loadError && (
          <FosAlert type="error" style={{ marginBottom: 10 }}>
            {loadError} <button type="button" className="fos-btn fos-btn-ghost" style={{ marginLeft: 8 }} onClick={() => load(debounced)}>Retry</button>
          </FosAlert>
        )}
        {candidates === null ? (
          <div style={{ height: 120, background: 'var(--bg-surface-3)', borderRadius: 'var(--radius-md)', animation: 'skeleton-pulse 1.4s ease-in-out infinite' }} />
        ) : candidates.length === 0 && !loadError ? (
          <p style={{ margin: '12px 0', fontSize: '0.84rem', color: 'var(--text-tertiary)', textAlign: 'center' }}>
            {debounced ? 'No open invoices match your search.' : `No open invoices in ${payment.currency} to link this payment to.`}
          </p>
        ) : (
          <div role="radiogroup" aria-label="Invoices this payment can be linked to" style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 280, overflowY: 'auto' }}>
            {candidates.map((candidate) => {
              const checked = candidate.id === selectedId
              const meta = INVOICE_STATUS_META[candidate.status]
              return (
                <label
                  key={candidate.id}
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', cursor: 'pointer',
                    background: checked ? 'var(--accent-glow)' : 'var(--bg-surface-2)',
                    border: `1.5px solid ${checked ? 'var(--accent)' : 'var(--border-subtle)'}`, borderRadius: 'var(--radius-md)',
                  }}
                >
                  <input type="radio" name="link-invoice" checked={checked} onChange={() => choose(candidate)} style={{ marginTop: 3, accentColor: 'var(--accent)' }} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: '0.86rem', color: 'var(--text-primary)' }}>{candidate.invoice_number}</strong>
                      {meta && <InvoiceStatusBadge meta={meta} />}
                      {isExactMatch(candidate, payment.remaining_amount) && (
                        <span style={{ ...badgeBaseStyle, ...STATUS_BADGE_STYLE.green }}>Exact match</span>
                      )}
                    </span>
                    <span style={{ display: 'block', fontSize: '0.76rem', color: 'var(--text-tertiary)', marginTop: 2 }}>
                      {candidate.client_name || 'No client name'} · Due {formatIsoDate(candidate.due_date)}
                    </span>
                  </span>
                  <span style={{ textAlign: 'right', flexShrink: 0 }}>
                    <span style={{ display: 'block', fontSize: '0.86rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary)' }}>{formatExact(candidate.outstanding_amount, candidate.currency)}</span>
                    <span style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)' }}>still owed</span>
                  </span>
                </label>
              )
            })}
          </div>
        )}

        {selected && (
          <div style={{ marginTop: 14 }}>
            <FormField label={`Amount to link (${payment.currency})`} type="number" value={amount} onChange={(e) => { setAmount(e.target.value); setAmountError('') }} error={amountError} />
          </div>
        )}
        {submitError && <FosAlert type="error" style={{ marginTop: 12 }}>{submitError}</FosAlert>}

        <PaymentDialogButtons
          busy={busy} onClose={onClose}
          confirm={(
            <button type="submit" className="fos-btn fos-btn-accent" disabled={busy || !selected}>
              {busy ? <span className="fos-spinner" /> : <Link2 size={14} />} Link payment
            </button>
          )}
        />
      </form>
    </PaymentDialog>
  )
}
