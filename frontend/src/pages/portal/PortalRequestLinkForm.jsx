// src/pages/portal/PortalRequestLinkForm.jsx
//
// Self-serve "email me a fresh link" — POST /api/clients/portal/request-link/
// (rate-limited 5/email/hr + 20/IP/hr on the backend). Always shows the
// same generic success copy regardless of whether the email matched a
// real client — the backend itself never confirms/denies a match either,
// so there's nothing more specific to show here even on success.
//
// FIXED 22 September 2026: previously used var(--status-green-text) plus
// the .fos-input/.fos-error/.fos-btn classes, all of which resolve
// against theme.css's theme-responsive custom properties — a violation
// of DESIGN.md Section 10 for this public, unauthenticated surface (this
// form is embedded inside both ClientPortal.jsx and PortalEnter.jsx, both
// public). Inline styles hardcoded to the Section 10 palette now match
// InvoiceView.jsx/PaymentDetails.jsx's own established convention. See
// DECISIONS.md's 22 September 2026 entry.
import { useState } from 'react'

import api from '@/lib/api'

const inputStyle = {
  width: '100%', boxSizing: 'border-box', background: '#ffffff', border: '1.5px solid rgba(0,0,0,.15)',
  borderRadius: 8, padding: '10px 14px', fontFamily: "'DM Sans', sans-serif", fontSize: '0.9rem',
  color: '#334155', outline: 'none',
}

const primaryBtnStyle = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
  padding: '10px 20px', borderRadius: 8, fontFamily: "'DM Sans', sans-serif", fontSize: '0.88rem',
  fontWeight: 600, border: 'none', cursor: 'pointer', background: '#1e3a5f', color: '#ffffff',
}

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
      <p style={{ margin: '16px 0 0', fontSize: '0.85rem', color: '#00c896' }}>
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
        style={inputStyle}
      />
      {error && (
        <p style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.78rem', color: '#c0392b' }}>{error}</p>
      )}
      <button type="submit" disabled={busy} style={{ ...primaryBtnStyle, width: '100%', opacity: busy ? 0.5 : 1, cursor: busy ? 'not-allowed' : 'pointer' }}>
        {busy ? <span className="fos-spinner" /> : null} Email me a link
      </button>
    </form>
  )
}
