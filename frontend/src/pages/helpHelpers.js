// src/pages/helpHelpers.js
//
// Pure helpers for the Help page (/help and /help/<slug>, Prompt 26). No React, no network, no `new Date()`.
//
// THE RULE OF THIS FILE: the guides, the search results and every written answer come from the server (GET /help/guides/,
// /help/guides/<slug>/, /help/search/, POST /help/ask/, /help/rate/). The page never writes a guide sentence, never judges an
// answer and never states a rule of its own: it checks that a payload is complete enough to draw, turns it into rows, and
// supplies page chrome (labels, buttons, empty states, error sentences). Every static sentence lives here, and a test scans all
// of them (and every rendered state) against the BACKEND's own banned lists (constants.json), so a word the backend refuses
// cannot appear on this page either.
//
// PITFALLS this file exists to keep out of the components:
//   * The mode is `answers_enabled === true`, the strict boolean. Anything else (false, missing, a string, a failed index) is
//     search mode, and nothing typed in search mode is ever sent to /help/ask/.
//   * Nothing a person types is kept: no URL parameter, no storage, no history entry. A question can hold a client's name.
//   * Only 400/401/403/404/429 are HTTP errors on the server. AI off, busy or failing is a 200 `guides_only` with a notice.
//   * A link block is drawn only when its `to` is an in-app path; anything else is dropped, not shown as text.
import { formatIsoDate } from './dashboardHelpers'
import { NETWORK_MESSAGE } from './paymentsHelpers'

// ── Limits (mirrors of apps/help/constants.py; a test compares them with constants.json) ──────────────────────────
export const QUESTION_MIN_CHARS = 3
export const QUESTION_MAX_CHARS = 300
export const SEARCH_MIN_CHARS = 2
export const SEARCH_MAX_CHARS = 120
export const SEARCH_DEBOUNCE_MS = 350
// The server's AI budget for one answer is 25 s (AI_TOTAL_BUDGET_SECONDS); the shared Axios instance times out at 15 s, so the
// ask call carries its own timeout: the budget plus retrieval, the cache and the network. A test proves it exceeds the budget.
export const ASK_TIMEOUT_MS = 40000
export const RATING_GUIDE_LIMIT = 3

// ── Static copy ───────────────────────────────────────────────────────────────────────────────────────────────────
export const PAGE_LABEL = 'Help'
export const SEARCH_LABEL = 'Search the guides'
// The two placeholders are the ONLY visible hint in the box (the label is visually hidden), so they must fit at 360 px without being
// clipped. Measured in a real browser (Prompt 27, B2): the search input's text area is 270 px wide at 360 px and the ask input's 164 px
// (the Ask button sits beside it). The old wordings were 355 px and 290 px wide.
export const SEARCH_PLACEHOLDER = 'Search, e.g. "send an invoice"'
export const SEARCH_TOO_SHORT = `Type at least ${SEARCH_MIN_CHARS} letters to search.`
export const ASK_LABEL = 'Ask a question'
export const ASK_PLACEHOLDER = 'Ask a question'
export const ASK_BUTTON = 'Ask'
export const ASK_BUTTON_BUSY = 'Asking…'
export const ASK_HINT = `Ask in your own words, ${QUESTION_MIN_CHARS} to ${QUESTION_MAX_CHARS} characters.`
export const ASK_DISCLOSURE = 'Your question is sent to an outside AI service, which writes the answer from the Help guides only. Do not type passwords, card numbers or ID numbers.'
export const ASK_WORKING = 'Finding an answer…'
export const ASK_FALLBACK = "Couldn't get an answer. Please try again."
export const ASK_TIMEOUT = 'That is taking too long. Please try again in a moment.'
export const YOU_ASKED = 'You asked:'
export const ANSWER_TITLE = 'Answer'
export const ANSWER_SOURCE_NOTE = 'Written by an outside AI service from the guides below. Open a guide to check the exact steps.'
export const FROM_GUIDES = 'From these guides'
export const CLOSEST_GUIDES = 'Closest guides'
export const NOTICE_TITLE = 'About your question'
export const RATING_PROMPT = 'Was this answer helpful?'
export const RATING_YES = 'Helpful'
export const RATING_NO = 'Not helpful'
export const RATING_THANKS = 'Thanks for the feedback.'
export const RATING_FAILED = "Couldn't send your feedback. Please try again."
export const SUPPORT_LEAD = 'Still stuck? Email'
export const POPULAR_TITLE = 'Popular guides'
export const TOPICS_TITLE = 'Browse by topic'
export const RESULTS_TITLE = 'Matching guides'
export const NO_RESULTS = 'No guide matches those words. Try different words, or clear the search to browse by topic.'
export const SEARCH_LOADING = 'Searching the guides'
export const INDEX_LOADING = 'Loading Help'
export const INDEX_LOAD_FALLBACK = "Couldn't load the guide list. Please try again."
export const SEARCH_FALLBACK = "Couldn't search the guides. Please try again."
export const GUIDE_LOADING = 'Loading the guide'
export const GUIDE_LOAD_FALLBACK = "Couldn't load this guide. Please try again."
export const GUIDE_NOT_FOUND = "That guide doesn't exist."
export const GUIDE_NOT_FOUND_HINT = 'It may have been renamed. Search the guides or browse the topics.'
export const BACK_TO_HELP = 'All help'
export const RELATED_TITLE = 'Related guides'
export const CHECKED_LEAD = 'Last checked on'
export const RELOAD = 'Reload'
export const CLEAR_LABEL = 'Clear'
export const HELP_RATE_LIMIT = "You've used Help a lot in a short time. Please wait a little and try again."

