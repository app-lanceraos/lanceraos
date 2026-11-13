// src/pages/proposalHelpers.js
//
// Pure helpers for the Proposals pages (list / create / editor) and the
// autosave hook — no JSX, no network. Same "not a Section 12 shared-utility
// component" reasoning as clientHelpers.js / invoiceHelpers.js.
//
// The server stays authoritative for everything here: limits mirror
// apps/proposals/serializers.py so a bad value is caught before a wasted
// request, and the money arithmetic mirrors Proposal.compute_amounts /
// ProposalItem.save so the totals shown while typing equal what the server
// will store — but a 400 is still displayed, never assumed impossible.
import { todayInPlatformTimezone } from './invoiceHelpers'

// ── Status ────────────────────────────────────────────────────────────

// Proposal.STATUS_CHOICES mapped onto DESIGN.md's five status colour
// buckets. draft/withdrawn share gray and sent/viewed share blue, so each
// pair is told apart the way INVOICE_STATUS_META does it: outline vs filled,
// plus an icon for viewed. `expired` is deliberately NOT a key — it is
// computed on read (Proposal.is_expired) and layered on top as its own badge,
// exactly like OVERDUE_BADGE for invoices.
export const PROPOSAL_STATUS_META = {
  draft: { label: 'Draft', statusKey: 'gray', variant: 'outline' },
  sent: { label: 'Sent', statusKey: 'blue', variant: 'filled' },
  viewed: { label: 'Viewed', statusKey: 'blue', variant: 'filled', icon: 'eye' },
  accepted: { label: 'Accepted', statusKey: 'green', variant: 'filled' },
  declined: { label: 'Declined', statusKey: 'red', variant: 'filled' },
  withdrawn: { label: 'Withdrawn', statusKey: 'gray', variant: 'filled' },
}

export const EXPIRED_BADGE = { label: 'Expired', statusKey: 'amber', variant: 'filled' }

export function proposalStatusMeta(status) {
  return PROPOSAL_STATUS_META[status] || PROPOSAL_STATUS_META.draft
}

// There is deliberately no Expired option: GET /api/proposals/ filters on the
// stored status only and expiry is computed on read, so the server could not
// honour it. No sort control either — the list is always newest first.
export const STATUS_FILTER_OPTIONS = [
  { key: '', label: 'All' },
  { key: 'draft', label: 'Draft' },
  { key: 'sent', label: 'Sent' },
  { key: 'viewed', label: 'Viewed' },
  { key: 'accepted', label: 'Accepted' },
  { key: 'declined', label: 'Declined' },
  { key: 'withdrawn', label: 'Withdrawn' },
]

export const TONE_OPTIONS = [
  { value: 'professional', label: 'Professional' },
  { value: 'friendly', label: 'Friendly' },
  { value: 'technical', label: 'Technical' },
]

// The AI endpoints can legitimately take up to 60 s (server hard ceiling); the
// shared Axios instance's 15 s default would abandon a healthy call and invite
// a duplicate-creating retry (DECISIONS.md, D5).
export const AI_REQUEST_TIMEOUT_MS = 75000

// ── Limits ────────────────────────────────────────────────────────────

// Each value mirrors a constant in apps/proposals/serializers.py (or the
// DecimalField it names). The server enforces them all; these exist so the UI
// can say so before sending.
export const LIMITS = {
  title: 200,                 // TITLE_MAX
  clientName: 200,            // ProposalSerializer.client_name
  clientCompany: 200,         // ProposalSerializer.client_company
  clientEmail: 254,           // ProposalSerializer.client_email
  jobDescription: 6000,       // JOB_DESCRIPTION_MAX
  jobDescriptionMinForAi: 50, // JOB_DESCRIPTION_MIN_FOR_AI
  myExperience: 1500,         // MY_EXPERIENCE_MAX
  body: 8000,                 // BODY_MAX
  paymentTerms: 1000,         // PAYMENT_TERMS_MAX
  scopeSections: 10,          // MAX_SCOPE_SECTIONS
  scopeTitle: 120,            // SCOPE_TITLE_MAX
  scopeText: 2000,            // SCOPE_TEXT_MAX
  items: 50,                  // MAX_ITEMS
  itemDescription: 300,       // ProposalItem.description
  quantityIntDigits: 6,       // ProposalItemSerializer.quantity: max_digits=8, decimal_places=2
  unitPriceIntDigits: 8,      // ProposalItemSerializer.unit_price: max_digits=10, decimal_places=2
  discountIntDigits: 10,      // ProposalSerializer.discount_amount: max_digits=12, decimal_places=2
  taxRateMax: 100,            // ProposalSerializer.tax_rate: 0-100
}

