// src/pages/taxHelpers.js
//
// Pure helpers for the Tax page (/tax, Prompt 21). No React, no network, no `new Date()`.
//
// THE RULE OF THIS FILE: every tax sentence and every number comes from the server (GET /tax/overview/, /tax/law/,
// POST /tax/calculator/). Nothing here states a rate, a band, a date or a rule of its own, and nothing adds, converts or
// rounds money: an amount is only ever turned into text (formatExact / plainAmount) or a COUNT is tested. The only static
// text is page chrome (labels, buttons, empty states, error sentences) and the confidence legend, which is taken from
// TAX_LAW.md and is part of what the pre-launch reviewer reads. A test scans every static string for percent figures,
// calendar dates and banned words.
import { formatIsoDate, monthLong } from './dashboardHelpers'
import { NETWORK_MESSAGE, paymentCountLabel, toCents } from './paymentsHelpers'
import { BLOCK, formatExact, loadErrorMessage, plainAmount } from './reportsHelpers'

// ── Views ─────────────────────────────────────────────────────────────────────────────────────────────────────────
export const VIEWS = [
  { key: 'estimate', label: 'Estimate', to: '/tax' },
  { key: 'calculator', label: 'Calculator', to: '/tax?view=calculator' },
  { key: 'sources', label: 'How this works', to: '/tax?view=sources' },
]
export const VIEW_NAV_LABEL = 'Tax views'

// Exactly 'calculator' or 'sources'; anything else (null, '', 'CALCULATOR', an unknown word) is the Estimate.
export function viewFromParam(value) {
  return value === 'calculator' || value === 'sources' ? value : 'estimate'
}

// ── Tax year ──────────────────────────────────────────────────────────────────────────────────────────────────────
export const YEAR_GROUP_LABEL = 'Tax year'

// `selectedYear` is null until the person picks a pill: the first request has NO tax_year, the server chooses.
export function overviewParams(selectedYear) {
  return selectedYear === null || selectedYear === undefined ? {} : { tax_year: selectedYear }
}

export function activeYear(selectedYear, data) {
  return selectedYear ?? data?.tax_year ?? null
}

// The pills come from the law payload, so a new tax year is a backend change only. Fewer than two years: no pills.
export function yearOptions(law) {
  const years = law?.tax_years
  if (!Array.isArray(years) || years.length < 2 || !years.every((y) => Number.isInteger(y))) return []
  return years
}

export function yearPillLabel(year) {
  return `Tax year ${year}`
}

// The integer to send to the calculator, or null (the key is then omitted, never sent as null).
export function calculatorYear(selectedYear, data) {
  const year = activeYear(selectedYear, data)
  return Number.isInteger(year) ? year : null
}

// ── Payload checks (a half-drawn page is never shown) ─────────────────────────────────────────────────────────────
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const isStr = (v) => typeof v === 'string'
const isNum = (v) => typeof v === 'number' && Number.isFinite(v)

export function overviewIsUsable(data) {
  if (!isObj(data)) return false
  if (!Number.isInteger(data.tax_year) || !isStr(data.start) || !isStr(data.end) || !isStr(data.counted_to)) return false
  const exp = data.export
  if (!isObj(exp) || !isStr(exp.total) || !isStr(exp.expected_deduction) || !isNum(exp.count) || !Array.isArray(exp.by_currency)) return false
  if (!isObj(data.local) || !isStr(data.local.total) || !isNum(data.local.count)) return false
  if (!Array.isArray(data.monthly) || data.monthly.length === 0) return false
  if (!data.monthly.every((m) => isObj(m) && isStr(m.month) && isStr(m.export_receipts) && isStr(m.expected_deduction) && isStr(m.local_receipts))) return false
  if (!isObj(data.rate) || !isStr(data.rate.percent) || !isStr(data.rate.sentence)) return false
  if (!Array.isArray(data.checklist) || !data.checklist.every((c) => isObj(c) && isStr(c.key) && isStr(c.status) && isStr(c.text))) return false
  if (!Array.isArray(data.notes) || data.notes.length === 0 || !Array.isArray(data.not_covered)) return false
  if (!isNum(data.unconverted_count) || typeof data.has_ntn !== 'boolean') return false
  if (!isObj(data.return) || !isStr(data.return.sentence)) return false
  return true
}

