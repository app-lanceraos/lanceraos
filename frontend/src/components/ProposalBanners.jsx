// src/components/ProposalBanners.jsx
//
// The alerts stacked above a proposal page: a one-shot flash from the previous
// page (Duplicate), the loader's notice (sent from another tab, just sent,
// withdrawn…), and the page's own action message (a failed copy or delete).
// Inline FosAlert, not a toast — this app has none (DESIGN.md).
import FosAlert from '@/components/FosAlert'

export default function ProposalBanners({ flash, onDismissFlash, notice, onDismissNotice, message, onDismissMessage }) {
  return (
    <>
      {flash && <FosAlert type="success" onDismiss={onDismissFlash} style={{ marginBottom: 16 }}>{flash}</FosAlert>}
      {notice && <FosAlert type={notice.type} onDismiss={onDismissNotice} style={{ marginBottom: 16 }}>{notice.text}</FosAlert>}
      {message && <FosAlert type={message.type} onDismiss={onDismissMessage} style={{ marginBottom: 16 }}>{message.text}</FosAlert>}
    </>
  )
}
