// src/pages/portal/ClientPortal.jsx
//
// /portal/invoices — the client's own invoice LIST, living inside
// PortalShell.jsx as of Client Portal Redesign, Phase 2 (previously the
// top-level /portal route/page itself — relocated, not rewritten; see
// PortalShell.jsx's own header comment for the routing restructure).
// Its own internals (list row design, filters, modals) are unchanged —
// a real redesign of this page's own content is a separate, later task
// (DESIGN.md Section 6).
//
// Portal-session-authenticated via the httpOnly lanceraos_portal_session
// cookie (apps.clients.cookies) — GET /api/invoices/portal/me/ 401s with
// no valid session, handled here directly (never the global axios
// refresh-and-redirect-to-/login interceptor, which src/lib/api.js's
// SKIP_REFRESH_URLS now explicitly excludes /invoices/portal/ from).
//
// FIXED 22 September 2026: this page previously used var(--*) theme
// tokens throughout, plus the theme-dependent .fos-btn classes and the
// theme-dependent FormField/FormSelect/FosAlert shared components — all
// of which resolve against theme.css, which is scoped to the
// FREELANCER's own authenticated-app light/dark preference. A client has
// no such setting and no account at all; DESIGN.md Section 10 requires
// this whole surface to use ONE fixed light palette instead, matching
// InvoiceView.jsx/PaymentDetails.jsx. FormField/FormSelect/FosAlert were
// replaced with plain inline-styled elements here (matching this
// project's own precedent on every other public page) rather than
// changing those shared components themselves — they're used pervasively
// across the entire authenticated Settings/invoices/clients UI, so
// changing those shared components' own styling to accommodate one
// public page would be a materially higher-risk change for no benefit
// anywhere else. See DECISIONS.md's 22 September 2026 entry.
//
// Phase 2: its own header row (title + Log Out / Log Out Everywhere)
// is gone — PortalShell.jsx now owns both branding chrome and the
// logout actions (relocated into a header account menu, per this
// phase's own spec: "keep both existing actions, but relocate them out
// of the main nav into a small account menu/icon in the header"). The
// palette constants below are now imported from the shared
// portalShared.js module rather than defined here a second time
// (confirmed duplicated verbatim across this file, PortalEnter.jsx, and
// PortalRequestLinkForm.jsx before this pass — factored out once,
// shared by all of them plus the new PortalShell.jsx/PortalOverview.jsx).
import { useEffect, useState } from 'react'
import { CheckCircle2, MessageCircle, Receipt, UserCheck, X } from 'lucide-react'

import api from '@/lib/api'
import useTitle from '@/hooks/useTitle'
import CommentThread from '@/components/CommentThread'
import { PAYMENT_SOURCE_OPTIONS, formatMoney, todayInPlatformTimezone } from '@/pages/invoiceHelpers'
import {
  ACCENT, ACCENT_BORDER_TINT, ACCENT_TINT, BODY_TEXT, CARD_BG, CARD_SHADOW, CLAIM_STATUS_META, DIVIDER,
  ERROR, ERROR_BORDER_TINT, ERROR_TINT, MUTED_TEXT, NAVY, PAGE_BG, STATUS_LABELS,
  disabledStyle, publicBtnGhost, publicBtnPrimary, publicInputStyle, publicLabelStyle,
  viewTokenFromPortalUrl,
} from './portalShared'
import PortalRequestLinkForm from './PortalRequestLinkForm'

// A minimal, inline-styled stand-in for FosAlert (theme-dependent, see
// this file's own header comment) — same visual shape, theme-aware
// portal tokens (Phase 3.5), not hardcoded colors any more.
function PublicAlert({ type = 'error', children, style }) {
  const bg = type === 'error' ? ERROR_TINT : ACCENT_TINT
  const border = type === 'error' ? ERROR_BORDER_TINT : ACCENT_BORDER_TINT
  const color = type === 'error' ? ERROR : NAVY
  return (
    <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: 8, padding: '10px 12px', fontSize: '0.82rem', color, ...style }}>
      {children}
    </div>
  )
}

