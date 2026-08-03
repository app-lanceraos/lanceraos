// src/pages/AdminAuditLog.jsx
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import api from '@/lib/api'

const inputStyle = {
  padding: '8px 12px', borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--border-subtle)', background: 'var(--bg-surface-2)',
  color: 'var(--text-primary)', fontSize: '0.82rem',
}

const LIMIT = 25

export default function AdminAuditLog() {
  const [filters, setFilters] = useState({ user: '', actor: '', event: '', from: '', to: '' })
  const [adminOnly, setAdminOnly] = useState(false)
  const [eventTypes, setEventTypes] = useState([])
  const [results, setResults] = useState([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [expandedId, setExpandedId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    api.get('/audit-log/event-types/').then((res) => setEventTypes(res.data.event_types)).catch(() => {})
  }, [])

  const runSearch = async (newOffset = 0) => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ ...filters, limit: LIMIT, offset: newOffset })
      Object.keys(filters).forEach((k) => { if (!filters[k]) params.delete(k) })
      if (adminOnly) params.set('admin_only', 'true')
      const res = await api.get(`/audit-log/?${params.toString()}`)
      setResults(res.data.results)
      setTotal(res.data.total)
      setOffset(newOffset)
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load audit log.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { runSearch(0) }, [])

  const handleFilterSubmit = (e) => {
    e.preventDefault()
    runSearch(0)
  }

  return (
    <div>
      <h1 style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: 16 }}>Audit Log</h1>

      <form onSubmit={handleFilterSubmit} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
        <input placeholder="User email/username" value={filters.user} onChange={(e) => setFilters({ ...filters, user: e.target.value })} style={inputStyle} />
        <input placeholder="Actor (admin)" value={filters.actor} onChange={(e) => setFilters({ ...filters, actor: e.target.value })} style={inputStyle} />
        <input list="event-types" placeholder="Event" value={filters.event} onChange={(e) => setFilters({ ...filters, event: e.target.value })} style={inputStyle} />
        <datalist id="event-types">
          {eventTypes.map((ev) => <option key={ev} value={ev} />)}
        </datalist>
        <input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} style={inputStyle} />
        <input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} style={inputStyle} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', color: 'var(--text-primary)', cursor: 'pointer' }}>
          <input type="checkbox" checked={adminOnly} onChange={(e) => setAdminOnly(e.target.checked)} />
          Admin actions only
        </label>
        <button type="submit" style={{ padding: '8px 16px', borderRadius: 'var(--radius-sm)', border: 'none', background: 'var(--accent)', color: '#04140f', fontWeight: 700, cursor: 'pointer', fontSize: '0.82rem' }}>
          Filter
        </button>
      </form>

      {error && <p style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>{error}</p>}
      {loading ? (
        <p style={{ color: 'var(--text-tertiary)' }}>Loading…</p>
      ) : (
        <>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', marginBottom: 8 }}>
            {total} total — showing {offset + 1}–{Math.min(offset + LIMIT, total)}
          </p>
          {results.map((entry) => (
            <div
              key={entry.id}
              onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
              style={{ padding: '10px 14px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)', background: 'var(--bg-surface)', marginBottom: 6, cursor: 'pointer' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                <span style={{ fontWeight: 600 }}>{entry.event}</span>
                <span style={{ color: 'var(--text-tertiary)' }}>{new Date(entry.created_at).toLocaleString()}</span>
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: 4 }}>
                user: {entry.user || '—'} {entry.actor && `· actor: ${entry.actor}`} {entry.ip_address && `· ${entry.ip_address}`}
              </div>
              {expandedId === entry.id && (
                <pre style={{ marginTop: 8, fontSize: '0.72rem', color: 'var(--text-tertiary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {JSON.stringify(entry.metadata, null, 2)}
                </pre>
              )}
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button disabled={offset === 0} onClick={() => runSearch(Math.max(0, offset - LIMIT))} style={{ padding: '6px 14px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)', background: 'var(--bg-surface-2)', color: 'var(--text-primary)', cursor: offset === 0 ? 'default' : 'pointer', opacity: offset === 0 ? 0.4 : 1, fontSize: '0.8rem' }}>
              ← Previous
            </button>
            <button disabled={offset + LIMIT >= total} onClick={() => runSearch(offset + LIMIT)} style={{ padding: '6px 14px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)', background: 'var(--bg-surface-2)', color: 'var(--text-primary)', cursor: offset + LIMIT >= total ? 'default' : 'pointer', opacity: offset + LIMIT >= total ? 0.4 : 1, fontSize: '0.8rem' }}>
              Next →
            </button>
          </div>
        </>
      )}
    </div>
  )
}