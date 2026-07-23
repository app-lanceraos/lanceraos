// src/components/AuthSelect.jsx
import { useState } from 'react'
import { authTokens } from './AuthLayout'

const CHEVRON_SVG =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8' fill='none'%3E%3Cpath d='M1 1.5L6 6.5L11 1.5' stroke='%238074C0' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\")"

export default function AuthSelect({ value, onChange, options, placeholder, error }) {
  const [focused, setFocused] = useState(false)
  const borderColor = error ? authTokens.error : focused ? authTokens.focus : authTokens.inputBorder

  return (
    <select
      value={value}
      onChange={onChange}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={{
        width: '100%',
        height: '3.1rem',
        backgroundColor: authTokens.inputBg,
        border: `1px solid ${borderColor}`,
        borderRadius: 10,
        padding: '0 2.2rem 0 0.9rem',
        fontFamily: "'DM Sans', sans-serif",
        fontSize: '0.875rem',
        fontWeight: 500,
        color: '#FFFFFF',
        outline: 'none',
        cursor: 'pointer',
        appearance: 'none',
        WebkitAppearance: 'none',
        MozAppearance: 'none',
        backgroundImage: CHEVRON_SVG,
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'right 0.9rem center',
        transition: 'border-color 0.2s ease',
      }}
    >
      <option value="" style={{ background: '#181430' }}>{placeholder}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value} style={{ background: '#181430' }}>
          {o.label}
        </option>
      ))}
    </select>
  )
}