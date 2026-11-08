// src/components/DashboardIncomeChart.jsx
//
// Six months of money actually collected, one bar per month. One series, so no legend; the heading names it.
// Colours are the validated --chart-series-collected pair mirrored as plain hex (Recharts writes them into SVG
// attributes, where var() does not resolve reliably) — same approach as InvoiceAnalytics.jsx.
//
// Accessibility: the SVG is not readable by assistive tech, so the chart is a role="img" with a one-sentence
// label, and the six values are ALSO in a visually-hidden table placed NEXT to it (a table inside role="img"
// would be flattened away).
import { BarChart3 } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import useTheme from '@/hooks/useTheme'
import { formatMoney } from '@/pages/invoiceHelpers'
import {
  COLLECTED_BAR_COLORS, compactNumber, paymentNote, trendChartData, trendHasData, trendSummary, visuallyHidden,
} from '@/pages/dashboardHelpers'
import DashboardCard from './DashboardCard'
import DashboardUnavailable from './DashboardUnavailable'

export default function DashboardIncomeChart({ trend, currency, onReload, className }) {
  const { isDark } = useTheme()
  const color = COLLECTED_BAR_COLORS[isDark ? 'dark' : 'light']

  return (
    <DashboardCard id="income" title="Income, last 6 months" subtitle={`Money collected, shown in ${currency} at today's exchange rate`} className={className}>
      {!trend?.available ? (
        <DashboardUnavailable onReload={onReload} />
      ) : !trendHasData(trend.months) ? (
        <div style={{ textAlign: 'center', padding: '28px 8px', color: 'var(--text-tertiary)' }}>
          <BarChart3 size={22} aria-hidden="true" style={{ marginBottom: 8, opacity: 0.5 }} />
          <p style={{ margin: 0, fontSize: '0.84rem' }}>No payments recorded in the last 6 months.</p>
        </div>
      ) : (
        <ChartBody trend={trend} currency={currency} color={color} />
      )}
    </DashboardCard>
  )
}

function ChartBody({ trend, currency, color }) {
  const data = trendChartData(trend.months)
  return (
    <>
      <div role="img" aria-label={trendSummary(trend.months, currency)} style={{ width: '100%', height: 240 }}>
        <ResponsiveContainer>
          {/* accessibilityLayer off: Recharts would make the SVG itself tabbable, and a focusable element inside a
              role="img" is a nested-interactive violation. The label + the table beside it carry the data. */}
          <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} accessibilityLayer={false}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }} axisLine={{ stroke: 'var(--border-subtle)' }} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }} axisLine={false} tickLine={false} tickFormatter={compactNumber} width={48} />
            <Tooltip
              cursor={{ fill: 'var(--bg-surface-3)', opacity: 0.5 }}
              labelFormatter={(_label, payload) => payload?.[0]?.payload?.full ?? _label}
              formatter={(value) => [formatMoney(value, currency), 'Collected']}
              contentStyle={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', fontSize: '0.8rem' }}
              labelStyle={{ color: 'var(--text-primary)', fontWeight: 600 }}
            />
            <Bar dataKey="value" name="Collected" fill={color} radius={[4, 4, 0, 0]} maxBarSize={44} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <table style={visuallyHidden}>
        <caption>{`Money collected per month, in ${currency}`}</caption>
        <thead><tr><th scope="col">Month</th><th scope="col">Collected</th></tr></thead>
        <tbody>
          {data.map((row) => (
            <tr key={row.key}><th scope="row">{row.full}</th><td>{formatMoney(row.value, currency)}</td></tr>
          ))}
        </tbody>
      </table>
      {trend.unconverted_count > 0 && (
        <p style={{ margin: '8px 0 0', fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>{paymentNote(trend.unconverted_count)}</p>
      )}
    </>
  )
}
