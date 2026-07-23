// src/pages/settings/SmtpSection.jsx
import { useEffect, useState } from 'react'
import { Mail } from 'lucide-react'

import api from '@/lib/api'
import useTimedMessage from '@/hooks/useTimedMessage'
import Card from '@/components/Card'
import FormField from '@/components/FormField'
import FosAlert from '@/components/FosAlert'

const PROVIDERS = {
  gmail: { host: 'smtp.gmail.com', port: 587, use_tls: true, use_ssl: false },
  outlook: { host: 'smtp.office365.com', port: 587, use_tls: true, use_ssl: false },
  yahoo: { host: 'smtp.mail.yahoo.com', port: 465, use_tls: false, use_ssl: true },
  custom: { host: '', port: 587, use_tls: true, use_ssl: false },
}

const PROVIDER_LABELS = [
  ['gmail', 'Gmail'],
  ['outlook', 'Outlook'],
  ['yahoo', 'Yahoo'],
  ['custom', 'Custom SMTP'],
]

const emptyForm = () => ({
  host: PROVIDERS.gmail.host, port: PROVIDERS.gmail.port,
  username: '', password: '', from_name: '',
  use_tls: PROVIDERS.gmail.use_tls, use_ssl: PROVIDERS.gmail.use_ssl,
})

