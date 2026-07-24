// src/pages/Register.jsx
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Check, X, Eye, EyeOff } from 'lucide-react'

import api from '@/lib/api'
import useTitle from '@/hooks/useTitle'
import AuthLayout, { authTokens } from '@/components/AuthLayout'
import AuthField from '@/components/AuthField'
import AuthSelect from '@/components/AuthSelect'
import AuthButton from '@/components/AuthButton'
import AuthAlert from '@/components/AuthAlert'
import PasswordStrength, { isPasswordValid } from '@/components/PasswordStrength'
import GoogleButton from '@/components/GoogleButton'
import FacebookButton from '@/components/FacebookButton'

const STEPS = [
  { id: 1, label: 'Personal' },
  { id: 2, label: 'Contact' },
  { id: 3, label: 'Password' },
]

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function calcAge(year, month, day) {
  if (!year || !month || !day) return null
  const dob = new Date(year, month - 1, day)
  const today = new Date()
  let age = today.getFullYear() - dob.getFullYear()
  if (today.getMonth() < dob.getMonth() || (today.getMonth() === dob.getMonth() && today.getDate() < dob.getDate())) age--
  return age
}

function suggestUsername(email) {
  if (!email || !email.includes('@')) return ''
  return email
    .split('@')[0]
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 30)
}

function AvailDot({ status }) {
  if (status === 'checking') return <span style={{ fontSize: '0.72rem', color: authTokens.placeholder }}>…</span>
  if (status === 'available') return <Check size={16} color={authTokens.success} strokeWidth={2.5} />
  if (status === 'taken') return <X size={16} color={authTokens.error} strokeWidth={2.5} />
  return null
}

// Spans the full width of the form (matching the AuthFields/buttons below
// it) rather than sitting small and centered — the connector between each
// pair of circles is a flex-growing segment, not a fixed width, so the
// whole bar stretches to fill the container.
function StepBar({ current }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', width: '100%', marginBottom: 28 }}>
      {STEPS.map((s, i) => {
        const done = current > s.id
        const active = current === s.id
        return (
          <div key={s.id} style={{ display: 'contents' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
              <div
                style={{
                  width: 34, height: 34, borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '0.82rem', fontWeight: 700,
                  background: done || active ? authTokens.primaryBg : authTokens.inputBg,
                  color: done ? '#050508' : active ? '#463E72' : authTokens.placeholder,
                  border: `2px solid ${done || active ? authTokens.primaryBg : authTokens.inputBorder}`,
                  transition: 'all 0.25s ease',
                }}
              >
                {done ? <Check size={14} strokeWidth={3} /> : s.id}
              </div>
              <span
                style={{
                  fontSize: '0.72rem', fontWeight: 500, marginTop: 4, whiteSpace: 'nowrap',
                  color: done ? authTokens.success : active ? authTokens.focus : authTokens.placeholder,
                }}
              >
                {s.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div style={{ flex: 1, height: 2, margin: '16px 4px 0', background: done ? authTokens.focus : authTokens.inputBorder, transition: 'background 0.25s ease' }} />
            )}
          </div>
        )
      })}
    </div>
  )
}

