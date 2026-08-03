// src/pages/AdminUserSearch.jsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '@/lib/api'

const inputStyle = {
  flex: 1, padding: '10px 14px', borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--border-subtle)', background: 'var(--bg-surface-2)',
  color: 'var(--text-primary)', fontSize: '0.9rem',
}

const badge = (bg, color) => ({
  display: 'inline-block', padding: '2px 8px', borderRadius: 999,
  fontSize: '0.7rem', fontWeight: 600, background: bg, color,
})

function StatusBadges({ user }) {
  return (
    <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
      {user.is_suspended && <span style={badge('rgba(239,68,68,0.15)', '#fca5a5')}>Suspended</span>}
      {user.is_deleted && <span style={badge('rgba(251,191,36,0.15)', '#fcd34d')}>Deletion pending</span>}
      {!user.is_email_verified && <span style={badge('rgba(148,163,184,0.15)', '#cbd5e1')}>Unverified</span>}
      {user.is_super_admin && <span style={badge('rgba(0,229,160,0.15)', 'var(--accent)')}>Super-admin</span>}
    </div>
  )
}

export default function AdminUserSearch() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSearch = async (e) => {
    e.preventDefault()
    if (!query.trim()) return
    setLoading(true)
    setError('')
    try {
      const res = await api.get(`/users/search/?q=${encodeURIComponent(query.trim())}`)
      setResults(res.data.results)
    } catch (err) {
      setError(err.response?.data?.error || 'Search failed.')
      setResults(null)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <h1 style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: 16 }}>Search Users</h1>

      <form onSubmit={handleSearch} style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <input
          type="text" value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Email or username…" style={inputStyle} autoFocus
        />
        <button
          type="submit" disabled={loading}
          style={{ padding: '10px 20px', borderRadius: 'var(--radius-sm)', border: 'none', background: 'var(--accent)', color: '#04140f', fontWeight: 700, cursor: 'pointer', opacity: loading ? 0.6 : 1 }}
        >
          {loading ? 'Searching…' : 'Search'}
        </button>
      </form>

      {error && <p style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>{error}</p>}

      {results !== null && (
        <div>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', marginBottom: 10 }}>
            {results.length} result{results.length !== 1 ? 's' : ''}
          </p>
          {results.map((user) => (
            <div
              key={user.id}
              onClick={() => navigate(`/users/${user.id}`)}
              style={{
                padding: '12px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)',
                background: 'var(--bg-surface)', marginBottom: 8, cursor: 'pointer',
              }}
            >
              <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{user.email}</div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>@{user.username}</div>
              <StatusBadges user={user} />
            </div>
          ))}
          {results.length === 0 && (
            <p style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem' }}>No matching users.</p>
          )}
        </div>
      )}
    </div>
  )
}