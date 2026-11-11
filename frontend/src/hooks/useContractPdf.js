// src/hooks/useContractPdf.js
//
// Downloads a contract PDF as a BLOB request, never a plain link: a PDF that can be refused with a sentence (a contract
// not signed yet, a rate limit) must be fetched so the sentence can be shown. The error body of a blob request is itself
// a Blob, so it is read back as text. A second call while one is running is ignored (a ref, so a double click in the
// same tick is caught too). Every setState is guarded against unmount.
//
// The HTTP client is passed in: the owner's pages give it the shared `api`, the client's public page gives it
// `publicApi`. Written beside useReportDownload rather than reusing it because that hook is bound to `api` and its
// sentences talk about reports (Prompt 23, decision on 7b).
import { useCallback, useEffect, useRef, useState } from 'react'

import { blobToText, downloadBlob } from '@/lib/downloadBlob'
import { PDF_COPY } from '@/pages/contractCopy'
import { filenameFromDisposition } from '@/pages/reportsHelpers'

export const PDF_TIMEOUT_MS = 60000

/** A failed PDF request -> one sentence. `bodyText` is the error blob's text ('' when there was none). */
export function pdfErrorMessage(error, bodyText = '') {
  const response = error?.response
  if (!response) return error?.code === 'ECONNABORTED' ? PDF_COPY.timeout : PDF_COPY.network
  if (response.status === 429) return PDF_COPY.rateLimit
  try {
    const body = JSON.parse(bodyText || '')
    if (body && typeof body === 'object' && typeof body.error === 'string' && body.error) return body.error
  } catch {
    // not JSON: the generic sentence
  }
  return PDF_COPY.fallback
}

export default function useContractPdf(http) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const running = useRef(false)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const clearError = useCallback(() => setError(''), [])

  const download = useCallback(async ({ path, fallbackName = 'contract.pdf' }) => {
    if (running.current) return { ok: false, ignored: true }
    running.current = true
    setBusy(true)
    setError('')
    try {
      const response = await http.get(path, { responseType: 'blob', timeout: PDF_TIMEOUT_MS })
      const blob = response.data
      if (!blob || (blob.type && blob.type !== 'application/pdf')) {
        // A 200 that is not a PDF is never saved as a file.
        if (mounted.current) setError(PDF_COPY.fallback)
        return { ok: false }
      }
      const filename = filenameFromDisposition(response.headers?.['content-disposition'], fallbackName)
      downloadBlob(blob, filename)
      return { ok: true, filename }
    } catch (e) {
      const text = e?.response?.data ? await blobToText(e.response.data).catch(() => '') : ''
      const message = pdfErrorMessage(e, text)
      if (mounted.current) setError(message)
      return { ok: false, message }
    } finally {
      running.current = false
      if (mounted.current) setBusy(false)
    }
  }, [http])

  return { busy, error, clearError, download }
}
