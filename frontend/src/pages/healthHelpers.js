// src/pages/healthHelpers.js
//
// Pure logic for the Health Score page (/health) and the Dashboard "Financial health" widget (Prompt 19). No React, no
// network, no Date. THE RULE: every number and every sentence about the person's money comes from the server
// (apps/health/service.py + copy.py). This file only tests signs and counts (`score === null`, `partial`, `status`,
// `percent === null`), formats, and arranges; it never computes, rescales, rounds or re-ranks a score, a percent or a tip.
import { describePeriod, loadErrorMessage } from './reportsHelpers'

// ── The window ────────────────────────────────────────────────────────────────────────────────────────────────────
export const WINDOW_OPTIONS = [
  { months: 3, label: '3 months' },
  { months: 6, label: '6 months' },
  { months: 12, label: '12 months' },
  { months: 24, label: '24 months' },
]
export const DEFAULT_WINDOW = 12
export const WINDOW_GROUP_LABEL = 'Months to look at'

// A value outside the four falls back to 12, so a bug here can never produce the server's 400.
export function healthParams(months) {
  return { months: WINDOW_OPTIONS.some((o) => o.months === months) ? months : DEFAULT_WINDOW }
}

// ── What a payload is ─────────────────────────────────────────────────────────────────────────────────────────────
export function healthIsUsable(data) {
  if (!data || typeof data !== 'object') return false
  if (!Array.isArray(data.dimensions) || data.dimensions.length === 0) return false
  if (!Array.isArray(data.tips) || !Array.isArray(data.notes)) return false
  return data.dimensions.every((d) => d && typeof d.key === 'string' && typeof d.label === 'string' && typeof d.max_points === 'number')
}

export function hasScore(data) {
  return Boolean(data) && data.score !== null && data.score !== undefined
}

export function isPartial(data) {
  return hasScore(data) && data.partial === true
}

// A COUNT of areas the server could score. Used only to decide whether a radar is worth drawing.
export function scoredCount(data) {
  return (data?.dimensions || []).filter((d) => d.status === 'scored').length
}

export function showRadar(data) {
  return scoredCount(data) >= 3
}

// ── Grade colour: a judgement, so status colours are allowed here and nowhere else; the grade WORD is always written ──
const TONES = {
  green: { color: 'var(--status-green-text)', bg: 'var(--status-green-bg)', fill: 'var(--status-green)' },
  amber: { color: 'var(--status-amber-text)', bg: 'var(--status-amber-bg)', fill: 'var(--status-amber)' },
  red: { color: 'var(--status-red-text)', bg: 'var(--status-red-bg)', fill: 'var(--status-red)' },
  gray: { color: 'var(--status-gray-text)', bg: 'var(--status-gray-bg)', fill: 'var(--status-gray)' },
}
const GRADE_TONE_NAME = { excellent: 'green', good: 'green', fair: 'amber', poor: 'red' }

export function gradeTone(grade) {
  return TONES[GRADE_TONE_NAME[grade]] || TONES.gray
}

export function gradeWord(data) {
  return data?.grade_label || ''
}

// ── The radar ─────────────────────────────────────────────────────────────────────────────────────────────────────
// Recharts writes colours into SVG attributes, where var() does not resolve reliably, so this mirrors the --accent-dim
// token as plain hex (the same reason COLLECTED_BAR_COLORS exists): light #00a87e, dark #00c896.
export const HEALTH_RADAR_COLORS = { light: '#00a87e', dark: '#00c896' }
export const RADAR_UNSCORED_TICK = 'not scored'
export const RADAR_EXPLANATION = 'An area marked not scored has too little data yet. It is drawn at the centre, which does not mean zero.'
export const RADAR_TITLE = 'Your five areas'
export const RADAR_SUBTITLE = 'Each area as a share of its points'

// An unknown area (percent null) has no honest value; the polygon needs one, so it sits at the centre (0) and its axis
// label says "not scored". `scored` is what the label and the explanation line read, never `value`.
export function radarRows(dimensions) {
  return (dimensions || []).map((d) => {
    const scored = d.status === 'scored' && d.percent !== null && d.percent !== undefined
    return { key: d.key, label: d.label, value: scored ? d.percent : 0, scored, points: d.points, max: d.max_points }
  })
}

export function radarHasUnscored(dimensions) {
  return radarRows(dimensions).some((r) => !r.scored)
}

