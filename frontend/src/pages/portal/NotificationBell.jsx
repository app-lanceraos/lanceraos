// src/pages/portal/NotificationBell.jsx
//
// Client Notification Bell (Client Portal Redesign, Phase 5b — the
// frontend for apps/clients/views_portal_notifications.py, Phase 5's
// already-built, already-tested backend). Lives in PortalShell.jsx's
// header, next to the account menu — not a nav tab, per this task's own
// explicit instruction.
//
// Deliberately a small, local component with its own click-outside/
// Escape-to-close handling, mirroring PortalShell.jsx's own AccountMenu
// exactly (confirmed directly by reading it first) — NOT a reuse of the
// freelancer-side DropdownMenu.jsx, which resolves theme.css tokens (the
// authenticated app's own light/dark preference) that don't exist inside
// this portal's separate `data-portal-theme` scope; AccountMenu's own
// header comment already established this precedent for exactly this
// reason, and this component follows it rather than inventing a second
// pattern.
//
// Polling only, no WebSocket — the backend's own explicit Phase 5 scope
// (apps/clients/views_portal_notifications.py has no consumer to connect
// to). Reuses this codebase's own established poll-interval convention
// (src/hooks/useNotificationSocket.js's POLL_INTERVAL_MS = 20000, the
// freelancer bell's own WS-down fallback cadence) rather than inventing
// a new one — confirmed directly against that file, not guessed.
//
// Real event-type strings this bell renders (confirmed directly against
// apps/invoices/notifications.py's "Client Notification Bell" handlers
// and apps/clients/views_portal_notifications.py's own
// CLIENT_NOTIFICATION_EVENTS/CLIENT_EVENT_TITLES, not guessed):
// client_invoice_sent, client_comment_posted, client_payment_claim_confirmed,
// client_payment_claim_rejected, client_formal_notice_sent. Each
// notification's `message` field already carries real, complete,
// human-readable text built server-side
// (_describe_client_notification) — this component adds only an icon
// and a relative timestamp, never re-derives or duplicates that copy.
import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle, Bell, CheckCircle2, MessageCircle, Receipt, XCircle,
} from 'lucide-react'

import api from '@/lib/api'
import {
  ACCENT, ACCENT_TINT, BODY_TEXT, CARD_BG, CARD_BORDER, ERROR, MENU_SHADOW, MUTED_TEXT, NAVY,
} from './portalShared'

// Matches useNotificationSocket.js's own constant exactly (see this
// file's own header comment) — the one existing polling convention in
// this codebase for "keep a notification badge current with no
// WebSocket," reused rather than re-tuned.
const POLL_INTERVAL_MS = 20000

const NOTIF_ICONS = {
  client_invoice_sent: Receipt,
  client_comment_posted: MessageCircle,
  client_payment_claim_confirmed: CheckCircle2,
  client_payment_claim_rejected: XCircle,
  client_formal_notice_sent: AlertTriangle,
}

