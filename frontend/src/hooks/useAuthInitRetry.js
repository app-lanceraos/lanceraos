// src/hooks/useAuthInitRetry.js
//
// While the first session check could not reach the server
// (authStore.initError is set), try it again on the two moments a bad
// connection is most likely to have recovered: the browser reporting it is
// back online, and the tab becoming visible again (laptop lid, switching
// back from another app). Each event triggers one retry. Nothing is
// registered, and no timer exists, while initError is null.
import { useEffect } from 'react'

import useAuthStore from '@/store/authStore'

export default function useAuthInitRetry() {
  const initError = useAuthStore((s) => s.initError)

  useEffect(() => {
    if (!initError) return undefined

    const retry = () => useAuthStore.getState().retryInitialize()
    const onVisibility = () => {
      if (document.visibilityState === 'visible') retry()
    }

    window.addEventListener('online', retry)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('online', retry)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [initError])
}
