// src/hooks/useNotificationSocket.js
//
// Global, single connection to core.consumers.NotificationConsumer
// (ws/notifications/) — the bell's live-push transport. Owned by
// AppShell (the bell is global chrome, not per-page — CLAUDE.md's own
// rule for this hook family), never opened per-page. Built on the
// shared useWebSocket hook, never a raw WebSocket directly.
//
// Two real message kinds arrive from the server (core/consumers.py):
//   'notification' — a brand-new notification for this user
//     (core.observability.log_event() -> core.notifications.
//     broadcast_notification, fired for every NOTIFICATION_EVENTS-listed
//     AuditLog write, from any app, with zero per-app wiring — see
//     DECISIONS.md). Carries the new notification plus a freshly
//     recomputed unread_count.
//   'refresh' — this user's notification state changed elsewhere
//     (another browser tab marked something read/dismissed) — carries
//     only the recomputed unread_count; the caller decides whether it
//     also needs to refetch the full list (e.g. because the panel is
//     currently open).
//
// Same graceful-degradation contract as CommentThread.jsx's own use of
// useWebSocket: while the socket is down (still negotiating on first
// load, or genuinely unavailable), fall back to polling on an interval
// so the badge never goes silently stale. useWebSocket itself now
// retries the underlying connection with exponential backoff, so this
// polling is a temporary bridge, not the steady state.
import { useEffect, useRef } from 'react'

import useWebSocket from './useWebSocket'

const POLL_INTERVAL_MS = 20000

export default function useNotificationSocket({ enabled, onNotification, onRefresh, onPoll }) {
  const pollRef = useRef(null)
  const onNotificationRef = useRef(onNotification)
  const onRefreshRef = useRef(onRefresh)
  const onPollRef = useRef(onPoll)
  onNotificationRef.current = onNotification
  onRefreshRef.current = onRefresh
  onPollRef.current = onPoll

  const { connected } = useWebSocket(enabled ? '/ws/notifications/' : null, {
    onMessage: (payload) => {
      if (payload.kind === 'notification') {
        onNotificationRef.current?.(payload.notification, payload.unread_count)
      } else if (payload.kind === 'refresh') {
        onRefreshRef.current?.(payload.unread_count)
      }
    },
  })

  useEffect(() => {
    if (!enabled) return undefined
    if (connected) {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
      return undefined
    }
    // Not connected (socket still negotiating, or genuinely
    // unavailable) — poll so the badge/list still stay current, just
    // not instantly, until useWebSocket's own reconnect succeeds.
    pollRef.current = setInterval(() => onPollRef.current?.(), POLL_INTERVAL_MS)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [connected, enabled])

  return { connected }
}
