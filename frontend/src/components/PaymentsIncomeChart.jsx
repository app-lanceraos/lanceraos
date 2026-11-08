// src/components/PaymentsIncomeChart.jsx
//
// Twelve months of money received, one bar per month — built like DashboardIncomeChart: one series so no legend, the
// colour from the shared COLLECTED_BAR_COLORS pair (plain hex, because Recharts writes it into SVG attributes). The SVG
// is invisible to assistive tech, so the chart is a role="img" with a one-sentence label and the twelve values are ALSO
// in a visually-hidden table placed NEXT to it (a table inside role="img" would be flattened away).
import { BarChart3 } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import useTheme from '@/hooks/useTheme'
import { formatMoney } from '@/pages/invoiceHelpers'
import { COLLECTED_BAR_COLORS, compactNumber, visuallyHidden } from '@/pages/dashboardHelpers'
import { monthlyChartData, monthlyHasData, monthlySummary } from '@/pages/paymentsHelpers'
import DashboardCard from './DashboardCard'

export default function PaymentsIncomeChart({ summary, error, onReload }) {
  const { isDark } = useTheme()
  const color = COLLECTED_BAR_COLORS[isDark ? 'dark' : 'light']
  const currency = summary?.currency || ''

  return (
    <DashboardCard id="payments-income" title="Income, last 12 months" subtitle={currency ? `Money received, shown in ${currency}` : 'Money received'} className="pay-chart">
      {!summary && error ? (
        <p role="status" style={{ margin: 0, fontSize: '0.84rem', color: 'var(--text-secondary)' }}>
          Couldn&apos;t load this chart.{' '}
          <button type="button" className="fos-btn fos-btn-ghost" style={{ fontSize: '0.78rem', padding: '5px 10px' }} onClick={onReload}>Reload</button>
        </p>
      ) : !summary ? (
        <div style={{ height: 240, background: 'var(--bg-surface-3)', borderRadius: 'var(--radius-md)', animation: 'skeleton-pulse 1.4s ease-in-out infinite' }} />
      ) : !monthlyHasData(summary.monthly) ? (
        <div style={{ textAlign: 'center', padding: '28px 8px', color: 'var(--text-tertiary)' }}>
          <BarChart3 size={22} aria-hidden="true" style={{ marginBottom: 8, opacity: 0.5 }} />
          <p style={{ margin: 0, fontSize: '0.84rem' }}>No payments in the last 12 months.</p>
        </div>
      ) : (
        <ChartBody monthly={summary.monthly} currency={currency} color={color} />
      )}
    </DashboardCard>
  )
}

function ChartBody({ monthly, currency, color }) {
  const data = monthlyChartData(monthly)
  return (
    <>
      <div role="img" aria-label={monthlySummary(monthly, currency)} style={{ width: '100%', height: 240 }}>
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} accessibilityLayer={false}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }} axisLine={{ stroke: 'var(--border-subtle)' }} tickLine={false} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }} axisLine={false} tickLine={false} tickFormatter={compactNumber} width={48} />
            <Tooltip
              cursor={{ fill: 'var(--bg-surface-3)', opacity: 0.5 }}
              labelFormatter={(_label, payload) => payload?.[0]?.payload?.full ?? _label}
              formatter={(value) => [formatMoney(value, currency), 'Received']}
              contentStyle={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', fontSize: '0.8rem' }}
              labelStyle={{ color: 'var(--text-primary)', fontWeight: 600 }}
            />
            <Bar dataKey="value" name="Received" fill={color} radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <table style={visuallyHidden}>
        <caption>{`Money received per month, in ${currency}`}</caption>
        <thead><tr><th scope="col">Month</th><th scope="col">Received</th></tr></thead>
        <tbody>
          {data.map((row) => (
            <tr key={row.key}><th scope="row">{row.full}</th><td>{formatMoney(row.value, currency)}</td></tr>
          ))}
        </tbody>
      </table>
    </>
  )
}
