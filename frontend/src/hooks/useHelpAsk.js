// src/hooks/useHelpAsk.js
//
// The Help page's ask request: POST /help/ask/ with exactly { question }. One request per call; a ref lock ignores a second ask()
// while one runs (a double press in the same tick is caught too); a request-id guard means a late response for an earlier call
// never overwrites a newer one; clear() bumps the id so a response still on its way is ignored. A failure keeps NOTHING of an
// earlier result (an answer beside an error would belong to a different question). There is no retry loop: pressing Ask again is
// the retry. The call carries its own timeout because the server's AI budget (25 s) is longer than the shared instance's 15 s.
// Every setState is guarded against unmount. `question` is the trimmed text of the call that produced `result` or `error`; it
// lives in this hook only, never in the URL or in storage.
import { useCallback, useEffect, useRef, useState } from 'react'

import api from '@/lib/api'
import { ASK_FALLBACK, ASK_TIMEOUT_MS, askBody, askErrorMessage, askIsUsable, canAsk, searchQuery } from '@/pages/helpHelpers'

export default function useHelpAsk() {
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [question, setQuestion] = useState('')
  const requestId = useRef(0)
  const running = useRef(false)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const ask = useCallback(async (text) => {
    if (running.current || !canAsk(text)) return
    running.current = true
    const id = ++requestId.current
    setResult(null)
    setError('')
    setBusy(true)
    setQuestion(searchQuery(text))
    try {
      const { data } = await api.post('/help/ask/', askBody(text), { timeout: ASK_TIMEOUT_MS })
      if (id !== requestId.current || !mounted.current) return
      if (askIsUsable(data)) {
        setResult(data)
      } else {
        setResult(null)
        setError(ASK_FALLBACK)
      }
    } catch (e) {
      if (id !== requestId.current || !mounted.current) return
      setResult(null)
      setError(askErrorMessage(e))
    } finally {
      if (id === requestId.current) {
        running.current = false
        if (mounted.current) setBusy(false)
      }
    }
  }, [])

  const clear = useCallback(() => {
    requestId.current += 1
    running.current = false
    if (mounted.current) {
      setResult(null)
      setError('')
      setBusy(false)
      setQuestion('')
    }
  }, [])

  return { result, error, busy, question, ask, clear }
}
