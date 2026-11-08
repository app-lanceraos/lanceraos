// src/pages/paymentsHelpers.js
//
// Pure helpers for the Payments page, its dialogs and the invoice popup's "use a payment I already recorded" choice —
// no React, no network. Everything that decides what a number, label, request or message looks like lives here so a
// test can pin it down without rendering.
//
// Money rule (STANDARDS.md): the API sends amounts as strings ("500.00"). A ledger row shows its exact cents and ALL
// arithmetic on amounts is done in integer cents (toCents / centsToAmount), never with a float "<", "min" or "-".
// Dates from the API are plain calendar strings ("2026-11-04") and are never run through `new Date()`.
import { PAGE_SIZE } from '@/components/Pagination'
import { paymentNote, deltaView, monthShort, monthLong, formatIsoDate } from './dashboardHelpers'
import { CURRENCY_OPTIONS, PAYMENT_SOURCE_OPTIONS, formatMoney } from './invoiceHelpers'

export { paymentNote, deltaView, formatIsoDate }

// apps/payments/constants.py EARLIEST_PAYMENT_DATE — the server refuses anything earlier.
export const EARLIEST_PAYMENT_DATE = '2010-01-01'
export const NOTES_MAX = 300
export const COUNTERPARTY_MAX = 200

// ── Cents ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// An exact decimal string ("0.30", "1000000.10") is parsed digit by digit, so "0.30" is 30 and never 29. A string with
// more than two decimals is rounded half up on the third (the API never sends one). A JS number is rounded to the
// nearest cent. Anything that is not a number is NaN, so a bug is visible instead of silently showing 0.
export function toCents(value) {
  if (value === null || value === undefined || value === '') return 0
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value * 100) : Number.NaN
  const match = /^(-?)(\d*)(?:\.(\d*))?$/.exec(String(value).trim())
  if (!match || (match[2] === '' && (match[3] === undefined || match[3] === ''))) return Number.NaN
  const whole = Number(match[2] || '0')
  const fraction = (match[3] || '').padEnd(3, '0')
  let cents = whole * 100 + Number(fraction.slice(0, 2))
  if (Number(fraction[2]) >= 5) cents += 1
  return match[1] === '-' ? -cents : cents
}

export function centsToAmount(cents) {
  const negative = cents < 0
  const abs = Math.abs(Math.round(cents))
  const whole = Math.trunc(abs / 100)
  const rest = String(abs % 100).padStart(2, '0')
  return `${negative ? '-' : ''}${whole}.${rest}`
}

// "USD 1,234.50" — a ledger row always shows its cents. Aggregates use formatMoney (whole units) instead.
export function formatExact(amount, currency) {
  const cents = toCents(amount)
  const negative = cents < 0
  const abs = Math.abs(cents)
  const whole = Math.trunc(abs / 100).toLocaleString('en')
  const rest = String(abs % 100).padStart(2, '0')
  return `${currency} ${negative ? '-' : ''}${whole}.${rest}`
}

// What the person types in an amount box. Strictly digits with at most two decimals, above zero: "1e3", ".5", "-5",
// "10.999" and words are all refused. `value` is the normalised two-decimal string, `cents` its integer form.
export function parseAmountInput(raw) {
  const text = String(raw ?? '').trim()
  if (text === '') return { ok: false, error: 'Enter an amount.' }
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(text)) {
    return { ok: false, error: 'Enter an amount like 250 or 250.50 (at most 2 decimal places).' }
  }
  const cents = toCents(text)
  if (cents <= 0) return { ok: false, error: 'Amount must be greater than zero.' }
  return { ok: true, value: centsToAmount(cents), cents }
}

// ── Dates ─────────────────────────────────────────────────────────────────────────────────────────────────────────
function isRealIsoDate(text) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text || '')
  if (!match) return false
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  if (month < 1 || month > 12 || day < 1) return false
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return day <= days[month - 1]
}

export function dateRangeProblem(start, end) {
  if (start && end && start > end) return 'The "From" date is after the "To" date.'
  return null
}

