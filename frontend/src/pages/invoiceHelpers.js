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

// ── Invoice form state helpers ──────────────────────────────────────
// Moved out of InvoiceFormFields.jsx (a real bug fix, not a style choice):
// that file's default export is a React component, and Vite/React Fast
// Refresh requires a component file to export *only* components — mixing
// in these plain functions broke Fast Refresh's boundary detection
// (confirmed directly in the dev server log: "Could not Fast Refresh
// ('blankInvoiceForm' export is incompatible)... invalidate"), which
// forces a full browser reload on every edit to that file instead of a
// clean hot-swap. This file has no JSX and exports no component, so it's
// a safe home for them — same shape as invoiceToForm being pure data
// transforms, no component behavior at all.
const BLANK_ITEM = { description: '', quantity: '1', unit_price: '' }

export function blankInvoiceForm() {
  return {
    clientMode: 'onetime',
    client: null,
    client_name: '', client_email: '', client_company: '', client_address: '', client_phone: '',
    is_one_time_client: true,
    currency: 'USD',
    tax_rate: '0', discount_amount: '0',
    due_date: '',
    notes: '', terms: '',
    reminders_enabled: true,
    late_fee_enabled: false, late_fee_rate: '2.00',
    is_recurring: false, recurring_interval_days: 30, recurring_auto_send: false,
    items: [{ ...BLANK_ITEM }],
  }
}

export function invoiceToForm(invoice) {
  return {
    clientMode: invoice.client ? 'existing' : 'onetime',
    client: invoice.client || null,
    client_name: invoice.client_name || '', client_email: invoice.client_email || '',
    client_company: invoice.client_company || '', client_address: invoice.client_address || '',
    client_phone: invoice.client_phone || '',
    is_one_time_client: invoice.is_one_time_client ?? !invoice.client,
    currency: invoice.currency || 'USD',
    tax_rate: String(invoice.tax_rate ?? '0'), discount_amount: String(invoice.discount_amount ?? '0'),
    due_date: invoice.due_date || '',
    notes: invoice.notes || '', terms: invoice.terms || '',
    reminders_enabled: invoice.reminders_enabled ?? true,
    late_fee_enabled: invoice.late_fee_enabled ?? false, late_fee_rate: String(invoice.late_fee_rate ?? '2.00'),
    is_recurring: invoice.is_recurring ?? false,
    recurring_interval_days: invoice.recurring_interval_days || 30,
    recurring_auto_send: invoice.recurring_auto_send ?? false,
    items: invoice.items?.length > 0
      ? invoice.items.map((it) => ({ description: it.description, quantity: String(it.quantity), unit_price: String(it.unit_price) }))
      : [{ ...BLANK_ITEM }],
  }
}

export function formToPayload(form) {
  return {
    client: form.clientMode === 'existing' ? form.client : null,
    client_name: form.client_name, client_email: form.client_email,
    client_company: form.client_company, client_address: form.client_address, client_phone: form.client_phone,
    currency: form.currency,
    tax_rate: parseFloat(form.tax_rate) || 0,
    discount_amount: parseFloat(form.discount_amount) || 0,
    due_date: form.due_date || null,
    notes: form.notes, terms: form.terms,
    reminders_enabled: form.reminders_enabled,
    late_fee_enabled: form.late_fee_enabled,
    late_fee_rate: parseFloat(form.late_fee_rate) || 0,
    is_recurring: form.is_recurring,
    recurring_interval_days: form.is_recurring ? Number(form.recurring_interval_days) : null,
    recurring_auto_send: form.recurring_auto_send,
    is_one_time_client: form.clientMode === 'onetime',
    items: form.items
      .filter((it) => it.description.trim())
      .map((it, i) => ({
        description: it.description,
        quantity: parseFloat(it.quantity) || 1,
        unit_price: parseFloat(it.unit_price) || 0,
        sort_order: i + 1,
      })),
  }
}

export function computeTotals(form) {
  const subtotal = form.items.reduce((s, it) => s + (parseFloat(it.quantity) || 0) * (parseFloat(it.unit_price) || 0), 0)
  const tax = subtotal * (parseFloat(form.tax_rate) || 0) / 100
  const discount = parseFloat(form.discount_amount) || 0
  const total = Math.max(0, subtotal + tax - discount)
  return { subtotal, tax, discount, total }
}
