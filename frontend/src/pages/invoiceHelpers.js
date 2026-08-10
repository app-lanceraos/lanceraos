// src/pages/invoiceHelpers.js
// Small, pure helpers shared between Invoices.jsx and InvoiceDetailPanel.jsx —
// not a React component, same "not a Section 12 shared-utility-component"
// reasoning as clientHelpers.js. formatMoney/STATUS_BADGE_STYLE/badgeBaseStyle/
// CURRENCY_OPTIONS are imported from clientHelpers rather than duplicated —
// they're generic, not client-specific in shape.

export { formatMoney, STATUS_BADGE_STYLE, STATUS_BADGE_OUTLINE_STYLE, statusBadgeStyle, badgeBaseStyle, CURRENCY_OPTIONS } from './clientHelpers'

// Invoice.STATUS_CHOICES (apps/invoices/models.py) mapped to DESIGN.md's
// real 5-color status token set (Section 2.5/7) — no new hex values
// invented. Overdue is deliberately NOT a key here — it is never a status
// value in v2 (a real v1 bug this build fixes; see Invoice.days_overdue's
// own docstring). Overdue is a separate, orthogonal badge layered on top
// of whichever status is real — see OVERDUE_BADGE below.
//
// `variant` ('filled' default, or 'outline') differentiates statuses that
// share one color bucket — confirmed as a real, textually-different-but-
// visually-identical bug: created/sent/viewed all mapped to plain
// 'blue', and separately draft/cancelled/refunded all mapped to plain
// 'gray'. Fixed the same way in both buckets (outline for the "earliest"/
// least-final member, e.g. created and draft) rather than only patching
// the one bucket the bug report named, since it's the identical
// underlying issue — see DECISIONS.md. `icon` is a second, cheap
// differentiator (lucide-react, already a project dependency) for the one
// remaining same-variant collision per bucket (sent/viewed both filled
// blue; cancelled/refunded both filled gray) — rendered by whichever
// component maps this meta onto a badge (InvoiceCard, InvoiceDetailPanel).
export const INVOICE_STATUS_META = {
  draft: { label: 'Draft', statusKey: 'gray', variant: 'outline' },
  // Display label only — matches the "Finalise" action button's own name.
  // The stored status VALUE stays 'created' everywhere (DB/API/filter
  // query params) — this is a display-layer rename, not a data migration;
  // see DECISIONS.md.
  created: { label: 'Finalised', statusKey: 'blue', variant: 'outline' },
  sent: { label: 'Sent', statusKey: 'blue', variant: 'filled' },
  viewed: { label: 'Viewed', statusKey: 'blue', variant: 'filled', icon: 'eye' },
  partially_paid: { label: 'Partially Paid', statusKey: 'amber', variant: 'filled' },
  paid: { label: 'Paid', statusKey: 'green', variant: 'filled' },
  cancelled: { label: 'Cancelled', statusKey: 'gray', variant: 'filled' },
  refunded: { label: 'Refunded', statusKey: 'gray', variant: 'filled', icon: 'undo' },
  bad_debt: { label: 'Bad Debt', statusKey: 'red', variant: 'filled' },
}

export const OVERDUE_BADGE = { label: 'Overdue', statusKey: 'red' }

export const STATUS_FILTER_OPTIONS = [
  { key: '', label: 'All' },
  { key: 'draft', label: 'Draft' },
  { key: 'created', label: 'Finalised' },
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
    client: null,
    save_as_new_client: false,
    client_name: '', client_email: '', client_company: '', client_address: '', client_phone: '',
    currency: 'USD',
    tax_rate: '0', discount_amount: '0',
    due_date: '',
    notes: '', terms: '',
    // Defaults OFF for a newly-created invoice — was `true` (ported
    // unchanged from v1); a fresh invoice hasn't been sent yet, so there's
    // nothing to remind about until the freelancer actually sends it and
    // makes a real choice (see DECISIONS.md). Invoice.reminders_enabled's
    // own model-level default must agree — see apps/invoices/models.py.
    reminders_enabled: false,
    late_fee_enabled: false, late_fee_rate: '2.00',
    is_recurring: false, recurring_interval_days: 30, recurring_auto_send: false,
    items: [{ ...BLANK_ITEM }],
  }
}

