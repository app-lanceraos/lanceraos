// src/pages/portal/PortalBalances.jsx
//
// Client Portal Redesign, Phase 3 — extracted from PortalOverview.jsx
// (Phase 2), which built the original "Balance" section: one card per
// currency, never summed. PortalPayments.jsx (this phase) needs the
// exact same data (portal_overview's/portal_payments' `balances` field
// is byte-identical in shape — both come from the backend's
// `_client_balances_by_currency` helper) rendered the exact same way, so
// this is a pure extraction, not a new design — Overview's own rendered
// output is unchanged before/after (verified with a real screenshot
// comparison, see DECISIONS.md).
import { ACCENT, CARD_BG, CARD_BORDER, DIVIDER, MUTED_TEXT, NAVY } from './portalShared'
import { formatMoney } from '@/pages/invoiceHelpers'

export const cardStyle = {
  background: CARD_BG, border: `1px solid ${CARD_BORDER}`, borderRadius: 12,
  padding: '14px 16px', boxSizing: 'border-box',
}

export const sectionTitleStyle = {
  margin: '0 0 10px', fontSize: '0.76rem', fontWeight: 700, letterSpacing: '0.04em',
  textTransform: 'uppercase', color: MUTED_TEXT,
}

// Mobile Polish (Phase 3.5b): the figure here used to render at 1.4rem
// (22.4px, bold) — measured, on a real device, LARGER than either page
// heading that sits above it ("Payments" 1.3rem/20.8px, "Your Invoices"
// 1.2rem/19.2px). A balance figure should read as a prominent number,
// never a bigger, heavier one than the page's own <h1> — 1.05rem
// (16.8px) keeps it clearly the loudest thing ON THE CARD while staying
// under both real heading sizes. See DECISIONS.md for the real
// before/after computed-style evidence.
export function BalanceCard({ balance }) {
  const hasOutstanding = Number(balance.outstanding) > 0
  return (
    <div style={{ ...cardStyle, minWidth: 150, flex: '1 1 180px' }}>
      <p style={{ margin: 0, fontSize: '0.68rem', fontWeight: 600, color: MUTED_TEXT, letterSpacing: '0.03em' }}>
        {balance.currency}
      </p>
      <p style={{ margin: '3px 0 0', fontSize: '1.05rem', fontWeight: 700, color: hasOutstanding ? NAVY : ACCENT }}>
        {formatMoney(balance.outstanding, balance.currency)}
      </p>
      <p style={{ margin: '2px 0 0', fontSize: '0.72rem', color: MUTED_TEXT }}>
        {hasOutstanding ? 'outstanding' : 'nothing outstanding'}
      </p>
      {Number(balance.paid) > 0 && (
        <p style={{ margin: '6px 0 0', fontSize: '0.72rem', color: MUTED_TEXT, borderTop: `1px solid ${DIVIDER}`, paddingTop: 6 }}>
          {formatMoney(balance.paid, balance.currency)} paid to date
        </p>
      )}
    </div>
  )
}

// The full "Balance" section (heading + the wrapping flex-wrap row of
// cards) — both callers render this exact same heading text and layout,
// so the wrapper itself is shared too, not just the individual card.
export default function BalancesSection({ balances }) {
  if (balances.length === 0) return null
  return (
    <section>
      <h2 style={sectionTitleStyle}>Balance</h2>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        {balances.map((balance) => <BalanceCard key={balance.currency} balance={balance} />)}
      </div>
    </section>
  )
}
