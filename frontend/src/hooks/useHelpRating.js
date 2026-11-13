// src/hooks/useHelpRating.js
//
// The thumbs up / down on one answer: POST /help/rate/ with exactly { helpful, guides } (the slugs of the guides shown under the
// answer, at most three). status is idle | sending | done | failed. A second press while sending is ignored (a ref lock); `done`
// is final for that answer; a failure sets `failed` and the buttons come back so the person can press again. The state returns to
// idle whenever `result` changes (a new answer is a new thing to rate), and a response for the previous answer is ignored.
import { useCallback, useEffect, useRef, useState } from 'react'

import api from '@/lib/api'
import { ratingBody, ratingErrorMessage, ratingSlugs } from '@/pages/helpHelpers'

export default function useHelpRating(result) {
  const [status, setStatus] = useState('idle')
  const [message, setMessage] = useState('')
  const resultRef = useRef(result)
  const generation = useRef(0)
  const sending = useRef(false)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useEffect(() => {
    resultRef.current = result
    generation.current += 1
    sending.current = false
    setStatus('idle')
    setMessage('')
  }, [result])

  const rate = useCallback(async (helpful) => {
    if (sending.current || status === 'done') return
    const slugs = ratingSlugs(resultRef.current)
    if (slugs.length === 0) return
    sending.current = true
    const mine = generation.current
    setStatus('sending')
    setMessage('')
    try {
      await api.post('/help/rate/', ratingBody(helpful, slugs))
      if (mine !== generation.current || !mounted.current) return
      setStatus('done')
    } catch (e) {
      if (mine !== generation.current || !mounted.current) return
      setStatus('failed')
      setMessage(ratingErrorMessage(e))
    } finally {
      if (mine === generation.current) sending.current = false
    }
  }, [status])

  return { status, message, rate }
}
