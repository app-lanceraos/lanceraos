// src/components/InvoiceKPIStrip.jsx
//
// The 3 dashboard KPI cards (Outstanding / Overdue / Collected) plus
// their own period + currency controls — List/Table restructure pass.
// Scoped ONLY to these 3 cards: the period/currency selectors here never
// touch the invoice list below (that has its own independent currency
// FILTER and no period concept at all — two different controls for two
// different purposes, see Invoices.jsx's own filter row).
//
// "Total Paid" is now labeled "Collected" and "Past-Due" is now labeled
// "Overdue" — display-only renames; the backend response keys
// (total_paid/past_due) are unchanged, see DECISIONS.md. Only Collected
// shows a month-over-month delta, and only when period=this_month (the
// one case where "vs last month" reads as coherent next to the
// displayed figure) — Outstanding/Overdue never get one, deliberately:
// a delta on a balance-type figure would need a historical snapshot
// that doesn't exist and risks showing a confidently wrong number.
//
// Real, reported bug this pass: the mobile layout used to be a
// horizontally-swipeable carousel (one card at ~82% width, the other two
// requiring a swipe/scroll to reach) — the actual complaint was that all
// 3 KPIs should be visible AT ONCE on any device, never requiring a
// scroll to see the others. The swipeable row is removed entirely;
// there's now exactly one grid, always exactly 3 columns side by side,
// with typography/padding that scales down at narrower widths instead of
// the layout itself changing shape. Below a phone-width breakpoint the
// Collected card's delta line also drops to just the arrow + percentage
// (no "vs last month" / amount text) — the fuller text still fits fine
// at tablet width and above, so it's kept there.
import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'

import api from '@/lib/api'
import { CURRENCY_OPTIONS, formatMoney } from '@/pages/clientHelpers'

const PERIOD_OPTIONS = [
  { value: 'this_month', label: 'This Month' },
  { value: 'last_6_months', label: 'Last 6 Months' },
  { value: 'this_year', label: 'This Year' },
  { value: 'all_time', label: 'All Time' },
]

export default function InvoiceKPIStrip() {
  const [period, setPeriod] = useState('this_month')
  const [currency, setCurrency] = useState('')
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    const params = { period }
    if (currency) params.currency = currency
    api.get('/invoices/summary/', { params })
      .then(({ data }) => { setSummary(data); if (!currency) setCurrency(data.currency) })
      .catch(() => setSummary(null))
      .finally(() => setLoading(false))
  }, [period, currency]) // eslint-disable-line react-hooks/exhaustive-deps

  const cards = [
    { key: 'outstanding', label: 'Outstanding', data: summary?.outstanding, hint: 'Sent, viewed, or partially paid — not yet resolved', statusKey: 'amber' },
    { key: 'total_paid', label: 'Collected', data: summary?.total_paid, hint: 'Payments received in this window', statusKey: 'green', showDelta: period === 'this_month' },
    { key: 'past_due', label: 'Overdue', data: summary?.past_due, hint: 'Outstanding + overdue', statusKey: 'red' },
  ]
  const effectiveCurrency = currency || summary?.currency || 'USD'

  return (
    <div style={{ marginBottom: 20 }}>
      <KPIControls period={period} onPeriodChange={setPeriod} currency={effectiveCurrency} onCurrencyChange={setCurrency} />

      {/* Always exactly 3 columns, side by side, at every viewport width —
          never a scroll/swipe to see the other cards. Typography/padding
          scale down at narrower widths (see the media queries below)
          instead of the grid itself reflowing. */}
      <div className="kpi-strip" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        {cards.map((c) => <KPICard key={c.key} card={c} loading={loading} currency={effectiveCurrency} />)}
      </div>

      <style>{`
        @media (max-width: 939px) {
          .kpi-strip { gap: 8px !important; }
          .kpi-card { padding: 10px 10px !important; }
          .kpi-card-label { font-size: 0.62rem !important; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
          .kpi-card-value { font-size: 1rem !important; }
          .kpi-card-count { font-size: 0.66rem !important; }
        }
        @media (max-width: 480px) {
          .kpi-strip { gap: 5px !important; }
          .kpi-card { padding: 7px 6px !important; border-radius: var(--radius-md) !important; }
          .kpi-card-label { font-size: 0.52rem !important; }
          .kpi-card-value { font-size: 0.8rem !important; }
          .kpi-card-count { font-size: 0.56rem !important; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
          .kpi-delta-full { display: none !important; }
          .kpi-delta-compact { display: flex !important; }
        }
      `}</style>
    </div>
  )
}

