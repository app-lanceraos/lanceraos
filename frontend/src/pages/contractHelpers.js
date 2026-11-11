// src/pages/contractHelpers.js
//
// Pure helpers for the Contracts pages (list / new / editor / sent page / the client's page) and the autosave hook:
// no JSX, no network. The server stays authoritative for everything here. Limits mirror apps/contracts/constants.py and
// the serializers (a drift test compares them with the generated fixture `limits.json`) so a bad value is caught before
// a wasted request, but a 400 is still displayed, never assumed impossible.
//
// Plain text only: no function here produces or accepts HTML. Money comes from the server as strings and is formatted
// with the Proposals helpers (exact decimal arithmetic, no floats).
import { todayInPlatformTimezone } from './invoiceHelpers'
import { PUBLIC_COPY } from './contractCopy'
import {
  EMAIL_RE, EXPIRED_BADGE, canonDecimal, charCount, errorMessage as proposalErrorMessage, formatProposalMoney,
  isUuid, parseDecimal,
} from './proposalHelpers'

export { EXPIRED_BADGE, isUuid }

// ── Limits (mirrors of apps/contracts/constants.py) ───────────────────

export const CONTRACT_LIMITS = {
  SECTION_MAX: 30,
  SECTION_TITLE_MAX: 120,
  SECTION_TEXT_MAX: 6000,
  TOTAL_TEXT_MAX: 60000,
  PAYMENT_TERMS_MAX: 2000,
  NAME_MIN: 2,
  NAME_MAX: 120,
  MESSAGE_MAX: 1000,
  TITLE_MAX: 200,
  MAX_AMOUNT: '9999999999.99', // apps.proposals.models.MAX_AMOUNT
}
const CLIENT_NAME_MAX = 200
const CLIENT_COMPANY_MAX = 200
const CLIENT_EMAIL_MAX = 254
const MAX_AMOUNT_CENTS = 999999999999n

// ── Status ────────────────────────────────────────────────────────────

// Contract.STATUS_CHOICES on DESIGN.md's five status colour buckets. draft/withdrawn share gray and sent/viewed share
// blue, told apart the way PROPOSAL_STATUS_META does it (outline vs filled, plus an eye icon for viewed). `expired` is
// NOT a key: it is computed on read (Contract.is_expired) and layered on top as its own amber badge.
export const CONTRACT_STATUS_META = {
  draft: { label: 'Draft', statusKey: 'gray', variant: 'outline' },
  sent: { label: 'Sent', statusKey: 'blue', variant: 'filled' },
  viewed: { label: 'Viewed', statusKey: 'blue', variant: 'filled', icon: 'eye' },
  signed: { label: 'Signed', statusKey: 'green', variant: 'filled' },
  declined: { label: 'Declined', statusKey: 'red', variant: 'filled' },
  withdrawn: { label: 'Withdrawn', statusKey: 'gray', variant: 'filled' },
}

export function contractStatusMeta(status) {
  return CONTRACT_STATUS_META[status] || CONTRACT_STATUS_META.draft
}

// No Expired option: GET /api/contracts/ filters on the stored status only and expiry is computed on read.
export const STATUS_FILTER_OPTIONS = [
  { key: '', label: 'All' },
  { key: 'draft', label: 'Draft' },
  { key: 'sent', label: 'Sent' },
  { key: 'viewed', label: 'Viewed' },
  { key: 'signed', label: 'Signed' },
  { key: 'declined', label: 'Declined' },
  { key: 'withdrawn', label: 'Withdrawn' },
]

export function templateById(templates, key) {
  return (templates || []).find((template) => template.key === key) || null
}

// ── Dates ─────────────────────────────────────────────────────────────

function parseIsoDate(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '')
  if (!match) return null
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const probe = new Date(Date.UTC(year, month - 1, day))
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null
  return { year, month, day }
}

export function isRealDate(iso) {
  return parseIsoDate(iso) !== null
}

/**
 * `isoDate` plus `n` days as YYYY-MM-DD. The arithmetic is done on the year / month / day parts through UTC, so the
 * result never depends on the browser's time zone or on a daylight-saving change. An unparsable date gives ''.
 */
