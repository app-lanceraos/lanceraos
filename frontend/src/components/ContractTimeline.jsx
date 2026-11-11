// src/components/ContractTimeline.jsx
//
// "Activity": what has happened to a contract, oldest first. The entries come from timelineEntries() (contractLifecycle.js).
// Times are the API's naive Pakistan time shown as written and labelled PKT.
import { AlertTriangle, CheckCircle2, Circle, XCircle } from 'lucide-react'

import Card from '@/components/Card'
import { OWNER_COPY } from '@/pages/contractCopy'
import { timelineEntries } from '@/pages/contractLifecycle'
import { formatDate, formatTimestampPkt } from '@/pages/proposalHelpers'

const TONES = {
  neutral: { Icon: Circle, color: 'var(--text-tertiary)' },
  positive: { Icon: CheckCircle2, color: 'var(--status-green-text)' },
  negative: { Icon: XCircle, color: 'var(--status-red-text)' },
  warning: { Icon: AlertTriangle, color: 'var(--status-amber-text)' },
}

export default function ContractTimeline({ detail }) {
  const entries = timelineEntries(detail)
  return (
    <Card title={OWNER_COPY.timeline.title}>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {entries.map((entry) => {
          const { Icon, color } = TONES[entry.tone] || TONES.neutral
          const when = entry.atKind === 'date' ? formatDate(entry.at) : entry.atKind === 'timestamp' ? formatTimestampPkt(entry.at) : null
          return (
            <li key={entry.key} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <Icon size={15} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2, color }} />
              <div style={{ minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: '0.84rem', fontWeight: 600, color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>{entry.label}</p>
                {when && <p style={{ margin: '1px 0 0', fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>{when}</p>}
              </div>
            </li>
          )
        })}
      </ol>
    </Card>
  )
}
