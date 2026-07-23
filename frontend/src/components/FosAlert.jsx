// src/components/FosAlert.jsx
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'

const ICONS = {
  success: CheckCircle2,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
}

export default function FosAlert({ type = 'info', children, onDismiss, style }) {
  const Icon = ICONS[type] || Info
  return (
    <div className={`fos-alert fos-alert-${type}`} style={{ justifyContent: 'space-between', ...style }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flex: 1 }}>
        <Icon size={16} style={{ flexShrink: 0, marginTop: 1 }} />
        <span style={{ flex: 1 }}>{children}</span>
      </div>
      {onDismiss && (
        <button
          onClick={onDismiss}
          aria-label="Dismiss"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', opacity: 0.55, padding: 0, flexShrink: 0, display: 'flex' }}
        >
          <X size={15} />
        </button>
      )}
    </div>
  )
}