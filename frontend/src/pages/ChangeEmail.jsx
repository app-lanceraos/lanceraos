// src/pages/ChangeEmail.jsx
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { CheckCircle2, Eye, EyeOff, XCircle } from 'lucide-react'

import api from '@/lib/api'
import useTitle from '@/hooks/useTitle'
import AuthLayout, { authTokens } from '@/components/AuthLayout'
import AuthField from '@/components/AuthField'
import AuthButton from '@/components/AuthButton'
import AuthAlert from '@/components/AuthAlert'

function Spinner() {
  return (
    <div
      style={{
        width: 40, height: 40, margin: '0 auto 16px',
        border: `3px solid ${authTokens.focus}`, borderTopColor: 'transparent',
        borderRadius: '50%', animation: 'change-email-spin 0.7s linear infinite',
      }}
    >
      <style>{'@keyframes change-email-spin { to { transform: rotate(360deg); } }'}</style>
    </div>
  )
}

// The only form fields this page actually has — used to distinguish a
// field-specific server error from a generic one. v1 treated every JSON
// error response as field-mappable (since {error: "..."} is technically
// an object too), which meant a generic error landed in `errors.error` —
// a key no field ever displays, so the user saw nothing at all on
// failure. This keeps generic errors visible via AuthAlert instead.
const FORM_FIELDS = new Set(['new_email', 'password'])

export default function ChangeEmail() {
  useTitle('LanceraOS | Change Email')
  const { ecr_uid, token } = useParams()
  const navigate = useNavigate()

  const [status, setStatus] = useState('validating') // validating | form | submitting | success | error
  const [tokenInfo, setTokenInfo] = useState(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [form, setForm] = useState({ new_email: '', password: '' })
  const [errors, setErrors] = useState({})
  const [genericError, setGenericError] = useState('')
  const [showPass, setShowPass] = useState(false)

  useEffect(() => {
    api.get(`/auth/email-change/validate/${ecr_uid}/${token}/`)
      .then((res) => {
        setTokenInfo(res.data)
        setStatus('form')
      })
      .catch((err) => {
        setErrorMsg(err.response?.data?.error || 'This link is invalid or has expired.')
        setStatus('error')
      })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }))
    setErrors((prev) => { const n = { ...prev }; delete n[field]; return n })
    setGenericError('')
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const errs = {}
    if (!form.new_email.trim()) errs.new_email = 'New email address is required.'
    else if (!/\S+@\S+\.\S+/.test(form.new_email)) errs.new_email = 'Enter a valid email address.'
    if (!form.password) errs.password = 'Your current password is required.'
    if (Object.keys(errs).length > 0) {
      setErrors(errs)
      return
    }

    setStatus('submitting')
    setGenericError('')
    try {
      await api.post(`/auth/email-change/complete/${ecr_uid}/${token}/`, {
        new_email: form.new_email.trim().toLowerCase(),
        password: form.password,
      })
      setStatus('success')
    } catch (err) {
      const data = err.response?.data
      setStatus('form')
      if (data && typeof data === 'object') {
        const mapped = {}
        let sawGeneric = false
        Object.keys(data).forEach((k) => {
          const value = Array.isArray(data[k]) ? data[k][0] : data[k]
          if (FORM_FIELDS.has(k)) {
            mapped[k] = value
          } else {
            sawGeneric = true
            setGenericError(value)
          }
        })
        setErrors(mapped)
        if (!sawGeneric && Object.keys(mapped).length === 0) {
          setGenericError('Something went wrong. Please try again.')
        }
      } else {
        setGenericError('Something went wrong. Please try again.')
      }
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
          <Link to="/profile" style={{ textDecoration: 'none' }}>
            <AuthButton>Back to Profile</AuthButton>
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
            An activation link has been sent to your new email address. Click it to complete the change.
            The link expires in 24 hours.
          </p>
          <Link to="/login" style={{ textDecoration: 'none' }}>
            <AuthButton>Sign In</AuthButton>
          </Link>
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout maxWidth={360}>
      <h1 style={{ color: '#fff', fontSize: '1.3rem', fontWeight: 700, marginBottom: 8 }}>Change Your Email</h1>
      <p style={{ color: '#8C89A8', fontSize: '0.85rem', marginBottom: 20 }}>
        Verifying as: {tokenInfo?.current_email || '…'}
      </p>

      <p style={{ fontSize: '0.875rem', color: '#C7C7C7', marginBottom: 20, lineHeight: 1.55 }}>
        Enter your new email address and current password. An activation link will be sent to your new inbox.
      </p>

      {genericError && (
        <div style={{ marginBottom: 16 }}>
          <AuthAlert variant="error">{genericError}</AuthAlert>
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <AuthField
            label="New Email Address"
            type="email"
            autoComplete="email"
            value={form.new_email}
            onChange={(e) => handleChange('new_email', e.target.value)}
            error={errors.new_email}
          />
          <AuthField
            label="Current Password"
            type={showPass ? 'text' : 'password'}
            autoComplete="current-password"
            value={form.password}
            onChange={(e) => handleChange('password', e.target.value)}
            error={errors.password}
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

        <div style={{ marginTop: 20 }}>
          <AuthAlert variant="info" style={{ fontSize: '0.8rem' }}>
            You can only change your email once every 3 months.
          </AuthAlert>
        </div>

        <div style={{ marginTop: 20 }}>
          <AuthButton type="submit" disabled={status === 'submitting'}>
            {status === 'submitting' ? 'Sending activation link…' : 'Send Activation Link to New Email'}
          </AuthButton>
        </div>
      </form>
    </AuthLayout>
  )
}