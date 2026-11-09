// src/components/HealthAreaCard.jsx
//
// One of the five areas: what was measured, what is needed for more points, the extra steps not already in "Where to start",
// and a fold-out with exactly how the area is scored. Every sentence is the server's, rendered as a plain text node (a payer's
// name can be in `measure`). The bar is neutral on purpose: a wall of red cards helps nobody, and the points text says it.
// An area the server could not score is "Not scored", never a bar and never a number.
import {
  HOW_SCORED, MORE_STEPS, NOT_SCORED_WORD, extraSteps, meterNow, pointsText,
} from '@/pages/healthHelpers'
import DashboardCard from './DashboardCard'

const paragraph = { margin: 0, lineHeight: 1.5, overflowWrap: 'anywhere' }

export default function HealthAreaCard({ area, tips, className }) {
  const percent = meterNow(area)
  const extras = extraSteps(area, tips)
  const unscored = percent === null
  return (
    <DashboardCard
      id={`health-area-${area.key}`}
      title={area.label}
      className={className}
      action={
        <span style={{ fontSize: '0.78rem', fontWeight: unscored ? 600 : 700, color: 'var(--text-tertiary)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
          {unscored ? NOT_SCORED_WORD : pointsText(area)}
        </span>
      }
    >
      {!unscored && (
        <div
          role="meter" aria-label={`${area.label} score`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}
          style={{ height: 6, background: 'var(--bg-surface-3)', borderRadius: 'var(--radius-full)', overflow: 'hidden', marginBottom: 12 }}
        >
          <div style={{ width: `${percent}%`, height: '100%', background: 'var(--accent)', borderRadius: 'var(--radius-full)' }} />
        </div>
      )}
      <p style={{ ...paragraph, fontSize: '0.86rem', color: 'var(--text-primary)' }}>{area.measure}</p>
      <p style={{ ...paragraph, marginTop: 8, fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{area.needed}</p>
      {extras.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <h3 style={{ margin: '0 0 6px', fontSize: '0.76rem', fontWeight: 700, color: 'var(--text-tertiary)' }}>{MORE_STEPS}</h3>
          <ul style={{ margin: 0, padding: '0 0 0 18px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {extras.map((step) => (
              <li key={step} style={{ ...paragraph, fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{step}</li>
            ))}
          </ul>
        </div>
      )}
      <details style={{ marginTop: 12 }}>
        <summary style={{ cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>{HOW_SCORED}</summary>
        <p style={{ ...paragraph, marginTop: 8, fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>{area.about}</p>
      </details>
    </DashboardCard>
  )
}
