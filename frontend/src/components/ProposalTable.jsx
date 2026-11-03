// src/components/ProposalTable.jsx
//
// Desktop proposal list — a real table, mirroring InvoiceTable.jsx /
// ClientTable.jsx (every th/td/wrapper/hover style from listTableStyles.js so
// the three list tables cannot drift). Columns: Proposal | Client | Status |
// Total | Valid until | Updated. Mobile uses the card layout in Proposals.jsx.
//
// The whole row opens the proposal, like the other tables — but unlike them
// it is also keyboard-operable: the title cell is a real <Link>, so Tab
// reaches every row and Enter opens it, and a screen reader hears a link.
// (The row's own onClick is the mouse convenience; the Link stops
// propagation so activating it never navigates twice.)
import { Link } from 'react-router-dom'

import ProposalStatusBadge from './ProposalStatusBadge'
import { clickableRowCss, tableStyle, tableWrapperStyle, td, th, theadRowStyle } from './listTableStyles'
import { formatDate, formatProposalMoney, formatTimestamp } from '@/pages/proposalHelpers'

export default function ProposalTable({ proposals, onOpen }) {
  return (
    <div style={tableWrapperStyle}>
      <style>{clickableRowCss('proposal-row')}</style>
      <table style={tableStyle(760)}>
        <thead>
          <tr style={theadRowStyle}>
            <th style={th}>Proposal</th>
            <th style={th}>Client</th>
            <th style={th}>Status</th>
            <th style={th}>Total</th>
            <th style={th}>Valid until</th>
            <th style={th}>Updated</th>
          </tr>
        </thead>
        <tbody>
          {proposals.map((proposal) => (
            <tr key={proposal.id} className="proposal-row" onClick={() => onOpen(proposal)}>
              <td style={{ ...td, maxWidth: 280 }}>
                <Link
                  to={`/proposals/${proposal.id}`}
                  onClick={(e) => e.stopPropagation()}
                  style={{ color: 'var(--text-primary)', textDecoration: 'none', fontWeight: 700, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                >
                  {proposal.title}
                </Link>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>{proposal.proposal_number || 'Draft'}</span>
              </td>
              <td style={{ ...td, color: 'var(--text-secondary)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {proposal.client_name || 'No client yet'}
              </td>
              <td style={td}>
                <ProposalStatusBadge status={proposal.status} expired={proposal.is_expired} />
              </td>
              <td style={{ ...td, fontWeight: 700, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                {formatProposalMoney(proposal.total, proposal.currency)}
              </td>
              <td style={{ ...td, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{formatDate(proposal.valid_until)}</td>
              <td style={{ ...td, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{formatTimestamp(proposal.updated_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
