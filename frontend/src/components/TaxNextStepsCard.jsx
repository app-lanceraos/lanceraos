// src/components/TaxNextStepsCard.jsx
//
// "What to do next": the server's return-date sentence, then its short checklist. Each item shows an icon, the status WORD
// (Done / To do / Check) and the server's text, so colour is never the only signal. The status colours are the only status
// colours on the Tax page (taxHelpers.statusTone); the icons are decorative.
import { AlertCircle, CalendarDays, CheckCircle2, Circle } from 'lucide-react'

import DashboardCard from './DashboardCard'
import { NEXT_TITLE, statusTone, statusWord } from '@/pages/taxHelpers'

const ICONS = { done: CheckCircle2, todo: AlertCircle }

export default function TaxNextStepsCard({ data }) {
  return (
    <DashboardCard id="tax-next" title={NEXT_TITLE}>
      <p style={{ margin: '0 0 14px', display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: '0.86rem', color: 'var(--text-primary)' }}>
        <CalendarDays size={16} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2, color: 'var(--text-tertiary)' }} />
        <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{data.return.sentence}</span>
      </p>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {data.checklist.map((item) => {
          const Icon = ICONS[item.status] || Circle
          return (
            <li key={item.key} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: '0.84rem', color: 'var(--text-secondary)' }}>
              <Icon size={16} aria-hidden="true" style={{ flexShrink: 0, marginTop: 1, color: statusTone(item.status) }} />
              <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                <strong style={{ color: 'var(--text-primary)', marginRight: 6 }}>{statusWord(item.status)}</strong>
                {item.text}
              </span>
            </li>
          )
        })}
      </ul>
    </DashboardCard>
  )
}
