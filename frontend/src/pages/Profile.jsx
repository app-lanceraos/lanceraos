// src/pages/Profile.jsx
import { useCallback, useEffect, useRef, useState } from 'react'
import Cropper from 'react-easy-crop'
import { Camera } from 'lucide-react'

import api from '@/lib/api'
import useAuthStore from '@/store/authStore'
import useTitle from '@/hooks/useTitle'
import useTimedMessage from '@/hooks/useTimedMessage'
import Card from '@/components/Card'
import FormField from '@/components/FormField'
import FosAlert from '@/components/FosAlert'
import SaveButton from '@/components/SaveButton'
import { validators } from './settings/validators'
import { getCroppedImageBlob } from './profileCropUtils'

// Matches apps/users/views/profile.py exactly — ALLOWED_LOGO_EXTENSIONS
// and MAX_LOGO_SIZE_BYTES — so an obviously-invalid file is caught here
// rather than after a wasted upload round-trip. The backend remains the
// real authority; this is just the same rule checked earlier.
const ALLOWED_LOGO_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'tiff', 'svg'])
const MAX_LOGO_SIZE_BYTES = 5 * 1024 * 1024

function calcCompletion(profile) {
  if (!profile) return 0
  const fields = [
    profile.display_name, profile.phone, profile.business_name,
    profile.address_line1, profile.city,
    profile.bank_name || profile.jazzcash_number || profile.easypaisa_number || profile.payoneer_email,
    profile.ntn, profile.logo,
  ]
  const filled = fields.filter(Boolean).length
  return Math.round((filled / fields.length) * 100)
}

function CompletionBar({ pct }) {
  if (pct >= 95) return null
  const color = pct >= 80 ? 'var(--accent)' : pct >= 50 ? '#f59e0b' : 'var(--error-text)'
  const message = pct < 50
    ? 'Complete your profile to look professional on invoices'
    : pct < 80
      ? 'Almost there — fill in the remaining details'
      : 'Just a few more fields to complete your profile'

  return (
    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: '16px 20px', marginBottom: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--text-primary)' }}>Profile Completion</span>
        <span style={{ fontSize: '0.875rem', fontWeight: 700, color }}>{pct}%</span>
      </div>
      <div style={{ height: 6, background: 'var(--bg-surface-3)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 3, transition: 'width 0.6s ease' }} />
      </div>
      <p style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginTop: 6 }}>{message}</p>
    </div>
  )
}

