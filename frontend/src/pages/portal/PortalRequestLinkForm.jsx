// src/pages/portal/PortalRequestLinkForm.jsx
//
// Self-serve "email me a fresh link" — POST /api/clients/portal/request-link/
// (rate-limited 5/email/hr + 20/IP/hr on the backend). Always shows the
// same generic success copy regardless of whether the email matched a
// real client — the backend itself never confirms/denies a match either,
// so there's nothing more specific to show here even on success.
import { useState } from 'react'

import api from '@/lib/api'

export default function PortalRequestLinkForm() {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    if (!email.trim()) return
    setBusy(true)
    setError('')
    try {
      await api.post('/clients/portal/request-link/', { email: email.trim() })
      setDone(true)
    } catch (err) {
      setError(err.response?.data?.error || 'Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <p style={{ margin: '16px 0 0', fontSize: '0.85rem', color: 'var(--status-green-text)' }}>
        If that email matches a client account, a link has been sent.
      </p>
    )
  }

  return (
    <form onSubmit={handleSubmit} style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        required
        className="fos-input"
      />
      {error && <p className="fos-error" style={{ margin: 0 }}>{error}</p>}
      <button type="submit" disabled={busy} className="fos-btn fos-btn-primary" style={{ width: '100%', justifyContent: 'center' }}>
        {busy ? <span className="fos-spinner" /> : null} Email me a link
      </button>
    </form>
  )
}