// models.MAX_AMOUNT (max_digits=12, decimal_places=2) in cents.
const MAX_AMOUNT_CENTS = 999999999999n
const MAX_AMOUNT_LABEL = '9,999,999,999.99'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value)
}

// ── Exact decimal arithmetic (D6) ─────────────────────────────────────
//
// Integer-only (BigInt) so there is no floating point anywhere. A decimal is
// held as {int, scale} meaning int / 10^scale. Rounding is half-EVEN — Python's
// Decimal.quantize default, which the backend uses — and symmetric about zero.

const ZERO = { int: 0n, scale: 0 }
const DECIMAL_RE = /^(?:(\d+)(?:\.(\d*))?|\.(\d+))$/

// Plain non-negative decimal text -> {int, scale}, else null. No sign, no
// exponent, no thousands separators: anything else is "not a number" here and
// the server would reject it too.
export function parseDecimal(value) {
  if (value === null || value === undefined) return null
  const text = String(value).trim()
  const match = DECIMAL_RE.exec(text)
  if (!match) return null
  const whole = match[1] ?? ''
  const fraction = match[2] ?? match[3] ?? ''
  return { int: BigInt(`${whole}${fraction}` || '0'), scale: fraction.length }
}

function pow10(n) {
  return 10n ** BigInt(n)
}

function rescaleHalfEven(value, fromScale, toScale) {
  if (fromScale <= toScale) return value * pow10(toScale - fromScale)
  const negative = value < 0n
  const magnitude = negative ? -value : value
  const divisor = pow10(fromScale - toScale)
  let quotient = magnitude / divisor
  const twiceRemainder = (magnitude % divisor) * 2n
  if (twiceRemainder > divisor || (twiceRemainder === divisor && quotient % 2n === 1n)) quotient += 1n
  return negative ? -quotient : quotient
}

function centsToString(cents) {
  const negative = cents < 0n
  const digits = (negative ? -cents : cents).toString().padStart(3, '0')
  return `${negative ? '-' : ''}${digits.slice(0, -2)}.${digits.slice(-2)}`
}

function groupThousands(integerDigits) {
  return integerDigits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function asCents(value) {
  const parsed = parseDecimal(value)
  return parsed ? rescaleHalfEven(parsed.int, parsed.scale, 2) : 0n
}

// lines: [{quantity, unit_price}] as typed (strings). Blank / invalid /
// negative input counts as 0 — this is a DISPLAY helper; validateForm is what
// stops an invalid value being saved. Returns two-decimal strings, plus the
// BigInt cents the validator needs for the amount limits.
export function computeProposalTotals(items, taxRate, discountAmount) {
  const lineCents = (items || []).map((item) => {
    const quantity = parseDecimal(item.quantity) || ZERO
    const price = parseDecimal(item.unit_price) || ZERO
    return rescaleHalfEven(quantity.int * price.int, quantity.scale + price.scale, 2)
  })
  const subtotal = lineCents.reduce((sum, cents) => sum + cents, 0n)
  const rate = parseDecimal(taxRate) || ZERO
  // subtotal (scale 2) x rate (scale s) is at scale 2+s; "/ 100" adds 2 more.
  const tax = rescaleHalfEven(subtotal * rate.int, 4 + rate.scale, 2)
  const total = subtotal + tax - asCents(discountAmount)
  const clamped = total < 0n ? 0n : total
  return {
    lines: lineCents.map(centsToString),
    subtotal: centsToString(subtotal),
    tax_amount: centsToString(tax),
    total: centsToString(clamped),
    cents: { lines: lineCents, subtotal, tax, total: clamped },
  }
}

// "USD 1,250.50" — always two decimals (formatMoney in clientHelpers shows
// none, which is right for invoices' whole-number lists and wrong for a
// proposal's priced lines). Accepts the server's strings as well as numbers.
export function formatProposalMoney(amount, currency = 'USD') {
  if (amount === null || amount === undefined || amount === '') return '—'
  const text = typeof amount === 'number' ? amount.toFixed(2) : amount
  const parsed = parseDecimal(text)
  if (!parsed) return '—'
  const fixed = centsToString(rescaleHalfEven(parsed.int, parsed.scale, 2))
  const [whole, fraction] = fixed.split('.')
  return `${currency} ${groupThousands(whole)}.${fraction}`
}

// Strips insignificant zeros ("0.50" -> "0.5", "2.00" -> "2") so "0" typed
// into a field that held "0.00" is not seen as a change. Anything that is not
// a plain decimal is returned trimmed and untouched, for validation to flag.
export function canonDecimal(value) {
  const text = String(value ?? '').trim()
  const parsed = parseDecimal(text)
  if (!parsed) return text
  const digits = parsed.int.toString().padStart(parsed.scale + 1, '0')
  const whole = digits.slice(0, digits.length - parsed.scale)
  const fraction = digits.slice(digits.length - parsed.scale).replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : whole
}

// ── Dates and timestamps ──────────────────────────────────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// "2026-11-03" -> "3 Nov 2026". Never builds a Date: a bare YYYY-MM-DD parses
// as UTC midnight, which then displays as the previous day west of Greenwich.
export function formatDate(isoDate) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate || '')
  if (!match) return '—'
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return '—' // never print "undefined"
  return `${day} ${MONTHS[month - 1]} ${match[1]}`
}

