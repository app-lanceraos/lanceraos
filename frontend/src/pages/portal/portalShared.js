// src/pages/portal/portalShared.js
//
// Client Portal Redesign, Phase 2 — the one shared module for every
// value that was previously duplicated across ClientPortal.jsx,
// PortalEnter.jsx, and PortalRequestLinkForm.jsx (confirmed by direct
// inspection: all three hardcoded the same DESIGN.md Section 10 hex
// values independently). Factored out here now, before PortalShell.jsx/
// PortalOverview.jsx need the exact same values a fourth and fifth time.
//
// DESIGN.md Section 10's fixed public-page palette — self-contained
// hardcoded values, never theme.css var(--*) tokens (this whole
// directory is public/unauthenticated, see each file's own header
// comment). Matches InvoiceView.jsx/PaymentDetails.jsx exactly.
export const NAVY = '#1e3a5f'
export const SECONDARY_NAVY = '#2e5987'
export const ACCENT = '#00c896'
export const BODY_TEXT = '#334155'
export const MUTED_TEXT = '#64748b'
export const DIVIDER = 'rgba(0,0,0,.07)'
export const CARD_SHADOW = '0 8px 40px rgba(0,0,0,0.25)'
export const ERROR = '#c0392b'
export const WARNING = '#8a7d5c'
export const PAGE_BG = '#f8fafc'
export const CARD_BG = '#ffffff'
export const CARD_BORDER = 'rgba(0,0,0,.08)'

export const publicInputStyle = {
  width: '100%', boxSizing: 'border-box', background: '#ffffff', border: '1.5px solid rgba(0,0,0,.15)',
  borderRadius: 8, padding: '10px 14px', fontFamily: "'DM Sans', sans-serif", fontSize: '0.9rem',
  color: BODY_TEXT, outline: 'none',
}
export const publicLabelStyle = {
  display: 'block', fontSize: '0.78rem', fontWeight: 500, color: MUTED_TEXT, marginBottom: 6, letterSpacing: '0.01em',
}
const publicBtnBase = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
  padding: '10px 20px', borderRadius: 8, fontFamily: "'DM Sans', sans-serif", fontSize: '0.88rem',
  fontWeight: 600, cursor: 'pointer',
}
export const publicBtnPrimary = { ...publicBtnBase, border: 'none', background: NAVY, color: '#ffffff' }
export const publicBtnGhost = { ...publicBtnBase, border: '1.5px solid rgba(0,0,0,.15)', background: 'transparent', color: BODY_TEXT }

export function disabledStyle(style, disabled) {
  return disabled ? { ...style, opacity: 0.5, cursor: 'not-allowed' } : style
}

// Invoice.STATUS_CHOICES display labels — client-facing subset, same
// mapping ClientPortal.jsx already established (not the freelancer-side
// STATUS_BADGE_STYLE map in invoiceHelpers.js, which carries statuses
// like 'draft' a client never sees per portal_invoice_list's own
// draft/created exclusion).
export const STATUS_LABELS = {
  draft: 'Draft', created: 'Finalised', sent: 'Sent', viewed: 'Viewed',
  partially_paid: 'Partially Paid', paid: 'Paid',
  cancelled: 'Cancelled', refunded: 'Refunded', bad_debt: 'Bad Debt',
}

// portal_overview's needs_attention[].reasons — see
// apps/invoices/views_portal.py's _needs_attention_reasons for the exact
// 4 possible values this list can contain (an invoice can carry more
// than one at once).
export const NEEDS_ATTENTION_REASON_LABELS = {
  unacknowledged: 'Needs your acknowledgment',
  overdue: 'Overdue',
  payment_claim_pending: 'Payment claim pending review',
  unread_message: 'Unread message',
}

// PortalInvoiceListSerializer/PortalOverviewNeedsAttentionSerializer
// deliberately never expose the raw view_token as its own field (Step
// 12 — only pre-built URLs are exposed to the client side, never the
// credential itself). CommentThread's WebSocket route needs that token,
// so it's parsed back out of the one URL that already legitimately
// contains it (.../portal/view/<token>/) rather than adding a second
// field whose only purpose would be handing the token to JS directly.
export function viewTokenFromPortalUrl(url) {
  if (!url) return null
  const segments = url.split('/').filter(Boolean)
  return segments[segments.length - 1] || null
}
