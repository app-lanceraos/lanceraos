// src/hooks/usePaymentImportBatches.js
//
// "Past imports": the list behind the file step. Loaded when the dialog opens (request-id guarded, so a late answer never
// overwrites a newer one); a failure never blocks the upload, it only shows a Retry. Undo asks inline first, sends
// {confirm: true}, shows the result, reloads the list and tells the page so its list and totals refresh.
import { useCallback, useEffect, useRef, useState } from 'react'

import { listBatches, undoBatch } from '@/pages/paymentImportApi'
import { importErrorMessage } from '@/pages/paymentImportHelpers'

export default function usePaymentImportBatches({ onUndone } = {}) {
  const [batches, setBatches] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [confirmingId, setConfirmingId] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [result, setResult] = useState(null) // { removed, kept } of the last undo
  const [undoError, setUndoError] = useState('')
  const latest = useRef(0)
  const alive = useRef(true)
  const undoLock = useRef(false)
  const onUndoneRef = useRef(onUndone)
  onUndoneRef.current = onUndone

  const load = useCallback(async () => {
    const id = ++latest.current
    setLoading(true)
    setLoadError('')
    try {
      const data = await listBatches()
      if (id !== latest.current || !alive.current) return
      setBatches(data.results || [])
    } catch {
      if (id !== latest.current || !alive.current) return
      setLoadError('Could not load your past imports.')
    } finally {
      if (id === latest.current && alive.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    alive.current = true
    load()
    return () => { alive.current = false; latest.current += 1 }
  }, [load])

  const askUndo = useCallback((id) => { setConfirmingId(id); setUndoError(''); setResult(null) }, [])
  const cancelUndo = useCallback(() => setConfirmingId(null), [])

  const confirmUndo = useCallback(async (id) => {
    if (undoLock.current) return
    undoLock.current = true
    setBusyId(id)
    setUndoError('')
    try {
      const data = await undoBatch(id)
      if (!alive.current) return
      setResult({ removed: data.removed, kept: data.kept })
      setConfirmingId(null)
      onUndoneRef.current?.()
      await load()
    } catch (error) {
      if (!alive.current) return
      setUndoError(importErrorMessage(error))
    } finally {
      undoLock.current = false
      if (alive.current) setBusyId(null)
    }
  }, [load])

  return { batches, loading, loadError, confirmingId, busyId, result, undoError, load, askUndo, cancelUndo, confirmUndo }
}
