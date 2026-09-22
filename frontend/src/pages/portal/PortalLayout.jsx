// src/pages/portal/PortalLayout.jsx
//
// Shell-less, like /account/deletion-review — the client portal is its
// own standalone surface, never wrapped in AppShell (that's the
// freelancer-facing chrome).
//
// FIXED 22 September 2026: this previously used theme.css's
// theme-responsive var(--*) tokens (var(--bg-surface) etc.), which
// silently follow the freelancer's OWN light/dark dashboard toggle —
// meaningless (and in dark mode, actively broken: near-white text on a
// near-white card) for an unauthenticated client who has no such
// setting. DESIGN.md Section 10 names the Client Portal explicitly as
// a public page that must use ONE fixed light palette instead — the
// same one InvoiceView.jsx/PaymentDetails.jsx already use. See
// DECISIONS.md's 22 September 2026 entry.
import { CARD_BG, CARD_BORDER, PAGE_BG } from './portalShared'

export default function PortalLayout({ children, maxWidth = 480 }) {
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24, background: PAGE_BG,
    }}>
      <div style={{
        width: '100%', maxWidth, background: CARD_BG, border: `1px solid ${CARD_BORDER}`,
        borderRadius: 12, boxShadow: '0 2px 12px rgba(0,0,0,.07)', padding: '28px 32px',
      }}>
        {children}
      </div>
    </div>
  )
}
