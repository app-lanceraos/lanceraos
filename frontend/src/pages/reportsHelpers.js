// src/pages/reportsHelpers.js
//
// Pure helpers for the two report pages (Prompt 17): /pnl (Profit and Loss) and /income-certificate (Income Statement).
// No React, no network, no `new Date()` — the only clock is todayInPlatformTimezone(), passed in by the caller.
//
// Money rule (STANDARDS.md): the page NEVER adds, converts or rounds an amount. The server rounds each converted row once
// and sums rounded rows, so the months add up to the total and the page agrees with the PDF to the paisa. Here an amount
// is only ever turned into text (formatExact / plainAmount) or its SIGN is tested, in integer cents.
// Dates are plain calendar strings ("2026-11-09"): month and day arithmetic is done on integer parts.
import { formatIsoDate, monthLong, monthShort } from './dashboardHelpers'
import { NETWORK_MESSAGE, errorMessage, formatExact, toCents } from './paymentsHelpers'

export { formatExact }

// apps/payments/constants.py EARLIEST_PAYMENT_DATE and report.MAX_RANGE_MONTHS — the server refuses anything outside them.
export const EARLIEST_REPORT_DATE = '2010-01-01'
export const MAX_REPORT_MONTHS = 60

// ── Calendar arithmetic on integer parts ───────────────────────────────────────────────────────────────────────────
function pad(n) {
  return String(n).padStart(2, '0')
}

function iso(year, month, day) {
  return `${year}-${pad(month)}-${pad(day)}`
}

function isLeap(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

function daysInMonth(year, month) {
  return [31, isLeap(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
}

function parts(text) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text || '')
  return match ? { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) } : null
}

function isRealIsoDate(text) {
  const p = parts(text)
  return Boolean(p && p.month >= 1 && p.month <= 12 && p.day >= 1 && p.day <= daysInMonth(p.year, p.month))
}

// The first day of the month `back` months before the month of `today` (0 = this month).
function monthStartBack(today, back) {
  const p = parts(today)
  const index = p.year * 12 + (p.month - 1) - back
  return iso(Math.floor(index / 12), (index % 12) + 1, 1)
}

function lastDayOfMonthBack(today, back) {
  const p = parts(today)
  const index = p.year * 12 + (p.month - 1) - back
  const year = Math.floor(index / 12)
  const month = (index % 12) + 1
  return iso(year, month, daysInMonth(year, month))
}

// Calendar months touched by [start, end], both ends counted ("2026-01-31" to "2026-02-01" is 2).
export function monthsSpanned(start, end) {
  const a = parts(start)
  const b = parts(end)
  if (!a || !b) return 0
  return (b.year - a.year) * 12 + (b.month - a.month) + 1
}

// ── Periods ───────────────────────────────────────────────────────────────────────────────────────────────────────
export const TAX_YEAR_NOTE = "Pakistan's tax year runs from 1 July to 30 June and is named for the year it ends in."

// The tax year (July to June) is named for the year it ends in. Used ONLY to label and bound a period: no tax is calculated.
function currentTaxYear(today) {
  const p = parts(today)
  return p.month >= 7 ? p.year + 1 : p.year
}

export const PRESET_KEYS = ['this_month', 'last_month', 'last_3_months', 'last_6_months', 'last_12_months', 'this_year', 'last_year', 'tax_year', 'last_tax_year', 'custom']
export const TAX_YEAR_PRESETS = ['tax_year', 'last_tax_year']

export function presetOptions(today) {
  const taxYear = currentTaxYear(today)
  return [
    { value: 'this_month', label: 'This month' },
    { value: 'last_month', label: 'Last month' },
    { value: 'last_3_months', label: 'Last 3 months' },
    { value: 'last_6_months', label: 'Last 6 months' },
    { value: 'last_12_months', label: 'Last 12 months' },
    { value: 'this_year', label: 'This year' },
    { value: 'last_year', label: 'Last year' },
    { value: 'tax_year', label: `Tax year ${taxYear}, so far` },
    { value: 'last_tax_year', label: `Tax year ${taxYear - 1}` },
    { value: 'custom', label: 'Custom dates' },
  ]
}

