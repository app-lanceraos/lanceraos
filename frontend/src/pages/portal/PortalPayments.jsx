// src/pages/portal/PortalPayments.jsx
//
// /portal/payments — Client Portal Redesign, Phase 3. Read-only payment
// history + claim status across every one of the client's invoices.
// Claim *submission* stays exactly where it already lives (the existing
// "Report a Payment" modal reached from an invoice row in
// ClientPortal.jsx / InvoiceDetailPanel.jsx) — this page is a second,
// read-only surface over data that already exists, not a second entry
// point into that workflow.
//
// Unlike PortalOverview.jsx, this page fetches its OWN endpoint
// (GET /api/invoices/portal/payments/) — a genuinely different response
// than the shell's own Overview fetch, so it needs its own loading/
// error/session handling, mirrored from ClientPortal.jsx's own
// needsLink/loadError/loading 3-state pattern (Phase 2) for consistency,
// and PortalShell.jsx's own Skeleton for the loading visual specifically
// (reused, not reimplemented).
//
// Real, current response shape, confirmed directly against
// apps/invoices/views_portal.py's portal_payments (not assumed):
//   { balances: [{currency, outstanding, paid}],
//     payments: [{id, amount, currency, payment_date, source,
//                  invoice_number, portal_view_url}],
//     claims: [{id, client_name, client_email, amount_claimed, currency,
//                payment_source, payment_date, client_note, status,
//                submitted_at, reviewed_at, review_note}] }
//
// KNOWN, REPORTED GAP (see DECISIONS.md's Phase 3 entry): unlike
// `payments[]`, a `claims[]` entry carries NO invoice-identifying field
// at all (no invoice_number/portal_view_url/id) — PaymentClaimSerializer
// (apps/invoices/serializers_claims.py), the exact serializer this
// endpoint reuses verbatim for `claims`, was built for endpoints already
// scoped to one invoice via the URL path (the freelancer-facing
// invoice_claims list, and the portal's own per-invoice
// portal_invoice_claims), so it never needed to carry that context
// itself — but portal_payments aggregates claims ACROSS every invoice,
// where that context is exactly what's missing. Per this task's own
// explicit instruction not to extend the endpoint or add a second API
// call to work around a gap, each claim row below renders with no link
// back to its invoice — a real, reported limitation, not an oversight.
import { useEffect, useState } from 'react'
import { AlertCircle, Inbox } from 'lucide-react'

import api from '@/lib/api'
import useTitle from '@/hooks/useTitle'
import { formatMoney } from '@/pages/invoiceHelpers'
import {
  BODY_TEXT, CLAIM_STATUS_META, DIVIDER, ERROR, MUTED_TEXT, NAVY,
  publicBtnPrimary,
} from './portalShared'
import BalancesSection, { cardStyle, sectionTitleStyle } from './PortalBalances'
import PortalRequestLinkForm from './PortalRequestLinkForm'
import { Skeleton } from './PortalShell'

function EmptyNotice({ icon: Icon, children }) {
  return (
    <div style={{ ...cardStyle, textAlign: 'center', padding: '24px 18px' }}>
      <Icon size={22} style={{ color: MUTED_TEXT, marginBottom: 8 }} />
      <p style={{ margin: 0, fontSize: '0.85rem', color: BODY_TEXT }}>{children}</p>
    </div>
  )
}

function PaymentRow({ payment }) {
  return (
    <a
      href={payment.portal_view_url}
      style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
        padding: '12px 14px', borderRadius: 10, border: `1px solid ${DIVIDER}`, textDecoration: 'none', color: 'inherit',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: '0.85rem', fontWeight: 700, color: NAVY }}>
          {formatMoney(payment.amount, payment.currency)}
        </p>
        <p style={{ margin: '2px 0 0', fontSize: '0.72rem', color: MUTED_TEXT }}>
          via {payment.source} · {payment.payment_date}
        </p>
      </div>
      <p style={{ margin: 0, fontSize: '0.78rem', fontWeight: 600, color: MUTED_TEXT, flexShrink: 0 }}>
        {payment.invoice_number || '(unnumbered)'}
      </p>
    </a>
  )
}

