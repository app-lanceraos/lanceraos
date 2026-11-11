// src/hooks/useDraftAutosave.js
//
// The autosave machinery for ONE draft record, generic over the record type (Prompt 23, F1). It was written for
// Proposals (DECISIONS.md, 03 November 2026 — D3) and promoted here unchanged so Contracts reuse the hardest code in
// the app instead of keeping a second copy that would drift. Each record type supplies a `spec`:
//
//   url(id)                        the record's URL
//   method                         'put' | 'patch'
//   saveKeys                       the top-level fields that can be saved
//   buildSavePayload(form)         form -> the payload of saveable fields
//   diffPayload(current, lastSaved, errors, rejected) -> { payload, withheld }
//   validateForm(form, lastSaved)  -> { errors, savable }
//   fieldErrorsFromResponse(data)  server 400 body -> { field: message }
//   errorMessage(error)            -> { message, ... }
//   notDraftStatuses               (optional) statuses meaning "no longer a draft"; default [403]
//
// Under BrowserRouter there is no useBlocker, so sidebar navigation cannot be intercepted to warn about unsaved
// text: the editor autosaves instead of having a Save button.
//
// useInvoiceAutosave.js is deliberately not reused: it sends the whole form on every save, retries nothing, and has no
// notion of a field the server refused. Its one hard-won lesson IS carried over — never more than one request for a
// record in flight at a time. Aborting a superseded request only stops the CLIENT acting on its response; the server
// may still apply it after the newer one. So a second save is never sent while one is running: triggers that fire
// meanwhile set a flag, and exactly one follow-up goes out with the then-current diff once the first finishes.
//
// What is sent: only the top-level fields that differ from the last-saved snapshot (`diffPayload`), list fields whole.
// A field with a client-side validation error, or one the server already refused at this exact value, is WITHHELD —
// the other changed fields still save.
//
// `flushNow()` resolves true when there is nothing LEFT IT CAN TRY — including when a field is being withheld because
// it is invalid. That is right for its callers (regenerate, the unmount save) and wrong as a gate for an action that
// must not run on stale server data (Send, Duplicate). Those use `readiness()` after the flush: it says whether the
// server holds everything the person sees.
//
// What is never done here: the form is never written to. The server's reply reaches the page through
// `onSaved(data, sentPayload)` and the page merges only server-computed values; adopting the echoed text would
// overwrite keystrokes typed while the request was in flight.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import api from '@/lib/api'

export const AUTOSAVE_DEBOUNCE_MS = 1500
export const AUTOSAVE_MAX_WAIT_MS = 10000
// Network drop / timeout / 5xx: three automatic retries, then it settles in
// `error` with a manual Retry.
export const AUTOSAVE_RETRY_DELAYS_MS = [2000, 5000, 15000]
export const AUTOSAVE_RATE_LIMIT_RETRY_MS = 60000

const isEmpty = (payload) => Object.keys(payload).length === 0
const valuesEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b)

function retryAfterMs(error) {
  const header = error?.response?.headers?.['retry-after']
  const seconds = Number(header)
  return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : AUTOSAVE_RATE_LIMIT_RETRY_MS
}

/**
 * @param {object} spec - see the header above; it must be a stable, module-level object
 * @param {object} args
 * @param {string} args.id - the record's id
 * @param {object|null} args.form - current editor form
 * @param {object} args.initialSnapshot - spec.buildSavePayload() of what the server holds right now
 * @param {boolean} args.enabled - false for a non-draft record: nothing is ever scheduled or sent
 * @param {(data: object, sent: object) => void} [args.onSaved] - fresh server detail + the payload that was sent
 * @param {() => void} [args.onNotDraft] - the server said the record is no longer a draft
 * @param {() => void} [args.onNotFound] - the server said 404: the record was deleted elsewhere
 */
