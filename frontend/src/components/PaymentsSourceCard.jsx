// src/components/PaymentsSourceCard.jsx
//
// "Where this year's income came from": one row per source with its converted total, how many payments, and a thin bar
// whose width is the share of the largest row. One neutral fill — the numbers carry the meaning, never colour.
import { PieChart } from 'lucide-react'

import { formatMoney } from '@/pages/invoiceHelpers'
import { bySourceBars, paymentCountLabel } from '@/pages/paymentsHelpers'
import DashboardCard from './DashboardCard'

export default function PaymentsSourceCard({ summary }) {
  const rows = bySourceBars(summary?.by_source)
  const currency = summary?.currency || ''
  return (
    <DashboardCard id="payments-by-source" title="Where this year's income came from" subtitle="By source, this calendar year" className="pay-source">
      {!summary ? (
        <div style={{ height: 120, background: 'var(--bg-surface-3)', borderRadius: 'var(--radius-md)', animation: 'skeleton-pulse 1.4s ease-in-out infinite' }} />
      ) : rows.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '20px 8px', color: 'var(--text-tertiary)' }}>
          <PieChart size={22} aria-hidden="true" style={{ marginBottom: 8, opacity: 0.5 }} />
          <p style={{ margin: 0, fontSize: '0.84rem' }}>No payments this year yet.</p>
        </div>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {rows.map((row) => (
            <li key={row.source}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
                <span style={{ fontSize: '0.84rem', fontWeight: 600, color: 'var(--text-primary)' }}>{row.label}</span>
                <span style={{ fontSize: '0.84rem', fontWeight: 700, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{formatMoney(row.total, currency)}</span>
              </div>
              <div aria-hidden="true" style={{ height: 6, margin: '5px 0 3px', background: 'var(--bg-surface-3)', borderRadius: 'var(--radius-full)', overflow: 'hidden' }}>
                <div style={{ width: `${row.widthPct}%`, height: '100%', background: 'var(--accent)', borderRadius: 'var(--radius-full)' }} />
              </div>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>{paymentCountLabel(row.count)}</span>
            </li>
          ))}
        </ul>
      )}
    </DashboardCard>
  )
}
