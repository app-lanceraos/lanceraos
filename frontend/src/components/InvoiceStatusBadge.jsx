// src/components/InvoiceStatusBadge.jsx
//
// Extracted this pass so Invoices.jsx's InvoiceCard and
// InvoiceDetailPanel.jsx's header render the exact same badge (filled vs.
// outline variant + the icon differentiator for the one remaining
// same-variant collision per color bucket — see INVOICE_STATUS_META's own
// comment in invoiceHelpers.js) rather than each hand-rolling it.
import { Eye, Undo2 } from 'lucide-react'
import { badgeBaseStyle, statusBadgeStyle } from '@/pages/invoiceHelpers'

const ICONS = { eye: Eye, undo: Undo2 }

export default function InvoiceStatusBadge({ meta }) {
  const Icon = meta.icon ? ICONS[meta.icon] : null
  return (
    <span style={{ ...badgeBaseStyle, ...statusBadgeStyle(meta.statusKey, meta.variant), gap: 4 }}>
      {Icon && <Icon size={11} />}
      {meta.label}
    </span>
  )
}
