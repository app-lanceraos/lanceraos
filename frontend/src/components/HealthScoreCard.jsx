// src/components/HealthScoreCard.jsx
//
// The big number. The score, the grade word and the dates are exactly what the server sent: nothing here adds, rescales or
// rounds. No score (fewer than 50 points could be measured) is "No score yet" and the server's message, never a 0.
import { RefreshCw } from 'lucide-react'

import DashboardCard from './DashboardCard'
import FosAlert from './FosAlert'
import HealthGradeBadge from './HealthGradeBadge'
import {
  LOADING_LABEL, NO_SCORE_HEADING, SCORE_SUBTITLE, SCORE_TITLE, gradeTone, gradeWord, hasScore, partialLine, windowLine,
} from '@/pages/healthHelpers'

const bone = (style) => ({ background: 'var(--bg-surface-3)', borderRadius: 'var(--radius-sm)', animation: 'skeleton-pulse 1.4s ease-in-out infinite', ...style })

export default function HealthScoreCard({ data, loading, error, onReload, className }) {
  return (
    <DashboardCard id="health-score" title={SCORE_TITLE} subtitle={SCORE_SUBTITLE} className={className}>
      {!data && error ? (
        <FosAlert type="error">
          <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <span>{error}</span>
            <button type="button" className="fos-btn fos-btn-ghost" style={{ fontSize: '0.78rem', padding: '5px 10px' }} onClick={onReload}>
              <RefreshCw size={13} aria-hidden="true" /> Reload
            </button>
          </span>
        </FosAlert>
      ) : !data ? (
        <div role="status" aria-label={LOADING_LABEL} aria-busy={loading ? 'true' : undefined}>
          <div style={bone({ height: 44, width: 150, marginBottom: 14 })} />
          <div style={bone({ height: 8, width: '100%', marginBottom: 14, borderRadius: 'var(--radius-full)' })} />
          <div style={bone({ height: 12, width: '70%' })} />
        </div>
      ) : (
        <div style={{ opacity: loading ? 0.55 : 1, transition: 'opacity 0.15s ease' }}>
          {hasScore(data) ? (
            <>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                <span style={{ fontSize: '2.6rem', fontWeight: 800, lineHeight: 1, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{data.score}</span>
                <span style={{ fontSize: '1rem', color: 'var(--text-tertiary)' }}>/ 100</span>
                <HealthGradeBadge grade={data.grade} label={gradeWord(data)} />
              </div>
              <div
                role="meter" aria-label="Health score" aria-valuemin={0} aria-valuemax={100} aria-valuenow={data.score}
                style={{ height: 8, background: 'var(--bg-surface-3)', borderRadius: 'var(--radius-full)', overflow: 'hidden', marginBottom: 12 }}
              >
                <div style={{ width: `${data.score}%`, height: '100%', background: gradeTone(data.grade).fill, borderRadius: 'var(--radius-full)', transition: 'width var(--transition-base)' }} />
              </div>
              {partialLine(data) && <p style={{ margin: '0 0 8px', fontSize: '0.8rem', color: 'var(--text-secondary)', overflowWrap: 'anywhere' }}>{partialLine(data)}</p>}
            </>
          ) : (
            <>
              <h3 style={{ margin: '0 0 8px', fontSize: '1.4rem', fontWeight: 800, color: 'var(--text-primary)' }}>{NO_SCORE_HEADING}</h3>
              {data.message && <p style={{ margin: '0 0 12px', fontSize: '0.86rem', lineHeight: 1.5, color: 'var(--text-secondary)', overflowWrap: 'anywhere' }}>{data.message}</p>}
            </>
          )}
          <p style={{ margin: 0, fontSize: '0.76rem', color: 'var(--text-tertiary)', overflowWrap: 'anywhere' }}>{windowLine(data)}</p>
        </div>
      )}
    </DashboardCard>
  )
}
