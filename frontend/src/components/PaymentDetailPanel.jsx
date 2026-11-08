// src/components/PaymentDetailPanel.jsx
//
// Slide-in side panel for ONE payment (DESIGN.md Section 7 recipe: overlay 100, panel 101, `panel-slide-in`, max width
// 480). On open it fetches GET /payments/<id>/ with its own request-id guard; a 404 says the payment no longer exists and
// asks the page to reload. Escape closes the panel only when no dialog is open (a dialog owns Escape while it is up).
// Focus moves to the close button on open and goes back to whatever opened the panel on close — no focus trap, the
// page behind stays reachable by design like the other side panels.
//
// Actions, each gated by one rule from paymentsHelpers (so a test pins them):
//   Edit          always (a linked payment can still change "Received from" and notes)
//   Link          only when something is left over to link
//   Unlink        one button per invoice, only when the payment's origin is not "invoice", behind a confirmation that
//                 sends {confirm: true}
//   Delete        only when deleteBlockReason() is null; otherwise the reason is shown as text where the button would be
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Link2, Pencil, Trash2, Unlink, X } from 'lucide-react'

import api from '@/lib/api'
import useTimedMessage from '@/hooks/useTimedMessage'
import FosAlert from './FosAlert'
import { LinkBadge, SourceBadge } from './PaymentTable'
import { PaymentDialog, PaymentDialogButtons, paymentDialogText } from './PaymentDialog'
import PaymentFormModal from './PaymentFormModal'
import PaymentLinkModal from './PaymentLinkModal'
import { STATUS_BADGE_STYLE, badgeBaseStyle } from '@/pages/clientHelpers'
import { formatIsoDate } from '@/pages/dashboardHelpers'
import {
  canLink, canUnlink, createdOn, deleteBlockReason, errorMessage, formatExact, originLabel, progressLine, rateNote,
} from '@/pages/paymentsHelpers'

const labelStyle = { margin: 0, fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }
const valueStyle = { margin: '2px 0 0', fontSize: '0.88rem', color: 'var(--text-primary)', overflowWrap: 'anywhere' }

