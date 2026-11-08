// src/pages/expensesHelpers.js
//
// Pure helpers for the Expenses page and its dialogs (Prompt 15) — no React, no network. The Expenses page is a
// deliberate mirror of the Payments page, so everything that is plain logic and already exists in paymentsHelpers.js
// (cents, formatting, errors, chart data, bar widths) is imported from there; only what is specific to money going OUT
// is written here: the twelve categories, the form rules, the list request and the copy.
//
// Money rule (STANDARDS.md): the API sends amounts as strings ("12.50"). All arithmetic on an amount is done in integer
// cents (toCents / centsToAmount), never with a float "<", "min", "+" or "-". Dates from the API are plain calendar
// strings ("2026-11-04") and are never run through `new Date()`.
import { PAGE_SIZE } from '@/components/Pagination'
import { formatMoney } from './invoiceHelpers'
import {
  NETWORK_MESSAGE, RATE_LIMIT_MESSAGE, PAYMENT_SORT_OPTIONS, bySourceBars, dateRangeProblem, errorMessage, formatExact, formatIsoDate,
  monthlyChartData, monthlyHasData, parseAmountInput, toCents,
} from './paymentsHelpers'
import { monthLong } from './dashboardHelpers'

export { dateRangeProblem, errorMessage, formatExact, monthlyChartData, monthlyHasData }

// apps/payments/constants.py EARLIEST_EXPENSE_DATE — the server refuses anything earlier.
export const EARLIEST_EXPENSE_DATE = '2010-01-01'
export const VENDOR_MAX = 200
export const DESCRIPTION_MAX = 300

// "Money out" series colour: the validated blue pair theme.css defines as --chart-series-invoiced, mirrored as plain hex
// because Recharts writes colours into SVG attributes (same reason as COLLECTED_BAR_COLORS). Spending is neither good nor
// bad news, so it is not the green "collected" colour and not a status colour (DESIGN.md, Expenses page).
export const SPENT_BAR_COLORS = { light: '#2a78d6', dark: '#3987e5' }

// ── Categories ────────────────────────────────────────────────────────────────────────────────────────────────────
// apps/payments/constants.py EXPENSE_CATEGORY_CHOICES, in the server's order and wording. A test compares this list with
// a fixture generated from the server's own list, so drift fails a test.
export const EXPENSE_CATEGORIES = [
  { value: 'software', label: 'Software and subscriptions' },
  { value: 'equipment', label: 'Equipment and hardware' },
  { value: 'internet', label: 'Internet and phone' },
  { value: 'utilities', label: 'Electricity and utilities' },
  { value: 'office', label: 'Office and co-working' },
  { value: 'fees', label: 'Platform and payment fees' },
  { value: 'marketing', label: 'Marketing and ads' },
  { value: 'education', label: 'Courses and learning' },
  { value: 'professional', label: 'Professional services and registrations' },
  { value: 'travel', label: 'Travel' },
  { value: 'contractors', label: 'Contractors and outsourcing' },
  { value: 'other', label: 'Other' },
]

// Like the server, an unknown value is shown as itself.
export function categoryLabel(value) {
  return EXPENSE_CATEGORIES.find((c) => c.value === value)?.label || value || '—'
}

// The twelve, plus the expense's own category when it is not among them, so editing never shows a blank select.
export function categoryChoices(ownCategory) {
  if (ownCategory && !EXPENSE_CATEGORIES.some((c) => c.value === ownCategory)) {
    return [...EXPENSE_CATEGORIES, { value: ownCategory, label: ownCategory }]
  }
  return EXPENSE_CATEGORIES
}

export const CATEGORY_FORM_OPTIONS = [{ value: '', label: 'Choose a category' }, ...EXPENSE_CATEGORIES]
export const CATEGORY_FILTER_OPTIONS = [{ value: '', label: 'All categories' }, ...EXPENSE_CATEGORIES]

export const FEES_CATEGORY = 'fees'

// ── Final copy (Section 5 of the brief, verbatim) ──────────────────────────────────────────────────────────────────
export const FEES_WARNING = 'Only add a fee here if you recorded the full amount your client paid as income. If you recorded the smaller amount that reached you after the fee, the fee is already out of your income, and adding it here would count it twice.'
export const CATEGORY_HINT = 'Income tax you pay is not a business cost, so it has no category here.'
export const DEDUCTIBLE_LABEL = 'Deductible business cost'
export const DEDUCTIBLE_HINT = 'Your own note for tax time. LanceraOS only adds these up; whether an expense can reduce your tax depends on your situation.'
export const FLASH = {
  added: 'Expense added.',
  updated: 'Expense updated.',
  deleted: 'Expense deleted.',
  duplicateRemoved: 'Removed the duplicate.',
  alreadyRemoved: 'That expense was already removed.',
}
export const NOT_SURE_SAVED = 'If you are not sure it was saved, check the list before adding it again.'

