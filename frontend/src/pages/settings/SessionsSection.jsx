// src/pages/settings/SessionsSection.jsx
import { useEffect, useState } from 'react'
import { Laptop, Pencil, Smartphone, Monitor } from 'lucide-react'

import api from '@/lib/api'
import useTimedMessage from '@/hooks/useTimedMessage'
import Card from '@/components/Card'
import FosAlert from '@/components/FosAlert'

function deviceIcon(deviceName = '') {
  const lower = deviceName.toLowerCase()
  if (lower.includes('mobile') || lower.includes('android') || lower.includes('iphone')) return Smartphone
  if (lower.includes('mac') || lower.includes('windows') || lower.includes('linux')) return Laptop
  return Monitor
}

function formatRelativeTime(iso) {
  if (!iso) return '—'
  const diffMs = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(diffMs / 60000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export default function SessionsSection() {
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [revokingId, setRevokingId] = useState(null)
  const [renamingId, setRenamingId] = useState(null)
  const { message, show, clear } = useTimedMessage()

  const handleRename = async (session, newName) => {
    setRenamingId(null)
    const trimmed = newName.trim()
    if (trimmed === (session.custom_name || '')) return
    try {
      const res = await api.patch(`/auth/sessions/${session.id}/rename/`, { custom_name: trimmed })
      setSessions((prev) => prev.map((s) => (s.id === session.id ? res.data : s)))
    } catch (err) {
      show('error', err.response?.data?.error || 'Failed to rename device.')
    }
  }

  const loadSessions = () => {
    setLoading(true)
    api.get('/auth/sessions/')
      .then((res) => setSessions(res.data))
      .catch(() => show('error', 'Failed to load sessions.'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    loadSessions()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleRevoke = async (session) => {
    setRevokingId(session.id)
    try {
      await api.delete(`/auth/sessions/${session.id}/`)
      setSessions((prev) => prev.filter((s) => s.id !== session.id))
      show('success', `Signed out of ${session.device_name || 'that device'}.`)
    } catch (err) {
      show('error', err.response?.data?.error || 'Failed to revoke session.')
    } finally {
      setRevokingId(null)
    }
  }

  return (
    <Card title="Active Sessions" subtitle="Devices currently signed in to your account — up to 3 at a time">
      {message && (
        <div style={{ marginBottom: 16 }}>
          <FosAlert type={message.type} onDismiss={clear}>{message.text}</FosAlert>
        </div>
      )}

      {loading ? (
        <p style={{ fontSize: '0.875rem', color: 'var(--text-tertiary)' }}>Loading…</p>
      ) : sessions.length === 0 ? (
        <p style={{ fontSize: '0.875rem', color: 'var(--text-tertiary)' }}>No active sessions found.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {sessions.map((session) => {
            const Icon = deviceIcon(session.device_name)
            return (
              <div
                key={session.id}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                  padding: '12px 14px', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)',
                  background: session.is_current ? 'var(--accent-glow)' : 'transparent',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                  <Icon size={18} color="var(--text-tertiary)" style={{ flexShrink: 0 }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {renamingId === session.id ? (
                        <input
                          autoFocus
                          defaultValue={session.custom_name || ''}
                          placeholder={session.device_name || 'Unknown device'}
                          onBlur={(e) => handleRename(session, e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setRenamingId(null) }}
                          style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)', background: 'var(--bg-surface-2)', border: '1px solid var(--border-subtle)', borderRadius: 6, padding: '2px 6px', width: 160 }}
                        />
                      ) : (
                        <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                          {session.custom_name || session.device_name || 'Unknown device'}
                        </span>
                      )}
                      {session.can_rename && renamingId !== session.id && (
                        <button
                          onClick={() => setRenamingId(session.id)}
                          title="Rename this device"
                          aria-label="Rename this device"
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', padding: 2, display: 'flex' }}
                        >
                          <Pencil size={13} />
                        </button>
                      )}
                      {session.is_current && (
                        <span style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--accent)', background: 'var(--accent-glow-md)', padding: '2px 8px', borderRadius: 999 }}>
                          This device
                        </span>
                      )}
                    </div>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginTop: 2 }}>
                      {session.ip_address || 'Unknown IP'} · Last active {formatRelativeTime(session.last_used_at)}
                    </p>
                  </div>
                </div>
                {!session.is_current && (
                  <button
                    onClick={() => handleRevoke(session)}
                    disabled={revokingId === session.id}
                    className="fos-btn fos-btn-ghost"
                    style={{ flexShrink: 0, padding: '6px 14px', fontSize: '0.78rem' }}
                  >
                    {revokingId === session.id ? <><span className="fos-spinner" /> Revoking…</> : 'Sign Out'}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}