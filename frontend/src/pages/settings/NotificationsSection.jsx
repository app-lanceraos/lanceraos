// src/pages/settings/NotificationsSection.jsx
import { useEffect, useRef, useState } from 'react'
import { FileText, MessageSquare, ShieldCheck, Wallet } from 'lucide-react'

import api from '@/lib/api'
import useTimedMessage from '@/hooks/useTimedMessage'
import Card from '@/components/Card'
import FosAlert from '@/components/FosAlert'

const TOGGLES = [
  { field: 'notif_invoice_events', label: 'Invoice Events', hint: 'Sent, viewed, paid, and overdue notices', Icon: FileText },
  { field: 'notif_client_messages', label: 'Client Messages', hint: 'When a client sends you a message in the portal', Icon: MessageSquare },
  { field: 'notif_payments', label: 'Payments', hint: 'When a payment is recorded against an invoice', Icon: Wallet },
]

function Toggle({ checked, onChange, disabled }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      style={{
        width: 40, height: 22, borderRadius: 999, border: 'none', position: 'relative',
        background: checked ? 'var(--accent)' : 'var(--border-strong)',
        cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1,
        transition: 'background 0.15s ease', flexShrink: 0,
      }}
    >
      <span
        style={{
          position: 'absolute', top: 2, left: checked ? 20 : 2, width: 18, height: 18, borderRadius: '50%',
          background: '#fff', transition: 'left 0.15s ease', boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
        }}
      />
    </button>
  )
}

export default function NotificationsSection() {
  const [prefs, setPrefs] = useState(null)
  const [loading, setLoading] = useState(true)
  const [savingField, setSavingField] = useState(null)
  const { message, show, clear } = useTimedMessage()
  const debounceRef = useRef({})

  useEffect(() => {
    api.get('/auth/settings/notifications/')
      .then((res) => setPrefs(res.data))
      .catch(() => show('error', 'Failed to load notification preferences.'))
      .finally(() => setLoading(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleToggle = (field, value) => {
    setPrefs((prev) => ({ ...prev, [field]: value }))
    clearTimeout(debounceRef.current[field])
    debounceRef.current[field] = setTimeout(async () => {
      setSavingField(field)
      try {
        await api.put('/auth/settings/notifications/', { [field]: value })
      } catch {
        // Revert on failure — the toggle shouldn't silently claim a
        // state the server didn't actually accept.
        setPrefs((prev) => ({ ...prev, [field]: !value }))
        show('error', 'Failed to save that preference. Please try again.')
      } finally {
        setSavingField(null)
      }
    }, 500)
  }

  if (loading) {
    return (
      <Card title="Notifications">
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

      <Card title="Email Notifications" subtitle="Choose which emails you'd like to receive">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {TOGGLES.map(({ field, label, hint, Icon }) => (
            <div
              key={field}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                padding: '12px 4px', borderBottom: '1px solid var(--border-subtle)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <Icon size={18} color="var(--text-tertiary)" style={{ flexShrink: 0 }} />
                <div>
                  <p style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>{label}</p>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>{hint}</p>
                </div>
              </div>
              <Toggle checked={!!prefs?.[field]} onChange={(v) => handleToggle(field, v)} disabled={savingField === field} />
            </div>
          ))}

          {/* Security Alerts deliberately has no toggle at all — not a
              disabled one, none. The backend has no field to wire one to
              (see FreelancerProfile.notif_* fields in models.py), so
              there is nothing here that could ever be turned off. */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 4px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <ShieldCheck size={18} color="var(--text-tertiary)" style={{ flexShrink: 0 }} />
              <div>
                <p style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>Security Alerts</p>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
                  New device logins, password changes, account lockouts
                </p>
              </div>
            </div>
            <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>
              Always On
            </span>
          </div>
        </div>

        <div style={{ marginTop: 14 }}>
          <FosAlert type="info" style={{ fontSize: '0.8rem' }}>
            Security alerts can't be turned off — they protect your account even if everything else is muted.
          </FosAlert>
        </div>
      </Card>
    </>
  )
}