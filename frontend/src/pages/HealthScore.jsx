// src/pages/HealthScore.jsx
//
// The Health Score page (/health, Prompt 19): one score out of 100, a radar of the five areas, a window selector, a ranked
// "Where to start" list and one card per area. Every number and every sentence about the person's money is the SERVER's
// (GET /health/score/); the page only formats and arranges, so it can never disagree with the Dashboard widget. The dates
// line is read from the RESPONSE. Top to bottom: the window pills; the score card beside the radar (the radar only when at
// least three areas are scored); "Where to start"; the five area cards; a fixed row of links to the pages that hold the
// records; the server's notes. The window is page state, not URL state (a reload goes back to 12 months). While the first
// load runs the score card carries the one "Loading your health score" status; the skeleton blocks below it are visual only.
import { useState } from 'react'
import { Link } from 'react-router-dom'

import useReportData from '@/hooks/useReportData'
import useTitle from '@/hooks/useTitle'
import HealthAreaCard from '@/components/HealthAreaCard'
import HealthRadar from '@/components/HealthRadar'
import HealthScoreCard from '@/components/HealthScoreCard'
import HealthTipsCard from '@/components/HealthTipsCard'
import HealthWindowPicker from '@/components/HealthWindowPicker'
import ReportNote from '@/components/ReportNote'
import {
  DEFAULT_WINDOW, HEALTH_LOAD_FALLBACK, UPDATE_LEAD, UPDATE_LINKS, healthIsUsable, healthLoadError, healthParams,
} from './healthHelpers'

const GRID = { display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }

function SkeletonBlock({ height }) {
  return (
    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: '16px 20px' }}>
      <div style={{ height: 14, width: '40%', marginBottom: 16, background: 'var(--bg-surface-3)', borderRadius: 'var(--radius-sm)', animation: 'skeleton-pulse 1.4s ease-in-out infinite' }} />
      <div style={{ height, background: 'var(--bg-surface-3)', borderRadius: 'var(--radius-sm)', animation: 'skeleton-pulse 1.4s ease-in-out infinite' }} />
    </div>
  )
}

export default function HealthScore() {
  useTitle('LanceraOS | Health Score')
  const [months, setMonths] = useState(DEFAULT_WINDOW)
  const { data: body, loading, error, reload } = useReportData({ path: '/health/score/', params: healthParams(months), errorMessage: healthLoadError })

  const data = healthIsUsable(body) ? body : null
  const failure = error || (body && !data ? HEALTH_LOAD_FALLBACK : '')
  const firstLoad = !data && !failure

  return (
    <div aria-busy={loading}>
      <div style={{ marginBottom: 16 }}>
        <HealthWindowPicker value={months} onChange={setMonths} />
      </div>

      {failure ? (
        <HealthScoreCard data={null} error={failure} onReload={reload} />
      ) : (
        <>
          <div style={{ ...GRID, marginBottom: 16 }}>
            <HealthScoreCard data={data} loading={loading} />
            <HealthRadar data={data} loading={loading} />
          </div>

          {firstLoad ? (
            <div aria-hidden="true" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <SkeletonBlock height={96} />
              <div style={GRID}>
                {Array.from({ length: 5 }, (_, i) => <SkeletonBlock key={i} height={120} />)}
              </div>
            </div>
          ) : (
            <div style={{ opacity: loading ? 0.55 : 1, transition: 'opacity 0.15s ease' }}>
              <div style={{ marginBottom: 16 }}>
                <HealthTipsCard data={data} />
              </div>
              <div style={{ ...GRID, alignItems: 'start', marginBottom: 16 }}>
                {data.dimensions.map((area) => <HealthAreaCard key={area.key} area={area} tips={data.tips} />)}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
                <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{UPDATE_LEAD}</span>
                {UPDATE_LINKS.map((link) => (
                  <Link key={link.to} to={link.to} className="fos-btn fos-btn-ghost" style={{ fontSize: '0.8rem', padding: '6px 12px' }}>{link.label}</Link>
                ))}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {data.notes.map((note, index) => <ReportNote key={`${index}-${note}`}>{note}</ReportNote>)}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
