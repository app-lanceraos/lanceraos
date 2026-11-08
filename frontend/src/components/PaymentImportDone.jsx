// src/components/PaymentImportDone.jsx
//
// Step 4: what was added and what was skipped, with an inline "Undo this import" (asks first, never a nested dialog).
// Payments linked to an invoice are kept by an undo, and the result says so in words.
import { Check } from 'lucide-react'

import FosAlert from './FosAlert'
import { batchLines, undoConfirmText, undoResultText } from '@/pages/paymentImportHelpers'

export default function PaymentImportDone({ state, actions, onViewPayments }) {
  const { batch, busy, error, confirmingUndo, undoResult } = state
  const undoing = busy === 'undo'

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <span style={{ display: 'inline-flex', width: 30, height: 30, borderRadius: '50%', alignItems: 'center', justifyContent: 'center', background: 'var(--status-green-bg)', color: 'var(--status-green-text)' }}>
          <Check size={17} aria-hidden="true" />
        </span>
        <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)' }}>{batch.file_name}</span>
      </div>
      <ul style={{ margin: '0 0 16px', paddingLeft: 20, fontSize: '0.86rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
        {batchLines(batch).map((line) => <li key={line}>{line}</li>)}
      </ul>

      {undoResult && <FosAlert type="success" style={{ marginBottom: 14 }}>{undoResultText(undoResult)}</FosAlert>}
      {error && <FosAlert type="error" style={{ marginBottom: 14 }}>{error}</FosAlert>}

      {confirmingUndo && !undoResult && (
        <div style={{ padding: '12px 14px', background: 'var(--bg-surface-2)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', marginBottom: 14 }}>
          <p style={{ margin: '0 0 10px', fontSize: '0.84rem', color: 'var(--text-secondary)', lineHeight: 1.55 }}>{undoConfirmText(batch.imported)}</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="fos-btn fos-btn-ghost" onClick={actions.cancelUndo} disabled={undoing}>Cancel</button>
            <button type="button" className="fos-btn fos-btn-danger" onClick={actions.undo} disabled={undoing}>
              {undoing ? <span className="fos-spinner" /> : null} Remove {batch.imported} payment{batch.imported === 1 ? '' : 's'}
            </button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
        {undoResult ? (
          <button type="button" className="fos-btn fos-btn-accent" onClick={onViewPayments}>Close</button>
        ) : (
          <>
            {!confirmingUndo && (
              <button type="button" className="fos-btn fos-btn-ghost" style={{ color: 'var(--status-red-text)' }} onClick={actions.askUndo} disabled={Boolean(busy)}>Undo this import</button>
            )}
            <button type="button" className="fos-btn fos-btn-ghost" onClick={actions.again} disabled={Boolean(busy)}>Import another file</button>
            <button type="button" className="fos-btn fos-btn-accent" onClick={onViewPayments} disabled={Boolean(busy)}>View payments</button>
          </>
        )}
      </div>
    </div>
  )
}