export default function useDraftAutosave(spec, {
  id: recordId, form, initialSnapshot, enabled, onSaved, onNotDraft, onNotFound,
}) {
  const {
    saveKeys, buildSavePayload, diffPayload, validateForm, fieldErrorsFromResponse, errorMessage,
  } = spec
  const notDraftStatuses = spec.notDraftStatuses || [403]
  const [status, setStatus] = useState('idle') // 'idle' | 'pending' | 'saving' | 'saved' | 'error' | 'paused'
  const [lastSavedAt, setLastSavedAt] = useState(null)
  const [retrying, setRetrying] = useState(false)
  const [rateLimited, setRateLimited] = useState(false)
  const [stopped, setStopped] = useState(null) // null | 'not_draft' | 'not_found'
  const [lastSaved, setLastSaved] = useState(initialSnapshot)
  const [rejected, setRejected] = useState({}) // { field: value the server refused }
  const [serverErrors, setServerErrors] = useState({}) // { field: message }

  // Everything async code needs, always current, so the callbacks below can be
  // stable (no stale closures over `form` / `enabled` / the callbacks).
  const latest = useRef({})
  const lastSavedRef = useRef(initialSnapshot)
  const rejectedRef = useRef({})
  const mountedRef = useRef(false)
  const stoppedRef = useRef(null)
  const manualPauseRef = useRef(false)
  const rateLimitedRef = useRef(false)
  const everSavedRef = useRef(false)
  const attemptRef = useRef(0)
  const flightRef = useRef(null)
  const followUpRef = useRef(false)
  const debounceRef = useRef(null)
  const maxWaitRef = useRef(null)
  const retryTimerRef = useRef(null)
  const rateTimerRef = useRef(null)

  useLayoutEffect(() => {
    latest.current = { form, enabled, recordId, onSaved, onNotDraft, onNotFound }
  })

  const safe = (fn) => { if (mountedRef.current) fn() }

  const clearTimers = () => {
    clearTimeout(debounceRef.current)
    clearTimeout(maxWaitRef.current)
    debounceRef.current = null
    maxWaitRef.current = null
  }
  const clearBackoff = () => {
    clearTimeout(retryTimerRef.current)
    clearTimeout(rateTimerRef.current)
    retryTimerRef.current = null
    rateTimerRef.current = null
  }

  const computeNow = () => {
    const { form: currentForm } = latest.current
    const snapshot = lastSavedRef.current
    const current = buildSavePayload(currentForm)
    const { errors } = validateForm(currentForm, snapshot)
    return diffPayload(current, snapshot, errors, rejectedRef.current)
  }

  const commitSnapshot = useCallback((partial) => {
    lastSavedRef.current = { ...lastSavedRef.current, ...partial }
    safe(() => setLastSaved(lastSavedRef.current))
  }, [])

  const resetSnapshot = useCallback((next) => {
    lastSavedRef.current = next
    rejectedRef.current = {}
    safe(() => { setLastSaved(next); setRejected({}); setServerErrors({}) })
  }, [])

  // One request, classified. Resolves 'ok' | 'nothing' | 'blocked' | 'rejected' | 'failed'.
  async function saveOnce(autoRetry) {
    const { enabled: isEnabled, recordId: id } = latest.current
    if (!isEnabled || stoppedRef.current || manualPauseRef.current) return 'blocked'

    const { payload, withheld } = computeNow()
    if (isEmpty(payload)) {
      safe(() => setStatus(withheld.length ? 'error' : everSavedRef.current ? 'saved' : 'idle'))
      return 'nothing'
    }

    safe(() => setStatus('saving'))
    try {
      const { data } = await api[spec.method](spec.url(id), payload)
      attemptRef.current = 0
      everSavedRef.current = true
      commitSnapshot(payload)
      safe(() => {
        setRetrying(false)
        setRateLimited(false)
        setServerErrors((prev) => {
          const next = { ...prev }
          for (const key of Object.keys(payload)) delete next[key]
          return next
        })
        setLastSavedAt(Date.now())
        // A field still withheld (invalid, or refused by the server) is NOT saved,
        // so "saved" would be a lie.
        setStatus(debounceRef.current ? 'pending' : computeNow().withheld.length ? 'error' : 'saved')
        latest.current.onSaved?.(data, payload)
      })
      return 'ok'
    } catch (error) {
      return handleFailure(error, payload, autoRetry)
    }
  }

  function handleFailure(error, payload, autoRetry) {
    const code = error?.response?.status

    if (code === 400) {
      const fieldErrors = fieldErrorsFromResponse(error.response.data)
      const sent = Object.keys(payload)
      // A serializer rejects the WHOLE request, so nothing in it was saved. The
      // fields the server named are refused at this value; if it named none we
      // can recognise, treat everything sent as refused rather than loop.
      let refused = Object.keys(fieldErrors).filter((key) => sent.includes(key))
      if (!refused.length) refused = sent
      const fallback = errorMessage(error).message
      rejectedRef.current = { ...rejectedRef.current }
      const messages = {}
      for (const key of refused) {
        rejectedRef.current[key] = payload[key]
        messages[key] = fieldErrors[key] || fallback
      }
      attemptRef.current = 0
      safe(() => {
        setRejected(rejectedRef.current)
        setServerErrors((prev) => ({ ...prev, ...messages }))
        setRetrying(false)
        setStatus('error')
      })
      return 'rejected'
    }

    if (code === 429) {
      rateLimitedRef.current = true
      clearTimers()
      clearTimeout(rateTimerRef.current)
      if (mountedRef.current) {
        rateTimerRef.current = setTimeout(() => {
          rateTimerRef.current = null
          rateLimitedRef.current = false
          safe(() => setRateLimited(false))
          runSave(true)
        }, retryAfterMs(error))
      }
      safe(() => { setRateLimited(true); setRetrying(false); setStatus('paused') })
      return 'failed'
    }

    if (notDraftStatuses.includes(code) || code === 404) {
      stoppedRef.current = code === 404 ? 'not_found' : 'not_draft'
      clearTimers()
      clearBackoff()
      safe(() => {
        setStopped(stoppedRef.current)
        setRetrying(false)
        setStatus('idle')
        if (code === 404) latest.current.onNotFound?.()
        else latest.current.onNotDraft?.()
      })
      return 'blocked'
    }

    // Network drop, timeout, 5xx, anything else unexpected.
    if (autoRetry && mountedRef.current && attemptRef.current < AUTOSAVE_RETRY_DELAYS_MS.length) {
      const delay = AUTOSAVE_RETRY_DELAYS_MS[attemptRef.current]
      attemptRef.current += 1
      clearTimeout(retryTimerRef.current)
      retryTimerRef.current = setTimeout(() => { retryTimerRef.current = null; runSave(true) }, delay)
      safe(() => { setRetrying(true); setStatus('error') })
    } else {
      safe(() => { setRetrying(false); setStatus('error') })
    }
    return 'failed'
  }

  // The loop is what makes "one request at a time, one follow-up" true: a
  // trigger that fires while a request is running only sets `followUpRef`, and
  // this loop sends the single follow-up (with whatever the diff is NOW) after
  // the running one finishes. A 400 also loops once more, because the same
  // request had other changed fields in it that were not saved either.
  async function saveLoop(autoRetry) {
    let result = 'nothing'
    for (;;) {
      followUpRef.current = false
      const outcome = await saveOnce(autoRetry)
      if (outcome === 'blocked' || outcome === 'failed') return outcome
      if (outcome === 'rejected') result = 'rejected'
      else if (outcome === 'ok' && result === 'nothing') result = 'ok'
      const more = followUpRef.current || (outcome === 'rejected' && !isEmpty(computeNow().payload))
      if (!more) return result
    }
  }

  function runSave(autoRetry) {
    if (flightRef.current) {
      followUpRef.current = true
      return flightRef.current
    }
    const flight = saveLoop(autoRetry).finally(() => { flightRef.current = null })
    flightRef.current = flight
    return flight
  }

  const fire = () => {
    clearTimers()
    return runSave(true)
  }

  const schedule = () => {
    const { enabled: isEnabled } = latest.current
    if (!isEnabled || stoppedRef.current || manualPauseRef.current || rateLimitedRef.current) return
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(fire, AUTOSAVE_DEBOUNCE_MS)
    // Max wait: continuous typing keeps resetting the debounce, so a separate
    // timer started at the FIRST pending edit guarantees a save every 10 s.
    if (!maxWaitRef.current) maxWaitRef.current = setTimeout(fire, AUTOSAVE_MAX_WAIT_MS)
    // An edit during a backoff wait supersedes it: this fresh debounce saves
    // the then-current diff, so the older timer must not fire a second request.
    clearTimeout(retryTimerRef.current)
    retryTimerRef.current = null
    setStatus((s) => (s === 'saving' ? s : 'pending'))
  }

  // ── Edits -> schedule ────────────────────────────────────────────────
  useEffect(() => {
    if (!form || !enabled) { clearTimers(); return }
    const { payload } = computeNow()
    if (!isEmpty(payload)) schedule()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, enabled])

  // ── Mount / unmount ──────────────────────────────────────────────────
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      clearTimers()
      clearBackoff()
      // Best-effort final save. The SPA keeps running after a route change, so
      // the request completes; nothing below sets state once unmounted. React
      // StrictMode's simulated unmount lands here with nothing to send.
      const { enabled: isEnabled } = latest.current
      if (isEnabled && !stoppedRef.current && !manualPauseRef.current && !isEmpty(computeNow().payload)) {
        runSave(false)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Derived, for the page ────────────────────────────────────────────
  const current = useMemo(() => (form ? buildSavePayload(form) : null), [form])
  const validation = useMemo(() => (form ? validateForm(form, lastSaved) : { errors: {}, savable: true }), [form, lastSaved])
  const diff = useMemo(
    () => (current ? diffPayload(current, lastSaved, validation.errors, rejected) : { payload: {}, withheld: [] }),
    [current, lastSaved, validation, rejected],
  )
  const dirtyKeys = useMemo(
    () => (current ? saveKeys.filter((key) => !valuesEqual(current[key], lastSaved[key])) : []),
    [current, lastSaved],
  )
  // A server error is only shown while the field still holds the refused value.
  const visibleServerErrors = useMemo(() => {
    const out = {}
    for (const [key, message] of Object.entries(serverErrors)) {
      if (current && key in rejected && valuesEqual(current[key], rejected[key])) out[key] = message
    }
    return out
  }, [serverErrors, rejected, current])

  const dirty = enabled && (dirtyKeys.length > 0 || status === 'saving')

  useEffect(() => {
    if (!dirty) return undefined
    const warn = (event) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  // ── Controls ─────────────────────────────────────────────────────────

  // Saves everything savable right now. Resolves true when nothing is left
  // pending or in flight, false if a request failed or a field was refused.
  const flushNow = useCallback(async () => {
    clearTimers()
    clearBackoff()
    rateLimitedRef.current = false
    safe(() => setRateLimited(false))
    if (!latest.current.enabled) return true
    if (stoppedRef.current) return false
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const outcome = await runSave(false)
      if (outcome === 'failed' || outcome === 'rejected') return false
      if (outcome === 'blocked') return !stoppedRef.current
      if (isEmpty(computeNow().payload)) return true
    }
    return false
    // Reads only refs and stable setters; the functions it calls are re-created each render but equivalent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const retry = useCallback(() => {
    clearTimers()
    clearBackoff()
    attemptRef.current = 0
    rateLimitedRef.current = false
    safe(() => { setRateLimited(false); setRetrying(false) })
    return runSave(true)
    // Reads only refs and stable setters; the functions it calls are re-created each render but equivalent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The snapshot as of right now. Unlike the `lastSaved` state it is already
  // updated when onSaved runs, so a page can read "what the server holds"
  // from inside that callback.
  const getSnapshot = useCallback(() => lastSavedRef.current, [])
  // True once the server has said the record is gone or no longer a draft.
  // A ref read, for async code that must not carry on after such a verdict.
  const isStopped = useCallback(() => stoppedRef.current !== null, [])

  // Is everything the person sees also what the server holds? Reads refs, so it
  // is correct inside an async handler right after `await flushNow()`, where the
  // render-time `withheld` / `dirtyKeys` are stale. `unsaved` = fields that
  // differ from the server and could still be sent; `withheld` = fields held
  // back because they are invalid or the server refused them at this value.
  const readiness = useCallback(() => {
    const { payload, withheld: held } = computeNow()
    const unsaved = Object.keys(payload)
    const stoppedNow = stoppedRef.current
    return { ready: unsaved.length === 0 && held.length === 0 && stoppedNow === null, unsaved, withheld: held, stopped: stoppedNow }
    // Reads only refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pause = useCallback(() => {
    manualPauseRef.current = true
    clearTimers()
    clearBackoff()
    safe(() => setStatus('paused'))
  }, [])

  const resume = useCallback(() => {
    manualPauseRef.current = false
    if (isEmpty(computeNow().payload)) safe(() => setStatus(everSavedRef.current ? 'saved' : 'idle'))
    else schedule()
    // Reads only refs and stable setters; the functions it calls are re-created each render but equivalent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return {
    status, lastSavedAt, retrying, rateLimited, stopped,
    dirty, dirtyKeys, withheld: diff.withheld,
    validation: validation.errors, serverErrors: visibleServerErrors,
    lastSaved,
    flushNow, retry, pause, resume, commitSnapshot, resetSnapshot, getSnapshot, isStopped, readiness,
  }
}
