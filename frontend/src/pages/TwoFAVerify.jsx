// src/pages/TwoFAVerify.jsx
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Clock } from 'lucide-react'

import api, { getRedirectPath } from '@/lib/api'
import useAuthStore from '@/store/authStore'
import useTitle from '@/hooks/useTitle'
import AuthLayout, { authTokens } from '@/components/AuthLayout'
import AuthButton from '@/components/AuthButton'
import AuthAlert from '@/components/AuthAlert'

function OtpInput({ value, onChange, hasError, success, inputRef }) {
  const [focused, setFocused] = useState(false)
  const borderColor = hasError ? authTokens.error : success ? authTokens.success : focused ? authTokens.focus : authTokens.inputBorder

  return (
    <input
      ref={inputRef}
      type="text"
      inputMode="numeric"
      maxLength={6}
      value={value}
      onChange={onChange}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      placeholder="——————"
      style={{
        width: '100%',
        textAlign: 'center',
        fontSize: '2rem',
        fontWeight: 700,
        letterSpacing: '0.5em',
        textIndent: '0.5em',
        background: authTokens.inputBg,
        border: `2px solid ${borderColor}`,
        borderRadius: 12,
        padding: 14,
        outline: 'none',
        color: '#FFFFFF',
        fontFamily: "'DM Mono', monospace",
        transition: 'border-color 0.15s ease',
      }}
    />
  )
}

