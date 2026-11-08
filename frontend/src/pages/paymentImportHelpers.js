// src/pages/paymentImportHelpers.js
//
// Pure logic for the payment import dialog (Prompt 13) — no React, no network. Everything that decides what a status,
// sentence, total, selection or request body looks like lives here so a test can pin it down without rendering.
//
// The server (apps/payments/importing/) is stateless and authoritative: this file mirrors its rules only to give the
// person an answer before a request is spent (20 checks an hour), never instead of the server's own answer.
//
// Money rule (STANDARDS.md): amounts are strings from the API and ALL arithmetic is integer cents (toCents /
// centsToAmount / formatExact from paymentsHelpers). API dates are plain calendar strings and never go through `new Date()`.
import {
  NETWORK_MESSAGE, centsToAmount, formatExact, formatIsoDate, originPhrase, sourceLabel, toCents,
} from './paymentsHelpers'

export const IMPORT_MAX_BYTES = 2 * 1024 * 1024
export const ROWS_PER_VIEW = 50
export const STEP = { FILE: 'file', COLUMNS: 'columns', REVIEW: 'review', DONE: 'done' }

export const STEP_TITLES = {
  [STEP.FILE]: 'Import payments',
  [STEP.COLUMNS]: 'Check the columns',
  [STEP.REVIEW]: 'Review before importing',
  [STEP.DONE]: 'Import finished',
}

export const PLAN_CHANGED_NOTICE = 'Your payments changed while you were reviewing, so I checked the file again. Please review the rows once more.'

// ── The file ──────────────────────────────────────────────────────────────────────────────────────────────────────
export function validateFile(file) {
  if (!file || file.size === 0) return { ok: false, message: 'The file is empty.' }
  const name = String(file.name || '').toLowerCase()
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    return { ok: false, message: 'That looks like an Excel file. In Excel choose File, Save as, CSV, then upload that.' }
  }
  if (name.endsWith('.pdf')) return { ok: false, message: 'That is a PDF. Download the CSV version of your statement instead.' }
  if (!name.endsWith('.csv') && !name.endsWith('.txt')) return { ok: false, message: 'Upload a .csv file.' }
  if (file.size > IMPORT_MAX_BYTES) return { ok: false, message: 'This file is larger than 2 MB. Split it by year and import each part.' }
  return { ok: true }
}

export function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// The multipart body for both upload calls. `mapping` is sent exactly as given (the server's own object after a
// preview); `include_rows` is sent as the ascending integer array.
export function buildUploadForm({ file, source, mapping, fingerprint, includeRows } = {}) {
  const form = new FormData()
  form.append('file', file)
  form.append('source', source)
  if (mapping !== undefined && mapping !== null) form.append('mapping', JSON.stringify(mapping))
  if (fingerprint) form.append('plan_fingerprint', fingerprint)
  if (Array.isArray(includeRows)) form.append('include_rows', JSON.stringify(includeRows))
  return form
}

// ── Statuses and filters ──────────────────────────────────────────────────────────────────────────────────────────
const STATUS_ORDER = ['new', 'unsure', 'duplicate_probable', 'duplicate_exact', 'not_income', 'invalid']

const STATUS_VIEWS = {
  new: { label: 'Ready', badge: 'green' },
  unsure: { label: 'Check', badge: 'amber' },
  duplicate_probable: { label: 'May already be there', badge: 'amber' },
  duplicate_exact: { label: 'Already imported', badge: 'gray' },
  not_income: { label: 'Not income', badge: 'gray' },
  invalid: { label: "Can't read", badge: 'red' },
}

export function statusView(status) {
  return STATUS_VIEWS[status] || { label: 'Other', badge: 'gray' }
}

export const FILTERS = [
  { key: 'all', label: 'All' },
  ...STATUS_ORDER.map((key) => ({ key, label: STATUS_VIEWS[key].label })),
]

export function filterCounts(rows) {
  const counts = { all: 0 }
  for (const key of STATUS_ORDER) counts[key] = 0
  for (const row of rows || []) {
    counts.all += 1
    if (row.status in counts) counts[row.status] += 1
  }
  return counts
}

export function filterRows(rows, filter) {
  const list = rows || []
  return filter && filter !== 'all' ? list.filter((row) => row.status === filter) : list
}

export function visibleRows(rows, filter, shown) {
  return filterRows(rows, filter).slice(0, shown)
}

