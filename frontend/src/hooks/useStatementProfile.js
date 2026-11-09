// src/hooks/useStatementProfile.js
//
// Reads GET /auth/profile/ once and keeps ONLY what the Income Statement page needs: the identity the PDF prints (an
// allowlist mirrored by reduceProfile) plus two booleans, hasCnic and hasNtn. The profile endpoint returns the CNIC and NTN
// decrypted; reduceProfile drops the digits in the same .then that reads them, so they never reach state, props, a log or a
// test snapshot. Request-id guard and unmount guard like every other loader on these pages.
import { useCallback, useEffect, useRef, useState } from 'react'

import api from '@/lib/api'
import { reduceProfile } from '@/pages/reportsHelpers'

export default function useStatementProfile() {
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const requestId = useRef(0)
  const mounted = useRef(true)

  const load = useCallback(() => {
    const id = ++requestId.current
    setLoading(true)
    setFailed(false)
    api.get('/auth/profile/')
      .then(({ data }) => {
        const reduced = reduceProfile(data) // the digits are discarded here
        if (id === requestId.current && mounted.current) setProfile(reduced)
      })
      .catch(() => {
        if (id === requestId.current && mounted.current) { setProfile(null); setFailed(true) }
      })
      .finally(() => {
        if (id === requestId.current && mounted.current) setLoading(false)
      })
  }, [])

  useEffect(() => {
    mounted.current = true
    load()
    return () => { mounted.current = false; requestId.current += 1 }
  }, [load])

  return { profile, loading, failed, reload: load }
}
