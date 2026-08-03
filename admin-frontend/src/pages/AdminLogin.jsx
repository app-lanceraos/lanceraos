// src/pages/AdminLogin.jsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '@/lib/api'
import { LogoSVG, WordmarkSVG } from '@/components/Brand'

const cardStyle = {
  width: '100%', maxWidth: 380, background: 'var(--bg-surface)',
  border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius)',
  padding: 32,
}

const inputStyle = {
  width: '100%', padding: '10px 14px', borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--border-subtle)', background: 'var(--bg-surface-2)',
  color: 'var(--text-primary)', fontSize: '0.9rem', marginBottom: 16,
}

const buttonStyle = {
  width: '100%', padding: '11px 0', borderRadius: 'var(--radius-sm)',
  border: 'none', background: 'var(--accent)', color: '#04140f',
  fontWeight: 700, fontSize: '0.9rem', cursor: 'pointer',
}

export default function AdminLogin() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await api.post('/login/', { email, password })
      if (res.data.requires_2fa) {
        navigate('/2fa-verify', { state: { sessionId: res.data.session_id } })
      }
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
          Admin Panel
        </p>

        {error && (
          <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '10px 12px', marginBottom: 16, fontSize: '0.82rem', color: '#fca5a5' }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <label style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: 6 }}>
            Email
          </label>
          <input
            type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            style={inputStyle} autoComplete="username" required
          />
          <label style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: 6 }}>
            Password
          </label>
          <input
            type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            style={inputStyle} autoComplete="current-password" required
          />
          <button type="submit" disabled={loading} style={{ ...buttonStyle, opacity: loading ? 0.6 : 1 }}>
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  )
}