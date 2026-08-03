// src/pages/AddPassword.jsx
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Check, CheckCircle2, Eye, EyeOff, X, XCircle } from 'lucide-react'

import api from '@/lib/api'
import useTitle from '@/hooks/useTitle'
import AuthLayout, { authTokens } from '@/components/AuthLayout'
import AuthField from '@/components/AuthField'
import AuthButton from '@/components/AuthButton'
import PasswordStrength from '@/components/PasswordStrength'

function Spinner() {
  return (
    <div
      style={{
        width: 40, height: 40, margin: '0 auto 16px',
        border: `3px solid ${authTokens.focus}`, borderTopColor: 'transparent',
        borderRadius: '50%', animation: 'add-password-spin 0.7s linear infinite',
      }}
    >
      <style>{'@keyframes add-password-spin { to { transform: rotate(360deg); } }'}</style>
    </div>
  )
}

export default function AddPassword() {
  useTitle('LanceraOS | Add Password')
  const { uidb64, token } = useParams()
  const navigate = useNavigate()

  const [status, setStatus] = useState('validating') // validating | form | submitting | success | error
  const [errorMsg, setErrorMsg] = useState('')
  const [form, setForm] = useState({ password: '', confirm_password: '' })
  const [fieldError, setFieldError] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  useEffect(() => {
    api.get(`/auth/security/add-password/validate/${uidb64}/${token}/`)
      .then(() => setStatus('form'))
      .catch((err) => {
        setErrorMsg(err.response?.data?.error || 'This link is invalid or has expired.')
        setStatus('error')
      })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }))
    setFieldError('')
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.password || !form.confirm_password) return setFieldError('Please fill both fields.')
    if (form.password !== form.confirm_password) return setFieldError('Passwords do not match.')

    setStatus('submitting')
    setFieldError('')
    try {
      await api.post(`/auth/security/add-password/complete/${uidb64}/${token}/`, form)
      setStatus('success')
    } catch (err) {
      const data = err.response?.data
      const msg = data?.password || data?.confirm_password || data?.error || 'Something went wrong. Please try again.'
      setStatus('form')
      setFieldError(msg)
    }
  }

  if (status === 'validating') {
    return (
      <AuthLayout maxWidth={360}>
        <div style={{ textAlign: 'center', padding: '20px 0' }}>
          <Spinner />
          <p style={{ color: '#C7C7C7', fontSize: '0.9rem' }}>Validating your link…</p>
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
              width: 60, height: 60, borderRadius: '50%', margin: '0 auto 20px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(242,116,139,0.12)', border: '1px solid rgba(242,116,139,0.4)', color: authTokens.error,
            }}
          >
            <XCircle size={28} />
          </div>
          <p style={{ color: '#C7C7C7', fontSize: '0.9rem', marginBottom: 20 }}>{errorMsg}</p>
          <Link to="/settings?tab=security" style={{ textDecoration: 'none' }}>
            <AuthButton>Back to Settings</AuthButton>
          </Link>
        </div>
      </AuthLayout>
    )
  }

  if (status === 'success') {
    return (
      <AuthLayout maxWidth={360}>
        <div style={{ textAlign: 'center' }}>
          <div
            style={{
              width: 60, height: 60, borderRadius: '50%', margin: '0 auto 20px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(95,208,138,0.12)', border: '1px solid rgba(95,208,138,0.4)', color: authTokens.success,
            }}
          >
            <CheckCircle2 size={28} />
          </div>
          <p style={{ color: '#C7C7C7', fontSize: '0.9rem', lineHeight: 1.6, marginBottom: 20 }}>
            Password added. You can now sign in with your email and password, in addition to your
            existing sign-in method.
          </p>
          <AuthButton onClick={() => navigate('/login')}>Sign In</AuthButton>
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout maxWidth={360}>
      <h1 style={{ color: '#fff', fontSize: '1.4rem', fontWeight: 700, marginBottom: 8 }}>Add a Password</h1>
      <p style={{ color: '#8C89A8', fontSize: '0.9rem', marginBottom: 24 }}>
        Choose a password to sign in with your email, alongside your existing sign-in method.
      </p>

      <form onSubmit={handleSubmit} noValidate>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <AuthField
              label="Password"
              type={showPass ? 'text' : 'password'}
              autoComplete="new-password"
              value={form.password}
              onChange={(e) => handleChange('password', e.target.value)}
              error={fieldError && !form.confirm_password ? fieldError : undefined}
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
            <PasswordStrength password={form.password} />
          </div>

          <div>
            <AuthField
              label="Confirm Password"
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
              <p style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.75rem', marginTop: 6, color: form.password === form.confirm_password ? authTokens.success : authTokens.error }}>
                {form.password === form.confirm_password ? <Check size={13} /> : <X size={13} />}
                {form.password === form.confirm_password ? 'Passwords match' : 'Passwords do not match'}
              </p>
            )}
            {fieldError && form.confirm_password && (
              <p style={{ fontSize: '0.75rem', color: authTokens.error, marginTop: 6 }}>{fieldError}</p>
            )}
          </div>
        </div>

        <div style={{ marginTop: '1.75rem' }}>
          <AuthButton type="submit" disabled={status === 'submitting' || !form.password || !form.confirm_password}>
            {status === 'submitting' ? 'Adding…' : 'Add Password'}
          </AuthButton>
        </div>
      </form>
    </AuthLayout>
  )
}
