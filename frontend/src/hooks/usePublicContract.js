// src/hooks/usePublicContract.js
//
// Everything the client's signing page asks of the server: read the contract, sign it, decline it, download the signed
// copy (Prompt 23, F14 and F15). It talks to the backend ONLY through `publicApi`, a bare Axios instance with no
// interceptors, so answering can never trigger the CSRF prefetch to /auth/, read a cookie, or reach the refresh ->
// forced-logout path. It imports neither the auth store nor the shared `api`, and keeps no cookie or browser storage of
// its own.
//
// Rules:
//   * One request per answer. A ref lock makes a double click, double Enter or double tap send one request, and an
//     answer is NEVER retried automatically.
//   * An ambiguous failure (no reply, a timeout, a 5xx or a page that is not ours) does not tell the person "failed" and
//     does not send the answer again: the contract is READ, and what is on record decides.
//       sign:    signed with the name just submitted        -> the person's own signature
//                signed with another name / declined /
//                withdrawn / expired                         -> the answer on record, "answered differently"
//                still open                                 -> "we couldn't record it", the form is free again
//                the read fails too                         -> "we couldn't tell", the form stays locked until reload
//       decline: declined                                   -> success (the outcome wanted is on record)
//                signed / withdrawn / expired               -> "answered differently"
//   * A reply of ours is handled by its machine `reason`, never by its message text: owner, already_answered, withdrawn,
//     expired, integrity.
//   * A request-id guard and an AbortController mean a slow older read can never overwrite a newer one, and nothing
//     sets state after the page is gone.
import { useCallback, useEffect, useRef, useState } from 'react'

import useContractPdf from '@/hooks/useContractPdf'
import { publicApi } from '@/lib/api'
import { PUBLIC_COPY } from '@/pages/contractCopy'
import { normaliseName } from '@/pages/contractHelpers'

const NOTICES = PUBLIC_COPY.notices
const NAME_SENTENCES = new Set([PUBLIC_COPY.nameRequired, PUBLIC_COPY.nameLength, PUBLIC_COPY.nameNeedsLetters])

// Which field a server 400 sentence belongs under.
function fieldFor(message) {
  if (NAME_SENTENCES.has(message)) return 'name'
  if (message === PUBLIC_COPY.agreeRequired) return 'agree'
  if (/characters too long/i.test(message)) return 'reason'
  return null
}

