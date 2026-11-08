// src/hooks/usePaymentCurrencies.js
//
// The currency codes the add/edit dialog offers: every code in the latest exchange-rate snapshot
// (GET /invoices/exchange-rate/ -> rates_to_usd) plus USD. Fetched once, the first time a dialog asks for it, and kept
// for the life of the Payments page. If that call fails the dialog falls back to the four common codes and says so
// (`failed`); asking again retries.
import { useCallback, useRef, useState } from 'react'

import api from '@/lib/api'
import { CURRENCY_FALLBACK_HINT, FALLBACK_CURRENCY_CODES } from '@/pages/paymentsHelpers'

export { CURRENCY_FALLBACK_HINT }

export default function usePaymentCurrencies() {
  const [keys, setKeys] = useState(null) // null until a fetch succeeds
  const [failed, setFailed] = useState(false)
  const inFlight = useRef(false)

  const ensureLoaded = useCallback(async () => {
    if (keys || inFlight.current) return
    inFlight.current = true
    try {
      const { data } = await api.get('/invoices/exchange-rate/')
      setKeys(Object.keys(data?.rates_to_usd || {}))
      setFailed(false)
    } catch {
      setFailed(true)
    } finally {
      inFlight.current = false
    }
  }, [keys])

  return { codes: keys || FALLBACK_CURRENCY_CODES, failed: failed && !keys, ensureLoaded }
}
