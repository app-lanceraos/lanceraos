// src/components/PaymentDialog.jsx
//
// The dialog frame every Payments dialog uses (DESIGN.md "Centered modal" recipe), the same recipe as
// ProposalDialog.jsx. Written feature-local on purpose: DESIGN.md Section 12 still forbids a generic shared Modal, and
// the focus handling is the shared useFocusTrap hook — focus moves in, Tab cycles inside, and focus goes back to what
// opened it. Escape and the close button do nothing while a request is running: closing would hide a pending action
// the person cannot then cancel.
//
// Never give a field inside a dialog the `autoFocus` attribute: React focuses it before the trap records what had
// focus, so the trap would "restore" focus to an element that is about to disappear and focus would be lost to <body>
// when the dialog closes (found in browser verification, 08 November 2026). Use the `initialFocus` selector instead —
// it runs after the trap has recorded the opener.
import { useEffect, useId, useRef } from 'react'
import { X } from 'lucide-react'

import useFocusTrap from '@/hooks/useFocusTrap'

export const paymentDialogText = { margin: '0 0 16px', fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.6 }

export function PaymentDialog({ title, busy = false, onClose, children, maxWidth = 460, initialFocus = null }) {
  const titleId = useId()
  const dialogRef = useRef(null)

  useFocusTrap(dialogRef, true)

  // Declared after the trap on purpose: effects of one component run in order, so the opener is already recorded.
  useEffect(() => {
    if (initialFocus) dialogRef.current?.querySelector(initialFocus)?.focus()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, gap: 12 }}>
          <h3 id={titleId} style={{ margin: 0, fontSize: '1.02rem', fontWeight: 700, color: 'var(--text-primary)' }}>{title}</h3>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close" className="fos-btn fos-btn-ghost" style={{ padding: 6 }}><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function PaymentDialogButtons({ busy = false, onClose, confirm, cancelLabel = 'Cancel' }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, flexWrap: 'wrap', marginTop: 20 }}>
      <button type="button" className="fos-btn fos-btn-ghost" onClick={onClose} disabled={busy}>{cancelLabel}</button>
      {confirm}
    </div>
  )
}
