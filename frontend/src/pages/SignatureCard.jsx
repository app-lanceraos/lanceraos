// src/pages/SignatureCard.jsx
import { useEffect, useRef, useState } from 'react'
import SignaturePad from 'signature_pad'
import { Check, PenLine, RotateCcw, Upload, X } from 'lucide-react'

import api from '@/lib/api'
import { invalidateProfileAssetsCache } from '@/hooks/useProfileAssets'
import Card from '@/components/Card'
import FosAlert from '@/components/FosAlert'
import useTimedMessage from '@/hooks/useTimedMessage'

// Matches apps/invoices/views.py's signature_upload exactly (ALLOWED_LOGO_EXTENSIONS
// / MAX_LOGO_SIZE_BYTES, shared with logo uploads and comment attachments — see
// that view's own docstring) — same "catch it here, backend stays the real
// authority" convention Profile.jsx's own logo picker already established.
const ALLOWED_SIGNATURE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'tiff', 'svg'])
const MAX_SIGNATURE_SIZE_BYTES = 10 * 1024 * 1024

function extOf(filename) {
  return (filename.split('.').pop() || '').toLowerCase()
}

function dataUriToFile(dataUri, filename) {
  const [header, base64 = ''] = dataUri.split(',')
  const mimeMatch = /data:([^;]+);base64/.exec(header)
  const mime = mimeMatch ? mimeMatch[1] : 'image/png'
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return new File([bytes], filename, { type: mime })
}

// The same slider+numeric-input pairing convention the design editor's own
// PropertiesPanel.jsx (SliderRow) already established — drag-preview locally,
// commit (and here, re-request the live preview) only on release/blur, so
// dragging the thumb doesn't fire a network call on every intermediate pixel.
function ThresholdSlider({ value, onCommit, disabled }) {
  const [dragValue, setDragValue] = useState(value)
  useEffect(() => setDragValue(value), [value])

  const commit = (v) => {
    if (!Number.isNaN(v) && v !== value) onCommit(v)
  }

  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 500 }}>Threshold</span>
        <span style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>Auto-detected — adjust if the result isn't clean</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <input
          type="range"
          min={0}
          max={255}
          step={1}
          value={dragValue}
          disabled={disabled}
          onChange={(e) => setDragValue(Number(e.target.value))}
          onMouseUp={(e) => commit(Number(e.target.value))}
          onTouchEnd={(e) => commit(Number(e.target.value))}
          onKeyUp={(e) => commit(Number(e.target.value))}
          style={{ flex: 1, accentColor: 'var(--accent)' }}
        />
        <input
          type="number"
          min={0}
          max={255}
          value={dragValue}
          disabled={disabled}
          onChange={(e) => setDragValue(Number(e.target.value))}
          onBlur={(e) => commit(Number(e.target.value))}
          style={{
            width: 60, padding: '6px 8px', borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border-subtle)', background: 'var(--bg-surface-2)',
            color: 'var(--text-primary)', fontSize: '0.8rem',
          }}
        />
      </div>
    </div>
  )
}

// Draw-mode canvas — signature_pad handles the actual smoothing (velocity-
// based variable stroke width + Bézier curve fitting); this component's own
// job is just DPI-correct sizing and exposing clear()/exportPng() up to the
// parent, matching the project's "reuse an existing well-known library
// rather than hand-roll a canvas drawing surface" instruction.
function DrawPad({ onReady, disabled }) {
  const canvasRef = useRef(null)
  const padRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined

    const resize = () => {
      const ratio = Math.max(window.devicePixelRatio || 1, 1)
      const { offsetWidth, offsetHeight } = canvas
      canvas.width = offsetWidth * ratio
      canvas.height = offsetHeight * ratio
      canvas.getContext('2d').scale(ratio, ratio)
      padRef.current?.clear()
    }

    resize()
    padRef.current = new SignaturePad(canvas, {
      backgroundColor: 'rgba(0,0,0,0)', // transparent — the backend's 'drawn'
      // path skips background removal entirely and expects an already-clean
      // transparent PNG, per signature_upload's own docstring.
      penColor: 'rgb(20, 20, 20)',
      minWidth: 0.6,
      maxWidth: 2.6,
    })
    onReady({
      clear: () => padRef.current.clear(),
      isEmpty: () => padRef.current.isEmpty(),
      toDataURL: () => padRef.current.toDataURL('image/png'),
    })

    window.addEventListener('resize', resize)
    return () => {
      window.removeEventListener('resize', resize)
      padRef.current?.off()
    }
  }, [onReady])

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: '100%', height: 160, borderRadius: 'var(--radius-md)',
        border: '1.5px dashed var(--border-subtle)', background: 'var(--bg-surface-2)',
        touchAction: 'none', cursor: disabled ? 'not-allowed' : 'crosshair',
        opacity: disabled ? 0.6 : 1,
      }}
    />
  )
}