// ── The add / edit form ───────────────────────────────────────────────────────────────────────────────────────────
function codePoints(text) {
  return [...String(text ?? '')].length
}

// Returns only the keys that have a problem (an empty object means the form is valid).
export function validatePaymentForm(form, today) {
  const problems = {}
  const amount = parseAmountInput(form.amount)
  if (!amount.ok) problems.amount = amount.error
  if (!/^[A-Za-z]{3}$/.test(String(form.currency || '').trim())) problems.currency = 'Choose a currency.'

  const date = String(form.payment_date || '').trim()
  if (!date) problems.payment_date = 'Enter the date you were paid.'
  else if (!isRealIsoDate(date)) problems.payment_date = 'Enter a valid date.'
  else if (date > today) problems.payment_date = 'Payment date cannot be in the future.'
  else if (date < EARLIEST_PAYMENT_DATE) problems.payment_date = `Payment date cannot be before ${EARLIEST_PAYMENT_DATE}.`

  if (!PAYMENT_SOURCE_OPTIONS.some((option) => option.value === form.source)) problems.source = 'Choose a source.'
  if (codePoints(form.counterparty) > COUNTERPARTY_MAX) problems.counterparty = `Keep this under ${COUNTERPARTY_MAX} characters.`
  if (codePoints(form.notes) > NOTES_MAX) problems.notes = `Keep notes under ${NOTES_MAX} characters.`
  return problems
}

// ── The list request ──────────────────────────────────────────────────────────────────────────────────────────────
export const LINK_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'unlinked', label: 'Not linked' },
  { key: 'partial', label: 'Partly linked' },
  { key: 'linked', label: 'Linked' },
]

const LINK_TO_MATCH = { unlinked: 'unmatched', partial: 'partial', linked: 'matched' }

export const PAYMENT_SORT_OPTIONS = [
  { value: 'recent', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'amount_high', label: 'Largest first (by USD value)' },
  { value: 'amount_low', label: 'Smallest first (by USD value)' },
]

export function buildListParams({ page = 1, search = '', link = 'all', source = '', currency = '', start = '', end = '', sort = 'recent' } = {}) {
  const params = { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE, sort: sort || 'recent' }
  const text = String(search || '').trim()
  if (text) params.search = text
  if (LINK_TO_MATCH[link]) params.match = LINK_TO_MATCH[link]
  if (source) params.source = source
  if (currency) params.currency = currency
  if (start) params.start = start
  if (end) params.end = end
  return params
}

export function hasActiveFilters({ search = '', link = 'all', source = '', currency = '', start = '', end = '' } = {}) {
  return Boolean(String(search).trim() || (link && link !== 'all') || source || currency || start || end)
}

// ── Labels ────────────────────────────────────────────────────────────────────────────────────────────────────────
export const LINK_LABELS = { unlinked: 'Not linked', partial: 'Partly linked', linked: 'Linked' }
export const LINK_BADGE_KEY = { unlinked: 'gray', partial: 'amber', linked: 'green' }

const ORIGIN_LABELS = { manual: 'Added by you', invoice: 'From an invoice', import: 'Imported' }
const ORIGIN_PHRASES = { manual: 'added by you', invoice: 'recorded on an invoice', import: 'imported' }

export function originLabel(origin) {
  return ORIGIN_LABELS[origin] || 'Other'
}

export function originPhrase(origin) {
  return ORIGIN_PHRASES[origin] || 'recorded elsewhere'
}

export function sourceLabel(source) {
  return PAYMENT_SOURCE_OPTIONS.find((option) => option.value === source)?.label || source || '—'
}

export function paymentCountLabel(count) {
  return `${count} payment${count === 1 ? '' : 's'}`
}

// ── Link state and the rules that follow from it ──────────────────────────────────────────────────────────────────
export function linkStatus(payment) {
  const allocated = toCents(payment.allocated_amount)
  if (!(allocated > 0)) return 'unlinked'
  return allocated >= toCents(payment.amount) ? 'linked' : 'partial'
}

export function isLocked(payment) {
  return toCents(payment.allocated_amount) > 0
}

