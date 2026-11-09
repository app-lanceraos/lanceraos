// src/components/BreakdownCard.jsx
//
// One row per group (source, category...) with its converted total, how many records, and a thin bar whose width is the
// share of the largest row. One neutral fill: the numbers carry the meaning, never colour. Promoted from the by-source card
// (Payments), the by-category card (Expenses) and the P&L's two cards, the rule of three recorded as X3 in Prompt 15.
//
// `rows` is [{ key, label, total, count }]: the caller maps its own shape. `formatAmount(total, currency)` defaults to whole
// units (the cards on the Payments and Expenses pages); the report pages pass exact cents.
import { formatMoney } from '@/pages/invoiceHelpers'
import { bySourceBars } from '@/pages/paymentsHelpers'
import DashboardCard from './DashboardCard'

export default function BreakdownCard({
  id, className, title, subtitle, rows, currency, loading, countLabel, emptyIcon: EmptyIcon, emptyText, formatAmount = formatMoney,
}) {
  const bars = bySourceBars(rows)
  return (
    <DashboardCard id={id} title={title} subtitle={subtitle} className={className}>
      {loading ? (
        <div style={{ height: 120, background: 'var(--bg-surface-3)', borderRadius: 'var(--radius-md)', animation: 'skeleton-pulse 1.4s ease-in-out infinite' }} />
      ) : bars.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '20px 8px', color: 'var(--text-tertiary)' }}>
          {EmptyIcon && <EmptyIcon size={22} aria-hidden="true" style={{ marginBottom: 8, opacity: 0.5 }} />}
          <p style={{ margin: 0, fontSize: '0.84rem' }}>{emptyText}</p>
        </div>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {bars.map((row) => (
            <li key={row.key}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
                <span style={{ fontSize: '0.84rem', fontWeight: 600, color: 'var(--text-primary)', minWidth: 0, overflowWrap: 'anywhere' }}>{row.label}</span>
                <span style={{ fontSize: '0.84rem', fontWeight: 700, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{formatAmount(row.total, currency)}</span>
              </div>
              <div aria-hidden="true" style={{ height: 6, margin: '5px 0 3px', background: 'var(--bg-surface-3)', borderRadius: 'var(--radius-full)', overflow: 'hidden' }}>
                <div style={{ width: `${row.widthPct}%`, height: '100%', background: 'var(--accent)', borderRadius: 'var(--radius-full)' }} />
              </div>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>{countLabel(row.count)}</span>
            </li>
          ))}
        </ul>
      )}
    </DashboardCard>
  )
}
