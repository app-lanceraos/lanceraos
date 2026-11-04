// src/components/ConvertProposalDialog.jsx
//
// Accepted proposal -> draft invoice (decision D7). "Save as client" defaults ON
// only when there is no saved client but both a name and an email — the
// checkbox is explicit and the backend reuses an existing client with the same
// email instead of duplicating. The call is idempotent, so a lost answer is
// safe to retry and the dialog says so.
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { FileText } from 'lucide-react'

import api from '@/lib/api'
import FosAlert from '@/components/FosAlert'
import { DialogButtons, ProposalDialog, dialogText } from '@/components/ProposalDialog'
import { errorMessage } from '@/pages/proposalHelpers'
import { classifySendFailure } from '@/pages/proposalLifecycle'

/**
 * @param {object} props
 * @param {object} props.detail
 * @param {(text: string) => void} props.onNotAccepted - reload the real state and say why
 * @param {() => void} props.onClose
 */
export default function ConvertProposalDialog({ detail, onNotAccepted, onClose }) {
  const navigate = useNavigate()
  const hasSavedClient = Boolean(detail.client)
  const name = (detail.client_name || '').trim()
  const email = (detail.client_email || '').trim()
  const canSaveClient = !hasSavedClient && Boolean(name) && Boolean(email)
  const hasItems = (detail.items || []).length > 0

  const [saveClient, setSaveClient] = useState(true)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState(null)

  async function convert() {
    setBusy(true)
    setProblem(null)
    try {
      const { data } = await api.post(`/proposals/${detail.id}/convert-to-invoice/`, { save_client: canSaveClient && saveClient })
      navigate(`/invoices?invoice=${data.invoice_id}`)
    } catch (error) {
      const failure = classifySendFailure(error)
      if (failure.kind === 'ambiguous') {
        setProblem("We couldn't confirm that the invoice was created. Try again. It won't create a second one.")
      } else if (failure.status === 409) {
        onNotAccepted('This proposal is no longer accepted, so no invoice was created. Here is its current state.')
        return
      } else {
        setProblem(errorMessage(error, "We couldn't create the invoice. Please try again.").message)
      }
      setBusy(false)
    }
  }

  return (
    <ProposalDialog title="Create an invoice from this proposal" busy={busy} onClose={onClose}>
      {!hasItems ? (
        <>
          <p style={dialogText}>This proposal has no priced items, so there is nothing to invoice. You can start a new invoice from the invoices page.</p>
          <DialogButtons
            busy={false} onClose={onClose} cancelLabel="Close"
            confirm={<Link to="/invoices" className="fos-btn fos-btn-accent">Go to invoices</Link>}
          />
        </>
      ) : (
        <>
          <p style={{ ...dialogText, margin: '0 0 14px' }}>
            We&apos;ll make a draft invoice with this proposal&apos;s items, currency, tax, discount and payment terms. It isn&apos;t sent or numbered yet, so you can review it first.
          </p>
          {hasSavedClient && (
            <p style={{ ...dialogText, margin: '0 0 14px', color: 'var(--text-primary)' }}>Client: {detail.client_name} (saved client)</p>
          )}
          {canSaveClient && (
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, margin: '0 0 14px', cursor: 'pointer' }}>
              <input type="checkbox" checked={saveClient} onChange={(e) => setSaveClient(e.target.checked)} disabled={busy} style={{ marginTop: 3 }} />
              <span style={{ fontSize: '0.85rem', color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>
                Also save {name} ({email}) as a client
                <span style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: 2 }}>
                  If you already have a client with this email, we use that one instead of making a copy.
                </span>
              </span>
            </label>
          )}
          {!hasSavedClient && !canSaveClient && (
            <p style={{ ...dialogText, margin: '0 0 14px' }}>Without the client&apos;s name and email we can&apos;t save a client, so the invoice is made for a one-time client.</p>
          )}
          {problem && <FosAlert type="error" style={{ marginBottom: 16 }}>{problem}</FosAlert>}
          <DialogButtons
            busy={busy} onClose={onClose}
            confirm={(
              <button type="button" className="fos-btn fos-btn-accent" onClick={convert} disabled={busy}>
                {busy ? <span className="fos-spinner" aria-hidden="true" /> : <FileText size={14} />} {busy ? 'Creating…' : 'Create draft invoice'}
              </button>
            )}
          />
        </>
      )}
    </ProposalDialog>
  )
}