export default function usePublicContract(token) {
  const [view, setView] = useState('loading') // loading | ready | not_found | rate_limited | error
  const [data, setData] = useState(null)
  const [notice, setNotice] = useState(null)
  const [answerError, setAnswerError] = useState(null) // { text, field } | null
  const [submitting, setSubmitting] = useState(false)
  const [locked, setLocked] = useState(null) // null | 'unknown' | 'integrity'
  const [reloadKey, setReloadKey] = useState(0)

  const mountedRef = useRef(true)
  const submitRef = useRef(false)
  const lockedRef = useRef(null)
  const requestIdRef = useRef(0)
  const controllerRef = useRef(null)
  const pdf = useContractPdf(publicApi)

  const encoded = encodeURIComponent(token)

  const lock = useCallback((reason) => {
    lockedRef.current = reason
    setLocked(reason)
  }, [])

  // One read at a time; a newer one (or leaving the page) cancels the older.
  const fetchContract = useCallback(async () => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    requestIdRef.current += 1
    const id = requestIdRef.current
    const stale = () => controller.signal.aborted || id !== requestIdRef.current || !mountedRef.current
    try {
      const response = await publicApi.get(`/contracts/public/${encoded}/`, { signal: controller.signal })
      if (stale()) return { ok: false, aborted: true }
      return { ok: true, data: response.data }
    } catch (error) {
      if (stale() || error?.code === 'ERR_CANCELED') return { ok: false, aborted: true }
      return { ok: false, status: error.response?.status ?? null }
    }
  }, [encoded])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      controllerRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    setView('loading')
    setNotice(null)
    setAnswerError(null)
    lockedRef.current = null
    setLocked(null)
    fetchContract().then((result) => {
      if (result.aborted) return
      if (result.ok) { setData(result.data); setView('ready') }
      else setView(result.status === 404 ? 'not_found' : result.status === 429 ? 'rate_limited' : 'error')
    })
  }, [fetchContract, reloadKey])

  const reload = useCallback(() => setReloadKey((key) => key + 1), [])
  const clearNotice = useCallback(() => setNotice(null), [])

  // The server told us something changed under us: read the contract again and say so.
  const refetchWithNotice = useCallback(async (text, fallbackError) => {
    const result = await fetchContract()
    if (result.aborted) return
    if (result.ok) {
      setData(result.data)
      setView('ready')
      setNotice(text)
    } else {
      setAnswerError({ text: fallbackError || text, field: null })
    }
  }, [fetchContract])

  // An ambiguous failure: look at what is on record. `kind` is 'sign' or 'decline'.
  const recover = useCallback(async (kind, name) => {
    const result = await fetchContract()
    if (result.aborted) return { ok: false }
    if (!result.ok) {
      lock('unknown')
      setAnswerError({ text: NOTICES.ambiguousUnknown, field: null })
      return { ok: false }
    }
    const fresh = result.data
    const own = kind === 'sign'
      ? fresh.state === 'signed' && Boolean(fresh.client_signature) && normaliseName(fresh.client_signature.name) === normaliseName(name)
      : fresh.state === 'declined'
    if (own) {
      setData(fresh)
      setView('ready')
      return { ok: true, recovered: true }
    }
    if (fresh.state === 'open') {
      setAnswerError({ text: NOTICES.ambiguous, field: null })
      return { ok: false }
    }
    setData(fresh)
    setView('ready')
    setNotice(fresh.state === 'expired' ? NOTICES.expiredRace : NOTICES.answeredDifferently)
    return { ok: false }
  }, [fetchContract, lock])

  const handleFailure = useCallback(async (error, kind, name) => {
    const response = error?.response
    const status = response?.status ?? null
    const body = response?.data
    const message = body && typeof body === 'object' && typeof body.error === 'string' ? body.error : ''
    const reason = body && typeof body === 'object' && typeof body.reason === 'string' ? body.reason : null

    // Replies of OUR application, by machine reason.
    if (response && message) {
      if (status === 404) { setView('not_found'); return { ok: false } }
      if (status === 429) { setAnswerError({ text: NOTICES.answer429, field: null }); return { ok: false } }
      if (status === 403 && reason === 'owner') { await refetchWithNotice(NOTICES.owner); return { ok: false } }
      if (status === 409) {
        if (reason === 'integrity') {
          lock('integrity')
          setAnswerError({ text: message, field: null })
          return { ok: false }
        }
        const text = reason === 'withdrawn' ? NOTICES.withdrawnRace
          : reason === 'expired' ? NOTICES.expiredRace
            : NOTICES.alreadyAnswered
        await refetchWithNotice(text)
        return { ok: false }
      }
      if (status === 400) {
        setAnswerError({ text: message, field: fieldFor(message) })
        return { ok: false }
      }
    }
    // Anything else: the request may have been processed. Look; never send it again.
    return recover(kind, name)
  }, [lock, recover, refetchWithNotice])

  const submit = useCallback(async (kind, body, name) => {
    if (submitRef.current || lockedRef.current) return { ok: false, ignored: true }
    submitRef.current = true
    setSubmitting(true)
    setAnswerError(null)
    setNotice(null)
    try {
      const response = await publicApi.post(`/contracts/public/${encoded}/${kind === 'sign' ? 'sign' : 'decline'}/`, body)
      if (!mountedRef.current) return { ok: true }
      setData(response.data)
      setView('ready')
      return { ok: true }
    } catch (error) {
      if (!mountedRef.current) return { ok: false }
      return await handleFailure(error, kind, name)
    } finally {
      submitRef.current = false
      if (mountedRef.current) setSubmitting(false)
    }
  }, [encoded, handleFailure])

  /** Signs with the name as typed; `agree` is the boolean true. */
  const sign = useCallback((typedName) => submit('sign', { signer_name: typedName, agree: true }, typedName), [submit])
  const decline = useCallback((reasonText) => submit('decline', { reason: reasonText }, ''), [submit])

  const { download: pdfDownload } = pdf
  const downloadPdf = useCallback(
    () => pdfDownload({ path: `/contracts/public/${encoded}/pdf/`, fallbackName: 'contract.pdf' }),
    [pdfDownload, encoded],
  )

  return {
    view, data, notice, clearNotice, answerError, clearAnswerError: () => setAnswerError(null), submitting, locked,
    sign, decline, reload,
    pdf: { busy: pdf.busy, error: pdf.error, clearError: pdf.clearError, download: downloadPdf },
  }
}
