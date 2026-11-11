// src/components/ContractPreviewModal.jsx
//
// In-app preview of a contract as the client will see it. It renders the same ContractDocument the public page does, from
// the editor form (a draft, including text not saved yet, with [[blanks]] highlighted) or from a server detail, and makes
// NO call that has side effects: the real public link, opened signed out or elsewhere, would count as the client viewing
// it. The only request here is the read-only GET /auth/profile/ for the sender's name and logo.
//
// z-index 500 and a portal to <body> for the reason ProposalPreviewModal documents: the shell's sidebar and header sit
// above the usual 200 for modals.
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

import api from '@/lib/api'
import useFocusTrap from '@/hooks/useFocusTrap'
import useAuthStore from '@/store/authStore'
import ContractDocument from '@/components/ContractDocument'
import { OWNER_COPY } from '@/pages/contractCopy'
import { toDocumentModel } from '@/pages/contractHelpers'
import { senderNameFrom } from '@/pages/proposalLifecycle'

/**
 * @param {object} props
 * @param {'form'|'detail'} props.kind
 * @param {object} props.source - the editor form, or a server detail
 * @param {object} [props.detail] - for a form: the draft's detail (its live freelancer party and number)
 * @param {() => void} props.onClose
 */
export default function ContractPreviewModal({ kind, source, detail, onClose }) {
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

  const sender = useMemo(() => ({ name: senderNameFrom(profile, user), logo_url: profile?.logo || '' }), [profile, user])
  const data = useMemo(() => toDocumentModel({ kind, source, detail, sender }), [kind, source, detail, sender])

  const note = { margin: 0, fontSize: '0.78rem', color: 'var(--text-tertiary)' }
  return createPortal(
    <div
      ref={dialogRef} role="dialog" aria-modal="true" aria-label="Preview" tabIndex={-1}
      style={{ position: 'fixed', inset: 0, zIndex: 500, display: 'flex', flexDirection: 'column', background: '#f8fafc', outline: 'none' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', padding: '12px 20px', background: 'var(--bg-surface)', borderBottom: '1px solid var(--border-subtle)' }}>
        <div style={{ minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>Preview</p>
          <p style={note}>{OWNER_COPY.previewNote}</p>
          {kind === 'form' && <p style={note}>Shows your current text, including changes that are not saved yet.</p>}
          {state === 'loading' && <p style={note} role="status">Loading your business name and logo…</p>}
          {state === 'failed' && <p style={note} role="status">Your business name and logo couldn&apos;t be loaded.</p>}
        </div>
        <button type="button" className="fos-btn fos-btn-ghost" onClick={onClose}><X size={15} aria-hidden="true" /> Close preview</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 16px 48px' }}>
        <div style={{ maxWidth: 760, margin: '0 auto', background: '#fff', border: '1px solid rgba(0,0,0,.08)', borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,.06)', padding: '28px 24px' }}>
          <ContractDocument data={data} markPlaceholders={kind === 'form'} />
        </div>
      </div>
    </div>,
    document.body,
  )
}