// ── Dates ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// A local copy: paymentsHelpers keeps its own private. A calendar date written YYYY-MM-DD that really exists.
function isRealIsoDate(text) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text || '')
  if (!match) return false
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  if (month < 1 || month > 12 || day < 1) return false
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return day <= days[month - 1]
}

function codePoints(text) {
  return [...String(text ?? '')].length
}

// ── The add / edit / copy form ─────────────────────────────────────────────────────────────────────────────────────
// Form shape: strings and one boolean. The category starts EMPTY on purpose (decision X4): a silent default would file
// most expenses under the wrong category.
export function emptyForm(profileCurrency, today) {
  return {
    amount: '', currency: profileCurrency || 'USD', expense_date: today, category: '', vendor: '', description: '', is_deductible: true,
  }
}

export function formFromExpense(expense) {
  return {
    amount: expense.amount, currency: expense.currency, expense_date: expense.expense_date, category: expense.category,
    vendor: expense.vendor || '', description: expense.description || '', is_deductible: Boolean(expense.is_deductible),
  }
}

// Duplicate (decision X8): everything copied, the date is today.
export function formFromCopy(expense, today) {
  return { ...formFromExpense(expense), expense_date: today }
}

// Returns only the keys that have a problem (an empty object means the form is valid).
export function validateExpenseForm(form, today) {
  const problems = {}
  const amount = parseAmountInput(form.amount)
  if (!amount.ok) problems.amount = amount.error
  if (!/^[A-Za-z]{3}$/.test(String(form.currency || '').trim())) problems.currency = 'Choose a currency.'

  const date = String(form.expense_date || '').trim()
  if (!date) problems.expense_date = 'Enter the date you spent it.'
  else if (!isRealIsoDate(date)) problems.expense_date = 'Enter a valid date.'
  else if (date > today) problems.expense_date = 'Expense date cannot be in the future.'
  else if (date < EARLIEST_EXPENSE_DATE) problems.expense_date = `Expense date cannot be before ${EARLIEST_EXPENSE_DATE}.`

  if (!EXPENSE_CATEGORIES.some((c) => c.value === form.category)) problems.category = 'Choose a category.'
  if (codePoints(form.vendor) > VENDOR_MAX) problems.vendor = `Keep this under ${VENDOR_MAX} characters.`
  if (codePoints(form.description) > DESCRIPTION_MAX) problems.description = `Keep this under ${DESCRIPTION_MAX} characters.`
  return problems
}

// Only what differs from the saved expense, in the shape the API takes. Amounts are compared in cents.
export function changedFields(form, expense) {
  const changes = {}
  if (toCents(form.amount) !== toCents(expense.amount)) changes.amount = parseAmountInput(form.amount).value ?? form.amount
  if (form.currency !== expense.currency) changes.currency = form.currency
  if (form.expense_date !== expense.expense_date) changes.expense_date = form.expense_date
  if (form.category !== expense.category) changes.category = form.category
  if (String(form.vendor ?? '').trim() !== (expense.vendor || '')) changes.vendor = String(form.vendor ?? '').trim()
  if (String(form.description ?? '').trim() !== (expense.description || '')) changes.description = String(form.description ?? '').trim()
  if (Boolean(form.is_deductible) !== Boolean(expense.is_deductible)) changes.is_deductible = Boolean(form.is_deductible)
  return changes
}

// The create body: all seven keys, trimmed, the amount normalised to two decimals.
export function createBody(form) {
  return {
    amount: parseAmountInput(form.amount).value ?? form.amount,
    currency: form.currency,
    expense_date: form.expense_date,
    category: form.category,
    vendor: String(form.vendor ?? '').trim(),
    description: String(form.description ?? '').trim(),
    is_deductible: Boolean(form.is_deductible),
  }
}

// ── The list request ──────────────────────────────────────────────────────────────────────────────────────────────
export const DEDUCTIBLE_FILTERS = [
  { value: '', label: 'All expenses' },
  { value: 'yes', label: 'Marked deductible' },
  { value: 'no', label: 'Not marked deductible' },
]

const DEDUCTIBLE_TO_PARAM = { yes: 'true', no: 'false' }

