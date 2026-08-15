// src/pages/settings/BusinessSection.jsx
import { useEffect, useRef, useState } from 'react'

import api from '@/lib/api'
import useTimedMessage from '@/hooks/useTimedMessage'
import Card from '@/components/Card'
import FormField from '@/components/FormField'
import FormSelect from '@/components/FormSelect'
import FosAlert from '@/components/FosAlert'
import SaveButton from '@/components/SaveButton'
import { validators } from './validators'

const CURRENCIES = [
  { value: 'USD', label: 'USD — US Dollar' },
  { value: 'EUR', label: 'EUR — Euro' },
  { value: 'GBP', label: 'GBP — British Pound' },
  { value: 'PKR', label: 'PKR — Pakistani Rupee' },
]

const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'ur', label: 'Urdu' },
]

// FreelancerProfile.timezone is display-formatting only (CLAUDE.md rule 2)
// — it never drives any backend date/tax calculation. Kept to a short,
// realistic list rather than every IANA zone, since Pakistani freelancers
// working with international clients only need a handful in practice.
const TIMEZONES = [
  { value: 'Asia/Karachi', label: 'Pakistan (PKT)' },
  { value: 'America/New_York', label: 'US Eastern' },
  { value: 'America/Los_Angeles', label: 'US Pacific' },
  { value: 'Europe/London', label: 'UK' },
  { value: 'Australia/Sydney', label: 'Australia Eastern' },
]

const FIELD_NAMES = [
  'address_line1', 'address_line2', 'city', 'country',
  'default_currency', 'default_payment_terms', 'language', 'timezone',
  'bank_name', 'bank_account_number', 'jazzcash_number', 'easypaisa_number', 'payoneer_email',
  'formal_notice_enabled',
]

function extractDraft(profile) {
  const draft = {}
  FIELD_NAMES.forEach((f) => {
    draft[f] = profile?.[f] ?? (
      f === 'country' ? 'Pakistan' : f === 'default_currency' ? 'USD' : f === 'default_payment_terms' ? 30
        : f === 'language' ? 'en' : f === 'timezone' ? 'Asia/Karachi' : f === 'formal_notice_enabled' ? true : ''
    )
  })
  return draft
}