// {start, end} for a preset, resolved against `today`; never after `today`. `custom` has no dates of its own (null).
export function resolvePreset(key, today) {
  const p = parts(today)
  switch (key) {
    case 'this_month': return { start: monthStartBack(today, 0), end: today }
    case 'last_month': return { start: monthStartBack(today, 1), end: lastDayOfMonthBack(today, 1) }
    case 'last_3_months': return { start: monthStartBack(today, 2), end: today }
    case 'last_6_months': return { start: monthStartBack(today, 5), end: today }
    case 'last_12_months': return { start: monthStartBack(today, 11), end: today }
    case 'this_year': return { start: iso(p.year, 1, 1), end: today }
    case 'last_year': return { start: iso(p.year - 1, 1, 1), end: iso(p.year - 1, 12, 31) }
    case 'tax_year': {
      const year = currentTaxYear(today)
      const yearEnd = iso(year, 6, 30)
      return { start: iso(year - 1, 7, 1), end: today < yearEnd ? today : yearEnd }
    }
    case 'last_tax_year': {
      const year = currentTaxYear(today) - 1
      return { start: iso(year - 1, 7, 1), end: iso(year, 6, 30) }
    }
    default: return null
  }
}

// The first problem with a period as a sentence, or null. The four server sentences are checked in the server's own order
// (report.validate_range) and use its exact words; a drift test compares them with the server's real answers.
export function periodProblem(start, end, today) {
  if (!start || !end) return 'Choose a start date and an end date.'
  if (!isRealIsoDate(start) || !isRealIsoDate(end)) return 'Enter a valid date.'
  if (start > end) return 'The start date must be on or before the end date.'
  if (end > today) return 'The end date cannot be in the future.'
  if (start < EARLIEST_REPORT_DATE) return `The start date cannot be before ${EARLIEST_REPORT_DATE}.`
  if (monthsSpanned(start, end) > MAX_REPORT_MONTHS) return `Choose a period of ${MAX_REPORT_MONTHS} months or less.`
  return null
}

// "1 Jan 2026 to 9 Nov 2026, 11 months"
export function describePeriod(start, end) {
  const months = monthsSpanned(start, end)
  return `${formatIsoDate(start)} to ${formatIsoDate(end)}, ${months} month${months === 1 ? '' : 's'}`
}

export function initialPeriod(presetKey, today) {
  const range = resolvePreset(presetKey, today)
  return { preset: presetKey, start: range.start, end: range.end }
}

// ── Requests ──────────────────────────────────────────────────────────────────────────────────────────────────────
export function pnlParams({ start, end, currency }) {
  const params = { start, end }
  if (currency) params.currency = currency
  return params
}

export function statementParams({ start, end }) {
  return { start, end }
}

export function statementPdfParams({ start, end, purpose, addressedTo, includeCnic, includeNtn }) {
  const params = { start, end, purpose }
  const text = String(addressedTo ?? '').trim()
  if (text) params.addressed_to = text
  if (includeCnic) params.include_cnic = 'true'
  if (includeNtn) params.include_ntn = 'true'
  return params
}

const PDF_PATHS = { pnl: '/payments/pnl/pdf/', statement: '/payments/income-certificate/pdf/' }
const PREVIEW_PATHS = { pnl: '/payments/pnl/', statement: '/payments/income-certificate/' }

export function pdfPath(kind) {
  return PDF_PATHS[kind]
}

export function previewPath(kind) {
  return PREVIEW_PATHS[kind]
}

// ── Statement options and identity ────────────────────────────────────────────────────────────────────────────────
// apps/invoices/report_pdf.py PURPOSE_LINES, in the order the page offers them. A drift test reads a fixture generated
// from the server's own table.
export const PURPOSE_OPTIONS = [
  { value: 'other', label: 'General reference' },
  { value: 'bank', label: 'Bank account or loan application' },
  { value: 'visa', label: 'Visa application' },
  { value: 'pseb', label: 'PSEB registration' },
]
export const DEFAULT_PURPOSE = 'other'

export const ADDRESSED_TO_MAX = 100
export const ADDRESSED_TO_TOO_LONG = 'Keep this under 100 characters.'
export const ADDRESSED_TO_NOT_PLAIN = 'Use plain text on one line.'

// Counted in code points after trimming (an emoji is 1), exactly as the server counts characters; a control character
// (a newline, a tab) is refused.
export function addressedToProblem(text) {
  const value = String(text ?? '').trim()
  if (value.length > 0 && [...value].some((ch) => ch.codePointAt(0) < 32 || ch.codePointAt(0) === 127)) return ADDRESSED_TO_NOT_PLAIN
  if ([...value].length > ADDRESSED_TO_MAX) return ADDRESSED_TO_TOO_LONG
  return null
}

export function addressedToCount(text) {
  return [...String(text ?? '').trim()].length
}