// The same four labels as the Payments sort.
export const EXPENSE_SORT_OPTIONS = PAYMENT_SORT_OPTIONS

export function buildListParams({
  page = 1, search = '', category = '', deductible = '', currency = '', start = '', end = '', sort = 'recent',
} = {}) {
  const params = { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE, sort: sort || 'recent' }
  const text = String(search || '').trim()
  if (text) params.search = text
  if (category) params.category = category
  if (DEDUCTIBLE_TO_PARAM[deductible]) params.deductible = DEDUCTIBLE_TO_PARAM[deductible]
  if (currency) params.currency = currency
  if (start) params.start = start
  if (end) params.end = end
  return params
}

export function hasActiveFilters({ search = '', category = '', deductible = '', currency = '', start = '', end = '' } = {}) {
  return Boolean(String(search).trim() || category || deductible || currency || start || end)
}

// ── Labels and notes ──────────────────────────────────────────────────────────────────────────────────────────────
export function expenseCountLabel(count) {
  return `${count} expense${count === 1 ? '' : 's'}`
}

// "USD 120 marked deductible" — the aggregate uses whole units like every other headline number.
export function deductibleLine(data, currency) {
  return `${formatMoney(data?.deductible_total ?? 0, currency)} marked deductible`
}

export function expenseRateNote(basis) {
  switch (basis) {
    case 'nearby':
      return 'Converted using an exchange rate from within a week of this date.'
    case 'estimated':
      return 'No exchange rate was saved near this date, so the closest one available is used. Converted totals that include this expense are approximate.'
    case 'none':
      return 'No exchange rate is available for this currency, so this expense is left out of converted totals.'
    default:
      return null
  }
}

export function expenseUnconvertedNote(count) {
  return `${count} expense${count !== 1 ? 's' : ''} excluded from these figures — no exchange rate was captured for ${count !== 1 ? 'them' : 'it'}.`
}

export function expenseEstimatedNote(count) {
  const subject = count === 1 ? '1 expense uses' : `${count} expenses use`
  return `${subject} an estimated exchange rate (the closest day available), so these totals are approximate.`
}

export function spendingSummary(monthly, currency) {
  const parts = (monthly || []).map((m) => `${monthLong(m.month)} ${formatMoney(m.total, currency)}`)
  return `Money spent per month over the last ${parts.length} months, in ${currency}: ${parts.join('; ')}.`
}

// The widths are the same arithmetic as the by-source card, under an honest name.
export const byCategoryBars = bySourceBars

export function duplicateSentence(expense) {
  return `You already have another expense of ${formatExact(expense.amount, expense.currency)} in the same category dated within 3 days of ${formatIsoDate(expense.expense_date)}. Is it the same purchase?`
}

export function copiedFromLine(expense) {
  const what = (expense.vendor || '').trim() || categoryLabel(expense.category)
  return `Copied from ${what} on ${formatIsoDate(expense.expense_date)}. Check the date and the amount.`
}

export function deleteSentence(expense) {
  const to = (expense.vendor || '').trim() ? ` to ${expense.vendor.trim()}` : ''
  return `This removes the expense of ${formatExact(expense.amount, expense.currency)} from ${formatIsoDate(expense.expense_date)}${to} from your records. It cannot be undone.`
}

export function rowActionsLabel(expense) {
  return `Actions for expense of ${formatExact(expense.amount, expense.currency)} from ${formatIsoDate(expense.expense_date)}`
}

export function openLabel(expense) {
  return `Open expense of ${formatExact(expense.amount, expense.currency)} from ${formatIsoDate(expense.expense_date)}`
}

// ── Errors ────────────────────────────────────────────────────────────────────────────────────────────────────────
const FORM_FIELDS = ['amount', 'currency', 'expense_date', 'category', 'vendor', 'description', 'is_deductible']
export const GONE_SENTENCE = 'This expense no longer exists.'

// DRF's {field: [message]} onto the form's fields; a 404 means the expense is gone; a generic {error} (or anything else)
// goes onto `general`. A 429's body is generic, so the STATUS is checked before any `error` text.
export function expenseFieldErrors(error, fallback = 'Something went wrong. Please try again.') {
  const response = error?.response
  if (!response) return { general: NETWORK_MESSAGE }
  if (response.status === 429) return { general: RATE_LIMIT_MESSAGE }
  if (response.status === 404) return { general: GONE_SENTENCE }
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

export function isGone(error) {
  return error?.response?.status === 404
}
