// src/components/DashboardAttentionCard.jsx
//
// What needs action: overdue invoices, unread client messages, proposals still waiting for an answer. Up to five rows
// per group (the server already capped and ordered them), each a real link to the record; a group longer than its
// list says "and N more" and links to the full list page. Every group empty is one calm line, not three empty boxes.
import { Link } from 'react-router-dom'
import { CheckCircle2 } from 'lucide-react'

import { formatMoney } from '@/pages/invoiceHelpers'
import { formatTimestampPkt } from '@/pages/proposalHelpers'
import {
  messageLink, moreCount, nothingNeedsAttention, overdueLink, proposalLink,
} from '@/pages/dashboardHelpers'
import DashboardCard from './DashboardCard'
import DashboardUnavailable from './DashboardUnavailable'

export default function DashboardAttentionCard({ attention, onReload, className }) {
  return (
    <DashboardCard id="attention" title="Needs your attention" className={className}>
      {!attention?.available ? (
        <DashboardUnavailable onReload={onReload} />
      ) : nothingNeedsAttention(attention) ? (
        <div style={{ textAlign: 'center', padding: '24px 8px', color: 'var(--text-tertiary)' }}>
          <CheckCircle2 size={22} aria-hidden="true" style={{ marginBottom: 8, color: 'var(--status-green-text)' }} />
          <p style={{ margin: 0, fontSize: '0.86rem', color: 'var(--text-secondary)' }}>Nothing needs your attention.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <Group title="Overdue invoices" total={attention.overdue_invoices.total_count} shown={attention.overdue_invoices.items.length} moreTo="/invoices" moreLabel="overdue invoices">
            {attention.overdue_invoices.items.map((item) => (
              <Row key={item.id} to={overdueLink(item)} primary={`${item.invoice_number} · ${item.client_name}`}
                secondary={`${item.days_overdue} day${item.days_overdue !== 1 ? 's' : ''} overdue`}
                trailing={formatMoney(item.outstanding, item.currency)} danger />
            ))}
          </Group>
          <Group title="Unread messages" total={attention.unread_messages.invoice_count} shown={attention.unread_messages.items.length} moreTo="/invoices" moreLabel="invoices with unread messages">
            {attention.unread_messages.items.map((item) => (
              <Row key={item.invoice_id} to={messageLink(item)} primary={`${item.invoice_number} · ${item.client_name}`}
                secondary={`Latest ${formatTimestampPkt(item.latest_at)}`}
                trailing={`${item.unread_count} unread`} />
            ))}
          </Group>
          <Group title="Proposals awaiting an answer" total={attention.proposals_awaiting.total_count} shown={attention.proposals_awaiting.items.length} moreTo="/proposals" moreLabel="proposals">
            {attention.proposals_awaiting.items.map((item) => (
              <Row key={item.id} to={proposalLink(item)} primary={`${item.title}${item.client_name ? ` · ${item.client_name}` : ''}`}
                secondary={`${item.status === 'viewed' ? 'Viewed' : 'Sent'} ${formatTimestampPkt(item.sent_at)}`}
                trailing={item.is_expired ? 'Expired' : null} danger={item.is_expired} />
            ))}
          </Group>
        </div>
      )}
    </DashboardCard>
  )
}

function Group({ title, total, shown, moreTo, moreLabel, children }) {
  if (total === 0) return null
  const more = moreCount(total, shown)
  return (
    <div>
      <h3 style={{ margin: '0 0 6px', display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {title}
        <span style={{ background: 'var(--bg-surface-3)', color: 'var(--text-secondary)', borderRadius: 'var(--radius-full)', padding: '1px 8px', fontSize: '0.7rem' }}>{total}</span>
      </h3>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>{children}</ul>
      {more > 0 && (
        <Link to={moreTo} className="dash-link" style={{ display: 'inline-block', marginTop: 6, fontSize: '0.78rem', color: 'var(--accent-text, var(--accent))', textDecoration: 'none', borderRadius: 4 }}>
          and {more} more {moreLabel}
        </Link>
      )}
    </div>
  )
}

function Row({ to, primary, secondary, trailing, danger }) {
  return (
    <li>
      <Link to={to} className="dash-link dash-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '8px 6px', borderRadius: 'var(--radius-md)', textDecoration: 'none', color: 'inherit' }}>
        <span style={{ minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: '0.84rem', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{primary}</span>
          <span style={{ display: 'block', fontSize: '0.72rem', color: danger ? 'var(--status-red-text)' : 'var(--text-tertiary)' }}>{secondary}</span>
        </span>
        {trailing && <span style={{ flexShrink: 0, fontSize: '0.8rem', fontWeight: 700, color: danger ? 'var(--status-red-text)' : 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{trailing}</span>}
      </Link>
    </li>
  )
}
