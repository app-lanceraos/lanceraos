// src/components/PublicRoute.jsx
import { Navigate } from 'react-router-dom'
import useAuthStore from '@/store/authStore'

export default function PublicRoute({ children }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const isInitializing = useAuthStore((s) => s.isInitializing)
  const deletionScheduledAt = useAuthStore((s) => s.deletionScheduledAt)

  if (isInitializing) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#050508' }}>
        <p style={{ color: '#8074C0', fontSize: '0.875rem' }}>Loading…</p>
      </div>
    )
  }

  // Don't auto-redirect away from /login while a deletion-pending modal
  // still needs to be shown — Login.jsx navigates onward itself once the
  // user picks "Restore" or "Continue with deletion." Without this
  // check, isAuthenticated flipping true the instant loginSuccess() runs
  // (which happens before Login.jsx's own deletion_pending check) causes
  // this redirect to win the race, unmounting Login.jsx before its
  // modal ever renders.
  if (isAuthenticated && !deletionScheduledAt) {
    return <Navigate to="/profile" replace />
  }

  return children
}