function SmtpForm({ onSave, onCancel, saving, error }) {
  const [provider, setProvider] = useState('gmail')
  const [form, setForm] = useState(emptyForm)

  const handleProviderChange = (key) => {
    setProvider(key)
    const cfg = PROVIDERS[key]
    setForm((prev) => ({ ...prev, host: cfg.host, port: cfg.port, use_tls: cfg.use_tls, use_ssl: cfg.use_ssl }))
  }

  const setField = (field, value) => setForm((prev) => ({ ...prev, [field]: value }))

  return (
    <div style={{ background: 'var(--bg-surface-2)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: 16, marginTop: 14 }}>
      <h4 style={{ margin: '0 0 14px', fontSize: '0.875rem', fontWeight: 700, color: 'var(--text-primary)' }}>Connect your email</h4>

      <div style={{ marginBottom: 14 }}>
        <label className="fos-label">Email Provider</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {PROVIDER_LABELS.map(([key, label]) => (
            <button
              key={key}
              onClick={() => handleProviderChange(key)}
              style={{
                padding: '6px 14px', borderRadius: 'var(--radius-md)', fontSize: '0.78rem', cursor: 'pointer',
                background: provider === key ? 'var(--accent-glow-md)' : 'var(--bg-surface)',
                border: provider === key ? '1px solid var(--border-accent)' : '1px solid var(--border-subtle)',
                fontWeight: provider === key ? 600 : 400,
                color: provider === key ? 'var(--accent)' : 'var(--text-secondary)',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {provider === 'gmail' && (
        <div style={{ background: 'var(--info-bg)', border: '1px solid var(--info-border)', borderRadius: 'var(--radius-md)', padding: '10px 12px', marginBottom: 14, fontSize: '0.75rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          <strong>Gmail setup:</strong> Google Account → Security → 2-Step Verification (enable) → App passwords →
          select Mail → generate, then paste the 16-character password below.{' '}
          <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', fontWeight: 600 }}>
            Open Google App Passwords →
          </a>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <FormField label="Your name / business name" hint="Shown as the sender name in emails" value={form.from_name} onChange={(e) => setField('from_name', e.target.value)} placeholder="Ali Ahmed" />
        <FormField label="Email address" hint="The email you will send from" value={form.username} onChange={(e) => setField('username', e.target.value)} placeholder="ali@gmail.com" type="email" />
        <FormField
          label={provider === 'gmail' ? 'App Password (16 characters)' : 'Password'}
          hint={provider === 'gmail' ? 'Generated from Google Account App Passwords' : 'Your email account password'}
          value={form.password} onChange={(e) => setField('password', e.target.value)}
          placeholder={provider === 'gmail' ? 'xxxx xxxx xxxx xxxx' : 'Your password'} type="password"
        />

        {provider === 'custom' && (
          <>
            <FormField label="SMTP Host" value={form.host} onChange={(e) => setField('host', e.target.value)} placeholder="smtp.yourmail.com" />
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
              <div style={{ flex: 1 }}>
                <FormField label="Port" type="number" value={form.port} onChange={(e) => setField('port', Number(e.target.value))} placeholder="587" />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingBottom: 10 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                  <input type="checkbox" checked={form.use_tls} onChange={(e) => setField('use_tls', e.target.checked)} /> TLS
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                  <input type="checkbox" checked={form.use_ssl} onChange={(e) => setField('use_ssl', e.target.checked)} /> SSL
                </label>
              </div>
            </div>
          </>
        )}

        {error && (
          <div style={{ padding: '8px 12px', background: 'var(--error-bg)', border: '1px solid var(--error-border)', borderRadius: 'var(--radius-md)', fontSize: '0.78rem', color: 'var(--error-text)' }}>
            {error}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
        <button onClick={onCancel} className="fos-btn fos-btn-ghost">Cancel</button>
        <button onClick={() => onSave(form)} disabled={saving} className="fos-btn fos-btn-accent">
          {saving ? <><span className="fos-spinner" /> Testing & saving…</> : 'Test & Save'}
        </button>
      </div>
    </div>
  )
}

export default function SmtpSection() {
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const { message, show, clear } = useTimedMessage()

  useEffect(() => {
    api.get('/auth/smtp/status/')
      .then((res) => setStatus(res.data))
      .catch(() => show('error', 'Failed to load email sending status.'))
      .finally(() => setLoading(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async (form) => {
    setSaving(true)
    setSaveError('')
    try {
      const { data } = await api.post('/auth/smtp/save/', form)
      setStatus({ custom_smtp_enabled: true, custom_smtp_verified: true, username: form.username, from_name: form.from_name })
      setShowForm(false)
      show('success', data.message || 'Custom email activated.')
    } catch (err) {
      const errData = err.response?.data
      const msg = errData?.error || (errData && typeof errData === 'object' ? Object.values(errData)[0] : null) || 'Could not connect. Please check your credentials.'
      setSaveError(Array.isArray(msg) ? msg[0] : msg)
    } finally {
      setSaving(false)
    }
  }

  const handleDisable = async () => {
    try {
      await api.post('/auth/smtp/disable/')
      setStatus({ custom_smtp_enabled: false, custom_smtp_verified: false })
      show('info', 'Custom email sending disabled. Invoices will send from noreply@lanceraos.com again.')
    } catch (err) {
      show('error', err.response?.data?.error || 'Failed to disable.')
    }
  }

  if (loading) {
    return (
      <Card title="Email Sending">
        <p style={{ fontSize: '0.875rem', color: 'var(--text-tertiary)' }}>Loading…</p>
      </Card>
    )
  }

  return (
    <>
      {message && (
        <div style={{ marginBottom: 16 }}>
          <FosAlert type={message.type} onDismiss={clear}>{message.text}</FosAlert>
        </div>
      )}

      <Card title="Email Sending" subtitle="Send client-facing emails (invoices, receipts) from your own address instead of noreply@lanceraos.com">
        {status?.custom_smtp_verified ? (
          <div style={{ padding: '12px 14px', background: 'var(--success-bg)', border: '1px solid var(--success-border)', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Mail size={16} color="var(--success-text)" />
              <div>
                <p style={{ margin: 0, fontSize: '0.82rem', fontWeight: 600, color: 'var(--success-text)' }}>Custom email active</p>
                <p style={{ margin: '2px 0 0', fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
                  Sending from: {status.username}{status.from_name ? ` (${status.from_name})` : ''}
                </p>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setShowForm(true)} className="fos-btn fos-btn-ghost" style={{ padding: '6px 14px', fontSize: '0.78rem' }}>Change</button>
              <button onClick={handleDisable} className="fos-btn" style={{ padding: '6px 14px', fontSize: '0.78rem', background: 'none', border: '1px solid var(--error-border)', color: 'var(--error-text)' }}>Disable</button>
            </div>
          </div>
        ) : (
          <div>
            <p style={{ margin: '0 0 12px', fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              Send invoices from your own email instead of noreply@lanceraos.com. Your clients will see your
              personal email and trust it more.
            </p>
            {!showForm && (
              <button onClick={() => setShowForm(true)} className="fos-btn fos-btn-ghost">
                Connect your email
              </button>
            )}
          </div>
        )}

        {showForm && (
          <SmtpForm
            onSave={handleSave}
            onCancel={() => { setShowForm(false); setSaveError('') }}
            saving={saving}
            error={saveError}
          />
        )}
      </Card>
    </>
  )
}