export const ALL_STATIC_COPY = [
  PAGE_LABEL, SEARCH_LABEL, SEARCH_PLACEHOLDER, SEARCH_TOO_SHORT, ASK_LABEL, ASK_PLACEHOLDER, ASK_BUTTON, ASK_BUTTON_BUSY, ASK_HINT,
  ASK_DISCLOSURE, ASK_WORKING, ASK_FALLBACK, ASK_TIMEOUT, YOU_ASKED, ANSWER_TITLE, ANSWER_SOURCE_NOTE, FROM_GUIDES, CLOSEST_GUIDES,
  NOTICE_TITLE, RATING_PROMPT, RATING_YES, RATING_NO, RATING_THANKS, RATING_FAILED, SUPPORT_LEAD, POPULAR_TITLE, TOPICS_TITLE,
  RESULTS_TITLE, NO_RESULTS, SEARCH_LOADING, INDEX_LOADING, INDEX_LOAD_FALLBACK, SEARCH_FALLBACK, GUIDE_LOADING, GUIDE_LOAD_FALLBACK,
  GUIDE_NOT_FOUND, GUIDE_NOT_FOUND_HINT, BACK_TO_HELP, RELATED_TITLE, CHECKED_LEAD, RELOAD, CLEAR_LABEL, HELP_RATE_LIMIT,
]

export function resultCountLine(count) {
  if (count === 0) return 'No guides found'
  if (count === 1) return '1 guide found'
  return `${count} guides found`
}

export function documentTitle(guide) {
  return guide && typeof guide.title === 'string' && guide.title ? `LanceraOS | Help | ${guide.title}` : 'LanceraOS | Help'
}

// ── Small type tests ──────────────────────────────────────────────────────────────────────────────────────────────
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const isStr = (v) => typeof v === 'string'
const isNonEmptyStr = (v) => typeof v === 'string' && v.length > 0

// ── Paths and slugs ───────────────────────────────────────────────────────────────────────────────────────────────
// An in-app path: one leading slash (never `//host` or `/\host`), then only URL-path characters. Anything else is not a link.
export function isAppPath(to) {
  return typeof to === 'string' && /^\/(?![/\\])[A-Za-z0-9\-._~/?=&%]*$/.test(to)
}

export function isValidSlug(slug) {
  return typeof slug === 'string' && /^[a-z0-9-]{1,80}$/.test(slug)
}

export function guidePath(slug) {
  return `/help/guides/${encodeURIComponent(slug)}/`
}

export function guideRoute(slug) {
  return `/help/${encodeURIComponent(slug)}`
}

// ── Blocks ────────────────────────────────────────────────────────────────────────────────────────────────────────
// Only valid blocks, in order. An unknown type or a malformed block is dropped: never thrown on, never shown as text.
export function renderableBlocks(blocks) {
  if (!Array.isArray(blocks)) return []
  const out = []
  for (const block of blocks) {
    if (!isObj(block)) continue
    if ((block.type === 'p' || block.type === 'note') && isNonEmptyStr(block.text)) {
      out.push({ type: block.type, text: block.text })
    } else if (block.type === 'steps' && Array.isArray(block.items)) {
      const items = block.items.filter(isNonEmptyStr)
      if (items.length > 0) out.push({ type: 'steps', items })
    } else if (block.type === 'link' && isNonEmptyStr(block.label) && isAppPath(block.to)) {
      out.push({ type: 'link', label: block.label, to: block.to })
    }
  }
  return out
}

// ── Payload checks (a half-drawn page is never shown) ─────────────────────────────────────────────────────────────
const isGuideRow = (g) => isObj(g) && isStr(g.slug) && isStr(g.title) && isStr(g.summary)

export function answersEnabled(index) {
  return index?.answers_enabled === true
}

export function indexIsUsable(data) {
  if (!isObj(data) || typeof data.answers_enabled !== 'boolean') return false
  if (!Array.isArray(data.topics) || data.topics.length === 0) return false
  const topicsOk = data.topics.every((t) => isObj(t) && isStr(t.slug) && isStr(t.title) && isStr(t.blurb)
    && Array.isArray(t.guides) && t.guides.every(isGuideRow))
  if (!topicsOk) return false
  return Array.isArray(data.popular) && data.popular.every((g) => isGuideRow(g) && isStr(g.topic))
}

