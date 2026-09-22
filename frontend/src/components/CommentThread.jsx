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
import { Check, CheckCheck, File, Paperclip, Send, X } from 'lucide-react'

import api from '@/lib/api'
import useWebSocket from '@/hooks/useWebSocket'

// Images render an inline thumbnail; PDFs render a document icon — both
// open the same click-to-view modal instead of navigating to the raw
// Cloudinary URL (item 9 of the verification pass). Matches
// apps/invoices/comments.py's own ALLOWED_ATTACHMENT_EXTENSIONS exactly
// (images + .pdf, same real server-side content validation on that end).
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tiff']
const ALLOWED_ATTACHMENT_EXTENSIONS = [...IMAGE_EXTENSIONS, '.pdf']

// This component is shared between InvoiceDetailPanel.jsx (the
// freelancer-authenticated app, inside AppShell, theme-responsive by
// design) and ClientPortal.jsx (the public client portal, which
// DESIGN.md Section 10 requires to use ONE fixed light palette,
// never theme.css's var(--*) tokens). Added 22 September 2026, closing
// a real, confirmed Section 10 violation: this component previously had
// no palette variant at all and rendered with theme tokens unconditionally,
// so a client viewing their portal saw colors that silently followed the
// FREELANCER's own light/dark dashboard preference (and broke outright in
// dark mode — near-white message text on a white bubble). See
// DECISIONS.md's 22 September 2026 entry.
//
// `palette` prop: omitted/anything else = unchanged prior behavior
// (var(--*) tokens, for the authenticated app). `palette="public"` = the
// fixed Section 10 palette, matching InvoiceView.jsx/PaymentDetails.jsx.
const THEME_COLORS = {
  textTertiary: 'var(--text-tertiary)',
  textPrimary: 'var(--text-primary)',
  accent: 'var(--accent)',
  bubbleOther: 'var(--bg-surface-2)',
  bubbleRadius: 'var(--radius-md)',
  attachmentRadius: 'var(--radius-sm)',
  attachmentBorder: 'var(--border-subtle)',
  attachmentBg: 'var(--bg-surface)',
  errorText: 'var(--error-text)',
}
const PUBLIC_COLORS = {
  textTertiary: '#64748b',
  textPrimary: '#334155',
  accent: '#00c896',
  bubbleOther: '#f8fafc',
  bubbleRadius: '10px',
  attachmentRadius: '6px',
  attachmentBorder: 'rgba(0,0,0,.08)',
  attachmentBg: '#ffffff',
  errorText: '#c0392b',
}
const PUBLIC_INPUT_STYLE = {
  width: '100%', boxSizing: 'border-box', background: '#ffffff', border: '1.5px solid rgba(0,0,0,.15)',
  borderRadius: 8, padding: '10px 14px', fontFamily: "'DM Sans', sans-serif", fontSize: '0.9rem',
  color: '#334155', outline: 'none', resize: 'none',
}
const PUBLIC_BTN_STYLE = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
  fontFamily: "'DM Sans', sans-serif", fontSize: '0.88rem', fontWeight: 600, cursor: 'pointer',
}
const PUBLIC_BTN_GHOST_STYLE = { ...PUBLIC_BTN_STYLE, border: '1.5px solid rgba(0,0,0,.15)', background: 'transparent', color: '#334155' }
const PUBLIC_BTN_PRIMARY_STYLE = { ...PUBLIC_BTN_STYLE, border: 'none', background: '#1e3a5f', color: '#ffffff' }