// Tint backgrounds keyed by the same CLAIM_STATUS_META colors — a
// literal rgba() per status (matching PortalOverview.jsx's own
// ReasonBadge convention exactly, including reusing its identical
// rgba(192,57,43,.08) tint for ERROR/rejected) rather than a computed
// hex+alpha string.
const CLAIM_STATUS_BADGE_BG = {
  pending: 'rgba(138,125,92,.14)',
  confirmed: 'rgba(0,200,150,.14)',
  rejected: 'rgba(192,57,43,.08)',
}

function ClaimStatusBadge({ status }) {
  const meta = CLAIM_STATUS_META[status] || CLAIM_STATUS_META.pending
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', fontSize: '0.68rem', fontWeight: 600,
      padding: '3px 8px', borderRadius: 999, background: CLAIM_STATUS_BADGE_BG[status] || CLAIM_STATUS_BADGE_BG.pending,
      color: meta.color,
    }}>
      {meta.label}
    </span>
  )
}

function ClaimRow({ claim }) {
  return (
    <div style={{ padding: '12px 14px', borderRadius: 10, border: `1px solid ${DIVIDER}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
        <p style={{ margin: 0, fontSize: '0.85rem', fontWeight: 700, color: NAVY }}>
          {formatMoney(claim.amount_claimed, claim.currency)}
        </p>
        <ClaimStatusBadge status={claim.status} />
      </div>
      <p style={{ margin: '4px 0 0', fontSize: '0.72rem', color: MUTED_TEXT }}>
        via {claim.payment_source} · {claim.payment_date}
      </p>
      {claim.review_note && (
        <p style={{ margin: '6px 0 0', fontSize: '0.78rem', color: BODY_TEXT }}>Note: {claim.review_note}</p>
      )}
    </div>
  )
}

export default function PortalPayments() {
  useTitle('Payments — LanceraOS')
  // 'loading' | 'ready' | 'needs_link' | 'error'
  const [state, setState] = useState('loading')
  const [data, setData] = useState(null)

  function load() {
    setState((prev) => (prev === 'ready' ? prev : 'loading'))
    api.get('/invoices/portal/payments/')
      .then(({ data }) => { setData(data); setState('ready') })
      .catch((e) => setState(e.response?.status === 401 ? 'needs_link' : 'error'))
  }

  useEffect(() => { load() }, [])

  if (state === 'loading') return <Skeleton />

  // A stray 401 here (session expired between the shell's own Overview
  // fetch and this page's own fetch) — same rare-race reasoning as
  // ClientPortal.jsx's own needsLink fallback (Phase 2): the shell
  // normally catches an invalid session before this page ever mounts.
  if (state === 'needs_link') {
    return (
      <div>
        <h1 style={{ margin: '0 0 8px', fontSize: '1.1rem', fontWeight: 700, color: NAVY }}>Your session has ended</h1>
        <p style={{ margin: 0, fontSize: '0.85rem', color: MUTED_TEXT }}>Enter your email and we'll send you a fresh link.</p>
        <PortalRequestLinkForm />
      </div>
    )
  }

  if (state === 'error') {
    return (
      <div>
        <p style={{ margin: '0 0 12px', fontSize: '0.9rem', color: ERROR }}>Something went wrong loading your payments.</p>
        <button onClick={load} style={publicBtnPrimary}>Try again</button>
      </div>
    )
  }

  const { balances, payments, claims } = data

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 700, color: NAVY }}>Payments</h1>
      </div>

      <BalancesSection balances={balances} />

      <section>
        <h2 style={sectionTitleStyle}>Payment History</h2>
        {payments.length === 0 ? (
          <EmptyNotice icon={Inbox}>No payments recorded yet.</EmptyNotice>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {payments.map((payment) => <PaymentRow key={payment.id} payment={payment} />)}
          </div>
        )}
      </section>

      <section>
        <h2 style={sectionTitleStyle}>Payment Claims</h2>
        {claims.length === 0 ? (
          <EmptyNotice icon={AlertCircle}>No payment claims yet.</EmptyNotice>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {claims.map((claim) => <ClaimRow key={claim.id} claim={claim} />)}
          </div>
        )}
      </section>
    </div>
  )
}
