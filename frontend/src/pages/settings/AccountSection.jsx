// src/pages/settings/AccountSection.jsx
import { useEffect, useRef, useState } from 'react'
import { Mail } from 'lucide-react'

import api from '@/lib/api'
import useAuthStore from '@/store/authStore'
import useTimedMessage from '@/hooks/useTimedMessage'
import Card from '@/components/Card'
import FormField from '@/components/FormField'
import FosAlert from '@/components/FosAlert'
import SaveButton from '@/components/SaveButton'

export default function AccountSection() {
  const user = useAuthStore((s) => s.user)
  const updateUser = useAuthStore((s) => s.updateUser)

  const [af, setAf] = useState({ first_name: '', last_name: '', username: '', date_of_birth: '' })
  const [fieldErrors, setFieldErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const { message, show, clear } = useTimedMessage()
  const origAf = useRef({})

  const [emailSending, setEmailSending] = useState(false)
  const [emailCancelling, setEmailCancelling] = useState(false)
  const emailMsg = useTimedMessage()

  useEffect(() => {
    if (!user) return
    const data = {
      first_name: user.first_name || '',
      last_name: user.last_name || '',
      username: user.username || '',
      date_of_birth: user.date_of_birth || '',
    }
    setAf(data)
    origAf.current = data
  }, [user])

  const changed = JSON.stringify(af) !== JSON.stringify(origAf.current)

  const handleChange = (field, value) => {
    setAf((prev) => ({ ...prev, [field]: value }))
    setFieldErrors((prev) => { const n = { ...prev }; delete n[field]; return n })
  }

  const handleSave = async () => {
    const errs = {}
    if (!af.first_name.trim()) errs.first_name = 'First name is required.'
    if (!af.username.trim()) errs.username = 'Username is required.'
    else if (af.username.length < 3) errs.username = 'At least 3 characters.'
    else if (!/^[a-zA-Z0-9_]+$/.test(af.username)) errs.username = 'Letters, numbers, and _ only.'
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs)
      return
    }
    setSaving(true)
    try {
      const res = await api.put('/auth/account/', af)
      updateUser(res.data)
      origAf.current = { ...af }
      show('success', 'Account updated.')
    } catch (err) {
      const data = err.response?.data
      if (data && typeof data === 'object') {
        const mapped = {}
        Object.keys(data).forEach((k) => { mapped[k] = Array.isArray(data[k]) ? data[k][0] : data[k] })
        setFieldErrors((p) => ({ ...p, ...mapped }))
      }
      show('error', 'Failed to update account.')
    } finally {
      setSaving(false)
    }
  }

  const handleEmailChangeRequest = async () => {
    setEmailSending(true)
    try {
      await api.post('/auth/email-change/request/')
      const res = await api.get('/auth/me/')
      updateUser(res.data)
      emailMsg.show('success', 'A verification link has been sent to your current email. Click it to continue — you will enter your new email address on that page.', { autoDismissMs: 8000 })
    } catch (err) {
      emailMsg.show('error', err.response?.data?.error || 'Failed to send change link.', { autoDismissMs: 8000 })
    } finally {
      setEmailSending(false)
    }
  }

  const handleEmailChangeCancel = async () => {
    setEmailCancelling(true)
    try {
      await api.post('/auth/email-change/cancel/')
      const res = await api.get('/auth/me/')
      updateUser(res.data)
      emailMsg.show('info', 'Email change request cancelled.')
    } catch (err) {
      emailMsg.show('error', err.response?.data?.error || 'Failed to cancel.', { autoDismissMs: 8000 })
    } finally {
      setEmailCancelling(false)
    }
  }

  return (
    <>
      <Card title="Email Address">
        {message && (
          <div style={{ marginBottom: 16 }}>
            <FosAlert type={message.type} onDismiss={clear}>{message.text}</FosAlert>
          </div>
        )}
        {emailMsg.message && (
          <div style={{ marginBottom: 16 }}>
            <FosAlert type={emailMsg.message.type} onDismiss={emailMsg.clear}>{emailMsg.message.text}</FosAlert>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <Mail size={16} color="var(--text-tertiary)" />
          <span style={{ fontSize: '0.9rem', color: 'var(--text-primary)', fontWeight: 600 }}>{user?.email}</span>
        </div>

        {user?.pending_email ? (
          <div style={{ marginTop: 14 }}>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-tertiary)', marginBottom: 10 }}>
              A request to change your email to <strong style={{ color: 'var(--text-primary)' }}>{user.pending_email}</strong> is pending confirmation.
            </p>
            <button onClick={handleEmailChangeCancel} disabled={emailCancelling} className="fos-btn fos-btn-ghost">
              {emailCancelling ? <><span className="fos-spinner" /> Cancelling…</> : 'Cancel Email Change'}
            </button>
          </div>
        ) : (
          <div style={{ marginTop: 14 }}>
            <button onClick={handleEmailChangeRequest} disabled={emailSending} className="fos-btn fos-btn-ghost">
              {emailSending ? <><span className="fos-spinner" /> Sending…</> : 'Change Email Address'}
            </button>
            <p className="fos-hint" style={{ marginTop: 8 }}>You can change your email once every 3 months.</p>
          </div>
        )}
      </Card>

      <Card
        title="Personal Information"
        action={<SaveButton onClick={handleSave} disabled={!changed} saving={saving} />}
      >
        <div className="settings-grid-2">
          <FormField label="First Name" required value={af.first_name} onChange={(e) => handleChange('first_name', e.target.value)} error={fieldErrors.first_name} />
          <FormField label="Last Name" value={af.last_name} onChange={(e) => handleChange('last_name', e.target.value)} error={fieldErrors.last_name} />
        </div>
        <div style={{ marginTop: 14 }}>
          <FormField label="Username" required value={af.username} onChange={(e) => handleChange('username', e.target.value)} error={fieldErrors.username} />
        </div>
        <div style={{ marginTop: 14 }}>
          <FormField
            label="Date of Birth"
            type="date"
            value={af.date_of_birth}
            onChange={(e) => handleChange('date_of_birth', e.target.value)}
            error={fieldErrors.date_of_birth}
          />
        </div>
      </Card>
    </>
  )
}