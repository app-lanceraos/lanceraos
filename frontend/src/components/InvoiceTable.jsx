// src/components/InvoiceTable.jsx
//
// Desktop invoice list — a real table (List/Table restructure pass),
// replacing the old card grid at desktop widths. Columns: checkbox |
// Invoice # | Client | Amount | Issue Date | Due Date | Status | Action.
// Mobile keeps the pre-existing card layout (Invoices.jsx renders
// InvoiceCard directly at ≤768px) — this component is desktop-only.
//
// The checkbox column only exists at all when at least one row in the
// current view is deletion-eligible (draft/created) — a status-filtered
// view showing only ineligible invoices (e.g. filtered to Sent) hides
// the whole selection affordance (header cell included), rather than
// rendering an empty, useless column. Header cell swaps to a delete
// icon once ≥1 row is selected, same control, not a second one.
import { PanelRightOpen, Trash2 } from 'lucide-react'

import InvoiceStatusBadge from './InvoiceStatusBadge'
import {
  INVOICE_STATUS_META, OVERDUE_BADGE, STATUS_BADGE_STYLE, badgeBaseStyle, formatMoney,
} from '@/pages/invoiceHelpers'

const th = { textAlign: 'left', padding: '10px 12px', fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }
const td = { padding: '12px', fontSize: '0.84rem', color: 'var(--text-primary)', borderTop: '1px solid var(--border-subtle)', verticalAlign: 'middle' }

export default function InvoiceTable({ invoices, deleteEligibleStatuses, selectedIds, onToggleSelect, onSelectAllEligible, onClearSelection, onRequestBulkDelete, onOpen }) {
  const eligibleIds = invoices.filter((inv) => deleteEligibleStatuses.includes(inv.status)).map((inv) => inv.id)
  const hasEligible = eligibleIds.length > 0
  const allEligibleSelected = hasEligible && eligibleIds.every((id) => selectedIds.has(id));

  return (
    <div style={{ overflowX: 'auto', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
        <thead>
          <tr style={{ background: 'var(--bg-surface-2)' }}>
            {hasEligible && (
              <th style={{ ...th, width: 36 }}>
                {selectedIds.size > 0 ? (
                  <button
                    onClick={onRequestBulkDelete}
                    aria-label="Delete selected invoices"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--status-red-text)', display: 'flex', padding: 0 }}
                  >
                    <Trash2 size={15} />
                  </button>
                ) : (
                  <input
                    type="checkbox"
                    checked={allEligibleSelected}
                    onChange={() => (allEligibleSelected ? onClearSelection() : onSelectAllEligible())}
                    aria-label="Select all eligible invoices on this page"
                    style={{ accentColor: 'var(--accent)', width: 15, height: 15, cursor: 'pointer' }}
                  />
                )}
              </th>
            )}
            <th style={th}>Invoice #</th>
            <th style={th}>Client</th>
            <th style={th}>Amount</th>
            <th style={th}>Issue Date</th>
            <th style={th}>Due Date</th>
            <th style={th}>Status</th>
            <th style={{ ...th, width: 48 }} aria-hidden="true" />
          </tr>
        </thead>
        <tbody>
          {invoices.map((inv) => {
            const meta = INVOICE_STATUS_META[inv.status] || INVOICE_STATUS_META.draft
            const isOverdue = inv.days_overdue > 0
            const isEligible = deleteEligibleStatuses.includes(inv.status)
            const isSelected = selectedIds.has(inv.id)
            return (
              <tr key={inv.id} style={{ background: isSelected ? 'var(--accent-glow)' : 'transparent' }}>
                {hasEligible && (
                  <td style={td}>
                    {isEligible && (
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => onToggleSelect(inv.id)}
                        aria-label={isSelected ? 'Deselect invoice' : 'Select invoice'}
                        style={{ accentColor: 'var(--accent)', width: 15, height: 15, cursor: 'pointer' }}
                      />
                    )}
                  </td>
                )}
                <td style={{ ...td, fontWeight: 700 }}>{inv.invoice_number || '(unnumbered draft)'}</td>
                <td style={{ ...td, color: 'var(--text-secondary)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {inv.client_name || 'No client yet'}
                </td>
                <td style={{ ...td, fontWeight: 700, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                  {formatMoney(inv.total, inv.currency)}
                </td>
                <td style={{ ...td, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{inv.issue_date || '—'}</td>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>
                  <span style={{ color: isOverdue ? 'var(--status-red-text)' : 'var(--text-secondary)', fontWeight: isOverdue ? 600 : 400 }}>
                    {inv.due_date || '—'}
                  </span>
                </td>
                <td style={td}>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <InvoiceStatusBadge meta={meta} />
                    {isOverdue && <span style={{ ...badgeBaseStyle, ...STATUS_BADGE_STYLE[OVERDUE_BADGE.statusKey] }}>{OVERDUE_BADGE.label}</span>}
                  </div>
                </td>
                <td style={{ ...td, textAlign: 'center' }}>
                  <button
                    onClick={() => onOpen(inv)}
                    aria-label={`Open ${inv.invoice_number || 'invoice'}`}
                    className="fos-btn fos-btn-ghost"
                    style={{ padding: 6 }}
                  >
                    <PanelRightOpen size={15} />
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
