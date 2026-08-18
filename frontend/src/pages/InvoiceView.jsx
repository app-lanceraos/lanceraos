// src/pages/InvoiceView.jsx
//
// /invoice/:token — the real, frontend-domain invoice view page.
//
// REWORKED this pass (see DECISIONS.md's frozen-PDF-vs-live-render
// entry): this page used to fetch and display the backend's LIVE-
// RENDERED HTML on every visit — which pulled the freelancer's CURRENT
// FreelancerProfile (business name, logo, payment methods, signature)
// fresh every time, even though the invoice's own fields are frozen. A
// freelancer editing their profile after sending an invoice could
// silently change what a client saw on "View Invoice" days later, while
// the actual downloadable PDF stayed correctly frozen — two documents,
// same invoice, able to disagree. Now this page shows the ACTUAL FROZEN
// PDF — the exact same bytes Download serves — via the browser's own
// native PDF viewer, never a fresh re-render. GET
// /api/invoices/portal/view/<token>/ (apps/invoices/views_portal.py's
// portal_invoice_view_html) itself now serves that same frozen PDF
// inline; a real 503 with a clear message when nothing's frozen yet
// (never a live-render fallback — the exact drift this rework closes).
// Every real path that can reach this page was traced directly: a
// draft/finalised-but-unsent invoice's token is never exposed through
// any of them (no email is sent pre-send; the client-portal list now
// excludes draft/created — see that same DECISIONS.md entry), so in
// practice the "not ready yet" state is a narrow, honest window right
// after finalising, not a routine one.
//
// Both the view and the Download action fetch via axios as a `blob`
// (never a plain <a href>/<iframe src> pointing at the backend URL) and
// hand the browser a same-origin `blob:` object URL instead — this is
// what actually hides the backend/API host from anything a client could
// hover, right-click, or view-source on, fitting this project's
// deployment shape (a static Vite/React SPA with no server-side runtime
// of its own to run a same-origin reverse proxy through) without
// touching the app's existing, deliberate cross-origin cookie/CORS
// architecture (app domain vs api.lanceraos.com) at all.
//
// No AppShell — a standalone, public page, matching DeletionReview.jsx/
// PortalEnter.jsx's own shell-less convention (no sidebar/header makes
// sense for a document a client — who has no LanceraOS account at all —
// is looking at).
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { AlertCircle, Clock, Download } from 'lucide-react'

import api from '@/lib/api'
import useTitle from '@/hooks/useTitle'

function filenameFromContentDisposition(header, fallback) {
  const match = /filename="?([^"]+)"?/i.exec(header || '')
  return match ? match[1] : fallback
}

export default function InvoiceView() {
  useTitle('Invoice — LanceraOS')
  const { token } = useParams()
  // 'loading' | 'ready' | 'not_yet_available' | 'error'
  const [state, setState] = useState('loading')
  const [pdfUrl, setPdfUrl] = useState(null) // a same-origin blob: URL
  const [downloading, setDownloading] = useState(false)

  useEffect(() => {
    // A real AbortController, not just an ignore-the-result flag — this
    // request is slow (this account's self-heal chain — see
    // fetch_invoice_pdf_bytes' own docstring — routinely takes 3+
    // seconds under the real, confirmed Cloudinary ACL condition), so
    // React.StrictMode's real dev-only mount/unmount/remount cycle (main.jsx)
    // would otherwise fire it twice and pay that cost twice, discarding
    // the first response. Aborting the superseded request actually
    // cancels the wasted backend work instead of just ignoring it.
    const controller = new AbortController()
    let objectUrl = null
    api.get(`/invoices/portal/view/${token}/`, { responseType: 'blob', signal: controller.signal })
      .then(({ data }) => {
        objectUrl = URL.createObjectURL(data)
        setPdfUrl(objectUrl)
        setState('ready')
      })
      .catch((e) => {
        if (e.code === 'ERR_CANCELED') return
        // 503 — the real, specific "nothing frozen yet" case
        // portal_invoice_view_html returns; everything else (404, a
        // genuine total failure) reads as a plain invalid/unavailable
        // link, matching this page's own prior behavior.
        setState(e.response?.status === 503 ? 'not_yet_available' : 'error')
      })
    return () => {
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [token])

  async function handleDownload() {
    setDownloading(true)
    try {
      const res = await api.get(`/invoices/portal/view/${token}/pdf/`, { responseType: 'blob' })
      const blobUrl = URL.createObjectURL(res.data)
      const filename = filenameFromContentDisposition(res.headers['content-disposition'], 'invoice.pdf')
      const link = document.createElement('a')
      link.href = blobUrl
      link.download = filename
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(blobUrl)
    } catch {
      // A failed download leaves the button clickable for a retry — a
      // secondary action on a page whose primary content (the iframe)
      // already loaded successfully doesn't need its own dedicated
      // error state.
    } finally {
      setDownloading(false)
    }
  }

  if (state === 'error') {
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

  if (state === 'not_yet_available') {
    return (
      <div style={pageWrapStyle}>
        <div style={{ textAlign: 'center', maxWidth: 360 }}>
          <Clock size={28} style={{ color: '#8a7d5c', marginBottom: 10 }} />
          <p style={{ margin: 0, fontSize: '0.95rem', color: '#2d2a26', fontWeight: 600 }}>
            This invoice isn't ready to view yet.
          </p>
          <p style={{ margin: '6px 0 0', fontSize: '0.82rem', color: '#6b6558' }}>Please check back in a moment.</p>
        </div>
      </div>
    )
  }

  if (state === 'loading') {
    return (
      <div style={pageWrapStyle}>
        <p style={{ margin: 0, fontSize: '0.9rem', color: '#6b6558' }}>Loading invoice…</p>
      </div>
    )
  }

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh' }}>
      {/* A same-origin blob: URL — never the backend host — and the
          browser's own native PDF viewer, not a re-rendered HTML
          approximation. Deliberately NO sandbox attribute (a real,
          confirmed bug this pass: sandbox="" — appropriate for the
          OLD srcDoc-HTML approach, where the concern was arbitrary
          third-party markup — made Chrome refuse to render the PDF at
          all ("this page has been blocked"), since Chrome's own
          built-in PDF viewer needs script execution for its internal
          toolbar/zoom/search UI. The threat model is different for a
          PDF blob we built ourselves from our own backend's response:
          there's no arbitrary-script-execution risk to sandbox against
          in the first place, so restricting this iframe bought nothing
          but broke the actual feature. */}
      <iframe
        title="Invoice"
        src={pdfUrl}
        style={{ display: 'block', width: '100%', height: '100%', border: 'none' }}
      />
      <button onClick={handleDownload} disabled={downloading} style={downloadButtonStyle} aria-label="Download invoice PDF">
        <Download size={14} /> {downloading ? 'Preparing…' : 'Download'}
      </button>
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
  padding: '9px 16px', borderRadius: 999, border: 'none', cursor: 'pointer',
  background: '#1e1b2e', color: '#fff', fontSize: '0.82rem', fontWeight: 600,
  boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
  fontFamily: "'DM Sans', sans-serif",
}