export function lawIsUsable(data) {
  if (!isObj(data)) return false
  if (!Array.isArray(data.facts) || !data.facts.every((f) => isObj(f) && isStr(f.id) && isStr(f.title) && isStr(f.text) && isStr(f.confidence) && Array.isArray(f.sources))) return false
  if (!Array.isArray(data.sources) || !data.sources.every((s) => isObj(s) && isStr(s.key) && isStr(s.label) && isStr(s.url))) return false
  return Array.isArray(data.tax_years) && isStr(data.last_verified) && isStr(data.version) && isObj(data.links)
}

export function calculatorIsUsable(data) {
  return isObj(data) && Number.isInteger(data.tax_year) && isStr(data.taxable_income) && Array.isArray(data.bands)
    && isStr(data.tax_before_surcharge) && isStr(data.surcharge) && isStr(data.total_tax) && Array.isArray(data.notes)
}

// ── Counts (the only arithmetic the page does) ────────────────────────────────────────────────────────────────────
// Every payment is exactly one of export, local or unconverted, so this sum is the number of payments in the tax year.
export function paymentTotal(data) {
  return data.export.count + data.local.count + data.unconverted_count
}

export function yearIsEmpty(data) {
  return paymentTotal(data) === 0
}

export function isInProgress(data) {
  return data.status === 'in_progress'
}

export function hasByCurrency(data) {
  return data.export.by_currency.length > 0
}

// ── Lines built from RESPONSE fields (formatting only) ────────────────────────────────────────────────────────────
export function yearLine(data) {
  return `Tax year ${data.tax_year}: ${formatIsoDate(data.start)} to ${formatIsoDate(data.end)}`
}

export function countedLine(data) {
  return isInProgress(data) ? `Counted up to ${formatIsoDate(data.counted_to)}.` : ''
}

export function rateLine(data) {
  return `${data.rate.percent}%`
}

export function staleLine(data) {
  return data.stale_law === true ? STALE_ALERT(data.tax_year) : ''
}

// ── Estimate copy ─────────────────────────────────────────────────────────────────────────────────────────────────
export const ESTIMATE_STANDING_NOTE = "These figures are estimates built from the payments you recorded in LanceraOS. Your bank's own records show the tax it actually took."
export const NOT_ADVICE_NOTE = 'This page is not a tax return, a tax certificate or tax advice.'
export const STALE_ALERT = (year) => `The tax rules for the current tax year are not loaded yet. The figures below use the rules for tax year ${year}.`
export const NO_FOREIGN_CURRENCY = 'No payments in a currency other than PKR in this tax year.'
export const LOADING_LABEL = 'Loading your tax estimate'

export const RATE_CARD_TITLE = 'Rate used in this estimate'
export const SETTINGS_LINK_LABEL = 'Tax & PSEB settings'

export const NEXT_TITLE = 'What to do next'
export const NOT_COVERED_TITLE = 'What this estimate does not cover'

export const MONTH_TABLE_TITLE = 'Month by month'
export const MONTH_TABLE_SUBTITLE = 'In PKR'
export const MONTH_COLUMNS = [
  { key: 'month', label: 'Month' },
  { key: 'export', label: 'Received from abroad (PKR)', align: 'right' },
  { key: 'tax', label: 'Estimated tax (PKR)', align: 'right' },
  { key: 'local', label: 'Local payments (PKR)', align: 'right' },
]
export const MONTH_TOTAL_LABEL = 'Total'
export const CURRENCY_TABLE_TITLE = 'Received in these currencies'
export const CURRENCY_TABLE_SUBTITLE = 'Original amounts, before conversion'
export const CURRENCY_COLUMNS = [
  { key: 'currency', label: 'Currency' },
  { key: 'payments', label: 'Payments', align: 'right' },
  { key: 'amount', label: 'Amount received', align: 'right' },
]

export const EMPTY_YEAR_BODY = 'Record a payment dated inside this tax year to see your estimate.'
export const EMPTY_YEAR_BUTTON = 'Record a payment'
export function emptyYearTitle(data) {
  return `No payments in tax year ${data.tax_year}`
}

