// src/components/InvoiceTable.jsx
//
// Desktop invoice list — a real table (List/Table restructure pass),
// replacing the old card grid at desktop widths. Columns: checkbox |
// Invoice # | Client | Amount | Issue Date | Due Date | Status.
// Mobile keeps the pre-existing card layout (Invoices.jsx renders
// InvoiceCard directly at ≤768px) — this component is desktop-only.
//
// InvoiceDetailPanel redesign round (item 6): the dedicated Action column
// (an "Open" icon button per row) is removed entirely — the whole row is
// now the open-affordance, matching InvoiceCard's existing mobile
// behavior exactly (cursor:pointer + a real hover state via the
// .invoice-row CSS class below, since a per-row :hover state isn't
// expressible through this codebase's inline-style convention alone).
// The checkbox column's own click is stopped from bubbling to the row —
// otherwise selecting a row for bulk delete would also open its detail
// panel, the same conflict InvoiceCard's own selectable toggle button
// already guards against.
//
// Bulk delete's own trigger moved out of this table's header cell (a
// real, reported misplacement fixed there once already, but which loses
// its home entirely once the Action column it lived in is gone) — it now
// lives in Invoices.jsx's own floating bulk-action bar, unified this
// round to render at every width instead of being a mobile-only
// affordance (see that file's own comment).
//
// The checkbox column only exists at all when at least one row in the
// current view is deletion-eligible (draft/created) — a status-filtered
// view showing only ineligible invoices (e.g. filtered to Sent) hides
// the whole selection affordance (header cell included), rather than
// rendering an empty, useless column.
import InvoiceStatusBadge from './InvoiceStatusBadge'
import {
  INVOICE_STATUS_META, OVERDUE_BADGE, STATUS_BADGE_STYLE, badgeBaseStyle, formatMoney,
} from '@/pages/invoiceHelpers'

const th = { textAlign: 'left', padding: '10px 12px', fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }
const td = { padding: '12px', fontSize: '0.84rem', color: 'var(--text-primary)', borderTop: '1px solid var(--border-subtle)', verticalAlign: 'middle' }

export default function InvoiceTable({ invoices, deleteEligibleStatuses, selectedIds, onToggleSelect, onSelectAllEligible, onClearSelection, onOpen }) {
  const eligibleIds = invoices.filter((inv) => deleteEligibleStatuses.includes(inv.status)).map((inv) => inv.id)
  const hasEligible = eligibleIds.length > 0
  const allEligibleSelected = hasEligible && eligibleIds.every((id) => selectedIds.has(id));

  return (
    <div style={{ overflowX: 'auto', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)' }}>
      <style>{`
        .invoice-row { cursor: pointer; transition: background var(--transition-fast); }
        .invoice-row:not([data-selected="true"]):hover { background: var(--bg-surface-2); }
      `}</style>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
        <thead>
          <tr style={{ background: 'var(--bg-surface-2)' }}>
            {hasEligible && (
              <th style={{ ...th, width: 36 }}>
                <input
                  type="checkbox"
                  checked={allEligibleSelected}
                  onChange={() => (allEligibleSelected ? onClearSelection() : onSelectAllEligible())}
                  aria-label="Select all eligible invoices on this page"
                  style={{ accentColor: 'var(--accent)', width: 15, height: 15, cursor: 'pointer' }}
                />
              </th>
            )}
            <th style={th}>Invoice</th>
            <th style={th}>Client</th>
            <th style={th}>Amount</th>
            <th style={th}>Issue Date</th>
            <th style={th}>Due Date</th>
            <th style={th}>Status</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((inv) => {
            const meta = INVOICE_STATUS_META[inv.status] || INVOICE_STATUS_META.draft
            const isOverdue = inv.days_overdue > 0
            const isEligible = deleteEligibleStatuses.includes(inv.status)
            const isSelected = selectedIds.has(inv.id)
            return (
              <tr
                key={inv.id} className="invoice-row" data-selected={isSelected}
                onClick={() => onOpen(inv)}
                style={{ background: isSelected ? 'var(--accent-glow)' : 'transparent' }}
              >
                {hasEligible && (
                  <td style={td} onClick={(e) => e.stopPropagation()}>
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
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
