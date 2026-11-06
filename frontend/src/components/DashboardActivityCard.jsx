// src/components/DashboardActivityCard.jsx
//
// What happened in the last 14 days, newest first. Sentences are built in the frontend from structured fields
// (dashboardHelpers.activitySentence) and rendered as React text, so a client name can never inject markup. Times are
// the server's naive Pakistan time, shown as written with the PKT label (no relative times).
import { Link } from 'react-router-dom'
import { Activity } from 'lucide-react'

import { formatTimestampPkt } from '@/pages/proposalHelpers'
import { activityLink, activityMeta, activitySentence, visuallyHidden } from '@/pages/dashboardHelpers'
import DashboardCard from './DashboardCard'
import DashboardUnavailable from './DashboardUnavailable'

export default function DashboardActivityCard({ activity, onReload, className }) {
  return (
    <DashboardCard id="activity" title="Recent activity" subtitle="Last 14 days" className={className}>
      {!activity?.available ? (
        <DashboardUnavailable onReload={onReload} />
      ) : activity.items.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '28px 8px', color: 'var(--text-tertiary)' }}>
          <Activity size={22} aria-hidden="true" style={{ marginBottom: 8, opacity: 0.5 }} />
          <p style={{ margin: 0, fontSize: '0.84rem' }}>No activity in the last 14 days.</p>
        </div>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {activity.items.map((item) => {
            const { Icon, label } = activityMeta(item.kind)
            return (
              <li key={`${item.kind}-${item.invoice_id || item.proposal_id}-${item.at}`}>
                <Link to={activityLink(item)} className="dash-link dash-row" style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '9px 6px', borderRadius: 'var(--radius-md)', textDecoration: 'none', color: 'inherit' }}>
                  <span aria-hidden="true" style={{ width: 30, height: 30, borderRadius: 'var(--radius-full)', background: 'var(--bg-surface-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: 'var(--text-secondary)' }}>
                    <Icon size={15} />
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <span style={visuallyHidden}>{label}: </span>
                    <span style={{ display: 'block', fontSize: '0.84rem', color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>{activitySentence(item)}</span>
                    <span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>{formatTimestampPkt(item.at)}</span>
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </DashboardCard>
  )
}
