// src/components/ContractStatusBadge.jsx
//
// A contract's status badge, plus the amber "Expired" badge layered on top when `expired` is true (computed server-side
// on read, never a status value: the same layering as ProposalStatusBadge). The status is always a visible word,
// never colour alone.
import { Eye } from 'lucide-react'

import { badgeBaseStyle, statusBadgeStyle } from '@/pages/clientHelpers'
import { EXPIRED_BADGE, contractStatusMeta } from '@/pages/contractHelpers'

export default function ContractStatusBadge({ status, expired = false }) {
  const meta = contractStatusMeta(status)
  return (
    <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      <span style={{ ...badgeBaseStyle, ...statusBadgeStyle(meta.statusKey, meta.variant), gap: 4 }}>
        {meta.icon === 'eye' && <Eye size={11} aria-hidden="true" />}
        {meta.label}
      </span>
      {expired && (
        <span style={{ ...badgeBaseStyle, ...statusBadgeStyle(EXPIRED_BADGE.statusKey, EXPIRED_BADGE.variant) }}>
          {EXPIRED_BADGE.label}
        </span>
      )}
    </span>
  )
}
