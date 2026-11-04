// src/components/ProposalTimeline.jsx
//
// "Activity": what has happened to a sent proposal, oldest first. The entries
// come from buildTimeline() (proposalLifecycle.js). Times are the API's naive
// Pakistan time shown as written; an entry with no time (the invoice — the
// backend stores none) simply shows none.
import { AlertTriangle, CheckCircle2, Circle, XCircle } from 'lucide-react'

import Card from '@/components/Card'
import { formatDate, formatTimestamp } from '@/pages/proposalHelpers'
import { buildTimeline } from '@/pages/proposalLifecycle'

const TONES = {
  neutral: { Icon: Circle, color: 'var(--text-tertiary)' },
  positive: { Icon: CheckCircle2, color: 'var(--status-green-text)' },
  negative: { Icon: XCircle, color: 'var(--status-red-text)' },
  warning: { Icon: AlertTriangle, color: 'var(--status-amber-text)' },
}

export default function ProposalTimeline({ detail }) {
  const entries = buildTimeline(detail)
  return (
    <Card title="Activity">
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {entries.map((entry) => {
          const { Icon, color } = TONES[entry.tone] || TONES.neutral
          const when = entry.atKind === 'date' ? formatDate(entry.at) : entry.atKind === 'timestamp' ? formatTimestamp(entry.at) : null
          return (
            <li key={entry.key} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <Icon size={15} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2, color }} />
              <div style={{ minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: '0.84rem', fontWeight: 600, color: 'var(--text-primary)' }}>{entry.label}</p>
                {when && <p style={{ margin: '1px 0 0', fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>{when}</p>}
              </div>
            </li>
          )
        })}
      </ol>
    </Card>
  )
}
