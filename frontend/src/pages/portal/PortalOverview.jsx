// src/pages/portal/PortalOverview.jsx
//
// /portal (index route under PortalShell.jsx) — Client Portal Redesign,
// Phase 2. Pure presentational page: PortalShell.jsx has already
// resolved the Overview fetch (freelancer identity, balances,
// needs-attention, recent invoices) before this component ever mounts,
// so there's no loading/error/session state to handle here — that's the
// shell's job. Reads the real GET /api/invoices/portal/overview/
// response shape exactly as apps/invoices/serializers_portal.py defines
// it (confirmed directly against views_portal.py's portal_overview,
// not assumed from any prior summary):
//   { freelancer: {business_name, logo}, client_name,
//     balances: [{currency, outstanding, paid}],
//     needs_attention: [{id, invoice_number, portal_view_url, currency,
//                         total, due_date, reasons: [...]}],
//     recent_invoices: [...PortalInvoiceListSerializer fields] }
import { CheckCircle2, Inbox } from 'lucide-react'

import useTitle from '@/hooks/useTitle'
import usePortalOverview from '@/hooks/usePortalOverview'
import { formatMoney } from '@/pages/invoiceHelpers'
import {
  ACCENT, BODY_TEXT, CARD_BORDER, DIVIDER, ERROR, MUTED_TEXT, NAVY,
  NEEDS_ATTENTION_REASON_LABELS, STATUS_LABELS,
} from './portalShared'

const cardStyle = {
  background: '#ffffff', border: `1px solid ${CARD_BORDER}`, borderRadius: 12,
  padding: '16px 18px', boxSizing: 'border-box',
}

const sectionTitleStyle = {
  margin: '0 0 12px', fontSize: '0.78rem', fontWeight: 700, letterSpacing: '0.04em',
  textTransform: 'uppercase', color: MUTED_TEXT,
}

function EmptyNotice({ icon: Icon, iconColor = MUTED_TEXT, children }) {
  return (
    <div style={{ ...cardStyle, textAlign: 'center', padding: '28px 18px' }}>
      <Icon size={24} style={{ color: iconColor, marginBottom: 8 }} />
      <p style={{ margin: 0, fontSize: '0.85rem', color: BODY_TEXT }}>{children}</p>
    </div>
  )
}

function BalanceCard({ balance }) {
  const hasOutstanding = Number(balance.outstanding) > 0
  return (
    <div style={{ ...cardStyle, minWidth: 160, flex: '1 1 200px' }}>
      <p style={{ margin: 0, fontSize: '0.7rem', fontWeight: 600, color: MUTED_TEXT, letterSpacing: '0.03em' }}>
        {balance.currency}
      </p>
      <p style={{ margin: '4px 0 0', fontSize: '1.4rem', fontWeight: 700, color: hasOutstanding ? NAVY : ACCENT }}>
        {formatMoney(balance.outstanding, balance.currency)}
      </p>
      <p style={{ margin: '2px 0 0', fontSize: '0.75rem', color: MUTED_TEXT }}>
        {hasOutstanding ? 'outstanding' : 'nothing outstanding'}
      </p>
      {Number(balance.paid) > 0 && (
        <p style={{ margin: '8px 0 0', fontSize: '0.75rem', color: MUTED_TEXT, borderTop: `1px solid ${DIVIDER}`, paddingTop: 8 }}>
          {formatMoney(balance.paid, balance.currency)} paid to date
        </p>
      )}
    </div>
  )
}

function ReasonBadge({ reason }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', fontSize: '0.68rem', fontWeight: 600,
      padding: '3px 8px', borderRadius: 999, background: 'rgba(192,57,43,.08)', color: ERROR,
    }}>
      {NEEDS_ATTENTION_REASON_LABELS[reason] || reason}
    </span>
  )
}

function NeedsAttentionRow({ invoice }) {
  return (
    <a
      href={invoice.portal_view_url}
      style={{
        display: 'flex', flexDirection: 'column', gap: 6, textDecoration: 'none', color: 'inherit',
        padding: '12px 14px', borderRadius: 10, border: `1px solid ${CARD_BORDER}`, background: '#ffffff',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
        <p style={{ margin: 0, fontSize: '0.88rem', fontWeight: 700, color: NAVY }}>
          {invoice.invoice_number || '(unnumbered)'}
        </p>
        <p style={{ margin: 0, fontSize: '0.88rem', fontWeight: 700, color: NAVY, whiteSpace: 'nowrap' }}>
          {formatMoney(invoice.total, invoice.currency)}
        </p>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {invoice.reasons.map((reason) => <ReasonBadge key={reason} reason={reason} />)}
      </div>
    </a>
  )
}

function RecentInvoiceRow({ invoice }) {
  return (
    <a
      href={invoice.portal_view_url}
      style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
        padding: '12px 14px', borderRadius: 10, border: `1px solid ${DIVIDER}`, textDecoration: 'none', color: 'inherit',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: '0.85rem', fontWeight: 700, color: NAVY }}>
          {invoice.invoice_number || '(unnumbered)'}
        </p>
        <p style={{ margin: '2px 0 0', fontSize: '0.72rem', color: MUTED_TEXT }}>
          {STATUS_LABELS[invoice.status] || invoice.status} · Due {invoice.due_date || '—'}
        </p>
      </div>
      <p style={{ margin: 0, fontSize: '0.85rem', fontWeight: 700, color: NAVY, flexShrink: 0 }}>
        {formatMoney(invoice.total, invoice.currency)}
      </p>
    </a>
  )
}

export default function PortalOverview() {
  useTitle('Overview — LanceraOS')
  const { overview } = usePortalOverview()

  // PortalShell only renders <Outlet/> (and therefore this page) once
  // its own Overview fetch has already succeeded — this null check is
  // defensive only, never a real state this page has to design for.
  if (!overview) return null

  const { client_name, balances, needs_attention, recent_invoices } = overview
  const hasAnyInvoices = recent_invoices.length > 0 || balances.length > 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 700, color: NAVY }}>
          Hello, {client_name}
        </h1>
      </div>

      {!hasAnyInvoices ? (
        <EmptyNotice icon={Inbox}>
          You don't have any invoices yet. When they send you one, it'll show up here.
        </EmptyNotice>
      ) : (
        <>
          {balances.length > 0 && (
            <section>
              <h2 style={sectionTitleStyle}>Balance</h2>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                {balances.map((balance) => <BalanceCard key={balance.currency} balance={balance} />)}
              </div>
            </section>
          )}

          <section>
            <h2 style={sectionTitleStyle}>Needs Your Attention</h2>
            {needs_attention.length === 0 ? (
              <div style={{ ...cardStyle, display: 'flex', alignItems: 'center', gap: 10 }}>
                <CheckCircle2 size={18} style={{ color: ACCENT, flexShrink: 0 }} />
                <p style={{ margin: 0, fontSize: '0.85rem', color: BODY_TEXT }}>
                  You're all caught up — nothing needs your attention right now.
                </p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {needs_attention.map((invoice) => <NeedsAttentionRow key={invoice.id} invoice={invoice} />)}
              </div>
            )}
          </section>

          {recent_invoices.length > 0 && (
            <section>
              <h2 style={sectionTitleStyle}>Recent Invoices</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {recent_invoices.map((invoice) => <RecentInvoiceRow key={invoice.id} invoice={invoice} />)}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}
