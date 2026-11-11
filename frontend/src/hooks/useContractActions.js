// src/hooks/useContractActions.js
//
// The header actions that work the same on every contract page: Duplicate (any status), Delete (drafts), Copy link (anything
// that has been sent) and the PDF download. Owns the one in-page message these produce. Each action has a ref lock and an
// unmount guard.
//
// `beforeDuplicate` (draft editor only) is the readiness gate: it resolves true (go ahead), false (the latest edits could
// not be saved: say so, copy nothing) or null (the page is already reloading: stay silent). Withdraw has its own dialog
// (WithdrawContractDialog) because it needs a confirm step and a way to settle a lost answer.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import api from '@/lib/api'
import useContractPdf from '@/hooks/useContractPdf'
import useTimedMessage from '@/hooks/useTimedMessage'
import { OWNER_COPY } from '@/pages/contractCopy'
import { errorMessage } from '@/pages/contractHelpers'

const COPIED_RESET_MS = 2000

export default function useContractActions({ detail, onNotDraft, beforeDuplicate, pauseSaving, resumeSaving }) {
  const navigate = useNavigate()
  const { message, show, clear } = useTimedMessage()
  const [busy, setBusy] = useState(null) // null | 'duplicate' | 'delete'
  const [linkCopied, setLinkCopied] = useState(false)
  const copiedTimer = useRef(null)
  const running = useRef(false)
  const mounted = useRef(true)
  const pdf = useContractPdf(api)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; clearTimeout(copiedTimer.current) }
  }, [])

  const failed = useCallback((error, fallback) => {
    const { message: text, status } = errorMessage(error, fallback)
    // A draft-only action refused because the contract is no longer a draft.
    if (status === 403) onNotDraft?.()
    else if (mounted.current) show('error', text)
  }, [onNotDraft, show])

  async function duplicate() {
    if (running.current) return
    running.current = true
    setBusy('duplicate')
    clear()
    try {
      if (beforeDuplicate) {
        const go = await beforeDuplicate()
        if (go === null) return
        if (!go) {
          if (mounted.current) show('error', OWNER_COPY.waitForSave)
          return
        }
      }
      const { data } = await api.post(`/contracts/${detail.id}/duplicate/`)
      if (mounted.current) navigate(`/contracts/${data.id}`, { state: { flash: OWNER_COPY.duplicated } })
    } catch (error) {
      failed(error, OWNER_COPY.duplicateFailed)
    } finally {
      running.current = false
      if (mounted.current) setBusy(null)
    }
  }

  async function remove() {
    if (running.current) return false
    running.current = true
    setBusy('delete')
    clear()
    // A save landing on a contract that is about to be deleted would 404.
    pauseSaving?.()
    try {
      await api.delete(`/contracts/${detail.id}/`)
      if (mounted.current) navigate('/contracts', { state: { flash: OWNER_COPY.deleted } })
      return true
    } catch (error) {
      resumeSaving?.()
      failed(error, OWNER_COPY.deleteFailed)
      if (mounted.current) setBusy(null)
      return false
    } finally {
      running.current = false
    }
  }

  async function copyLink() {
    if (!detail.public_url) return
    clearTimeout(copiedTimer.current)
    try {
      await navigator.clipboard.writeText(detail.public_url)
      if (!mounted.current) return
      setLinkCopied(true)
      copiedTimer.current = setTimeout(() => { if (mounted.current) setLinkCopied(false) }, COPIED_RESET_MS)
    } catch {
      if (mounted.current) show('error', OWNER_COPY.linkCopyFailed)
    }
  }

  const { download: pdfDownload } = pdf
  const downloadPdf = useCallback(
    () => pdfDownload({ path: `/contracts/${detail.id}/pdf/`, fallbackName: detail.contract_number ? `${detail.contract_number}.pdf` : 'contract.pdf' }),
    [pdfDownload, detail.id, detail.contract_number],
  )

  return {
    busy, message, clear, show, duplicate, remove, failed, copyLink, linkCopied,
    pdfBusy: pdf.busy, pdfError: pdf.error, clearPdfError: pdf.clearError, downloadPdf,
  }
}
