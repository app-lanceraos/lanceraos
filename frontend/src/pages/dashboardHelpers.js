// src/pages/dashboardHelpers.js
//
// Pure helpers for the Dashboard page and its cards — no React, no network. Everything that decides what a
// number, sentence or link looks like lives here so a test can pin it down without rendering.
import {
  ArrowDownToLine, FilePlus2, FileText, MessageSquare, Send, Eye, XCircle, CheckCircle2,
} from 'lucide-react'

import { formatMoney } from '@/pages/invoiceHelpers'
import { unconvertedNote } from '@/pages/clientHelpers'

// ── Greeting (the one thing on this page that uses the DEVICE clock) ────────────────────────────
// It is about the person's own wall clock, so it follows the browser. Everything else on the page is naive
// Pakistan time shown as written (DESIGN.md "Times"), and there are no relative times ("2 hours ago") because
// those would be wrong for a browser outside PKT.
export function greetingFor(date) {
  const hour = date.getHours()
  if (hour >= 5 && hour < 12) return 'Good morning'
  if (hour >= 12 && hour < 17) return 'Good afternoon'
  // 17:00 - 04:59. No "Good night": that is a farewell, not a greeting.
  return 'Good evening'
}

export function greetingName(user) {
  return (user?.first_name || '').trim() || (user?.username || '').trim() || ''
}

export function greetingLine(date, user) {
  const name = greetingName(user)
  return name ? `${greetingFor(date)}, ${name}` : greetingFor(date)
}

export function longDate(date) {
  // en-GB pins day-month-year order whatever the browser's locale, matching every other date on the page.
  return date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

// ── Dates the API sends as plain calendar dates ("2026-11-04"): never run through `new Date()` ──
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// A formatting helper never prints "undefined" (Prompt 27, B7): a month outside 01-12 or a day outside 01-31 is not a date
// we can write, so the date helpers answer a dash and the month helpers hand the input back.
function monthName(monthDigits) {
  const month = Number(monthDigits)
  return month >= 1 && month <= 12 ? MONTHS[month - 1] : null
}

function dayOfMonth(dayDigits) {
  const day = Number(dayDigits)
  return day >= 1 && day <= 31 ? day : null
}

export function formatIsoDate(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '')
  if (!match) return '—'
  const month = monthName(match[2])
  const day = dayOfMonth(match[3])
  if (!month || !day) return '—'
  return `${day} ${month} ${match[1]}`
}

export function formatIsoDayMonth(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '')
  if (!match) return '—'
  const month = monthName(match[2])
  const day = dayOfMonth(match[3])
  if (!month || !day) return '—'
  return `${day} ${month}`
}

export function monthShort(key) {
  const match = /^(\d{4})-(\d{2})$/.exec(key || '')
  return (match && monthName(match[2])) || key
}

export function monthLong(key) {
  const match = /^(\d{4})-(\d{2})$/.exec(key || '')
  const month = match && monthName(match[2])
  return month ? `${month} ${match[1]}` : key
}

// ── Visually hidden (theme.css has no sr-only class) ──────────────────────────────────────────
export const visuallyHidden = {
  position: 'absolute', width: 1, height: 1, margin: -1, padding: 0, border: 0,
  overflow: 'hidden', clip: 'rect(0 0 0 0)', clipPath: 'inset(50%)', whiteSpace: 'nowrap',
}

// ── Money ─────────────────────────────────────────────────────────────────────────────────────
const compactFormat = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })

export function compactNumber(value) {
  return compactFormat.format(Number(value || 0))
}

// "N excluded" notes. Invoice-based figures reuse the exact Clients/Analytics wording (unconvertedNote); the
// payment-based ones (Paid this month, the chart) say "payment" because that is what was left out.
export function invoiceNote(count) {
  return unconvertedNote(count)
}

export function paymentNote(count) {
  return `${count} payment${count !== 1 ? 's' : ''} excluded from these figures — no exchange rate was captured for ${count !== 1 ? 'them' : 'it'}.`
}

export function deltaView(pctChange) {
  if (pctChange === null || pctChange === undefined) return null
  const up = pctChange >= 0
  return { up, text: `${Math.abs(pctChange).toFixed(1)}% vs last month` }
}

// ── Income chart ──────────────────────────────────────────────────────────────────────────────
// The validated light/dark "collected" step theme.css defines as --chart-series-collected, mirrored as plain hex
// (Recharts writes colours into SVG attributes, where var() does not resolve reliably). Shared by the Dashboard chart
// and the Payments chart; InvoiceAnalytics.jsx still keeps its own copy.
export const COLLECTED_BAR_COLORS = { light: '#1baf7a', dark: '#199e70' }

export function trendHasData(months) {
  return (months || []).some((m) => Number(m.collected) > 0)
}

export function trendChartData(months) {
  return (months || []).map((m) => ({ key: m.month, label: monthShort(m.month), full: monthLong(m.month), value: Number(m.collected) }))
}

export function trendSummary(months, currency) {
  const parts = (months || []).map((m) => `${monthLong(m.month)} ${formatMoney(m.collected, currency)}`)
  return `Money collected per month over the last ${parts.length} months, in ${currency}: ${parts.join('; ')}.`
}

