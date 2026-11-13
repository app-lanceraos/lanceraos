// src/components/HelpRating.jsx
//
// "Was this answer helpful?" under a real written answer. Two ghost buttons, each with an icon AND a visible word. After a
// success the buttons are replaced by one thank-you line inside a polite live region (the region is always mounted, so the
// change is announced); after a failure the sentence is shown and the buttons come back so the person can press again.
import { ThumbsDown, ThumbsUp } from 'lucide-react'

import FosAlert from '@/components/FosAlert'
import { RATING_NO, RATING_PROMPT, RATING_THANKS, RATING_YES } from '@/pages/helpHelpers'

export default function HelpRating({ status, message, onRate }) {
  const sending = status === 'sending'
  return (
    <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border-subtle)' }}>
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        {status !== 'done' && (
          <>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{RATING_PROMPT}</span>
            <button type="button" className="fos-btn fos-btn-ghost" disabled={sending} onClick={() => onRate(true)} style={{ minHeight: 40, padding: '8px 14px' }}>
              <ThumbsUp size={15} aria-hidden="true" />
              {RATING_YES}
            </button>
            <button type="button" className="fos-btn fos-btn-ghost" disabled={sending} onClick={() => onRate(false)} style={{ minHeight: 40, padding: '8px 14px' }}>
              <ThumbsDown size={15} aria-hidden="true" />
              {RATING_NO}
            </button>
          </>
        )}
        <div role="status" style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{status === 'done' ? RATING_THANKS : ''}</div>
      </div>
      {status === 'failed' && message && (
        <div role="alert" style={{ marginTop: 10 }}>
          <FosAlert type="error">{message}</FosAlert>
        </div>
      )}
    </div>
  )
}
