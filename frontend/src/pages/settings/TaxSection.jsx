// src/pages/settings/TaxSection.jsx
import { useEffect, useRef, useState } from 'react'

import api from '@/lib/api'
import useTimedMessage from '@/hooks/useTimedMessage'
import Card from '@/components/Card'
import FormField from '@/components/FormField'
import FosAlert from '@/components/FosAlert'
import SaveButton from '@/components/SaveButton'
import { validators, formatCNIC } from './validators'

function extractDraft(profile) {
  return {
    cnic: profile?.cnic || '',
    ntn: profile?.ntn || '',
    pseb_registered: profile?.pseb_registered || false,
    pseb: profile?.pseb || '',
  }
}

export default function TaxSection({ profile, loading, onProfileUpdate }) {
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
    if (draft.cnic && validators.cnic(draft.cnic)) errs.cnic = validators.cnic(draft.cnic)
    if (draft.ntn && validators.ntn(draft.ntn)) errs.ntn = validators.ntn(draft.ntn)
    if (draft.pseb_registered && draft.pseb && validators.pseb(draft.pseb)) errs.pseb = validators.pseb(draft.pseb)
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs)
      show('error', 'Please fix the errors below before saving.')
      return
    }

    setSaving(true)
    try {
      // Written via the *_input fields — cnic/ntn/pseb themselves are
      // read-only SerializerMethodFields with no setter (see
      // FreelancerProfileSerializer.update()), which is what runs the
      // real validation, encryption, and cross-account uniqueness check.
      const res = await api.put('/auth/profile/', {
        cnic_input: draft.cnic,
        ntn_input: draft.ntn,
        pseb_registered: draft.pseb_registered,
        pseb_input: draft.pseb_registered ? draft.pseb : '',
      })
      onProfileUpdate(res.data)
      orig.current = { ...draft }
      show('success', 'Tax information saved.')
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
      <Card title="Tax & PSEB">
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
        title="Tax Identity"
        subtitle="Used for FBR tax filing and the SRO 586 IT-export exemption check"
        action={<SaveButton onClick={handleSave} disabled={!changed} saving={saving} />}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <FormField
            label="CNIC"
            placeholder="42101-1234567-1"
            value={draft.cnic}
            onChange={(e) => handleChange('cnic', formatCNIC(e.target.value))}
            error={fieldErrors.cnic}
            hint="13 digits — this must be unique to your account and can't be claimed by another user."
          />
          <FormField
            label="NTN (National Tax Number)"
            placeholder="1234567"
            value={draft.ntn}
            onChange={(e) => handleChange('ntn', e.target.value.replace(/\D/g, '').slice(0, 8))}
            error={fieldErrors.ntn}
            hint="7 or 8 digits, from your FBR registration."
          />

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}>
            <input
              type="checkbox"
              checked={draft.pseb_registered}
              onChange={(e) => handleChange('pseb_registered', e.target.checked)}
              style={{ accentColor: 'var(--accent)' }}
            />
            <span style={{ fontSize: '0.875rem', color: 'var(--text-primary)' }}>I am registered with PSEB</span>
          </label>

          {draft.pseb_registered && (
            <FormField
              label="PSEB Registration Number"
              value={draft.pseb}
              onChange={(e) => handleChange('pseb', e.target.value)}
              error={fieldErrors.pseb}
            />
          )}
        </div>
      </Card>
    </>
  )
}