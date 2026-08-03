// src/components/DeletionModal.jsx
import { authTokens } from '@/components/AuthLayout'
import AuthButton from '@/components/AuthButton'

export default function DeletionModal({ data, onRestore, onContinue, restoring }) {
  const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-PK', { dateStyle: 'long' }) : '—')
  const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' }) : '—')

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
        zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      }}
    >
      <div style={{ background: authTokens.inputBg, border: `1px solid ${authTokens.inputBorder}`, borderRadius: 16, width: '100%', maxWidth: 420, overflow: 'hidden' }}>
        <div style={{ padding: 24, borderBottom: `1px solid ${authTokens.inputBorder}` }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 700, color: authTokens.error, margin: 0 }}>
            Account Scheduled for Deletion
          </h2>
        </div>
        <div style={{ padding: 24 }}>
          <div style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${authTokens.inputBorder}`, borderRadius: 10, padding: '14px 16px', marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', color: '#C7C7C7', padding: '4px 0' }}>
              <span>Deletion requested</span>
              <strong style={{ color: '#fff' }}>{fmtDateTime(data.deletion_requested_at)}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', color: '#C7C7C7', padding: '10px 0 4px', borderTop: `1px solid ${authTokens.inputBorder}`, marginTop: 6 }}>
              <span>Permanent deletion</span>
              <strong style={{ color: authTokens.error }}>{fmtDate(data.deletion_scheduled_at)}</strong>
            </div>
          </div>
          <p style={{ fontSize: '0.875rem', color: '#C7C7C7', lineHeight: 1.55, marginBottom: 20 }}>
            Restoring will <strong>cancel your deletion request</strong> and fully restore your account.
            Or continue — you'll stay signed in, and the deletion will still go through on schedule.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <AuthButton variant="primary" onClick={onRestore} disabled={restoring}>
              {restoring ? 'Restoring account…' : 'Restore my account'}
            </AuthButton>
            <AuthButton variant="ghost" onClick={onContinue} disabled={restoring}>
              Continue with deletion
            </AuthButton>
          </div>
        </div>
      </div>
    </div>
  )
}
