// src/components/ContractLinkCard.jsx
//
// The permanent home of the client's link on a sent contract: a read-only field with a Copy button and the sentence that
// anyone who has the link can sign. For a declined or withdrawn contract the link is shown struck out with "This link no
// longer accepts a signature". Copying uses the clipboard, with a select-and-copy fallback and a polite status line.
import { useEffect, useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'

import Card from '@/components/Card'
import { OWNER_COPY } from '@/pages/contractCopy'

const COPIED_RESET_MS = 2000

export default function ContractLinkCard({ url, status }) {
  const [state, setState] = useState('idle') // idle | copied | failed
  const inputRef = useRef(null)
  const timer = useRef(null)
  const closed = status === 'declined' || status === 'withdrawn'

  useEffect(() => () => clearTimeout(timer.current), [])

  async function copy() {
    clearTimeout(timer.current)
    try {
      await navigator.clipboard.writeText(url)
      setState('copied')
      timer.current = setTimeout(() => setState('idle'), COPIED_RESET_MS)
    } catch {
      // No clipboard (an insecure context, a denied permission): select the text so it can be copied by hand.
      inputRef.current?.focus()
      inputRef.current?.select()
      setState('failed')
    }
  }

  if (!url) return null
  return (
    <Card title={OWNER_COPY.linkTitle}>
      <p style={{ margin: '0 0 10px', fontSize: '0.8rem', color: closed ? 'var(--status-amber-text)' : 'var(--text-secondary)', lineHeight: 1.55 }}>
        {closed ? OWNER_COPY.linkClosed : OWNER_COPY.linkNote}
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          ref={inputRef} readOnly value={url} aria-label={OWNER_COPY.linkTitle} className="fos-input"
          onFocus={(e) => e.target.select()}
          style={{ flex: 1, minWidth: 0, fontSize: '0.78rem', textDecoration: closed ? 'line-through' : 'none', opacity: closed ? 0.7 : 1 }}
        />
        <button type="button" className="fos-btn fos-btn-ghost" onClick={copy}>
          {state === 'copied' ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
          <span>{state === 'copied' ? OWNER_COPY.copied : OWNER_COPY.copyLink}</span>
        </button>
      </div>
      <p role="status" className="fos-hint" style={{ margin: '8px 0 0', minHeight: 18 }}>
        {state === 'copied' ? OWNER_COPY.linkCopied : state === 'failed' ? OWNER_COPY.linkCopyFailed : ''}
      </p>
    </Card>
  )
}
