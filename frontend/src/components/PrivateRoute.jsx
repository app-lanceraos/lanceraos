// src/components/PrivateRoute.jsx
import { Navigate, useLocation } from 'react-router-dom'
import useAuthStore from '@/store/authStore'

export default function PrivateRoute({ children }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const isInitializing = useAuthStore((s) => s.isInitializing)
  const location = useLocation()

  if (isInitializing) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-base)' }}>
        <p style={{ color: 'var(--text-tertiary)', fontSize: '0.875rem' }}>Loading…</p>
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />
  }

  return children
}