// ── Selection ─────────────────────────────────────────────────────────────────────────────────────────────────────
// A Set of row numbers, always REPLACED, never mutated. A row that is not selectable can never be in it.
function selectableNumbers(rows) {
  return new Set((rows || []).filter((row) => row.selectable).map((row) => row.row))
}

export function initialSelection(rows) {
  return new Set((rows || []).filter((row) => row.selected && row.selectable).map((row) => row.row))
}

export function toggleRow(selection, rows, number) {
  const next = new Set(selection)
  const row = (rows || []).find((item) => item.row === number)
  if (!row || !row.selectable) return next
  if (next.has(number)) next.delete(number)
  else next.add(number)
  return next
}

export function selectAllReady(rows) {
  return new Set((rows || []).filter((row) => row.status === 'new' && row.selectable).map((row) => row.row))
}

export function clearSelection() {
  return new Set()
}

// Ascending integers. When `rows` is given, anything that is not a selectable row of the file is dropped (a belt on
// top of toggleRow: a stray number in the Set still never reaches the server).
export function includeRows(selection, rows) {
  const allowed = rows ? selectableNumbers(rows) : null
  return [...selection].filter((n) => Number.isInteger(n) && (!allowed || allowed.has(n))).sort((a, b) => a - b)
}

function ticked(rows, selection) {
  return (rows || []).filter((row) => row.selectable && selection.has(row.row))
}

export function selectionTotals(rows, selection) {
  const cents = new Map()
  for (const row of ticked(rows, selection)) {
    if (row.amount === null || row.amount === undefined) continue
    cents.set(row.currency, (cents.get(row.currency) || 0) + toCents(row.amount))
  }
  return [...cents.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([currency, total]) => ({ currency, cents: total, text: formatExact(centsToAmount(total), currency) }))
}

export function selectionNotes(rows, selection) {
  const chosen = ticked(rows, selection)
  const probable = chosen.filter((row) => row.status === 'duplicate_probable').length
  const unsure = chosen.filter((row) => row.status === 'unsure').length
  const notes = []
  if (probable === 1) notes.push('1 selected row looks like a payment you already have. Import it only if it is a different payment.')
  else if (probable > 1) notes.push(`${probable} selected rows look like payments you already have. Import them only if they are different payments.`)
  if (unsure === 1) notes.push('1 selected row is one I was not sure about.')
  else if (unsure > 1) notes.push(`${unsure} selected rows are ones I was not sure about.`)
  return notes
}

export function anySelectable(rows) {
  return (rows || []).some((row) => row.selectable)
}

// ── Sentences ─────────────────────────────────────────────────────────────────────────────────────────────────────
export function describeMatch(match) {
  let text = `${formatExact(match.amount, match.currency)} on ${formatIsoDate(match.payment_date)}, ${sourceLabel(match.source)} (${originPhrase(match.origin)})`
  const invoice = (match.invoices || [])[0]
  if (invoice?.invoice_number) text += `; invoice ${invoice.invoice_number}`
  if (match.imported_from?.file_name) text += `; from file "${match.imported_from.file_name}"`
  return text
}

const REASON_SENTENCES = {
  no_date: 'I could not tell which column has the date.',
  no_amount: 'I could not tell which column has the amount.',
  no_currency: 'I could not tell which column has the currency. You can also choose one currency for every row.',
  ambiguous_columns: 'Some column names could mean more than one thing. Please check them.',
  date_format_ambiguous: 'Dates like 05/10/2026 can be read two ways. Choose which comes first.',
}

export function reasonSentence(code) {
  return REASON_SENTENCES[code] || 'Please check the columns.'
}

const ORIGIN_LINES = {
  wise_preset: 'Recognised as a Wise statement.',
  previous_import: 'Using the columns you chose last time for this kind of file.',
  provided: 'Using the columns you chose.',
  detected: 'Columns matched by their names.',
}

export function originLine(plan) {
  return ORIGIN_LINES[plan?.mapping_origin] || ORIGIN_LINES.detected
}

const MAPPING_ROLES = [
  ['date', 'Date'], ['amount', 'Amount'], ['credit', 'Money in'], ['debit', 'Money out'], ['currency', 'Currency'],
  ['counterparty', 'Received from'], ['description', 'Description'], ['notes', 'Notes'],
  ['external_id', 'Transaction ID'], ['status', 'Status'],
]

export function mappingSummary(mapping) {
  const list = []
  for (const [role, label] of MAPPING_ROLES) {
    if (mapping?.[role]) list.push({ role, label, column: mapping[role] })
  }
  if (mapping?.fixed_currency) list.push({ role: 'fixed_currency', label: 'Currency', column: `${mapping.fixed_currency} for every row` })
  return list
}