export function addDays(isoDate, n) {
  const parts = parseIsoDate(isoDate)
  if (!parts) return ''
  const moved = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + n))
  const pad = (value, width = 2) => String(value).padStart(width, '0')
  return `${pad(moved.getUTCFullYear(), 4)}-${pad(moved.getUTCMonth() + 1)}-${pad(moved.getUTCDate())}`
}

// ── Sections ──────────────────────────────────────────────────────────

let keyCounter = 0
const nextKey = () => {
  keyCounter += 1
  return `section-key-${keyCounter}`
}

/** A client-side section id: 's' + 8 hex characters, the shape the server generates. */
export function newSectionId() {
  const bytes = new Uint8Array(4)
  globalThis.crypto.getRandomValues(bytes)
  return `s${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

export function newSection() {
  return { key: nextKey(), id: newSectionId(), title: '', text: '' }
}

/** Gives every section a local React `key` (never sent) and makes sure it has an `id`. */
export function withKeys(sections) {
  return (sections || []).map((section) => ({
    key: nextKey(), id: section.id || newSectionId(), title: section.title ?? '', text: section.text ?? '',
  }))
}

export function stripKeys(sections) {
  return (sections || []).map((section) => ({ id: section.id, title: section.title, text: section.text }))
}

/** A new array with the section at `index` moved by `delta` places; the same array when it cannot move. */
export function moveSection(sections, index, delta) {
  const target = index + delta
  if (index < 0 || index >= sections.length || target < 0 || target >= sections.length || delta === 0) return sections
  const next = sections.slice()
  const [moved] = next.splice(index, 1)
  next.splice(target, 0, moved)
  return next
}

// ── Blanks: text in [[double square brackets]] ────────────────────────

/**
 * Every blank in `text`: [{ start, end, text }] with `end` exclusive. Same semantics as the server's
 * PLACEHOLDER_RE = \[\[.*?\]\] with DOTALL: non-greedy, may span lines, matches left to right without overlapping.
 */
export function findPlaceholders(text) {
  const out = []
  const re = /\[\[[\s\S]*?\]\]/g
  const source = String(text ?? '')
  let match = re.exec(source)
  while (match) {
    out.push({ start: match.index, end: match.index + match[0].length, text: match[0] })
    match = re.exec(source)
  }
  return out
}

/** How many blanks a list of sections still holds (titles and texts, like the server's check). */
export function placeholderCount(sections) {
  return (sections || []).reduce(
    (total, section) => total + findPlaceholders(section.title).length + findPlaceholders(section.text).length, 0,
  )
}

/** The first blank in `text` that starts at or after `fromIndex`, wrapping to the first one; null when there is none. */
export function nextPlaceholder(text, fromIndex = 0) {
  const all = findPlaceholders(text)
  if (!all.length) return null
  return all.find((blank) => blank.start >= fromIndex) || all[0]
}

/** One line of `text` for a collapsed section header: whitespace collapsed, cut at `max` characters with an ellipsis. */
export function sectionPreview(text, max = 110) {
  const flat = String(text ?? '').split(/\s+/).filter(Boolean).join(' ')
  const chars = [...flat]
  return chars.length > max ? `${chars.slice(0, max - 1).join('').trimEnd()}…` : flat
}

// ── Money ─────────────────────────────────────────────────────────────

/** "USD 1,500.00"; a fee of 0 with payment terms reads "See payment terms"; a fee of 0 without them reads a dash. */
export function moneyLabel(fee, currency, paymentTerms = '') {
  const parsed = parseDecimal(fee)
  if (parsed && parsed.int === 0n) return String(paymentTerms ?? '').trim() ? PUBLIC_COPY.doc.seeTerms : '—'
  return formatProposalMoney(fee, currency || 'USD')
}

export function feeIsPositive(fee) {
  const parsed = parseDecimal(fee)
  return Boolean(parsed && parsed.int > 0n)
}

// ── Names ─────────────────────────────────────────────────────────────

// What Python's str.split() treats as whitespace (str.isspace). JavaScript's \s differs from it (it also matches U+FEFF,
// which Python does not), and the server collapses runs of this exact set, so the check below uses it explicitly.
const PY_WHITESPACE = '\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000'
const WHITESPACE_RUN = new RegExp(`[${PY_WHITESPACE}]+`)
// eslint-disable-next-line no-control-regex
const CONTROL_EXCEPT_NEWLINE = /[\x00-\x09\x0b-\x1f\x7f]/g

/** The server's normalise_text: CR and CRLF become LF, control characters other than newline go, then trim. */
export function normaliseText(raw) {
  const text = String(raw ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(CONTROL_EXCEPT_NEWLINE, '')
  return text.replace(new RegExp(`^[${PY_WHITESPACE}]+|[${PY_WHITESPACE}]+$`, 'g'), '')
}

/** The server's normalise_line: normalise_text, then every run of whitespace becomes one space. */
export function normaliseName(raw) {
  return normaliseText(raw).split(WHITESPACE_RUN).filter(Boolean).join(' ')
}

export function normaliseReason(raw) {
  return normaliseText(raw)
}

/**
 * Is `raw` a name the server would accept? { ok, message }. ADVISORY and one-directional: it must accept every name
 * the server accepts (a generated oracle, signer-name-cases.json, pins that); it may accept a name the server later
 * refuses, and the server's own sentence is then shown. Rule, as the server's clean_signer_name: normalise, then not
 * empty, 2 to 120 code points, at least one letter.
 */
export function checkSignerName(raw) {
  const name = normaliseName(raw)
  if (!name) return { ok: false, message: PUBLIC_COPY.nameRequired }
  const length = charCount(name)
  if (length < CONTRACT_LIMITS.NAME_MIN || length > CONTRACT_LIMITS.NAME_MAX) return { ok: false, message: PUBLIC_COPY.nameLength }
  if (!/\p{L}/u.test(name)) return { ok: false, message: PUBLIC_COPY.nameNeedsLetters }
  return { ok: true, message: null }
}

// ── The editor form ───────────────────────────────────────────────────

export function emptyForm(defaults = {}) {
  return {
    title: '', client: null, client_name: '', client_email: '', client_company: '', currency: 'USD', fee_amount: '0',
    payment_terms: '', start_date: '', end_date: '', valid_until: '', sections: [], ...defaults,
  }
}

/** A server detail -> the editor's form (sections get local keys). */
export function formFromDetail(detail) {
  return {
    title: detail.title ?? '',
    client: detail.client || null,
    client_name: detail.client_name ?? '',
    client_email: detail.client_email ?? '',
    client_company: detail.client_company ?? '',
    currency: detail.currency || 'USD',
    fee_amount: detail.fee_amount ?? '0',
    payment_terms: detail.payment_terms ?? '',
    start_date: detail.start_date || '',
    end_date: detail.end_date || '',
    valid_until: detail.valid_until || '',
    sections: withKeys(detail.sections),
  }
}

// The fields autosave may send. Never `template_key` (the server refuses it), `proposal`, `invoice` or the local
// section `key`; read-only values (id, status, number, timestamps...) are not in this list and so can never be sent.
export const SAVE_KEYS = [
  'title', 'client', 'client_name', 'client_email', 'client_company', 'currency', 'fee_amount', 'payment_terms',
  'start_date', 'end_date', 'valid_until', 'sections',
]

/**
 * Form -> the normalised value of every savable field. Normalisation is what makes "did this change?" mean what the
 * person means by it: decimals compare by value, a blank date is null. This is also the shape the autosave snapshot is
 * kept in ("what was sent"), so it is total: it never throws, whatever has been typed. A blank section is KEPT (an
 * empty section is allowed in a draft; sending refuses it).
 */
export function buildSavePayload(form) {
  return {
    title: form.title,
    client: form.client || null,
    client_name: form.client_name,
    client_email: String(form.client_email ?? '').trim(),
    client_company: form.client_company,
    currency: form.currency,
    fee_amount: canonDecimal(form.fee_amount) || '0',
    payment_terms: form.payment_terms,
    start_date: form.start_date || null,
    end_date: form.end_date || null,
    valid_until: form.valid_until || null,
    sections: stripKeys(form.sections),
  }
}

const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/**
 * Which fields differ between the current form and the last-saved snapshot. Fields with a client-side validation error
 * or that the server already refused at this exact value are WITHHELD (reported, not sent); every other changed field
 * still goes. `sections` is sent whole or not at all, because the server replaces the list wholesale.
 */
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

// ── Validation (a client-side mirror of ContractUpdateSerializer) ─────

function tooLong(value, max) {
  const count = charCount(value)
  return count > max ? `Too long — ${count} of ${max} characters.` : null
}

function feeProblem(value) {
  const text = String(value ?? '').trim()
  if (!text) return null // blank is sent as 0
  const parsed = parseDecimal(text)
  if (!parsed) return 'Enter a valid number.'
  if (parsed.scale > 2) return 'Use at most 2 decimal places.'
  const cents = parsed.int * 10n ** BigInt(2 - parsed.scale)
  if (cents > MAX_AMOUNT_CENTS) return `The fee is too large (the maximum is ${CONTRACT_LIMITS.MAX_AMOUNT}).`
  return null
}

/**
 * { errors, savable }. `errors` is keyed by SAVE_KEYS field; `sections` holds { rows: { [rowKey]: {title?, text?} },
 * list?: message }. `lastSaved` lets an old draft whose sign-by date has since passed keep being edited: the date is
 * only refused when it is new or changed, exactly like ContractUpdateSerializer.validate_valid_until.
 */
export function validateForm(form, lastSaved, today = todayInPlatformTimezone()) {
  const errors = {}

  if (!String(form.title ?? '').trim()) errors.title = 'Give the contract a title.'
  else if (tooLong(form.title, CONTRACT_LIMITS.TITLE_MAX)) errors.title = tooLong(form.title, CONTRACT_LIMITS.TITLE_MAX)

  const nameProblem = tooLong(form.client_name, CLIENT_NAME_MAX)
  if (nameProblem) errors.client_name = nameProblem
  const companyProblem = tooLong(form.client_company, CLIENT_COMPANY_MAX)
  if (companyProblem) errors.client_company = companyProblem
  const email = String(form.client_email ?? '').trim()
  if (email && (!EMAIL_RE.test(email) || charCount(email) > CLIENT_EMAIL_MAX)) errors.client_email = 'Enter a valid email address.'

  if (!/^[A-Za-z]{3}$/.test(form.currency || '')) errors.currency = 'Choose a currency.'

  const fee = feeProblem(form.fee_amount)
  if (fee) errors.fee_amount = fee

  const termsProblem = tooLong(form.payment_terms, CONTRACT_LIMITS.PAYMENT_TERMS_MAX)
  if (termsProblem) errors.payment_terms = termsProblem

  for (const key of ['start_date', 'end_date']) {
    if (form[key] && !isRealDate(form[key])) errors[key] = 'Enter a valid date.'
  }
  if (!errors.start_date && !errors.end_date && form.start_date && form.end_date && form.end_date < form.start_date) {
    errors.end_date = 'The end date cannot be before the start date.'
  }
  if (form.valid_until) {
    if (!isRealDate(form.valid_until)) errors.valid_until = 'Enter a valid date.'
    else if (form.valid_until < today && form.valid_until !== (lastSaved?.valid_until ?? null)) {
      errors.valid_until = 'The sign-by date cannot be in the past.'
    }
  }

  const rows = {}
  let totalText = 0
  for (const section of form.sections || []) {
    const rowErrors = {}
    const titleProblem = tooLong(section.title, CONTRACT_LIMITS.SECTION_TITLE_MAX)
    if (titleProblem) rowErrors.title = titleProblem
    const textProblem = tooLong(section.text, CONTRACT_LIMITS.SECTION_TEXT_MAX)
    if (textProblem) rowErrors.text = textProblem
    totalText += charCount(section.text)
    if (Object.keys(rowErrors).length) rows[section.key] = rowErrors
  }
  const sectionsError = {}
  if (Object.keys(rows).length) sectionsError.rows = rows
  if ((form.sections || []).length > CONTRACT_LIMITS.SECTION_MAX) {
    sectionsError.list = `A contract can have at most ${CONTRACT_LIMITS.SECTION_MAX} sections.`
  } else if (totalText > CONTRACT_LIMITS.TOTAL_TEXT_MAX) {
    sectionsError.list = `The sections are too long together (the limit is ${CONTRACT_LIMITS.TOTAL_TEXT_MAX.toLocaleString('en')} characters).`
  }
  if (sectionsError.rows || sectionsError.list) errors.sections = sectionsError

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

/** Flat `error` first, else the first field message DRF produced, else `fallback`; a bare throttle answer gets our sentence. */
export function errorMessage(error, fallback = 'Something went wrong. Please try again.') {
  const result = proposalErrorMessage(error, fallback)
  const data = error?.response?.data
  const hasOwnSentence = data && typeof data === 'object' && typeof data.error === 'string' && data.error
  if (result.status === 429 && !hasOwnSentence) return { ...result, message: 'Too many actions. Please try again later.' }
  return result
}

/** A 400 body -> { field: message } for the fields the server named. A list field's row errors collapse to "Section N: …". */
export function fieldErrorsFromResponse(data) {
  const out = {}
  if (!data || typeof data !== 'object') return out
  for (const [key, value] of Object.entries(data)) {
    if (key === 'error' || key === 'reason' || key === 'detail') continue
    if (Array.isArray(value) && value.some((entry) => entry && typeof entry === 'object' && !Array.isArray(entry))) {
      const index = value.findIndex((entry) => entry && typeof entry === 'object' && Object.keys(entry).length)
      const message = firstMessage(value[index])
      if (message) out[key] = `Section ${index + 1}: ${message}`
      continue
    }
    const message = firstMessage(value)
    if (message) out[key] = message
  }
  return out
}

// ── The document model ────────────────────────────────────────────────
//
// ContractDocument renders ONE shape, the public API's payload, for three worlds: the client's page (the payload
// itself), the owner's view of a sent or answered contract (built from the detail) and the owner's draft preview (built
// from the form). So what the owner previews is, by construction, what the client reads. A field the source does not
// have is left empty, never invented.

function senderFrom(detail, sender) {
  if (sender && sender.name) return { name: sender.name, logo_url: sender.logo_url || '' }
  const freelancer = detail?.parties?.freelancer || {}
  return { name: freelancer.business_name || freelancer.name || '', logo_url: '' }
}

function stateOf(detail) {
  if (detail.status === 'sent' || detail.status === 'viewed') return detail.is_expired ? 'expired' : 'open'
  return detail.status
}

/**
 * @param {object} args
 * @param {'public'|'detail'|'form'} args.kind
 * @param {object} args.source - the public payload / the owner detail / the editor form
 * @param {object} [args.detail] - for 'form': the draft's detail (its live `parties.freelancer` and number)
 * @param {{name: string, logo_url?: string}} [args.sender] - the sender's display name and logo
 */
export function toDocumentModel({ kind, source, detail, sender }) {
  if (kind === 'public') return source
  if (kind === 'form') {
    const payload = buildSavePayload(source)
    return {
      state: 'draft', can_respond: false, preview: true,
      title: payload.title, contract_number: detail?.contract_number || '', currency: payload.currency,
      fee_amount: payload.fee_amount, payment_terms: payload.payment_terms, start_date: payload.start_date,
      end_date: payload.end_date, valid_until: payload.valid_until, sent_at: null, sections: payload.sections,
      parties: {
        freelancer: detail?.parties?.freelancer || {},
        client: { name: payload.client_name, company: payload.client_company },
      },
      owner_signature: null, client_signature: null, declined_at: null, response_message: '', content_hash: '',
      sender: senderFrom(detail, sender),
    }
  }
  return {
    state: stateOf(source), can_respond: false, preview: true,
    title: source.title, contract_number: source.contract_number || '', currency: source.currency,
    fee_amount: source.fee_amount, payment_terms: source.payment_terms || '', start_date: source.start_date || null,
    end_date: source.end_date || null, valid_until: source.valid_until || null, sent_at: source.sent_at || null,
    sections: (source.sections || []).map((s) => ({ id: s.id, title: s.title, text: s.text })),
    parties: source.parties || { freelancer: {}, client: {} },
    owner_signature: source.owner_signed_name ? { name: source.owner_signed_name, signed_at: source.owner_signed_at } : null,
    client_signature: source.status === 'signed' ? { name: source.signed_name, signed_at: source.responded_at } : null,
    declined_at: source.status === 'declined' ? source.responded_at : null,
    response_message: source.response_message || '',
    content_hash: source.content_hash || '',
    sender: senderFrom(source, sender),
  }
}
