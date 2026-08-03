// src/components/AdminPrivateRoute.jsx
import { Navigate } from 'react-router-dom'
import useAdminAuthStore from '@/store/adminAuthStore'

export default function AdminPrivateRoute({ children }) {
  const isAuthenticated = useAdminAuthStore((s) => s.isAuthenticated)
  const isInitializing = useAdminAuthStore((s) => s.isInitializing)

  if (isInitializing) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: 'var(--text-tertiary)', fontSize: '0.875rem' }}>Loading…</p>
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  return children
}