// src/components/AuthAlert.jsx
import { AlertCircle, CheckCircle2, AlertTriangle, Info } from 'lucide-react'
import { authTokens } from './AuthLayout'

const VARIANTS = {
  error: { color: authTokens.error, bg: 'rgba(242,116,139,0.1)', border: 'rgba(242,116,139,0.3)', Icon: AlertCircle },
  success: { color: authTokens.success, bg: 'rgba(95,208,138,0.1)', border: 'rgba(95,208,138,0.3)', Icon: CheckCircle2 },
  warning: { color: '#E6B450', bg: 'rgba(230,180,80,0.1)', border: 'rgba(230,180,80,0.3)', Icon: AlertTriangle },
  info: { color: '#6FA8FF', bg: 'rgba(111,168,255,0.1)', border: 'rgba(111,168,255,0.3)', Icon: Info },
}

export default function AuthAlert({ variant = 'error', children, style }) {
  const v = VARIANTS[variant] || VARIANTS.error
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        padding: '12px 14px',
        borderRadius: 10,
        background: v.bg,
        border: `1px solid ${v.border}`,
        color: v.color,
        fontSize: '0.85rem',
        lineHeight: 1.5,
        ...style,
      }}
    >
      <v.Icon size={16} style={{ flexShrink: 0, marginTop: 1 }} />
      <div>{children}</div>
    </div>
  )
}