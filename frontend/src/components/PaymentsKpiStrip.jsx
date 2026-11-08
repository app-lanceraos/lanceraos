// src/components/PaymentsKpiStrip.jsx
//
// The three headline numbers of the Payments page (This month / This year / All time) plus one currency selector. They
// cover ALL of the person's payments and never change with the list filters below (Prompt 11, F1). Always three cards
// side by side at every width — type and padding shrink at 939px and 480px instead of the grid reflowing, the same
// approach as InvoiceKPIStrip.jsx (its <style> is not relied on; every class here is prefixed `pay-`).
// A refetch dims the cards, it never unmounts them; a failed request shows a message with Reload inside the strip while
// the list below keeps working.
import { AlertCircle, ArrowDown, ArrowUp, RefreshCw } from 'lucide-react'

import { CURRENCY_OPTIONS, formatMoney } from '@/pages/invoiceHelpers'
import { deltaView, paymentCountLabel } from '@/pages/paymentsHelpers'

export default function PaymentsKpiStrip({ summary, loading, error, currency, onCurrencyChange, onReload }) {
  const shown = currency || summary?.currency || ''
  const options = CURRENCY_OPTIONS.some((o) => o.value === shown) || !shown ? CURRENCY_OPTIONS : [{ value: shown, label: shown }, ...CURRENCY_OPTIONS]
  const cards = summary ? [
    { key: 'this_month', label: 'This month', data: summary.periods.this_month, delta: deltaView(summary.month_change_pct) },
    { key: 'this_year', label: 'This year', data: summary.periods.this_year },
    { key: 'all_time', label: 'All time', data: summary.periods.all_time },
  ] : [
    { key: 'this_month', label: 'This month' }, { key: 'this_year', label: 'This year' }, { key: 'all_time', label: 'All time' },
  ]

  return (
    <div style={{ marginBottom: 12 }}>
      <div className="pay-kpi-controls" style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <select
          value={shown} onChange={(e) => onCurrencyChange(e.target.value)} disabled={!shown}
          className="fos-input fos-select" aria-label="Show totals in"
          style={{ width: 'auto', minWidth: 100, fontSize: '0.78rem', padding: '6px 28px 6px 10px' }}
        >
          {!shown && <option value="">…</option>}
          {options.map((o) => <option key={o.value} value={o.value}>{o.value}</option>)}
        </select>
        <span style={{ fontSize: '0.74rem', color: 'var(--text-tertiary)' }}>All your payments, whatever the filters below</span>
      </div>

      {error && !summary ? (
        <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '14px 16px', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', color: 'var(--text-secondary)' }}>
          <AlertCircle size={16} aria-hidden="true" style={{ color: 'var(--status-amber-text)', flexShrink: 0 }} />
          <span style={{ fontSize: '0.84rem' }}>Couldn&apos;t load these figures.</span>
          <button type="button" className="fos-btn fos-btn-ghost" style={{ fontSize: '0.78rem', padding: '5px 10px' }} onClick={onReload}>
            <RefreshCw size={13} aria-hidden="true" /> Reload
          </button>
        </div>
      ) : (
        <div className="pay-kpi-strip" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, opacity: loading && summary ? 0.55 : 1, transition: 'opacity 0.15s ease' }}>
          {cards.map((card) => <KpiCard key={card.key} card={card} currency={shown} />)}
        </div>
      )}

      <style>{`
        @media (max-width: 939px) {
          .pay-kpi-strip { gap: 8px !important; }
          .pay-kpi-card { padding: 10px 10px !important; }
          .pay-kpi-label { font-size: 0.62rem !important; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
          .pay-kpi-value { font-size: 1rem !important; }
          .pay-kpi-count { font-size: 0.66rem !important; }
        }
        @media (max-width: 480px) {
          .pay-kpi-strip { gap: 5px !important; }
          .pay-kpi-card { padding: 7px 6px !important; border-radius: var(--radius-md) !important; }
          .pay-kpi-label { font-size: 0.52rem !important; }
          .pay-kpi-value { font-size: 0.8rem !important; }
          .pay-kpi-count { font-size: 0.56rem !important; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
          .pay-delta-full { display: none !important; }
          .pay-delta-compact { display: flex !important; }
        }
        @media (max-width: 768px) {
          .pay-kpi-controls select { min-width: 0 !important; }
        }
      `}</style>
    </div>
  )
}

function KpiCard({ card, currency }) {
  return (
    <div className="pay-kpi-card" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: '14px 16px', minWidth: 0 }}>
      <p className="pay-kpi-label" style={{ margin: 0, fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{card.label}</p>
      {card.data ? (
        <>
          <p className="pay-kpi-value" style={{ margin: '5px 0 2px', fontSize: '1.3rem', fontWeight: 800, color: 'var(--status-green-text)', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
            {formatMoney(card.data.total, currency)}
          </p>
          <p className="pay-kpi-count" style={{ margin: 0, fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>{paymentCountLabel(card.data.count)}</p>
          {card.delta && <Delta delta={card.delta} />}
        </>
      ) : (
        <div style={{ height: 34, marginTop: 6, background: 'var(--bg-surface-3)', borderRadius: 'var(--radius-sm)', animation: 'skeleton-pulse 1.4s ease-in-out infinite' }} />
      )}
    </div>
  )
}

function Delta({ delta }) {
  const color = delta.up ? 'var(--status-green-text)' : 'var(--status-red-text)'
  const Icon = delta.up ? ArrowUp : ArrowDown
  const compact = delta.text.split(' ')[0]
  return (
    <>
      <p className="pay-delta-full" style={{ margin: '4px 0 0', fontSize: '0.7rem', color, display: 'flex', alignItems: 'center', gap: 3 }}>
        <Icon size={11} aria-hidden="true" /><span>{delta.text}</span>
      </p>
      <p className="pay-delta-compact" style={{ margin: '4px 0 0', fontSize: '0.66rem', color, display: 'none', alignItems: 'center', gap: 2 }}>
        <Icon size={11} aria-hidden="true" /><span>{compact}</span>
      </p>
    </>
  )
}