export function radarLabel(dimensions) {
  const parts = radarRows(dimensions).map((r) => (r.scored ? `${r.label} ${r.value}%` : `${r.label} not scored`))
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}` : parts.join('')
  return `Radar chart of your areas as a percent of their points: ${list}. The same figures are in the area cards below.`
}

export function radarTip(row) {
  return row.scored ? `${row.points} of ${row.max} points` : 'Not scored'
}

// ── Area cards ────────────────────────────────────────────────────────────────────────────────────────────────────
export const NOT_SCORED_WORD = 'Not scored'
export const HOW_SCORED = 'How this is scored'
export const MORE_STEPS = 'More steps for this area'

export function pointsText(area) {
  const scored = area.status === 'scored' && area.points !== null && area.points !== undefined
  return scored ? `${area.points} of ${area.max_points} points` : NOT_SCORED_WORD
}

export function meterNow(area) {
  return area.status === 'scored' && typeof area.percent === 'number' ? area.percent : null
}

export function areaLabel(dimensions, key) {
  return (dimensions || []).find((d) => d.key === key)?.label || key
}

// The server's tips are the "Where to start" list; an area card shows only the steps not already there, so no sentence
// appears twice on the page (exact text match, same dimension).
export function extraSteps(area, tips) {
  const inTips = new Set((tips || []).filter((t) => t.dimension === area.key).map((t) => t.text))
  return (area.steps || []).filter((step) => !inTips.has(step))
}

// ── Score card ────────────────────────────────────────────────────────────────────────────────────────────────────
export const SCORE_TITLE = 'Your health score'
export const SCORE_SUBTITLE = 'Out of 100, from the records you keep in LanceraOS'
export const NO_SCORE_HEADING = 'No score yet'

export function partialLine(data) {
  return isPartial(data) ? `Counted over ${data.available_points} of 100 points. Some areas could not be scored yet.` : ''
}

// Dates and currency are read from the RESPONSE, so the figures and the dates can never disagree.
export function windowLine(data) {
  if (!data?.window) return ''
  return `Looking at ${describePeriod(data.window.start, data.window.end)}, in ${data.currency}`
}

// ── Tips ──────────────────────────────────────────────────────────────────────────────────────────────────────────
export const TIPS_TITLE = 'Where to start'
export const TIPS_EMPTY = 'No steps to suggest right now.'
const TIPS_SUBTITLE_RANKED = 'Ordered by how many points each step could add.'
const TIPS_SUBTITLE_RECORD = 'These records will let more of your score be measured.'

export function tipsSubtitle(tips) {
  return (tips || []).some((t) => t.gain !== null && t.gain !== undefined) ? TIPS_SUBTITLE_RANKED : TIPS_SUBTITLE_RECORD
}

// ── Update-records row (no per-step deep links: the server sends text, not a destination) ────────────────────────────
export const UPDATE_LEAD = 'The score follows your records. Update them here:'
export const UPDATE_LINKS = [
  { to: '/payments', label: 'Payments' },
  { to: '/expenses', label: 'Expenses' },
  { to: '/settings?tab=tax', label: 'Tax & PSEB' },
]

// ── The Dashboard widget ──────────────────────────────────────────────────────────────────────────────────────────
export const WIDGET_TITLE = 'Financial health'
export const WIDGET_LINK = 'Details'
export const WIDGET_LINK_LABEL = 'See your full health score'
export const WIDGET_NEXT_STEP = 'Best next step'
export const WIDGET_PARTIAL = 'Based on the areas that could be scored.'
export const WIDGET_NO_STEPS = 'No steps to suggest right now.'
export const WIDGET_NEEDED_LINK = 'See what is needed'

export function widgetSubtitle(mini) {
  return `Last ${mini?.months ?? DEFAULT_WINDOW} full months`
}

// A mini payload the widget can draw: an object that carries a `score` key (null is a valid value, a missing key is not).
export function miniIsUsable(mini) {
  return Boolean(mini) && typeof mini === 'object' && 'score' in mini
}

export function miniView(mini) {
  return hasScore(mini) ? 'score' : 'none'
}

// ── Loading and errors ────────────────────────────────────────────────────────────────────────────────────────────
export const HEALTH_LOAD_FALLBACK = "Couldn't load your health score. Please try again."
export const LOAD_RATE_LIMIT_HEALTH = 'You have loaded your health score a lot in a short time. Please wait a little and try again.'
export const LOADING_LABEL = 'Loading your health score'

// The shared loader's own 429 sentence says "report", so the 429 is handled here first. A 400 can only mean this page sent a
// window the server does not know (the page never does), and that body is a developer sentence ("months must be 3, 6, 12 or
// 24."), so it is never shown; every other failure goes through the shared message (network, or the server's own sentence).
export function healthLoadError(error) {
  const status = error?.response?.status
  if (status === 429) return LOAD_RATE_LIMIT_HEALTH
  if (status === 400) return HEALTH_LOAD_FALLBACK
  return loadErrorMessage(error, HEALTH_LOAD_FALLBACK)
}

// The same list the report pages use. A test scans every static string this feature ships and every rendered state.
export const BANNED_WORDS = [
  'ledger', 'rollup', 'snapshot', 'rate_basis', 'endpoint', 'API', 'fingerprint', 'batch', 'taxable', 'certified', 'verified',
  'official', 'guaranteed', 'tax-free', 'claim this', 'save tax', 'reduces your tax', 'seamless', 'powerful', 'easily', 'simply', 'just',
]
