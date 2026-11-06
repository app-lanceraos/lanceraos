// src/components/ProposalLinkCard.jsx
//
// The permanent home of the client's link on a sent proposal: a read-only field
// with a Copy button. The warning matters — the backend recognises the owner
// while they are signed in (access cookie, else the refresh cookie, read-only:
// DECISIONS.md "Proposals close-out"), so the same link opened signed out, in a
// private window or on another device counts as the client viewing it. The UI
// still offers Preview and never "Open the public page".
//
// Note: ProposalPublic itself makes no /auth/ request, but App.jsx runs
// authStore.initialize() on every route, so a signed-in browser also sends
// /auth/me/ (and, with the access cookie expired, a silent /auth/token/refresh/)
// next to the proposal request. If that refresh commits before the proposal
// request is handled, the old refresh cookie it carries is already rotated away
// (no grace period) and the owner is counted as a client for that one load.
// Rare, harmless, self-correcting on reload; see apps/users/authentication.py.
import { useEffect, useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'

import Card from '@/components/Card'

const COPIED_RESET_MS = 2000

export default function ProposalLinkCard({ url }) {
  const [state, setState] = useState('idle') // idle | copied | failed
  const inputRef = useRef(null)
  const timer = useRef(null)

  useEffect(() => () => clearTimeout(timer.current), [])

  async function copy() {
    clearTimeout(timer.current)
    try {
      await navigator.clipboard.writeText(url)
      setState('copied')
      timer.current = setTimeout(() => setState('idle'), COPIED_RESET_MS)
    } catch {
      // No clipboard (insecure context, denied permission): select the text so
      // the person can copy it by hand.
      inputRef.current?.focus()
      inputRef.current?.select()
      setState('failed')
    }
  }

  return (
    <Card title="Client link">
      <p style={{ margin: '0 0 10px', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.55 }}>
        Your client opens this link. No login is needed, and anyone who has the link can read this proposal.
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          ref={inputRef} readOnly value={url} aria-label="Client link" className="fos-input"
          onFocus={(e) => e.target.select()} style={{ flex: 1, minWidth: 0, fontSize: '0.78rem' }}
        />
        <button type="button" className="fos-btn fos-btn-ghost" onClick={copy}>
          {state === 'copied' ? <Check size={14} /> : <Copy size={14} />}
          <span role="status">{state === 'copied' ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      {state === 'failed' && <p className="fos-hint" style={{ margin: '8px 0 0' }}>Press Ctrl+C (or long-press) to copy.</p>}
      <p style={{ margin: '10px 0 0', fontSize: '0.76rem', color: 'var(--status-amber-text)', lineHeight: 1.5 }}>
        While you&apos;re signed in, opening this link shows you a preview and doesn&apos;t count as a view. Opened signed out, in a private window or on another device, it counts as your client viewing it.
      </p>
    </Card>
  )
}
