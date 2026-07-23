// src/pages/ResetPassword.jsx
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Check, CheckCircle2, Eye, EyeOff, X, XCircle } from 'lucide-react'

import api from '@/lib/api'
import useTitle from '@/hooks/useTitle'
import AuthLayout, { authTokens } from '@/components/AuthLayout'
import AuthField from '@/components/AuthField'
import AuthButton from '@/components/AuthButton'
import AuthAlert from '@/components/AuthAlert'
import PasswordStrength from '@/components/PasswordStrength'

export default function ResetPassword() {
  useTitle('LanceraOS | Reset Password')
  const { uid, token } = useParams()
  const navigate = useNavigate()

  const [form, setForm] = useState({ new_password: '', confirm_password: '' })
  const [status, setStatus] = useState('form') // form | success | error
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPass, setShowPass] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  const handleChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }))
    setError('')
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.new_password || !form.confirm_password) return setError('Please fill both fields.')
    if (form.new_password !== form.confirm_password) return setError('Passwords do not match.')
    setLoading(true)
    setError('')
    try {
      await api.post(`/auth/reset-password/${uid}/${token}/`, form)
      setStatus('success')
    } catch (err) {
      const msg = err.response?.data?.error || 'Reset failed.'
      if (msg.toLowerCase().includes('expired') || msg.toLowerCase().includes('invalid')) setStatus('error')
      else setError(msg)
    } finally {
      setLoading(false)
    }
  }

  if (status === 'success') {
    return (
      <AuthLayout maxWidth={360}>
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
          <p style={{ color: '#C7C7C7', fontSize: '0.9rem', lineHeight: 1.55, marginBottom: 20 }}>
            Your password has been reset. You can now sign in with your new password.
          </p>
          <AuthButton onClick={() => navigate('/login')}>Sign In Now</AuthButton>
        </div>
      </AuthLayout>
    )
  }

  if (status === 'error') {
    return (
      <AuthLayout maxWidth={360}>
        <div style={{ textAlign: 'center' }}>
          <div
            style={{
              width: 64, height: 64, borderRadius: '50%', margin: '0 auto 20px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(242,116,139,0.12)', border: '1px solid rgba(242,116,139,0.4)', color: authTokens.error,
            }}
          >
            <XCircle size={30} />
          </div>
          <p style={{ color: '#C7C7C7', fontSize: '0.9rem', lineHeight: 1.55, marginBottom: 20 }}>
            This reset link has expired or already been used.
          </p>
          <Link to="/forgot-password" style={{ textDecoration: 'none' }}>
            <AuthButton>Request New Link</AuthButton>
          </Link>
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout maxWidth={360}>
      <h1 style={{ color: '#fff', fontSize: '1.4rem', fontWeight: 700, marginBottom: 8 }}>Create New Password</h1>
      <p style={{ color: '#8C89A8', fontSize: '0.9rem', marginBottom: 24 }}>
        Choose a strong password for your account.
      </p>

      <form onSubmit={handleSubmit} noValidate>
        {error && (
          <div style={{ marginBottom: 16 }}>
            <AuthAlert variant="error">{error}</AuthAlert>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <AuthField
              label="New Password"
              type={showPass ? 'text' : 'password'}
              autoComplete="new-password"
              value={form.new_password}
              onChange={(e) => handleChange('new_password', e.target.value)}
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
            <PasswordStrength password={form.new_password} />
          </div>

          <div>
            <AuthField
              label="Confirm New Password"
              type={showConfirm ? 'text' : 'password'}
              autoComplete="new-password"
              value={form.confirm_password}
              onChange={(e) => handleChange('confirm_password', e.target.value)}
              rightElement={
                <button
                  type="button"
                  onClick={() => setShowConfirm((v) => !v)}
                  tabIndex={-1}
                  aria-label={showConfirm ? 'Hide password' : 'Show password'}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: authTokens.placeholder, padding: 0, display: 'flex' }}
                >
                  {showConfirm ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              }
            />
            {form.confirm_password && (
              <p style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.75rem', marginTop: 6, color: form.new_password === form.confirm_password ? authTokens.success : authTokens.error }}>
                {form.new_password === form.confirm_password ? <Check size={13} /> : <X size={13} />}
                {form.new_password === form.confirm_password ? 'Passwords match' : 'Passwords do not match'}
              </p>
            )}
          </div>
        </div>

        <div style={{ marginTop: '1.75rem' }}>
          <AuthButton type="submit" disabled={loading || !form.new_password || !form.confirm_password}>
            {loading ? 'Resetting…' : 'Reset Password'}
          </AuthButton>
        </div>
      </form>

      <p style={{ textAlign: 'center', marginTop: 24, fontSize: '0.875rem', color: '#8C89A8' }}>
        <Link to="/login" style={{ color: authTokens.focus, fontWeight: 600 }}>
          Back to Sign In
        </Link>
      </p>
    </AuthLayout>
  )
}