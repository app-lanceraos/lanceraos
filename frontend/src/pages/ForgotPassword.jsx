// src/pages/ForgotPassword.jsx
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Mail, CheckCircle2 } from 'lucide-react'

import api from '@/lib/api'
import useTitle from '@/hooks/useTitle'
import AuthLayout, { authTokens } from '@/components/AuthLayout'
import AuthField from '@/components/AuthField'
import AuthButton from '@/components/AuthButton'
import AuthAlert from '@/components/AuthAlert'

export default function ForgotPassword() {
  useTitle('LanceraOS | Forgot Password')
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!email.trim()) return setError('Please enter your email address.')
    if (!/\S+@\S+\.\S+/.test(email)) return setError('Please enter a valid email address.')
    setLoading(true)
    setError('')
    try {
      await api.post('/auth/forgot-password/', { email: email.trim().toLowerCase() })
      setSent(true)
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout maxWidth={360}>
      {sent ? (
        <div style={{ textAlign: 'center' }}>
          <div
            style={{
              width: 64, height: 64, borderRadius: '50%', margin: '0 auto 20px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(95,208,138,0.12)', border: '1px solid rgba(95,208,138,0.4)', color: authTokens.success,
            }}
          >
            <CheckCircle2 size={30} />
          </div>
          <p style={{ color: '#fff', fontWeight: 700, fontSize: '1rem', marginBottom: 8 }}>Check your inbox</p>
          <p style={{ color: '#C7C7C7', fontSize: '0.875rem', lineHeight: 1.55, marginBottom: 6 }}>
            If an account with <strong style={{ color: '#fff' }}>{email}</strong> exists, a reset link has been sent.
            The link expires in 1 hour.
          </p>
          <p style={{ color: authTokens.placeholder, fontSize: '0.78rem', marginBottom: 20 }}>
            Check your spam folder if you don't see it.
          </p>
          <button
            type="button"
            onClick={() => { setSent(false); setEmail('') }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: authTokens.focus, fontSize: '0.875rem', fontWeight: 500 }}
          >
            Try a different email
          </button>
        </div>
      ) : (
        <>
          <h1 style={{ color: '#fff', fontSize: '1.4rem', fontWeight: 700, marginBottom: 8 }}>Forgot Password?</h1>
          <p style={{ color: '#8C89A8', fontSize: '0.9rem', marginBottom: 24 }}>
            Enter your email and we'll send a reset link.
          </p>

          {error && (
            <div style={{ marginBottom: 16 }}>
              <AuthAlert variant="error">{error}</AuthAlert>
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate>
            <AuthField
              label="Email Address"
              type="email"
              icon={Mail}
              autoComplete="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setError('') }}
            />
            <div style={{ marginTop: '1.75rem' }}>
              <AuthButton type="submit" disabled={loading}>
                {loading ? 'Sending…' : 'Send Reset Link'}
              </AuthButton>
            </div>
          </form>
        </>
      )}

      <p style={{ textAlign: 'center', marginTop: 24, fontSize: '0.875rem', color: '#8C89A8' }}>
        Remember your password?{' '}
        <Link to="/login" style={{ color: authTokens.focus, fontWeight: 600 }}>
          Sign in
        </Link>
      </p>
    </AuthLayout>
  )
}