// The API's timestamps are naive Pakistan time (USE_TZ=False: no Z, no
// offset), so they are shown AS WRITTEN. new Date() would treat the string as
// the browser's local time and a viewer outside Pakistan would see it shifted.
export function formatTimestamp(naiveIso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(naiveIso || '')
  if (!match) return '—'
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return '—' // never print "undefined"
  return `${day} ${MONTHS[month - 1]} ${match[1]}, ${match[4]}:${match[5]}`
}

// Freelancer-side times carry an explicit zone label: the API's timestamps are
// naive Pakistan time shown as written (see above), and a viewer elsewhere
// should not have to guess. An unparsable value stays a bare dash.
export function formatTimestampPkt(naiveIso) {
  const text = formatTimestamp(naiveIso)
  return text === '—' ? text : `${text} PKT`
}

export function wordCount(text) {
  const trimmed = (text || '').trim()
  return trimmed ? trimmed.split(/\s+/).length : 0
}

// ── Form model ────────────────────────────────────────────────────────

// Item and section rows carry a client-only `key` so React keeps a row's
// identity while it is reordered or edited; keys are never sent. The server's
// own row ids are deliberately not adopted into the editor (an autosave
// replaces the whole list server-side, so they change on every save).
let rowKeyCounter = 0
function nextRowKey() {
  rowKeyCounter += 1
  return `row-${rowKeyCounter}`
}

export function blankItem() {
  return { key: nextRowKey(), description: '', quantity: '1', unit_price: '' }
}

export function blankSection() {
  return { key: nextRowKey(), title: '', text: '' }
}

export function blankProposalForm(defaults = {}) {
  return {
    title: '',
    client: null,
    client_name: '',
    client_email: '',
    client_company: '',
    tone: 'professional',
    job_description: '',
    my_experience: '',
    body: '',
    currency: 'USD',
    payment_terms: '',
    tax_rate: '0',
    discount_amount: '0',
    valid_until: '',
    scope_sections: [],
    items: [blankItem()],
    ...defaults,
  }
}

// GET /api/proposals/<id>/ detail -> editable form state. An empty proposal
// still gets one blank item row so the pricing card is not an empty box.
export function proposalToForm(detail) {
  const items = (detail.items || []).map((item) => ({
    key: nextRowKey(),
    description: item.description,
    quantity: canonDecimal(item.quantity),
    unit_price: item.unit_price,
  }))
  return {
    title: detail.title || '',
    client: detail.client || null,
    client_name: detail.client_name || '',
    client_email: detail.client_email || '',
    client_company: detail.client_company || '',
    tone: detail.tone || 'professional',
    job_description: detail.job_description || '',
    my_experience: detail.my_experience || '',
    body: detail.body || '',
    currency: detail.currency || 'USD',
    payment_terms: detail.payment_terms || '',
    tax_rate: canonDecimal(detail.tax_rate ?? '0') || '0',
    discount_amount: canonDecimal(detail.discount_amount ?? '0') || '0',
    valid_until: detail.valid_until || '',
    scope_sections: (detail.scope_sections || []).map((s) => ({ key: nextRowKey(), title: s.title, text: s.text })),
    items: items.length ? items : [blankItem()],
  }
}