function CropperModal({ imageSrc, onConfirm, onCancel, uploading }) {
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null)

  const onCropComplete = useCallback((_, pixels) => setCroppedAreaPixels(pixels), [])

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: 'var(--bg-surface)', borderRadius: 'var(--radius-xl)', width: '100%', maxWidth: 400, overflow: 'hidden' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border-subtle)' }}>
          <p style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '0.9rem' }}>Crop Profile Photo</p>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginTop: 2 }}>Drag to reposition · Scroll to zoom</p>
        </div>
        <div style={{ position: 'relative', height: 260, background: '#000' }}>
          <Cropper
            image={imageSrc}
            crop={crop}
            zoom={zoom}
            aspect={1}
            cropShape="round"
            showGrid={false}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={onCropComplete}
          />
        </div>
        <div style={{ padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', minWidth: 34 }}>Zoom</span>
            <input type="range" min={1} max={3} step={0.05} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} style={{ flex: 1, accentColor: 'var(--accent)' }} />
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={onCancel} disabled={uploading} className="fos-btn fos-btn-ghost" style={{ flex: 1 }}>Cancel</button>
            <button onClick={() => onConfirm(croppedAreaPixels)} disabled={!croppedAreaPixels || uploading} className="fos-btn fos-btn-accent" style={{ flex: 1 }}>
              {uploading ? <><span className="fos-spinner" /> Uploading…</> : 'Save Photo'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function Profile() {
  useTitle('LanceraOS | Profile')
  const updateAvatar = useAuthStore((s) => s.updateAvatar)

  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState({ display_name: '', business_name: '', phone: '' })
  const [fieldErrors, setFieldErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const { message, show, clear } = useTimedMessage()
  const orig = useRef({ display_name: '', business_name: '', phone: '' })

  const [logoPreview, setLogoPreview] = useState('')
  const [cropSrc, setCropSrc] = useState(null)
  const [logoUploading, setLogoUploading] = useState(false)
  const [avatarHover, setAvatarHover] = useState(false)
  const fileInputRef = useRef(null)

  useEffect(() => {
    api.get('/auth/profile/')
      .then((res) => {
        setProfile(res.data)
        const data = {
          display_name: res.data.display_name || '',
          business_name: res.data.business_name || '',
          phone: res.data.phone || '',
        }
        setDraft(data)
        orig.current = data
        setLogoPreview(res.data.logo || '')
      })
      .catch(() => show('error', 'Failed to load your profile.'))
      .finally(() => setLoading(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const changed = JSON.stringify(draft) !== JSON.stringify(orig.current)
  const completion = calcCompletion({ ...profile, ...draft, logo: logoPreview })

  const handleChange = (field, value) => {
    setDraft((prev) => ({ ...prev, [field]: value }))
    setFieldErrors((prev) => { const n = { ...prev }; delete n[field]; return n })
  }

  const handleSave = async () => {
    const errs = {}
    if (!draft.display_name.trim()) errs.display_name = 'Display name is required.'
    if (draft.phone && validators.phone(draft.phone)) errs.phone = validators.phone(draft.phone)
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs)
      return
    }
    setSaving(true)
    try {
      const res = await api.put('/auth/profile/', draft)
      setProfile((prev) => ({ ...prev, ...res.data }))
      orig.current = { ...draft }
      show('success', 'Profile saved.')
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

  const handleFileSelect = (e) => {
    const file = e.target.files[0]
    if (!file) return
    const ext = file.name.split('.').pop().toLowerCase()
    if (!ALLOWED_LOGO_EXTENSIONS.has(ext)) {
      show('error', `".${ext}" isn't a supported image type.`)
      e.target.value = ''
      return
    }
    if (file.size > MAX_LOGO_SIZE_BYTES) {
      show('error', 'Image must be under 5MB.')
      e.target.value = ''
      return
    }
    const reader = new FileReader()
    reader.onload = () => setCropSrc(reader.result)
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  const handleCropConfirm = async (pixelCrop) => {
    if (!pixelCrop) return
    setLogoUploading(true)
    try {
      const blob = await getCroppedImageBlob(cropSrc, pixelCrop)
      const formData = new FormData()
      formData.append('logo', blob, 'profile.jpg')
      const res = await api.post('/auth/profile/upload-logo/', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setLogoPreview(res.data.logo)
      updateAvatar(res.data.logo)
      setCropSrc(null)
      show('success', 'Profile photo updated.')
    } catch (err) {
      show('error', err.response?.data?.error || 'Upload failed.')
    } finally {
      setLogoUploading(false)
    }
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 300 }}>
        <p style={{ color: 'var(--text-tertiary)', fontSize: '0.875rem' }}>Loading profile…</p>
      </div>
    )
  }

  return (
    <div style={{ width: '100%' }}>
      {cropSrc && (
        <CropperModal
          imageSrc={cropSrc}
          onConfirm={handleCropConfirm}
          onCancel={() => setCropSrc(null)}
          uploading={logoUploading}
        />
      )}

      <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4, fontFamily: "'DM Sans', sans-serif" }}>
        Profile
      </h1>
      <p style={{ fontSize: '0.875rem', color: 'var(--text-tertiary)', marginBottom: 20 }}>
        How you appear across LanceraOS and on your invoices.
      </p>

      <CompletionBar pct={completion} />

      {message && (
        <div style={{ marginBottom: 16 }}>
          <FosAlert type={message.type} onDismiss={clear}>{message.text}</FosAlert>
        </div>
      )}

      <Card action={<SaveButton onClick={handleSave} disabled={!changed} saving={saving} />}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: 20 }}>
          <div
            onMouseEnter={() => setAvatarHover(true)}
            onMouseLeave={() => setAvatarHover(false)}
            onClick={() => fileInputRef.current?.click()}
            style={{
              position: 'relative', width: 84, height: 84, borderRadius: '50%', flexShrink: 0,
              cursor: 'pointer', overflow: 'hidden', background: 'var(--bg-surface-3)',
              border: '2px solid var(--border-subtle)',
            }}
          >
            {logoPreview ? (
              <img src={logoPreview} alt="Profile" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.6rem', fontWeight: 700, color: 'var(--text-tertiary)' }}>
                {(draft.display_name || '?').charAt(0).toUpperCase()}
              </div>
            )}
            {avatarHover && (
              <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Camera size={22} color="#fff" />
              </div>
            )}
          </div>
          <div>
            <p style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>Profile Photo</p>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', marginTop: 2 }}>JPG, PNG, or GIF. Max 5MB.</p>
          </div>
          <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileSelect} style={{ display: 'none' }} />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <FormField
            label="Display Name" required
            value={draft.display_name}
            onChange={(e) => handleChange('display_name', e.target.value)}
            error={fieldErrors.display_name}
            hint="Shown on invoices and throughout the app."
          />
          <FormField
            label="Business Name"
            value={draft.business_name}
            onChange={(e) => handleChange('business_name', e.target.value)}
            hint="Optional — appears on invoices if set."
          />
          <FormField
            label="Phone"
            value={draft.phone}
            onChange={(e) => handleChange('phone', e.target.value)}
            error={fieldErrors.phone}
            placeholder="+923001234567"
          />
        </div>
      </Card>
    </div>
  )
}