export function invoiceToForm(invoice) {
  return {
    client: invoice.client || null,
    save_as_new_client: false,
    client_name: invoice.client_name || '', client_email: invoice.client_email || '',
    client_company: invoice.client_company || '', client_address: invoice.client_address || '',
    client_phone: invoice.client_phone || '',
    currency: invoice.currency || 'USD',
    tax_rate: String(invoice.tax_rate ?? '0'), discount_amount: String(invoice.discount_amount ?? '0'),
    due_date: invoice.due_date || '',
    notes: invoice.notes || '', terms: invoice.terms || '',
    reminders_enabled: invoice.reminders_enabled ?? false,
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
    client: form.client || null,
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
    is_one_time_client: !form.client,
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

// The "hasn't been sent through LanceraOS" banner — exactly 2 real,
// distinct states show it, nothing else:
//   a) status === 'created', never mark-sent at all yet.
//   b) status === 'sent' specifically, but sent_via_platform is False —
//      the freelancer marked it sent themselves (manual dropdown-flip).
//      Acknowledges that choice directly, states the real reminders
//      on/off decision they made at that time, and clarifies view/payment
//      tracking only activates once the client actually visits the link.
// Every other status (draft, viewed, partially_paid, paid, cancelled,
// refunded, bad_debt) shows no banner — either it never applied (draft),
// or the invoice has already moved past the point this warning is about
// (a viewed/paid invoice's tracking already activated; the "hasn't been
// sent" warning would be actively wrong there, a real bug this fixes —
// the previous version fell through to case (b)'s copy for EVERY status
// beyond 'created', not just 'sent'). sent_via_platform === True (Step 10,
// no real data yet) always suppresses the banner regardless of status,
// checked first.
export function getSendBannerCopy(invoice) {
  if (invoice.sent_via_platform) return null

  if (invoice.status === 'created') {
    return "This invoice hasn't been sent through LanceraOS — reminders, view tracking, and payment tracking won't activate until you send it.";
  }

  if (invoice.status === 'sent') {
    const remindersPhrase = invoice.reminders_enabled
      ? 'You chose to enable reminders when you marked it sent.'
      : 'You chose to leave reminders off when you marked it sent.'
    const sentDate = invoice.sent_at ? new Date(invoice.sent_at).toLocaleDateString() : null
    return `You marked this invoice as sent yourself${sentDate ? ` on ${sentDate}` : ''} — LanceraOS didn't deliver it. `
      + `${remindersPhrase} View and payment tracking will only activate once your client actually opens the invoice link.`
  }

  return null
}

// ── Timeline helpers ──────────────────────────────────────────────
// Pure, no-JSX — live here (not InvoiceDetailPanel.jsx) so they're
// directly unit-testable without rendering the whole panel; `timelineIcon`
// (lucide-react, returns JSX) stays inline in that component instead.
export function timelineDotColor(type) {
  return {
    payment: 'var(--status-green-text)', reminder: 'var(--status-amber-text)', view: 'var(--status-blue-text)',
    created: 'var(--text-tertiary)', finalised: 'var(--status-blue-text)', sent: 'var(--status-blue-text)',
  }[type] || 'var(--text-tertiary)'
}

// 'sent's `via` field (apps/invoices/views.py's invoice_timeline) is the
// real actor signal, not a separate tracked "who" — there's only ever one
// possible human actor for a manual mark-sent (the invoice's own
// freelancer; no client/staff/other-account path exists), so "by you" is
// accurate and the clearest first-person framing for someone viewing their
// own timeline, without needing a dedicated actor field on the model.
export function timelineLabel(ev) {
  if (ev.type === 'payment') return `Payment recorded — ${formatMoney(ev.amount, ev.currency)} via ${ev.source}`
  if (ev.type === 'reminder') return `Reminder ${ev.reminder_number} sent${ev.delivered === false ? ' (delivery failed)' : ''}`
  if (ev.type === 'view') return `Viewed via ${(ev.source || 'link').replace('_', ' ')}`
  if (ev.type === 'created') return 'Invoice created'
  if (ev.type === 'finalised') return `Finalised${ev.invoice_number ? ` as ${ev.invoice_number}` : ''}`
  if (ev.type === 'sent') return ev.via === 'platform' ? 'Sent by LanceraOS' : 'Marked as sent by you'
  return ev.type
}

export function computeTotals(form) {
  const subtotal = form.items.reduce((s, it) => s + (parseFloat(it.quantity) || 0) * (parseFloat(it.unit_price) || 0), 0)
  const tax = subtotal * (parseFloat(form.tax_rate) || 0) / 100
  const discount = parseFloat(form.discount_amount) || 0
  const total = Math.max(0, subtotal + tax - discount)
  return { subtotal, tax, discount, total }
}
