// src/pages/InvoiceView.jsx
//
// /invoice/:token — the real, frontend-domain invoice view page. Fixes a
// real, reported issue: a client opening "View Invoice Online" (the
// email link), the portal list, Copy Invoice Link, or the QR code on the
// PDF used to land on the raw backend/API host
// (api.lanceraos.com/api/invoices/portal/view/<token>/) — this product's
// actual domain never appeared in their address bar at all.
//
// Does NOT reimplement the invoice layout — fetches the exact same
// rendered HTML apps/invoices/views_portal.py's portal_invoice_view_html
// already produces (GET /api/invoices/portal/view/<token>/, still
// AllowAny/unauthenticated-except-for-portal-session, still going
// through every real access-control side effect —
// is_freelancer_previewing_portal, ClientPortalSession minting, the
// Sent->Viewed transition/InvoiceViewEvent logging — entirely
// server-side, unchanged) and displays it inside a sandboxed
// <iframe srcDoc>, filling the page. This page is a thin display
// wrapper, never a second reimplementation of the shared template — the
// one-HTML/CSS-renderer principle (Step 12) holds exactly as before.
//
// Supersedes the earlier "non-SPA-navigation exception" (App.jsx/
// ClientPortal.jsx/PortalEnter.jsx's own prior comments, and
// DECISIONS.md) — the invoice VIEW is now a real React route after all,
// for a purely cosmetic/branding reason (frontend domain in the address
// bar), not because the underlying shared-renderer architecture changed
// at all.
//
// No AppShell — a standalone, public page, matching DeletionReview.jsx/
// PortalEnter.jsx's own shell-less convention (no sidebar/header makes
// sense for a document a client — who has no LanceraOS account at all —
// is looking at).
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { AlertCircle, Download } from 'lucide-react'

import api from '@/lib/api'
import useTitle from '@/hooks/useTitle'

const BACKEND_ORIGIN = import.meta.env.VITE_API_URL || 'http://localhost:8000'

// Injected into the fetched HTML's own <head> before it's handed to the
// iframe's srcDoc. WITHOUT this, every relative /static/... URL inside
// it (the embedded @font-face files — see apps/invoices/pdf_generator.py's
// PORTAL_FONT_CONTEXT) resolves against THIS PAGE's own origin instead of
// the backend's, since srcDoc content's default base URI is the
// embedding document's URL, not wherever the HTML was originally fetched
// from. Confirmed directly (not assumed) — without this line the fonts
// silently fall back to system defaults; a real <base> tag fixes it.
function withBackendBase(html) {
  return html.replace('<head>', `<head><base href="${BACKEND_ORIGIN}/">`)
}

export default function InvoiceView() {
  useTitle('Invoice — LanceraOS')
  const { token } = useParams()
  const [html, setHtml] = useState(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    api.get(`/invoices/portal/view/${token}/`, {
      responseType: 'text',
      transformResponse: [(data) => data], // raw HTML, never JSON-parsed
    })
      .then(({ data }) => { if (!cancelled) setHtml(withBackendBase(data)) })
      .catch(() => { if (!cancelled) setError(true) })
    return () => { cancelled = true }
  }, [token])

  if (error) {
    return (
      <div style={pageWrapStyle}>
        <div style={{ textAlign: 'center', maxWidth: 360 }}>
          <AlertCircle size={28} style={{ color: '#c0392b', marginBottom: 10 }} />
          <p style={{ margin: 0, fontSize: '0.95rem', color: '#2d2a26', fontWeight: 600 }}>
            This invoice link is invalid or no longer available.
          </p>
        </div>
      </div>
    )
  }

  if (html === null) {
    return (
      <div style={pageWrapStyle}>
        <p style={{ margin: 0, fontSize: '0.9rem', color: '#6b6558' }}>Loading invoice…</p>
      </div>
    )
  }

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh' }}>
      <iframe
        title="Invoice"
        srcDoc={html}
        sandbox=""
        style={{ display: 'block', width: '100%', height: '100%', border: 'none' }}
      />
      {/* Real chrome AROUND the iframe, never inside the shared template
          itself — same principle the old Preview-as-Client banner used
          (pure React, the template markup never diverges between render
          paths). The shared invoice templates have no Download
          affordance of their own (confirmed directly — none references
          pdf_url), so this is genuinely the only way a client without a
          LanceraOS account can get the PDF from this page. */}
      <a
        href={`${BACKEND_ORIGIN}/api/invoices/portal/view/${token}/pdf/`}
        style={downloadButtonStyle}
        aria-label="Download invoice PDF"
      >
        <Download size={14} /> Download
      </a>
    </div>
  )
}

const pageWrapStyle = {
  minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: '#e4e1d8', padding: 24,
}

const downloadButtonStyle = {
  position: 'fixed', top: 16, right: 16, zIndex: 10,
  display: 'flex', alignItems: 'center', gap: 6,
  padding: '9px 16px', borderRadius: 999,
  background: '#1e1b2e', color: '#fff', fontSize: '0.82rem', fontWeight: 600,
  textDecoration: 'none', boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
  fontFamily: "'DM Sans', sans-serif",
}
