// src/pages/InvoicePreviewPdf.jsx
//
// /invoices/:id/preview-pdf — real bug fix (live investigation, see
// DECISIONS.md): NewInvoiceWizard.jsx's own "Preview PDF" action used to
// open a new tab and navigate it DIRECTLY to the raw backend endpoint
// (`${api.defaults.baseURL}/invoices/${id}/pdf/`, i.e. http://localhost:
// 8000/api/... in dev, api.lanceraos.com in production) — the exact
// backend-host-in-the-address-bar problem this codebase has already
// fixed everywhere a CLIENT could see it (InvoiceView.jsx's own header
// comment has the full history), just not yet here, where it's the
// freelancer's own browser instead of a client's.
//
// Mirrors InvoiceView.jsx's own already-proven pattern exactly: fetch
// via axios as a `blob` (never a plain top-level navigation to the
// backend URL) and hand the browser a same-origin `blob:` object URL via
// an unsandboxed <iframe> (Chrome's built-in PDF viewer needs script
// execution for its own toolbar/zoom/search UI — sandboxing it breaks
// rendering entirely for no security benefit, since this is a blob we
// built ourselves from our own backend's response, not arbitrary
// third-party markup). The one real difference: this fetches the
// FREELANCER-authenticated `/invoices/<id>/pdf/` (IsAuthenticated,
// user=request.user — this app's own live-render-for-drafts endpoint),
// not the public, token-authenticated portal one, and this route itself
// requires a real login (PrivateRoute) rather than being public.
//
// No AppShell — a standalone, full-bleed PDF view, matching
// InvoiceView.jsx/DeletionReview.jsx/PortalEnter.jsx's own shell-less
// convention (a document preview doesn't need the sidebar/header frame).
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { AlertCircle } from 'lucide-react'

import api from '@/lib/api'
import useTitle from '@/hooks/useTitle'

export default function InvoicePreviewPdf() {
  const { id } = useParams()
  // 'loading' | 'ready' | 'error'
  const [state, setState] = useState('loading')
  const [pdfUrl, setPdfUrl] = useState(null) // a same-origin blob: URL

  useTitle('Preview — LanceraOS')

  useEffect(() => {
    // AbortController (not just an ignore-the-result flag) — matches
    // InvoiceView.jsx's own reasoning: React.StrictMode's dev-only
    // mount/unmount/remount cycle would otherwise fire this render twice.
    const controller = new AbortController()
    let objectUrl = null
    api.get(`/invoices/${id}/pdf/`, { responseType: 'blob', signal: controller.signal })
      .then(({ data }) => {
        objectUrl = URL.createObjectURL(data)
        setPdfUrl(objectUrl)
        setState('ready')
      })
      .catch((e) => {
        if (e.code === 'ERR_CANCELED') return
        setState('error')
      })
    return () => {
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [id])

  if (state === 'error') {
    return (
      <div style={pageWrapStyle}>
        <div style={{ textAlign: 'center', maxWidth: 360 }}>
          <AlertCircle size={28} style={{ color: 'var(--status-red-text, #c0392b)', marginBottom: 10 }} />
          <p style={{ margin: 0, fontSize: '0.95rem', color: 'var(--text-primary, #2d2a26)', fontWeight: 600 }}>
            Could not generate this preview.
          </p>
          <p style={{ margin: '6px 0 0', fontSize: '0.82rem', color: 'var(--text-tertiary, #6b6558)' }}>
            Please close this tab and try again.
          </p>
        </div>
      </div>
    )
  }

  if (state === 'loading') {
    return (
      <div style={pageWrapStyle}>
        <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-tertiary, #6b6558)' }}>Loading preview…</p>
      </div>
    )
  }

  return (
    <iframe
      title="Invoice preview"
      src={pdfUrl}
      style={{ display: 'block', width: '100vw', height: '100vh', border: 'none' }}
    />
  )
}

const pageWrapStyle = {
  minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'var(--bg-base, #e4e1d8)', padding: 24,
}