export default function TwoFAVerify() {
  useTitle('LanceraOS | Verify Code')
  const navigate = useNavigate()
  const loginSuccess = useAuthStore((s) => s.loginSuccess)

  const sessionId = sessionStorage.getItem('2fa_session_id') || ''
  const maskedEmail = sessionStorage.getItem('2fa_masked_email') || ''

  const [otp, setOtp] = useState('')
  const [trustDevice, setTrustDevice] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [resending, setResending] = useState(false)
  const [resent, setResent] = useState(false)
  const [expired, setExpired] = useState(false)
  const [countdown, setCountdown] = useState(60)
  const [attemptsLeft, setAttemptsLeft] = useState(null)
  const [deletionData, setDeletionData] = useState(null)
  const [restoring, setRestoring] = useState(false)

  const inputRef = useRef(null)
  const intervalRef = useRef(null)

  useEffect(() => {
    if (!sessionId) {
      navigate('/login', { replace: true })
      return
    }
    inputRef.current?.focus()
    startCountdown()
    return () => clearInterval(intervalRef.current)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function startCountdown(from = 60) {
    setCountdown(from)
    clearInterval(intervalRef.current)
    intervalRef.current = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          clearInterval(intervalRef.current)
          return 0
        }
        return c - 1
      })
    }, 1000)
  }

  const clearSession = () => {
    sessionStorage.removeItem('2fa_session_id')
    sessionStorage.removeItem('2fa_masked_email')
    sessionStorage.removeItem('2fa_remember_me')
  }

  const handleOtpChange = (e) => {
    const val = e.target.value.replace(/\D/g, '').slice(0, 6)
    setOtp(val)
    setError('')
    if (val.length === 6) handleVerify(val)
  }

  const handleVerify = async (code = otp) => {
    if (code.length !== 6) {
      setError('Please enter all 6 digits.')
      return
    }
    setLoading(true)
    setError('')
    try {
      // The trusted-device token, if issued, arrives as an httpOnly
      // cookie the browser stores automatically — there is nothing to
      // read out of the response body and store manually here.
      const res = await api.post('/auth/2fa/verify/', {
        session_id: sessionId, otp_code: code, trust_device: trustDevice,
      })
      clearSession()

      loginSuccess(res.data.user)

      if (res.data.deletion_pending) {
        setDeletionData(res.data)
        return
      }
      navigate(getRedirectPath(), { replace: true })
    } catch (err) {
      const msg = err.response?.data?.error || 'Verification failed.'
      if (msg.toLowerCase().includes('expired') || msg.toLowerCase().includes('session')) {
        setExpired(true)
        return
      }
      const match = msg.match(/(\d+) attempt/)
      if (match) setAttemptsLeft(parseInt(match[1], 10))
      setError(msg)
      setOtp('')
      inputRef.current?.focus()
    } finally {
      setLoading(false)
    }
  }

  const handleResend = async () => {
    if (countdown > 0 || resending) return
    setResending(true)
    setError('')
    try {
      await api.post('/auth/2fa/resend/', { session_id: sessionId })
      setResent(true)
      setAttemptsLeft(null)
      setOtp('')
      inputRef.current?.focus()
      startCountdown()
      setTimeout(() => setResent(false), 4000)
    } catch (err) {
      const data = err.response?.data
      if (err.response?.status === 429) {
        const match = data?.error?.match(/(\d+) second/)
        if (match) startCountdown(parseInt(match[1], 10))
        setError(data?.error || 'Please wait before requesting a new code.')
      } else if (data?.error?.toLowerCase().includes('session')) {
        setExpired(true)
      } else {
        setError(data?.error || 'Failed to resend.')
      }
    } finally {
      setResending(false)
    }
  }

  const handleRestoreAndLogin = async () => {
    setRestoring(true)
    try {
      await api.post('/auth/deletion/cancel/')
      setDeletionData(null)
      navigate(getRedirectPath(), { replace: true })
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to restore account.')
      setDeletionData(null)
    } finally {
      setRestoring(false)
    }
  }

  const handleBack = () => {
    clearSession()
    navigate('/login', { replace: true })
  }

  if (expired) {
    return (
      <AuthLayout maxWidth={360}>
        <div style={{ textAlign: 'center' }}>
          <div
            style={{
              width: 60, height: 60, borderRadius: '50%', margin: '0 auto 20px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(230,180,80,0.12)', border: '1px solid rgba(230,180,80,0.4)', color: '#E6B450',
            }}
          >
            <Clock size={28} />
          </div>
          <p style={{ color: '#C7C7C7', fontSize: '0.9rem', marginBottom: 20, lineHeight: 1.55 }}>
            Your verification session has expired. Please log in again to receive a new code.
          </p>
          <AuthButton onClick={handleBack}>Back to Login</AuthButton>
        </div>
      </AuthLayout>
    )
  }

  if (deletionData) {
    return (
      <AuthLayout maxWidth={360}>
        <div style={{ background: 'rgba(230,180,80,0.1)', border: '1px solid rgba(230,180,80,0.35)', borderRadius: 10, padding: '14px 16px', marginBottom: 20 }}>
          <p style={{ fontSize: '0.875rem', color: '#E6B450', lineHeight: 1.55 }}>
            Your account is scheduled for deletion on{' '}
            <strong style={{ color: '#fff' }}>
              {new Date(deletionData.deletion_scheduled_at).toLocaleDateString('en-PK', { dateStyle: 'long' })}
            </strong>
            . Restoring will cancel this and fully restore your account.
          </p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <AuthButton onClick={handleRestoreAndLogin} disabled={restoring}>
            {restoring ? 'Restoring…' : 'Restore my account'}
          </AuthButton>
          <AuthButton variant="ghost" onClick={() => navigate(getRedirectPath(), { replace: true })}>
            Continue with deletion
          </AuthButton>
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout maxWidth={360}>
      <h1 style={{ color: '#fff', fontSize: '1.4rem', fontWeight: 700, marginBottom: 8, textAlign: 'center' }}>
        Enter Verification Code
      </h1>
      <p style={{ color: '#8C89A8', fontSize: '0.85rem', marginBottom: 20, textAlign: 'center' }}>
        Code sent to {maskedEmail}
      </p>

      <p style={{ fontSize: '0.875rem', color: '#C7C7C7', textAlign: 'center', marginBottom: 20, lineHeight: 1.55 }}>
        We sent a 6-digit code to your email. It expires in <strong style={{ color: '#fff' }}>10 minutes</strong>.
      </p>

      {error && (
        <div style={{ marginBottom: 16 }}>
          <AuthAlert variant="error" style={{ textAlign: 'center', justifyContent: 'center' }}>{error}</AuthAlert>
        </div>
      )}
      {resent && (
        <div style={{ marginBottom: 16 }}>
          <AuthAlert variant="success" style={{ textAlign: 'center', justifyContent: 'center' }}>A new code has been sent.</AuthAlert>
        </div>
      )}
      {attemptsLeft !== null && attemptsLeft <= 2 && !error && (
        <div style={{ marginBottom: 16 }}>
          <AuthAlert variant="warning" style={{ textAlign: 'center', justifyContent: 'center' }}>
            {attemptsLeft} attempt{attemptsLeft !== 1 ? 's' : ''} remaining.
          </AuthAlert>
        </div>
      )}

      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 500, color: '#C7C7C7', marginBottom: 8, textAlign: 'center' }}>
          6-Digit Code
        </label>
        <OtpInput
          inputRef={inputRef}
          value={otp}
          onChange={handleOtpChange}
          hasError={!!error}
          success={otp.length === 6 && !error}
        />
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none', margin: '16px 0 20px' }}>
        <input
          type="checkbox"
          checked={trustDevice}
          onChange={(e) => setTrustDevice(e.target.checked)}
          style={{ accentColor: authTokens.focus }}
        />
        <span style={{ fontSize: '0.82rem', color: '#C7C7C7' }}>
          Do not ask again on this device <span style={{ color: authTokens.placeholder }}>(30 days)</span>
        </span>
      </label>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <AuthButton onClick={() => handleVerify()} disabled={loading || otp.length !== 6}>
          {loading ? 'Verifying…' : 'Verify Code'}
        </AuthButton>
        <AuthButton variant="ghost" onClick={handleResend} disabled={countdown > 0 || resending}>
          {resending ? 'Sending…' : countdown > 0 ? `Resend in ${countdown}s` : 'Resend Code'}
        </AuthButton>
        <button
          onClick={handleBack}
          style={{ width: '100%', textAlign: 'center', fontSize: '0.875rem', color: authTokens.placeholder, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
        >
          ← Back to Login
        </button>
      </div>
    </AuthLayout>
  )
}