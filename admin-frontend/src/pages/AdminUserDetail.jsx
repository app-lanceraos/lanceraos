// src/pages/AdminUserDetail.jsx
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import api from '@/lib/api'
import useAdminAuthStore from '@/store/adminAuthStore'

const sectionStyle = {
  background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius)', padding: 20, marginBottom: 16,
}

const rowStyle = { display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: '0.85rem' }

const btn = (variant = 'default') => {
  const variants = {
    default: { background: 'var(--bg-surface-2)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)' },
    danger: { background: 'rgba(239,68,68,0.12)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.3)' },
    accent: { background: 'var(--accent)', color: '#04140f', border: 'none' },
  }
  return {
    padding: '7px 14px', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
    fontSize: '0.8rem', fontWeight: 600, marginRight: 8, marginTop: 8, ...variants[variant],
  }
}

export default function AdminUserDetail() {
  const { userId } = useParams()
  const currentAdmin = useAdminAuthStore((s) => s.admin)
  const [user, setUser] = useState(null)
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [actionError, setActionError] = useState('')
  const [actionMessage, setActionMessage] = useState('')
  const [suspendReason, setSuspendReason] = useState('')
  const [showSuspendForm, setShowSuspendForm] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const [userRes, sessionsRes] = await Promise.all([
        api.get(`/users/${userId}/`),
        api.get(`/users/${userId}/sessions/`),
      ])
      setUser(userRes.data)
      setSessions(sessionsRes.data)
    } catch (err) {
      setActionError(err.response?.data?.error || 'Failed to load user.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [userId])

  const runAction = async (fn, successMessage) => {
    setActionError('')
    setActionMessage('')
    try {
      await fn()
      setActionMessage(successMessage)
      await load()
    } catch (err) {
      setActionError(err.response?.data?.error || 'Action failed.')
    }
  }

  const handleSuspend = () => {
    if (!suspendReason.trim()) {
      setActionError('A reason is required to suspend an account.')
      return
    }
    runAction(
      () => api.post(`/users/${userId}/suspend/`, { reason: suspendReason.trim() }),
      'Account suspended.',
    )
    setShowSuspendForm(false)
    setSuspendReason('')
  }

  const handleRevokeSession = (sessionId) => {
    if (!window.confirm('Revoke this session? The user will be signed out on that device immediately.')) return
    runAction(() => api.delete(`/users/${userId}/sessions/${sessionId}/`), 'Session revoked.')
  }

  if (loading) return <p style={{ color: 'var(--text-tertiary)' }}>Loading…</p>
  if (!user) return <p style={{ color: 'var(--danger)' }}>{actionError || 'User not found.'}</p>

  const isSelf = user.id === currentAdmin?.id

  return (
    <div>
      <Link to="/users" style={{ color: 'var(--text-tertiary)', fontSize: '0.8rem', textDecoration: 'none' }}>← Back to search</Link>
      <h1 style={{ fontSize: '1.2rem', fontWeight: 700, margin: '10px 0 20px' }}>{user.email}</h1>

      {actionMessage && <p style={{ color: 'var(--accent)', fontSize: '0.85rem' }}>{actionMessage}</p>}
      {actionError && <p style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>{actionError}</p>}

      <div style={sectionStyle}>
        <h2 style={{ fontSize: '0.9rem', fontWeight: 700, marginBottom: 10 }}>Account</h2>
        <div style={rowStyle}><span style={{ color: 'var(--text-tertiary)' }}>Username</span><span>@{user.username}</span></div>
        <div style={rowStyle}><span style={{ color: 'var(--text-tertiary)' }}>Name</span><span>{user.first_name} {user.last_name}</span></div>
        <div style={rowStyle}><span style={{ color: 'var(--text-tertiary)' }}>Email verified</span><span>{user.is_email_verified ? 'Yes' : 'No'}</span></div>
        <div style={rowStyle}><span style={{ color: 'var(--text-tertiary)' }}>2FA enabled</span><span>{user.two_fa_enabled ? 'Yes' : 'No'}</span></div>
        <div style={rowStyle}><span style={{ color: 'var(--text-tertiary)' }}>Onboarding completed</span><span>{user.onboarding_completed ? 'Yes' : 'No'}</span></div>
        <div style={rowStyle}><span style={{ color: 'var(--text-tertiary)' }}>Linked providers</span><span>{user.linked_providers?.length ? user.linked_providers.join(', ') : 'None'}</span></div>
        <div style={rowStyle}><span style={{ color: 'var(--text-tertiary)' }}>Joined</span><span>{user.date_joined ? new Date(user.date_joined).toLocaleDateString() : '—'}</span></div>
        <div style={rowStyle}><span style={{ color: 'var(--text-tertiary)' }}>Last login</span><span>{user.last_login ? new Date(user.last_login).toLocaleString() : 'Never'}</span></div>

        {!user.is_email_verified && (
          <button style={btn()} onClick={() => runAction(() => api.post(`/users/${userId}/resend-verification/`), 'Verification email sent.')}>
            Resend verification email
          </button>
        )}
      </div>

      <div style={sectionStyle}>
        <h2 style={{ fontSize: '0.9rem', fontWeight: 700, marginBottom: 10 }}>Status</h2>
        {user.is_suspended ? (
          <>
            <div style={rowStyle}><span style={{ color: 'var(--text-tertiary)' }}>Suspended</span><span style={{ color: '#fca5a5' }}>Yes, since {new Date(user.suspended_at).toLocaleDateString()}</span></div>
            <div style={rowStyle}><span style={{ color: 'var(--text-tertiary)' }}>Reason</span><span>{user.suspension_reason}</span></div>
            <button style={btn('accent')} onClick={() => runAction(() => api.post(`/users/${userId}/reactivate/`), 'Account reactivated.')}>
              Reactivate account
            </button>
          </>
        ) : user.is_deleted ? (
          <>
            <div style={rowStyle}><span style={{ color: 'var(--text-tertiary)' }}>Deletion scheduled</span><span style={{ color: '#fcd34d' }}>{new Date(user.deletion_scheduled_at).toLocaleDateString()}</span></div>
            <button style={btn('accent')} onClick={() => runAction(() => api.post(`/users/${userId}/restore/`), 'Account restored.')}>
              Restore account
            </button>
          </>
        ) : (
          <>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Account is in good standing.</p>
            {isSelf ? (
              <p style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>You cannot suspend your own account.</p>
            ) : user.can_access_admin_panel && !currentAdmin?.is_super_admin ? (
              <p style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>Only a super-admin can suspend another admin account.</p>
            ) : !showSuspendForm ? (
              <button style={btn('danger')} onClick={() => setShowSuspendForm(true)}>Suspend account</button>
            ) : (
              <div style={{ marginTop: 10 }}>
                <textarea
                  value={suspendReason} onChange={(e) => setSuspendReason(e.target.value)}
                  placeholder="Reason for suspension (required)…"
                  style={{ width: '100%', minHeight: 60, padding: 10, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)', background: 'var(--bg-surface-2)', color: 'var(--text-primary)', fontSize: '0.85rem' }}
                />
                <div>
                  <button style={btn('danger')} onClick={handleSuspend}>Confirm suspend</button>
                  <button style={btn()} onClick={() => { setShowSuspendForm(false); setSuspendReason('') }}>Cancel</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {currentAdmin?.is_super_admin && (
        <div style={sectionStyle}>
          <h2 style={{ fontSize: '0.9rem', fontWeight: 700, marginBottom: 10 }}>Admin access</h2>
          <div style={rowStyle}><span style={{ color: 'var(--text-tertiary)' }}>Has admin access</span><span>{user.can_access_admin_panel ? (user.is_super_admin ? 'Yes (super-admin)' : 'Yes') : 'No'}</span></div>
          {!isSelf && (
            user.can_access_admin_panel ? (
              <button style={btn('danger')} onClick={() => runAction(() => api.post(`/users/${userId}/revoke-admin/`), 'Admin access revoked.')}>
                Revoke admin access
              </button>
            ) : (
              <button style={btn('accent')} onClick={() => runAction(() => api.post(`/users/${userId}/grant-admin/`), 'Admin access granted.')}>
                Grant admin access
              </button>
            )
          )}
          {isSelf && <p style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>You cannot change your own admin access here.</p>}
        </div>
      )}

      <div style={sectionStyle}>
        <h2 style={{ fontSize: '0.9rem', fontWeight: 700, marginBottom: 10 }}>Sessions</h2>
        {sessions.length === 0 && <p style={{ fontSize: '0.85rem', color: 'var(--text-tertiary)' }}>No active sessions.</p>}
        {sessions.map((s) => (
          <div key={s.id} style={{ ...rowStyle, alignItems: 'center' }}>
            <span>{s.custom_name || s.device_name || 'Unknown device'} {s.is_current && '(admin session)'}</span>
            <button style={{ ...btn('danger'), marginTop: 0 }} onClick={() => handleRevokeSession(s.id)}>Revoke</button>
          </div>
        ))}
      </div>
    </div>
  )
}