// src/pages/Onboarding.jsx
//
// New for v2 — this feature did not exist in v1. Required for everyone
// after their first successful login: email/password users already gave
// their name/DOB at registration, so they only see the profession/
// income-source/platform fields; OAuth users (Google/Facebook never
// supply a birthday, and typically only supply name+email) additionally
// see a username-review field (pre-filled with their auto-generated
// username, editable) and a required date-of-birth field, since that's
// the only point at which their age can be verified at all.
//
// Uses the orbit AuthLayout shell rather than AppShell — this is a
// continuation of the signup journey (the person hasn't seen the real
// app yet), not a page within it.
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, X } from 'lucide-react'

import api from '@/lib/api'
import useAuthStore from '@/store/authStore'
import useTitle from '@/hooks/useTitle'
import AuthLayout, { authTokens } from '@/components/AuthLayout'
import AuthField from '@/components/AuthField'
import AuthSelect from '@/components/AuthSelect'
import AuthButton from '@/components/AuthButton'
import AuthAlert from '@/components/AuthAlert'

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const INCOME_SOURCE_OPTIONS = [
  { value: 'full_time', label: 'Full-time freelancer' },
  { value: 'part_time', label: 'Part-time, alongside a job' },
  { value: 'side_income', label: 'Occasional side income' },
  { value: 'student', label: 'Student' },
]

const PLATFORM_OPTIONS = [
  { value: 'upwork', label: 'Upwork' },
  { value: 'fiverr', label: 'Fiverr' },
  { value: 'direct', label: 'Direct clients' },
  { value: 'other', label: 'Other' },
]

function calcAge(year, month, day) {
  if (!year || !month || !day) return null
  const dob = new Date(year, month - 1, day)
  const today = new Date()
  let age = today.getFullYear() - dob.getFullYear()
  if (today.getMonth() < dob.getMonth() || (today.getMonth() === dob.getMonth() && today.getDate() < dob.getDate())) age--
  return age
}

function AvailDot({ status }) {
  if (status === 'checking') return <span style={{ fontSize: '0.72rem', color: authTokens.placeholder }}>…</span>
  if (status === 'available') return <Check size={16} color={authTokens.success} strokeWidth={2.5} />
  if (status === 'taken') return <X size={16} color={authTokens.error} strokeWidth={2.5} />
  return null
}