// A minimal, inline-styled stand-in for FormField (theme-dependent).
function PublicField({ label, ...inputProps }) {
  return (
    <div>
      <label style={publicLabelStyle}>{label}</label>
      <input {...inputProps} style={publicInputStyle} />
    </div>
  )
}

// A minimal, inline-styled stand-in for FormSelect (theme-dependent).
function PublicSelect({ label, value, onChange, options }) {
  return (
    <div>
      <label style={publicLabelStyle}>{label}</label>
      <select value={value} onChange={onChange} style={{ ...publicInputStyle, cursor: 'pointer' }}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  )
}

export default function ClientPortal() {
  useTitle('Your Invoices — LanceraOS')
  const [invoices, setInvoices] = useState(null)
  const [needsLink, setNeedsLink] = useState(false)
  const [loadError, setLoadError] = useState(false)
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

  // Phase 2: no PortalLayout wrapper on any of these 3 states any more
  // (that's the narrow, full-viewport centered-card treatment for
  // auth-adjacent screens) — this content now renders inside
  // PortalShell's <Outlet/>, which already provides the page frame, so
  // a second full-screen overlay here would nest awkwardly inside it.
  // needsLink is a real, if rare, race (session expiring between the
  // shell's own overview fetch and this page's own invoice-list fetch)
  // rather than the primary path it used to be when this was the
  // top-level /portal route — PortalShell's own overview fetch is what
  // normally catches an invalid session before this component ever
  // mounts.
  if (needsLink) {
    return (
      <div>
        <h1 style={{ margin: '0 0 8px', fontSize: '1.1rem', fontWeight: 700, color: NAVY }}>Your session has ended</h1>
        <p style={{ margin: 0, fontSize: '0.85rem', color: MUTED_TEXT }}>Enter your email and we'll send you a fresh link.</p>
        <PortalRequestLinkForm />
      </div>
    )
  }

  if (loadError) {
    return (
      <div>
        <p style={{ margin: '0 0 12px', fontSize: '0.9rem', color: ERROR }}>Something went wrong loading your invoices.</p>
        <button onClick={load} style={publicBtnPrimary}>Try again</button>
      </div>
    )
  }

  if (invoices === null) {
    return <p style={{ margin: 0, color: BODY_TEXT, textAlign: 'center' }}>Loading…</p>
  }

  return (
    <div>
      <h1 style={{ margin: '0 0 20px', fontSize: '1.2rem', fontWeight: 700, color: NAVY }}>Your Invoices</h1>

      {invoices.length === 0 ? (
        <p style={{ margin: 0, fontSize: '0.85rem', color: MUTED_TEXT }}>No invoices yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {invoices.map((inv) => (
            <div
              key={inv.id}
              style={{
                display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '8px 12px',
                padding: '14px 16px', borderRadius: 10, border: `1px solid ${DIVIDER}`,
              }}
            >
              {/* portal_view_url now points at InvoiceView.jsx's own
                  /invoice/:token route (see DECISIONS.md) — still a
                  plain <a href>, not a React Router <Link>, since it's
                  simplest and the destination renders no shared chrome
                  to preserve statefully across a soft navigation anyway.
                  That destination page is itself still just a thin
                  wrapper fetching the one shared render artifact
                  (PDF/portal/editor-preview all come from the same
                  Django template), never a second reimplementation of
                  the invoice layout. Messages, below, are genuinely
                  interactive UI with no such artifact to stay in sync
                  with, so that part IS real React, unchanged. */}
              <a href={inv.portal_view_url} style={{ textDecoration: 'none', color: 'inherit', flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: '0.88rem', fontWeight: 700, color: NAVY }}>
                  {inv.invoice_number || '(unnumbered)'}
                </p>
                <p style={{ margin: '2px 0 0', fontSize: '0.75rem', color: MUTED_TEXT }}>
                  {STATUS_LABELS[inv.status] || inv.status} · Due {inv.due_date || '—'}
                  {inv.days_overdue > 0 ? ` · ${inv.days_overdue}d overdue` : ''}
                </p>
                {inv.client_acknowledged && (
                  <p style={{ margin: '2px 0 0', fontSize: '0.72rem', color: ACCENT, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <UserCheck size={11} /> Acknowledged {new Date(inv.client_acknowledged_at).toLocaleDateString()}
                  </p>
                )}
              </a>
              <p style={{ margin: 0, fontSize: '0.9rem', fontWeight: 700, color: NAVY, flexShrink: 0 }}>
                {formatMoney(inv.total, inv.currency)}
              </p>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                {!inv.client_acknowledged && (
                  <button
                    onClick={() => setAckInvoice(inv)}
                    style={{ ...publicBtnGhost, fontSize: '0.78rem', padding: '10px 12px', minWidth: 40, minHeight: 40 }}
                    aria-label={`Acknowledge ${inv.invoice_number || 'this invoice'}`}
                  >
                    <UserCheck size={14} />
                  </button>
                )}
                {/* Phase 3.5 — REVERSAL of the 16 August 2026 second
                    verification pass's own "always shown, doubles as
                    check-status" decision (kept in DECISIONS.md as
                    historical context, not current reasoning). This
                    task explicitly requires the action to be genuinely
                    absent — not disabled, not reachable — once nothing
                    is left owing, reusing the same outstanding_amount
                    field ClaimModal's own canSubmitNew already checks
                    (no new computed value introduced). The "check my
                    claim status once paid" need this used to double for
                    is now covered by the Payments tab (Phase 3), which
                    lists every claim across every invoice regardless of
                    that invoice's current balance — nothing is actually
                    lost by hiding this one per-invoice trigger. */}
                {inv.outstanding_amount > 0 && (
                  <button
                    onClick={() => setClaimInvoice(inv)}
                    style={{ ...publicBtnGhost, fontSize: '0.78rem', padding: '10px 12px', minWidth: 40, minHeight: 40 }}
                    aria-label={`Payment claims for ${inv.invoice_number || 'this invoice'}`}
                  >
                    <Receipt size={14} />
                  </button>
                )}
                <button
                  onClick={() => setMessagesInvoice(inv)}
                  style={{ ...publicBtnGhost, fontSize: '0.78rem', padding: '10px 12px', minWidth: 40, minHeight: 40 }}
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
    </div>
  )
}

function MessagesModal({ invoice, onClose }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      {/* Mobile audit fix (Phase 3.5): this used a fixed `height: 520`
          with no viewport-relative cap or scroll fallback — on a short
          viewport (a small phone, or any phone in landscape) that
          overflowed the screen with nothing scrollable to recover it.
          `min(520px, 85vh)` matches ClaimModal's own 85vh convention. */}
      <div style={{ background: CARD_BG, borderRadius: 16, boxShadow: CARD_SHADOW, padding: '20px 24px', width: '100%', maxWidth: 480, height: 'min(520px, 85vh)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: NAVY }}>
            {invoice.invoice_number || 'Messages'}
          </h3>
          <button onClick={onClose} aria-label="Close" style={{ ...publicBtnGhost, padding: 8, minWidth: 36, minHeight: 36 }}><X size={16} /></button>
        </div>
        <div style={{ flex: 1, minHeight: 0 }}>
          <CommentThread
            commentsUrl={`/invoices/portal/${invoice.id}/comments/`}
            viewToken={viewTokenFromPortalUrl(invoice.portal_view_url)}
            viewerType="client"
            palette="public"
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
  const [paymentDate, setPaymentDate] = useState(todayInPlatformTimezone())
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
      <div style={{ background: CARD_BG, borderRadius: 16, boxShadow: CARD_SHADOW, padding: '20px 24px', width: '100%', maxWidth: 420, maxHeight: '85vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: NAVY }}>
            Payment Claims
          </h3>
          <button onClick={onClose} aria-label="Close" style={{ ...publicBtnGhost, padding: 8, minWidth: 36, minHeight: 36 }}><X size={16} /></button>
        </div>

        <ClaimHistory claims={claims} currency={invoice.currency} />

        {submitted ? (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <CheckCircle2 size={28} style={{ color: ACCENT, marginBottom: 10 }} />
            <p style={{ margin: 0, fontSize: '0.88rem', color: NAVY, fontWeight: 600 }}>Thanks — we've let them know.</p>
            <p style={{ margin: '6px 0 16px', fontSize: '0.8rem', color: MUTED_TEXT }}>
              They'll review this payment and confirm it on the invoice.
            </p>
            <button onClick={onClose} style={{ ...publicBtnPrimary, fontSize: '0.82rem' }}>Done</button>
          </div>
        ) : invoice.outstanding_amount > 0 ? (
          <>
            <p style={{ margin: '18px 0 14px', fontSize: '0.82rem', color: MUTED_TEXT, fontWeight: 600 }}>
              Report a new payment — outstanding balance: {formatMoney(invoice.outstanding_amount, invoice.currency)}
            </p>
            {error && <PublicAlert type="error" style={{ marginBottom: 12 }}>{error}</PublicAlert>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 18 }}>
              <PublicSelect label="How did you pay?" value={source} onChange={(e) => setSource(e.target.value)} options={PAYMENT_SOURCE_OPTIONS} />
              <PublicField label={`Amount (${invoice.currency})`} type="number" value={amount} onChange={(e) => setAmount(e.target.value)} required />
              <PublicField label="Payment Date" type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
              <PublicField label="Note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional — e.g. a reference number" />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button onClick={onClose} style={publicBtnGhost}>Cancel</button>
              <button onClick={submit} disabled={busy} style={disabledStyle(publicBtnPrimary, busy)}>
                {busy ? <span className="fos-spinner" /> : <Receipt size={14} />} Submit
              </button>
            </div>
          </>
        ) : (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
            <button onClick={onClose} style={publicBtnGhost}>Close</button>
          </div>
        )}
      </div>
    </div>
  )
}

function ClaimHistory({ claims, currency }) {
  if (claims === null) {
    return <p style={{ margin: '0 0 14px', fontSize: '0.8rem', color: MUTED_TEXT }}>Loading your payment claims…</p>
  }
  if (claims.length === 0) {
    return null // nothing submitted yet — no history section to show at all
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 8 }}>
      {claims.map((claim) => {
        const meta = CLAIM_STATUS_META[claim.status] || CLAIM_STATUS_META.pending
        return (
          <div key={claim.id} style={{ padding: '10px 12px', background: PAGE_BG, border: `1px solid ${DIVIDER}`, borderRadius: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <p style={{ margin: 0, fontSize: '0.85rem', fontWeight: 700, color: NAVY }}>
                {formatMoney(claim.amount_claimed, currency)}
              </p>
              <span style={{ fontSize: '0.72rem', fontWeight: 600, color: meta.color }}>{meta.label}</span>
            </div>
            <p style={{ margin: '2px 0 0', fontSize: '0.72rem', color: MUTED_TEXT }}>
              via {claim.payment_source} · {claim.payment_date}
            </p>
            {claim.status === 'rejected' && claim.review_note && (
              <p style={{ margin: '6px 0 0', fontSize: '0.76rem', color: BODY_TEXT }}>Note: {claim.review_note}</p>
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
      <div style={{ background: CARD_BG, borderRadius: 16, boxShadow: CARD_SHADOW, padding: '20px 24px', width: '100%', maxWidth: 400, maxHeight: '85vh', overflowY: 'auto', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: NAVY }}>Acknowledge Invoice</h3>
          <button onClick={onClose} aria-label="Close" style={{ ...publicBtnGhost, padding: 8, minWidth: 36, minHeight: 36 }}><X size={16} /></button>
        </div>
        {error && <PublicAlert type="error" style={{ marginBottom: 12 }}>{error}</PublicAlert>}
        <p style={{ margin: '0 0 18px', fontSize: '0.85rem', color: BODY_TEXT, lineHeight: 1.6 }}>
          Confirming this records that you've reviewed {invoice.invoice_number || 'this invoice'} and agree to
          its terms. This is permanent and can't be undone.
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button onClick={onClose} style={publicBtnGhost}>Cancel</button>
          <button onClick={submit} disabled={busy} style={disabledStyle(publicBtnPrimary, busy)}>
            {busy ? <span className="fos-spinner" /> : <UserCheck size={14} />} I Acknowledge This Invoice and Its Terms
          </button>
        </div>
      </div>
    </div>
  )
}