function clean(value) {
  return String(value ?? '').trim()
}

// Keeps ONLY what the statement prints plus two booleans. The CNIC and NTN digits the profile endpoint returns are
// read for the booleans and dropped here: they never reach state, props or a log.
export function reduceProfile(json) {
  const profile = json || {}
  const name = `${clean(profile.first_name)} ${clean(profile.last_name)}`.trim() || clean(profile.display_name)
  const place = [clean(profile.city), clean(profile.country)].filter(Boolean).join(', ')
  const addressLines = [clean(profile.address_line1), clean(profile.address_line2), place].filter(Boolean)
  return {
    name,
    businessName: clean(profile.business_name),
    addressLines,
    email: clean(profile.email),
    phone: clean(profile.phone),
    hasCnic: Boolean(clean(profile.cnic)),
    hasNtn: Boolean(clean(profile.ntn)),
  }
}

export const PRINTED_FROM_SAVED = 'Printed from your saved details'

// [{label, lines}] in the server's order and wording (report_pdf.build_income_statement_context). The CNIC and NTN rows
// appear only when ticked AND saved, and never show the digits.
export function statementIdentity(reduced, { includeCnic = false, includeNtn = false } = {}) {
  const rows = [{ label: 'Full name', lines: [reduced.name] }]
  if (reduced.businessName) rows.push({ label: 'Business name', lines: [reduced.businessName] })
  if (reduced.addressLines.length > 0) rows.push({ label: 'Address', lines: reduced.addressLines })
  rows.push({ label: 'Email', lines: [reduced.email] })
  if (reduced.phone) rows.push({ label: 'Phone', lines: [reduced.phone] })
  if (includeCnic && reduced.hasCnic) rows.push({ label: 'CNIC', lines: [PRINTED_FROM_SAVED] })
  if (includeNtn && reduced.hasNtn) rows.push({ label: 'NTN', lines: [PRINTED_FROM_SAVED] })
  return rows
}

// 'empty' (no payment at all), 'unconvertible' (payments, but none could be converted), otherwise 'ready'.
export function statementState(data) {
  if (!data || !Array.isArray(data.by_currency) || data.by_currency.length === 0) return 'empty'
  if (data.count === 0 && data.unconverted_count > 0) return 'unconvertible'
  return 'ready'
}

// ── Block reasons (the Download button is never silently disabled) ─────────────────────────────────────────────────
export const BLOCK = {
  loading: 'Loading the figures…',
  loadFailed: 'The figures could not be loaded, so there is nothing to download yet.',
  pnlEmpty: 'There is nothing to put in the report: no payments and no expenses in this period.',
  statementEmpty: 'You have no payments in this period, so there is nothing to put in the statement.',
  statementUnconvertible: 'None of your payments in this period could be converted, because no exchange rate is available for their currency, so the statement cannot show USD and PKR totals.',
  busy: 'Preparing the PDF…',
}

export function pnlIsEmpty(data) {
  return Boolean(data) && data.income.count + data.expenses.count === 0
}

export function pnlBlockReason({ problem, loading, loadFailed, data, busy }) {
  if (problem) return problem
  if (loading) return BLOCK.loading
  if (loadFailed || !data) return BLOCK.loadFailed
  if (pnlIsEmpty(data)) return BLOCK.pnlEmpty
  if (busy) return BLOCK.busy
  return null
}

export function statementBlockReason({ problem, loading, loadFailed, state, addressedProblem, busy }) {
  if (problem) return problem
  if (loading) return BLOCK.loading
  if (loadFailed) return BLOCK.loadFailed
  if (state === 'empty') return BLOCK.statementEmpty
  if (state === 'unconvertible') return BLOCK.statementUnconvertible
  if (addressedProblem) return addressedProblem
  if (busy) return BLOCK.busy
  return null
}

// ── P&L view helpers ──────────────────────────────────────────────────────────────────────────────────────────────
// Zero is "Net profit". Only the SIGN is tested, in integer cents.
export function netView(net) {
  const negative = toCents(net?.total) < 0
  return { label: negative ? 'Net loss' : 'Net profit', negative }
}