export function remainingCents(payment) {
  return toCents(payment.remaining_amount)
}

export const LOCKED_SENTENCE = 'This payment is linked to an invoice, so its amount, currency, date and source cannot change. Unlink it from its invoice first. You can still edit who it came from and the notes.'

// null when the payment may be deleted, otherwise the sentence to show where the Delete button would be.
export function deleteBlockReason(payment) {
  if (payment.origin === 'invoice') return 'This payment was recorded on an invoice. To remove it, use Undo payment on that invoice.'
  if (isLocked(payment)) return 'Unlink it from its invoice first.'
  return null
}

export function canUnlink(payment) {
  return payment.origin !== 'invoice'
}

export function canLink(payment) {
  return remainingCents(payment) > 0
}

export function progressLine(payment) {
  return `${formatExact(payment.allocated_amount, payment.currency)} of ${formatExact(payment.amount, payment.currency)} linked`
}

// ── Exchange-rate notes ───────────────────────────────────────────────────────────────────────────────────────────
export function rateNote(basis) {
  switch (basis) {
    case 'nearby':
      return 'Converted using an exchange rate from within a week of this date.'
    case 'estimated':
      return 'No exchange rate was saved near this date, so the closest one available is used. Converted totals that include this payment are approximate.'
    case 'none':
      return 'No exchange rate is available for this currency, so this payment is left out of converted totals.'
    default:
      return null
  }
}

export function estimatedNote(count) {
  const subject = count === 1 ? '1 payment uses' : `${count} payments use`
  return `${subject} an estimated exchange rate (the closest day available), so these totals are approximate.`
}

// ── Linking ───────────────────────────────────────────────────────────────────────────────────────────────────────
// The smaller of "what is left of the payment" and "what the invoice still owes", compared in cents.
export function defaultLinkAmount(remaining, outstanding) {
  const left = toCents(remaining)
  const owed = toCents(outstanding)
  return centsToAmount(left < owed ? left : owed)
}

export function isExactMatch(candidate, remaining) {
  return toCents(candidate.outstanding_amount) === toCents(remaining)
}

// The amount typed in either link dialog: a valid amount, no more than is left of the payment, no more than the
// invoice still owes (all in cents).
export function validateLinkAmount(raw, remaining, outstanding, currency) {
  const parsed = parseAmountInput(raw)
  if (!parsed.ok) return parsed
  if (parsed.cents > toCents(remaining)) {
    return { ok: false, error: `Amount cannot be more than what is left of this payment (${formatExact(remaining, currency)}).` }
  }
  if (parsed.cents > toCents(outstanding)) {
    return { ok: false, error: `Amount cannot be more than the invoice still owes (${formatExact(outstanding, currency)}).` }
  }
  return parsed
}

// The invoice popup (F9): payments that could pay THIS invoice — same currency, something left, dated on or after the
// invoice's issue date (the server refuses earlier ones). Exact-balance first, then newest.
export function eligibleForInvoice(payments, invoice) {
  const seen = new Set()
  return (payments || []).filter((payment) => {
    if (seen.has(payment.id)) return false
    seen.add(payment.id)
    if (payment.currency !== invoice.currency) return false
    if (!(remainingCents(payment) > 0)) return false
    if (invoice.issue_date && payment.payment_date < invoice.issue_date) return false
    return true
  })
}

// What is left of the payment equals what the invoice still owes.
export function isExactForInvoice(payment, invoice) {
  return remainingCents(payment) === toCents(invoice.outstanding_amount)
}

export function rankForInvoice(payments, invoice) {
  return eligibleForInvoice(payments, invoice).sort((a, b) => {
    const exactA = isExactForInvoice(a, invoice)
    const exactB = isExactForInvoice(b, invoice)
    if (exactA !== exactB) return exactA ? -1 : 1
    if (a.payment_date !== b.payment_date) return a.payment_date < b.payment_date ? 1 : -1
    return String(b.created_at || '').localeCompare(String(a.created_at || ''))
  })
}

// ── Currency lists ────────────────────────────────────────────────────────────────────────────────────────────────
const PREFERRED_CURRENCIES = ['USD', 'PKR', 'EUR', 'GBP', 'AED', 'CAD', 'AUD', 'SAR']