// ── Save payload (what the server stores) ─────────────────────────────

// The fields autosave may send. Read-only values (id, status, totals, quality,
// timestamps…) are not in this list and so can never be sent.
export const SAVE_KEYS = [
  'title', 'client', 'client_name', 'client_email', 'client_company', 'tone', 'job_description', 'my_experience',
  'body', 'currency', 'payment_terms', 'tax_rate', 'discount_amount', 'valid_until', 'scope_sections', 'items',
]

// A "completely empty" item row — nothing typed, quantity still at its
// default — is left out of the payload (it stays on screen). Anything else
// counts as content and must be valid to be saved.
function isEmptyItemRow(row) {
  const quantity = String(row.quantity ?? '').trim()
  return !String(row.description ?? '').trim() && !String(row.unit_price ?? '').trim() && (quantity === '' || quantity === '1')
}

function isEmptySectionRow(row) {
  return !String(row.title ?? '').trim() && !String(row.text ?? '').trim()
}

// Form -> the normalised value of every savable field. Normalisation is what
// makes "did this change?" mean what the user means by it: decimals compare
// by value, a blank date is null, empty rows do not exist. This is also the
// shape the autosave snapshot is kept in ("what was sent"), so it must be
// total — it never throws, whatever the user has typed.
export function buildSavePayload(form) {
  return {
    title: form.title,
    client: form.client || null,
    client_name: form.client_name,
    client_email: String(form.client_email ?? '').trim(),
    client_company: form.client_company,
    tone: form.tone,
    job_description: form.job_description,
    my_experience: form.my_experience,
    body: form.body,
    currency: form.currency,
    payment_terms: form.payment_terms,
    tax_rate: canonDecimal(form.tax_rate) || '0',
    discount_amount: canonDecimal(form.discount_amount) || '0',
    valid_until: form.valid_until || null,
    scope_sections: (form.scope_sections || [])
      .filter((s) => !isEmptySectionRow(s))
      .map((s) => ({ title: s.title, text: s.text })),
    items: (form.items || [])
      .filter((item) => !isEmptyItemRow(item))
      .map((item) => ({
        description: item.description,
        quantity: canonDecimal(item.quantity),
        unit_price: canonDecimal(item.unit_price),
      })),
  }
}

function sameValue(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}

// Which fields differ between the current form and the last-saved snapshot.
// Fields with a client-side validation error (`errors`) or that the server has
// already refused at this exact value (`rejected`) are WITHHELD — not sent, and
// reported — while every other changed field still goes. `items` and
// `scope_sections` are sent whole or not at all, because the server replaces
// each list wholesale.
export function diffPayload(current, lastSaved, errors = {}, rejected = {}) {
  const payload = {}
  const withheld = []
  for (const key of SAVE_KEYS) {
    if (sameValue(current[key], lastSaved?.[key])) continue
    if (errors[key] || (key in rejected && sameValue(current[key], rejected[key]))) {
      withheld.push(key)
      continue
    }
    payload[key] = current[key]
  }
  return { payload, withheld }
}

// ── Validation (client-side mirror of the serializer) ─────────────────

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Code points, not UTF-16 units: the server counts Python characters, and an
// emoji is 2 in JS `.length` but 1 there.
export function charCount(value) {
  return [...String(value ?? '')].length
}

function tooLong(value, max) {
  const count = charCount(value)
  return count > max ? `Too long — ${count} of ${max} characters.` : null
}

function decimalProblem(value, { intDigits, label }) {
  const parsed = parseDecimal(value)
  if (!parsed) return 'Enter a valid number.'
  if (parsed.scale > 2) return 'Use at most 2 decimal places.'
  const whole = parsed.int / pow10(parsed.scale)
  if (whole.toString().length > intDigits) return `${label} is too large.`
  return null
}

