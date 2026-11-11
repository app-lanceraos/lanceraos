// src/components/ContractTable.jsx
//
// Desktop contract list: a real table mirroring ProposalTable.jsx (every th/td/wrapper/hover style from
// listTableStyles.js so the list tables cannot drift). Columns: Contract | Client | Fee | Sign by | Status | Updated.
// Mobile uses the card layout in Contracts.jsx.
//
// The whole row opens the contract, and the title cell is a real <Link>, so Tab reaches every row and Enter opens it (the
// row's own onClick is the mouse convenience; the Link stops propagation so activating it never navigates twice).
//
// "Expired" is not a status: it is the amber badge the server's `is_expired` earns a sent or viewed contract, shown beside
// the status and beside the sign-by date.
import { Link } from 'react-router-dom'

import ContractStatusBadge from './ContractStatusBadge'
import { clickableRowCss, tableStyle, tableWrapperStyle, td, th, theadRowStyle } from './listTableStyles'
import { badgeBaseStyle, statusBadgeStyle } from '@/pages/clientHelpers'
import { OWNER_COPY } from '@/pages/contractCopy'
import { EXPIRED_BADGE, moneyLabel } from '@/pages/contractHelpers'
import { formatDate, formatTimestamp } from '@/pages/proposalHelpers'

export function ExpiredBadge() {
  return <span style={{ ...badgeBaseStyle, ...statusBadgeStyle(EXPIRED_BADGE.statusKey, EXPIRED_BADGE.variant) }}>{EXPIRED_BADGE.label}</span>
}

export default function ContractTable({ contracts, onOpen }) {
  const c = OWNER_COPY.columns
  return (
    <div style={tableWrapperStyle}>
      <style>{clickableRowCss('contract-row')}</style>
      <table style={tableStyle(820)}>
        <thead>
          <tr style={theadRowStyle}>
            <th style={th}>{c.contract}</th>
            <th style={th}>{c.client}</th>
            <th style={th}>{c.fee}</th>
            <th style={th}>{c.signBy}</th>
            <th style={th}>{c.status}</th>
            <th style={th}>{c.updated} (PKT)</th>
          </tr>
        </thead>
        <tbody>
          {contracts.map((contract) => (
            <tr key={contract.id} className="contract-row" onClick={() => onOpen(contract)}>
              <td style={{ ...td, maxWidth: 280 }}>
                <Link
                  to={`/contracts/${contract.id}`}
                  onClick={(e) => e.stopPropagation()}
                  style={{ color: 'var(--text-primary)', textDecoration: 'none', fontWeight: 700, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                >
                  {contract.title}
                </Link>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>{contract.contract_number || OWNER_COPY.noNumber}</span>
              </td>
              <td style={{ ...td, maxWidth: 200 }}>
                {contract.client_name ? (
                  <>
                    <span style={{ display: 'block', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{contract.client_name}</span>
                    {contract.client_company && (
                      <span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{contract.client_company}</span>
                    )}
                  </>
                ) : (
                  <span style={{ color: 'var(--text-tertiary)' }}>{OWNER_COPY.noClient}</span>
                )}
              </td>
              <td style={{ ...td, fontWeight: 700, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                {moneyLabel(contract.fee_amount, contract.currency)}
              </td>
              <td style={{ ...td, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  {formatDate(contract.valid_until)}
                  {contract.is_expired && <ExpiredBadge />}
                </span>
              </td>
              <td style={td}>
                <ContractStatusBadge status={contract.status} expired={contract.is_expired} />
              </td>
              <td style={{ ...td, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{formatTimestamp(contract.updated_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