export default function BusinessSection({ profile, loading, onProfileUpdate }) {
  const [draft, setDraft] = useState(() => extractDraft(profile))
  const [fieldErrors, setFieldErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const { message, show, clear } = useTimedMessage()
  const orig = useRef(extractDraft(profile))

  useEffect(() => {
    if (!profile) return
    const data = extractDraft(profile)
    setDraft(data)
    orig.current = data
  }, [profile])

  const changed = JSON.stringify(draft) !== JSON.stringify(orig.current)

  const handleChange = (field, value) => {
    setDraft((prev) => ({ ...prev, [field]: value }))
    setFieldErrors((prev) => { const n = { ...prev }; delete n[field]; return n })
  }

  const handleSave = async () => {
    const errs = {}
    if (draft.jazzcash_number && validators.jazzcash(draft.jazzcash_number)) errs.jazzcash_number = validators.jazzcash(draft.jazzcash_number)
    if (draft.easypaisa_number && validators.easypaisa(draft.easypaisa_number)) errs.easypaisa_number = validators.easypaisa(draft.easypaisa_number)
    if (draft.bank_account_number && validators.bank_account(draft.bank_account_number)) errs.bank_account_number = validators.bank_account(draft.bank_account_number)
    if (draft.payoneer_email && validators.payoneer_email(draft.payoneer_email)) errs.payoneer_email = validators.payoneer_email(draft.payoneer_email)
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs)
      show('error', 'Please fix the errors below before saving.')
      return
    }

    setSaving(true)
    try {
      // partial=True on the backend means only this section's fields
      // need to be sent — Tax/Notifications/SMTP sections are unaffected.
      const res = await api.put('/auth/profile/', draft)
      onProfileUpdate(res.data)
      orig.current = { ...draft }
      show('success', 'Business information saved.')
    } catch (err) {
      const data = err.response?.data
      if (data && typeof data === 'object') {
        const mapped = {}
        Object.keys(data).forEach((k) => { mapped[k] = Array.isArray(data[k]) ? data[k][0] : data[k] })
        setFieldErrors((p) => ({ ...p, ...mapped }))
      }
      show('error', 'Failed to save.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <Card title="Business Information">
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

      <Card
        title="Business Address"
        action={<SaveButton onClick={handleSave} disabled={!changed} saving={saving} />}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <FormField label="Address Line 1" value={draft.address_line1} onChange={(e) => handleChange('address_line1', e.target.value)} />
          <FormField label="Address Line 2" value={draft.address_line2} onChange={(e) => handleChange('address_line2', e.target.value)} />
          <div className="settings-grid-2">
            <FormField label="City" value={draft.city} onChange={(e) => handleChange('city', e.target.value)} />
            <FormField label="Country" value={draft.country} onChange={(e) => handleChange('country', e.target.value)} />
          </div>
        </div>
      </Card>

      <Card title="Invoicing Defaults">
        <div className="settings-grid-2">
          <FormSelect label="Default Currency" value={draft.default_currency} onChange={(e) => handleChange('default_currency', e.target.value)} options={CURRENCIES} />
          <FormField
            label="Default Payment Terms (days)"
            type="number"
            value={draft.default_payment_terms}
            onChange={(e) => handleChange('default_payment_terms', Number(e.target.value))}
          />
        </div>
        <div className="settings-grid-2" style={{ marginTop: 14 }}>
          <FormSelect label="Language" value={draft.language} onChange={(e) => handleChange('language', e.target.value)} options={LANGUAGES} />
          <FormSelect label="Timezone (display only)" value={draft.timezone} onChange={(e) => handleChange('timezone', e.target.value)} options={TIMEZONES} />
        </div>
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', marginTop: 16, padding: '10px 12px', background: 'var(--bg-surface-2)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)' }}>
          <input
            type="checkbox" checked={!!draft.formal_notice_enabled}
            onChange={(e) => handleChange('formal_notice_enabled', e.target.checked)}
            style={{ marginTop: 3, accentColor: 'var(--accent)', width: 14, height: 14 }}
          />
          <div>
            <p style={{ margin: 0, fontSize: '0.82rem', fontWeight: 500, color: 'var(--text-primary)' }}>Allow sending Formal Notice emails</p>
            <p style={{ margin: '2px 0 0', fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>
              A firmer, manual-only email for severely overdue invoices. Turning this off hides the action and blocks it on the backend too.
            </p>
          </div>
        </label>
      </Card>

      <Card title="Payment Methods" subtitle="How clients can pay you, and where LanceraOS shows these on invoices">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="settings-grid-2">
            <FormField label="Bank Name" value={draft.bank_name} onChange={(e) => handleChange('bank_name', e.target.value)} />
            <FormField
              label="Bank Account Number" value={draft.bank_account_number}
              onChange={(e) => handleChange('bank_account_number', e.target.value)}
              error={fieldErrors.bank_account_number}
            />
          </div>
          <div className="settings-grid-2">
            <FormField
              label="JazzCash Number" placeholder="03001234567" value={draft.jazzcash_number}
              onChange={(e) => handleChange('jazzcash_number', e.target.value)}
              error={fieldErrors.jazzcash_number}
            />
            <FormField
              label="Easypaisa Number" placeholder="03001234567" value={draft.easypaisa_number}
              onChange={(e) => handleChange('easypaisa_number', e.target.value)}
              error={fieldErrors.easypaisa_number}
            />
          </div>
          <FormField
            label="Payoneer Email" type="email" value={draft.payoneer_email}
            onChange={(e) => handleChange('payoneer_email', e.target.value)}
            error={fieldErrors.payoneer_email}
          />
        </div>
      </Card>
    </>
  )
}