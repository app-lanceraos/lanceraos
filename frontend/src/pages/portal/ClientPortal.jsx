// src/pages/portal/ClientPortal.jsx
//
// /portal — the client's own invoice LIST. A real React page (a list/
// dashboard genuinely is UI), unlike the individual invoice VIEW below,
// which is deliberately NOT a React component.
//
// Portal-session-authenticated via the httpOnly lanceraos_portal_session
// cookie (apps.clients.cookies) — GET /api/invoices/portal/me/ 401s with
// no valid session, handled here directly (never the global axios
// refresh-and-redirect-to-/login interceptor, which src/lib/api.js's
// SKIP_REFRESH_URLS now explicitly excludes /invoices/portal/ from).
import { useEffect, useState } from 'react'
import { LogOut, MessageCircle, X } from 'lucide-react'

import api from '@/lib/api'
import useTitle from '@/hooks/useTitle'
import CommentThread from '@/components/CommentThread'
import { formatMoney } from '@/pages/invoiceHelpers'
import PortalLayout from './PortalLayout'
import PortalRequestLinkForm from './PortalRequestLinkForm'

const STATUS_LABELS = {
  draft: 'Draft', created: 'Finalised', sent: 'Sent', viewed: 'Viewed',
  partially_paid: 'Partially Paid', paid: 'Paid',
  cancelled: 'Cancelled', refunded: 'Refunded', bad_debt: 'Bad Debt',
}

// PortalInvoiceListSerializer deliberately never exposes the raw
// view_token as its own field (Step 12 — only pre-built URLs are
// exposed to the client side, never the credential itself). The
// comment thread's WebSocket route needs that token, so it's parsed
// back out of the one URL that already legitimately contains it
// (.../portal/view/<token>/) rather than adding a second field whose
// only purpose would be handing the token to JS directly.
function viewTokenFromPortalUrl(url) {
  if (!url) return null
  const segments = url.split('/').filter(Boolean)
  return segments[segments.length - 1] || null
}

export default function ClientPortal() {
  useTitle('Your Invoices — LanceraOS')
  const [invoices, setInvoices] = useState(null)
  const [needsLink, setNeedsLink] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [messagesInvoice, setMessagesInvoice] = useState(null)

  useEffect(() => { load() }, [])

  function load() {
    setLoadError(false)
    api.get('/invoices/portal/me/')
      .then(({ data }) => { setInvoices(data); setNeedsLink(false) })
      .catch((e) => {
        if (e.response?.status === 401) setNeedsLink(true)
        else setLoadError(true)
      })
  }

  async function handleLogout(everywhere) {
    setLoggingOut(true)
    try {
      await api.post(`/clients/portal/${everywhere ? 'logout-everywhere' : 'logout'}/`)
    } catch {
      // Already logged out (or the request itself failed) either way —
      // the local view below doesn't depend on this call having
      // succeeded, it just re-checks the session next.
    } finally {
      setLoggingOut(false)
      setInvoices(null)
      setNeedsLink(true)
    }
  }

  if (needsLink) {
    return (
      <PortalLayout>
        <h1 style={{ margin: '0 0 8px', fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>Your session has ended</h1>
        <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-tertiary)' }}>Enter your email and we'll send you a fresh link.</p>
        <PortalRequestLinkForm />
      </PortalLayout>
    )
  }

  if (loadError) {
    return (
      <PortalLayout>
        <p style={{ margin: '0 0 12px', fontSize: '0.9rem', color: 'var(--status-red-text)' }}>Something went wrong loading your invoices.</p>
        <button onClick={load} className="fos-btn fos-btn-primary">Try again</button>
      </PortalLayout>
    )
  }

  if (invoices === null) {
    return <PortalLayout><p style={{ margin: 0, color: 'var(--text-secondary)', textAlign: 'center' }}>Loading…</p></PortalLayout>
  }

  return (
    <PortalLayout maxWidth={720}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-primary)' }}>Your Invoices</h1>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => handleLogout(false)} disabled={loggingOut} className="fos-btn fos-btn-ghost" style={{ fontSize: '0.78rem' }}>
            <LogOut size={13} /> Log Out
          </button>
          <button onClick={() => handleLogout(true)} disabled={loggingOut} className="fos-btn fos-btn-ghost" style={{ fontSize: '0.78rem' }}>
            Log Out Everywhere
          </button>
        </div>
      </div>

      {invoices.length === 0 ? (
        <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-tertiary)' }}>No invoices yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {invoices.map((inv) => (
            <div
              key={inv.id}
              style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
                padding: '14px 16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)',
              }}
            >
              {/* Real browser navigation, not client-side routing — this
                  <a> points directly at the backend's own HTML-serving
                  endpoint (GET /api/invoices/portal/view/<token>/). A
                  plain href, deliberately not a React Router <Link> or
                  an onClick+navigate()+fetch: the invoice document
                  itself is the one shared render artifact (PDF/portal/
                  editor-preview), never a second React reimplementation
                  of the layout — see DECISIONS.md. This is the one
                  intentional exception to this app's otherwise-
                  universal client-side routing. Messages, below, are
                  genuinely interactive UI with no such artifact to stay
                  in sync with, so that part IS real React. */}
              <a href={inv.portal_view_url} style={{ textDecoration: 'none', color: 'inherit', flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  {inv.invoice_number || '(unnumbered)'}
                </p>
                <p style={{ margin: '2px 0 0', fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
                  {STATUS_LABELS[inv.status] || inv.status} · Due {inv.due_date || '—'}
                  {inv.days_overdue > 0 ? ` · ${inv.days_overdue}d overdue` : ''}
                </p>
              </a>
              <p style={{ margin: 0, fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                {formatMoney(inv.total, inv.currency)}
              </p>
              <button
                onClick={() => setMessagesInvoice(inv)}
                className="fos-btn fos-btn-ghost"
                style={{ fontSize: '0.78rem', flexShrink: 0 }}
                aria-label={`Messages for ${inv.invoice_number || 'this invoice'}`}
              >
                <MessageCircle size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {messagesInvoice && (
        <MessagesModal invoice={messagesInvoice} onClose={() => setMessagesInvoice(null)} />
      )}
    </PortalLayout>
  )
}

function MessagesModal({ invoice, onClose }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: 'var(--bg-surface)', borderRadius: 'var(--radius-xl)', boxShadow: '0 8px 40px rgba(0,0,0,0.25)', padding: '20px 24px', width: '100%', maxWidth: 480, height: 520, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            {invoice.invoice_number || 'Messages'}
          </h3>
          <button onClick={onClose} aria-label="Close" className="fos-btn fos-btn-ghost" style={{ padding: 6 }}><X size={16} /></button>
        </div>
        <div style={{ flex: 1, minHeight: 0 }}>
          <CommentThread
            commentsUrl={`/invoices/portal/${invoice.id}/comments/`}
            viewToken={viewTokenFromPortalUrl(invoice.portal_view_url)}
            viewerType="client"
          />
        </div>
      </div>
    </div>
  )
}
