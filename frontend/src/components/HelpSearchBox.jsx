// src/components/HelpSearchBox.jsx
//
// The one box on the Help page. Two modes (decision H24): "search" filters the guides as the person types (no button, no
// disclosure; nothing typed here is ever sent to the ask endpoint) and "ask" is an explicit submit with the AI disclosure shown
// as always-visible text. THIS component is the single owner of what each mode shows and does: the page passes the disclosure
// text always, and a "search" box neither renders it nor ever calls onSubmit.
// The form's submit ALWAYS calls preventDefault (a bare submit would reload the page). The input is 16px so iOS does not zoom on
// focus, the clear button is 44x40 and Ask at least 46px tall, and the row wraps to fit 375px.
import { Search, Send, X } from 'lucide-react'
import { useId } from 'react'

import { visuallyHidden } from '@/pages/dashboardHelpers'
import {
  ASK_BUTTON, ASK_BUTTON_BUSY, ASK_LABEL, ASK_PLACEHOLDER, CLEAR_LABEL, QUESTION_MAX_CHARS, SEARCH_LABEL, SEARCH_MAX_CHARS, SEARCH_PLACEHOLDER,
} from '@/pages/helpHelpers'

export default function HelpSearchBox({ mode, value, onChange, onSubmit, onClear, busy = false, canSubmit = false, hint = '', disclosure = '' }) {
  const ask = mode === 'ask'
  const inputId = useId()
  const hintId = `${inputId}-hint`
  const disclosureId = `${inputId}-disclosure`
  const describedBy = [hint && hintId, ask && disclosure && disclosureId].filter(Boolean).join(' ') || undefined

  const handleSubmit = (event) => {
    event.preventDefault()
    if (ask && canSubmit && !busy) onSubmit()
  }

  return (
    <form
      onSubmit={handleSubmit} role={ask ? undefined : 'search'} noValidate
      style={{ marginBottom: 16 }}
    >
      <label htmlFor={inputId} style={visuallyHidden}>{ask ? ASK_LABEL : SEARCH_LABEL}</label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ position: 'relative', flex: '1 1 220px', minWidth: 0 }}>
          <Search size={18} aria-hidden="true" style={{ position: 'absolute', left: 14, top: 14, color: 'var(--text-tertiary)', pointerEvents: 'none' }} />
          <input
            id={inputId} type="text" className="fos-input" value={value}
            onChange={(event) => onChange(event.target.value)}
            maxLength={ask ? QUESTION_MAX_CHARS : SEARCH_MAX_CHARS}
            placeholder={ask ? ASK_PLACEHOLDER : SEARCH_PLACEHOLDER}
            enterKeyHint={ask ? 'send' : 'search'} autoComplete="off" aria-describedby={describedBy}
            style={{ minHeight: 46, fontSize: '1rem', paddingLeft: 42, paddingRight: value ? 48 : 14 }}
          />
          {value && (
            <button
              type="button" onClick={onClear} aria-label={CLEAR_LABEL}
              style={{
                position: 'absolute', right: 3, top: 3, width: 44, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'transparent', border: 'none', borderRadius: 'var(--radius-md)', color: 'var(--text-secondary)', cursor: 'pointer',
              }}
            >
              <X size={18} aria-hidden="true" />
            </button>
          )}
        </div>
        {ask && (
          <button type="submit" className="fos-btn fos-btn-primary" disabled={busy || !canSubmit} style={{ minHeight: 46, minWidth: 96 }}>
            <Send size={16} aria-hidden="true" />
            {busy ? ASK_BUTTON_BUSY : ASK_BUTTON}
          </button>
        )}
      </div>
      {hint && <p id={hintId} style={{ margin: '8px 2px 0', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{hint}</p>}
      {ask && disclosure && <p id={disclosureId} style={{ margin: '6px 2px 0', fontSize: '0.8rem', color: 'var(--text-secondary)', overflowWrap: 'anywhere' }}>{disclosure}</p>}
    </form>
  )
}