export default function Onboarding() {
  useTitle('LanceraOS | Welcome')
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const updateUser = useAuthStore((s) => s.updateUser)
  const clearLocalAuth = useAuthStore((s) => s.clearLocalAuth)

  // DOB was already collected at registration for email/password users —
  // only ask for it here if it's genuinely missing (OAuth signups).
  const needsDob = !user?.date_of_birth
  // Same underlying signal as needsDob — email/password users already
  // chose their own username at registration; only OAuth signups (whose
  // username was auto-generated, never actually chosen) need to review
  // or change it here.
  const needsUsername = needsDob
  // Same reasoning: email/password users already accepted the Terms of
  // Service / Privacy Policy at registration — OAuth signups skip that
  // wizard entirely, so onboarding is the first and only chance to ask.
  const needsTermsAcceptance = !user?.terms_accepted_at
  const currentYear = new Date().getFullYear()
  const years = Array.from({ length: 85 }, (_, i) => currentYear - i)

  const [form, setForm] = useState({
    username: '',
    dob_day: '', dob_month: '', dob_year: '',
    profession: '', income_source: '', platform_used: '',
  })
  const [errors, setErrors] = useState({})
  const [serverError, setServerError] = useState('')
  const [loading, setLoading] = useState(false)
  const [usernameAvail, setUsernameAvail] = useState(null)
  const [agreedToTerms, setAgreedToTerms] = useState(false)
  const usernameTimer = useRef(null)
  const originalUsername = useRef(user?.username || '')

  useEffect(() => {
    if (user?.username) {
      setForm((prev) => ({ ...prev, username: user.username }))
      originalUsername.current = user.username
    }
  }, [user?.username])

  useEffect(() => {
    clearTimeout(usernameTimer.current)
    const username = form.username.trim().toLowerCase()

    // Skip the live check entirely when unchanged from their own current
    // username — /auth/check-availability/ has no way to exclude "the
    // person asking" from its uniqueness check (it's designed for
    // pre-registration, when no user exists yet), so checking someone's
    // own unchanged username against it would always incorrectly come
    // back "taken."
    if (!username || username === originalUsername.current.toLowerCase()
        || username.length < 3 || !/^[a-zA-Z0-9_]+$/.test(username)) {
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

  const handleChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }))
    setErrors((prev) => { const n = { ...prev }; delete n[field]; return n })
  }

  const validate = () => {
    const e = {}
    if (needsUsername) {
      if (!form.username.trim()) e.username = 'Username is required.'
      else if (form.username.length < 3) e.username = 'At least 3 characters.'
      else if (!/^[a-zA-Z0-9_]+$/.test(form.username)) e.username = 'Letters, numbers, and _ only.'
      else if (usernameAvail === 'taken') e.username = errors.username || 'This username is already taken.'
      else if (usernameAvail === 'checking') e.username = 'Please wait — checking…'
    }

    if (needsDob) {
      if (!form.dob_day || !form.dob_month || !form.dob_year) {
        e.date_of_birth = 'Date of birth is required.'
      } else {
        const age = calcAge(form.dob_year, form.dob_month, form.dob_day)
        if (age === null) e.date_of_birth = 'Enter a valid date.'
        else if (age < 16) e.date_of_birth = 'You must be at least 16 years old to use LanceraOS.'
        else if (age > 120) e.date_of_birth = 'Enter a valid date of birth.'
      }
    }

    if (!form.profession.trim()) e.profession = 'This helps us tailor LanceraOS to your work.'
    if (!form.income_source) e.income_source = 'Please select one.'
    if (!form.platform_used) e.platform_used = 'Please select one.'

    if (needsTermsAcceptance && !agreedToTerms) {
      e.agreedToTerms = 'You must agree to the Terms of Service and Privacy Policy to continue.'
    }
    return e
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const validationErrors = validate()
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors)
      return
    }

    setLoading(true)
    setServerError('')
    try {
      const payload = {
        profession: form.profession.trim(),
        income_source: form.income_source,
        platform_used: form.platform_used,
      }
      if (needsUsername) {
        payload.username = form.username.trim().toLowerCase()
      }
      if (needsDob) {
        payload.date_of_birth = `${form.dob_year}-${String(form.dob_month).padStart(2, '0')}-${String(form.dob_day).padStart(2, '0')}`
      }
      if (needsTermsAcceptance) {
        payload.agreed_to_terms = agreedToTerms
      }

      const res = await api.post('/auth/onboarding/complete/', payload)
      updateUser(res.data)
      navigate('/profile', { replace: true })
    } catch (err) {
      const data = err.response?.data

      // The account was under 16 and has been anonymized server-side —
      // there is no session left to return to, only a clear explanation
      // and a path back to (a fresh) login.
      if (err.response?.status === 403 && data?.account_closed) {
        clearLocalAuth()
        navigate('/login', { replace: true, state: { message: data.error } })
        return
      }

      if (data && typeof data === 'object') {
        const mapped = {}
        Object.keys(data).forEach((k) => { mapped[k] = Array.isArray(data[k]) ? data[k][0] : data[k] })
        setErrors(mapped)
      } else {
        setServerError('Something went wrong. Please try again.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout formMaxWidth="26rem">
      <h1 style={{ color: '#fff', fontSize: '1.4rem', fontWeight: 700, marginBottom: 8, fontFamily: "'DM Sans', sans-serif" }}>
        Welcome to LanceraOS
      </h1>
      <p style={{ color: '#8C89A8', fontSize: '0.9rem', marginBottom: 24 }}>
        A few quick questions to set up your account.
      </p>

      {serverError && (
        <div style={{ marginBottom: 16 }}>
          <AuthAlert variant="error">{serverError}</AuthAlert>
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {needsUsername && (
            <div>
              <AuthField
                label="Username"
                value={form.username}
                onChange={(e) => handleChange('username', e.target.value)}
                error={errors.username}
                autoComplete="username"
                rightElement={<AvailDot status={usernameAvail} />}
              />
              <p style={{ fontSize: '0.75rem', color: authTokens.placeholder, marginTop: 6 }}>
                We generated this for you — change it if you'd like something different.
              </p>
            </div>
          )}

          {needsDob && (
            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 500, color: '#C7C7C7', marginBottom: 6 }}>
                Date of Birth
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr 1fr', gap: '0.6rem' }}>
                <AuthSelect
                  value={form.dob_day}
                  onChange={(e) => handleChange('dob_day', e.target.value)}
                  placeholder="Day"
                  error={errors.date_of_birth}
                  options={Array.from({ length: 31 }, (_, i) => ({ value: i + 1, label: i + 1 }))}
                />
                <AuthSelect
                  value={form.dob_month}
                  onChange={(e) => handleChange('dob_month', e.target.value)}
                  placeholder="Month"
                  error={errors.date_of_birth}
                  options={MONTHS.map((m, i) => ({ value: i + 1, label: m }))}
                />
                <AuthSelect
                  value={form.dob_year}
                  onChange={(e) => handleChange('dob_year', e.target.value)}
                  placeholder="Year"
                  error={errors.date_of_birth}
                  options={years.map((y) => ({ value: y, label: y }))}
                />
              </div>
              {errors.date_of_birth && (
                <p style={{ fontSize: '0.75rem', color: authTokens.error, marginTop: 6 }}>{errors.date_of_birth}</p>
              )}
            </div>
          )}

          <AuthField
            label="What's your profession?"
            value={form.profession}
            onChange={(e) => handleChange('profession', e.target.value)}
            error={errors.profession}
          />

          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 500, color: '#C7C7C7', marginBottom: 6 }}>
              How do you freelance?
            </label>
            <AuthSelect
              value={form.income_source}
              onChange={(e) => handleChange('income_source', e.target.value)}
              placeholder="Select one"
              error={errors.income_source}
              options={INCOME_SOURCE_OPTIONS}
            />
            {errors.income_source && (
              <p style={{ fontSize: '0.75rem', color: authTokens.error, marginTop: 6 }}>{errors.income_source}</p>
            )}
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 500, color: '#C7C7C7', marginBottom: 6 }}>
              Where do you find most of your clients?
            </label>
            <AuthSelect
              value={form.platform_used}
              onChange={(e) => handleChange('platform_used', e.target.value)}
              placeholder="Select one"
              error={errors.platform_used}
              options={PLATFORM_OPTIONS}
            />
            {errors.platform_used && (
              <p style={{ fontSize: '0.75rem', color: authTokens.error, marginTop: 6 }}>{errors.platform_used}</p>
            )}
          </div>

          {needsTermsAcceptance && (
            <div>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: '0.8rem', color: '#8C89A8', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={agreedToTerms}
                  onChange={(e) => {
                    setAgreedToTerms(e.target.checked)
                    setErrors((prev) => {
                      if (!prev.agreedToTerms) return prev
                      const next = { ...prev }
                      delete next.agreedToTerms
                      return next
                    })
                  }}
                  style={{ marginTop: 2, flexShrink: 0 }}
                />
                <span>
                  I agree to the{' '}
                  <a href="/terms" target="_blank" rel="noopener noreferrer" style={{ color: authTokens.focus, fontWeight: 600 }}>Terms of Service</a>
                  {' '}and{' '}
                  <a href="/privacy" target="_blank" rel="noopener noreferrer" style={{ color: authTokens.focus, fontWeight: 600 }}>Privacy Policy</a>
                </span>
              </label>
              {errors.agreedToTerms && (
                <p style={{ fontSize: '0.75rem', color: authTokens.error, marginTop: 6 }}>{errors.agreedToTerms}</p>
              )}
            </div>
          )}
        </div>

        <div style={{ marginTop: '1.75rem' }}>
          <AuthButton type="submit" disabled={loading || (needsTermsAcceptance && !agreedToTerms)}>
            {loading ? 'Setting up your account…' : 'Continue to LanceraOS'}
          </AuthButton>
        </div>
      </form>
    </AuthLayout>
  )
}