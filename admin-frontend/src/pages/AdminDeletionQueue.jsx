// src/pages/AdminDeletionQueue.jsx
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import api from '@/lib/api'

export default function AdminDeletionQueue() {
  const [queue, setQueue] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const res = await api.get('/deletion-queue/')
      setQueue(res.data.results)
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load the deletion queue.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const handleRestore = async (id) => {
    setError('')
    setMessage('')
    try {
      await api.post(`/users/${id}/restore/`)
      setMessage('Account restored.')
      await load()
    } catch (err) {
      setError(err.response?.data?.error || 'Restore failed.')
    }
  }

  const daysLeft = (dateStr) => {
    const diff = new Date(dateStr) - new Date()
    return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)))
  }

  return (
    <div>
      <h1 style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: 16 }}>Deletion Queue</h1>
      <p style={{ fontSize: '0.82rem', color: 'var(--text-tertiary)', marginBottom: 16 }}>
        Accounts currently within their 30-day recovery window, ordered by soonest permanent deletion.
      </p>

      {error && <p style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>{error}</p>}
      {message && <p style={{ color: 'var(--accent)', fontSize: '0.85rem' }}>{message}</p>}

      {loading ? (
        <p style={{ color: 'var(--text-tertiary)' }}>Loading…</p>
      ) : queue.length === 0 ? (
        <p style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem' }}>No accounts currently pending deletion.</p>
      ) : (
        queue.map((u) => {
          const remaining = daysLeft(u.deletion_scheduled_at)
          return (
            <div
              key={u.id}
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)', background: 'var(--bg-surface)', marginBottom: 8 }}
            >
              <div>
                <Link to={`/users/${u.id}`} style={{ color: 'var(--text-primary)', fontWeight: 600, textDecoration: 'none', fontSize: '0.9rem' }}>
                  {u.email}
                </Link>
                <div style={{ fontSize: '0.78rem', color: remaining <= 3 ? '#fca5a5' : 'var(--text-tertiary)', marginTop: 2 }}>
                  {remaining === 0 ? 'Due today' : `${remaining} day${remaining !== 1 ? 's' : ''} remaining`} — permanent on {new Date(u.deletion_scheduled_at).toLocaleDateString()}
                </div>
              </div>
              <button
                onClick={() => handleRestore(u.id)}
                style={{ padding: '7px 14px', borderRadius: 'var(--radius-sm)', border: 'none', background: 'var(--accent)', color: '#04140f', fontWeight: 600, cursor: 'pointer', fontSize: '0.8rem' }}
              >
                Restore
              </button>
            </div>
          )
        })
      )}
    </div>
  )
}