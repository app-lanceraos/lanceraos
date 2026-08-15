// src/pages/InvoiceAnalytics.jsx
//
// Step 18 — the cross-invoice analytics dashboard, distinct from
// Invoices.jsx's own simple KPI strip (SummaryStrip). Genuinely new
// charts: month-over-month invoiced/collected trend, top clients by
// revenue, currency breakdown with one real anchor-currency-unified USD
// total. Recharts is this app's first real chart — CLAUDE.md's own tech
// stack already named it (Module 9 Dashboard, Module 5 Health Score),
// just never installed until this step needed one.
//
// Colors: a real, validated 2-slot categorical pair (dataviz skill —
// scripts/validate_palette.js), not a reuse of the --status-* tokens
// (reserved for state) or a single guessed hue. Defined as
// --chart-series-invoiced/--chart-series-collected in theme.css, with
// real light/dark steps of the same pair — read here via useTheme()
// rather than relying on var() resolving inside an SVG stroke/fill
// attribute (inconsistent across browsers), same reasoning most
// Recharts-in-React apps land on.
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, TrendingUp, Users, Coins } from 'lucide-react'
import {
  Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'

import api from '@/lib/api'
import useTitle from '@/hooks/useTitle'
import useTheme from '@/hooks/useTheme'
import Card from '@/components/Card'
import FosAlert from '@/components/FosAlert'
import { formatMoney } from '@/pages/invoiceHelpers'

const MONTH_OPTIONS = [6, 12, 24]

// Same validated pair theme.css defines under --chart-series-invoiced/
// --chart-series-collected — mirrored here as plain hex (not read via
// var()) since Recharts renders stroke/fill as raw SVG presentation
// attributes, which don't reliably resolve CSS custom properties across
// browsers the way a real `style` property does.
const CHART_COLORS = {
  light: { invoiced: '#2a78d6', collected: '#1baf7a' },
  dark: { invoiced: '#3987e5', collected: '#199e70' },
}

export default function InvoiceAnalytics() {
  useTitle('Analytics — LanceraOS')
  const navigate = useNavigate()
  const { isDark } = useTheme()
  const [months, setMonths] = useState(6)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => { load() }, [months]) // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const { data } = await api.get(`/invoices/analytics/?months=${months}`)
      setData(data)
    } catch {
      setError('Failed to load analytics. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const colors = CHART_COLORS[isDark ? 'dark' : 'light']

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={() => navigate('/invoices')} aria-label="Back to Invoices" className="fos-btn fos-btn-ghost" style={{ padding: 8 }}>
            <ArrowLeft size={16} />
          </button>
          <h1 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-primary)' }}>Analytics</h1>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {MONTH_OPTIONS.map((m) => (
            <button
              key={m} onClick={() => setMonths(m)}
              className={`fos-btn ${months === m ? 'fos-btn-accent' : 'fos-btn-ghost'}`}
              style={{ fontSize: '0.78rem' }}
            >
              {m}mo
            </button>
          ))}
        </div>
      </div>

      {error && <FosAlert type="error" style={{ marginBottom: 16 }}>{error}</FosAlert>}

      <Card
        title="Invoiced vs Collected"
        subtitle="Monthly totals, converted to USD via each invoice/payment's own anchor-currency rate"
      >
        {loading ? (
          <ChartSkeleton />
        ) : (
          <TrendChart data={data?.monthly_trend || []} colors={colors} />
        )}
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
        <Card title="Top Clients" subtitle="By revenue collected, unified to USD">
          {loading ? <ListSkeleton /> : <TopClientsList clients={data?.top_clients || []} />}
        </Card>
        <Card title="Currency Breakdown" subtitle="Real invoices only — drafts excluded">
          {loading ? <ListSkeleton /> : <CurrencyBreakdown breakdown={data?.currency_breakdown} />}
        </Card>
      </div>
    </>
  )
}

