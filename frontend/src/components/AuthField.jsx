// src/components/AuthField.jsx
import { useId, useState } from 'react'
import { authTokens } from './AuthLayout'

/**
 * Shared floating-label input for every auth page. Deliberately does NOT
 * rely on CSS's `:not(:placeholder-shown)` trick (which is how v1 did
 * this, via a large per-page <style> block) — DESIGN.md prohibits
 * per-page <style> blocks for anything but @keyframes/@media, and we
 * already know whether the field has a value via React state, so the
 * float condition is just `focused || value.length > 0`.
 */
export default function AuthField({
  label,
  type = 'text',
  value,
  onChange,
  autoComplete,
  disabled = false,
  icon: Icon,
  rightElement,
  error,
}) {
  const id = useId()
  const [focused, setFocused] = useState(false)
  const floated = focused || String(value ?? '').length > 0
  const borderColor = error ? authTokens.error : focused ? authTokens.focus : authTokens.inputBorder

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ position: 'relative' }}>
        {Icon && (
          <span
            style={{
              position: 'absolute',
              left: '1rem',
              top: '50%',
              transform: 'translateY(-50%)',
              color: authTokens.placeholder,
              pointerEvents: 'none',
              display: 'flex',
              zIndex: 2,
            }}
            aria-hidden="true"
          >
            <Icon size={18} />
          </span>
        )}

        <input
          id={id}
          type={type}
          value={value}
          onChange={onChange}
          autoComplete={autoComplete}
          disabled={disabled}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            width: '100%',
            height: '3.1rem',
            background: authTokens.inputBg,
            border: `1px solid ${borderColor}`,
            borderRadius: 10,
            padding: Icon ? '0 1rem 0 2.85rem' : '0 1rem',
            paddingRight: rightElement ? '2.85rem' : undefined,
            fontFamily: "'DM Sans', sans-serif",
            fontSize: '0.875rem',
            lineHeight: '1.15rem',
            color: '#FFFFFF',
            outline: 'none',
            transition: 'border-color 0.2s ease',
          }}
        />

        <label
          htmlFor={id}
          style={{
            position: 'absolute',
            left: floated ? '0.75rem' : Icon ? '2.85rem' : '1rem',
            top: floated ? 0 : '50%',
            transform: 'translateY(-50%)',
            fontSize: floated ? '0.75rem' : '0.875rem',
            lineHeight: '1.15rem',
            color: authTokens.placeholder,
            pointerEvents: 'none',
            transition: 'top 0.18s ease, font-size 0.18s ease, left 0.18s ease',
            zIndex: 2,
            background: floated ? authTokens.inputBg : 'transparent',
            padding: floated ? '0 4px' : 0,
          }}
        >
          {label}
        </label>

        {rightElement && (
          <div
            style={{
              position: 'absolute',
              right: '0.9rem',
              top: '50%',
              transform: 'translateY(-50%)',
              zIndex: 3,
              display: 'flex',
            }}
          >
            {rightElement}
          </div>
        )}
      </div>

      {error && (
        <p style={{ marginTop: 6, fontSize: '0.78rem', color: authTokens.error }}>{error}</p>
      )}
    </div>
  )
}