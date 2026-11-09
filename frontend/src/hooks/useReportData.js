// src/hooks/useReportData.js
//
// Loads one report (GET path?params) for a report page. Params are compared by JSON.stringify, so a new object with the
// same values does not refetch. A request-id guard means a late response for a period the person has already left never
// overwrites a newer one, and the loading flag is cleared only by the latest request. While a new period loads the previous
// `data` stays (the page dims it); on an error `data` becomes null — figures for a period the person has left are never shown
// beside an error. There is no retry loop: reload() is the only retry. enabled:false sends nothing, clears the error and the figures.
import { useCallback, useEffect, useRef, useState } from 'react'

import api from '@/lib/api'
import { loadErrorMessage } from '@/pages/reportsHelpers'

export default function useReportData({ path, params, enabled = true }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(Boolean(enabled))
  const [error, setError] = useState('')
  const requestId = useRef(0)
  const key = JSON.stringify(params ?? {})
  const paramsRef = useRef(params)
  paramsRef.current = params
  const pathRef = useRef(path)
  pathRef.current = path

  const load = useCallback(async () => {
    const id = ++requestId.current
    setLoading(true)
    setError('')
    try {
      const { data: body } = await api.get(pathRef.current, { params: paramsRef.current })
      if (id !== requestId.current) return
      setData(body)
    } catch (e) {
      if (id !== requestId.current) return
      setData(null)
      setError(loadErrorMessage(e))
    } finally {
      if (id === requestId.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!enabled) {
      requestId.current += 1 // a response still on its way for the old period is ignored
      setData(null)
      setLoading(false)
      setError('')
      return undefined
    }
    load()
    return () => { requestId.current += 1 }
  }, [enabled, key, path, load])

  const reload = useCallback(() => { if (enabled) load() }, [enabled, load])

  return { data, loading, error, reload }
}
