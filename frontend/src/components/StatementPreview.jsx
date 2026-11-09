// src/components/StatementPreview.jsx
//
// "What the statement will show": the same figures the PDF prints, straight from GET /payments/income-certificate/. The page
// never adds or converts anything — the totals row of the month table is the server's own total. Four states: ready,
// partly unconverted (ready, plus the PDF's note), unconvertible (payments exist but none could be converted: the totals are
// replaced by an explanation and only the original-currency list is shown) and empty (no payments at all).
import { AlertCircle, Receipt, RefreshCw } from 'lucide-react'
import { Link } from 'react-router-dom'

import { monthLong } from '@/pages/dashboardHelpers'
import { paymentCountLabel } from '@/pages/paymentsHelpers'
import {
  UNCONVERTIBLE_BODY, formatExact, plainAmount, statementNotes, statementState, unconvertibleHeading,
} from '@/pages/reportsHelpers'
import DashboardCard from './DashboardCard'
import MonthlyTable from './MonthlyTable'

export default function StatementPreview({ data, loading, error, onReload }) {
  const state = data ? statementState(data) : null
  return (
    <DashboardCard id="stm-preview" title="What the statement will show" subtitle="The same figures as the PDF" className="stm-preview">
      {!data && error ? (
        <p role="status" style={{ margin: 0, fontSize: '0.84rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <AlertCircle size={15} aria-hidden="true" style={{ color: 'var(--status-amber-text)' }} />
          {error}
          <button type="button" className="fos-btn fos-btn-ghost" style={{ fontSize: '0.78rem', padding: '5px 10px' }} onClick={onReload}>
            <RefreshCw size={13} aria-hidden="true" /> Reload
          </button>
        </p>
      ) : !data ? (
        <div aria-busy={loading ? 'true' : undefined} style={{ height: 180, background: 'var(--bg-surface-3)', borderRadius: 'var(--radius-md)', animation: 'skeleton-pulse 1.4s ease-in-out infinite' }} />
      ) : state === 'empty' ? (
        <div style={{ textAlign: 'center', padding: '28px 8px' }}>
          <Receipt size={24} aria-hidden="true" style={{ color: 'var(--text-tertiary)', marginBottom: 10 }} />
          <p style={{ margin: 0, fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.95rem' }}>No payments in this period</p>
          <p style={{ margin: '8px 0 0', fontSize: '0.82rem', color: 'var(--text-tertiary)' }}>
            Record or import your payments on the <Link to="/payments" style={{ color: 'var(--accent)', fontWeight: 600 }}>Payments</Link> page, then come back.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 22, opacity: loading ? 0.55 : 1, transition: 'opacity 0.15s ease' }}>
          {state === 'unconvertible' ? (
            <div style={{ padding: '14px 16px', background: 'var(--bg-surface-2)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)' }}>
              <p style={{ margin: 0, fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.92rem' }}>{unconvertibleHeading(data.unconverted_count)}</p>
              <p style={{ margin: '6px 0 0', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{UNCONVERTIBLE_BODY}</p>
            </div>
          ) : (
            <Totals data={data} />
          )}

          {state !== 'unconvertible' && (
            <>
              <MonthlyTable
                bare id="stm-months" title="Month by month" caption="Payments counted and the amount received in each month, in USD and as a PKR equivalent"
                columns={[
                  { key: 'month', label: 'Month' }, { key: 'count', label: 'Payments', align: 'right' },
                  { key: 'usd', label: 'USD', align: 'right' }, { key: 'pkr', label: 'PKR equivalent', align: 'right' },
                ]}
                rows={data.monthly.map((m) => ({ key: m.month, cells: { month: monthLong(m.month), count: String(m.count), usd: plainAmount(m.usd), pkr: plainAmount(m.pkr) } }))}
                footer={{ cells: { month: 'Total', count: String(data.count), usd: plainAmount(data.total.usd), pkr: plainAmount(data.total.pkr) } }}
              />
              <MonthlyTable
                bare id="stm-sources" title="By source" caption="Payments counted and the amount received from each source, in USD and as a PKR equivalent"
                columns={[
                  { key: 'source', label: 'Source' }, { key: 'count', label: 'Payments', align: 'right' },
                  { key: 'usd', label: 'USD', align: 'right' }, { key: 'pkr', label: 'PKR equivalent', align: 'right' },
                ]}
                rows={data.by_source.map((s) => ({ key: s.source, cells: { source: s.label, count: String(s.count), usd: plainAmount(s.usd), pkr: plainAmount(s.pkr) } }))}
              />
            </>
          )}

          <MonthlyTable
            bare id="stm-currencies" title="Received in these currencies" caption="Payments counted and the amount received in each original currency"
            columns={[
              { key: 'currency', label: 'Currency' }, { key: 'count', label: 'Payments', align: 'right' }, { key: 'amount', label: 'Amount received', align: 'right' },
            ]}
            rows={data.by_currency.map((c) => ({ key: c.currency, cells: { currency: c.currency, count: String(c.count), amount: formatExact(c.amount, c.currency) } }))}
            minWidth={380}
          />

          <section aria-labelledby="stm-notes-title">
            <h3 id="stm-notes-title" style={{ margin: '0 0 8px', fontSize: '0.88rem', fontWeight: 700, fontFamily: "'DM Sans', sans-serif", color: 'var(--text-primary)' }}>Notes</h3>
            <ol style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
              {statementNotes(data, data.start, data.end).map((note) => <li key={note} style={{ overflowWrap: 'anywhere' }}>{note}</li>)}
            </ol>
          </section>
        </div>
      )}
    </DashboardCard>
  )
}

function Totals({ data }) {
  const stat = (label, value) => (
    <div style={{ minWidth: 0 }}>
      <p style={{ margin: 0, fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</p>
      <p style={{ margin: '6px 0 0', fontSize: '1.2rem', fontWeight: 800, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere' }}>{value}</p>
    </div>
  )
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 16, padding: '14px 16px', background: 'var(--bg-surface-2)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)' }}>
      {stat('Total received (USD)', formatExact(data.total.usd, 'USD'))}
      {stat('PKR equivalent', formatExact(data.total.pkr, 'PKR'))}
      {stat('Payments counted', paymentCountLabel(data.count))}
    </div>
  )
}