function isImageUrl(url) {
  const lower = url.toLowerCase().split('?')[0]
  return IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

function dedupeAppend(prev, comment) {
  if (prev.some((c) => c.id === comment.id)) return prev
  return [...prev, comment]
}

// A comment payload (broadcast_comment / ClientThreadConsumer.comment_message)
// has no `event` key at all; a read-state update
// (broadcast_read_state / ClientThreadConsumer.read_state_update) always
// does — that's the whole discriminator, deliberately not a version bump
// to the existing, tested comment wire format (item 3 of the 16 August
// 2026 second verification pass).
function applyReadState(prev, update) {
  const idSet = new Set(update.ids)
  return prev.map((c) => (idSet.has(c.id) ? { ...c, [update.field]: update.at } : c))
}

// commentsUrl: the real GET/POST endpoint for this side
//   (/invoices/{id}/comments/ or /invoices/portal/{id}/comments/).
// viewToken: the invoice's view_token — the WS route's real identifier
//   (see DECISIONS.md for why the route uses this, not the invoice pk).
// viewerType: 'freelancer' | 'client' — decides which author_type
//   renders right-aligned as "me".
// palette: 'public' for the client portal's fixed Section 10 palette;
//   omitted for the authenticated app's theme.css tokens (unchanged).
export default function CommentThread({ commentsUrl, viewToken, viewerType, palette }) {
  const c = palette === 'public' ? PUBLIC_COLORS : THEME_COLORS
  const isPublic = palette === 'public'
  const [comments, setComments] = useState(null)
  const [error, setError] = useState('')
  const [text, setText] = useState('')
  const [attachment, setAttachment] = useState(null)
  const [attachmentError, setAttachmentError] = useState('')
  const [sending, setSending] = useState(false)
  const [previewUrl, setPreviewUrl] = useState(null)
  const pollRef = useRef(null)
  const listEndRef = useRef(null)

  const { connected } = useWebSocket(viewToken ? `/ws/invoices/thread/${viewToken}/` : null, {
    onMessage: (message) => setComments((prev) => {
      if (!prev) return prev
      return message.event === 'read_state' ? applyReadState(prev, message) : dedupeAppend(prev, message)
    }),
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
    return <p style={{ fontSize: '0.82rem', color: c.textTertiary }}>Loading messages…</p>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, padding: '4px 2px', minHeight: 120 }}>
        {comments.length === 0 && <p style={{ fontSize: '0.82rem', color: c.textTertiary }}>No messages yet.</p>}
        {comments.map((comment) => {
          const isMe = comment.author_type === viewerType
          // Seen indicator (item 9 of the verification pass) — only shown
          // on MY OWN messages, same convention as any real chat app: you
          // don't see read-receipts on the other person's messages, only
          // whether THEY saw yours. Whichever side didn't author this
          // comment is the one whose read timestamp matters.
          const seenAt = isMe ? (viewerType === 'freelancer' ? comment.read_by_client_at : comment.read_by_freelancer_at) : null
          return (
            <div key={comment.id} style={{ alignSelf: isMe ? 'flex-end' : 'flex-start', maxWidth: '80%' }}>
              <p style={{ margin: '0 0 2px', fontSize: '0.7rem', color: c.textTertiary, textAlign: isMe ? 'right' : 'left' }}>
                {comment.author_name} · {new Date(comment.created_at).toLocaleString()}
                {comment.source === 'email_reply' && ' · via email'}
              </p>
              <div style={{
                padding: '8px 12px', borderRadius: c.bubbleRadius,
                background: isMe ? c.accent : c.bubbleOther,
                color: isMe ? '#fff' : c.textPrimary, fontSize: '0.85rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              }}>
                {comment.body_text}
                {comment.attachment_url && (
                  <AttachmentPreview url={comment.attachment_url} isMe={isMe} onOpen={() => setPreviewUrl(comment.attachment_url)} colors={c} />
                )}
              </div>
              {isMe && (
                <p style={{ margin: '2px 2px 0', fontSize: '0.68rem', color: c.textTertiary, textAlign: 'right', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 3 }}>
                  {seenAt ? (
                    <><CheckCheck size={12} style={{ color: c.accent }} /> Seen</>
                  ) : (
                    <><Check size={12} /> Sent</>
                  )}
                </p>
              )}
            </div>
          )
        })}
        <div ref={listEndRef} />
      </div>

      {previewUrl && <AttachmentModal url={previewUrl} onClose={() => setPreviewUrl(null)} colors={c} />}

      {error && <p style={{ margin: '6px 0 0', display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.78rem', color: c.errorText }}>{error}</p>}
      {attachmentError && <p style={{ margin: '6px 0 0', display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.78rem', color: c.errorText }}>{attachmentError}</p>}

      <form onSubmit={handleSend} style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'flex-end' }}>
        <textarea
          value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a message…"
          rows={2}
          className={isPublic ? undefined : 'fos-input'}
          style={isPublic ? { ...PUBLIC_INPUT_STYLE, flex: 1 } : { flex: 1, resize: 'none' }}
        />
        <label
          className={isPublic ? undefined : 'fos-btn fos-btn-ghost'}
          style={isPublic ? { ...PUBLIC_BTN_GHOST_STYLE, padding: 8 } : { cursor: 'pointer', padding: 8 }}
          title="Attach an image or PDF"
        >
          <Paperclip size={14} />
          <input type="file" accept="image/*,application/pdf" hidden onChange={handleAttachmentChange} />
        </label>
        <button
          type="submit" disabled={sending || (!text.trim() && !attachment)}
          className={isPublic ? undefined : 'fos-btn fos-btn-primary'}
          style={isPublic ? { ...PUBLIC_BTN_PRIMARY_STYLE, padding: 8, opacity: (sending || (!text.trim() && !attachment)) ? 0.5 : 1 } : { padding: 8 }}
          aria-label="Send message"
        >
          {sending ? <span className="fos-spinner" /> : <Send size={14} />}
        </button>
      </form>
      {attachment && (
        <p style={{ fontSize: '0.72rem', color: c.textTertiary, margin: '4px 0 0' }}>
          Attached: {attachment.name} <button
            type="button" onClick={() => setAttachment(null)}
            className={isPublic ? undefined : 'fos-btn fos-btn-ghost'}
            style={isPublic ? { ...PUBLIC_BTN_GHOST_STYLE, padding: '0 4px', fontSize: '0.72rem' } : { padding: '0 4px', fontSize: '0.72rem' }}
          >
            Remove
          </button>
        </p>
      )}
    </div>
  )
}

// ── AttachmentPreview — inline in the thread ────────────────────────
// An image gets a real thumbnail; a PDF gets a document icon + filename.
// Both are click-to-view (onOpen), never a plain navigating link to the
// raw Cloudinary URL. `colors` is the caller's resolved THEME_COLORS/
// PUBLIC_COLORS map (see CommentThread's own palette prop).
function AttachmentPreview({ url, isMe, onOpen, colors }) {
  const filename = decodeURIComponent(url.split('/').pop() || 'attachment')
  if (isImageUrl(url)) {
    return (
      <div style={{ marginTop: 6 }}>
        <button
          type="button" onClick={onOpen}
          style={{ display: 'block', padding: 0, border: 'none', background: 'none', cursor: 'pointer' }}
          aria-label="View image attachment"
        >
          <img src={url} alt="" style={{ maxWidth: 160, maxHeight: 160, borderRadius: colors.attachmentRadius, display: 'block' }} />
        </button>
      </div>
    )
  }
  return (
    <div style={{ marginTop: 6 }}>
      <button
        type="button" onClick={onOpen}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: colors.attachmentRadius,
          border: `1px solid ${isMe ? 'rgba(255,255,255,0.35)' : colors.attachmentBorder}`,
          background: isMe ? 'rgba(255,255,255,0.12)' : colors.attachmentBg,
          color: 'inherit', cursor: 'pointer', fontSize: '0.76rem', maxWidth: '100%',
        }}
      >
        <File size={14} style={{ flexShrink: 0 }} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{filename}</span>
      </button>
    </div>
  )
}

// ── AttachmentModal — click-to-view ─────────────────────────────────
function AttachmentModal({ url, onClose, colors }) {
  const isImage = isImageUrl(url)
  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{ position: 'relative', maxWidth: '90vw', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        <button
          onClick={onClose} aria-label="Close"
          style={{ position: 'absolute', top: -34, right: 0, background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: 6 }}
        >
          <X size={20} />
        </button>
        {isImage ? (
          <img src={url} alt="" style={{ maxWidth: '90vw', maxHeight: '80vh', borderRadius: colors.bubbleRadius, objectFit: 'contain' }} />
        ) : (
          <iframe src={url} title="Attachment preview" style={{ width: '80vw', height: '80vh', border: 'none', borderRadius: colors.bubbleRadius, background: '#fff' }} />
        )}
      </div>
    </div>
  )
}
