// src/pages/clientHelpers.js
// Small, pure helpers shared between Clients.jsx and ClientDetailPanel.jsx —
// not a React component, so this doesn't fall under DESIGN.md Section 12's
// "no new shared utility components" rule, which is about things like a
// shared Modal/Badge/Table. Kept in one place per STANDARDS.md's
// single-source-of-truth rule rather than duplicated across both files.

// apps.clients' payment_stats.reliability_score is the normalized average
// of the real point formula (+5 on-time / -3 late 1-30d / -10 late 31+d /
// -20 bad_debt — see DECISIONS.md, 08 August 2026). These bands are a
// frontend-only presentation choice on top of that raw number, not a
// second backend concept — chosen so a single on-time invoice (+5) reads
// as "Reliable" and a single 31+ day-late or bad-debt invoice reads as
// "Unreliable", with a "Mixed" band in between for anything only mildly
// negative on average.
export function reliabilityBand(score) {
  if (score === null || score === undefined) {
    return { label: 'No data yet', statusKey: 'gray' }
  }
  if (score > 0) return { label: 'Reliable', statusKey: 'green' }
  if (score >= -5) return { label: 'Mixed', statusKey: 'amber' }
  return { label: 'Unreliable', statusKey: 'red' }
}

// DESIGN.md's status color map (Section 2.5 / Section 7) — never hardcode
// a status hex, always go through these tokens.
export const STATUS_BADGE_STYLE = {
  green: { background: 'var(--status-green-bg)', color: 'var(--status-green-text)' },
  amber: { background: 'var(--status-amber-bg)', color: 'var(--status-amber-text)' },
  red: { background: 'var(--status-red-bg)', color: 'var(--status-red-text)' },
  blue: { background: 'var(--status-blue-bg)', color: 'var(--status-blue-text)' },
  gray: { background: 'var(--status-gray-bg)', color: 'var(--status-gray-text)' },
}

export const badgeBaseStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  borderRadius: 'var(--radius-full)',
  padding: '3px 8px',
  fontSize: '0.72rem',
  fontWeight: 600,
  whiteSpace: 'nowrap',
}

// A ClientTag's `color` is user-chosen per-tag data (like an avatar
// color), not a structural/status color — DESIGN.md's "never hardcode a
// status hex" rule targets fixed UI states (paid/overdue/etc.), not
// user-supplied record data. Backend validates color as a 6-digit hex
// (#RRGGBB), so appending 2 hex chars is always a safe alpha channel.
export function tagPillStyle(hexColor) {
  return {
    ...badgeBaseStyle,
    background: `${hexColor}22`,
    color: hexColor,
    border: `1px solid ${hexColor}55`,
  }
}

export function formatMoney(amount, currency = 'USD') {
  const value = Number(amount || 0)
  return `${currency} ${value.toLocaleString('en', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

export const FLAG_TYPE_OPTIONS = [
  { value: 'payment_risk', label: 'Payment Risk' },
  { value: 'communication', label: 'Communication Issue' },
  { value: 'other', label: 'Other' },
]

export const CURRENCY_OPTIONS = [
  { value: 'USD', label: 'USD' },
  { value: 'EUR', label: 'EUR' },
  { value: 'GBP', label: 'GBP' },
  { value: 'PKR', label: 'PKR' },
]

export const PAYMENT_TERMS_OPTIONS = [
  { value: 7, label: '7 days' },
  { value: 14, label: '14 days' },
  { value: 30, label: '30 days' },
  { value: 45, label: '45 days' },
  { value: 60, label: '60 days' },
]
