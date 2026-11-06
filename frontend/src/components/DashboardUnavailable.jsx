// src/components/DashboardUnavailable.jsx
//
// What one Dashboard section shows when the server reported {"available": false} for it (that section's builder
// raised; every other section still arrived). Reload refetches the whole summary.
import { AlertCircle, RefreshCw } from 'lucide-react'

export default function DashboardUnavailable({ onReload, compact = false }) {
  return (
    <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: compact ? 0 : '8px 0', color: 'var(--text-secondary)' }}>
      <AlertCircle size={16} aria-hidden="true" style={{ color: 'var(--status-amber-text)', flexShrink: 0 }} />
      <span style={{ fontSize: '0.84rem' }}>Couldn&apos;t load this section.</span>
      <button type="button" className="fos-btn fos-btn-ghost" style={{ fontSize: '0.78rem', padding: '5px 10px' }} onClick={onReload}>
        <RefreshCw size={13} aria-hidden="true" /> Reload
      </button>
    </div>
  )
}
