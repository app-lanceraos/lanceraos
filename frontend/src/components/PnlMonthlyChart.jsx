// src/components/PnlMonthlyChart.jsx
//
// Income against expenses, one pair of bars per month of the period (at most 60). Two series, so a legend is mandatory: it
// is plain HTML next to the chart (swatch + word), not Recharts' own, so it is real text for everyone. The colours are the
// validated green/blue pair that those two amounts already have on the Payments and Expenses pages. The SVG is invisible to
// assistive tech, so the chart is a role="img" with a one-sentence label saying the same figures are in the table below;
// that table is a visible, real <table> (MonthlyTable), not a second hidden copy. No net line: a negative net crosses the
// axis and a third mark makes the chart noisier than the table beside it.
import { AlertCircle, BarChart3, RefreshCw } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import useTheme from '@/hooks/useTheme'
import { COLLECTED_BAR_COLORS, compactNumber } from '@/pages/dashboardHelpers'
import { SPENT_BAR_COLORS } from '@/pages/expensesHelpers'
import { formatExact, pnlChartData, pnlChartLabel, pnlHasData, spansYears } from '@/pages/reportsHelpers'
import DashboardCard from './DashboardCard'

export default function PnlMonthlyChart({ data, loading, error, onReload }) {
  const { isDark } = useTheme()
  const mode = isDark ? 'dark' : 'light'
  const currency = data?.currency || ''
  return (
    <DashboardCard id="pnl-monthly-chart" title="Income and expenses by month" subtitle={currency ? `Money received and money spent, in ${currency}` : 'Money received and money spent'} className="pnl-chart">
      {!data && error ? (
        <p role="status" style={{ margin: 0, fontSize: '0.84rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <AlertCircle size={15} aria-hidden="true" style={{ color: 'var(--status-amber-text)' }} />
          Couldn&apos;t load this chart.
          <button type="button" className="fos-btn fos-btn-ghost" style={{ fontSize: '0.78rem', padding: '5px 10px' }} onClick={onReload}>
            <RefreshCw size={13} aria-hidden="true" /> Reload
          </button>
        </p>
      ) : !data ? (
        <div aria-busy={loading ? 'true' : undefined} style={{ height: 260, background: 'var(--bg-surface-3)', borderRadius: 'var(--radius-md)', animation: 'skeleton-pulse 1.4s ease-in-out infinite' }} />
      ) : !pnlHasData(data.monthly) ? (
        <div style={{ textAlign: 'center', padding: '28px 8px', color: 'var(--text-tertiary)' }}>
          <BarChart3 size={22} aria-hidden="true" style={{ marginBottom: 8, opacity: 0.5 }} />
          <p style={{ margin: 0, fontSize: '0.84rem' }}>No income or expenses in this period.</p>
        </div>
      ) : (
        <div style={{ opacity: loading ? 0.55 : 1, transition: 'opacity 0.15s ease' }}>
          <Legend incomeColor={COLLECTED_BAR_COLORS[mode]} expenseColor={SPENT_BAR_COLORS[mode]} />
          <ChartBody data={data} currency={currency} incomeColor={COLLECTED_BAR_COLORS[mode]} expenseColor={SPENT_BAR_COLORS[mode]} />
        </div>
      )}
    </DashboardCard>
  )
}

function Legend({ incomeColor, expenseColor }) {
  const item = (color, label) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
      <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 2, background: color, flexShrink: 0 }} />
      {label}
    </span>
  )
  return <div style={{ display: 'flex', gap: 16, marginBottom: 10 }}>{item(incomeColor, 'Income')}{item(expenseColor, 'Expenses')}</div>
}

function ChartBody({ data, currency, incomeColor, expenseColor }) {
  const rows = pnlChartData(data.monthly, spansYears(data.monthly))
  return (
    <div role="img" aria-label={pnlChartLabel(data.start, data.end, currency)} style={{ width: '100%', height: 260 }}>
      <ResponsiveContainer>
        <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2} accessibilityLayer={false}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }} axisLine={{ stroke: 'var(--border-subtle)' }} tickLine={false} minTickGap={12} />
          <YAxis tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }} axisLine={false} tickLine={false} tickFormatter={compactNumber} width={48} />
          <Tooltip
            cursor={{ fill: 'var(--bg-surface-3)', opacity: 0.5 }}
            labelFormatter={(_label, payload) => payload?.[0]?.payload?.full ?? _label}
            formatter={(value, name) => [formatExact(value, currency), name]}
            contentStyle={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', fontSize: '0.8rem' }}
            labelStyle={{ color: 'var(--text-primary)', fontWeight: 600 }}
          />
          <Bar dataKey="income" name="Income" fill={incomeColor} radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} />
          <Bar dataKey="expenses" name="Expenses" fill={expenseColor} radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
