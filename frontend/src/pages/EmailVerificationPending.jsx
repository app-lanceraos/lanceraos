// src/pages/EmailVerificationPending.jsx
import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Mail } from 'lucide-react'

import api from '@/lib/api'
import useTitle from '@/hooks/useTitle'
import AuthLayout, { authTokens } from '@/components/AuthLayout'
import AuthButton from '@/components/AuthButton'
import AuthAlert from '@/components/AuthAlert'

export default function EmailVerificationPending() {
  useTitle('LanceraOS | Check Your Email')
  const navigate = useNavigate()
  const location = useLocation()
  const email = location.state?.email

  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Polls while this page is open so a user who verifies in a different
  // tab/device gets redirected automatically, instead of sitting on
  // "check your email" indefinitely until they manually come back.
  useEffect(() => {
    if (!email) return
    const interval = setInterval(async () => {
      try {
        const res = await api.get(`/auth/check-verification-status/?email=${encodeURIComponent(email)}`)
        if (res.data.is_verified) {
          clearInterval(interval)
          navigate('/login', { replace: true, state: { message: 'Your email has been verified — you can sign in now.' } })
        }
      } catch {
        /* keep polling */
      }
    }, 5000)
    return () => clearInterval(interval)
  }, [email, navigate])

  const handleResend = async () => {
    if (!email) return setError('No email address found. Please go back and register again.')
    setLoading(true)
    setError('')
    try {
      await api.post('/auth/resend-verification/', { email })
      setSent(true)
      setTimeout(() => setSent(false), 10000)
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to resend. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout maxWidth={360}>
      <div style={{ textAlign: 'center' }}>
        <div
          style={{
            width: 72, height: 72, borderRadius: '50%', margin: '0 auto 20px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(168,156,242,0.12)', border: '2px solid rgba(150,110,255,0.5)', color: authTokens.focus,
          }}
        >
          <Mail size={32} strokeWidth={1.8} />
        </div>

        <h1 style={{ color: '#fff', fontSize: '1.3rem', fontWeight: 700, marginBottom: 6 }}>Check Your Email</h1>
        <p style={{ fontSize: '0.78rem', color: authTokens.placeholder, marginBottom: 4 }}>Verification link sent to:</p>
        <p style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: '0.95rem', color: authTokens.focus, marginBottom: 16, wordBreak: 'break-all' }}>
          {email || 'your email address'}
        </p>

        <p style={{ fontSize: '0.875rem', color: '#C7C7C7', lineHeight: 1.6, marginBottom: 12 }}>
          Click the link in that email to activate your account. Check your{' '}
          <strong style={{ color: '#fff' }}>spam/junk folder</strong> if you don't see it.
        </p>

        <div
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            marginBottom: 20, padding: '8px 14px',
            background: 'rgba(20,17,38,0.5)', border: `1px solid ${authTokens.inputBorder}`, borderRadius: 10,
          }}
        >
          <span style={{ fontSize: '0.75rem', color: authTokens.placeholder }}>
            Once you click the link, come back here and sign in
          </span>
        </div>

        {error && (
          <div style={{ marginBottom: 16, textAlign: 'left' }}>
            <AuthAlert variant="error">{error}</AuthAlert>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {sent ? (
            <AuthAlert variant="success">Verification email resent. Check your inbox and spam folder.</AuthAlert>
          ) : (
            <AuthButton onClick={handleResend} disabled={loading}>
              {loading ? 'Sending…' : 'Resend Verification Email'}
            </AuthButton>
          )}
          <AuthButton variant="ghost" onClick={() => navigate('/login')}>
            Back to Login
          </AuthButton>
        </div>
      </div>
    </AuthLayout>
  )
}