// src/pages/proposalLifecycle.js
//
// Pure logic for what happens to a proposal AFTER it is a draft (Proposals
// frontend part B) — no JSX, no network. What each status lets the freelancer
// do, the activity timeline, the pre-send checklist, how a failed Send is
// classified, and the shape the shared ProposalDocument renders.
//
// Every rule here mirrors the backend and is pinned to it by a test: the
// action table to the HTTP statuses the real endpoints answer, the pre-send
// checklist to `_send_content_problem` (360 cases generated from the real
// function, src/test-fixtures/proposals/).
import { todayInPlatformTimezone } from './invoiceHelpers'
import {
  EMAIL_RE, buildSavePayload, computeProposalTotals, formatDate, formatProposalMoney,
} from './proposalHelpers'

// ── Send verification window (decision D2) ────────────────────────────
// The send endpoint can hold the request for ~25 s (custom SMTP 15 s, then the
// Resend fallback 10 s). One window = that worst case plus margin.
export const SEND_TIMEOUT_MS = 45000
export const VERIFY_INTERVAL_MS = 4000
export const VERIFY_WINDOW_MS = 36000

// ── Actions per status ────────────────────────────────────────────────

const DANGEROUS = new Set(['withdraw', 'delete'])

function entry(key, placement) {
  return DANGEROUS.has(key) ? { key, placement, danger: true } : { key, placement }
}

/**
 * The actions the header offers for a proposal, in display order.
 * placement: 'primary' (one accent button) | 'secondary' (ghost) | 'menu'
 * (inside "More actions"). Never offers an action the backend refuses — see
 * LIFECYCLE in proposalLifecycle.test.js.
 */
export function availableActions(detail) {
  const { status } = detail
  if (status === 'draft') {
    return [entry('send', 'primary'), entry('preview', 'secondary'), entry('duplicate', 'menu'), entry('delete', 'menu')]
  }
  if (status === 'sent' || status === 'viewed') {
    return [entry('copy_link', 'secondary'), entry('preview', 'menu'), entry('duplicate', 'menu'), entry('withdraw', 'menu')]
  }
  if (status === 'accepted') {
    return [
      detail.converted_invoice ? entry('open_invoice', 'primary') : entry('convert', 'primary'),
      entry('create_contract', 'secondary'), entry('copy_link', 'secondary'), entry('preview', 'menu'), entry('duplicate', 'menu'),
    ]
  }
  // declined, withdrawn
  return [entry('duplicate', 'primary'), entry('copy_link', 'menu'), entry('preview', 'menu')]
}

// ── Timeline ──────────────────────────────────────────────────────────

/**
 * The activity list for a proposal: [{ key, label, at, atKind, tone }].
 * atKind is 'timestamp' (naive Pakistan time, formatTimestamp), 'date'
 * (formatDate) or null (no time known — the backend stores none for the
 * invoice, so none is invented).
 */
export function buildTimeline(detail) {
  const out = []
  out.push({ key: 'created', label: 'Created', at: detail.created_at, atKind: 'timestamp', tone: 'neutral' })
  if (detail.sent_at) {
    out.push({
      key: 'sent', label: detail.sent_via === 'email' ? 'Sent by email' : 'Link created',
      at: detail.sent_at, atKind: 'timestamp', tone: 'neutral',
    })
  }
  if (detail.viewed_at) {
    out.push({ key: 'viewed', label: 'Opened by your client', at: detail.viewed_at, atKind: 'timestamp', tone: 'neutral' })
  }
  if (detail.status === 'accepted') {
    out.push({ key: 'answered', label: 'Accepted by your client', at: detail.responded_at, atKind: 'timestamp', tone: 'positive' })
  } else if (detail.status === 'declined') {
    out.push({ key: 'answered', label: 'Declined by your client', at: detail.responded_at, atKind: 'timestamp', tone: 'negative' })
  }
  if (detail.status === 'withdrawn' || detail.withdrawn_at) {
    out.push({ key: 'withdrawn', label: 'Withdrawn by you', at: detail.withdrawn_at, atKind: 'timestamp', tone: 'neutral' })
  }
  if (detail.converted_invoice) {
    out.push({ key: 'invoiced', label: 'Invoice created', at: null, atKind: null, tone: 'positive' })
  }
  if (detail.is_expired) {
    out.push({ key: 'expired', label: 'Expired', at: detail.valid_until, atKind: 'date', tone: 'warning' })
  }
  return out
}

// ── Pre-flight ────────────────────────────────────────────────────────

/**
 * The checklist the Send dialog shows, mirroring the server's
 * `_send_content_problem` (the server stays the authority). `snapshot` is a
 * SAVE payload (buildSavePayload's shape) — what the server holds after the
 * flush. `today` is a YYYY-MM-DD Pakistan date.
 *
 * Returns { checks, warnings, canSend }. The first failing blocking check is
 * the one the server would report; the client is never stricter than the
 * server (the one allowed divergence is documented in the test).
 */
