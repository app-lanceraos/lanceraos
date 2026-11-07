// src/components/DashboardInsightsCard.jsx
//
// Up to three short insights about the freelancer's own numbers. CODE picked and calculated every fact and checked the
// model's wording on the server (apps/dashboard/insights.py); this card only shows the result. It owns its request, started
// on mount independently of the summary, so a slow model never delays the rest of the page and a failed summary never hides
// this card. The card is always rendered (loading, ready, empty and error all keep the card in its grid slot), so the layout
// never jumps.
//
// Every text is a plain React text node (escaped), whatever the model wrote. The "Written by AI" footer appears only when
// the server says some of the text was model-written (source ai or mixed).
import { useEffect, useRef, useState } from 'react'
import { BarChart3, Lightbulb, Sparkles } from 'lucide-react'

import api from '@/lib/api'
import {
  INSIGHTS_EMPTY_FALLBACK, INSIGHTS_FOOTER, INSIGHTS_SKELETON_ROWS, INSIGHTS_TIMEOUT_MS, showAiFooter,
} from '@/pages/dashboardHelpers'
import DashboardCard from './DashboardCard'
import DashboardUnavailable from './DashboardUnavailable'

export default function DashboardInsightsCard({ className }) {
  const [data, setData] = useState(null)
  const [state, setState] = useState('loading') // loading | ready | error
  const latestRequestId = useRef(0)

  // A late response never lands after unmount or after a newer request (Reload) was started.
  useEffect(() => {
    load()
    return () => { latestRequestId.current += 1 }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function load() {
    const requestId = ++latestRequestId.current
    setState('loading')
    try {
      const response = await api.get('/dashboard/insights/', { timeout: INSIGHTS_TIMEOUT_MS })
      if (requestId !== latestRequestId.current) return
      setData(response.data)
      setState('ready')
    } catch {
      if (requestId !== latestRequestId.current) return
      setState('error')
    }
  }

  return (
    <DashboardCard id="insights" title="Insights" subtitle="From your own numbers" className={className}>
      {state === 'loading' ? (
        <InsightsSkeleton />
      ) : state === 'error' || !data ? (
        <DashboardUnavailable onReload={load} />
      ) : data.status === 'empty' || data.insights.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '20px 8px', color: 'var(--text-tertiary)' }}>
          <BarChart3 size={22} aria-hidden="true" style={{ marginBottom: 8, opacity: 0.5 }} />
          <p style={{ margin: 0, fontSize: '0.84rem', lineHeight: 1.5 }}>{data.empty_hint || INSIGHTS_EMPTY_FALLBACK}</p>
        </div>
      ) : (
        <>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
            {data.insights.map((item) => (
              <li key={item.fact} style={{ background: 'var(--bg-surface-2)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: '14px 16px', minWidth: 0 }}>
                <Lightbulb size={16} aria-hidden="true" style={{ color: 'var(--accent)', marginBottom: 8 }} />
                <p style={{ margin: 0, fontSize: '0.86rem', lineHeight: 1.5, color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>{item.observation}</p>
                <p style={{ margin: '8px 0 0', fontSize: '0.8rem', lineHeight: 1.5, color: 'var(--text-secondary)', overflowWrap: 'anywhere' }}>{item.suggestion}</p>
              </li>
            ))}
          </ul>
          {showAiFooter(data.source) && (
            <p style={{ margin: '12px 0 0', display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>
              <Sparkles size={12} aria-hidden="true" style={{ flexShrink: 0 }} />
              <span>{INSIGHTS_FOOTER}</span>
            </p>
          )}
        </>
      )}
    </DashboardCard>
  )
}

// Same footprint as the ready state (same grid, same item height) so nothing jumps when the text arrives.
function InsightsSkeleton() {
  return (
    <div role="status" aria-label="Loading insights" style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
      {Array.from({ length: INSIGHTS_SKELETON_ROWS }, (_, i) => (
        <div key={i} style={{ background: 'var(--bg-surface-2)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: '14px 16px', minHeight: 118 }}>
          <div style={{ height: 16, width: 16, background: 'var(--bg-surface-3)', borderRadius: 'var(--radius-sm)', animation: 'skeleton-pulse 1.4s ease-in-out infinite', marginBottom: 10 }} />
          <div style={{ height: 12, width: '95%', background: 'var(--bg-surface-3)', borderRadius: 'var(--radius-sm)', animation: 'skeleton-pulse 1.4s ease-in-out infinite', marginBottom: 6 }} />
          <div style={{ height: 12, width: '70%', background: 'var(--bg-surface-3)', borderRadius: 'var(--radius-sm)', animation: 'skeleton-pulse 1.4s ease-in-out infinite', marginBottom: 14 }} />
          <div style={{ height: 10, width: '85%', background: 'var(--bg-surface-3)', borderRadius: 'var(--radius-sm)', animation: 'skeleton-pulse 1.4s ease-in-out infinite' }} />
        </div>
      ))}
    </div>
  )
}
