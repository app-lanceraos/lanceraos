// src/pages/invoiceHelpers.js
// Small, pure helpers shared between Invoices.jsx and InvoiceDetailPanel.jsx —
// not a React component, same "not a Section 12 shared-utility-component"
// reasoning as clientHelpers.js. formatMoney/STATUS_BADGE_STYLE/badgeBaseStyle/
// CURRENCY_OPTIONS are imported from clientHelpers rather than duplicated —
// they're generic, not client-specific in shape.

export { formatMoney, STATUS_BADGE_STYLE, STATUS_BADGE_OUTLINE_STYLE, statusBadgeStyle, badgeBaseStyle, CURRENCY_OPTIONS } from './clientHelpers'
import { formatMoney } from './clientHelpers'

// Today's date as the SERVER counts it: the platform runs on Pakistan
// Standard Time only (CLAUDE.md backend rule 2; USE_TZ=False), and the
// payment-date rule (serializers.validate_payment_date_for_invoice) bounds
// a payment between the invoice's issue_date and PKT-today. A payment-date
// input must therefore DEFAULT to this, not to `new Date().toISOString()`
// (the UTC date, a day behind PKT from 00:00 to 05:00 — which would put the
// default before the issue_date of an invoice issued that same PKT day) and
// not to the browser's local date (a day ahead of PKT for someone east of
// it, which the server would reject as the future). Same date the backend's
// _today() returns, by construction.
export function todayInPlatformTimezone() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' })
}

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

