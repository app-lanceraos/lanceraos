// src/components/FilterOverflowMenu.jsx
//
// The "More filters" dropdown that useFilterOverflow's overflow set
// lands in (Invoices.jsx/Clients.jsx's filter row) — real measured-width
// overflow, not a fixed breakpoint. Two chip shapes: a plain toggle
// ({type:'pill', key, label, active, onClick}) and the currency filter
// ({type:'currency', value, options, onChange}), the latter rendered as
// a real embedded <select> inside the panel rather than forced into a
// button-item shape it doesn't fit.
import { useEffect, useRef, useState } from 'react'
import { Filter } from 'lucide-react'

export default function FilterOverflowMenu({ chips, buttonRef }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const handler = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  if (chips.length === 0) return null

  return (
    <div ref={rootRef} style={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}>
      <button
        ref={buttonRef}
        onClick={() => setOpen((v) => !v)}
        className="fos-btn"
        aria-haspopup="menu" aria-expanded={open}
        style={{
          flexShrink: 0, padding: '6px 14px', fontSize: '0.78rem', borderRadius: 'var(--radius-full)',
          background: 'var(--bg-surface)', color: 'var(--text-secondary)',
          border: '1.5px solid var(--border-subtle)', fontWeight: 500,
          display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
        }}
      >
        <Filter size={13} /> More filters ({chips.length})
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute', top: '100%', right: 0, marginTop: 6,
            minWidth: 220, background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-lg)', boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
            padding: 8, zIndex: 500, display: 'flex', flexDirection: 'column', gap: 4,
          }}
        >
          {chips.map((chip) => (
            chip.type === 'currency' ? (
              <div key={chip.key} style={{ padding: '4px 4px 2px' }}>
                <label style={{ display: 'block', fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
                  Currency
                </label>
                <select
                  value={chip.value} onChange={(e) => { chip.onChange(e.target.value); setOpen(false) }}
                  className="fos-input fos-select" style={{ width: '100%', fontSize: '0.8rem' }}
                >
                  <option value="">All</option>
                  {chip.options.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            ) : (
              <button
                key={chip.key}
                onClick={() => { chip.onClick(); setOpen(false) }}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                  padding: '8px 10px', borderRadius: 8, fontSize: '0.82rem', textAlign: 'left',
                  color: chip.active ? 'var(--accent)' : 'var(--text-primary)',
                  fontWeight: chip.active ? 700 : 500,
                  border: 'none', background: chip.active ? 'var(--accent-glow)' : 'transparent',
                  cursor: 'pointer', width: '100%', fontFamily: 'var(--font)',
                }}
              >
                {chip.label}
              </button>
            )
          ))}
        </div>
      )}
    </div>
  )
}
