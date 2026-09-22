// src/pages/portal/portalShared.js
//
// Client Portal Redesign — the one shared module for every value
// duplicated across the portal's own files (Phase 2's own investigation
// confirmed ClientPortal.jsx/PortalEnter.jsx/PortalRequestLinkForm.jsx
// each hardcoded the same values independently; factored out then).
//
// Phase 3.5: every constant below now resolves to a `var(--portal-*)`
// CSS custom property (portalTheme.css, scoped under PortalThemeRoot.jsx's
// own `data-portal-theme` attribute) instead of a literal hex/rgba value.
// This is the one place that change needed to happen — every component
// that already imports NAVY/ACCENT/MUTED_TEXT/etc. and uses them inside
// an inline `style={{color: NAVY}}` object re-themes automatically,
// with zero changes to those components' own JSX, since a CSS custom
// property is a perfectly valid inline-style value. See DECISIONS.md's
// Phase 3.5 entry for the full palette (including the dark-mode
// brightening ERROR/WARNING needed to stay accessible) and
// portalTheme.css for the actual light/dark values these names resolve
// to at runtime.
export const NAVY = 'var(--portal-heading)'
export const SECONDARY_NAVY = 'var(--portal-heading-secondary)'
// A real bug caught during Phase 3.5's dark-mode build: NAVY doubles as
// heading text everywhere else, but a primary button's own FILL needs a
// separate token — in dark mode, --portal-heading resolves to a
// near-white color (correct for text on a dark page), which would make
// a NAVY-background button's white text unreadable. See
// portalTheme.css's own --portal-button-bg for the real values/contrast
// evidence and DECISIONS.md for the full before/after.
export const BUTTON_BG = 'var(--portal-button-bg)'
export const ACCENT = 'var(--portal-accent)'
export const ACCENT_TINT = 'var(--portal-accent-tint)'
export const ACCENT_BORDER_TINT = 'var(--portal-accent-border-tint)'
export const BODY_TEXT = 'var(--portal-text)'
export const MUTED_TEXT = 'var(--portal-muted-text)'
export const DIVIDER = 'var(--portal-divider)'
export const CARD_SHADOW = 'var(--portal-modal-shadow)'
export const SMALL_CARD_SHADOW = 'var(--portal-card-shadow)'
export const MENU_SHADOW = 'var(--portal-menu-shadow)'
export const ERROR = 'var(--portal-error)'
export const ERROR_TINT = 'var(--portal-error-tint)'
export const ERROR_BORDER_TINT = 'var(--portal-error-border-tint)'
export const WARNING = 'var(--portal-warning)'
export const WARNING_TINT = 'var(--portal-warning-tint)'
export const PAGE_BG = 'var(--portal-bg)'
export const CARD_BG = 'var(--portal-card-bg)'
export const CARD_BORDER = 'var(--portal-card-border)'
export const INPUT_BORDER = 'var(--portal-input-border)'
export const HOVER_BG = 'var(--portal-hover-bg)'
export const SKELETON_BG = 'var(--portal-skeleton)'
export const BUBBLE_OTHER = 'var(--portal-bubble-other)'
export const WORDMARK_COLOR = 'var(--portal-wordmark)'
// Theme-invariant on purpose: the accent teal itself doesn't change
// between light/dark (8.93:1 against the dark background, confirmed —
// see DECISIONS.md), so the one color that reads well ON it doesn't
// need to change either. White fails badly here (2.16:1) — matches the
// same reasoning PaymentDetails.jsx's own "Copied" pill comment already
// documents for the identical teal-background case.
export const TEXT_ON_ACCENT = '#00291f'

export const publicInputStyle = {
  width: '100%', boxSizing: 'border-box', background: CARD_BG, border: `1.5px solid ${INPUT_BORDER}`,
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
export const publicBtnPrimary = { ...publicBtnBase, border: 'none', background: BUTTON_BG, color: '#ffffff' }
export const publicBtnGhost = { ...publicBtnBase, border: `1.5px solid ${INPUT_BORDER}`, background: 'transparent', color: BODY_TEXT }

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

// PaymentClaim.STATUS_CHOICES (apps/invoices/models.py) — the real
// visual treatment already established for this exact status set on
// this exact public portal (ClientPortal.jsx's own ClaimHistory,
// confirmed unchanged since Phase 2), factored out here in Phase 3
// so PortalPayments.jsx's own claims list reuses these same colors
// instead of inventing a second, independently-chosen set. `tint` added
// in Phase 3.5 for PortalPayments.jsx's own badge backgrounds — same
// per-status color, just paired with its own theme-aware tint variable
// instead of a separately-maintained literal rgba map.
export const CLAIM_STATUS_META = {
  pending: { label: 'Pending review', color: WARNING, tint: WARNING_TINT },
  confirmed: { label: 'Confirmed', color: ACCENT, tint: ACCENT_TINT },
  rejected: { label: 'Rejected', color: ERROR, tint: ERROR_TINT },
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
