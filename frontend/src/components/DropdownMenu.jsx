// src/components/DropdownMenu.jsx
//
// Generic small trigger-button + absolutely-positioned item list —
// AppShell's mobile 3-dot header menu and any page's desktop "More"
// header dropdown (e.g. Invoices.jsx's Manage Designs/From Preset)
// both compose from this one primitive rather than each hand-rolling
// their own open/close/outside-click logic. `items`:
// [{ key, label, Icon, onClick, disabled? }].
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'

export default function DropdownMenu({ trigger, triggerLabel, items, align = 'right', placement = 'bottom', triggerStyle, triggerClassName, bareTrigger = false, showChevron = false }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)
  const panelRef = useRef(null)
  // Overrides the CSS align-based positioning below only when it would
  // actually overflow the viewport — a real, confirmed bug (mobile
  // screenshot verification, InvoiceDetailPanel redesign round): a
  // trigger near the left edge (e.g. a footer that's wrapped onto its
  // own line at narrow widths) combined with align='right' anchors the
  // menu's right edge to the trigger, which pushes the menu's LEFT edge
  // past x=0 and clips every item's text. Same clamping approach
  // useAppTooltip.js already uses for the same class of problem.
  const [clampedLeft, setClampedLeft] = useState(null)

  useEffect(() => {
    if (!open) return
    const handler = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false) }
    const escHandler = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', handler)
    window.addEventListener('keydown', escHandler)
    return () => {
      document.removeEventListener('mousedown', handler)
      window.removeEventListener('keydown', escHandler)
    }
  }, [open])

  useLayoutEffect(() => {
    if (!open || !panelRef.current || !rootRef.current) { setClampedLeft(null); return }
    const panelRect = panelRef.current.getBoundingClientRect()
    const rootRect = rootRef.current.getBoundingClientRect()
    const margin = 8
    const desiredViewportLeft = Math.max(margin, Math.min(panelRect.left, window.innerWidth - panelRect.width - margin))
    if (desiredViewportLeft !== panelRect.left) {
      setClampedLeft(desiredViewportLeft - rootRect.left)
    } else {
      setClampedLeft(null)
    }
  }, [open])

  return (
    <div ref={rootRef} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={triggerLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        className={bareTrigger ? undefined : (triggerClassName || 'fos-btn fos-btn-ghost')}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          background: 'transparent', cursor: 'pointer',
          // A bare, icon-only trigger (e.g. AppShell's mobile 3-dot menu,
          // matching the bell/hamburger buttons' own convention right
          // next to it) skips .fos-btn's own 10px/20px padding entirely —
          // that padding, under this app's global border-box reset, eats
          // MORE than a deliberately small fixed width/height box (e.g.
          // 38x38) leaves available, silently squeezing the icon's
          // content box to zero and making it invisible. A real,
          // confirmed bug this pass, not a hypothetical one.
          ...(bareTrigger ? { border: 'none', padding: 0 } : {}),
          ...triggerStyle,
        }}
      >
        {trigger}
        {showChevron && <ChevronDown size={13} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s ease' }} />}
      </button>

      {open && (
        <div
          ref={panelRef}
          role="menu"
          style={{
            position: 'absolute',
            // 'top' placement (e.g. a footer-anchored "More" button near
            // the bottom of a bounded panel) opens the menu UPWARD —
            // `top: '100%'` would otherwise render the panel below the
            // trigger and get clipped by the panel's own overflow, since
            // this is `position: absolute` relative to the trigger, not
            // `position: fixed` to the viewport.
            ...(placement === 'top' ? { bottom: '100%', marginBottom: 6 } : { top: '100%', marginTop: 6 }),
            // clampedLeft (viewport-overflow correction, computed above)
            // replaces the align-based left/right positioning entirely
            // when the trigger sits close enough to a viewport edge that
            // the natural position would clip the menu — e.g. a footer
            // "More" button wrapped onto its own line at 375px, near
            // x=24, with align='right' anchoring the menu's right edge to
            // it and pushing most of the menu's own width off-screen to
            // the left.
            ...(clampedLeft !== null ? { left: clampedLeft, right: 'auto' } : { [align]: 0 }),
            minWidth: 200, maxWidth: 280, maxHeight: '60vh', overflowY: 'auto',
            background: 'var(--menu-bg, var(--bg-surface))',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-lg)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
            padding: 6, zIndex: 500,
            display: 'flex', flexDirection: 'column', gap: 2,
          }}
        >
          {items.map((item) => (
            <button
              key={item.key}
              role="menuitem"
              disabled={item.disabled}
              onClick={() => { setOpen(false); item.onClick?.() }}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 12px', borderRadius: 9,
                color: item.danger ? 'var(--status-red-text)' : 'var(--text-primary)',
                fontSize: 13, whiteSpace: 'nowrap', textAlign: 'left',
                cursor: item.disabled ? 'not-allowed' : 'pointer',
                opacity: item.disabled ? 0.5 : 1,
                border: 'none', background: 'transparent', width: '100%',
                fontFamily: 'var(--font)',
                transition: 'background var(--fast)',
              }}
              onMouseEnter={(e) => { if (!item.disabled) e.currentTarget.style.background = 'var(--nav-hover-bg, var(--bg-surface-2))' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
            >
              {item.Icon && <item.Icon size={15} style={{ flexShrink: 0 }} />}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