// Returns { errors, savable }. `errors` is keyed by SAVE_KEYS field; `items`
// and `scope_sections` hold { rows: { [rowKey]: {field: message} }, list?:
// message }. savable === "no errors at all". `lastSaved` (the autosave
// snapshot) lets an old draft whose valid-until date has since passed keep
// being edited: the date is only rejected when it is new or changed, exactly
// like ProposalSerializer.validate_valid_until.
export function validateForm(form, lastSaved) {
  const errors = {}

  if (!String(form.title ?? '').trim()) errors.title = 'Give the proposal a title.'
  else if (tooLong(form.title, LIMITS.title)) errors.title = tooLong(form.title, LIMITS.title)

  const nameProblem = tooLong(form.client_name, LIMITS.clientName)
  if (nameProblem) errors.client_name = nameProblem
  const companyProblem = tooLong(form.client_company, LIMITS.clientCompany)
  if (companyProblem) errors.client_company = companyProblem
  const email = String(form.client_email ?? '').trim()
  if (email && (!EMAIL_RE.test(email) || charCount(email) > LIMITS.clientEmail)) errors.client_email = 'Enter a valid email address.'

  for (const [key, max] of [
    ['job_description', LIMITS.jobDescription], ['my_experience', LIMITS.myExperience],
    ['body', LIMITS.body], ['payment_terms', LIMITS.paymentTerms],
  ]) {
    const problem = tooLong(form[key], max)
    if (problem) errors[key] = problem
  }

  if (form.valid_until) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.valid_until)) errors.valid_until = 'Enter a valid date.'
    else if (form.valid_until < todayInPlatformTimezone() && form.valid_until !== (lastSaved?.valid_until ?? null)) {
      errors.valid_until = 'The valid-until date cannot be in the past.'
    }
  }

  if (!/^[A-Za-z]{3}$/.test(form.currency || '')) errors.currency = 'Choose a currency.'

  const taxText = String(form.tax_rate ?? '').trim()
  if (taxText) {
    const parsed = parseDecimal(taxText)
    if (!parsed) errors.tax_rate = 'Enter a valid number.'
    else if (parsed.scale > 2) errors.tax_rate = 'Use at most 2 decimal places.'
    else if (parsed.int > BigInt(LIMITS.taxRateMax) * pow10(parsed.scale)) errors.tax_rate = 'Tax rate must be between 0 and 100.'
  }

  const discountText = String(form.discount_amount ?? '').trim()
  if (discountText) {
    const problem = decimalProblem(discountText, { intDigits: LIMITS.discountIntDigits, label: 'Discount' })
    if (problem) errors.discount_amount = problem
  }

  // ── items ──
  const itemRows = {}
  let contentRows = 0
  for (const row of form.items || []) {
    if (isEmptyItemRow(row)) continue
    contentRows += 1
    const rowErrors = {}
    if (!String(row.description ?? '').trim()) rowErrors.description = 'Describe this item.'
    else if (tooLong(row.description, LIMITS.itemDescription)) rowErrors.description = tooLong(row.description, LIMITS.itemDescription)
    const quantity = parseDecimal(row.quantity)
    if (!String(row.quantity ?? '').trim()) rowErrors.quantity = 'Enter a quantity.'
    else if (!quantity) rowErrors.quantity = 'Enter a valid number.'
    else if (quantity.scale > 2) rowErrors.quantity = 'Use at most 2 decimal places.'
    else if (quantity.int === 0n || rescaleHalfEven(quantity.int, quantity.scale, 2) < 1n) rowErrors.quantity = 'Quantity must be at least 0.01.'
    else if ((quantity.int / pow10(quantity.scale)).toString().length > LIMITS.quantityIntDigits) rowErrors.quantity = 'Quantity is too large.'
    if (!String(row.unit_price ?? '').trim()) rowErrors.unit_price = 'Enter a price (0 for no charge).'
    else {
      const problem = decimalProblem(row.unit_price, { intDigits: LIMITS.unitPriceIntDigits, label: 'Price' })
      if (problem) rowErrors.unit_price = problem
    }
    if (Object.keys(rowErrors).length) itemRows[row.key] = rowErrors
  }
  const itemsError = {}
  if (Object.keys(itemRows).length) itemsError.rows = itemRows
  if (contentRows > LIMITS.items) itemsError.list = `A proposal can have at most ${LIMITS.items} items.`

  // The amount limits can only be judged on numbers that parse, so they run
  // after (and only if) every row is otherwise valid — the same order the
  // serializer's _validate_amounts follows.
  if (!itemsError.rows && !itemsError.list) {
    const savedRows = (form.items || []).filter((row) => !isEmptyItemRow(row))
    const totals = computeProposalTotals(savedRows, form.tax_rate || '0', '0')
    const lineProblems = {}
    savedRows.forEach((row, index) => {
      if (totals.cents.lines[index] > MAX_AMOUNT_CENTS) {
        lineProblems[row.key] = { unit_price: `This line is too large (the maximum is ${MAX_AMOUNT_LABEL}).` }
      }
    })
    if (Object.keys(lineProblems).length) itemsError.rows = lineProblems
    else if (totals.cents.subtotal > MAX_AMOUNT_CENTS) itemsError.list = `The subtotal is too large (the maximum is ${MAX_AMOUNT_LABEL}).`
    else if (!errors.tax_rate && totals.cents.subtotal + totals.cents.tax > MAX_AMOUNT_CENTS) {
      errors.tax_rate = `The subtotal plus tax is too large (the maximum is ${MAX_AMOUNT_LABEL}).`
    }
  }
  if (itemsError.rows || itemsError.list) errors.items = itemsError

  // ── scope sections ──
  const sectionRows = {}
  let contentSections = 0
  for (const row of form.scope_sections || []) {
    if (isEmptySectionRow(row)) continue
    contentSections += 1
    const rowErrors = {}
    if (!String(row.title ?? '').trim()) rowErrors.title = 'Add a title for this section.'
    else if (tooLong(row.title, LIMITS.scopeTitle)) rowErrors.title = tooLong(row.title, LIMITS.scopeTitle)
    const textProblem = tooLong(row.text, LIMITS.scopeText)
    if (textProblem) rowErrors.text = textProblem
    if (Object.keys(rowErrors).length) sectionRows[row.key] = rowErrors
  }
  const sectionsError = {}
  if (Object.keys(sectionRows).length) sectionsError.rows = sectionRows
  if (contentSections > LIMITS.scopeSections) sectionsError.list = `A proposal can have at most ${LIMITS.scopeSections} scope sections.`
  if (sectionsError.rows || sectionsError.list) errors.scope_sections = sectionsError

  return { errors, savable: Object.keys(errors).length === 0 }
}

