// src/pages/Dashboard.jsx
//
// /dashboard — the landing page. ONE request (GET /api/dashboard/summary/) feeds every card, so the page has one loading
// state and shows one consistent moment. Each section arrives with its own `available` flag: if the server could not
// build one section, only that card says so (with a Reload) and the rest render normally.
//
// The Insights card (Prompt 09) is the one exception to "one request": it owns its OWN request to
// GET /api/dashboard/insights/ because a model can take several seconds and the summary must never wait for it. It is always
// rendered in its grid slot (even while the summary is loading or has failed), so it never blinks in or collapses.
//
// The Financial health widget (Prompt 19) is the second exception: it owns its OWN request to GET /api/health/mini/ so a slow
// or failed health request never delays or hides the rest of this page, and a failed summary never hides the widget. It is
// always rendered in its grid slot, like Insights.
//
// Layout: desktop is a 3-column grid (the chart on the left, 2/3 wide and two rows tall, with Financial health above Needs
// attention on the right, then a full-width Insights row, then activity 2/3 beside upcoming + rates). At <=768px it is one
// column in the order that puts what needs action BEFORE history: greeting, KPIs, needs attention, financial health, chart,
// insights, upcoming, activity, rates.
import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Clock, RefreshCw, Users, Wallet } from 'lucide-react'

import api from '@/lib/api'
import useTitle from '@/hooks/useTitle'
import useAuthStore from '@/store/authStore'
import FosAlert from '@/components/FosAlert'
import DashboardActivityCard from '@/components/DashboardActivityCard'
import DashboardAttentionCard from '@/components/DashboardAttentionCard'
import DashboardHealthCard from '@/components/DashboardHealthCard'
import DashboardIncomeChart from '@/components/DashboardIncomeChart'
import DashboardInsightsCard from '@/components/DashboardInsightsCard'
import DashboardKpiCard from '@/components/DashboardKpiCard'
import DashboardRatesCard from '@/components/DashboardRatesCard'
import DashboardUnavailable from '@/components/DashboardUnavailable'
import DashboardUpcomingCard from '@/components/DashboardUpcomingCard'
import { formatMoney } from '@/pages/invoiceHelpers'
import {
  KPI_LINKS, deltaView, greetingLine, invoiceNote, longDate, paymentNote,
} from '@/pages/dashboardHelpers'

const LAYOUT_CSS = `
  .dash-layout { display: grid; gap: 16px; grid-template-columns: repeat(3, minmax(0, 1fr));
    grid-template-areas: "chart chart health" "chart chart attention" "insights insights insights" "activity activity upcoming" "activity activity rates"; }
  .dash-area-chart { grid-area: chart; } .dash-area-attention { grid-area: attention; } .dash-area-health { grid-area: health; }
  .dash-area-insights { grid-area: insights; } .dash-area-activity { grid-area: activity; } .dash-area-upcoming { grid-area: upcoming; } .dash-area-rates { grid-area: rates; }
  .dash-kpis { display: grid; gap: 12px; grid-template-columns: repeat(4, minmax(0, 1fr)); margin-bottom: 16px; }
  .dash-link:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  @media (hover: hover) {
    .dash-kpi:hover { border-color: var(--border-strong, var(--accent)); }
    .dash-row:hover { background: var(--bg-surface-2); }
  }
  @media (max-width: 768px) {
    .dash-layout { grid-template-columns: minmax(0, 1fr); grid-template-areas: none; }
    .dash-layout > * { grid-area: auto !important; }
    .dash-area-attention { order: 1; } .dash-area-health { order: 2; } .dash-area-chart { order: 3; } .dash-area-insights { order: 4; }
    .dash-area-upcoming { order: 5; } .dash-area-activity { order: 6; } .dash-area-rates { order: 7; }
    .dash-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  }
  /* Two tiles side by side leave ~130px for the figure at phone width: shrink it so "PKR 1,442,372" stays on one line. */
  @media (max-width: 480px) {
    .dash-kpi { padding: 12px 12px !important; }
    .dash-kpi-value { font-size: 1.02rem !important; }
  }
`

