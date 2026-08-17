// src/components/FilterPill.jsx
// Shared pill-button styling for filter rows (Invoices.jsx/Clients.jsx) —
// factored out so the real, measured hidden row useFilterOverflow relies
// on renders pixel-identical pills to the visible row (same padding/
// border/font), otherwise the measured widths wouldn't match what's
// actually displayed.
import { forwardRef } from 'react'

const FilterPill = forwardRef(function FilterPill({ active, danger, children, ...rest }, ref) {
  return (
    <button
      ref={ref}
      className="fos-btn"
      style={{
        flexShrink: 0, padding: '6px 14px', fontSize: '0.78rem', borderRadius: 'var(--radius-full)',
        background: active ? (danger ? 'var(--status-red-bg)' : 'var(--accent-glow)') : 'var(--bg-surface)',
        color: active ? (danger ? 'var(--status-red-text)' : 'var(--accent)') : 'var(--text-secondary)',
        border: `1.5px solid ${active ? (danger ? 'var(--status-red)' : 'var(--accent)') : 'var(--border-subtle)'}`,
        fontWeight: active ? 700 : 500,
        whiteSpace: 'nowrap',
      }}
      {...rest}
    >
      {children}
    </button>
  )
})

export default FilterPill
