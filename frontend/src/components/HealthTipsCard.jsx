// src/components/HealthTipsCard.jsx
//
// "Where to start": the server's ranked steps, in the server's order, each under the name of its area. The text already says
// "worth about N points", so there is no separate gain badge. No deep links: the server sends a sentence, not a destination,
// and guessing one from a sentence is how links end up wrong (the page ends with a fixed row of links instead).
import { Info } from 'lucide-react'

import { TIPS_EMPTY, TIPS_TITLE, areaLabel, tipsSubtitle } from '@/pages/healthHelpers'
import DashboardCard from './DashboardCard'

export default function HealthTipsCard({ data }) {
  const tips = data?.tips || []
  return (
    <DashboardCard id="health-tips" title={TIPS_TITLE} subtitle={tips.length ? tipsSubtitle(tips) : undefined}>
      {tips.length === 0 ? (
        <p style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.84rem', color: 'var(--text-secondary)' }}>
          <Info size={15} aria-hidden="true" style={{ flexShrink: 0, color: 'var(--text-tertiary)' }} />
          {TIPS_EMPTY}
        </p>
      ) : (
        <ol style={{ margin: 0, padding: '0 0 0 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {tips.map((tip, index) => (
            <li key={`${tip.dimension}-${index}`} style={{ paddingLeft: 4, color: 'var(--text-tertiary)', fontSize: '0.84rem', fontWeight: 700 }}>
              <span style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-tertiary)', marginBottom: 2 }}>{areaLabel(data.dimensions, tip.dimension)}</span>
              <span style={{ display: 'block', fontSize: '0.86rem', fontWeight: 400, lineHeight: 1.5, color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>{tip.text}</span>
            </li>
          ))}
        </ol>
      )}
    </DashboardCard>
  )
}