// ── Estimate pieces ───────────────────────────────────────────────────────────────────────────────────────────────
export function kpiCards(data) {
  return [
    {
      key: 'export', label: 'Received from abroad', value: formatExact(data.export.total, 'PKR'),
      lines: [paymentCountLabel(data.export.count), 'PKR equivalent'],
    },
    {
      key: 'tax', label: 'Estimated tax taken by banks', value: formatExact(data.export.expected_deduction, 'PKR'),
      lines: [`At ${rateLine(data)}`, 'An estimate'],
    },
    {
      key: 'local', label: 'Received in PKR from local payers', value: formatExact(data.local.total, 'PKR'),
      lines: [paymentCountLabel(data.local.count), 'No bank deduction estimated'],
    },
  ]
}

export function monthlyRows(data) {
  return data.monthly.map((m) => ({
    key: m.month,
    cells: { month: monthLong(m.month), export: plainAmount(m.export_receipts), tax: plainAmount(m.expected_deduction), local: plainAmount(m.local_receipts) },
  }))
}

// The footer is the SERVER's totals, never a sum of the rows above it.
export function monthlyFooter(data) {
  return {
    cells: {
      month: MONTH_TOTAL_LABEL, export: plainAmount(data.export.total), tax: plainAmount(data.export.expected_deduction), local: plainAmount(data.local.total),
    },
  }
}

export function currencyRows(data) {
  return data.export.by_currency.map((row) => ({
    key: row.currency,
    cells: { currency: row.currency, payments: String(row.count), amount: formatExact(row.amount, row.currency) },
  }))
}

export function statusWord(status) {
  if (status === 'done') return 'Done'
  if (status === 'todo') return 'To do'
  return 'Check'
}

// The only status colours on the page; the status is always ALSO written as a word.
export function statusTone(status) {
  if (status === 'done') return 'var(--status-green-text)'
  if (status === 'todo') return 'var(--status-amber-text)'
  return 'var(--text-tertiary)'
}

// notes[0] is the standing note, shown once under the controls; the rest go at the bottom in the server's order.
export function visibleNotes(data) {
  return data.notes.slice(1)
}

// ── Download ──────────────────────────────────────────────────────────────────────────────────────────────────────
export const NO_PAYMENTS_REASON = 'You have no payments in this tax year, so there is nothing to put in the summary.'
export const DOWNLOAD_TITLE = 'Tax summary for your accountant'
export const DOWNLOAD_SUBTITLE = 'A one-page PDF of this estimate'
export const NTN_LABEL = 'Show my NTN on the summary'
export const NTN_HINT = 'Only turn this on if the person you give it to asks for it. It is printed on the summary.'
export const NTN_LOADING_HINT = 'Loading your details…'
export const DOWNLOAD_BUTTON = 'Download tax summary (PDF)'
export const DOWNLOAD_BUSY = 'Preparing PDF…'
export const DOWNLOAD_FLASH = 'Tax summary downloaded.'

export function summaryParams(data, includeNtn) {
  const params = { tax_year: data.tax_year }
  if (includeNtn) params.include_ntn = 'true'
  return params
}

export function summaryBlockReason({ loading, loadFailed, data, busy }) {
  if (loading) return BLOCK.loading
  if (loadFailed || !data) return BLOCK.loadFailed
  if (yearIsEmpty(data)) return NO_PAYMENTS_REASON
  if (busy) return BLOCK.busy
  return null
}

export function summaryFilename(data) {
  return `tax_summary_${data.tax_year}.pdf`
}

export function ntnBoxState({ loading, hasNtn }) {
  if (loading) return 'loading'
  return hasNtn ? 'ready' : 'unavailable'
}

// ── Calculator ────────────────────────────────────────────────────────────────────────────────────────────────────
export const CALCULATOR_MAX_INCOME_TEXT = '1,000,000,000,000'
const MAX_WHOLE = '1000000000000'

export const CALC_TITLE = 'Tax calculator'
export const CALC_SUBTITLE = 'Normal rates for non-salaried individuals'
export const CALC_INTRO_1 = 'Type a taxable income to see the tax at the normal rates for the tax year you picked. It is an estimate.'
export const CALC_INTRO_2_LEAD = 'This is not the tax your bank takes on money from abroad. That estimate is on the '
export const CALC_INTRO_2_LINK = 'Estimate view'
export const CALC_INTRO_2_TAIL = '.'
export const CALC_LABEL = 'Taxable income (PKR)'
export const CALC_HINT = 'Digits only, with up to 2 decimal places. Commas are fine.'
export const CALC_PLACEHOLDER = '1500000'
export const CALC_BUTTON = 'Calculate tax'
export const CALC_BUSY = 'Calculating…'