export default function Register() {
  useTitle('LanceraOS | Create Account')
  const navigate = useNavigate()

  const [step, setStep] = useState(1)
  const [form, setForm] = useState({
    first_name: '', last_name: '',
    dob_day: '', dob_month: '', dob_year: '',
    email: '', username: '',
    password: '', confirm_password: '',
  })
  const [errors, setErrors] = useState({})
  const [loading, setLoading] = useState(false)
  const [serverError, setServerError] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [emailAvail, setEmailAvail] = useState(null)
  const [usernameAvail, setUsernameAvail] = useState(null)

  const emailTimer = useRef(null)
  const usernameTimer = useRef(null)
  const currentYear = new Date().getFullYear()
  const years = Array.from({ length: 85 }, (_, i) => currentYear - i)

  const set_ = useCallback((field) => (e) => {
    const value = e.target.value
    setForm((prev) => {
      const updated = { ...prev, [field]: value }
      if (field === 'email' && (!prev.username || prev.username === suggestUsername(prev.email))) {
        updated.username = suggestUsername(value)
      }
      return updated
    })
    setErrors((prev) => {
      if (!prev[field]) return prev
      const next = { ...prev }
      delete next[field]
      return next
    })
  }, [])

  useEffect(() => {
    clearTimeout(emailTimer.current)
    const email = form.email.trim().toLowerCase()
    if (!email || !/\S+@\S+\.\S+/.test(email)) {
      setEmailAvail(null)
      return
    }
    setEmailAvail('checking')
    emailTimer.current = setTimeout(async () => {
      try {
        const res = await api.post('/auth/check-availability/', { field: 'email', value: email })
        setEmailAvail(res.data.available ? 'available' : 'taken')
        if (!res.data.available) setErrors((p) => ({ ...p, email: 'This email is already registered.' }))
        else setErrors((p) => { const n = { ...p }; delete n.email; return n })
      } catch {
        setEmailAvail(null)
      }
    }, 500)
    return () => clearTimeout(emailTimer.current)
  }, [form.email])

  useEffect(() => {
    clearTimeout(usernameTimer.current)
    const username = form.username.trim().toLowerCase()
    if (!username || username.length < 3 || !/^[a-zA-Z0-9_]+$/.test(username)) {
      setUsernameAvail(null)
      return
    }
    setUsernameAvail('checking')
    usernameTimer.current = setTimeout(async () => {
      try {
        const res = await api.post('/auth/check-availability/', { field: 'username', value: username })
        setUsernameAvail(res.data.available ? 'available' : 'taken')
        if (!res.data.available) setErrors((p) => ({ ...p, username: 'This username is already taken.' }))
        else setErrors((p) => { const n = { ...p }; delete n.username; return n })
      } catch {
        setUsernameAvail(null)
      }
    }, 500)
    return () => clearTimeout(usernameTimer.current)
  }, [form.username])

  const validateStep1 = () => {
    const e = {}
    if (!form.first_name.trim()) e.first_name = 'First name is required.'
    else if (!/^[a-zA-Z\s-]+$/.test(form.first_name)) e.first_name = 'Letters only.'
    else if (form.first_name.trim().length < 2) e.first_name = 'At least 2 characters.'
    if (form.last_name.trim() && !/^[a-zA-Z\s-]+$/.test(form.last_name)) e.last_name = 'Letters only.'
    if (!form.dob_day || !form.dob_month || !form.dob_year) {
      e.date_of_birth = 'Date of birth is required.'
    } else {
      const age = calcAge(form.dob_year, form.dob_month, form.dob_day)
      if (age === null) e.date_of_birth = 'Enter a valid date.'
      else if (age < 16) e.date_of_birth = 'You must be at least 16 years old.'
      else if (age > 120) e.date_of_birth = 'Enter a valid date of birth.'
    }
    return e
  }

  const validateStep2 = () => {
    const e = {}
    if (!form.email.trim()) e.email = 'Email address is required.'
    else if (!/\S+@\S+\.\S+/.test(form.email)) e.email = 'Enter a valid email address.'
    else if (emailAvail === 'taken') e.email = errors.email || 'This email is already registered.'
    else if (emailAvail === 'checking') e.email = 'Please wait — checking…'
    if (!form.username.trim()) e.username = 'Username is required.'
    else if (form.username.length < 3) e.username = 'At least 3 characters.'
    else if (!/^[a-zA-Z0-9_]+$/.test(form.username)) e.username = 'Letters, numbers, and _ only.'
    else if (usernameAvail === 'taken') e.username = 'This username is already taken.'
    else if (usernameAvail === 'checking') e.username = 'Please wait — checking…'
    return e
  }

  const validateStep3 = () => {
    const e = {}
    if (!form.password) e.password = 'Password is required.'
    else if (!isPasswordValid(form.password)) e.password = 'Password does not meet all requirements below.'
    if (!form.confirm_password) e.confirm_password = 'Please confirm your password.'
    else if (form.password !== form.confirm_password) e.confirm_password = 'Passwords do not match.'
    return e
  }

  const handleNext = () => {
    const e = step === 1 ? validateStep1() : validateStep2()
    if (Object.keys(e).length > 0) {
      setErrors(e)
      return
    }
    setErrors({})
    setServerError('')
    setStep((s) => s + 1)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const e3 = validateStep3()
    if (Object.keys(e3).length > 0) {
      setErrors(e3)
      return
    }
    setLoading(true)
    setServerError('')

    let dob = null
    if (form.dob_day && form.dob_month && form.dob_year) {
      dob = `${form.dob_year}-${String(form.dob_month).padStart(2, '0')}-${String(form.dob_day).padStart(2, '0')}`
    }

    try {
      const res = await api.post('/auth/register/', {
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        date_of_birth: dob,
        email: form.email.trim().toLowerCase(),
        username: form.username.trim().toLowerCase(),
        password: form.password,
        confirm_password: form.confirm_password,
      })
      navigate('/verify-email-pending', { state: { email: res.data.email } })
    } catch (err) {
      const data = err.response?.data
      if (err.response?.status === 429) {
        setServerError(data?.error || 'Too many attempts. Try again in an hour.')
        return
      }
      if (data && typeof data === 'object') {
        const mapped = {}
        Object.keys(data).forEach((k) => { mapped[k] = Array.isArray(data[k]) ? data[k][0] : data[k] })
        const step1Fields = ['first_name', 'last_name', 'date_of_birth']
        const step2Fields = ['email', 'username']
        if (step1Fields.some((f) => mapped[f])) {
          setErrors(mapped)
          setStep(1)
        } else if (step2Fields.some((f) => mapped[f])) {
          setErrors(mapped)
          setStep(2)
        } else {
          setErrors(mapped)
        }
      } else {
        setServerError('Registration failed. Please try again.')
      }
    } finally {
      setLoading(false)
    }
  }

  const handleOAuthSuccess = () => navigate('/dashboard', { replace: true })

  return (
    <AuthLayout formMaxWidth="30rem">
      <h1 style={{ color: '#fff', fontSize: '1.5rem', fontWeight: 700, marginBottom: 8, fontFamily: "'DM Sans', sans-serif" }}>
          Create your account
      </h1>
      <p style={{ color: '#8C89A8', fontSize: '0.9rem', marginBottom: 24 }}>
          Start managing your freelance business
      </p>
      <StepBar current={step} />

      {serverError && (
        <div style={{ marginBottom: 16 }}>
          <AuthAlert variant="error">{serverError}</AuthAlert>
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate>
        {step === 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <AuthField label="First Name" value={form.first_name} onChange={set_('first_name')} error={errors.first_name} autoComplete="given-name" />
              <AuthField label="Last Name (optional)" value={form.last_name} onChange={set_('last_name')} error={errors.last_name} autoComplete="family-name" />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 500, color: '#C7C7C7', marginBottom: 6 }}>
                Date of Birth
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr 1fr', gap: '0.6rem' }}>
                <AuthSelect
                  value={form.dob_day}
                  onChange={set_('dob_day')}
                  placeholder="Day"
                  error={errors.date_of_birth}
                  options={Array.from({ length: 31 }, (_, i) => ({ value: i + 1, label: i + 1 }))}
                />
                <AuthSelect
                  value={form.dob_month}
                  onChange={set_('dob_month')}
                  placeholder="Month"
                  error={errors.date_of_birth}
                  options={MONTHS.map((m, i) => ({ value: i + 1, label: m }))}
                />
                <AuthSelect
                  value={form.dob_year}
                  onChange={set_('dob_year')}
                  placeholder="Year"
                  error={errors.date_of_birth}
                  options={years.map((y) => ({ value: y, label: y }))}
                />
              </div>
              {errors.date_of_birth && (
                <p style={{ fontSize: '0.75rem', color: authTokens.error, marginTop: 6 }}>{errors.date_of_birth}</p>
              )}
            </div>

            <AuthButton onClick={handleNext}>Continue →</AuthButton>
          </div>
        )}

        {step === 2 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <AuthField
              label="Email Address"
              type="email"
              value={form.email}
              onChange={set_('email')}
              error={errors.email}
              autoComplete="email"
              rightElement={<AvailDot status={emailAvail} />}
            />
            <AuthField
              label="Username"
              value={form.username}
              onChange={set_('username')}
              error={errors.username}
              autoComplete="username"
              rightElement={<AvailDot status={usernameAvail} />}
            />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginTop: 4 }}>
              <AuthButton variant="ghost" onClick={() => setStep((s) => s - 1)}>← Back</AuthButton>
              <AuthButton onClick={handleNext}>Continue →</AuthButton>
            </div>
          </div>
        )}

        {step === 3 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
              <AuthField
                label="Password"
                type={showPass ? 'text' : 'password'}
                value={form.password}
                onChange={set_('password')}
                error={errors.password}
                autoComplete="new-password"
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
                value={form.confirm_password}
                onChange={set_('confirm_password')}
                error={errors.confirm_password}
                autoComplete="new-password"
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
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginTop: 4 }}>
              <AuthButton variant="ghost" onClick={() => setStep((s) => s - 1)} disabled={loading}>← Back</AuthButton>
              <AuthButton type="submit" disabled={loading}>{loading ? 'Creating…' : 'Create Account'}</AuthButton>
            </div>
          </div>
        )}
      </form>

      <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: '#6C61A6', fontSize: '0.875rem' }}>
          <span style={{ flex: 1, height: 1, background: '#6C61A6' }} />
          or sign up with
          <span style={{ flex: 1, height: 1, background: '#6C61A6' }} />
        </div>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <GoogleButton onSuccess={handleOAuthSuccess} onError={setServerError} />
          <FacebookButton onSuccess={handleOAuthSuccess} onError={setServerError} />
        </div>
      </div>

      <p style={{ textAlign: 'center', marginTop: 24, fontSize: '0.875rem', color: '#8C89A8' }}>
        Already a user?{' '}
        <Link to="/login" style={{ color: authTokens.focus, fontWeight: 600 }}>
          Sign in
        </Link>
      </p>
    </AuthLayout>
  )
}