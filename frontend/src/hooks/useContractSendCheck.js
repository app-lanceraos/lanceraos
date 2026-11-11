// src/hooks/useContractSendCheck.js
//
// The Send dialog's checklist, read from the SERVER (GET /contracts/<id>/send-check/?method=). The server runs the same
// function the real send runs, so the checklist and the send can never disagree (Prompt 23, F2). Refetches when the method
// changes and on `refresh()`. A request-id guard means a slow earlier answer never overwrites a newer one, and an
// unmounted dialog never sets state.
import { useCallback, useEffect, useRef, useState } from 'react'

import api from '@/lib/api'

export default function useContractSendCheck(contractId, method) {
  const [state, setState] = useState({ status: 'loading', checks: [], warnings: [], ready: false, message: '' })
  const requestId = useRef(0)
  const mounted = useRef(true)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useEffect(() => {
    requestId.current += 1
    const mine = requestId.current
    const controller = new AbortController()
    setState((current) => ({ ...current, status: 'loading' }))
    api.get(`/contracts/${contractId}/send-check/`, { params: { method }, signal: controller.signal })
      .then(({ data }) => {
        if (!mounted.current || mine !== requestId.current) return
        setState({ status: 'ready', checks: data.checks || [], warnings: data.warnings || [], ready: Boolean(data.ready), message: '' })
      })
      .catch((error) => {
        if (!mounted.current || mine !== requestId.current || error?.code === 'ERR_CANCELED') return
        const notDraft = error?.response?.status === 409 && error?.response?.data?.reason === 'not_draft'
        setState({ status: notDraft ? 'not_draft' : 'error', checks: [], warnings: [], ready: false, message: error?.response?.data?.error || '' })
      })
    return () => controller.abort()
  }, [contractId, method, tick])

  const refresh = useCallback(() => setTick((value) => value + 1), [])
  return {
    checks: state.checks, warnings: state.warnings, ready: state.ready, loading: state.status === 'loading',
    error: state.status === 'error', notDraft: state.status === 'not_draft', message: state.message, refresh,
  }
}
