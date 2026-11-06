// src/components/DashboardUpcomingCard.jsx
//
// Recurring invoices due in the next seven days (the server mirrors the daily generation task's selection), with a
// plain statement of what will happen on that day.
import { Link } from 'react-router-dom'
import { CalendarClock } from 'lucide-react'

import { formatMoney } from '@/pages/invoiceHelpers'
import { autoSendText, formatIsoDayMonth, moreCount, upcomingLink } from '@/pages/dashboardHelpers'
import DashboardCard from './DashboardCard'
import DashboardUnavailable from './DashboardUnavailable'

export default function DashboardUpcomingCard({ upcoming, onReload, className }) {
  const more = upcoming?.available ? moreCount(upcoming.total_count, upcoming.items.length) : 0
  return (
    <DashboardCard id="upcoming" title="Upcoming recurring invoices" subtitle="Next 7 days" className={className}>
      {!upcoming?.available ? (
        <DashboardUnavailable onReload={onReload} />
      ) : upcoming.items.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '20px 8px', color: 'var(--text-tertiary)' }}>
          <CalendarClock size={22} aria-hidden="true" style={{ marginBottom: 8, opacity: 0.5 }} />
          <p style={{ margin: 0, fontSize: '0.84rem' }}>No recurring invoices due in the next 7 days.</p>
        </div>
      ) : (
        <>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {upcoming.items.map((item) => (
              <li key={item.invoice_id}>
                <Link to={upcomingLink(item)} className="dash-link dash-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '8px 6px', borderRadius: 'var(--radius-md)', textDecoration: 'none', color: 'inherit' }}>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: '0.84rem', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {formatIsoDayMonth(item.next_date)} · {item.invoice_number} · {item.client_name}
                    </span>
                    <span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>{autoSendText(item.auto_send)}</span>
                  </span>
                  <span style={{ flexShrink: 0, fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{formatMoney(item.amount, item.currency)}</span>
                </Link>
              </li>
            ))}
          </ul>
          {more > 0 && <p style={{ margin: '6px 6px 0', fontSize: '0.76rem', color: 'var(--text-tertiary)' }}>and {more} more due in the next 7 days</p>}
        </>
      )}
    </DashboardCard>
  )
}
