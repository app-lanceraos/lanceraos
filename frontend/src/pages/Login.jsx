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

function DeletionModal({ data, onRestore, onContinue, restoring }) {
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

export default function Login() {
  useTitle('LanceraOS | Sign In')
  const navigate = useNavigate()
  const location = useLocation()
  const loginSuccess = useAuthStore((s) => s.loginSuccess)

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

  useEffect(() => {
    loginRef.current?.focus()
    const from = location.state?.from
    if (from && from !== '/login') setRedirectPath(from)
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
      setDeletionData(null)
      navigate(getRedirectPath(), { replace: true })
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to restore account. Please try again.')
      setDeletionData(null)
    } finally {
      setRestoring(false)
    }
  }

  const handleContinueWithDeletion = () => {
    setDeletionData(null)
    navigate(getRedirectPath(), { replace: true })
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
                style={{ accentColor: authTokens.focus }}
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

            <GoogleButton onSuccess={handleOAuthSuccess} onError={setError} disabled={inputsDisabled} />
            <FacebookButton onSuccess={handleOAuthSuccess} onError={setError} disabled={inputsDisabled} />
          </div>
        </form>

        <p style={{ textAlign: 'center', marginTop: 24, fontSize: '0.875rem', color: '#8C89A8' }}>
          New user?{' '}
          <Link to="/register" style={{ color: authTokens.focus, fontWeight: 600 }}>
            Sign up
          </Link>
        </p>
      </AuthLayout>
    </>
  )
}