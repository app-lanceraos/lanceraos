// src/components/ProposalPreviewModal.jsx
//
// In-app preview of a proposal as the client will see it (decision D9). It
// renders the same ProposalDocument the public page does, from the editor form
// (a draft — including text not saved yet) or from the detail (anything else),
// and makes NO call that has side effects (the real public link, opened signed
// out or elsewhere, would count as the client viewing it). The only request here
// is the read-only GET /auth/profile/ for the business name and logo.
//
// z-index 500, not the usual 200 for modals: this overlay covers the whole
// viewport, and the shell's own sidebar (250) and header (350) sit above 200
// (DESIGN.md Section 5), which clipped the preview's own title bar under the
// header in the real-browser pass. 500 is the scale's next value; it is portaled
// to <body> so the value is compared at the root, not inside the shell.
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

import api from '@/lib/api'
import useFocusTrap from '@/hooks/useFocusTrap'
import useAuthStore from '@/store/authStore'
import ProposalDocument from '@/components/ProposalDocument'
import { senderNameFrom, toPublicShape } from '@/pages/proposalLifecycle'

/**
 * @param {object} props
 * @param {'form'|'detail'} props.kind
 * @param {object} props.source - the editor form, or a server detail
 * @param {string} [props.number] - proposal number for a form (a draft has none)
 * @param {() => void} props.onClose
 */
export default function ProposalPreviewModal({ kind, source, number, onClose }) {
  const user = useAuthStore((s) => s.user)
  const [profile, setProfile] = useState(null)
  const [state, setState] = useState('loading') // loading | ready | failed
  const dialogRef = useRef(null)

  useFocusTrap(dialogRef, true)

  useEffect(() => {
    const controller = new AbortController()
    api.get('/auth/profile/', { signal: controller.signal })
      .then(({ data }) => { setProfile(data); setState('ready') })
      .catch((error) => { if (!controller.signal.aborted && error?.code !== 'ERR_CANCELED') setState('failed') })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    const onKeyDown = (event) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const sender = useMemo(() => ({
    name: senderNameFrom(profile, user),
    logo_url: profile?.logo || '',
  }), [profile, user])
  const data = useMemo(() => toPublicShape({ source, kind, sender, number }), [source, kind, sender, number])

  const note = { margin: 0, fontSize: '0.78rem', color: 'var(--text-tertiary)' }
  return createPortal(
    <div
      ref={dialogRef} role="dialog" aria-modal="true" aria-label="Preview" tabIndex={-1}
      style={{ position: 'fixed', inset: 0, zIndex: 500, display: 'flex', flexDirection: 'column', background: '#f8fafc', outline: 'none' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', padding: '12px 20px', background: 'var(--bg-surface)', borderBottom: '1px solid var(--border-subtle)' }}>
        <div style={{ minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>Preview</p>
          <p style={note}>This is how your client will see this proposal.</p>
          {kind === 'form' && <p style={note}>Shows your current text, including changes that are not saved yet.</p>}
          {state === 'loading' && <p style={note} role="status">Loading your business name and logo…</p>}
          {state === 'failed' && <p style={note} role="status">Your business name and logo couldn&apos;t be loaded.</p>}
        </div>
        <button type="button" className="fos-btn fos-btn-ghost" onClick={onClose}><X size={15} aria-hidden="true" /> Close preview</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 16px 48px' }}>
        <div style={{ maxWidth: 760, margin: '0 auto', background: '#fff', border: '1px solid rgba(0,0,0,.08)', borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,.06)', padding: '28px 24px' }}>
          <ProposalDocument data={data} />
          <div style={{ marginTop: 28, paddingTop: 20, borderTop: '1px solid rgba(0,0,0,.08)' }}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button type="button" disabled style={disabledButton('#1e3a5f', '#fff')}>Accept proposal</button>
              <button type="button" disabled style={disabledButton('#fff', '#1e3a5f')}>Decline proposal</button>
            </div>
            <p style={{ margin: '10px 0 0', fontSize: '0.8rem', color: '#64748b' }}>Your client sees these buttons here.</p>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

const disabledButton = (background, color) => ({
  minHeight: 44, padding: '0 20px', borderRadius: 10, fontSize: '0.92rem', fontWeight: 600, fontFamily: "'DM Sans', sans-serif",
  background, color, border: '1.5px solid #1e3a5f', opacity: 0.55, cursor: 'not-allowed',
})
