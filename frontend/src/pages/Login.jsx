// src/pages/Login.jsx
import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { AlertTriangle, Eye, EyeOff, Lock, User } from 'lucide-react'

import api, { getRedirectPath, setRedirectPath } from '@/lib/api'
import useAuthStore from '@/store/authStore'
import useTitle from '@/hooks/useTitle'
import AuthLayout, { authTokens } from '@/components/AuthLayout'
import AuthField from '@/components/AuthField'
import AuthButton from '@/components/AuthButton'
import AuthAlert from '@/components/AuthAlert'
import GoogleButton from '@/components/GoogleButton'
import FacebookButton from '@/components/FacebookButton'
import DeletionModal from '@/components/DeletionModal'

export default function Login() {
  useTitle('LanceraOS | Sign In')
  const navigate = useNavigate()
  const location = useLocation()
  const loginSuccess = useAuthStore((s) => s.loginSuccess)
  const setDeletionWarning = useAuthStore((s) => s.setDeletionWarning)
  const logout = useAuthStore((s) => s.logout)

  const [form, setForm] = useState({ login: '', password: '' })
  const [rememberMe, setRememberMe] = useState(false)
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [lockError, setLockError] = useState(null)
  const [warningError, setWarningError] = useState(null)
  const [showForgotBig, setShowForgotBig] = useState(false)
  const [deletionData, setDeletionData] = useState(null)
  const [restoring, setRestoring] = useState(false)

  const loginRef = useRef(null)

  // Captured once, on mount, from the query param `_forceLogout` (api.js)
  // appends before its hard redirect here — read before the cleanup effect
  // below strips that param, so the message survives the URL rewrite
  // instead of disappearing the instant it's cleaned up.
  const [sessionExpired] = useState(() => new URLSearchParams(location.search).get('session_expired') === '1')

  useEffect(() => {
    loginRef.current?.focus()
    const from = location.state?.from
    if (from && from !== '/login') setRedirectPath(from)
    if (new URLSearchParams(location.search).get('session_expired')) {
      navigate('/login', { replace: true })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const clearErrors = () => {
    setError('')
    setLockError(null)
    setWarningError(null)
  }

  const handleChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }))
    clearErrors()
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const loginVal = form.login.trim().toLowerCase()
    const passVal = form.password.trim()
    if (!loginVal) return setError('Please enter your email or username.')
    if (!passVal) return setError('Please enter your password.')

    setLoading(true)
    clearErrors()

    try {
      const res = await api.post('/auth/login/', {
        login: loginVal,
        password: passVal,
        remember_me: rememberMe,
      })
      const data = res.data

      if (data.requires_2fa) {
        sessionStorage.setItem('2fa_session_id', data.session_id)
        sessionStorage.setItem('2fa_masked_email', data.masked_email)
        sessionStorage.setItem('2fa_remember_me', rememberMe ? '1' : '0')
        navigate('/2fa-verify')
        return
      }

      // Cookies are already set by the backend at this point, regardless
      // of whether deletion is pending — the session is genuinely active.
      loginSuccess(data.user)

      if (data.deletion_pending) {
        setDeletionData(data)
        return
      }

      navigate(getRedirectPath(), { replace: true })
    } catch (err) {
      const httpStatus = err.response?.status
      const data = err.response?.data
      if (!data) return setError('Connection error. Please check your internet and try again.')
      if (data.email_not_verified) return navigate('/verify-email-pending', { state: { email: data.email } })
      if (httpStatus === 423 || data.locked) return setLockError({ message: data.error, locked_until: data.locked_until })
      if (httpStatus === 429) return setError(data.error || 'Too many attempts. Please try again later.')
      if (data.warning) {
        setWarningError({ message: data.error })
        setShowForgotBig(true)
        return
      }
      setError(data.error || 'Login failed. Please try again.')
      setShowForgotBig(true)
    } finally {
      setLoading(false)
    }
  }

  const handleRestoreAccount = async () => {
    setRestoring(true)
    try {
      await api.post('/auth/deletion/cancel/')
      setDeletionWarning(null)
      setDeletionData(null)
      navigate(getRedirectPath(), { replace: true })
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to restore account. Please try again.')
      setDeletionData(null)
    } finally {
      setRestoring(false)
    }
  }

  const handleContinueWithDeletion = async () => {
    const scheduledDate = deletionData?.deletion_scheduled_at
    setDeletionData(null)
    await logout() // revokes the session this login just created, clears cookies
    navigate('/login', {
      replace: true,
      state: {
        message: scheduledDate
          ? `Your account will be deleted on ${new Date(scheduledDate).toLocaleDateString('en-PK', { dateStyle: 'long' })}. You can log in again anytime before then to restore it.`
          : 'Your account deletion is still scheduled. You can log in again anytime before then to restore it.',
      },
    })
  }

  const handleOAuthSuccess = (data) => {
    if (data.deletion_pending) {
      setDeletionData(data)
      return
    }
    navigate(getRedirectPath(), { replace: true })
  }

  const inputsDisabled = loading || !!lockError

  return (
    <>
      {deletionData && (
        <DeletionModal
          data={deletionData}
          onRestore={handleRestoreAccount}
          onContinue={handleContinueWithDeletion}
          restoring={restoring}
        />
      )}

      <AuthLayout maxWidth={360}>
        <h1 style={{ color: '#fff', fontSize: '1.5rem', fontWeight: 700, marginBottom: 8, fontFamily: "'DM Sans', sans-serif" }}>
          Welcome Back
        </h1>
        <p style={{ color: '#8C89A8', fontSize: '0.9rem', marginBottom: 24 }}>
          Sign in to continue managing your freelance business.
        </p>

        {location.state?.message && (
          <div style={{ marginBottom: 20 }}>
            <AuthAlert variant="success">{location.state.message}</AuthAlert>
          </div>
        )}
        {sessionExpired && !location.state?.message && (
          <div style={{ marginBottom: 20 }}>
            <AuthAlert variant="info">Your session has ended — please sign in again.</AuthAlert>
          </div>
        )}
        {error && !lockError && (
          <div style={{ marginBottom: 16 }}>
            <AuthAlert variant="error">{error}</AuthAlert>
          </div>
        )}
        {warningError && (
          <div style={{ marginBottom: 16 }}>
            <AuthAlert variant="warning">{warningError.message}</AuthAlert>
          </div>
        )}
        {lockError && (
          <div style={{ marginBottom: 16 }}>
            <AuthAlert variant="error">
              <div style={{ marginBottom: 10 }}>{lockError.message}</div>
              <Link to="/forgot-password" style={{ color: authTokens.focus, fontWeight: 600, fontSize: '0.82rem' }}>
                Reset Password to Unlock Account →
              </Link>
            </AuthAlert>
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <AuthField
              label="Email or Username"
              icon={User}
              autoComplete="username"
              value={form.login}
              onChange={(e) => handleChange('login', e.target.value)}
              disabled={inputsDisabled}
            />
            <AuthField
              label="Password"
              icon={Lock}
              type={showPass ? 'text' : 'password'}
              autoComplete="current-password"
              value={form.password}
              onChange={(e) => handleChange('password', e.target.value)}
              disabled={inputsDisabled}
              rightElement={
                <button
                  type="button"
                  onClick={() => setShowPass((v) => !v)}
                  tabIndex={-1}
                  aria-label={showPass ? 'Hide password' : 'Show password'}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: authTokens.placeholder, padding: 0, display: 'flex' }}
                >
                  {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              }
            />
          </div>

          <div style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none', fontSize: '0.875rem', color: '#C7C7C7' }}>
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="round-check"
                style={{
                  appearance: 'none',
                  WebkitAppearance: 'none',
                  width: '18px',
                  height: '18px',
                  borderRadius: '50%',
                  border: '1px solid #342E58',
                  background: rememberMe ? authTokens.focus : '#141126',
                  cursor: 'pointer',
                  flexShrink: 0,
                  position: 'relative',
                }}
              />
              Remember me
            </label>
            <Link
              to="/forgot-password"
              style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.875rem', color: showForgotBig ? '#E6B450' : '#C7C7C7', fontWeight: showForgotBig ? 600 : 400, textDecoration: 'none' }}
            >
              {showForgotBig && <AlertTriangle size={13} />}
              Forgot Password?
            </Link>
          </div>

          <div style={{ marginTop: '1.75rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <AuthButton type="submit" disabled={inputsDisabled}>
              {loading ? 'Signing in…' : 'Sign In'}
            </AuthButton>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '4px 0', color: '#6C61A6', fontSize: '0.875rem' }}>
              <span style={{ flex: 1, height: 1, background: '#6C61A6' }} />
              or continue with
              <span style={{ flex: 1, height: 1, background: '#6C61A6' }} />
            </div>

            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <GoogleButton onSuccess={handleOAuthSuccess} onError={setError} disabled={inputsDisabled} />
              <FacebookButton onSuccess={handleOAuthSuccess} onError={setError} disabled={inputsDisabled} />
            </div>
          </div>
        </form>

        <p style={{ textAlign: 'center', marginTop: 24, fontSize: '0.875rem', color: '#8C89A8' }}>
          New user?{' '}
          <Link to="/register" style={{ color: authTokens.focus, fontWeight: 600 }}>
            Sign up
          </Link>
        </p>
      </AuthLayout>

      <style>{`
        .round-check:checked::after {
          content: "";
          position: absolute;
          left: 50%;
          top: 45%;
          width: 4px;
          height: 8px;
          border: solid #141126;
          border-width: 0 2px 2px 0;
          transform: translate(-50%, -50%) rotate(45deg);
        }
      `}</style>
      
    </>   
  ) 
}