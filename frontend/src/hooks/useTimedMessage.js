// src/hooks/useTimedMessage.js
import { useCallback, useRef, useState } from 'react'

/**
 * Manages a single dismissible status message (success/error/info/warning)
 * for one section of a form. Success and info messages auto-dismiss;
 * errors stay until the user acts (changes a field, retries, etc.) so
 * they don't lose the message before reading it.
 */
export default function useTimedMessage() {
  const [message, setMessage] = useState(null) // { type, text } | null
  const timerRef = useRef(null)

  const show = useCallback((type, text, { autoDismissMs } = {}) => {
    clearTimeout(timerRef.current)
    setMessage({ type, text })
    const shouldAutoDismiss = autoDismissMs ?? (type === 'success' || type === 'info' ? 5000 : null)
    if (shouldAutoDismiss) {
      timerRef.current = setTimeout(() => setMessage(null), shouldAutoDismiss)
    }
  }, [])

  const clear = useCallback(() => {
    clearTimeout(timerRef.current)
    setMessage(null)
  }, [])

  return { message, show, clear }
}