// Unique codes: USD always, the person's preferred ones first (only those present), then the rest A to Z. When editing,
// the payment's own currency is always offered, even if the rate list no longer has it.
export function currencyChoices(rateKeys, ownCurrency) {
  const present = new Set(['USD'])
  for (const key of rateKeys || []) {
    const code = String(key || '').trim().toUpperCase()
    if (/^[A-Z]{3}$/.test(code)) present.add(code)
  }
  if (ownCurrency) present.add(String(ownCurrency).toUpperCase())
  const preferred = PREFERRED_CURRENCIES.filter((code) => present.has(code))
  const rest = [...present].filter((code) => !PREFERRED_CURRENCIES.includes(code)).sort()
  return [...preferred, ...rest]
}

export const FALLBACK_CURRENCY_CODES = CURRENCY_OPTIONS.map((option) => option.value)
export const CURRENCY_FALLBACK_HINT = "Couldn't load the full currency list; showing the common ones."

// ── Summary: chart and by-source ──────────────────────────────────────────────────────────────────────────────────
export function monthlyChartData(monthly) {
  return (monthly || []).map((m) => ({ key: m.month, label: monthShort(m.month), full: monthLong(m.month), value: Number(m.total) }))
}

export function monthlyHasData(monthly) {
  return (monthly || []).some((m) => toCents(m.total) > 0)
}

export function monthlySummary(monthly, currency) {
  const parts = (monthly || []).map((m) => `${monthLong(m.month)} ${formatMoney(m.total, currency)}`)
  return `Money received per month over the last ${parts.length} months, in ${currency}: ${parts.join('; ')}.`
}

// Share of the largest row, in whole percent. The numbers carry the meaning; the bar is only a quick comparison.
export function bySourceBars(rows) {
  const list = rows || []
  const largest = list.reduce((max, row) => (toCents(row.total) > max ? toCents(row.total) : max), 0)
  return list.map((row) => {
    const cents = toCents(row.total)
    const width = largest > 0 && cents > 0 ? Math.max(2, Math.round((cents * 100) / largest)) : 0
    return { ...row, widthPct: width }
  })
}

// ── Errors ────────────────────────────────────────────────────────────────────────────────────────────────────────
export const RATE_LIMIT_MESSAGE = 'You have made a lot of changes in a short time. Please wait a little and try again.'
export const NETWORK_MESSAGE = 'Could not reach LanceraOS. Check your connection and try again.'

export function errorMessage(error, fallback) {
  const response = error?.response
  if (!response) return NETWORK_MESSAGE
  if (response.status === 429) return RATE_LIMIT_MESSAGE
  const body = response.data
  if (body && typeof body === 'object' && typeof body.error === 'string' && body.error) return body.error
  return fallback
}

const FORM_FIELDS = ['amount', 'currency', 'payment_date', 'source', 'counterparty', 'notes']

// DRF's {field: [message]} onto the form's fields; a generic {error} (or anything else) onto `general`, never a field.
export function fieldErrors(error, fallback = 'Something went wrong. Please try again.') {
  const response = error?.response
  if (!response || response.status === 429) return { general: errorMessage(error, fallback) }
  const body = response.data
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { general: fallback }
  const result = {}
  for (const [key, value] of Object.entries(body)) {
    const text = Array.isArray(value) ? value.find((item) => typeof item === 'string') : (typeof value === 'string' ? value : null)
    if (!text) continue
    if (FORM_FIELDS.includes(key)) result[key] = text
    else if (!result.general) result.general = text
  }
  if (Object.keys(result).length === 0) result.general = fallback
  return result
}

// ── The duplicate step ────────────────────────────────────────────────────────────────────────────────────────────
export function duplicateSentence(payment) {
  return `You already have another payment of ${formatExact(payment.amount, payment.currency)} dated within 3 days of ${formatIsoDate(payment.payment_date)}. Is it the same money?`
}

export function createdOn(payment) {
  return formatIsoDate(payment.created_at)
}
