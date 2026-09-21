// src/components/DropdownMenu.jsx
//
// Generic small trigger-button + item list — AppShell's mobile 3-dot
// header menu and any page's desktop "More" header dropdown (e.g.
// Invoices.jsx's Manage Designs/From Preset) both compose from this one
// primitive rather than each hand-rolling their own open/close/outside-
// click logic. `items`: [{ key, label, Icon, onClick, disabled? }].
//
// The open panel is rendered through a React portal to document.body with
// `position: fixed` viewport coordinates, NOT as a `position: absolute`
// child of the trigger's own wrapper (Dropdown Portal Fix, 21 September
// 2026 — see DECISIONS.md, which corrects the 20 September "Dropdown
// Overflow Fix" entry). An absolutely-positioned panel is still clipped
// by ANY ancestor with non-visible overflow between it and the viewport
// (InvoiceTable.jsx's `overflowX: 'auto'` wrapper forces `overflow-y:
// auto` too, per the CSS Overflow spec), no matter which edge of the
// browser window the flip/clamp math measured against. A portaled fixed
// panel has no such ancestor left, so its only constraint is the real
// viewport — which is exactly what the placement math below measures.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown } from 'lucide-react'

const VIEWPORT_MARGIN = 8
const TRIGGER_GAP = 6

export default function DropdownMenu({ trigger, triggerLabel, items, align = 'right', placement = 'bottom', triggerStyle, triggerClassName, bareTrigger = false, showChevron = false }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)
  const panelRef = useRef(null)
  // Real viewport coordinates for the portaled panel, { top, left,
  // maxHeight } — null until measured. The panel first renders
  // `visibility: hidden` at 0,0 so its natural size can be measured, then
  // this is set in the same layout-effect pass, before the browser paints
  // (no visible flash at the wrong position).
  const [coords, setCoords] = useState(null)

  useEffect(() => {
    if (!open) return
    // The panel is no longer a DOM descendant of rootRef, so the outside-
    // click check must treat it as "inside" explicitly — otherwise a
    // mousedown on a menu item counts as an outside click, closes the
    // menu, and unmounts the item before its click event ever fires.
    const handler = (e) => {
      if (rootRef.current?.contains(e.target) || panelRef.current?.contains(e.target)) return
      setOpen(false)
    }
    const escHandler = (e) => { if (e.key === 'Escape') setOpen(false) }
    // Scroll/resize-while-open: CLOSE the menu rather than re-tracking the
    // trigger. A fixed-position panel doesn't move with its trigger, and
    // re-tracking can't tell when the trigger itself has been scrolled out
    // of (or clipped by) its own overflow container — the menu would keep
    // floating over unrelated content, detached from a trigger the user
    // can no longer see, the same class of bug this portal exists to fix.
    // Capture phase so a scroll inside ANY nested scroll container (the
    // table wrapper, AppShell's main content area) is caught, since scroll
    // events don't bubble; the panel's own internal scroll (long menu at
    // maxHeight) is deliberately ignored.
    const scrollHandler = (e) => {
      if (panelRef.current?.contains(e.target)) return
      setOpen(false)
    }
    const resizeHandler = () => setOpen(false)
    document.addEventListener('mousedown', handler)
    window.addEventListener('keydown', escHandler)
    window.addEventListener('scroll', scrollHandler, true)
    window.addEventListener('resize', resizeHandler)
    return () => {
      document.removeEventListener('mousedown', handler)
      window.removeEventListener('keydown', escHandler)
      window.removeEventListener('scroll', scrollHandler, true)
      window.removeEventListener('resize', resizeHandler)
    }
  }, [open])

  useLayoutEffect(() => {
    if (!open || !panelRef.current || !rootRef.current) { setCoords(null); return }
    const triggerRect = rootRef.current.getBoundingClientRect()
    const panelRect = panelRef.current.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight

    // Horizontal: `align` says which trigger edge the panel's matching
    // edge lines up with, then the result is clamped so it never runs off
    // either side of the viewport (a footer "More" button wrapped onto its
    // own line at 375px sits near x=24 — align='right' alone would push the
    // panel's left edge past x=0).
    const idealLeft = align === 'left' ? triggerRect.left : triggerRect.right - panelRect.width
    const left = Math.max(VIEWPORT_MARGIN, Math.min(idealLeft, vw - panelRect.width - VIEWPORT_MARGIN))

    // Vertical: the caller's `placement` is respected when it fits, and
    // overridden when it genuinely doesn't — a caller's static guess about
    // its own position (a table row's depends on scroll position) is worth
    // less than a real measurement against the real viewport. Symmetric
    // for both directions. If neither side fits the whole panel, it takes
    // the roomier side and shrinks `maxHeight` to that room (the panel
    // already scrolls internally), so no item is ever unreachable.
    const spaceBelow = vh - triggerRect.bottom - TRIGGER_GAP - VIEWPORT_MARGIN
    const spaceAbove = triggerRect.top - TRIGGER_GAP - VIEWPORT_MARGIN
    const fits = { top: spaceAbove >= panelRect.height, bottom: spaceBelow >= panelRect.height }
    const other = placement === 'top' ? 'bottom' : 'top'
    let side = placement === 'top' ? 'top' : 'bottom'
    if (!fits[side]) {
      if (fits[other]) side = other
      else side = spaceAbove > spaceBelow ? 'top' : 'bottom'
    }
    const room = Math.max(0, side === 'top' ? spaceAbove : spaceBelow)
    const maxHeight = Math.min(vh * 0.6, room)
    const height = Math.min(panelRect.height, maxHeight)
    const top = side === 'top' ? triggerRect.top - TRIGGER_GAP - height : triggerRect.bottom + TRIGGER_GAP

    setCoords({ top, left, maxHeight })
  }, [open, placement, align])

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

      {open && createPortal(
        <div
          ref={panelRef}
          role="menu"
          style={{
            position: 'fixed',
            top: coords ? coords.top : 0,
            left: coords ? coords.left : 0,
            visibility: coords ? 'visible' : 'hidden',
            minWidth: 200, maxWidth: 280, maxHeight: coords ? coords.maxHeight : '60vh', overflowY: 'auto',
            background: 'var(--menu-bg, var(--bg-surface))',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-lg)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
            // Portaled to <body>, so this z-index now competes at the root
            // stacking level rather than inside whichever local stacking
            // context the trigger lives in — 500 clears every overlay a
            // menu can be opened from (InvoiceDetailPanel 101, modals 200,
            // AppShell's mobile drawer 400), matching AppShell's own popup.
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
                flexShrink: 0,
              }}
              onMouseEnter={(e) => { if (!item.disabled) e.currentTarget.style.background = 'var(--nav-hover-bg, var(--bg-surface-2))' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
            >
              {item.Icon && <item.Icon size={15} style={{ flexShrink: 0 }} />}
              {item.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  )
}
