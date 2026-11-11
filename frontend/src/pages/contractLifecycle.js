// src/pages/contractLifecycle.js
//
// Pure logic for what happens to a contract AFTER it is a draft (Prompt 23) — no JSX, no network. What each status lets
// the freelancer do, the activity timeline, how a failed Send is classified and how a send that may have gone through
// is recognised. Every rule here mirrors the backend and is pinned to it by a test: the action table to the HTTP
// statuses the real endpoints answer for each fixture.
import { OWNER_COPY } from './contractCopy'
import { normaliseName } from './contractHelpers'
import { formatDate } from './proposalHelpers'
import { SEND_TIMEOUT_MS, VERIFY_INTERVAL_MS, VERIFY_WINDOW_MS } from './proposalLifecycle'

// The same worst case as Proposals: the send can hold the request while an email goes out (custom SMTP, then the
// fallback). Imported, not retyped.
export { SEND_TIMEOUT_MS, VERIFY_INTERVAL_MS, VERIFY_WINDOW_MS }

// ── Actions per status ────────────────────────────────────────────────

const DANGEROUS = new Set(['withdraw', 'delete'])

function entry(key, placement) {
  return DANGEROUS.has(key) ? { key, placement, danger: true } : { key, placement }
}

/**
 * The actions the header offers for a contract, in display order. placement: 'primary' (one accent button) |
 * 'secondary' (ghost) | 'menu' (inside "More actions"). Never offers an action the backend refuses: see the
 * LIFECYCLE table in contractLifecycle.test.js, which replays each action against the real endpoint's answer.
 */
export function availableActions(detail) {
  const { status } = detail
  if (status === 'draft') {
    return [entry('send', 'primary'), entry('preview', 'secondary'), entry('pdf', 'menu'), entry('duplicate', 'menu'), entry('delete', 'menu')]
  }
  if (status === 'sent' || status === 'viewed') {
    return [entry('copy_link', 'secondary'), entry('preview', 'menu'), entry('pdf', 'menu'), entry('duplicate', 'menu'), entry('withdraw', 'menu')]
  }
  if (status === 'signed') {
    return [entry('pdf', 'primary'), entry('copy_link', 'menu'), entry('duplicate', 'menu')]
  }
  // declined, withdrawn
  return [entry('duplicate', 'primary'), entry('pdf', 'menu')]
}

// ── Timeline ──────────────────────────────────────────────────────────

/**
 * The activity list for a contract, oldest first: [{ key, label, at, atKind, tone }]. atKind is 'timestamp' (naive
 * Pakistan time, formatTimestampPkt) or null (the label already carries the date).
 */
export function timelineEntries(detail) {
  const t = OWNER_COPY.timeline
  const out = [{ key: 'created', label: t.created, at: detail.created_at, atKind: 'timestamp', tone: 'neutral' }]
  if (detail.owner_signed_at) {
    out.push({
      key: 'owner_signed', label: t.ownerSigned(detail.owner_signed_name), at: detail.owner_signed_at, atKind: 'timestamp', tone: 'neutral',
    })
  }
  if (detail.sent_at) {
    out.push({
      key: 'sent', label: detail.sent_via === 'email' ? t.sentEmail(detail.client_email) : t.sentLink,
      at: detail.sent_at, atKind: 'timestamp', tone: 'neutral',
    })
  }
  if (detail.viewed_at) {
    out.push({ key: 'viewed', label: t.viewed, at: detail.viewed_at, atKind: 'timestamp', tone: 'neutral' })
  }
  if (detail.status === 'signed') {
    out.push({ key: 'answered', label: t.signedBy(detail.signed_name), at: detail.responded_at, atKind: 'timestamp', tone: 'positive' })
  } else if (detail.status === 'declined') {
    out.push({ key: 'answered', label: t.declined, at: detail.responded_at, atKind: 'timestamp', tone: 'negative' })
  }
  if (detail.status === 'withdrawn' || detail.withdrawn_at) {
    out.push({ key: 'withdrawn', label: t.withdrawn, at: detail.withdrawn_at, atKind: 'timestamp', tone: 'neutral' })
  }
  if (detail.is_expired) {
    out.push({ key: 'expired', label: t.signByPassed(formatDate(detail.valid_until)), at: null, atKind: null, tone: 'warning' })
  }
  return out
}

// ── Send failures ─────────────────────────────────────────────────────

// Statuses our own application answers on this endpoint, each with a flat `error` string.
const DEFINITE_STATUSES = new Set([400, 403, 404, 409, 429, 502])

/**
 * Did OUR application answer? Definite: a response with a non-empty string `error` and a status the send view really
 * returns (this includes its own 502, "Could not send this contract by email ... It is still a draft."). Anything else
 * (no response, a timeout, a gateway error page, a 5xx without our shape) is ambiguous: the request may have been
 * processed, so the caller must CHECK, never retry.
 *
 * reason: send_problem | name | not_draft | email_failed | too_many (definite) | network | timeout | server (ambiguous).
 */
export function classifySendFailure(error) {
  const response = error?.response
  const data = response?.data
  const status = response?.status ?? null
  const message = data && typeof data === 'object' && !Array.isArray(data) && typeof data.error === 'string' ? data.error : ''
  if (response && message && DEFINITE_STATUSES.has(status)) {
    let reason = 'send_problem'
    if (status === 409) reason = 'not_draft'
    else if (status === 502) reason = 'email_failed'
    else if (status === 429) reason = 'too_many'
    else if (status === 400 && 'signer_name' in data) reason = 'name'
    else if (status === 403 || status === 404) reason = 'send_problem'
    return { kind: 'definite', reason, status, message, serverReason: typeof data.reason === 'string' ? data.reason : null }
  }
  if (!response) {
    const timedOut = error?.code === 'ECONNABORTED' || /timeout/i.test(String(error?.message ?? ''))
    return { kind: 'ambiguous', reason: timedOut ? 'timeout' : 'network', status: null, message: '', serverReason: null }
  }
  return { kind: 'ambiguous', reason: 'server', status, message: '', serverReason: null }
}

/**
 * After an ambiguous send failure the detail is re-read. It proves the send went through when the contract is no longer
 * a draft AND the freelancer's signature on it is the name that was submitted (a different name would mean someone else
 * sent it). `method`, when given, must match how it was sent.
 */
export function verifySent(detail, { signerName, method } = {}) {
  if (!detail || detail.status === 'draft') return false
  if (method && detail.sent_via && detail.sent_via !== method) return false
  return normaliseName(detail.owner_signed_name) === normaliseName(signerName)
}

// ── Banner after a successful send ────────────────────────────────────

/** The success line shown above the sent page. `recovered`: the answer was lost and found by checking. */
export function sentBanner(detail, method, recovered) {
  const line = method === 'email'
    ? OWNER_COPY.sentEmail(detail.client_email, detail.contract_number)
    : OWNER_COPY.sentLink(detail.contract_number)
  return recovered ? `${OWNER_COPY.recoveredPrefix}${line}` : line
}
