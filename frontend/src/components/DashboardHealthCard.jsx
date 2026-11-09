// src/components/DashboardHealthCard.jsx
//
// The Dashboard's "Financial health" widget: the 12-month score, its grade word and the single best next step, with a link to
// /health. Like the Insights card it owns its OWN request (GET /health/mini/), started on mount independently of the summary,
// so a slow or failed health request never delays or hides the rest of the Dashboard and a failed summary never hides this
// card. It is always rendered in its grid slot. The numbers and sentences are the server's (the same service code as the page).
// The card is a section, not a link; its only interactive parts are the "Details" link (and, with no score, one more link to
// the same page), so no interactive element is nested in another.
import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'

import useReportData from '@/hooks/useReportData'
import {
  WIDGET_LINK, WIDGET_LINK_LABEL, WIDGET_NEEDED_LINK, WIDGET_NEXT_STEP, WIDGET_NO_STEPS, WIDGET_PARTIAL, WIDGET_TITLE, DEFAULT_WINDOW,
  NO_SCORE_HEADING, gradeTone, gradeWord, hasScore, miniIsUsable, widgetSubtitle,
} from '@/pages/healthHelpers'
import DashboardCard from './DashboardCard'
import DashboardUnavailable from './DashboardUnavailable'
import HealthGradeBadge from './HealthGradeBadge'

const bone = (style) => ({ background: 'var(--bg-surface-3)', borderRadius: 'var(--radius-sm)', animation: 'skeleton-pulse 1.4s ease-in-out infinite', ...style })
const linkStyle = { color: 'var(--accent)', fontWeight: 600, fontSize: '0.82rem' }

export default function DashboardHealthCard({ className }) {
  const { data: body, loading, error, reload } = useReportData({ path: '/health/mini/', params: {} })
  const data = miniIsUsable(body) ? body : null
  const failed = Boolean(error) || (body && !data)

  return (
    <DashboardCard
      id="health" title={WIDGET_TITLE} subtitle={data ? widgetSubtitle(data) : `Last ${DEFAULT_WINDOW} full months`} className={className}
      action={(
        <Link to="/health" className="dash-link" aria-label={WIDGET_LINK_LABEL} style={{ ...linkStyle, display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap', textDecoration: 'none', borderRadius: 'var(--radius-sm)' }}>
          {WIDGET_LINK} <ArrowRight size={14} aria-hidden="true" />
        </Link>
      )}
    >
      {failed ? (
        <DashboardUnavailable onReload={reload} />
      ) : !data ? (
        <div role="status" aria-label="Loading your financial health" aria-busy={loading ? 'true' : undefined}>
          <div style={bone({ height: 38, width: 120, marginBottom: 12 })} />
          <div style={bone({ height: 8, width: '100%', marginBottom: 14, borderRadius: 'var(--radius-full)' })} />
          <div style={bone({ height: 12, width: '95%', marginBottom: 6 })} />
          <div style={bone({ height: 12, width: '80%', marginBottom: 6 })} />
          <div style={bone({ height: 12, width: '60%' })} />
        </div>
      ) : hasScore(data) ? (
        <>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            <span style={{ fontSize: '2.4rem', fontWeight: 800, lineHeight: 1, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{data.score}</span>
            <span style={{ fontSize: '0.95rem', color: 'var(--text-tertiary)' }}>/ 100</span>
            <HealthGradeBadge grade={data.grade} label={gradeWord(data)} />
          </div>
          <div
            role="meter" aria-label="Health score" aria-valuemin={0} aria-valuemax={100} aria-valuenow={data.score}
            style={{ height: 8, background: 'var(--bg-surface-3)', borderRadius: 'var(--radius-full)', overflow: 'hidden', marginBottom: 10 }}
          >
            <div style={{ width: `${data.score}%`, height: '100%', background: gradeTone(data.grade).fill, borderRadius: 'var(--radius-full)' }} />
          </div>
          {data.partial && <p style={{ margin: '0 0 10px', fontSize: '0.74rem', color: 'var(--text-tertiary)' }}>{WIDGET_PARTIAL}</p>}
          {data.top_tip ? (
            <>
              <p style={{ margin: '0 0 2px', fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-tertiary)' }}>{WIDGET_NEXT_STEP}</p>
              <p style={{ margin: 0, fontSize: '0.84rem', lineHeight: 1.5, color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>{data.top_tip.text}</p>
            </>
          ) : (
            <p style={{ margin: 0, fontSize: '0.84rem', color: 'var(--text-secondary)' }}>{WIDGET_NO_STEPS}</p>
          )}
        </>
      ) : (
        <>
          <p style={{ margin: '0 0 6px', fontSize: '1.2rem', fontWeight: 800, color: 'var(--text-primary)' }}>{NO_SCORE_HEADING}</p>
          {data.message && <p style={{ margin: '0 0 10px', fontSize: '0.84rem', lineHeight: 1.5, color: 'var(--text-secondary)', overflowWrap: 'anywhere' }}>{data.message}</p>}
          <Link to="/health" className="dash-link" style={{ ...linkStyle, textDecoration: 'none', borderRadius: 'var(--radius-sm)' }}>{WIDGET_NEEDED_LINK}</Link>
        </>
      )}
    </DashboardCard>
  )
}