export const INCOME_EMPTY = 'Enter your taxable income in rupees.'
export const INCOME_NEGATIVE = 'Taxable income cannot be negative.'
export const INCOME_FORMAT = 'Enter an amount like 1500000 or 1500000.50 (at most 2 decimal places).'
export const INCOME_TOO_BIG = `Enter an amount of ${CALCULATOR_MAX_INCOME_TEXT} or less.`

// → { ok: true, value } with the normalised digit string, or { ok: false, error }. Commas, spaces and tabs are stripped.
export function parseIncomeInput(raw) {
  const text = String(raw ?? '').replace(/[,\s]/g, '')
  if (text === '') return { ok: false, error: INCOME_EMPTY }
  if (text.startsWith('-')) return { ok: false, error: INCOME_NEGATIVE }
  const match = /^([0-9]+)(?:\.([0-9]{1,2}))?$/.exec(text)
  if (!match) return { ok: false, error: INCOME_FORMAT }
  const whole = match[1].replace(/^0+(?=\d)/, '')
  const fraction = match[2] ?? ''
  const nonZeroFraction = /[1-9]/.test(fraction)
  const tooBig = whole.length > MAX_WHOLE.length
    || (whole.length === MAX_WHOLE.length && (whole > MAX_WHOLE || (whole === MAX_WHOLE && nonZeroFraction)))
  if (tooBig) return { ok: false, error: INCOME_TOO_BIG }
  return { ok: true, value: fraction ? `${whole}.${fraction}` : whole }
}

// tax_year is OMITTED (never null) when it is not an integer: the server refuses null.
export function calculatorBody(value, year) {
  const body = { taxable_income: value }
  if (Number.isInteger(year)) body.tax_year = year
  return body
}

export const RESULT_TABLE_TITLE = 'How it adds up'
export const RESULT_COLUMNS = [
  { key: 'band', label: 'Income band (PKR)' },
  { key: 'rate', label: 'Rate', align: 'right' },
  { key: 'income', label: 'Income in band (PKR)', align: 'right' },
  { key: 'tax', label: 'Tax (PKR)', align: 'right' },
]
export const NO_BANDS = 'The taxable income is 0, so no band applies.'
export const SUMMARY_LABELS = {
  before: 'Tax before surcharge', total: 'Total tax', average: 'Average rate', top: 'Top band rate',
}

export function calculatorResultTitle(result) {
  return `Tax for tax year ${result.tax_year}`
}

export function calculatorResultSubtitle(result) {
  return `On a taxable income of ${formatExact(result.taxable_income, 'PKR')}`
}

// Whole rupees with commas when the cents are .00, otherwise with the cents.
function bandNumber(value) {
  const cents = toCents(value) // integer cents parsed digit by digit, never floating-point arithmetic on a money string
  if (Number.isFinite(cents) && cents % 100 === 0) return Math.trunc(cents / 100).toLocaleString('en')
  return plainAmount(value)
}

export function bandLabel(band) {
  return band.to === null ? `Above ${bandNumber(band.from)}` : `${bandNumber(band.from)} to ${bandNumber(band.to)}`
}

export function bandRate(band) {
  return `${band.rate_percent}%`
}

export function bandRows(result) {
  return result.bands.map((band, index) => ({
    key: `${index}-${band.from}`,
    cells: { band: bandLabel(band), rate: bandRate(band), income: plainAmount(band.income_in_band), tax: plainAmount(band.tax) },
  }))
}

export function surchargeLabel(result) {
  return result.surcharge_percent === null || result.surcharge_percent === undefined ? '' : `Surcharge (${result.surcharge_percent}%)`
}

// Formatting only: the server's own average, shown to one decimal.
export function averageRateText(result) {
  const value = result.effective_percent
  return value === null || value === undefined ? '—' : `${Number(value).toFixed(1)}%`
}

export function topBandText(result) {
  return `${result.marginal_percent}%`
}

// ── How this works ────────────────────────────────────────────────────────────────────────────────────────────────
export const SOURCES_INTRO = 'Where the numbers on this page come from. Each fact says how sure we are and which sources it rests on.'
export const CONFIDENCE_LEGEND = [
  "High: from FBR's own document, or two independent texts agree.",
  'Medium-high: two law texts agree, but they may be older than the latest change.',
  'Medium: one source, or our reading of the law.',
]
export const LAW_LOADING_LABEL = 'Loading the tax rules'
export const SOURCES_HEADING = 'Sources'
export const LINKS_HEADING = 'Useful links'

