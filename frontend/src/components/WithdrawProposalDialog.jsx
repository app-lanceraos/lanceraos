// src/components/WithdrawProposalDialog.jsx
//
// Withdraw a sent/viewed proposal (decision D6). The copy is deliberately blunt
// about what withdrawing does NOT do: it does not email the client and cannot
// recall an email already sent. A lost answer is resolved by reading the
// proposal back, not by guessing.
import { useState } from 'react'
import { Undo2 } from 'lucide-react'

import api from '@/lib/api'
import FosAlert from '@/components/FosAlert'
import { DialogButtons, ProposalDialog, dialogText } from '@/components/ProposalDialog'
import { errorMessage } from '@/pages/proposalHelpers'
import { classifySendFailure } from '@/pages/proposalLifecycle'

/**
 * @param {object} props
 * @param {string} props.proposalId
 * @param {(data: object) => void} props.onWithdrawn - the fresh detail
 * @param {(text: string) => void} props.onStale - it was no longer withdrawable; reload and say so
 * @param {() => void} props.onReload - reload without a verdict
 * @param {() => void} props.onClose
 */
export default function WithdrawProposalDialog({ proposalId, onWithdrawn, onStale, onReload, onClose }) {
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState(null)
  const [unconfirmed, setUnconfirmed] = useState(false)

  async function withdraw() {
    setBusy(true)
    setProblem(null)
    try {
      const { data } = await api.post(`/proposals/${proposalId}/withdraw/`, { confirm: true })
      onWithdrawn(data)
    } catch (error) {
      const failure = classifySendFailure(error)
      if (failure.kind === 'ambiguous') {
        try {
          const { data } = await api.get(`/proposals/${proposalId}/`)
          if (data.status === 'withdrawn') { onWithdrawn(data); return }
        } catch { /* fall through: still unknown */ }
        setUnconfirmed(true)
        setBusy(false)
        return
      }
      if (failure.status === 409) {
        onStale("This proposal already changed, so it wasn't withdrawn. Here is its current state.")
        return
      }
      setProblem(errorMessage(error, "We couldn't withdraw this proposal. Please try again.").message)
      setBusy(false)
    }
  }

  return (
    <ProposalDialog title="Withdraw this proposal?" busy={busy} onClose={onClose}>
      {unconfirmed ? (
        <>
          <FosAlert type="warning" style={{ marginBottom: 16 }}>We couldn&apos;t confirm the withdrawal. Please check the proposal&apos;s status.</FosAlert>
          <DialogButtons
            busy={false} onClose={onClose} cancelLabel="Close"
            confirm={<button type="button" className="fos-btn fos-btn-accent" onClick={onReload}>Reload</button>}
          />
        </>
      ) : (
        <>
          <p style={{ ...dialogText, margin: '0 0 10px' }}>Your client&apos;s link will show that the proposal was withdrawn, and they won&apos;t be able to accept or decline it.</p>
          <p style={{ ...dialogText, margin: '0 0 10px' }}>We don&apos;t email your client about this. An email you already sent can&apos;t be taken back.</p>
          <p style={dialogText}>You can&apos;t undo a withdrawal. To send a revised proposal, copy this one into a new draft.</p>
          {problem && <FosAlert type="error" style={{ marginBottom: 16 }}>{problem}</FosAlert>}
          <DialogButtons
            busy={busy} onClose={onClose} cancelLabel="Keep it"
            confirm={(
              <button type="button" className="fos-btn fos-btn-danger" onClick={withdraw} disabled={busy}>
                {busy ? <span className="fos-spinner" aria-hidden="true" /> : <Undo2 size={14} />} Withdraw proposal
              </button>
            )}
          />
        </>
      )}
    </ProposalDialog>
  )
}