// ── Server error parsing ──────────────────────────────────────────────

function firstMessage(value) {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = firstMessage(entry)
      if (found) return found
    }
    return null
  }
  if (value && typeof value === 'object') {
    for (const entry of Object.values(value)) {
      const found = firstMessage(entry)
      if (found) return found
    }
  }
  return null
}

// Flat `error` first (every proposals endpoint sends one), else the first
// field-keyed message DRF produced, else `fallback`. Also hands back the HTTP
// status and the machine `reason` id for callers that branch on them.
export function errorMessage(error, fallback = 'Something went wrong. Please try again.') {
  const status = error?.response?.status ?? null
  const data = error?.response?.data
  let message = null
  let reason = null
  if (data && typeof data === 'object') {
    reason = typeof data.reason === 'string' ? data.reason : null
    if (typeof data.error === 'string' && data.error) message = data.error
    else message = firstMessage(Object.fromEntries(Object.entries(data).filter(([key]) => key !== 'reason')))
  }
  return { message: message || fallback, status, reason }
}

// A 400 body -> { field: message } for the fields the server named. A list
// field's nested row errors collapse to one message ("Line 2: …") because the
// server numbers rows by position and the editor shows list-level text.
export function fieldErrorsFromResponse(data) {
  const out = {}
  if (!data || typeof data !== 'object') return out
  for (const [key, value] of Object.entries(data)) {
    if (key === 'error' || key === 'reason') continue
    if (Array.isArray(value) && value.some((entry) => entry && typeof entry === 'object' && !Array.isArray(entry))) {
      const index = value.findIndex((entry) => entry && typeof entry === 'object' && Object.keys(entry).length)
      const message = firstMessage(value[index])
      if (message) out[key] = `Line ${index + 1}: ${message}`
      continue
    }
    const message = firstMessage(value)
    if (message) out[key] = message
  }
  return out
}
