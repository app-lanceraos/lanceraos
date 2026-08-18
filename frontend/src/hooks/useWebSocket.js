// src/hooks/useWebSocket.js
//
// The shared WebSocket hook CLAUDE.md's own frontend rules require
// ("WebSocket connection is managed by a shared hook... Never open
// WebSocket connections directly inside page components") — this file
// existed as an empty placeholder before Step 13 (the comment thread,
// apps/invoices/consumers.py's ClientThreadConsumer) became this
// project's first real WebSocket feature and the first real consumer.
//
// Cookies (the httpOnly freelancer JWT or the httpOnly portal-session
// cookie — apps/invoices/consumers.py accepts either) are attached to
// the WebSocket handshake automatically by the browser, exactly like any
// other same-origin request — httpOnly only blocks JS-side
// document.cookie reads, never the browser's own automatic attachment.
// Nothing extra needs doing here for auth to work.
//
// Reconnects automatically with exponential backoff (1s, 2s, 4s, ...
// capped at 30s) on every close/error, resetting the backoff the moment
// a connection actually opens. Before this, a dropped socket (network
// blip, laptop sleep, backend restart) never came back on its own — a
// caller's own poll-while-disconnected fallback (CommentThread.jsx,
// useNotificationSocket.js) was the only thing that ever ran again, for
// the rest of the page's life. Callers that don't need this can still
// ignore it entirely; `connected` is the only thing they read.
//
// Real bug fixed: "WebSocket connection ... failed: WebSocket is closed
// before the connection is established" was showing up in the console
// on every fast mount/unmount — a panel (InvoiceDetailPanel) opening and
// closing before the handshake finished, or React StrictMode's dev-only
// mount->cleanup->mount double-invoke of this same effect. Root cause:
// cleanup unconditionally called ws.close() even while the socket was
// still CONNECTING, which is exactly what triggers that browser warning.
// Fixed by never closing a CONNECTING socket directly — onopen itself
// checks `stopped` and closes cleanly the moment the handshake actually
// finishes, and cleanup only calls close() outright once the socket is
// past CONNECTING.
import { useEffect, useRef, useState } from 'react'

const WS_BASE_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:8000'
const MAX_RECONNECT_DELAY_MS = 30000

// path: e.g. '/ws/invoices/thread/<view_token>/' — pass null/undefined to
// stay disconnected (e.g. while the view_token hasn't loaded yet).
export default function useWebSocket(path, { onMessage } = {}) {
  const [connected, setConnected] = useState(false)
  const onMessageRef = useRef(onMessage)
  onMessageRef.current = onMessage

  useEffect(() => {
    if (!path) {
      setConnected(false)
      return undefined
    }

    let ws = null
    let reconnectTimer = null
    let attempt = 0
    let stopped = false

    const connect = () => {
      const socket = new WebSocket(`${WS_BASE_URL}${path}`)
      ws = socket

      socket.onopen = () => {
        if (stopped) {
          // Cleanup already ran while this handshake was still in
          // flight (fast unmount, or StrictMode's double-invoke). Close
          // it now that it's actually OPEN, never while CONNECTING —
          // that's the deferred half of the fix, see this file's own
          // header comment.
          socket.close()
          return
        }
        attempt = 0
        setConnected(true)
      }
      socket.onclose = () => {
        setConnected(false)
        if (stopped) return
        const delay = Math.min(1000 * 2 ** attempt, MAX_RECONNECT_DELAY_MS)
        attempt += 1
        reconnectTimer = setTimeout(connect, delay)
      }
      // A WebSocket always fires onclose right after onerror — the
      // reconnect is scheduled there, not here, so it's never scheduled
      // twice for the same failure.
      socket.onerror = () => setConnected(false)
      socket.onmessage = (event) => {
        try {
          onMessageRef.current?.(JSON.parse(event.data))
        } catch {
          // Malformed frame — ignore rather than crash the connection.
        }
      }
    }

    connect()

    return () => {
      stopped = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      // Only close outright once the handshake has actually settled
      // (OPEN, or already CLOSING/CLOSED). While still CONNECTING, the
      // onopen guard above finishes the teardown itself the moment the
      // handshake completes — closing here instead is what produced the
      // browser's "closed before the connection is established" console
      // warning on every fast mount/unmount.
      if (ws && ws.readyState !== WebSocket.CONNECTING) {
        ws.close()
      }
    }
  }, [path])

  return { connected }
}
