// src/pages/portal/ClientPortal.jsx
//
// /portal — the client's own invoice LIST. A real React page (a list/
// dashboard genuinely is UI), unlike the individual invoice VIEW below,
// which is deliberately NOT a React component.
//
// Portal-session-authenticated via the httpOnly lanceraos_portal_session
// cookie (apps.clients.cookies) — GET /api/invoices/portal/me/ 401s with
// no valid session, handled here directly (never the global axios
// refresh-and-redirect-to-/login interceptor, which src/lib/api.js's
// SKIP_REFRESH_URLS now explicitly excludes /invoices/portal/ from).
import { useEffect, useState } from 'react'
import { CheckCircle2, LogOut, MessageCircle, Receipt, UserCheck, X } from 'lucide-react'

import api from '@/lib/api'
import useTitle from '@/hooks/useTitle'
import CommentThread from '@/components/CommentThread'
import FormField from '@/components/FormField'
import FormSelect from '@/components/FormSelect'
import FosAlert from '@/components/FosAlert'
import { PAYMENT_SOURCE_OPTIONS, formatMoney } from '@/pages/invoiceHelpers'
import PortalLayout from './PortalLayout'
import PortalRequestLinkForm from './PortalRequestLinkForm'

const STATUS_LABELS = {
  draft: 'Draft', created: 'Finalised', sent: 'Sent', viewed: 'Viewed',
  partially_paid: 'Partially Paid', paid: 'Paid',
  cancelled: 'Cancelled', refunded: 'Refunded', bad_debt: 'Bad Debt',
}

// PortalInvoiceListSerializer deliberately never exposes the raw
// view_token as its own field (Step 12 — only pre-built URLs are
// exposed to the client side, never the credential itself). The
// comment thread's WebSocket route needs that token, so it's parsed
// back out of the one URL that already legitimately contains it
// (.../portal/view/<token>/) rather than adding a second field whose
// only purpose would be handing the token to JS directly.
function viewTokenFromPortalUrl(url) {
  if (!url) return null
  const segments = url.split('/').filter(Boolean)
  return segments[segments.length - 1] || null
}

