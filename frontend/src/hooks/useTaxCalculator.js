// src/hooks/useTaxCalculator.js
//
// The Tax page's calculator request: POST /tax/calculator/ with { taxable_income, tax_year? }. One request per call; a ref
// lock ignores a second calculate() while one runs (a double press in the same tick is caught too); a request-id guard means a
// late response for an earlier press never overwrites a newer one; clear() bumps the id so a response still on its way is ignored.
// A failure keeps NOTHING of the previous result (a result beside an error would show figures for a different input). There is no
// retry loop. Every setState is guarded against unmount.
import { useCallback, useEffect, useRef, useState } from 'react'

import api from '@/lib/api'
import { CALC_FALLBACK, calculatorBody, calculatorError, calculatorIsUsable } from '@/pages/taxHelpers'

export default function useTaxCalculator() {
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const requestId = useRef(0)
  const running = useRef(false)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const calculate = useCallback(async (value, year) => {
    if (running.current) return
    running.current = true
    const id = ++requestId.current
    setBusy(true)
    setError('')
    try {
      const { data } = await api.post('/tax/calculator/', calculatorBody(value, year))
      if (id !== requestId.current || !mounted.current) return
      if (calculatorIsUsable(data)) {
        setResult(data)
      } else {
        setResult(null)
        setError(CALC_FALLBACK)
      }
    } catch (e) {
      if (id !== requestId.current || !mounted.current) return
      setResult(null)
      setError(calculatorError(e))
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
    }
  }, [])

  return { result, error, busy, calculate, clear }
}
