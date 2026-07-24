// src/components/PrivateRoute.jsx
import { Navigate, useLocation } from 'react-router-dom'
import useAuthStore from '@/store/authStore'

export default function PrivateRoute({ children }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const isInitializing = useAuthStore((s) => s.isInitializing)
  const user = useAuthStore((s) => s.user)
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

  // Centralized here rather than in each of Login.jsx/Register.jsx/
  // GoogleButton.jsx/FacebookButton.jsx's post-success navigation — every
  // one of those already just navigates to getRedirectPath() (typically
  // /profile), so catching "onboarding not done yet" once, for every
  // private route, is simpler and can't drift out of sync across four
  // separate call sites. The exception for /onboarding itself avoids an
  // infinite redirect loop.
  if (user && !user.onboarding_completed && location.pathname !== '/onboarding') {
    return <Navigate to="/onboarding" replace />
  }

  return children
}