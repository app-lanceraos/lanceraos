// src/pages/invoiceHelpers.js
// Small, pure helpers shared between Invoices.jsx and InvoiceDetailPanel.jsx —
// not a React component, same "not a Section 12 shared-utility-component"
// reasoning as clientHelpers.js. formatMoney/STATUS_BADGE_STYLE/badgeBaseStyle/
// CURRENCY_OPTIONS are imported from clientHelpers rather than duplicated —
// they're generic, not client-specific in shape.

export { formatMoney, STATUS_BADGE_STYLE, badgeBaseStyle, CURRENCY_OPTIONS } from './clientHelpers'

// Invoice.STATUS_CHOICES (apps/invoices/models.py) mapped to DESIGN.md's
// status color map (Section 2.5/7). Overdue is deliberately NOT a key here —
// it is never a status value in v2 (a real v1 bug this build fixes; see
// Invoice.days_overdue's own docstring). Overdue is a separate, orthogonal
// badge layered on top of whichever status is real — see OVERDUE_BADGE below.
export const INVOICE_STATUS_META = {
  draft: { label: 'Draft', statusKey: 'gray' },
  created: { label: 'Created', statusKey: 'blue' },
  sent: { label: 'Sent', statusKey: 'blue' },
  viewed: { label: 'Viewed', statusKey: 'blue' },
  partially_paid: { label: 'Partially Paid', statusKey: 'amber' },
  paid: { label: 'Paid', statusKey: 'green' },
  cancelled: { label: 'Cancelled', statusKey: 'gray' },
  refunded: { label: 'Refunded', statusKey: 'gray' },
  bad_debt: { label: 'Bad Debt', statusKey: 'red' },
}

export const OVERDUE_BADGE = { label: 'Overdue', statusKey: 'red' }

export const STATUS_FILTER_OPTIONS = [
  { key: '', label: 'All' },
  { key: 'draft', label: 'Draft' },
  { key: 'created', label: 'Created' },
  { key: 'sent', label: 'Sent' },
  { key: 'viewed', label: 'Viewed' },
  { key: 'partially_paid', label: 'Partially Paid' },
  { key: 'paid', label: 'Paid' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'refunded', label: 'Refunded' },
  { key: 'bad_debt', label: 'Bad Debt' },
]

export const SORT_OPTIONS = [
  { value: 'recent', label: 'Most Recent' },
  { value: 'due_date', label: 'Due Date' },
  { value: 'total', label: 'Amount: High to Low' },
  { value: 'client_name', label: 'Client Name' },
]

// InvoicePartialPayment.SOURCE_CHOICES, apps/invoices/models.py.
export const PAYMENT_SOURCE_OPTIONS = [
  { value: 'payoneer', label: 'Payoneer' },
  { value: 'wise', label: 'Wise' },
  { value: 'jazzcash', label: 'JazzCash' },
  { value: 'easypaisa', label: 'Easypaisa' },
  { value: 'bank', label: 'Bank Transfer' },
  { value: 'cash', label: 'Cash' },
  { value: 'other', label: 'Other' },
]

// Invoice.RECURRING_INTERVAL_CHOICES, apps/invoices/models.py.
export const RECURRING_INTERVAL_OPTIONS = [
  { value: 7, label: 'Weekly' },
  { value: 14, label: 'Bi-weekly' },
  { value: 30, label: 'Monthly' },
  { value: 60, label: 'Every 2 months' },
  { value: 90, label: 'Quarterly' },
  { value: 365, label: 'Annually' },
]

// Formats a plain aggregate number with no currency symbol — invoice_summary
// and invoice_aging_report sum raw Decimal totals across every invoice's own
// currency with no conversion (verified directly against apps/invoices/views.py:
// neither endpoint's response includes a currency field at all). Prefixing a
// single currency symbol on a possibly-multi-currency sum would misrepresent
// the number, so this deliberately renders it bare rather than reusing
// formatMoney with an assumed currency.
export function formatAggregate(amount) {
  const value = Number(amount || 0)
  return value.toLocaleString('en', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

export function daysOverdueLabel(days) {
  if (!days || days <= 0) return null
  return `${days} day${days !== 1 ? 's' : ''} overdue`
}

// Undo-payment confirmation copy — mirrors invoice_undo_payment's own
// UNDO_CONFIRMATION_AGE_DAYS gate (apps/invoices/views.py) exactly, so the
// frontend never shows a confirmation the backend wouldn't also require,
// and vice versa.
export const UNDO_CONFIRMATION_AGE_DAYS = 7

export function daysSince(isoTimestamp) {
  if (!isoTimestamp) return null
  const ms = Date.now() - new Date(isoTimestamp).getTime()
  return Math.floor(ms / (1000 * 60 * 60 * 24))
}