export function preflightSend({ snapshot, method, today = todayInPlatformTimezone(), quality, aiGenerated }) {
  const checks = []

  const bodyOk = Boolean(String(snapshot.body ?? '').trim())
  checks.push({
    id: 'body', ok: bodyOk, blocking: true, problem: bodyOk ? null : 'body', field: 'body',
    message: bodyOk ? 'Proposal text is written.' : 'Write or generate the proposal text before sending.',
  })

  const validUntil = snapshot.valid_until || null
  let validProblem = null
  if (!validUntil) validProblem = 'valid_until_missing'
  else if (validUntil < today) validProblem = 'valid_until_past'
  checks.push({
    id: 'valid_until', ok: !validProblem, blocking: true, problem: validProblem, field: 'valid_until',
    message: validProblem === 'valid_until_missing' ? 'Set a valid-until date before sending.'
      : validProblem === 'valid_until_past' ? 'The valid-until date has passed. Choose a future date.'
        : `Valid until ${formatDate(validUntil)}.`,
  })

  const email = String(snapshot.client_email ?? '').trim()
  if (method === 'email') {
    const emailOk = EMAIL_RE.test(email)
    checks.push({
      id: 'client_email', ok: emailOk, blocking: true, problem: emailOk ? null : 'client_email', field: 'client_email',
      message: emailOk ? `Client email: ${email}.` : "Add your client's email address to send by email, or choose to create a link instead.",
    })
  } else {
    checks.push({
      id: 'client_email', ok: true, blocking: false, problem: null, field: 'client_email',
      message: 'No email address needed for a link.',
    })
  }

  const warnings = []
  const totals = computeProposalTotals(snapshot.items, snapshot.tax_rate, snapshot.discount_amount)
  if (totals.total === '0.00') {
    warnings.push({
      id: 'no_prices',
      message: `The total is ${formatProposalMoney(0, snapshot.currency)}. Add priced items if this proposal should quote a price.`,
    })
  }
  if (aiGenerated) {
    warnings.push({ id: 'ai_draft', message: 'Part of this text was written by AI. Read all of it and make sure everything in it is true.' })
  }
  if (quality && quality.score !== undefined && quality.score !== null) {
    warnings.push({ id: 'score', message: `Quality score: ${quality.score} of ${quality.max}.` })
  }

  return { checks, warnings, canSend: checks.every((check) => check.ok || !check.blocking) }
}

// ── Classifying a failed Send (decision D2) ───────────────────────────

const AMBIGUOUS_MESSAGE = 'We lost the connection before getting an answer.'

/**
 * Did OUR application answer? Definite: the body is an object with a
 * non-empty string `error` (this includes the send view's own 502, "Could not
 * send this proposal by email … It is still a draft."). Anything else — no
 * response, a timeout, a gateway error page, a 5xx without our shape — is
 * ambiguous: the request may have been processed, so the caller must CHECK,
 * never retry.
 */
export function classifySendFailure(error) {
  const response = error?.response
  const data = response?.data
  if (data && typeof data === 'object' && !Array.isArray(data) && typeof data.error === 'string' && data.error) {
    return {
      kind: 'definite', status: response.status ?? null, message: data.error,
      reason: typeof data.reason === 'string' ? data.reason : null,
    }
  }
  return { kind: 'ambiguous', status: response?.status ?? null, message: AMBIGUOUS_MESSAGE, reason: null }
}

// ── Sender name ───────────────────────────────────────────────────────

/** Same fallback order as the backend's sender_display_name. */
export function senderNameFrom(profile, user) {
  const clean = (value) => String(value ?? '').trim()
  return clean(profile?.business_name)
    || clean(profile?.display_name)
    || `${clean(user?.first_name)} ${clean(user?.last_name)}`.trim()
    || clean(user?.username)
}

// ── The public shape ──────────────────────────────────────────────────

const PUBLIC_STATIC = {
  state: 'open', can_respond: false, preview: true, responded_at: null, response_message: '',
}

/**
 * Builds the object the public API would return, so ONE component
 * (ProposalDocument) renders both the client's page and the in-app preview.
 * kind: 'form' (the editor form, saved or not) | 'detail' (a server detail).
 */
export function toPublicShape({ source, kind, sender, number }) {
  if (kind === 'form') {
    // The save payload drops completely empty rows exactly as a save would.
    const payload = buildSavePayload(source)
    const totals = computeProposalTotals(payload.items, payload.tax_rate, payload.discount_amount)
    return {
      ...PUBLIC_STATIC,
      body: payload.body,
      client_name: payload.client_name,
      currency: payload.currency,
      discount_amount: payload.discount_amount,
      items: payload.items.map((item, index) => ({ ...item, total: totals.lines[index] })),
      payment_terms: payload.payment_terms,
      proposal_number: number || '',
      scope_sections: payload.scope_sections,
      sender,
      subtotal: totals.subtotal,
      tax_amount: totals.tax_amount,
      tax_rate: payload.tax_rate,
      title: payload.title,
      total: totals.total,
      valid_until: payload.valid_until,
    }
  }
  return {
    ...PUBLIC_STATIC,
    body: source.body || '',
    client_name: source.client_name || '',
    currency: source.currency,
    discount_amount: source.discount_amount,
    items: (source.items || []).map((item) => ({
      description: item.description, quantity: item.quantity, unit_price: item.unit_price, total: item.total,
    })),
    payment_terms: source.payment_terms || '',
    proposal_number: number ?? source.proposal_number ?? '',
    scope_sections: (source.scope_sections || []).map((s) => ({ title: s.title, text: s.text })),
    sender,
    subtotal: source.subtotal,
    tax_amount: source.tax_amount,
    tax_rate: source.tax_rate,
    title: source.title || '',
    total: source.total,
    valid_until: source.valid_until || null,
  }
}

// ── Banner after a successful send ────────────────────────────────────

/** The success line shown above the sent view. `recovered`: the answer was lost and found by checking. */
export function sentBanner(detail, method, recovered) {
  const line = method === 'email'
    ? `Sent to ${detail.client_email}. Proposal ${detail.proposal_number} is now with your client.`
    : `Link created. Proposal ${detail.proposal_number} is ready to share. Copy the link below and send it to your client.`
  return recovered ? `The connection dropped, but the proposal was sent. ${line}` : line
}
