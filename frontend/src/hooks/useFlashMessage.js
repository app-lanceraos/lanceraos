// src/hooks/useFlashMessage.js
//
// A one-shot message handed to a page in history state
// (`navigate(path, { state: { flash: '…' } })`) — Duplicate lands on the new
// draft, Delete lands on the list. Read once on first render, then taken out of
// history state so a reload or Back does not bring it back.
//
// One hook so every page that can be the target of such a navigation behaves
// the same; before it existed only Proposals.jsx read the flash and the
// Duplicate message was silently lost (DECISIONS.md, Proposals frontend part B).
import { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

export default function useFlashMessage() {
  const location = useLocation()
  const navigate = useNavigate()
  const [flash, setFlash] = useState(() => location.state?.flash || null)

  useEffect(() => {
    if (location.state?.flash) {
      navigate(`${location.pathname}${location.search}${location.hash}`, { replace: true, state: null })
    }
    // Once, on mount: the message is already held in state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const dismiss = useCallback(() => setFlash(null), [])
  return [flash, dismiss]
}