// ── Links (only query params Invoices.jsx / Clients.jsx / the proposal routes actually read today) ──
export const KPI_LINKS = {
  outstanding: '/invoices',
  overdue: '/invoices',
  paid_this_month: '/invoices',
  active_clients: '/clients',
}

export const overdueLink = (item) => `/invoices?invoice=${item.id}`
export const messageLink = (item) => `/invoices?invoice=${item.invoice_id}&tab=comments`
export const proposalLink = (item) => `/proposals/${item.id}`

// ── Needs attention ───────────────────────────────────────────────────────────────────────────
export function nothingNeedsAttention(attention) {
  return (
    attention.overdue_invoices.total_count === 0
    && attention.unread_messages.total_count === 0
    && attention.proposals_awaiting.total_count === 0
  )
}

export function moreCount(total, shown) {
  return Math.max(0, total - shown)
}

// ── Recent activity ───────────────────────────────────────────────────────────────────────────
const WHO = (item) => item.client_name || 'A client'
const WHAT_INVOICE = (item) => (item.number ? `invoice ${item.number}` : 'an invoice')
const WHAT_PROPOSAL = (item) => (item.number ? `proposal ${item.number}` : 'a proposal')

export function activityMeta(kind) {
  return ACTIVITY_META[kind] || ACTIVITY_META.invoice_sent
}

const ACTIVITY_META = {
  invoice_sent: { Icon: Send, label: 'Invoice sent' },
  invoice_viewed: { Icon: Eye, label: 'Invoice viewed' },
  payment_received: { Icon: ArrowDownToLine, label: 'Payment received' },
  client_message: { Icon: MessageSquare, label: 'Client message' },
  proposal_sent: { Icon: FilePlus2, label: 'Proposal sent' },
  proposal_viewed: { Icon: FileText, label: 'Proposal viewed' },
  proposal_accepted: { Icon: CheckCircle2, label: 'Proposal accepted' },
  proposal_declined: { Icon: XCircle, label: 'Proposal declined' },
}

// The sentence is built here from structured fields and rendered as a React text node (escaped); the server never
// sends prose.
export function activitySentence(item) {
  const amount = item.amount !== undefined ? formatMoney(item.amount, item.currency) : null
  switch (item.kind) {
    case 'invoice_sent':
      return `You sent ${WHAT_INVOICE(item)} to ${item.client_name || 'a client'}${amount ? ` for ${amount}` : ''}`
    case 'invoice_viewed':
      return `${WHO(item)} viewed ${WHAT_INVOICE(item)}`
    case 'payment_received':
      return `${amount ? `${amount} payment` : 'Payment'} received on ${WHAT_INVOICE(item)} from ${item.client_name || 'a client'}`
    case 'client_message':
      return `${WHO(item)} sent a message on ${WHAT_INVOICE(item)}`
    case 'proposal_sent':
      return `You sent ${WHAT_PROPOSAL(item)} to ${item.client_name || 'a client'}`
    case 'proposal_viewed':
      return `${WHO(item)} viewed ${WHAT_PROPOSAL(item)}`
    case 'proposal_accepted':
      return `${WHO(item)} accepted ${WHAT_PROPOSAL(item)}`
    case 'proposal_declined':
      return `${WHO(item)} declined ${WHAT_PROPOSAL(item)}`
    default:
      return 'Activity'
  }
}

export function activityLink(item) {
  if (item.proposal_id) return `/proposals/${item.proposal_id}`
  if (item.kind === 'client_message') return `/invoices?invoice=${item.invoice_id}&tab=comments`
  return `/invoices?invoice=${item.invoice_id}`
}

// ── Upcoming recurring ────────────────────────────────────────────────────────────────────────
export const upcomingLink = (item) => `/invoices?invoice=${item.invoice_id}`

export function autoSendText(autoSend) {
  return autoSend ? 'Will be sent automatically' : 'Will be created as a draft'
}

// ── Exchange rates ────────────────────────────────────────────────────────────────────────────
export function rateRowText(pair) {
  return `1 ${pair.from} = ${pair.to} ${Number(pair.rate).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// ── Insights card (Prompt 09) ─────────────────────────────────────────────────────────────────
export const INSIGHTS_FOOTER = 'Written by AI from your own figures. Check them against your invoices before acting.'

// Shown only when the server says some of the text was written by the model. A result made entirely of the fixed
// sentences ("template") carries no footer: nothing in it was written by AI.
export function showAiFooter(source) {
  return source === 'ai' || source === 'mixed'
}

// Used only if the server sends an empty status without its own hint.
export const INSIGHTS_EMPTY_FALLBACK = 'Insights appear once you have payments recorded in at least two months, or a few paid invoices and answered proposals.'

// The model can take several seconds (the server's own ceiling is AI_TOTAL_BUDGET_SECONDS, at most 60), so this request
// is given longer than the shared Axios instance's 15 s default.
export const INSIGHTS_TIMEOUT_MS = 65000
export const INSIGHTS_SKELETON_ROWS = 3