export default function ClientPortal() {
  useTitle('Your Invoices — LanceraOS')
  const [invoices, setInvoices] = useState(null)
  const [needsLink, setNeedsLink] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [messagesInvoice, setMessagesInvoice] = useState(null)
  const [claimInvoice, setClaimInvoice] = useState(null)
  const [ackInvoice, setAckInvoice] = useState(null)

  function handleAcknowledged(invoiceId, acknowledgedAt) {
    setInvoices((prev) => prev.map((inv) => (
      inv.id === invoiceId ? { ...inv, client_acknowledged: true, client_acknowledged_at: acknowledgedAt } : inv
    )))
    setAckInvoice(null)
  }

  useEffect(() => { load() }, [])

  function load() {
    setLoadError(false)
    api.get('/invoices/portal/me/')
      .then(({ data }) => { setInvoices(data); setNeedsLink(false) })
      .catch((e) => {
        if (e.response?.status === 401) setNeedsLink(true)
        else setLoadError(true)
      })
  }

  async function handleLogout(everywhere) {
    setLoggingOut(true)
    try {
      await api.post(`/clients/portal/${everywhere ? 'logout-everywhere' : 'logout'}/`)
    } catch {
      // Already logged out (or the request itself failed) either way —
      // the local view below doesn't depend on this call having
      // succeeded, it just re-checks the session next.
    } finally {
      setLoggingOut(false)
      setInvoices(null)
      setNeedsLink(true)
    }
  }

  if (needsLink) {
    return (
      <PortalLayout>
        <h1 style={{ margin: '0 0 8px', fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>Your session has ended</h1>
        <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-tertiary)' }}>Enter your email and we'll send you a fresh link.</p>
        <PortalRequestLinkForm />
      </PortalLayout>
    )
  }

  if (loadError) {
    return (
      <PortalLayout>
        <p style={{ margin: '0 0 12px', fontSize: '0.9rem', color: 'var(--status-red-text)' }}>Something went wrong loading your invoices.</p>
        <button onClick={load} className="fos-btn fos-btn-primary">Try again</button>
      </PortalLayout>
    )
  }

  if (invoices === null) {
    return <PortalLayout><p style={{ margin: 0, color: 'var(--text-secondary)', textAlign: 'center' }}>Loading…</p></PortalLayout>
  }

  return (
    <PortalLayout maxWidth={720}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-primary)' }}>Your Invoices</h1>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => handleLogout(false)} disabled={loggingOut} className="fos-btn fos-btn-ghost" style={{ fontSize: '0.78rem' }}>
            <LogOut size={13} /> Log Out
          </button>
          <button onClick={() => handleLogout(true)} disabled={loggingOut} className="fos-btn fos-btn-ghost" style={{ fontSize: '0.78rem' }}>
            Log Out Everywhere
          </button>
        </div>
      </div>

      {invoices.length === 0 ? (
        <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-tertiary)' }}>No invoices yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {invoices.map((inv) => (
            <div
              key={inv.id}
              style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
                padding: '14px 16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)',
              }}
            >
              {/* Real browser navigation, not client-side routing — this
                  <a> points directly at the backend's own HTML-serving
                  endpoint (GET /api/invoices/portal/view/<token>/). A
                  plain href, deliberately not a React Router <Link> or
                  an onClick+navigate()+fetch: the invoice document
                  itself is the one shared render artifact (PDF/portal/
                  editor-preview), never a second React reimplementation
                  of the layout — see DECISIONS.md. This is the one
                  intentional exception to this app's otherwise-
                  universal client-side routing. Messages, below, are
                  genuinely interactive UI with no such artifact to stay
                  in sync with, so that part IS real React. */}
              <a href={inv.portal_view_url} style={{ textDecoration: 'none', color: 'inherit', flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  {inv.invoice_number || '(unnumbered)'}
                </p>
                <p style={{ margin: '2px 0 0', fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
                  {STATUS_LABELS[inv.status] || inv.status} · Due {inv.due_date || '—'}
                  {inv.days_overdue > 0 ? ` · ${inv.days_overdue}d overdue` : ''}
                </p>
                {inv.client_acknowledged && (
                  <p style={{ margin: '2px 0 0', fontSize: '0.72rem', color: 'var(--status-green-text)', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <UserCheck size={11} /> Acknowledged {new Date(inv.client_acknowledged_at).toLocaleDateString()}
                  </p>
                )}
              </a>
              <p style={{ margin: 0, fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                {formatMoney(inv.total, inv.currency)}
              </p>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                {!inv.client_acknowledged && (
                  <button
                    onClick={() => setAckInvoice(inv)}
                    className="fos-btn fos-btn-ghost"
                    style={{ fontSize: '0.78rem' }}
                    aria-label={`Acknowledge ${inv.invoice_number || 'this invoice'}`}
                  >
                    <UserCheck size={14} />
                  </button>
                )}
                {/* Always shown now (item 5 of the 16 August 2026 second
                    verification pass) — this doubles as "check your
                    payment claim status" once outstanding hits 0, not
                    just "report a new payment" while something's still
                    owed; ClaimModal itself hides the submission form when
                    there's nothing left to claim, showing history only. */}
                <button
                  onClick={() => setClaimInvoice(inv)}
                  className="fos-btn fos-btn-ghost"
                  style={{ fontSize: '0.78rem' }}
                  aria-label={`Payment claims for ${inv.invoice_number || 'this invoice'}`}
                >
                  <Receipt size={14} />
                </button>
                <button
                  onClick={() => setMessagesInvoice(inv)}
                  className="fos-btn fos-btn-ghost"
                  style={{ fontSize: '0.78rem' }}
                  aria-label={`Messages for ${inv.invoice_number || 'this invoice'}`}
                >
                  <MessageCircle size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {messagesInvoice && (
        <MessagesModal invoice={messagesInvoice} onClose={() => setMessagesInvoice(null)} />
      )}
      {claimInvoice && (
        <ClaimModal invoice={claimInvoice} onClose={() => setClaimInvoice(null)} />
      )}
      {ackInvoice && (
        <AcknowledgeModal invoice={ackInvoice} onAcknowledged={handleAcknowledged} onClose={() => setAckInvoice(null)} />
      )}
    </PortalLayout>
  )
}

function MessagesModal({ invoice, onClose }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: 'var(--bg-surface)', borderRadius: 'var(--radius-xl)', boxShadow: '0 8px 40px rgba(0,0,0,0.25)', padding: '20px 24px', width: '100%', maxWidth: 480, height: 520, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            {invoice.invoice_number || 'Messages'}
          </h3>
          <button onClick={onClose} aria-label="Close" className="fos-btn fos-btn-ghost" style={{ padding: 6 }}><X size={16} /></button>
        </div>
        <div style={{ flex: 1, minHeight: 0 }}>
          <CommentThread
            commentsUrl={`/invoices/portal/${invoice.id}/comments/`}
            viewToken={viewTokenFromPortalUrl(invoice.portal_view_url)}
            viewerType="client"
          />
        </div>
      </div>
    </div>
  )
}

// A saved client's own invoice — reachable only from within this
// session-authenticated SPA, so this always hits
// POST /invoices/portal/<pk>/claims/ with a valid portal-session
// cookie, never the one-time-client view_token path (that path has no
// real frontend surface yet — it exists on the backend for the same
// reason Step 12's own view_token entry point did before this page's
// equivalent landed, see DECISIONS.md).
//
// Also fetches + shows real claim HISTORY now (item 5 of the 16 August
// 2026 second verification pass — real, confirmed gap: a client
// previously had no way to see whether a claim they'd already submitted
// was confirmed or rejected). Reuses the SAME "Report a Payment" modal
// rather than a separate claims-history screen — the two are the same
// mental object to a client (their own payment claims on this invoice),
// and this invoice's claims are never numerous enough to need a whole
// dedicated view.
function ClaimModal({ invoice, onClose }) {
  const [source, setSource] = useState('other')
  const [amount, setAmount] = useState(invoice.outstanding_amount)
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10))
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [claims, setClaims] = useState(null)

  useEffect(() => {
    api.get(`/invoices/portal/${invoice.id}/claims/`)
      .then(({ data }) => setClaims(data))
      .catch(() => setClaims([]))
  }, [invoice.id])

  async function submit() {
    if (!amount || parseFloat(amount) <= 0) { setError('Enter a valid amount.'); return }
    setError('')
    setBusy(true)
    try {
      const { data } = await api.post(`/invoices/portal/${invoice.id}/claims/`, {
        payment_source: source, amount_claimed: amount, currency: invoice.currency,
        payment_date: paymentDate, client_note: note,
      })
      setSubmitted(true)
      setClaims((prev) => [data, ...(prev || [])])
    } catch (e) {
      setError(e.response?.data?.error || 'Could not submit — please try again.')
    } finally {
      setBusy(false)
    }
  }

  const canSubmitNew = invoice.outstanding_amount > 0 && !submitted

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: 'var(--bg-surface)', borderRadius: 'var(--radius-xl)', boxShadow: '0 8px 40px rgba(0,0,0,0.25)', padding: '20px 24px', width: '100%', maxWidth: 420, maxHeight: '85vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            Payment Claims
          </h3>
          <button onClick={onClose} aria-label="Close" className="fos-btn fos-btn-ghost" style={{ padding: 6 }}><X size={16} /></button>
        </div>

        <ClaimHistory claims={claims} currency={invoice.currency} />

        {submitted ? (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <CheckCircle2 size={28} style={{ color: 'var(--status-green-text)', marginBottom: 10 }} />
            <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text-primary)', fontWeight: 600 }}>Thanks — we've let them know.</p>
            <p style={{ margin: '6px 0 16px', fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>
              They'll review this payment and confirm it on the invoice.
            </p>
            <button onClick={onClose} className="fos-btn fos-btn-primary" style={{ fontSize: '0.82rem' }}>Done</button>
          </div>
        ) : invoice.outstanding_amount > 0 ? (
          <>
            <p style={{ margin: '18px 0 14px', fontSize: '0.82rem', color: 'var(--text-tertiary)', fontWeight: 600 }}>
              Report a new payment — outstanding balance: {formatMoney(invoice.outstanding_amount, invoice.currency)}
            </p>
            {error && <FosAlert type="error" style={{ marginBottom: 12 }}>{error}</FosAlert>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 18 }}>
              <FormSelect label="How did you pay?" value={source} onChange={(e) => setSource(e.target.value)} options={PAYMENT_SOURCE_OPTIONS} />
              <FormField label={`Amount (${invoice.currency})`} type="number" value={amount} onChange={(e) => setAmount(e.target.value)} required />
              <FormField label="Payment Date" type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
              <FormField label="Note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional — e.g. a reference number" />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button onClick={onClose} className="fos-btn fos-btn-ghost">Cancel</button>
              <button onClick={submit} disabled={busy} className="fos-btn fos-btn-primary">
                {busy ? <span className="fos-spinner" /> : <Receipt size={14} />} Submit
              </button>
            </div>
          </>
        ) : (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
            <button onClick={onClose} className="fos-btn fos-btn-ghost">Close</button>
          </div>
        )}
      </div>
    </div>
  )
}

const CLAIM_STATUS_META = {
  pending: { label: 'Pending review', color: 'var(--status-amber-text)' },
  confirmed: { label: 'Confirmed', color: 'var(--status-green-text)' },
  rejected: { label: 'Rejected', color: 'var(--status-red-text)' },
}

function ClaimHistory({ claims, currency }) {
  if (claims === null) {
    return <p style={{ margin: '0 0 14px', fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>Loading your payment claims…</p>
  }
  if (claims.length === 0) {
    return null // nothing submitted yet — no history section to show at all
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 8 }}>
      {claims.map((c) => {
        const meta = CLAIM_STATUS_META[c.status] || CLAIM_STATUS_META.pending
        return (
          <div key={c.id} style={{ padding: '10px 12px', background: 'var(--bg-surface-2)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <p style={{ margin: 0, fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                {formatMoney(c.amount_claimed, currency)}
              </p>
              <span style={{ fontSize: '0.72rem', fontWeight: 600, color: meta.color }}>{meta.label}</span>
            </div>
            <p style={{ margin: '2px 0 0', fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>
              via {c.payment_source} · {c.payment_date}
            </p>
            {c.status === 'rejected' && c.review_note && (
              <p style={{ margin: '6px 0 0', fontSize: '0.76rem', color: 'var(--text-secondary)' }}>Note: {c.review_note}</p>
            )}
          </div>
        )
      })}
    </div>
  )
}

// A ONE-TIME, permanent action — no unacknowledge path exists anywhere
// (apps/invoices/views_portal.py's portal_invoice_acknowledge, Step 15).
// Idempotent server-side, so a stray double-click here is harmless, but
// the button still disappears (see the row above) the moment
// client_acknowledged is true, matching "a permanent 'Acknowledged on
// [date]' state, not a re-clickable button."
function AcknowledgeModal({ invoice, onAcknowledged, onClose }) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    setBusy(true)
    setError('')
    try {
      const { data } = await api.post(`/invoices/portal/${invoice.id}/acknowledge/`)
      onAcknowledged(invoice.id, data.client_acknowledged_at)
    } catch (e) {
      setError(e.response?.data?.error || 'Could not acknowledge — please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: 'var(--bg-surface)', borderRadius: 'var(--radius-xl)', boxShadow: '0 8px 40px rgba(0,0,0,0.25)', padding: '20px 24px', width: '100%', maxWidth: 400 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>Acknowledge Invoice</h3>
          <button onClick={onClose} aria-label="Close" className="fos-btn fos-btn-ghost" style={{ padding: 6 }}><X size={16} /></button>
        </div>
        {error && <FosAlert type="error" style={{ marginBottom: 12 }}>{error}</FosAlert>}
        <p style={{ margin: '0 0 18px', fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          Confirming this records that you've reviewed {invoice.invoice_number || 'this invoice'} and agree to
          its terms. This is permanent and can't be undone.
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button onClick={onClose} className="fos-btn fos-btn-ghost">Cancel</button>
          <button onClick={submit} disabled={busy} className="fos-btn fos-btn-primary">
            {busy ? <span className="fos-spinner" /> : <UserCheck size={14} />} I Acknowledge This Invoice and Its Terms
          </button>
        </div>
      </div>
    </div>
  )
}