export default function Dashboard() {
  useTitle('LanceraOS | Dashboard')
  const user = useAuthStore((s) => s.user)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const latestRequestId = useRef(0)

  // A late response never lands after the page is gone or after a newer request (Retry) was started.
  useEffect(() => {
    load()
    return () => { latestRequestId.current += 1 }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function load() {
    const requestId = ++latestRequestId.current
    setLoading(true)
    setError(null)
    try {
      const response = await api.get('/dashboard/summary/')
      if (requestId !== latestRequestId.current) return
      setData(response.data)
    } catch {
      if (requestId !== latestRequestId.current) return
      setError('Failed to load your dashboard. Please try again.')
    } finally {
      if (requestId === latestRequestId.current) setLoading(false)
    }
  }

  const now = new Date()
  const showSkeleton = loading && !data
  const refetching = loading && !!data

  return (
    <div style={{ opacity: refetching ? 0.6 : 1, transition: 'opacity var(--transition-base, 150ms ease)' }} aria-busy={loading}>
      <style>{LAYOUT_CSS}</style>

      <header style={{ marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)' }}>{greetingLine(now, user)}</h1>
        <p style={{ margin: '2px 0 0', fontSize: '0.84rem', color: 'var(--text-tertiary)' }}>{longDate(now)}</p>
      </header>

      {error && (
        <FosAlert type="error" style={{ marginBottom: 16 }}>
          <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <span>{error}</span>
            <button type="button" className="fos-btn fos-btn-ghost" style={{ fontSize: '0.78rem', padding: '5px 10px' }} onClick={load} disabled={loading}>
              <RefreshCw size={13} aria-hidden="true" /> Retry
            </button>
          </span>
        </FosAlert>
      )}

      {showSkeleton ? <KpiSkeleton /> : data ? <KpiRow kpis={data.kpis} currency={data.currency} onReload={load} /> : null}

      {/* One grid for every state, so the Insights and Financial health cards (which own their own requests) keep their slots,
          and stay MOUNTED, while the summary loads, succeeds or fails. */}
      <div className="dash-layout">
        {data ? <DashboardIncomeChart className="dash-area-chart" trend={data.income_trend} currency={data.currency} onReload={load} />
          : showSkeleton ? <SkeletonCard className="dash-area-chart" rows={1} height={220} /> : null}
        {data ? <DashboardAttentionCard className="dash-area-attention" attention={data.needs_attention} onReload={load} />
          : showSkeleton ? <SkeletonCard className="dash-area-attention" rows={4} /> : null}
        <DashboardHealthCard className="dash-area-health" />
        <DashboardInsightsCard className="dash-area-insights" />
        {data ? <DashboardActivityCard className="dash-area-activity" activity={data.recent_activity} onReload={load} />
          : showSkeleton ? <SkeletonCard className="dash-area-activity" rows={5} /> : null}
        {data ? <DashboardUpcomingCard className="dash-area-upcoming" upcoming={data.upcoming_recurring} onReload={load} />
          : showSkeleton ? <SkeletonCard className="dash-area-upcoming" rows={2} /> : null}
        {data ? <DashboardRatesCard className="dash-area-rates" rates={data.exchange_rates} onReload={load} />
          : showSkeleton ? <SkeletonCard className="dash-area-rates" rows={3} height={24} /> : null}
      </div>
    </div>
  )
}

function KpiRow({ kpis, currency, onReload }) {
  if (!kpis?.available) {
    return (
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: '14px 16px', marginBottom: 16 }}>
        <DashboardUnavailable onReload={onReload} />
      </div>
    )
  }
  const { outstanding, overdue, paid_this_month: paid, active_clients: clients } = kpis
  return (
    <div className="dash-kpis">
      <DashboardKpiCard
        label="Outstanding" to={KPI_LINKS.outstanding} Icon={Clock} tone="var(--status-amber-text)"
        value={formatMoney(outstanding.total, currency)} caption={`${outstanding.count} invoice${outstanding.count !== 1 ? 's' : ''}`}
        note={outstanding.unconverted_count > 0 ? invoiceNote(outstanding.unconverted_count) : null}
      />
      <DashboardKpiCard
        label="Overdue" to={KPI_LINKS.overdue} Icon={AlertTriangle} tone={overdue.count > 0 ? 'var(--status-red-text)' : 'var(--text-primary)'}
        value={formatMoney(overdue.total, currency)} caption={`${overdue.count} invoice${overdue.count !== 1 ? 's' : ''}`}
        note={overdue.unconverted_count > 0 ? invoiceNote(overdue.unconverted_count) : null}
      />
      <DashboardKpiCard
        label="Paid this month" to={KPI_LINKS.paid_this_month} Icon={Wallet} tone="var(--status-green-text)"
        value={formatMoney(paid.total, currency)} caption={`${paid.count} invoice${paid.count !== 1 ? 's' : ''}`}
        delta={deltaView(paid.pct_change)}
        note={paid.unconverted_count > 0 ? paymentNote(paid.unconverted_count) : null}
      />
      <DashboardKpiCard
        label="Active clients" to={KPI_LINKS.active_clients} Icon={Users}
        value={String(clients.count)} caption={`client${clients.count !== 1 ? 's' : ''}`}
      />
    </div>
  )
}

function Bone({ height, width = '100%', style }) {
  return <div style={{ height, width, background: 'var(--bg-surface-3)', borderRadius: 'var(--radius-sm)', animation: 'skeleton-pulse 1.4s ease-in-out infinite', ...style }} />
}

function SkeletonCard({ className, rows = 3, height = 34 }) {
  return (
    <div className={className} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: '16px 20px', minWidth: 0 }}>
      <Bone height={14} width="40%" style={{ marginBottom: 16 }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {Array.from({ length: rows }, (_, i) => <Bone key={i} height={height} />)}
      </div>
    </div>
  )
}

// The KPI row drawn in grey (the cards below it have their own SkeletonCard in the same grid slots), so nothing jumps.
function KpiSkeleton() {
  return (
    <div role="status" aria-label="Loading your dashboard" className="dash-kpis">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: '14px 16px' }}>
          <Bone height={10} width="50%" style={{ marginBottom: 12 }} />
          <Bone height={24} width="70%" style={{ marginBottom: 8 }} />
          <Bone height={10} width="35%" />
        </div>
      ))}
    </div>
  )
}
