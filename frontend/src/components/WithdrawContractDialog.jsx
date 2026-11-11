// src/components/WithdrawContractDialog.jsx
//
// Withdraw a sent or viewed contract. The copy is deliberately blunt about what withdrawing does NOT do: it does not email
// the client. A lost answer is resolved by reading the contract back, not by guessing.
import { useState } from 'react'
import { Undo2 } from 'lucide-react'

import api from '@/lib/api'
import FosAlert from '@/components/FosAlert'
import { DialogButtons, ProposalDialog, dialogText } from '@/components/ProposalDialog'
import { OWNER_COPY } from '@/pages/contractCopy'
import { errorMessage } from '@/pages/contractHelpers'
import { classifySendFailure } from '@/pages/contractLifecycle'

/**
 * @param {object} props
 * @param {string} props.contractId
 * @param {(data: object) => void} props.onWithdrawn - the fresh detail
 * @param {(text: string) => void} props.onStale - it was no longer withdrawable; reload and say so
 * @param {() => void} props.onReload - reload without a verdict
 * @param {() => void} props.onClose
 */
export default function WithdrawContractDialog({ contractId, onWithdrawn, onStale, onReload, onClose }) {
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState(null)
  const [unconfirmed, setUnconfirmed] = useState(false)

  async function withdraw() {
    if (busy) return
    setBusy(true)
    setProblem(null)
    try {
      const { data } = await api.post(`/contracts/${contractId}/withdraw/`, { confirm: true })
      onWithdrawn(data)
    } catch (error) {
      const failure = classifySendFailure(error)
      if (failure.kind === 'ambiguous') {
        // The request may have been processed: read the contract back.
        try {
          const { data } = await api.get(`/contracts/${contractId}/`)
          if (data.status === 'withdrawn') { onWithdrawn(data); return }
        } catch { /* fall through: still unknown */ }
        setUnconfirmed(true)
        setBusy(false)
        return
      }
      if (failure.status === 409) {
        onStale(OWNER_COPY.withdrawStale)
        return
      }
      setProblem(errorMessage(error, OWNER_COPY.withdrawFailed).message)
      setBusy(false)
    }
  }

  return (
    <ProposalDialog title={OWNER_COPY.withdrawTitle} busy={busy} onClose={onClose}>
      {unconfirmed ? (
        <>
          <FosAlert type="warning" style={{ marginBottom: 16 }}>{OWNER_COPY.withdrawUnconfirmed}</FosAlert>
          <DialogButtons
            busy={false} onClose={onClose} cancelLabel={OWNER_COPY.closeButton}
            confirm={<button type="button" className="fos-btn fos-btn-accent" onClick={onReload}>{OWNER_COPY.reloadContract}</button>}
          />
        </>
      ) : (
        <>
          <p style={dialogText}>{OWNER_COPY.withdrawBody}</p>
          {problem && <FosAlert type="error" style={{ marginBottom: 16 }}>{problem}</FosAlert>}
          <DialogButtons
            busy={busy} onClose={onClose} cancelLabel={OWNER_COPY.keepIt}
            confirm={(
              <button type="button" className="fos-btn fos-btn-danger" onClick={withdraw} disabled={busy}>
                {busy ? <span className="fos-spinner" aria-hidden="true" /> : <Undo2 size={14} aria-hidden="true" />}
                {busy ? OWNER_COPY.withdrawing : OWNER_COPY.withdrawButton}
              </button>
            )}
          />
        </>
      )}
    </ProposalDialog>
  )
}