export default function SignatureCard({ initialSignatureUrl }) {
  const [signatureUrl, setSignatureUrl] = useState(initialSignatureUrl || '')
  const [method, setMethod] = useState('upload') // 'upload' | 'draw'
  const [pendingFile, setPendingFile] = useState(null) // File/Blob sent to the backend
  const [threshold, setThreshold] = useState(null) // upload-path only; null = let the backend auto-detect (Otsu)
  const [previewUri, setPreviewUri] = useState('')
  const [previewSource, setPreviewSource] = useState(null) // 'upload' | 'drawn' — whichever produced previewUri
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [committing, setCommitting] = useState(false)
  const { message, show, clear } = useTimedMessage()
  const fileInputRef = useRef(null)
  const padApiRef = useRef(null)

  useEffect(() => { setSignatureUrl(initialSignatureUrl || '') }, [initialSignatureUrl])

  const resetPreview = () => {
    setPreviewUri('')
    setPreviewSource(null)
    setPendingFile(null)
    setThreshold(null)
  }

  const requestPreview = async (file, source, thresholdOverride) => {
    setLoadingPreview(true)
    clear()
    try {
      const formData = new FormData()
      formData.append('image', file, source === 'drawn' ? 'signature.png' : file.name)
      formData.append('source', source)
      if (source === 'upload' && thresholdOverride != null) {
        formData.append('threshold', String(thresholdOverride))
      }
      const res = await api.post('/invoices/signature/', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setPreviewUri(res.data.preview_data_uri)
      setPreviewSource(source)
    } catch (err) {
      show('error', err.response?.data?.error || 'Could not process that signature.')
      setPreviewUri('')
      setPreviewSource(null)
    } finally {
      setLoadingPreview(false)
    }
  }

  const handleFileSelect = (e) => {
    const file = e.target.files[0]
    e.target.value = ''
    if (!file) return
    const ext = extOf(file.name)
    if (!ALLOWED_SIGNATURE_EXTENSIONS.has(ext)) {
      show('error', `".${ext}" isn't a supported image type.`)
      return
    }
    if (file.size > MAX_SIGNATURE_SIZE_BYTES) {
      show('error', 'Image must be under 10MB.')
      return
    }
    setThreshold(null)
    setPendingFile(file)
    requestPreview(file, 'upload', null)
  }

  const handleDrawPreview = () => {
    if (!padApiRef.current || padApiRef.current.isEmpty()) {
      show('error', 'Draw your signature first.')
      return
    }
    const dataUri = padApiRef.current.toDataURL()
    const file = dataUriToFile(dataUri, 'signature.png')
    setPendingFile(file)
    requestPreview(file, 'drawn')
  }

  const handleThresholdChange = (v) => {
    setThreshold(v)
    if (pendingFile) requestPreview(pendingFile, 'upload', v)
  }

  const handleAccept = async () => {
    if (!pendingFile) return
    setCommitting(true)
    clear()
    try {
      const formData = new FormData()
      formData.append('image', pendingFile, previewSource === 'drawn' ? 'signature.png' : pendingFile.name)
      formData.append('source', previewSource)
      formData.append('commit', 'true')
      if (previewSource === 'upload' && threshold != null) {
        formData.append('threshold', String(threshold))
      }
      const res = await api.post('/invoices/signature/', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setSignatureUrl(res.data.signature_url)
      invalidateProfileAssetsCache() // so the design editor canvas picks up the new asset without a full reload
      resetPreview()
      padApiRef.current?.clear()
      show('success', 'Signature saved.')
    } catch (err) {
      show('error', err.response?.data?.error || 'Could not save your signature.')
    } finally {
      setCommitting(false)
    }
  }

  const handleDiscard = () => {
    resetPreview()
    padApiRef.current?.clear()
  }

  const switchMethod = (next) => {
    if (next === method) return
    setMethod(next)
    resetPreview()
  }

  const busy = loadingPreview || committing

  return (
    <Card
      title="Digital Signature"
      subtitle="Upload a photo of your signature, or draw one — appears on invoices and PDFs when you place it in a template."
    >
      {message && (
        <div style={{ marginBottom: 14 }}>
          <FosAlert type={message.type} onDismiss={clear}>{message.text}</FosAlert>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
        <div
          style={{
            width: 120, height: 60, borderRadius: 'var(--radius-md)', flexShrink: 0,
            background: 'var(--bg-surface-2)', border: '1px solid var(--border-subtle)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
          }}
        >
          {signatureUrl ? (
            <img src={signatureUrl} alt="Your signature" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
          ) : (
            <PenLine size={20} color="var(--text-tertiary)" />
          )}
        </div>
        <div>
          <p style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>
            {signatureUrl ? 'Current signature' : 'No signature saved yet'}
          </p>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', marginTop: 2 }}>
            Uploading or drawing a new one replaces this.
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border-subtle)', marginBottom: 16 }}>
        {[['upload', 'Upload', Upload], ['draw', 'Draw', PenLine]].map(([id, label, Icon]) => (
          <button
            key={id}
            onClick={() => switchMethod(id)}
            disabled={busy}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px',
              background: 'none', border: 'none', cursor: busy ? 'not-allowed' : 'pointer',
              borderBottom: method === id ? '2px solid var(--accent)' : '2px solid transparent',
              color: method === id ? 'var(--text-primary)' : 'var(--text-tertiary)',
              fontWeight: method === id ? 600 : 500, fontSize: '0.82rem',
              fontFamily: "'DM Sans', sans-serif",
            }}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      {!previewUri && method === 'upload' && (
        <div>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
            className="fos-btn fos-btn-ghost"
          >
            <Upload size={15} /> Choose an image
          </button>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginTop: 8 }}>
            JPG, PNG, WEBP, GIF, BMP, TIFF, or SVG. Max 10MB. A photo on a plain background works best —
            we'll remove the background automatically.
          </p>
          <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileSelect} style={{ display: 'none' }} />
        </div>
      )}

      {!previewUri && method === 'draw' && (
        <div>
          <DrawPad onReady={(api_) => { padApiRef.current = api_ }} disabled={busy} />
          <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
            <button onClick={() => padApiRef.current?.clear()} disabled={busy} className="fos-btn fos-btn-ghost">
              <RotateCcw size={14} /> Clear
            </button>
            <button onClick={handleDrawPreview} disabled={busy} className="fos-btn fos-btn-accent">
              {loadingPreview ? <><span className="fos-spinner" /> Processing…</> : 'Preview'}
            </button>
          </div>
        </div>
      )}

      {loadingPreview && !previewUri && (
        <p style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', marginTop: 10 }}>Processing…</p>
      )}

      {previewUri && (
        <div>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 500, marginBottom: 8 }}>Preview</p>
          <div
            style={{
              width: '100%', minHeight: 120, borderRadius: 'var(--radius-md)',
              background: 'repeating-conic-gradient(var(--bg-surface-3) 0% 25%, var(--bg-surface-2) 0% 50%) 0 0/16px 16px',
              border: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
            }}
          >
            <img src={previewUri} alt="Signature preview" style={{ maxWidth: '100%', maxHeight: 160, objectFit: 'contain', opacity: loadingPreview ? 0.5 : 1 }} />
          </div>

          {/* Threshold override — upload path only. Nothing to threshold on
              an already-clean drawn PNG, per signature_upload's own docstring. */}
          {previewSource === 'upload' && (
            <ThresholdSlider value={threshold ?? 128} onCommit={handleThresholdChange} disabled={busy} />
          )}

          <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            <button onClick={handleDiscard} disabled={busy} className="fos-btn fos-btn-ghost">
              <X size={14} /> Discard
            </button>
            <button onClick={handleAccept} disabled={busy} className="fos-btn fos-btn-accent">
              {committing ? <><span className="fos-spinner" /> Saving…</> : <><Check size={14} /> Accept & Save</>}
            </button>
          </div>
        </div>
      )}
    </Card>
  )
}
