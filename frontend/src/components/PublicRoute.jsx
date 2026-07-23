// src/components/PublicRoute.jsx
import { Navigate } from 'react-router-dom'
import useAuthStore from '@/store/authStore'

export default function PublicRoute({ children }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const isInitializing = useAuthStore((s) => s.isInitializing)

  if (isInitializing) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#050508' }}>
        <p style={{ color: '#8074C0', fontSize: '0.875rem' }}>Loading…</p>
      </div>
    )
  }

  if (isAuthenticated) {
    return <Navigate to="/profile" replace />
  }

  return children
}