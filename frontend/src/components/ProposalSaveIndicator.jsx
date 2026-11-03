// src/components/ProposalSaveIndicator.jsx
//
// The editor's save-state line. Autosave has no button to disable or relabel,
// so this is the only place a person learns whether their text is safe — it
// has to be honest: "Saved" only when nothing is pending, refused or failed.
// Text is always visible (never icon-only, never colour-only) and announced
// politely to screen readers.
import { AlertTriangle, CheckCircle2, Clock } from 'lucide-react'

function describe({ status, retrying, rateLimited, withheld, dirty }) {
  if (status === 'saving') return { tone: 'muted', spinner: true, text: 'Saving…' }
  if (rateLimited) return { tone: 'warn', Icon: Clock, text: 'Saving paused — too many saves in a short time. Your text is safe on this page; retrying shortly.', action: true }
  if (status === 'error' && retrying) return { tone: 'warn', spinner: true, text: "Couldn't save — retrying…" }
  if (status === 'error' && withheld.length === 0) return { tone: 'error', Icon: AlertTriangle, text: 'Not saved', action: true }
  if (withheld.length > 0) return { tone: 'error', Icon: AlertTriangle, text: 'Not saved — fix the highlighted fields' }
  if (status === 'pending' || dirty) return { tone: 'muted', Icon: Clock, text: 'Unsaved changes' }
  if (status === 'saved') return { tone: 'ok', Icon: CheckCircle2, text: 'Saved' }
  return null
}

const TONE_COLOR = {
  ok: 'var(--status-green-text)',
  warn: 'var(--status-amber-text)',
  error: 'var(--status-red-text)',
  muted: 'var(--text-tertiary)',
}

export default function ProposalSaveIndicator({ status, retrying, rateLimited, withheld, dirty, onRetry }) {
  const view = describe({ status, retrying, rateLimited, withheld, dirty })
  return (
    <div role="status" aria-live="polite" style={{ minHeight: 20, display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.78rem' }}>
      {view && (
        <>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: TONE_COLOR[view.tone] }}>
            {view.spinner ? <span className="fos-spinner" aria-hidden="true" /> : <view.Icon size={14} aria-hidden="true" style={{ flexShrink: 0 }} />}
            <span>{view.text}</span>
          </span>
          {view.action && (
            <button type="button" className="fos-btn fos-btn-ghost" style={{ padding: '3px 10px', fontSize: '0.74rem' }} onClick={onRetry}>
              Retry now
            </button>
          )}
        </>
      )}
    </div>
  )
}
