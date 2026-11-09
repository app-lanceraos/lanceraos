// src/components/ReportNote.jsx
//
// The one-line note both report pages use: an Info icon and tertiary text, the same look as the local Note in Expenses.jsx.
import { Info } from 'lucide-react'

export default function ReportNote({ children }) {
  return (
    <p style={{ margin: 0, display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: '0.74rem', color: 'var(--text-tertiary)' }}>
      <Info size={13} aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
      <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{children}</span>
    </p>
  )
}
