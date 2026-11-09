// src/components/PnlKpiStrip.jsx
//
// The three headline numbers of the Profit and Loss page: Income received, Expenses, Net profit / Net loss. All three are
// server figures shown with their exact cents (the PDF prints the same cents). They are a calculation, not good or bad
// news, so the values are the plain text colour: a loss is shown by the label ("Net loss"), the minus sign and the words,
// never by red (the same rule as the Expenses page). The grid is auto-fit: three across when there is room, two or one when
// there is not; the main area's width depends on whether the sidebar is open, so a fixed breakpoint cannot be right.
// A refetch dims the cards, it never unmounts them.
import { AlertCircle, RefreshCw } from 'lucide-react'

import { expenseCountLabel } from '@/pages/expensesHelpers'
import { paymentCountLabel } from '@/pages/paymentsHelpers'
import { formatExact, marginLine, netView } from '@/pages/reportsHelpers'

export default function PnlKpiStrip({ data, loading, error, onReload }) {
  if (!data && error) {
    return (
      <div role="status" className="pnl-kpi-error" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '14px 16px', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', color: 'var(--text-secondary)' }}>
        <AlertCircle size={16} aria-hidden="true" style={{ color: 'var(--status-amber-text)', flexShrink: 0 }} />
        <span style={{ fontSize: '0.84rem' }}>Couldn&apos;t load these figures.</span>
        <button type="button" className="fos-btn fos-btn-ghost" style={{ fontSize: '0.78rem', padding: '5px 10px' }} onClick={onReload}>
          <RefreshCw size={13} aria-hidden="true" /> Reload
        </button>
      </div>
    )
  }

  let cards
  if (data) {
    const code = data.currency
    const net = netView(data.net)
    cards = [
      { key: 'income', label: 'Income received', value: formatExact(data.income.total, code), lines: [paymentCountLabel(data.income.count)] },
      {
        key: 'expenses', label: 'Expenses', value: formatExact(data.expenses.total, code),
        lines: [expenseCountLabel(data.expenses.count), `${formatExact(data.expenses.deductible_total, code)} marked deductible`],
      },
      { key: 'net', label: net.label, value: formatExact(data.net.total, code), lines: [marginLine(data.net)] },
    ]
  } else {
    cards = [{ key: 'income', label: 'Income received' }, { key: 'expenses', label: 'Expenses' }, { key: 'net', label: 'Net profit' }]
  }

  return (
    <div
      className="pnl-kpi-strip" aria-busy={loading ? 'true' : undefined}
      style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, opacity: loading && data ? 0.55 : 1, transition: 'opacity 0.15s ease' }}
    >
      {cards.map((card) => (
        <div key={card.key} className="pnl-kpi-card" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: '14px 16px', minWidth: 0 }}>
          <p className="pnl-kpi-label" style={{ margin: 0, fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{card.label}</p>
          {card.value !== undefined ? (
            <>
              <p className="pnl-kpi-value" style={{ margin: '6px 0 4px', fontSize: '1.3rem', fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.15, fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere' }}>{card.value}</p>
              {card.lines.map((line) => (
                <p key={line} style={{ margin: '2px 0 0', fontSize: '0.74rem', color: 'var(--text-tertiary)', fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere' }}>{line}</p>
              ))}
            </>
          ) : (
            <div style={{ height: 50, marginTop: 6, background: 'var(--bg-surface-3)', borderRadius: 'var(--radius-sm)', animation: 'skeleton-pulse 1.4s ease-in-out infinite' }} />
          )}
        </div>
      ))}
    </div>
  )
}