export function guideIsUsable(data) {
  if (!isObj(data)) return false
  const strings = ['slug', 'title', 'summary', 'topic', 'topic_title', 'checked_on']
  if (!strings.every((key) => isStr(data[key]))) return false
  return renderableBlocks(data.blocks).length > 0 && Array.isArray(data.related) && data.related.every(isGuideRow)
}

export function searchIsUsable(data) {
  return isObj(data) && Array.isArray(data.results) && data.results.every(isGuideRow)
}

const OUTCOMES = ['answered', 'guides_only', 'off_topic']

export function askIsUsable(data) {
  if (!isObj(data) || !OUTCOMES.includes(data.outcome)) return false
  if (!Array.isArray(data.guides) || !data.guides.every(isGuideRow)) return false
  if (!isStr(data.notice) || !isStr(data.support_email)) return false
  if (data.answer !== null && !(isObj(data.answer) && Array.isArray(data.answer.blocks))) return false
  if (data.outcome === 'answered') {
    return isObj(data.answer) && renderableBlocks(data.answer.blocks).length > 0 && data.guides.length > 0
  }
  return data.notice.length > 0
}

// ── Requests ──────────────────────────────────────────────────────────────────────────────────────────────────────
export const searchQuery = (text) => String(text ?? '').trim()

export function searchActive(text) {
  const length = searchQuery(text).length
  return length >= SEARCH_MIN_CHARS && length <= SEARCH_MAX_CHARS
}

export function searchParams(text) {
  return { q: searchQuery(text) }
}

export function canAsk(text) {
  const length = searchQuery(text).length
  return length >= QUESTION_MIN_CHARS && length <= QUESTION_MAX_CHARS
}

// Exactly one key. The page never sends `previous_question` (decision H22).
export function askBody(text) {
  return { question: searchQuery(text) }
}

export function ratingSlugs(result) {
  const slugs = Array.isArray(result?.guides) ? result.guides.map((g) => g?.slug).filter(isStr) : []
  return [...new Set(slugs)].slice(0, RATING_GUIDE_LIMIT)
}

export function ratingBody(helpful, slugs) {
  return { helpful: helpful === true, guides: slugs }
}

// ── The support line ──────────────────────────────────────────────────────────────────────────────────────────────
const EMAIL_SHAPE = /^[^\s@<>"'`]+@[^\s@<>"'`]+\.[^\s@<>"'`]+$/

// The server's address if (and only if) it is a plain `local@domain.tld`; otherwise ''. Never a placeholder.
export function safeSupportEmail(value) {
  if (typeof value !== 'string') return ''
  const email = value.trim()
  return email.length > 0 && email.length <= 120 && EMAIL_SHAPE.test(email) ? email : ''
}

export const supportHref = (email) => `mailto:${email}`

// Shown only on a guides-only result; an empty or malformed address shows nothing.
export function supportEmailFor(result) {
  return result?.outcome === 'guides_only' ? safeSupportEmail(result.support_email) : ''
}

// ── View helpers ──────────────────────────────────────────────────────────────────────────────────────────────────
export function topicTitles(index) {
  if (!indexIsUsable(index)) return {}
  return Object.fromEntries(index.topics.map((t) => [t.slug, t.title]))
}

export function topicLabel(guide, titles) {
  const slug = guide?.topic
  return typeof slug === 'string' && titles && typeof titles[slug] === 'string' ? titles[slug] : ''
}

export const formatChecked = (iso) => formatIsoDate(iso)

// '' when the date cannot be read, so the page leaves the line out instead of printing a dash.
export function checkedLine(iso) {
  const text = formatChecked(iso)
  return text === '—' ? '' : `${CHECKED_LEAD} ${text}`
}

// ── Errors ────────────────────────────────────────────────────────────────────────────────────────────────────────
const TIMED_OUT = ['ECONNABORTED', 'ETIMEDOUT']

// No response: a timeout gets `timeoutMessage` (the ask call's own sentence), anything else the shared network sentence.
// 429: the page's sentence. 400/404 with a non-empty string `error`: the server's short user-safe sentence.
// EVERY other status (5xx included, whatever its body) is the fallback.
export function helpError(error, fallback, timeoutMessage = NETWORK_MESSAGE) {
  const response = error?.response
  if (!response) return TIMED_OUT.includes(error?.code) ? timeoutMessage : NETWORK_MESSAGE
  if (response.status === 429) return HELP_RATE_LIMIT
  if (response.status === 400 || response.status === 404) {
    const message = response.data?.error
    if (isNonEmptyStr(message)) return message
  }
  return fallback
}

export const indexErrorMessage = (e) => helpError(e, INDEX_LOAD_FALLBACK)
export const searchErrorMessage = (e) => helpError(e, SEARCH_FALLBACK)
export const guideErrorMessage = (e) => (e?.response?.status === 404 ? GUIDE_NOT_FOUND : helpError(e, GUIDE_LOAD_FALLBACK))
export const askErrorMessage = (e) => helpError(e, ASK_FALLBACK, ASK_TIMEOUT)
export const ratingErrorMessage = (e) => helpError(e, RATING_FAILED)

export const isNotFoundMessage = (message) => message === GUIDE_NOT_FOUND