export default function PaymentDetailPanel({ paymentId, currencies, onClose, onChanged }) {
  const [payment, setPayment] = useState(null)
  const [loading, setLoading] = useState(true)
  const [missing, setMissing] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [dialog, setDialog] = useState(null) // null | 'edit' | 'link' | {kind:'unlink', allocation} | 'delete'
  const [busy, setBusy] = useState(false)
  const [dialogError, setDialogError] = useState('')
  const { message, show, clear } = useTimedMessage()
  const closeRef = useRef(null)
  const latest = useRef(0)
  const dialogOpen = dialog !== null

  async function load() {
    const requestId = ++latest.current
    setLoading(true)
    setLoadError('')
    try {
      const { data } = await api.get(`/payments/${paymentId}/`)
      if (requestId !== latest.current) return
      setPayment(data)
      setMissing(false)
    } catch (error) {
      if (requestId !== latest.current) return
      if (error.response?.status === 404) { setMissing(true); onChanged() } else setLoadError(errorMessage(error, 'Could not load this payment. Please try again.'))
    } finally {
      if (requestId === latest.current) setLoading(false)
    }
  }

  useEffect(() => { setPayment(null); load() }, [paymentId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Focus in on open, back to the opener on close.
  useEffect(() => {
    const opener = document.activeElement
    closeRef.current?.focus()
    return () => {
      if (opener && opener !== document.body && document.contains(opener) && typeof opener.focus === 'function') opener.focus()
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (event) => { if (event.key === 'Escape' && !dialogOpen) onClose() }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [dialogOpen, onClose])

  function closeDialog() { setDialog(null); setDialogError('') }

  function applyUpdated(next, text) {
    setPayment(next)
    closeDialog()
    show('success', text)
    onChanged()
  }

  async function confirmUnlink(allocation) {
    setBusy(true)
    setDialogError('')
    try {
      const { data } = await api.delete(`/payments/${payment.id}/link-invoice/${allocation.allocation_id}/`, { data: { confirm: true } })
      applyUpdated(data.payment, `Unlinked from ${allocation.invoice_number}`)
    } catch (error) {
      setDialogError(errorMessage(error, 'Could not unlink this payment. Please try again.'))
    } finally {
      setBusy(false)
    }
  }

  async function confirmDelete() {
    setBusy(true)
    setDialogError('')
    try {
      await api.delete(`/payments/${payment.id}/`)
      onChanged('Payment deleted.')
      onClose()
    } catch (error) {
      setDialogError(errorMessage(error, 'Could not delete this payment. Please try again.'))
      setBusy(false)
    }
  }

  const blockReason = payment ? deleteBlockReason(payment) : null
  const note = payment ? rateNote(payment.rate_basis) : null

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)', zIndex: 100 }} />
      <div
        role="dialog" aria-label="Payment details"
        style={{
          position: 'fixed', top: 'var(--header-h)', right: 0, bottom: 0, width: '100%', maxWidth: 480,
          background: 'var(--bg-surface)', boxShadow: '-8px 0 32px rgba(0,0,0,0.2)', zIndex: 101,
          overflowY: 'auto', animation: 'panel-slide-in 0.2s cubic-bezier(0.22,1,0.36,1)',
        }}
      >
        <div style={{ padding: '20px 24px 32px' }}>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close" className="fos-btn fos-btn-ghost" style={{ padding: 8, marginBottom: 12 }}>
            <X size={16} />
          </button>

          {loading && !payment && <PanelSkeleton />}

          {missing && (
            <div>
              <FosAlert type="error">This payment no longer exists.</FosAlert>
              <button type="button" className="fos-btn fos-btn-ghost" style={{ marginTop: 12 }} onClick={onClose}>Close</button>
            </div>
          )}

          {loadError && !payment && (
            <div>
              <FosAlert type="error">{loadError}</FosAlert>
              <button type="button" className="fos-btn fos-btn-ghost" style={{ marginTop: 12 }} onClick={load}>Retry</button>
            </div>
          )}

          {payment && !missing && (
            <>
              {message && <FosAlert type={message.type} onDismiss={clear} style={{ marginBottom: 14 }}>{message.text}</FosAlert>}

              <div style={{ marginBottom: 18 }}>
                <p style={{ margin: 0, fontSize: '1.6rem', fontWeight: 800, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>
                  {formatExact(payment.amount, payment.currency)}
                </p>
                <p style={{ margin: '4px 0 10px', fontSize: '0.84rem', color: 'var(--text-tertiary)' }}>{formatIsoDate(payment.payment_date)}</p>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <SourceBadge source={payment.source} />
                  <span style={{ ...badgeBaseStyle, ...STATUS_BADGE_STYLE.blue }}>{originLabel(payment.origin)}</span>
                  <LinkBadge payment={payment} />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 16px', marginBottom: 18 }}>
                <div style={{ gridColumn: '1 / -1' }}>
                  <p style={labelStyle}>Received from</p>
                  <p style={valueStyle}>{payment.counterparty || '—'}</p>
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <p style={labelStyle}>Notes</p>
                  <p style={valueStyle}>{payment.notes || '—'}</p>
                </div>
                <div>
                  <p style={labelStyle}>Added</p>
                  <p style={valueStyle}>{createdOn(payment)}</p>
                </div>
              </div>

              {note && <FosAlert type={payment.rate_basis === 'nearby' ? 'info' : 'warning'} style={{ marginBottom: 18 }}>{note}</FosAlert>}

              <section aria-labelledby="pay-panel-invoices" style={{ marginBottom: 22 }}>
                <h3 id="pay-panel-invoices" style={{ margin: '0 0 8px', fontSize: '0.92rem', fontWeight: 700, color: 'var(--text-primary)' }}>Paying these invoices</h3>
                <p style={{ margin: '0 0 10px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  {progressLine(payment)}. Left over: <strong>{formatExact(payment.remaining_amount, payment.currency)}</strong>
                </p>
                {(payment.invoices || []).length === 0 ? (
                  <p style={{ margin: 0, fontSize: '0.84rem', color: 'var(--text-tertiary)' }}>Not linked to any invoice.</p>
                ) : (
                  <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {payment.invoices.map((row) => (
                      <li key={row.allocation_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'var(--bg-surface-2)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <Link to={`/invoices?invoice=${row.invoice_id}`} style={{ fontWeight: 700, fontSize: '0.86rem', color: 'var(--accent)' }}>{row.invoice_number}</Link>
                          <div style={{ fontSize: '0.74rem', color: 'var(--text-tertiary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.client_name || 'No client name'}</div>
                        </div>
                        <span style={{ fontSize: '0.86rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary)' }}>{formatExact(row.amount, payment.currency)}</span>
                        {canUnlink(payment) && (
                          <button type="button" className="fos-btn fos-btn-ghost" style={{ fontSize: '0.76rem', padding: '5px 10px' }} onClick={() => setDialog({ kind: 'unlink', allocation: row })}>
                            <Unlink size={13} aria-hidden="true" /> Unlink
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <button type="button" className="fos-btn fos-btn-ghost" onClick={() => setDialog('edit')}><Pencil size={14} aria-hidden="true" /> Edit</button>
                {canLink(payment) && (
                  <button type="button" className="fos-btn fos-btn-accent" onClick={() => setDialog('link')}><Link2 size={14} aria-hidden="true" /> Link to invoice</button>
                )}
                {blockReason === null && (
                  <button type="button" className="fos-btn fos-btn-danger" onClick={() => setDialog('delete')}><Trash2 size={14} aria-hidden="true" /> Delete</button>
                )}
              </div>
              {blockReason !== null && (
                <p style={{ margin: '12px 0 0', fontSize: '0.78rem', color: 'var(--text-tertiary)', lineHeight: 1.5 }}>{blockReason}</p>
              )}
            </>
          )}
        </div>
      </div>

      {dialog === 'edit' && payment && (
        <PaymentFormModal
          payment={payment} currencies={currencies}
          onSaved={(next) => applyUpdated(next, 'Payment updated.')}
          onClose={closeDialog}
        />
      )}
      {dialog === 'link' && payment && (
        <PaymentLinkModal payment={payment} onLinked={(next, number) => applyUpdated(next, `Linked to ${number}`)} onClose={closeDialog} />
      )}
      {dialog?.kind === 'unlink' && payment && (
        <PaymentDialog title={`Unlink from ${dialog.allocation.invoice_number}?`} busy={busy} onClose={closeDialog}>
          <p style={paymentDialogText}>
            This takes {formatExact(dialog.allocation.amount, payment.currency)} off {dialog.allocation.invoice_number}, which goes back to owing it.
            The payment stays in your list and the money is free to link again.
          </p>
          {dialogError && <FosAlert type="error">{dialogError}</FosAlert>}
          <PaymentDialogButtons
            busy={busy} onClose={closeDialog}
            confirm={(
              <button type="button" className="fos-btn fos-btn-danger" disabled={busy} onClick={() => confirmUnlink(dialog.allocation)}>
                {busy ? <span className="fos-spinner" /> : <Unlink size={14} />} Unlink
              </button>
            )}
          />
        </PaymentDialog>
      )}
      {dialog === 'delete' && payment && (
        <PaymentDialog title="Delete this payment?" busy={busy} onClose={closeDialog}>
          <p style={paymentDialogText}>
            This removes the payment of {formatExact(payment.amount, payment.currency)} from {formatIsoDate(payment.payment_date)} from your records. It cannot be undone.
          </p>
          {dialogError && <FosAlert type="error">{dialogError}</FosAlert>}
          <PaymentDialogButtons
            busy={busy} onClose={closeDialog}
            confirm={(
              <button type="button" className="fos-btn fos-btn-danger" disabled={busy} onClick={confirmDelete}>
                {busy ? <span className="fos-spinner" /> : <Trash2 size={14} />} Delete payment
              </button>
            )}
          />
        </PaymentDialog>
      )}
    </>
  )
}

function PanelSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading payment">
      {[120, 28, 70, 70, 140].map((h, i) => (
        <div key={i} style={{ height: h, marginBottom: 14, background: 'var(--bg-surface-3)', borderRadius: 'var(--radius-md)', animation: 'skeleton-pulse 1.4s ease-in-out infinite' }} />
      ))}
    </div>
  )
}
