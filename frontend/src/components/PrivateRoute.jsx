// src/components/PrivateRoute.jsx
import { useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { WifiOff } from 'lucide-react'

import Card from '@/components/Card'
import useAuthStore from '@/store/authStore'

// How long the plain "Loading…" may last before we admit the connection is
// slow. Past this, silence looks like a hang.
const SLOW_CONNECTION_HINT_MS = 4000

const screenStyle = {
  minHeight: '100vh',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'var(--bg-base)',
  padding: 16,
}

function LoadingScreen() {
  const [slow, setSlow] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), SLOW_CONNECTION_HINT_MS)
    return () => clearTimeout(timer)
  }, [])

  return (
    <div style={screenStyle}>
      <p style={{ color: 'var(--text-tertiary)', fontSize: '0.875rem' }}>Loading…</p>
      {slow && (
        <p style={{ color: 'var(--text-tertiary)', fontSize: '0.78rem', marginTop: 6 }}>
          Still connecting. Your connection may be slow.
        </p>
      )}
    </div>
  )
}

// Shown when the very first session check could not reach the server. The
// user has NOT been signed out (no cookie or state was cleared), so sending
// them to /login would be both wrong and a needless extra step.
function ConnectionErrorScreen() {
  const retryInitialize = useAuthStore((s) => s.retryInitialize)

  return (
    <div style={screenStyle}>
      <div style={{ width: '100%', maxWidth: 420 }}>
        <Card>
          <div role="alert" style={{ textAlign: 'center', padding: '8px 0' }}>
            <WifiOff size={32} aria-hidden="true" style={{ color: 'var(--text-tertiary)', marginBottom: 12 }} />
            <h1 style={{ fontSize: '1.05rem', fontWeight: 700, fontFamily: "'DM Sans', sans-serif", color: 'var(--text-primary)', marginBottom: 8 }}>
              Can't reach LanceraOS right now
            </h1>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 18 }}>
              Your account and data are safe, and you have not been signed out. Check your connection and try again.
            </p>
            <button type="button" className="fos-btn fos-btn-primary" style={{ padding: '9px 22px' }} onClick={retryInitialize}>
              Try again
            </button>
          </div>
        </Card>
      </div>
    </div>
  )
}

export default function PrivateRoute({ children }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const isInitializing = useAuthStore((s) => s.isInitializing)
  const initError = useAuthStore((s) => s.initError)
  const user = useAuthStore((s) => s.user)
  const location = useLocation()

  if (isInitializing) {
    return <LoadingScreen />
  }

  // The session check could not reach the server — not the same as "not
  // signed in", so no redirect to /login (see authStore.initialize()).
  if (!isAuthenticated && initError) {
    return <ConnectionErrorScreen />
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