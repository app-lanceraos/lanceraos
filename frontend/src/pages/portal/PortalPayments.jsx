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
//                submitted_at, reviewed_at, review_note,
//                invoice_number, portal_view_url}] }
//
// GAP CLOSED, Phase 3.5 (was reported, not worked around, in Phase 3):
// `claims[]` used to carry no invoice-identifying field at all — the
// freelancer-facing/per-invoice claims endpoints reuse
// PaymentClaimSerializer verbatim (which never needed that context,
// already being scoped to one invoice by the URL), but portal_payments
// aggregates claims ACROSS every invoice, where it's actually needed.
// apps/invoices/serializers_portal.py's new PortalPaymentClaimSerializer
// is a dedicated wrapper adding invoice_number/portal_view_url — those
// two callers' own PaymentClaimSerializer usage is completely untouched.
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

// Phase 3.5: CLAIM_STATUS_META itself now carries a theme-aware `tint`
// per status (portalShared.js) — the separate literal rgba() map this
// used to keep locally is gone; one source for both the badge's text
// color and its background now, not two independently-maintained ones.
function ClaimStatusBadge({ status }) {
  const meta = CLAIM_STATUS_META[status] || CLAIM_STATUS_META.pending
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', fontSize: '0.68rem', fontWeight: 600,
      padding: '3px 8px', borderRadius: 999, background: meta.tint, color: meta.color,
    }}>
      {meta.label}
    </span>
  )
}

// Phase 3.5 — apps/invoices/serializers_portal.py's new
// PortalPaymentClaimSerializer closes the real gap Phase 3 reported:
// claims[] now carries invoice_number/portal_view_url, so each row can
// finally link back to its own invoice (previously impossible — see
// this file's own header comment, kept as historical context).
function ClaimRow({ claim }) {
  return (
    <a
      href={claim.portal_view_url}
      style={{
        display: 'block', padding: '12px 14px', borderRadius: 10, border: `1px solid ${DIVIDER}`,
        textDecoration: 'none', color: 'inherit',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
        <p style={{ margin: 0, fontSize: '0.85rem', fontWeight: 700, color: NAVY }}>
          {formatMoney(claim.amount_claimed, claim.currency)}
        </p>
        <ClaimStatusBadge status={claim.status} />
      </div>
      <p style={{ margin: '4px 0 0', fontSize: '0.72rem', color: MUTED_TEXT }}>
        via {claim.payment_source} · {claim.payment_date} · {claim.invoice_number || '(unnumbered)'}
      </p>
      {claim.review_note && (
        <p style={{ margin: '6px 0 0', fontSize: '0.78rem', color: BODY_TEXT }}>Note: {claim.review_note}</p>
      )}
    </a>
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