export function confidenceWord(value) {
  if (value === 'high') return 'High'
  if (value === 'medium_high') return 'Medium-high'
  if (value === 'medium') return 'Medium'
  return 'Not rated'
}

export function factSources(fact, law) {
  const byKey = new Map((law?.sources || []).map((s) => [s.key, s]))
  return (fact?.sources || []).map((key) => byKey.get(key)).filter(Boolean).map((s) => ({ key: s.key, label: s.label, url: s.url }))
}

// Only absolute https: URLs become links; anything else is shown as plain text.
export function safeHttpsUrl(url) {
  try {
    const parsed = new URL(String(url))
    return parsed.protocol === 'https:' ? String(url) : null
  } catch {
    return null
  }
}

const LINK_LABELS = { fbr_iris: 'FBR IRIS portal', pseb: 'PSEB website', fbr: 'FBR website' }
export function linkLabel(key) {
  return LINK_LABELS[key] ?? null
}

export function checkedLine(law) {
  return `Rules last checked on ${formatIsoDate(law.last_verified)} (version ${law.version}).`
}

// ── Errors ────────────────────────────────────────────────────────────────────────────────────────────────────────
export const TAX_LOAD_FALLBACK = "Couldn't load your tax estimate. Please try again."
export const TAX_RATE_LIMIT = 'You have loaded your tax estimate a lot in a short time. Please wait a little and try again.'
export const TAX_YEAR_UNAVAILABLE = "That tax year isn't available. Choose another one."
export const LAW_LOAD_FALLBACK = "Couldn't load the tax rules. Please try again."
export const LAW_RATE_LIMIT = 'You have loaded this page a lot in a short time. Please wait a little and try again.'
export const CALC_RATE_LIMIT = 'You have used the calculator a lot in a short time. Please wait a little and try again.'
export const CALC_FALLBACK = "Couldn't calculate the tax. Please try again."
export const RELOAD_LABEL = 'Reload'

// A 400 on the overview is a developer sentence ("tax_year must be 2026 or 2027."): the page never sends a bad year, so it is
// never shown raw. Everything else goes through the shared message (network, or the server's own sentence).
export function taxLoadError(error) {
  const status = error?.response?.status
  if (status === 429) return TAX_RATE_LIMIT
  if (status === 400) return TAX_YEAR_UNAVAILABLE
  return loadErrorMessage(error, TAX_LOAD_FALLBACK)
}

export function lawLoadError(error) {
  const status = error?.response?.status
  if (status === 429) return LAW_RATE_LIMIT
  if (status === 400) return LAW_LOAD_FALLBACK
  return loadErrorMessage(error, LAW_LOAD_FALLBACK)
}

// The server's calculator sentences are written for people and shown verbatim.
export function calculatorError(error) {
  const response = error?.response
  if (!response) return NETWORK_MESSAGE
  if (response.status === 429) return CALC_RATE_LIMIT
  const body = response.data
  if (body && typeof body === 'object' && typeof body.error === 'string' && body.error) return body.error
  return CALC_FALLBACK
}

// ── Settings > Tax & PSEB ─────────────────────────────────────────────────────────────────────────────────────────
export const TAX_SETTINGS_SUBTITLE = 'Your saved PSEB number sets the rate in your tax estimate. CNIC and NTN are printed only on documents where you tick them.'
export const TAX_SETTINGS_PSEB_HINT = 'Your tax estimate uses the PSEB registration rate only when this number is saved.'

// ── The scan list ─────────────────────────────────────────────────────────────────────────────────────────────────
// Whole words or phrases, matched case-insensitively by the tests. "taxable" and "certificate" are allowed on this page.
export const BANNED_WORDS = [
  'ledger', 'rollup', 'snapshot', 'rate_basis', 'endpoint', 'API', 'fingerprint', 'batch', 'verified', 'official', 'guaranteed',
  'tax-free', 'claim this', 'save tax', 'reduces your tax', 'exempt', 'exemption', 'SRO', 'you owe', 'you should', 'you must',
  'we recommend', 'compliant', 'seamless', 'powerful', 'easily', 'simply', 'just',
]
