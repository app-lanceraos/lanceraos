// src/components/CommentThread.jsx
//
// The real, shared two-way comment thread UI — used by both
// InvoiceDetailPanel.jsx (freelancer side, tab) and ClientPortal.jsx
// (client side, per-invoice panel). Genuinely interactive UI, not a
// shared-rendering-artifact concern like the invoice document itself
// (Step 12) — a live comment thread has no PDF/portal-page equivalent
// to stay in sync with, so it's real React on both sides.
//
// Real-time delivery via the shared useWebSocket hook
// (apps/invoices/consumers.py's ClientThreadConsumer, keyed by the
// invoice's view_token — reused on both sides since the consumer's own
// dual-identity auth already scopes each connection to the right
// invoice/party). Graceful fallback: if the socket never connects (or
// drops), a 15s poll keeps messages arriving — comments must never be
// silently undelivered just because WS is unavailable.
import { useEffect, useRef, useState } from 'react'
import { Paperclip, Send } from 'lucide-react'

import api from '@/lib/api'
import useWebSocket from '@/hooks/useWebSocket'

const ALLOWED_ATTACHMENT_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tiff']

function dedupeAppend(prev, comment) {
  if (prev.some((c) => c.id === comment.id)) return prev
  return [...prev, comment]
}

// commentsUrl: the real GET/POST endpoint for this side
//   (/invoices/{id}/comments/ or /invoices/portal/{id}/comments/).
// viewToken: the invoice's view_token — the WS route's real identifier
//   (see DECISIONS.md for why the route uses this, not the invoice pk).
// viewerType: 'freelancer' | 'client' — decides which author_type
//   renders right-aligned as "me".
export default function CommentThread({ commentsUrl, viewToken, viewerType }) {
  const [comments, setComments] = useState(null)
  const [error, setError] = useState('')
  const [text, setText] = useState('')
  const [attachment, setAttachment] = useState(null)
  const [attachmentError, setAttachmentError] = useState('')
  const [sending, setSending] = useState(false)
  const pollRef = useRef(null)
  const listEndRef = useRef(null)

  const { connected } = useWebSocket(viewToken ? `/ws/invoices/thread/${viewToken}/` : null, {
    onMessage: (comment) => setComments((prev) => (prev ? dedupeAppend(prev, comment) : prev)),
  })

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commentsUrl])

  useEffect(() => {
    if (connected) {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
      return undefined
    }
    // Not connected (socket still negotiating, or genuinely unavailable) —
    // poll so messages still arrive, just not instantly.
    pollRef.current = setInterval(load, 15000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, commentsUrl])

  useEffect(() => {
    // Guarded, not just optional-chained — jsdom (this project's test
    // environment) doesn't implement scrollIntoView at all, and this is
    // a pure convenience behavior with no test coverage of its own that
    // should never be able to crash the component in any environment.
    listEndRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [comments])

  async function load() {
    try {
      const { data } = await api.get(commentsUrl)
      setComments(data)
      setError('')
    } catch {
      setError('Could not load messages.')
    }
  }

  function handleAttachmentChange(e) {
    const file = e.target.files?.[0] || null
    setAttachmentError('')
    if (file) {
      const ext = `.${file.name.split('.').pop()?.toLowerCase()}`
      if (!ALLOWED_ATTACHMENT_EXTENSIONS.includes(ext)) {
        setAttachmentError(`Unsupported file type. Allowed: ${ALLOWED_ATTACHMENT_EXTENSIONS.join(', ')}`)
        e.target.value = ''
        return
      }
      if (file.size > 5 * 1024 * 1024) {
        setAttachmentError('File too large. Maximum size is 5MB.')
        e.target.value = ''
        return
      }
    }
    setAttachment(file)
  }

  async function handleSend(e) {
    e.preventDefault()
    if (!text.trim() && !attachment) return
    setSending(true)
    setError('')
    try {
      const formData = new FormData()
      formData.append('body_text', text)
      if (attachment) formData.append('attachment', attachment)
      const { data } = await api.post(commentsUrl, formData, { headers: { 'Content-Type': 'multipart/form-data' } })
      setComments((prev) => (prev ? dedupeAppend(prev, data) : [data]))
      setText('')
      setAttachment(null)
    } catch (err) {
      const body = err.response?.data
      setError(body?.error || body?.body_text?.[0] || 'Could not send message. Please try again.')
    } finally {
      setSending(false)
    }
  }

  if (comments === null) {
    return <p style={{ fontSize: '0.82rem', color: 'var(--text-tertiary)' }}>Loading messages…</p>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, padding: '4px 2px', minHeight: 120 }}>
        {comments.length === 0 && <p style={{ fontSize: '0.82rem', color: 'var(--text-tertiary)' }}>No messages yet.</p>}
        {comments.map((c) => {
          const isMe = c.author_type === viewerType
          return (
            <div key={c.id} style={{ alignSelf: isMe ? 'flex-end' : 'flex-start', maxWidth: '80%' }}>
              <p style={{ margin: '0 0 2px', fontSize: '0.7rem', color: 'var(--text-tertiary)', textAlign: isMe ? 'right' : 'left' }}>
                {c.author_name} · {new Date(c.created_at).toLocaleString()}
                {c.source === 'email_reply' && ' · via email'}
              </p>
              <div style={{
                padding: '8px 12px', borderRadius: 'var(--radius-md)',
                background: isMe ? 'var(--accent)' : 'var(--bg-surface-2)',
                color: isMe ? '#fff' : 'var(--text-primary)', fontSize: '0.85rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              }}>
                {c.body_text}
                {c.attachment_url && (
                  <div style={{ marginTop: 6 }}>
                    <a href={c.attachment_url} target="_blank" rel="noreferrer" style={{ color: 'inherit', textDecoration: 'underline', fontSize: '0.78rem' }}>
                      View attachment
                    </a>
                  </div>
                )}
              </div>
            </div>
          )
        })}
        <div ref={listEndRef} />
      </div>

      {error && <p className="fos-error" style={{ margin: '6px 0 0' }}>{error}</p>}
      {attachmentError && <p className="fos-error" style={{ margin: '6px 0 0' }}>{attachmentError}</p>}

      <form onSubmit={handleSend} style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'flex-end' }}>
        <textarea
          value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a message…"
          rows={2} className="fos-input" style={{ flex: 1, resize: 'none' }}
        />
        <label className="fos-btn fos-btn-ghost" style={{ cursor: 'pointer', padding: 8 }} title="Attach an image">
          <Paperclip size={14} />
          <input type="file" accept="image/*" hidden onChange={handleAttachmentChange} />
        </label>
        <button type="submit" disabled={sending || (!text.trim() && !attachment)} className="fos-btn fos-btn-primary" style={{ padding: 8 }} aria-label="Send message">
          {sending ? <span className="fos-spinner" /> : <Send size={14} />}
        </button>
      </form>
      {attachment && (
        <p style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', margin: '4px 0 0' }}>
          Attached: {attachment.name} <button type="button" onClick={() => setAttachment(null)} className="fos-btn fos-btn-ghost" style={{ padding: '0 4px', fontSize: '0.72rem' }}>Remove</button>
        </p>
      )}
    </div>
  )
}
