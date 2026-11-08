// src/components/ExpenseDeleteDialog.jsx
//
// "Delete this expense?" — a small confirmation (Prompt 15, decision X2: no side panel, so the row menu's Delete asks here).
// DELETE /expenses/<id>/ answers 204. A 404 means the expense is already gone (removed in another tab): the dialog closes,
// the page refreshes and says so. Any other error stays in the dialog. Escape and the X are ignored while the request runs
// (PaymentDialog's `busy`), because closing would hide a pending action the person cannot then cancel.
import { useState } from 'react'
import { Trash2 } from 'lucide-react'

import api from '@/lib/api'
import FosAlert from './FosAlert'
import { PaymentDialog, PaymentDialogButtons, paymentDialogText } from './PaymentDialog'
import { FLASH, deleteSentence, isGone } from '@/pages/expensesHelpers'
import { errorMessage } from '@/pages/paymentsHelpers'

export default function ExpenseDeleteDialog({ expense, onDeleted, onClose }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function confirm() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await api.delete(`/expenses/${expense.id}/`)
      onDeleted(FLASH.deleted)
    } catch (e) {
      if (isGone(e)) {
        onDeleted(FLASH.alreadyRemoved)
        return
      }
      setError(errorMessage(e, 'Could not delete this expense. Please try again.'))
      setBusy(false)
    }
  }

  return (
    <PaymentDialog title="Delete this expense?" busy={busy} onClose={onClose} maxWidth={440}>
      {/* overflowWrap: a vendor is free text and may be one 200-character word; the sentence must wrap inside the dialog. */}
      <p style={{ ...paymentDialogText, overflowWrap: 'anywhere' }}>{deleteSentence(expense)}</p>
      {error && <FosAlert type="error" style={{ marginBottom: 12 }}>{error}</FosAlert>}
      <PaymentDialogButtons
        busy={busy} onClose={onClose}
        confirm={(
          <button type="button" className="fos-btn fos-btn-danger" onClick={confirm} disabled={busy}>
            {busy ? <span className="fos-spinner" /> : <Trash2 size={14} aria-hidden="true" />} Delete expense
          </button>
        )}
      />
    </PaymentDialog>
  )
}
