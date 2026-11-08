// src/components/ExpensesKpiStrip.jsx
//
// The three headline numbers of the Expenses page (This month / This year / All time) plus one currency selector, built
// like PaymentsKpiStrip (Prompt 15): always three cards side by side at every width — type and padding shrink at 939px
// and 480px instead of the grid reflowing; every class is prefixed `exp-`. They cover ALL of the person's expenses and
// never change with the list filters below. A refetch dims the cards, it never unmounts them; a failed request shows a
// message with Reload inside the strip while the list below keeps working.
//
// Colour (decision X9): spending is neither good nor bad news, so the totals are plain text colour and the "vs last month"
// arrow is the secondary text colour whether it points up or down — never the green/red status tokens, which are reserved
// for state.
import { AlertCircle, ArrowDown, ArrowUp, RefreshCw } from 'lucide-react'

import { CURRENCY_OPTIONS, formatMoney } from '@/pages/invoiceHelpers'
import { deltaView } from '@/pages/paymentsHelpers'
import { deductibleLine, expenseCountLabel } from '@/pages/expensesHelpers'

export default function ExpensesKpiStrip({ summary, loading, error, currency, onCurrencyChange, onReload }) {
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
      <div className="exp-kpi-controls" style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <select
          value={shown} onChange={(e) => onCurrencyChange(e.target.value)} disabled={!shown}
          className="fos-input fos-select" aria-label="Show totals in"
          style={{ width: 'auto', minWidth: 100, fontSize: '0.78rem', padding: '6px 28px 6px 10px' }}
        >
          {!shown && <option value="">…</option>}
          {options.map((o) => <option key={o.value} value={o.value}>{o.value}</option>)}
        </select>
        <span style={{ fontSize: '0.74rem', color: 'var(--text-tertiary)' }}>All your expenses, whatever the filters below</span>
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
        <div className="exp-kpi-strip" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, opacity: loading && summary ? 0.55 : 1, transition: 'opacity 0.15s ease' }}>
          {cards.map((card) => <KpiCard key={card.key} card={card} currency={shown} />)}
        </div>
      )}

      <style>{`
        @media (max-width: 939px) {
          .exp-kpi-strip { gap: 8px !important; }
          .exp-kpi-card { padding: 10px 10px !important; }
          .exp-kpi-label { font-size: 0.62rem !important; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
          .exp-kpi-value { font-size: 1rem !important; }
          .exp-kpi-count { font-size: 0.66rem !important; }
          .exp-kpi-deductible { font-size: 0.62rem !important; }
        }
        @media (max-width: 480px) {
          .exp-kpi-strip { gap: 5px !important; }
          .exp-kpi-card { padding: 7px 6px !important; border-radius: var(--radius-md) !important; }
          .exp-kpi-label { font-size: 0.52rem !important; }
          .exp-kpi-value { font-size: 0.8rem !important; }
          .exp-kpi-count { font-size: 0.56rem !important; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
          .exp-kpi-deductible { font-size: 0.52rem !important; overflow-wrap: anywhere; } /* wraps, never truncated: it says what the figure is */
          .exp-delta-full { display: none !important; }
          .exp-delta-compact { display: flex !important; }
        }
        @media (max-width: 768px) {
          .exp-kpi-controls select { min-width: 0 !important; }
        }
      `}</style>
    </div>
  )
}

function KpiCard({ card, currency }) {
  return (
    <div className="exp-kpi-card" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: '14px 16px', minWidth: 0 }}>
      <p className="exp-kpi-label" style={{ margin: 0, fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{card.label}</p>
      {card.data ? (
        <>
          <p className="exp-kpi-value" style={{ margin: '5px 0 2px', fontSize: '1.3rem', fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
            {formatMoney(card.data.total, currency)}
          </p>
          <p className="exp-kpi-count" style={{ margin: 0, fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>{expenseCountLabel(card.data.count)}</p>
          <p className="exp-kpi-deductible" style={{ margin: '2px 0 0', fontSize: '0.68rem', color: 'var(--text-tertiary)', fontVariantNumeric: 'tabular-nums' }}>{deductibleLine(card.data, currency)}</p>
          {card.delta && <Delta delta={card.delta} />}
        </>
      ) : (
        <div style={{ height: 50, marginTop: 6, background: 'var(--bg-surface-3)', borderRadius: 'var(--radius-sm)', animation: 'skeleton-pulse 1.4s ease-in-out infinite' }} />
      )}
    </div>
  )
}

// The direction is shown by the arrow alone; both directions use the same neutral colour.
function Delta({ delta }) {
  const color = 'var(--text-secondary)'
  const Icon = delta.up ? ArrowUp : ArrowDown
  const compact = delta.text.split(' ')[0]
  return (
    <>
      <p className="exp-delta-full" style={{ margin: '4px 0 0', fontSize: '0.7rem', color, display: 'flex', alignItems: 'center', gap: 3 }}>
        <Icon size={11} aria-hidden="true" /><span>{delta.text}</span>
      </p>
      <p className="exp-delta-compact" style={{ margin: '4px 0 0', fontSize: '0.66rem', color, display: 'none', alignItems: 'center', gap: 2 }}>
        <Icon size={11} aria-hidden="true" /><span>{compact}</span>
      </p>
    </>
  )
}
