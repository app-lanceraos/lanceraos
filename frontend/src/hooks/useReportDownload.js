// src/hooks/useReportDownload.js
//
// Downloads a report PDF as a BLOB request, never a plain link: a PDF that can be refused with a sentence (an empty period,
// a CNIC that is not saved, a rate limit) must be fetched so the sentence can be shown — a link would show the person a raw
// JSON page. The error body of a blob request is itself a Blob, so it is read back as text and parsed. A second call while
// one is running is ignored (a ref, not state, so a double click in the same tick is caught too). Every setState is guarded
// against unmount.
import { useCallback, useEffect, useRef, useState } from 'react'

import api from '@/lib/api'
import { blobToText, downloadBlob } from '@/lib/downloadBlob'
import { DOWNLOAD_FALLBACK, downloadErrorMessage, filenameFromDisposition } from '@/pages/reportsHelpers'

export const PDF_TIMEOUT_MS = 60000

export default function useReportDownload() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const running = useRef(false)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const clearError = useCallback(() => setError(''), [])

  const download = useCallback(async ({ path, params, fallbackName }) => {
    if (running.current) return { ok: false, ignored: true }
    running.current = true
    setBusy(true)
    setError('')
    try {
      const response = await api.get(path, { params, responseType: 'blob', timeout: PDF_TIMEOUT_MS })
      const blob = response.data
      if (!blob || (blob.type && blob.type !== 'application/pdf')) {
        // A 200 that is not a PDF (a JSON body): never saved as a file.
        const text = await blobToText(blob).catch(() => '')
        if (mounted.current) setError(downloadErrorMessage({ response: { status: 200 } }, text))
        return { ok: false }
      }
      const filename = filenameFromDisposition(response.headers?.['content-disposition'], fallbackName)
      downloadBlob(blob, filename)
      return { ok: true, filename }
    } catch (e) {
      const text = e?.response?.data ? await blobToText(e.response.data).catch(() => '') : ''
      if (mounted.current) setError(downloadErrorMessage(e, text) || DOWNLOAD_FALLBACK)
      return { ok: false, message: downloadErrorMessage(e, text) }
    } finally {
      running.current = false
      if (mounted.current) setBusy(false)
    }
  }, [])

  return { busy, error, clearError, download }
}