// The PDF's wording: "Net margin 41.7% of income". A negative margin prints with a minus sign.
export function marginLine(net) {
  const margin = net?.margin_pct
  if (margin === null || margin === undefined) return 'No income in this period.'
  const text = Object.is(margin, -0) ? '-0.0' : Number(margin).toFixed(1)
  return `Net margin ${text}% of income`
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`
}

// The first of the P&L PDF's notes. The page shows it once, under the controls (the rest go at the bottom).
export const PNL_STANDING_NOTE = 'This report counts money you recorded as received and money you recorded as spent, on the date of each. '
  + 'Invoices that have not been paid are not income. Amounts in other currencies are converted at the '
  + 'exchange rate saved for the date of each payment or expense.'

// Reproduces apps/invoices/report_pdf.build_pnl_context()['notes'] sentence for sentence. The fixtures are the oracle.
export function pnlNotes(data) {
  const unconverted = data.unconverted_count
  const estimated = data.estimated_count
  const unconvertedTotal = unconverted.income + unconverted.expenses
  const estimatedTotal = estimated.income + estimated.expenses
  const fees = (data.expenses.by_category || []).find((row) => row.category === 'fees')
  const notes = [PNL_STANDING_NOTE]
  if (unconvertedTotal) {
    notes.push(
      `${plural(unconverted.income, 'payment', 'payments')} and ${plural(unconverted.expenses, 'expense', 'expenses')} `
      + `could not be converted because no exchange rate was saved for ${unconvertedTotal === 1 ? 'it' : 'them'}. `
      + `${unconvertedTotal === 1 ? 'It is' : 'They are'} left out of every figure in this report, so the net result is incomplete.`,
    )
  }
  if (estimatedTotal) {
    notes.push(
      `${plural(estimatedTotal, 'item uses', 'items use')} an estimated exchange rate (the closest day available), `
      + 'so the converted figures are approximate.',
    )
  }
  if (fees && toCents(fees.total) > 0) {
    notes.push(
      'Platform and payment fees are counted as expenses here. If the income you recorded was already reduced '
      + 'by those fees, they are counted twice and your net profit is understated.',
    )
  }
  notes.push("'Marked deductible' is your own note. LanceraOS adds these up but does not calculate tax.")
  return notes
}

// Page only (not on the PDF): shown when there is income but no expense recorded.
export const INCOME_ONLY_NOTE = 'You have not recorded any expenses in this period, so net profit equals income. Add your business costs on the Expenses page to see what you actually kept.'

export function showIncomeOnlyNote(data) {
  return Boolean(data) && data.income.count > 0 && data.expenses.count === 0
}

function isMonthEdge(start, end) {
  const a = parts(start)
  const b = parts(end)
  return a.day !== 1 || b.day !== daysInMonth(b.year, b.month)
}

// Reproduces apps/invoices/report_pdf.build_income_statement_context()['notes']. `start` and `end` are the response's own.
export function statementNotes(data, start, end) {
  const unconverted = data.unconverted_count
  const estimated = data.estimated_count
  const notes = [
    'PKR amounts are an indicative equivalent. Each payment is converted at the daily reference exchange rate '
    + 'saved by LanceraOS for the date of that payment. They may differ from the amounts actually credited to a bank account.',
  ]
  if (unconverted) {
    notes.push(
      `${plural(unconverted, 'payment', 'payments')} could not be converted because no exchange rate was saved for `
      + `${unconverted === 1 ? 'it' : 'them'}. ${unconverted === 1 ? 'It is' : 'They are'} shown under `
      + "'Received in these currencies' but "
      + `${unconverted === 1 ? 'is' : 'are'} not included in the totals above.`,
    )
  }
  if (estimated) {
    notes.push(
      `${plural(estimated, 'payment uses', 'payments use')} an estimated exchange rate (the closest day available), `
      + 'so the converted figures are approximate.',
    )
  }
  if (isMonthEdge(start, end)) {
    notes.push('A month at the start or end of the period may be partial if the period does not begin or end on a month boundary.')
  }
  notes.push(
    'These figures come from records entered or imported by the account holder. LanceraOS has not checked them '
    + 'against any bank, platform or tax record. This is not a certificate, audit or attestation issued by LanceraOS, '
    + 'a bank, the FBR, PSEB or any other authority.',
  )
  return notes
}

// ── Chart data ────────────────────────────────────────────────────────────────────────────────────────────────────
export function spansYears(monthly) {
  const list = monthly || []
  if (list.length < 2) return false
  return list[0].month.slice(0, 4) !== list[list.length - 1].month.slice(0, 4)
}

// "Nov", or "Nov 26" when the period touches more than one calendar year.
export function monthLabel(key, multiYear) {
  const short = monthShort(key)
  return multiYear && /^\d{4}-\d{2}$/.test(key || '') ? `${short} ${key.slice(2, 4)}` : short
}

// The chart is the one place a number is derived from a string (Recharts needs numbers), as monthlyChartData already does.
export function pnlChartData(monthly, multiYear) {
  return (monthly || []).map((m) => ({
    key: m.month, label: monthLabel(m.month, multiYear), full: monthLong(m.month),
    income: Number(m.income), expenses: Number(m.expenses),
  }))
}

export function pnlHasData(monthly) {
  return (monthly || []).some((m) => toCents(m.income) !== 0 || toCents(m.expenses) !== 0)
}

export function pnlChartLabel(start, end, currency) {
  return `Bar chart of income and expenses for each month from ${formatIsoDate(start)} to ${formatIsoDate(end)}, in ${currency}. The same figures are in the table below.`
}

// "1,234.56" / "-1,234.56": the amount without its currency (the column header names it).
export function plainAmount(amount) {
  const cents = toCents(amount)
  if (!Number.isFinite(cents)) return '—'
  return formatExact(amount, '').trim()
}

// ── Statement preview copy ────────────────────────────────────────────────────────────────────────────────────────
export function statementSummaryLine(data) {
  return `${formatExact(data.total.usd, 'USD')} · ${formatExact(data.total.pkr, 'PKR')} · ${plural(data.count, 'payment', 'payments')}`
}

export function unconvertibleHeading(unconvertedCount) {
  return `None of the ${plural(unconvertedCount, 'payment', 'payments')} in this period could be converted`
}

export const UNCONVERTIBLE_BODY = 'No exchange rate is available for their currency, so USD and PKR totals cannot be shown. They are listed below under Received in these currencies.'

// ── Downloads and errors ──────────────────────────────────────────────────────────────────────────────────────────
export function fallbackFilename(kind, start, end) {
  return `${kind === 'pnl' ? 'profit_and_loss' : 'income_statement'}_${start}_${end}.pdf`
}

// The saved name comes from Content-Disposition only when it is a safe name; otherwise the fallback.
export function filenameFromDisposition(header, fallback) {
  const match = /filename="([^"]*)"/i.exec(header || '') || /filename=([^;\s]+)/i.exec(header || '')
  const name = match ? match[1] : ''
  return /^[A-Za-z0-9._-]{1,120}$/.test(name) && name !== '.' && name !== '..' ? name : fallback
}

export const LOAD_FALLBACK = "Couldn't load this report. Please try again."
export const LOAD_RATE_LIMIT = 'You have loaded this report a lot in a short time. Please wait a little and try again.'
export const DOWNLOAD_RATE_LIMIT = 'You have downloaded a lot of reports in a short time. Please wait a little and try again.'
export const DOWNLOAD_TIMEOUT = 'Creating the PDF is taking too long. Please try again in a moment.'
export const DOWNLOAD_FALLBACK = 'Could not create the PDF. Please try again.'

export function loadErrorMessage(error, fallback = LOAD_FALLBACK) {
  if (error?.response?.status === 429) return LOAD_RATE_LIMIT
  return errorMessage(error, fallback)
}

// `bodyText` is the error blob's text ('' when there was none). The STATUS is checked before any text, because a 429's body
// is the generic {error} of the shared limiter.
export function downloadErrorMessage(error, bodyText) {
  const response = error?.response
  if (!response) return error?.code === 'ECONNABORTED' ? DOWNLOAD_TIMEOUT : NETWORK_MESSAGE
  if (response.status === 429) return DOWNLOAD_RATE_LIMIT
  try {
    const body = JSON.parse(bodyText || '')
    if (body && typeof body === 'object' && typeof body.error === 'string' && body.error) return body.error
  } catch {
    // not JSON: fall through to the generic sentence
  }
  return DOWNLOAD_FALLBACK
}

// A 400 that says the CNIC or NTN is not saved: the page reloads the profile so the checkbox state is right again.
export function namesMissingIdNumber(message) {
  return /none is saved/i.test(String(message || ''))
}

// ── Copy shared by the pages ──────────────────────────────────────────────────────────────────────────────────────
export const PNL_FLASH = 'Profit and loss PDF downloaded.'
export const STATEMENT_FLASH = 'Statement downloaded. Print it, sign it and add the date before you hand it in.'
export const STATEMENT_INTRO = 'A statement of the payments you received, to give to a bank, a visa office or PSEB. You print it, sign it and hand it in. It is your own declaration, built from the payments you recorded in LanceraOS. LanceraOS does not check or certify it, and the office you give it to may decide not to accept it. Many offices call this an income certificate; this is not one.'
