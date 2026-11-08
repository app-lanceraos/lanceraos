// src/components/PaymentImportHistory.jsx
//
// "Past imports", under the file step. One row per import with how many of its payments are still in the ledger and an
// Undo behind an inline confirmation (not a nested dialog). A load failure only shows a Retry — it never blocks uploading.
// A row that was undone but still has payments left (the ones linked to an invoice are kept) still offers Undo, so the
// person can unlink and undo again.
import FosAlert from './FosAlert'
import { formatIsoDate } from '@/pages/dashboardHelpers'
import { undoConfirmText, undoResultText } from '@/pages/paymentImportHelpers'
import { sourceLabel } from '@/pages/paymentsHelpers'

function paymentsText(count) {
  return `${count} payment${count === 1 ? '' : 's'}`
}

export default function PaymentImportHistory({ history }) {
  const { batches, loading, loadError, confirmingId, busyId, result, undoError } = history

  if (loadError) {
    return (
      <section aria-label="Past imports" style={{ marginTop: 24 }}>
        <FosAlert type="error">
          {loadError} <button type="button" className="fos-btn fos-btn-ghost" style={{ marginLeft: 8 }} onClick={history.load}>Retry</button>
        </FosAlert>
      </section>
    )
  }
  if (loading && batches.length === 0) return null
  if (batches.length === 0 && !result) return null

  return (
    <section aria-labelledby="pay-import-history-title" style={{ marginTop: 26, borderTop: '1px solid var(--border-subtle)', paddingTop: 18 }}>
      <h4 id="pay-import-history-title" style={{ margin: '0 0 10px', fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)' }}>Past imports</h4>
      {result && <FosAlert type="success" style={{ marginBottom: 10 }}>{undoResultText(result)}</FosAlert>}
      {undoError && <FosAlert type="error" style={{ marginBottom: 10 }}>{undoError}</FosAlert>}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {batches.map((batch) => {
          const confirming = confirmingId === batch.id
          const busy = busyId === batch.id
          return (
            <li key={batch.id} style={{ padding: '10px 12px', background: 'var(--bg-surface-2)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                  <div style={{ fontSize: '0.84rem', fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{batch.file_name}</div>
                  <div style={{ fontSize: '0.74rem', color: 'var(--text-tertiary)' }}>
                    {sourceLabel(batch.source)} · {formatIsoDate(batch.created_at)} · {batch.imported} imported
                  </div>
                </div>
                {batch.remaining > 0 ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                      {batch.remaining} still in your payments
                    </span>
                    {!confirming && (
                      <button type="button" className="fos-btn fos-btn-ghost" style={{ fontSize: '0.78rem', padding: '5px 10px' }} onClick={() => history.askUndo(batch.id)} disabled={busyId !== null}>
                        Undo
                      </button>
                    )}
                  </div>
                ) : (
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>{batch.undone_at ? 'Undone' : 'Nothing left to undo'}</span>
                )}
              </div>
              {confirming && (
                <div style={{ marginTop: 10 }}>
                  <p style={{ margin: '0 0 8px', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.55 }}>{undoConfirmText(batch.remaining)}</p>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button type="button" className="fos-btn fos-btn-ghost" onClick={history.cancelUndo} disabled={busy}>Cancel</button>
                    <button type="button" className="fos-btn fos-btn-danger" onClick={() => history.confirmUndo(batch.id)} disabled={busy}>
                      {busy ? <span className="fos-spinner" /> : null} Remove {paymentsText(batch.remaining)}
                    </button>
                  </div>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