export function wiseMismatch(plan, source) {
  return plan?.suggested_source === 'wise' && source !== 'wise'
}

function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`
}

export function batchLines(batch) {
  const lines = [`Imported ${plural(batch.imported, 'payment', 'payments')}.`]
  if (batch.skipped_duplicate > 0) lines.push(`${batch.skipped_duplicate} already in your payments, skipped.`)
  if (batch.skipped_not_income > 0) {
    lines.push(`${batch.skipped_not_income} ${batch.skipped_not_income === 1 ? 'was' : 'were'} not income (conversions, fees, money you sent), skipped.`)
  }
  if (batch.skipped_invalid > 0) lines.push(`${batch.skipped_invalid} could not be read, skipped.`)
  if (batch.skipped_unselected > 0) lines.push(`${batch.skipped_unselected} you left unticked, skipped.`)
  return lines
}

export function undoResultText({ removed, kept }) {
  let text = `Removed ${plural(removed, 'payment', 'payments')}.`
  if (kept > 0) {
    text += ` ${plural(kept, 'payment', 'payments')} linked to an invoice ${kept === 1 ? 'was' : 'were'} kept. Unlink ${kept === 1 ? 'it' : 'them'} from ${kept === 1 ? 'its' : 'their'} invoice, then undo again to remove ${kept === 1 ? 'it' : 'them'}.`
  }
  return text
}

export function undoConfirmText(count) {
  return `Undo this import? The ${plural(count, 'payment', 'payments')} it added will be removed, including any you changed since. A payment linked to an invoice is kept. This cannot be undone.`
}

export function importedSummaryText(batch) {
  return `Imported ${plural(batch.imported, 'payment', 'payments')}.`
}

// The payment side panel: where an imported payment came from.
export function importedFromRows(payment) {
  const rows = []
  if (payment?.imported_from) {
    rows.push({ label: 'Imported from', value: `${payment.imported_from.file_name} on ${formatIsoDate(payment.imported_from.imported_at)}` })
  }
  if (payment?.external_id) rows.push({ label: 'Transaction ID', value: payment.external_id })
  return rows
}

// ── Errors ────────────────────────────────────────────────────────────────────────────────────────────────────────
export const COMMIT_NETWORK_MESSAGE = 'We could not confirm the import because the connection dropped. Press Import again: if it already went through, those rows will show as Already imported.'
export const IMPORT_RATE_LIMIT_MESSAGE = 'You have checked or imported a lot of files in the last hour. Please wait a while and try again.'

export function importErrorMessage(error, { commit = false } = {}) {
  const response = error?.response
  if (!response) return commit ? COMMIT_NETWORK_MESSAGE : NETWORK_MESSAGE
  // Checked BEFORE the body: a 429's body is the generic throttle sentence, not ours.
  if (response.status === 429) return IMPORT_RATE_LIMIT_MESSAGE
  if (response.status === 415) return 'The upload was not understood. Reload the page and try again.'
  const body = response.data
  if (body && typeof body === 'object' && typeof body.error === 'string' && body.error) return body.error
  return 'Something went wrong. Please try again.'
}

export function importErrorCode(error) {
  const code = error?.response?.data?.code
  return typeof code === 'string' ? code : ''
}

export function isPlanConflict(error) {
  const response = error?.response
  return response?.status === 409 && ['plan_changed', 'already_imported'].includes(response?.data?.code)
}

// ── The columns form ──────────────────────────────────────────────────────────────────────────────────────────────
export const DATE_FORMAT_OPTIONS = [
  { value: 'auto', label: 'Work it out' },
  { value: 'ymd', label: 'Year first, like 2026-11-08' },
  { value: 'dmy', label: 'Day first, like 08/11/2026' },
  { value: 'mdy', label: 'Month first, like 11/08/2026' },
]

export const AMOUNT_MODE_OPTIONS = [
  { value: 'signed', label: 'One amount column (money out is negative)' },
  { value: 'separate', label: 'Separate money-in and money-out columns' },
  { value: 'all_income', label: 'Every row is money I received' },
]

export const DECIMAL_OPTIONS = [
  { value: '.', label: '1,234.56 (dot for decimals)' },
  { value: ',', label: '1.234,56 (comma for decimals)' },
]

const DRAFT_COLUMNS = [
  ['date', 'date'], ['amount', 'amount'], ['credit', 'credit'], ['debit', 'debit'], ['currency', 'currency'],
  ['counterparty', 'counterparty'], ['description', 'description'], ['notes', 'notes'],
  ['externalId', 'external_id'], ['status', 'status'],
]

export function mappingToDraft(mapping, fallbackCurrency = '') {
  const m = mapping || {}
  const draft = {
    headerRow: m.header_row ? String(m.header_row) : '',
    dateFormat: m.date_format || 'auto',
    amountMode: m.amount_mode || 'signed',
    decimalSeparator: m.decimal_separator || '.',
    currencyMode: m.fixed_currency && !m.currency ? 'fixed' : 'column',
    fixedCurrency: m.fixed_currency || fallbackCurrency || '',
  }
  for (const [key, serverKey] of DRAFT_COLUMNS) draft[key] = m[serverKey] || ''
  return draft
}

// EXACTLY the server's 15 keys. The unused side of the amount layout and of the currency choice is null, because the
// server refuses "both a currency column and a fixed currency".
export function draftToMapping(draft) {
  const text = (value) => (String(value ?? '').trim() === '' ? null : String(value).trim())
  const headerRow = text(draft.headerRow)
  const separate = draft.amountMode === 'separate'
  const fixed = draft.currencyMode === 'fixed'
  return {
    header_row: headerRow === null ? null : Number(headerRow),
    date: text(draft.date),
    date_format: draft.dateFormat || 'auto',
    amount_mode: draft.amountMode || 'signed',
    amount: separate ? null : text(draft.amount),
    credit: separate ? text(draft.credit) : null,
    debit: separate ? text(draft.debit) : null,
    decimal_separator: draft.decimalSeparator || '.',
    currency: fixed ? null : text(draft.currency),
    fixed_currency: fixed ? text(draft.fixedCurrency) : null,
    counterparty: text(draft.counterparty),
    description: text(draft.description),
    notes: text(draft.notes),
    external_id: text(draft.externalId),
    status: text(draft.status),
  }
}

// `headers` null/undefined skips the "is this a real column" check (used while the header row is being changed, when
// the current list of headers no longer describes the file).
export function validateMappingDraft(draft, headers) {
  const errors = {}
  const known = headers ? new Set(headers) : null
  const check = (field, value, message) => {
    if (!value) { errors[field] = message; return }
    if (known && !known.has(value)) errors[field] = 'That column is not in the file.'
  }
  check('date', draft.date, 'Choose the date column.')
  if (draft.amountMode === 'separate') check('credit', draft.credit, 'Choose the money-in column.')
  else check('amount', draft.amount, 'Choose the amount column.')
  if (draft.amountMode === 'separate' && draft.debit && known && !known.has(draft.debit)) errors.debit = 'That column is not in the file.'
  if (draft.currencyMode === 'fixed') {
    if (!/^[A-Za-z]{3}$/.test(String(draft.fixedCurrency || '').trim())) errors.fixedCurrency = 'Choose a currency.'
  } else {
    check('currency', draft.currency, 'Choose the currency column.')
  }
  for (const field of ['counterparty', 'description', 'notes', 'externalId', 'status']) {
    if (draft[field] && known && !known.has(draft[field])) errors[field] = 'That column is not in the file.'
  }
  const headerRow = String(draft.headerRow ?? '').trim()
  if (headerRow !== '' && !(/^\d{1,2}$/.test(headerRow) && Number(headerRow) >= 1 && Number(headerRow) <= 20)) {
    errors.headerRow = 'Enter a line number from 1 to 20.'
  }
  return { ok: Object.keys(errors).length === 0, errors }
}

export function columnsPreview(plan) {
  if (!plan) return null
  if ((plan.sample_rows || []).length > 0) return { kind: 'raw', headers: plan.headers || [], rows: plan.sample_rows }
  if ((plan.rows || []).length > 0) {
    return {
      kind: 'read',
      rows: plan.rows.slice(0, 3).map((row) => ({
        date: formatIsoDate(row.payment_date),
        amount: row.amount === null || row.amount === undefined ? '—' : formatExact(row.amount, row.currency),
        currency: row.currency || '—',
        counterparty: row.counterparty || '—',
      })),
    }
  }
  return null
}

export function rowAccessibleName(row) {
  const who = row.counterparty || 'no name'
  const amount = row.amount === null || row.amount === undefined ? 'no amount' : formatExact(row.amount, row.currency)
  return row.selectable ? `Import row ${row.row}: ${who}, ${amount}` : `Cannot import row ${row.row}: ${who}, ${amount}`
}
