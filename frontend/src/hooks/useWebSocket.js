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
import { useEffect, useRef, useState } from 'react'

const WS_BASE_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:8000'

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

    const ws = new WebSocket(`${WS_BASE_URL}${path}`)

    ws.onopen = () => setConnected(true)
    ws.onclose = () => setConnected(false)
    ws.onerror = () => setConnected(false)
    ws.onmessage = (event) => {
      try {
        onMessageRef.current?.(JSON.parse(event.data))
      } catch {
        // Malformed frame — ignore rather than crash the connection.
      }
    }

    return () => {
      ws.close()
    }
  }, [path])

  return { connected }
}
