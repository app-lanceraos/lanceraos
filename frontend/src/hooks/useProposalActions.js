// src/hooks/useProposalActions.js
//
// The header actions that work the same on every proposal page: Duplicate (any
// status), Delete (drafts) and Copy link (anything that has been sent). Owns
// the one in-page message these produce.
//
// `beforeDuplicate` (draft editor only) is the readiness gate — it resolves
// true (go ahead), false (the latest edits could not be saved: say so, copy
// nothing) or null (the page is already reloading: stay silent).
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import api from '@/lib/api'
import useTimedMessage from '@/hooks/useTimedMessage'
import { errorMessage } from '@/pages/proposalHelpers'

const COPIED_RESET_MS = 2000

export default function useProposalActions({ detail, onNotDraft, beforeDuplicate, pauseSaving, resumeSaving }) {
  const navigate = useNavigate()
  const { message, show, clear } = useTimedMessage()
  const [busy, setBusy] = useState(null) // null | 'duplicate' | 'delete'
  const [linkCopied, setLinkCopied] = useState(false)
  const copiedTimer = useRef(null)

  useEffect(() => () => clearTimeout(copiedTimer.current), [])

  function failed(error, fallback) {
    const { message: text, status } = errorMessage(error, fallback)
    // A draft-only action refused because the proposal is no longer a draft.
    if (status === 403) onNotDraft()
    else show('error', text)
  }

  async function duplicate() {
    setBusy('duplicate')
    clear()
    try {
      if (beforeDuplicate) {
        const go = await beforeDuplicate()
        if (go === null) return
        if (!go) {
          show('error', "We couldn't save your latest changes, so nothing was copied.")
          return
        }
      }
      const { data } = await api.post(`/proposals/${detail.id}/duplicate/`)
      navigate(`/proposals/${data.id}`, { state: { flash: 'Copied as a new draft. Set a new valid-until date before sending.' } })
    } catch (error) {
      failed(error, "We couldn't copy this proposal. Please try again.")
    } finally {
      setBusy(null)
    }
  }

  async function remove() {
    setBusy('delete')
    clear()
    // A save landing on a proposal that is about to be deleted would 404.
    pauseSaving?.()
    try {
      await api.delete(`/proposals/${detail.id}/`)
      navigate('/proposals', { state: { flash: 'Proposal deleted.' } })
      return true
    } catch (error) {
      resumeSaving?.()
      failed(error, "We couldn't delete this proposal. Please try again.")
      setBusy(null)
      return false
    }
  }

  async function copyLink() {
    if (!detail.public_url) return
    clearTimeout(copiedTimer.current)
    try {
      await navigator.clipboard.writeText(detail.public_url)
      setLinkCopied(true)
      copiedTimer.current = setTimeout(() => setLinkCopied(false), COPIED_RESET_MS)
    } catch {
      show('error', `Your browser wouldn't copy it. The link is ${detail.public_url}`)
    }
  }

  return { busy, message, clear, show, duplicate, remove, failed, copyLink, linkCopied }
}
