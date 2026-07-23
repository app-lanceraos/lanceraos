// src/pages/settings/SecuritySection.jsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import api from '@/lib/api'
import useAuthStore from '@/store/authStore'
import useTimedMessage from '@/hooks/useTimedMessage'
import Card from '@/components/Card'
import FormField from '@/components/FormField'
import FosAlert from '@/components/FosAlert'

export default function SecuritySection() {
  const user = useAuthStore((s) => s.user)
  const isOAuthOnly = user?.is_oauth_only || false
  const navigate = useNavigate()

  // ── Password ──────────────────────────────────────────────────
  const [pw, setPw] = useState({ old_password: '', new_password: '', confirm_password: '' })
  const [pwSaving, setPwSaving] = useState(false)
  const pwMsg = useTimedMessage()

  const handlePasswordChange = async () => {
    if (!pw.old_password || !pw.new_password || !pw.confirm_password) {
      pwMsg.show('error', 'Please fill in all password fields.')
      return
    }
    if (pw.new_password !== pw.confirm_password) {
      pwMsg.show('error', 'New passwords do not match.')
      return
    }
    setPwSaving(true)
    try {
      // No token to store — the backend rotates the httpOnly session
      // cookie for this device automatically and revokes every other
      // device's session (see DECISIONS.md).
      await api.post('/auth/change-password/', { old_password: pw.old_password, new_password: pw.new_password })
      setPw({ old_password: '', new_password: '', confirm_password: '' })
      pwMsg.show('success', 'Password changed successfully. You have been signed out of all other devices.')
    } catch (err) {
      pwMsg.show('error', err.response?.data?.error || err.response?.data?.old_password || 'Failed to change password.')
    } finally {
      setPwSaving(false)
    }
  }

  // ── 2FA ───────────────────────────────────────────────────────
  const updateUser = useAuthStore((s) => s.updateUser)
  const [twoFaPassword, setTwoFaPassword] = useState('')
  const [twoFaSaving, setTwoFaSaving] = useState(false)
  const twoFaMsg = useTimedMessage()

  const handleToggle2FA = async () => {
    if (!twoFaPassword) {
      twoFaMsg.show('error', 'Password is required.')
      return
    }
    setTwoFaSaving(true)
    try {
      const action = user?.two_fa_enabled ? 'disable' : 'enable'
      const res = await api.post('/auth/2fa/toggle/', { action, password: twoFaPassword })
      updateUser(res.data.user)
      setTwoFaPassword('')
      twoFaMsg.show('success', res.data.message || 'Two-factor authentication updated.')
    } catch (err) {
      twoFaMsg.show('error', err.response?.data?.error || 'Failed to update two-factor authentication.')
    } finally {
      setTwoFaSaving(false)
    }
  }

  // ── Deletion (password -> OTP -> DeletionReview) ────────────────
  const [delStep, setDelStep] = useState(0)
  const [delPassword, setDelPassword] = useState('')
  const [delOtp, setDelOtp] = useState('')
  const [delSessionId, setDelSessionId] = useState('')
  const [delMasked, setDelMasked] = useState('')
  const [delSaving, setDelSaving] = useState(false)
  const [delPwErr, setDelPwErr] = useState('')
  const [delOtpErr, setDelOtpErr] = useState('')

  const handleDelInitiate = async () => {
    if (!delPassword) {
      setDelPwErr('Password is required.')
      return
    }
    setDelSaving(true)
    setDelPwErr('')
    try {
      const res = await api.post('/auth/deletion/initiate/', { password: delPassword })
      setDelSessionId(res.data.session_id)
      setDelMasked(res.data.masked_email)
      setDelPassword('')
      setDelStep(1)
    } catch (err) {
      setDelPwErr(err.response?.data?.password || err.response?.data?.error || 'Incorrect password.')
    } finally {
      setDelSaving(false)
    }
  }

  const handleDelVerifyOtp = async () => {
    if (!delOtp || delOtp.length < 6) {
      setDelOtpErr('Enter the 6-digit code.')
      return
    }
    setDelSaving(true)
    setDelOtpErr('')
    try {
      const res = await api.post('/auth/deletion/verify-otp/', { session_id: delSessionId, otp_code: delOtp })
      navigate(`/account/deletion-review?token=${res.data.deletion_token}`)
    } catch (err) {
      setDelOtpErr(err.response?.data?.error || 'Incorrect code.')
      setDelOtp('')
    } finally {
      setDelSaving(false)
    }
  }

  if (isOAuthOnly) {
    return (
      <Card title="Security">
        <FosAlert type="info">
          Your account is managed by Google or Facebook. To manage your password or two-factor authentication,
          visit your provider's account settings directly.
        </FosAlert>
      </Card>
    )
  }

  return (
    <>
      <Card title="Change Password">
        {pwMsg.message && (
          <div style={{ marginBottom: 16 }}>
            <FosAlert type={pwMsg.message.type} onDismiss={pwMsg.clear}>{pwMsg.message.text}</FosAlert>
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 400 }}>
          <FormField
            label="Current Password" type="password" autoComplete="current-password"
            value={pw.old_password} onChange={(e) => setPw((p) => ({ ...p, old_password: e.target.value }))}
          />
          <FormField
            label="New Password" type="password" autoComplete="new-password"
            value={pw.new_password} onChange={(e) => setPw((p) => ({ ...p, new_password: e.target.value }))}
          />
          <FormField
            label="Confirm New Password" type="password" autoComplete="new-password"
            value={pw.confirm_password} onChange={(e) => setPw((p) => ({ ...p, confirm_password: e.target.value }))}
          />
          <div>
            <button onClick={handlePasswordChange} disabled={pwSaving} className="fos-btn fos-btn-accent">
              {pwSaving ? <><span className="fos-spinner" /> Changing…</> : 'Change Password'}
            </button>
          </div>
        </div>
      </Card>

      <Card title="Two-Factor Authentication" subtitle={user?.two_fa_enabled ? 'Currently enabled' : 'Currently disabled'}>
        {twoFaMsg.message && (
          <div style={{ marginBottom: 16 }}>
            <FosAlert type={twoFaMsg.message.type} onDismiss={twoFaMsg.clear}>{twoFaMsg.message.text}</FosAlert>
          </div>
        )}
        <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: 14, lineHeight: 1.55 }}>
          {user?.two_fa_enabled
            ? 'A 6-digit code will be emailed to you each time you sign in from a new device.'
            : 'Add an extra layer of security — a 6-digit code will be emailed to you at sign-in.'}
        </p>
        <div style={{ display: 'flex', gap: 10, maxWidth: 400, alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <FormField
              label="Confirm with your password" type="password" autoComplete="current-password"
              value={twoFaPassword} onChange={(e) => setTwoFaPassword(e.target.value)}
            />
          </div>
          <button
            onClick={handleToggle2FA}
            disabled={twoFaSaving}
            className={user?.two_fa_enabled ? 'fos-btn fos-btn-danger' : 'fos-btn fos-btn-accent'}
          >
            {twoFaSaving ? <><span className="fos-spinner" /> Saving…</> : user?.two_fa_enabled ? 'Disable' : 'Enable'}
          </button>
        </div>
      </Card>

      <Card title="Danger Zone">
        <div style={{ border: '1px solid var(--error-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', background: 'var(--error-bg)', borderBottom: '1px solid var(--error-border)' }}>
            <p style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--error-text)' }}>Delete Account</p>
          </div>
          <div style={{ padding: 16 }}>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: 16, lineHeight: 1.6 }}>
              Your account will be scheduled for permanent deletion after 30 days — you can cancel any time
              before then by logging in.
            </p>
            {delStep === 0 && (
              <div style={{ maxWidth: 360 }}>
                <FormField
                  label="Enter password to continue" type="password" autoComplete="current-password"
                  value={delPassword}
                  onChange={(e) => { setDelPassword(e.target.value); setDelPwErr('') }}
                  error={delPwErr}
                />
                <button onClick={handleDelInitiate} disabled={!delPassword || delSaving} className="fos-btn fos-btn-danger fos-btn-full" style={{ marginTop: 10 }}>
                  {delSaving ? <><span className="fos-spinner" /> Sending code…</> : 'Continue — Send Verification Code'}
                </button>
              </div>
            )}
            {delStep === 1 && (
              <div style={{ maxWidth: 360 }}>
                <div style={{ marginBottom: 12 }}>
                  <FosAlert type="info">
                    A 6-digit code was sent to <strong>{delMasked}</strong>. Enter it below.
                  </FosAlert>
                </div>
                <FormField
                  label="Verification Code"
                  value={delOtp}
                  onChange={(e) => { setDelOtp(e.target.value.replace(/\D/g, '').slice(0, 6)); setDelOtpErr('') }}
                  error={delOtpErr}
                  placeholder="000000"
                  autoFocus
                />
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <button onClick={() => { setDelStep(0); setDelOtp(''); setDelOtpErr('') }} className="fos-btn fos-btn-ghost" style={{ flex: 1 }}>
                    Back
                  </button>
                  <button onClick={handleDelVerifyOtp} disabled={delOtp.length < 6 || delSaving} className="fos-btn fos-btn-danger" style={{ flex: 1 }}>
                    {delSaving ? <><span className="fos-spinner" /> Verifying…</> : 'Verify and Continue'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </Card>
    </>
  )
}