// Same shape as AppShell.jsx's own relativeTime — a small, self-
// contained duplicate rather than a shared import, since AppShell's
// version is a local, unexported function with no module of its own to
// import from, and this portal's own components never import from the
// authenticated app's component tree (a real, established boundary —
// see ClientPortal.jsx's own header comment on why FormField/FormSelect/
// FosAlert were re-implemented locally rather than reused for the same
// reason).
function relativeTime(iso) {
  try {
    const diff = Date.now() - new Date(iso).getTime()
    const mins = Math.floor(diff / 60000)
    const hours = Math.floor(diff / 3600000)
    const days = Math.floor(diff / 86400000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    if (hours < 24) return `${hours}h ago`
    if (days < 7) return `${days}d ago`
    return new Date(iso).toLocaleDateString()
  } catch { return '' }
}

export default function NotificationBell({ isMobile }) {
  const [open, setOpen] = useState(false)
  const [notifications, setNotifications] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const triggerRef = useRef(null)

  async function fetchNotifications() {
    setLoading(true)
    try {
      const { data } = await api.get('/clients/portal/notifications/')
      setNotifications(data.notifications || [])
      setUnreadCount(data.unread_count || 0)
    } catch {
      // A fetch failure (offline, a session that's since expired) reads
      // as an empty bell, not a broken one — PortalShell's own Overview
      // fetch is what surfaces a real "you're logged out" state; this
      // component has no independent session-error UI of its own.
    } finally {
      setLoading(false)
    }
  }

  // Fetches immediately on mount (so the badge is accurate the instant
  // the shell renders, matching AppShell.jsx's own bell precedent) and
  // polls continuously thereafter — there is no WebSocket connection to
  // fall back FROM here, unlike the freelancer bell, so this interval is
  // the steady state, not a temporary bridge.
  useEffect(() => {
    fetchNotifications()
    const interval = setInterval(fetchNotifications, POLL_INTERVAL_MS)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!open) return
    const handleKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [open])

  async function markOneRead(id) {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)))
    setUnreadCount((prev) => Math.max(0, prev - 1))
    try {
      await api.post(`/clients/portal/notifications/${id}/mark-read/`)
    } catch {
      // Best-effort — the next poll reconciles real server state either
      // way, matching AppShell.jsx's own markOneRead precedent.
    }
  }

  async function markAllRead() {
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })))
    setUnreadCount(0)
    try {
      await api.post('/clients/portal/notifications/mark-all-read/')
    } catch {
      // Same best-effort reasoning as markOneRead above.
    }
  }

  async function handleClickNotification(n) {
    setOpen(false)
    // Real, live-verified bug (see DECISIONS.md): firing markOneRead
    // without awaiting it, then immediately setting window.location.href,
    // let the full-page navigation abort the in-flight mark-read POST
    // before the browser's own unload — a real reload afterward showed
    // the notification still unread despite the optimistic UI update a
    // moment earlier. Awaiting it first (a real network round trip,
    // typically well under 100ms on localhost) guarantees the read state
    // is durably written before the navigation that would otherwise race
    // it. action_url is a full, absolute URL (Invoice.portal_view_url —
    // {FRONTEND_URL}/invoice/<token>/), not a relative in-app route —
    // confirmed directly against apps/clients/views_portal_notifications.py's
    // _client_notification_action_url. A plain navigation matches
    // ClientPortal.jsx's own established treatment of this exact same
    // field (`<a href={inv.portal_view_url}>`, never a react-router
    // <Link>) — that destination renders no shared portal chrome to
    // preserve statefully across a soft navigation anyway.
    if (!n.is_read) await markOneRead(n.id)
    if (n.action_url) window.location.href = n.action_url
  }

  const badgeLabel = unreadCount > 9 ? '9+' : String(unreadCount)

  return (
    <div style={{ position: 'relative' }}>
      <button
        ref={triggerRef}
        onClick={() => setOpen((o) => !o)}
        aria-label="Notifications"
        aria-expanded={open}
        style={{
          position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: 40, height: 40, borderRadius: '50%', border: `1px solid ${CARD_BORDER}`,
          background: CARD_BG, cursor: 'pointer', color: NAVY, flexShrink: 0,
        }}
      >
        <Bell size={19} />
        {unreadCount > 0 && (
          <span style={{
            position: 'absolute', top: -2, right: -2,
            minWidth: 17, height: 17, padding: '0 4px', boxSizing: 'border-box', borderRadius: 999,
            background: ERROR, color: '#ffffff', fontSize: '0.62rem', fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: `0 0 0 2px ${CARD_BG}`, lineHeight: 1,
          }}>
            {badgeLabel}
          </span>
        )}
      </button>

      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 60 }} />
          {/* Mobile: a full-width sheet anchored under the header, not a
              small floating panel. Real 375px measurement (Playwright
              against the live dev app, PortalShell's real mobile header):
              header height 72.5px, so a fixed desktop-style 340px panel
              at a 12px right offset would leave only ~11px of breathing
              room on either side — cramped, not "fits, technically."
              Anchored via `left`/`right: 16` (matching PortalShell.jsx's
              own mobile header side padding exactly, so the sheet's edges
              line up with the header content above it) instead of a
              centered fixed width; `top: 76` clears the real measured
              72.5px header height with a small visible gap, confirmed by
              screenshot to sit cleanly below the header with no overlap.
              Desktop keeps the existing small floating panel — this is a
              real, narrow-viewport-only treatment, not a rewrite of both. */}
          <div
            style={isMobile ? {
              position: 'fixed', top: 76, left: 16, right: 16, zIndex: 61,
              maxHeight: 'calc(100vh - 108px)',
              background: CARD_BG, border: `1px solid ${CARD_BORDER}`, borderRadius: 14,
              boxShadow: MENU_SHADOW, display: 'flex', flexDirection: 'column', overflow: 'hidden',
            } : {
              position: 'absolute', top: 48, right: 0, zIndex: 61,
              width: 340, maxWidth: 'calc(100vw - 24px)', maxHeight: 420,
              background: CARD_BG, border: `1px solid ${CARD_BORDER}`, borderRadius: 12,
              boxShadow: MENU_SHADOW, display: 'flex', flexDirection: 'column', overflow: 'hidden',
            }}
          >
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
              padding: '13px 14px', borderBottom: `1px solid ${CARD_BORDER}`, flexShrink: 0,
            }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 700, color: NAVY }}>Notifications</span>
              {unreadCount > 0 ? (
                <button
                  onClick={markAllRead}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.75rem',
                    fontWeight: 600, color: ACCENT, padding: '4px 4px', minHeight: 24,
                  }}
                >
                  Mark all read
                </button>
              ) : (
                <span />
              )}
            </div>

            <div style={{ overflowY: 'auto', flex: 1 }}>
              {loading && notifications.length === 0 && (
                <div style={{ padding: 28, textAlign: 'center', fontSize: '0.8rem', color: MUTED_TEXT }}>Loading…</div>
              )}
              {!loading && notifications.length === 0 && (
                <div style={{ padding: '32px 16px', textAlign: 'center' }}>
                  <Bell size={22} style={{ color: MUTED_TEXT, opacity: 0.6, marginBottom: 8 }} />
                  <p style={{ margin: 0, fontSize: '0.82rem', color: MUTED_TEXT }}>No notifications yet.</p>
                </div>
              )}
              {notifications.map((n) => {
                const Icon = NOTIF_ICONS[n.type] || Bell
                return (
                  <div
                    key={n.id}
                    onClick={() => handleClickNotification(n)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleClickNotification(n) }}
                    style={{
                      display: 'flex', gap: 10, alignItems: 'flex-start', padding: '12px 14px',
                      borderBottom: `1px solid ${CARD_BORDER}`, cursor: 'pointer',
                      background: n.is_read ? 'transparent' : ACCENT_TINT,
                    }}
                  >
                    <span style={{ flexShrink: 0, marginTop: 2, color: MUTED_TEXT, display: 'flex' }}>
                      <Icon size={16} />
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ margin: 0, fontSize: '0.8rem', fontWeight: n.is_read ? 500 : 700, color: NAVY, lineHeight: 1.4 }}>
                        {n.title}
                      </p>
                      <p style={{ margin: '3px 0 0', fontSize: '0.75rem', color: BODY_TEXT, lineHeight: 1.4 }}>
                        {n.message}
                      </p>
                      <p style={{ margin: '4px 0 0', fontSize: '0.68rem', color: MUTED_TEXT }}>
                        {relativeTime(n.created_at)}
                      </p>
                    </div>
                    {!n.is_read && (
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: ACCENT, flexShrink: 0, marginTop: 5 }} />
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