// ── TrendChart ────────────────────────────────────────────────────
// A line for each series (thin, 2px, per the dataviz skill's mark
// specs) rather than grouped bars — this is a continuous month-over-
// month trend (the "change over time" job), which reads better as a
// line across up to 24 points than as 24 grouped bar pairs. A real
// hover crosshair+tooltip ships by default (Recharts' own Tooltip),
// and the Legend is always present for these 2 series — never color
// alone to distinguish them.
function TrendChart({ data, colors }) {
  if (data.length === 0 || data.every((d) => Number(d.invoiced) === 0 && Number(d.collected) === 0)) {
    return <EmptyState icon={TrendingUp} text="No invoiced or collected activity in this window yet." />
  }
  const chartData = data.map((d) => ({ month: formatMonthLabel(d.month), invoiced: Number(d.invoiced), collected: Number(d.collected) }))
  return (
    <div style={{ width: '100%', height: 280 }}>
      <ResponsiveContainer>
        <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
          <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }} axisLine={{ stroke: 'var(--border-subtle)' }} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v}`} width={56} />
          <Tooltip
            formatter={(value, name) => [`$${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, name === 'invoiced' ? 'Invoiced' : 'Collected']}
            contentStyle={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', fontSize: '0.8rem' }}
            labelStyle={{ color: 'var(--text-primary)', fontWeight: 600 }}
          />
          <Legend
            formatter={(value) => <span style={{ color: 'var(--text-secondary)', fontSize: '0.78rem' }}>{value === 'invoiced' ? 'Invoiced' : 'Collected'}</span>}
          />
          <Line type="monotone" dataKey="invoiced" name="invoiced" stroke={colors.invoiced} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
          <Line type="monotone" dataKey="collected" name="collected" stroke={colors.collected} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

function formatMonthLabel(monthKey) {
  const [year, month] = monthKey.split('-')
  const date = new Date(Number(year), Number(month) - 1, 1)
  return date.toLocaleDateString(undefined, { month: 'short', year: '2-digit' })
}

// ── TopClientsList ───────────────────────────────────────────────
// A single series (revenue) — no legend needed per the dataviz skill's
// own rule ("a single series needs no legend box — the title names
// it"). Rendered as a real, accessible list with inline bars rather
// than a Recharts bar chart — reliability_score is a second, distinct
// number that doesn't share the bar's own scale, so a plain list reads
// more honestly here than forcing both into one chart axis.
function TopClientsList({ clients }) {
  if (clients.length === 0) {
    return <EmptyState icon={Users} text="No client revenue recorded yet." />
  }
  const maxUsd = Math.max(...clients.map((c) => Number(c.total_paid_usd)))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {clients.map((client) => (
        <div key={client.client_id}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {client.name}
            </span>
            <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
              {formatMoney(client.total_paid_usd, 'USD')}
            </span>
          </div>
          <div style={{ height: 6, background: 'var(--bg-surface-3)', borderRadius: 999, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${maxUsd > 0 ? (Number(client.total_paid_usd) / maxUsd) * 100 : 0}%`, background: 'var(--accent)', borderRadius: 999 }} />
          </div>
          {client.reliability_score !== null && (
            <p style={{ margin: '3px 0 0', fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>
              Reliability: {Number(client.reliability_score).toFixed(0)}/100
            </p>
          )}
        </div>
      ))}
    </div>
  )
}

// ── CurrencyBreakdown ────────────────────────────────────────────
function CurrencyBreakdown({ breakdown }) {
  const entries = Object.entries(breakdown?.by_currency || {})
  if (entries.length === 0) {
    return <EmptyState icon={Coins} text="No real invoices yet." />
  }
  return (
    <div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
        {entries.map(([currency, row]) => (
          <div key={currency} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border-subtle)' }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-primary)', fontWeight: 600 }}>{currency}</span>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>{row.count} invoice{row.count !== 1 ? 's' : ''}</span>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-primary)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{formatMoney(row.total, currency)}</span>
          </div>
        ))}
      </div>
      <div style={{ padding: '12px 14px', background: 'var(--bg-surface-2)', borderRadius: 'var(--radius-md)' }}>
        <p style={{ margin: '0 0 2px', fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Unified Total (USD)
        </p>
        <p style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
          {formatMoney(breakdown.unified_total_usd, 'USD')}
        </p>
        {breakdown.unconverted_count > 0 && (
          <p style={{ margin: '4px 0 0', fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>
            {breakdown.unconverted_count} invoice{breakdown.unconverted_count !== 1 ? 's' : ''} excluded — no exchange rate was captured for {breakdown.unconverted_count !== 1 ? 'them' : 'it'}.
          </p>
        )}
      </div>
    </div>
  )
}

function EmptyState({ icon: Icon, text }) {
  return (
    <div style={{ textAlign: 'center', padding: 32, color: 'var(--text-tertiary)' }}>
      <Icon size={22} style={{ marginBottom: 8, opacity: 0.5 }} />
      <p style={{ margin: 0, fontSize: '0.82rem' }}>{text}</p>
    </div>
  )
}

function ChartSkeleton() {
  return <div style={{ height: 280, background: 'var(--bg-surface-3)', borderRadius: 'var(--radius-md)', animation: 'skeleton-pulse 1.4s ease-in-out infinite' }} />
}

function ListSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {[1, 2, 3].map((i) => <div key={i} style={{ height: 32, background: 'var(--bg-surface-3)', borderRadius: 'var(--radius-sm)', animation: 'skeleton-pulse 1.4s ease-in-out infinite' }} />)}
    </div>
  )
}
