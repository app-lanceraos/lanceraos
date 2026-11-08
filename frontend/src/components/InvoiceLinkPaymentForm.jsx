// src/components/InvoiceLinkPaymentForm.jsx
//
// "Use a Payment I Already Recorded" — the third choice of InvoiceDetailPanel's Add Payment popup (Prompt 11, Part 5).
// This is what stops the same money being counted twice (typed on the Payments page AND recorded on the invoice).
// It renders only the INSIDE of a modal: InvoiceDetailPanel wraps it in its own ModalShell (it cannot be imported here).
//
// The candidates come from GET /payments/?match=unmatched and ?match=partial (two requests, same currency, 20 each,
// newest first, optionally narrowed by a search) and are then filtered and ranked by the SAME rule the server enforces:
// same currency, something left, dated on or after the invoice's issue date (eligibleForInvoice / rankForInvoice).
// A payment whose remaining balance equals what the invoice still owes is listed first and tagged "Exact match".
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Link2, Search } from 'lucide-react'

import api from '@/lib/api'
import FormField from './FormField'
import FosAlert from './FosAlert'
import { STATUS_BADGE_STYLE, badgeBaseStyle } from '@/pages/clientHelpers'
import { formatIsoDate } from '@/pages/dashboardHelpers'
import {
  defaultLinkAmount, errorMessage, formatExact, isExactForInvoice, rankForInvoice, sourceLabel, validateLinkAmount,
} from '@/pages/paymentsHelpers'

export default function InvoiceLinkPaymentForm({ invoice, busy, onBack, onConfirm }) {
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [payments, setPayments] = useState(null) // null while loading
  const [loadError, setLoadError] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [amount, setAmount] = useState('')
  const [amountError, setAmountError] = useState('')
  const latest = useRef(0)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 300)
    return () => clearTimeout(timer)
  }, [search])

  async function load(term) {
    const requestId = ++latest.current
    setLoadError('')
    const base = { currency: invoice.currency, limit: 20, sort: 'recent', ...(term ? { search: term } : {}) }
    try {
      const [unlinked, partial] = await Promise.all([
        api.get('/payments/', { params: { ...base, match: 'unmatched' } }),
        api.get('/payments/', { params: { ...base, match: 'partial' } }),
      ])
      if (requestId !== latest.current) return
      const ranked = rankForInvoice([...(unlinked.data.results || []), ...(partial.data.results || [])], invoice)
      setPayments(ranked)
      setSelectedId((current) => (ranked.some((p) => p.id === current) ? current : null))
    } catch (error) {
      if (requestId !== latest.current) return
      setPayments((current) => current || [])
      setLoadError(errorMessage(error, 'Could not load your payments. Please try again.'))
    }
  }

  useEffect(() => { load(debounced) }, [debounced]) // eslint-disable-line react-hooks/exhaustive-deps

  const selected = (payments || []).find((p) => p.id === selectedId) || null

  function choose(payment) {
    setSelectedId(payment.id)
    setAmount(defaultLinkAmount(payment.remaining_amount, invoice.outstanding_amount))
    setAmountError('')
  }

  function submit(event) {
    event.preventDefault()
    if (!selected || busy) return
    const result = validateLinkAmount(amount, selected.remaining_amount, invoice.outstanding_amount, invoice.currency)
    if (!result.ok) { setAmountError(result.error); return }
    onConfirm(selected.id, result.value)
  }

  return (
    <form onSubmit={submit} noValidate>
      <p style={{ margin: '0 0 12px', fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
        Pick a payment you already recorded in {invoice.currency}. Outstanding on this invoice: <strong>{formatExact(invoice.outstanding_amount, invoice.currency)}</strong>.
      </p>
      <div style={{ position: 'relative', marginBottom: 10 }}>
        <Search size={15} aria-hidden="true" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)', pointerEvents: 'none' }} />
        <input type="text" className="fos-input" style={{ paddingLeft: 36 }} placeholder="Search by who paid or notes…" aria-label="Search payments" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {loadError && (
        <FosAlert type="error" style={{ marginBottom: 10 }}>
          {loadError} <button type="button" className="fos-btn fos-btn-ghost" style={{ marginLeft: 8 }} onClick={() => load(debounced)}>Retry</button>
        </FosAlert>
      )}

      {payments === null ? (
        <div style={{ height: 120, background: 'var(--bg-surface-3)', borderRadius: 'var(--radius-md)', animation: 'skeleton-pulse 1.4s ease-in-out infinite' }} />
      ) : payments.length === 0 && !loadError ? (
        <p style={{ margin: '12px 0', fontSize: '0.84rem', color: 'var(--text-tertiary)', textAlign: 'center', lineHeight: 1.5 }}>
          {debounced
            ? 'No unlinked payments match your search.'
            : <>No unlinked payments in {invoice.currency}. Record one on the <Link to="/payments" style={{ color: 'var(--accent)' }}>Payments page</Link> first.</>}
        </p>
      ) : (
        <div role="radiogroup" aria-label="Payments you can use" style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 260, overflowY: 'auto' }}>
          {payments.map((payment) => {
            const checked = payment.id === selectedId
            const exact = isExactForInvoice(payment, invoice)
            return (
              <label
                key={payment.id}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', cursor: 'pointer',
                  background: checked ? 'var(--accent-glow)' : 'var(--bg-surface-2)',
                  border: `1.5px solid ${checked ? 'var(--accent)' : 'var(--border-subtle)'}`, borderRadius: 'var(--radius-md)',
                }}
              >
                <input type="radio" name="existing-payment" checked={checked} onChange={() => choose(payment)} style={{ marginTop: 3, accentColor: 'var(--accent)' }} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: '0.86rem', color: 'var(--text-primary)' }}>{formatIsoDate(payment.payment_date)}</strong>
                    {exact && <span style={{ ...badgeBaseStyle, ...STATUS_BADGE_STYLE.green }}>Exact match</span>}
                  </span>
                  <span style={{ display: 'block', fontSize: '0.76rem', color: 'var(--text-tertiary)', marginTop: 2, overflowWrap: 'anywhere' }}>
                    {payment.counterparty || 'No name'} · {sourceLabel(payment.source)}
                  </span>
                </span>
                <span style={{ textAlign: 'right', flexShrink: 0 }}>
                  <span style={{ display: 'block', fontSize: '0.86rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary)' }}>{formatExact(payment.remaining_amount, payment.currency)}</span>
                  <span style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)' }}>left to use</span>
                </span>
              </label>
            )
          })}
        </div>
      )}

      {selected && (
        <div style={{ marginTop: 14 }}>
          <FormField label={`Amount to apply (${invoice.currency})`} type="number" value={amount} onChange={(e) => { setAmount(e.target.value); setAmountError('') }} error={amountError} />
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 20 }}>
        <button type="button" className="fos-btn fos-btn-ghost" onClick={onBack} disabled={busy}>Back</button>
        <button type="submit" className="fos-btn fos-btn-accent" disabled={busy || !selected}>
          {busy ? <span className="fos-spinner" /> : <Link2 size={14} />} Link payment
        </button>
      </div>
    </form>
  )
}
