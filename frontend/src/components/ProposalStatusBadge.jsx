// src/components/ProposalStatusBadge.jsx
//
// A proposal's status badge, plus the amber "Expired" badge layered on top
// when `expired` is true (computed server-side on read, never a status value —
// same layering as Invoice's Overdue badge). Mirrors InvoiceStatusBadge.jsx.
import { Eye } from 'lucide-react'

import { badgeBaseStyle, statusBadgeStyle } from '@/pages/clientHelpers'
import { EXPIRED_BADGE, proposalStatusMeta } from '@/pages/proposalHelpers'

export default function ProposalStatusBadge({ status, expired = false }) {
  const meta = proposalStatusMeta(status)
  return (
    <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      <span style={{ ...badgeBaseStyle, ...statusBadgeStyle(meta.statusKey, meta.variant), gap: 4 }}>
        {meta.icon === 'eye' && <Eye size={11} />}
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