// Real, confirmed bug fix (item 12 of the verification pass): invoice_summary
// used to sum raw Decimals across every invoice's own currency with no
// conversion at all (e.g. $64 + Rs.100 showing as "164"). It now returns one
// real figure already unified into the freelancer's own
// FreelancerProfile.default_currency (core.money.Money, server-side), plus a
// `currency` field alongside it — so this formats that unified figure WITH
// its real currency label, not a bare number pretending not to have one.
export function formatAggregate(amount, currency) {
  return formatMoney(amount, currency)
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

// ── Invoice action eligibility ──────────────────────────────────────
// Per-Row Quick Actions pass (20 September 2026) — moved here from
// InvoiceDetailPanel.jsx (ACTIVE_STATUSES/NO_PAYMENT_STATUSES were local
// consts there) so InvoiceTable.jsx's new per-row quick-actions menu can
// read the exact same rules instead of re-deriving its own copy. This is
// the same lesson NO_PAYMENT_STATUSES's own history already teaches
// (see DECISIONS.md, audit finding INV-009/FE-001): that constant
// existed, but the actual Undo Payment gate was a separately hand-rolled
// condition that drifted from it and omitted 'refunded', making Undo
// Payment reachable — and briefly destructive — on a refunded invoice.
// Every `canX(invoice)` function below is now the ONE place its action's
// eligibility rule lives; InvoiceDetailPanel.jsx and the new
// InvoiceRowQuickActions.jsx both import and call these directly rather
// than each keeping their own status-list copy.
export const ACTIVE_STATUSES = ['sent', 'viewed', 'partially_paid']
// Matches invoice_add_payment/invoice_mark_paid/invoice_undo_payment's
// own status guard on the backend exactly — keep both in sync.
export const NO_PAYMENT_STATUSES = ['cancelled', 'bad_debt', 'refunded', 'draft']
// Matches apps/invoices/views.py's invoice_detail DELETE rule exactly
// ("Only draft or created invoices can be deleted").
export const DELETE_ELIGIBLE_STATUSES = ['draft', 'created']

// Duplicate/Copy Invoice Link/Download Invoice are all reachable
// SOMEWHERE in InvoiceDetailPanel.jsx (footer or More menu, depending on
// status) for every non-draft invoice — a draft has no frozen PDF/
// portal link yet, and no meaningful content to duplicate as "a copy of
// a sent invoice." This is the coarser "can this action happen at all"
// question the quick-actions menu needs; InvoiceDetailPanel.jsx's own
// footerShowsDuplicate/downloadReachableInMoreMenu/isTerminal booleans
// stay exactly as they are — those decide WHERE within the panel an
// already-eligible action shows (a layout choice), not whether it's
// eligible at all, so they aren't duplicated eligibility rules and
// aren't touched by this pass.
export function canDuplicateInvoice(invoice) {
  return invoice.status !== 'draft'
}

export function canCopyInvoiceLink(invoice) {
  return invoice.status !== 'draft' && !!invoice.portal_view_url
}

export function canDownloadInvoice(invoice) {
  return invoice.status !== 'draft'
}

export function canResendInvoice(invoice) {
  return ACTIVE_STATUSES.includes(invoice.status)
}

export function canCancelInvoice(invoice) {
  return ACTIVE_STATUSES.includes(invoice.status)
}

export function canMarkInvoiceBadDebt(invoice) {
  return ACTIVE_STATUSES.includes(invoice.status)
}

export function canRefundInvoice(invoice) {
  return ['paid', 'partially_paid'].includes(invoice.status)
}

export function canUndoInvoicePayment(invoice) {
  return Number(invoice.amount_paid) > 0 && !NO_PAYMENT_STATUSES.includes(invoice.status)
}

export function canDeleteInvoice(invoice) {
  return DELETE_ELIGIBLE_STATUSES.includes(invoice.status)
}

export function canPauseResumeRecurring(invoice) {
  return !!invoice.is_recurring
}

// Shared with InvoiceDetailPanel.jsx's own requestUndoPayment (which
// already has a loaded `timeline` array to search) and
// InvoiceRowQuickActions.jsx (which fetches one invoice's timeline
// on demand, only when Undo Payment is actually clicked) — the same
// "find the most recent payment event" logic, not re-derived twice.
export function findLastPaymentEvent(timelineEntries) {
  return [...timelineEntries].reverse().find((e) => e.type === 'payment') || null
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

// Today, local-timezone, YYYY-MM-DD — matches Invoice.issue_date's own
// default (apps/invoices/models.py's _today(), not timezone.now(), per
// that field's own comment) and what a bare `<input type="date">` expects.
function todayIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function blankInvoiceForm() {
  return {
    client: null,
    save_as_new_client: false,
    client_name: '', client_email: '', client_company: '', client_address: '', client_phone: '',
    currency: 'USD',
    tax_rate: '0', discount_amount: '0',
    issue_date: todayIso(),
    due_date: '',
    notes: '', terms: '',
    // Reverted back to `true` — this is a real, deliberate lifecycle rule
    // now, not a single default flip: the wizard's own visible starting
    // state stays ON (a user creating an invoice sees reminders on by
    // default, and their explicit choice is respected through creation/
    // autosave), but invoice_finalise (apps/invoices/views.py) now
    // unconditionally forces the stored value to False the moment an
    // invoice actually leaves draft, regardless of whatever was submitted
    // here — see that function's own comment and DECISIONS.md for why.
    // Invoice.reminders_enabled's bare model-field default is deliberately
    // LEFT at False (unrelated to this wizard default, and moot post-
    // finalise anyway) — the one narrow case where the two can disagree
    // is a preset-created draft (which skips this function and the
    // wizard's "Next" payload entirely) reopened before being finalised;
    // flagged here rather than silently resolved, since the task scoped
    // this default change to the wizard/creation UI specifically.
    reminders_enabled: true,
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
    issue_date: invoice.issue_date || todayIso(),
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
    issue_date: form.issue_date || null,
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

// Every status this invoice can never leave again — nothing left to
// remind anyone about. Single source of truth: InvoiceDetailPanel.jsx's
// own Details-tab reminders toggle imports this same constant rather
// than keeping its own local copy (a real, confirmed bug this pass —
// the toggle already hid itself correctly on these statuses, but
// getSendBannerCopy below had no matching check at all, so a terminal
// invoice with reminders_enabled=false still showed "Reminders are
// off — turn them on below" pointing at a control that wasn't even on
// screen).
export const REMINDERS_HIDDEN_STATUSES = ['paid', 'bad_debt', 'refunded', 'cancelled']

// Statuses where InvoiceDetailPanel.jsx's header "Due <date> · <countdown>"
// line is hidden: the invoice is settled, so there is nothing left to be
// due or overdue. Deliberately its own constant — neither existing list
// is this set (NO_PAYMENT_STATUSES has no 'paid' and includes 'draft';
// REMINDERS_HIDDEN_STATUSES adds 'cancelled') — and NOT derived from
// either by subtraction, so a status added to one of those later can't
// silently change what this line does. 'cancelled' is intentionally
// absent: it wasn't part of the request that added this, and whether a
// cancelled invoice's due date is still worth showing is an open product
// question (see DECISIONS.md, 21 September 2026).
export const DUE_DATE_HIDDEN_STATUSES = ['paid', 'refunded', 'bad_debt']

// Simplified further this round (InvoiceDetailPanel redesign — see
// DECISIONS.md): this now ONLY covers the 'created' case — "hasn't been
// sent through LanceraOS yet, so reminders/tracking are inert." The
// reminders-off case (previously handled here too) moved to its own
// dedicated banner-with-a-real-"Turn on reminders"-button component
// (InvoiceDetailPanel.jsx's RemindersOffBanner) per item 3's exactly-
// one-of-two-states rule — a plain text line can't host a real action
// button, and the new design needs one.
export function getSendBannerCopy(invoice) {
  if (invoice.status !== 'created') return null
  return "This invoice hasn't been sent through LanceraOS; reminders, view tracking, and payment tracking won't activate until you send it.";
}

// Header subtitle countdown (InvoiceDetailPanel redesign) — "X days
// remaining" while not yet due, "X days overdue" (via daysOverdueLabel,
// already used elsewhere) once real. Returns null when there's no due
// date at all (a still-blank draft). `overdue` lets the caller apply
// red/error styling without re-deriving it from days_overdue itself.
export function dueDateCountdown(invoice) {
  if (!invoice.due_date) return null
  if (invoice.days_overdue > 0) {
    return { text: daysOverdueLabel(invoice.days_overdue), overdue: true }
  }
  const due = new Date(`${invoice.due_date}T00:00:00`)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const diffDays = Math.round((due - today) / 86400000)
  if (diffDays <= 0) return { text: 'Due today', overdue: false }
  return { text: `${diffDays} day${diffDays !== 1 ? 's' : ''} remaining`, overdue: false }
}

// ── Timeline helpers ──────────────────────────────────────────────
// Pure, no-JSX — live here (not InvoiceDetailPanel.jsx) so they're
// directly unit-testable without rendering the whole panel; `timelineIcon`
// (lucide-react, returns JSX) stays inline in that component instead.
export function timelineDotColor(type) {
  return {
    payment: 'var(--status-green-text)', reminder: 'var(--status-amber-text)', view: 'var(--status-blue-text)',
    created: 'var(--text-tertiary)', finalised: 'var(--status-blue-text)', sent: 'var(--status-blue-text)',
    claim: 'var(--status-amber-text)', acknowledged: 'var(--status-green-text)',
    escalation: 'var(--status-red-text)', formal_notice: 'var(--status-red-text)',
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
  if (ev.type === 'claim') return `Payment claim ${ev.status} — ${formatMoney(ev.amount, ev.currency)}`
  if (ev.type === 'acknowledged') return 'Acknowledged by client'
  if (ev.type === 'escalation') return `Escalated${ev.dismissed ? ' (dismissed)' : ''} — final reminder sent with no payment`
  if (ev.type === 'formal_notice') return 'Formal Notice sent'
  return ev.type
}

export function computeTotals(form) {
  const subtotal = form.items.reduce((s, it) => s + (parseFloat(it.quantity) || 0) * (parseFloat(it.unit_price) || 0), 0)
  const tax = subtotal * (parseFloat(form.tax_rate) || 0) / 100
  const discount = parseFloat(form.discount_amount) || 0
  const total = Math.max(0, subtotal + tax - discount)
  return { subtotal, tax, discount, total }
}
