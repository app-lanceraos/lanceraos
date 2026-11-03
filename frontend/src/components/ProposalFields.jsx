// src/components/ProposalFields.jsx
//
// The labelled text input / textarea the Proposals pages share. FormField.jsx
// is not reused because it cannot carry what a proposal form needs: an
// `inputMode` for decimal keypads (money is typed as TEXT, not type=number —
// a number input swallows "1." and "0.0" mid-typing and returns "" for them,
// which would corrupt a controlled value), a `min` for the date input, a
// character counter, and a multi-line variant. Same fos-* classes, same
// error/hint markup, so it looks like every other field in the app.
import { useId } from 'react'

function FieldShell({ id, label, required, error, hint, counter, children }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <label htmlFor={id} className="fos-label">
          {label}
          {required && <span className="required">*</span>}
        </label>
        {counter}
      </div>
      {children}
      {hint && !error && <p className="fos-hint">{hint}</p>}
      {error && <p className="fos-error" role="alert">{error}</p>}
    </div>
  )
}

export function ProposalCounter({ count, max, min }) {
  const over = count > max
  const under = min !== undefined && count > 0 && count < min
  return (
    <span
      style={{
        fontSize: '0.7rem', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
        color: over ? 'var(--status-red-text)' : under ? 'var(--status-amber-text)' : 'var(--text-tertiary)',
      }}
    >
      {count.toLocaleString('en')} / {max.toLocaleString('en')}
    </span>
  )
}

export function ProposalTextField({
  label, value, onChange, type = 'text', inputMode, placeholder, disabled = false, error, hint, required = false,
  min, counter, autoComplete, style,
}) {
  const id = useId()
  return (
    <FieldShell id={id} label={label} required={required} error={error} hint={hint} counter={counter}>
      <input
        id={id} type={type} inputMode={inputMode} value={value ?? ''} min={min}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder} disabled={disabled} autoComplete={autoComplete}
        className={`fos-input${error ? ' error' : ''}`}
        aria-invalid={error ? true : undefined}
        style={style}
      />
    </FieldShell>
  )
}

export function ProposalTextArea({
  label, value, onChange, rows = 4, placeholder, disabled = false, error, hint, required = false, counter, minHeight,
}) {
  const id = useId()
  return (
    <FieldShell id={id} label={label} required={required} error={error} hint={hint} counter={counter}>
      <textarea
        id={id} value={value ?? ''} rows={rows}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder} disabled={disabled}
        className={`fos-input${error ? ' error' : ''}`}
        aria-invalid={error ? true : undefined}
        style={{ resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.55, whiteSpace: 'pre-wrap', minHeight }}
      />
    </FieldShell>
  )
}
