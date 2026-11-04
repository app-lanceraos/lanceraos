// src/components/ProposalDialog.jsx
//
// The dialog frame every Proposals dialog uses (DESIGN.md "Centered modal"
// recipe). Written for Proposals rather than as a shared Modal on purpose
// (DESIGN.md Section 12 still forbids a generic one); the focus handling is the
// shared useFocusTrap hook — focus moves in, Tab cycles inside, and focus goes
// back to what opened it. Escape and the close button do nothing while a
// request is running: closing would hide a pending action the person cannot
// then cancel.
import { useEffect, useId, useRef } from 'react'
import { X } from 'lucide-react'

import useFocusTrap from '@/hooks/useFocusTrap'

export const dialogText = { margin: '0 0 20px', fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.6 }

export function ProposalDialog({ title, busy, onClose, children, maxWidth = 440 }) {
  const titleId = useId()
  const dialogRef = useRef(null)

  useFocusTrap(dialogRef, true)

  useEffect(() => {
    const onKeyDown = (event) => { if (event.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [busy, onClose])

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div
        ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
        style={{ background: 'var(--bg-surface)', borderRadius: 'var(--radius-xl)', boxShadow: '0 8px 40px rgba(0,0,0,0.25)', padding: '24px 28px', width: '100%', maxWidth, maxHeight: '90vh', overflowY: 'auto', outline: 'none', animation: 'modal-in 0.2s cubic-bezier(0.22,1,0.36,1)' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h3 id={titleId} style={{ margin: 0, fontSize: '1.02rem', fontWeight: 700, color: 'var(--text-primary)' }}>{title}</h3>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close" className="fos-btn fos-btn-ghost" style={{ padding: 6 }}><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function DialogButtons({ busy, onClose, confirm, cancelLabel = 'Cancel' }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
      <button type="button" className="fos-btn fos-btn-ghost" onClick={onClose} disabled={busy}>{cancelLabel}</button>
      {confirm}
    </div>
  )
}
