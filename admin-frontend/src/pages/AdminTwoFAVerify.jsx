// src/pages/AdminTwoFAVerify.jsx
import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import api from '@/lib/api'
import useAdminAuthStore from '@/store/adminAuthStore'
import { LogoSVG, WordmarkSVG } from '@/components/Brand'

const cardStyle = {
  width: '100%', maxWidth: 380, background: 'var(--bg-surface)',
  border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius)',
  padding: 32,
}

const inputStyle = {
  width: '100%', padding: '10px 14px', borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--border-subtle)', background: 'var(--bg-surface-2)',
  color: 'var(--text-primary)', fontSize: '1.1rem', letterSpacing: '0.3em',
  textAlign: 'center', marginBottom: 16,
}

const buttonStyle = {
  width: '100%', padding: '11px 0', borderRadius: 'var(--radius-sm)',
  border: 'none', background: 'var(--accent)', color: '#04140f',
  fontWeight: 700, fontSize: '0.9rem', cursor: 'pointer',
}

export default function AdminTwoFAVerify() {
  const navigate = useNavigate()
  const location = useLocation()
  const loginSuccess = useAdminAuthStore((s) => s.loginSuccess)
  const sessionId = location.state?.sessionId

  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  if (!sessionId) {
    navigate('/login', { replace: true })
    return null
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await api.post('/2fa/verify/', { session_id: sessionId, code })
      loginSuccess(res.data.user)
      navigate('/', { replace: true })
    } catch (err) {
      setError(err.response?.data?.error || 'Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <LogoSVG size={28} />
          <WordmarkSVG width={100} height={15} />
        </div>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', margin: '0 0 24px' }}>
          Enter the 6-digit code sent to your email
        </p>

        {error && (
          <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '10px 12px', marginBottom: 16, fontSize: '0.82rem', color: '#fca5a5' }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <input
            type="text" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            style={inputStyle} maxLength={6} inputMode="numeric" autoComplete="one-time-code" autoFocus required
          />
          <button type="submit" disabled={loading || code.length !== 6} style={{ ...buttonStyle, opacity: loading || code.length !== 6 ? 0.6 : 1 }}>
            {loading ? 'Verifying…' : 'Verify'}
          </button>
        </form>
      </div>
    </div>
  )
}