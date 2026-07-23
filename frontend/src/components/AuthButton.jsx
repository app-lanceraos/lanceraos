// src/components/AuthButton.jsx
import { useState } from 'react'
import { authTokens } from './AuthLayout'

export default function AuthButton({ children, variant = 'primary', disabled, onClick, type = 'button' }) {
  const [hovered, setHovered] = useState(false)

  const base = {
    width: '100%',
    height: '2.5rem',
    borderRadius: 20,
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontFamily: "'DM Sans', sans-serif",
    fontSize: '0.875rem',
    fontWeight: 500,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.6rem',
    transition: 'opacity 0.15s ease, background 0.15s ease',
    opacity: disabled ? 0.6 : 1,
  }

  const variantStyle =
    variant === 'primary'
      ? {
          background: authTokens.primaryBg,
          color: authTokens.primaryText,
          border: 'none',
          opacity: disabled ? 0.6 : hovered ? 0.92 : 1,
        }
      : {
          background: hovered && !disabled ? 'rgba(168,156,242,0.06)' : 'transparent',
          color: '#DBDBDB',
          border: `1px solid ${authTokens.inputBorder}`,
        }

  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ ...base, ...variantStyle }}
    >
      {children}
    </button>
  )
}