function KPIControls({ period, onPeriodChange, currency, onCurrencyChange }) {
  return (
    <div className="kpi-controls" style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
      <select
        value={period} onChange={(e) => onPeriodChange(e.target.value)}
        className="fos-input fos-select"
        aria-label="KPI period"
        style={{ width: 'auto', minWidth: 150, fontSize: '0.78rem', padding: '6px 28px 6px 10px' }}
      >
        {PERIOD_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <select
        value={currency} onChange={(e) => onCurrencyChange(e.target.value)}
        className="fos-input fos-select"
        aria-label="KPI currency"
        style={{ width: 'auto', minWidth: 100, fontSize: '0.78rem', padding: '6px 28px 6px 10px' }}
      >
        {CURRENCY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.value}</option>)}
      </select>
      <style>{`
        @media (max-width: 768px) {
          .kpi-controls select { flex: 1; min-width: 0 !important; }
        }
      `}</style>
    </div>
  )
}

function KPICard({ card, loading, currency }) {
  return (
    <div className="kpi-card" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: '14px 16px', height: '100%' }}>
      <p className="kpi-card-label" style={{ margin: 0, fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{card.label}</p>
      {!loading && card.data ? (
        <>
          <p className="kpi-card-value" style={{ margin: '5px 0 2px', fontSize: '1.3rem', fontWeight: 800, color: `var(--status-${card.statusKey}-text)`, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
            {formatMoney(card.data.total, currency)}
          </p>
          <p className="kpi-card-count" style={{ margin: 0, fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>
            {card.data.count ?? 0} invoice{card.data.count !== 1 ? 's' : ''}
            {card.data.unconverted_count > 0 && ` · ${card.data.unconverted_count} excluded (no exchange rate)`}
          </p>
          {card.showDelta && card.data.delta && <DeltaIndicator delta={card.data.delta} currency={currency} />}
        </>
      ) : (
        <div style={{ height: 34, marginTop: 6, background: 'var(--bg-surface-3)', borderRadius: 'var(--radius-sm)', animation: 'skeleton-pulse 1.4s ease-in-out infinite' }} />
      )}
    </div>
  )
}

function DeltaIndicator({ delta, currency }) {
  const pct = delta.pct_change
  const amount = Number(delta.amount_change || 0)
  if (pct === null && amount === 0) return null // no prior-month AND no current-month data — nothing meaningful to show

  const isUp = amount >= 0
  const color = isUp ? 'var(--status-green-text)' : 'var(--status-red-text)'
  const Icon = isUp ? ArrowUp : ArrowDown

  const changeLabel = pct !== null ? `${Math.abs(pct).toFixed(1)}% vs last month` : 'New vs last month'
  const amountLabel = pct !== null ? ` (${isUp ? '+' : '−'}${formatMoney(Math.abs(amount), currency)})` : ''
  const pctLabel = pct !== null ? `${Math.abs(pct).toFixed(1)}%` : 'New'

  return (
    <>
      {/* Full text — "12.3% vs last month (+$150)" — fits comfortably
          from tablet width up; hidden below the phone breakpoint (see
          this file's own media queries) in favor of the compact variant
          right below. Both are always rendered — CSS toggles which is
          visible, matching this component's existing responsive
          convention rather than a JS width check. */}
      <p className="kpi-delta-full" style={{ margin: '4px 0 0', fontSize: '0.7rem', color, display: 'flex', alignItems: 'center', gap: 3 }}>
        <Icon size={11} />
        <span>{changeLabel}{amountLabel}</span>
      </p>
      {/* Compact — just the arrow + percentage, no "vs last month" text —
          the only thing that reliably fits a ~1/3-viewport-wide card at
          phone width. */}
      <p className="kpi-delta-compact" style={{ margin: '4px 0 0', fontSize: '0.66rem', color, display: 'none', alignItems: 'center', gap: 2 }}>
        <Icon size={11} />
        <span>{pctLabel}</span>
      </p>
    </>
  )
}
