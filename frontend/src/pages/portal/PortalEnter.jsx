// src/pages/portal/PortalEnter.jsx
//
// /portal/enter/:token — the frontend landing point for a
// Client.portal_token magic link (Step 11's GET /api/clients/portal/{token}/,
// a JSON endpoint that mints/renews the real ClientPortalSession cookie).
// This page's only job is: call it, then hand off to /portal (the real
// list page). An invoice's own view_token link (the "View Invoice
// Online" email link) does NOT come through here at all — it's its own
// real route, InvoiceView.jsx at /invoice/:token, which fetches and
// displays the backend's rendered HTML directly rather than minting a
// session itself; see that file's own comment and DECISIONS.md.
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import api from '@/lib/api'
import useTitle from '@/hooks/useTitle'
import PortalLayout from './PortalLayout'
import PortalRequestLinkForm from './PortalRequestLinkForm'

export default function PortalEnter() {
  useTitle('Signing in — LanceraOS')
  const { token } = useParams()
  const navigate = useNavigate()
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    api.get(`/clients/portal/${token}/`)
      .then(() => { if (!cancelled) navigate('/portal', { replace: true }) })
      .catch((e) => {
        if (cancelled) return
        setError(e.response?.status === 404
          ? 'This link is invalid or has expired.'
          : 'Something went wrong. Please try again.')
      })
    return () => { cancelled = true }
  }, [token, navigate])

  if (!error) {
    return (
      <PortalLayout>
        <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-secondary)', textAlign: 'center' }}>Signing you in…</p>
      </PortalLayout>
    )
  }

  return (
    <PortalLayout>
      <h1 style={{ margin: '0 0 8px', fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>{error}</h1>
      <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-tertiary)' }}>Enter your email and we'll send you a fresh link.</p>
      <PortalRequestLinkForm />
    </PortalLayout>
  )
}
