// src/pages/portal/PortalShell.jsx
//
// Client Portal Redesign, Phase 2 — the real portal app shell: header
// (freelancer branding + account menu), nav (Overview/Invoices/
// Payments), footer, and the frame every nested portal page renders
// inside via react-router's <Outlet/>. Registered in App.jsx as a
// layout route (`<Route path="/portal" element={<PortalShell />}>` with
// `index` = PortalOverview and children = ClientPortal/PortalPayments) —
// the first use of react-router's nested-route/<Outlet/> composition in
// this codebase (AppShell.jsx, the freelancer-side equivalent, instead
// wraps each authenticated route's own page as a `children` prop from
// App.jsx directly — see CLAUDE.md's frontend rule 5). That's a
// deliberate, narrow departure here, not an unexplained new pattern:
// AppShell is re-mounted fresh on every route change (each authenticated
// route is its own top-level <Route>), which is fine for chrome that
// owns no fetched data of its own. This shell's own job is different —
// its Overview fetch (freelancer identity, balances, needs-attention)
// must happen exactly ONCE and stay available to every nested page
// without being re-fetched on every nav click; nested routes + <Outlet/>
// is the idiomatic way to keep a layout component mounted across
// sibling route changes, which a per-route `children` wrapper cannot do.
//
// PortalLayout.jsx (the pre-existing narrow centered-card component) is
// NOT replaced by this file — it's reused here for the loading/
// needs-link/error states below, which have no freelancer identity to
// show yet. Once the Overview fetch succeeds, this component renders
// its own wider frame instead.
//
// Session validity is resolved HERE, once, via the Overview fetch — not
// per nested page. A 401 here means no nested page is reachable at all,
// so this shell renders the request-a-fresh-link flow directly rather
// than mounting <Outlet/> onto a broken session.
//
// Phase 3.5 — 3 real, concrete changes to this file:
// 1. Mobile detection: the old `window.addEventListener('resize', ...)`
//    listener is replaced with `matchMedia('(max-width: 768px)')` +
//    `addEventListener('change', ...)`. Direct testing (a real Playwright
//    viewport resize, simulating the same CDP-level viewport change
//    DevTools' own device toolbar performs) showed the OLD resize
//    listener already updated `isMobile` correctly in this environment —
//    the reported "stuck after toggling the DevTools device toolbar"
//    bug did not reproduce here. Switched anyway: `matchMedia`'s
//    `change` event is tied directly to the browser's own live media-
//    query re-evaluation, which is the documented, more robust primitive
//    for exactly this class of report across browsers/DevTools versions
//    (a plain `resize` event is, in some documented cases, not
//    dispatched by every device-emulation transition) — see
//    DECISIONS.md's Phase 3.5 entry for the full investigation.
// 2. The mobile bottom nav is now a floating pill (PillNav, below),
//    replacing the old flush full-width bar.
// 3. The account menu is now a single "Log Out" action (always
//    logout-everywhere — Step 2.G) plus a real dark/light theme toggle
//    (Step 2.B, via usePortalThemeContext — see PortalThemeRoot.jsx).
import { createContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { Home, IdCard, LogOut, Moon, Receipt, Sun, UserCircle2, Wallet } from 'lucide-react'

import api from '@/lib/api'
import { WordmarkSVG } from '@/components/Brand'
import PortalLayout from './PortalLayout'
import PortalRequestLinkForm from './PortalRequestLinkForm'
import { usePortalThemeContext } from './PortalThemeRoot'
import {
  ACCENT, BODY_TEXT, CARD_BG, CARD_BORDER, ERROR, HOVER_BG, MENU_SHADOW, MUTED_TEXT, NAVY, PAGE_BG,
  SKELETON_BG, TEXT_ON_ACCENT, WORDMARK_COLOR,
  disabledStyle, publicBtnPrimary,
} from './portalShared'

// Provides { overview, reload } to every nested portal page. `overview`
// is the real GET /api/invoices/portal/overview/ response body
// (apps/invoices/serializers_portal.py's shape: freelancer/client_name/
// balances/needs_attention/recent_invoices) — never re-derived or
// re-fetched by a nested page. `reload` lets a nested page ask for a
// fresh copy after an action that could change it (e.g. acknowledging
// an invoice) without duplicating the fetch logic itself.
export const PortalOverviewContext = createContext({ overview: null, reload: () => {} })

// A single, centralized nav list — a later phase adds Messages here
// without restructuring the shell itself (My Details is now the 4th
// real entry, Phase 4).
// `end: true` on Overview so its NavLink isn't left "active" while
// viewing /portal/invoices (both paths start with /portal).
const NAV_ITEMS = [
  { label: 'Overview', path: '/portal', icon: Home, end: true },
  { label: 'Invoices', path: '/portal/invoices', icon: Receipt, end: false },
  { label: 'Payments', path: '/portal/payments', icon: Wallet, end: false },
  { label: 'My Details', path: '/portal/details', icon: IdCard, end: false },
]

// Matches AppShell.jsx's own established breakpoint exactly (DESIGN.md
// Section 11: "768px primary app breakpoint").
const MOBILE_QUERY = '(max-width: 768px)'

function navLinkStyle({ isActive }) {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 7, padding: '12px 4px',
    textDecoration: 'none', fontSize: '0.85rem', fontWeight: isActive ? 700 : 500,
    color: isActive ? NAVY : MUTED_TEXT, borderBottom: isActive ? `2px solid ${ACCENT}` : '2px solid transparent',
  }
}

// Exported — PortalPayments.jsx (Phase 3) reuses this exact loading
// treatment for its own fetch (a separate endpoint from this shell's own
// Overview fetch, so it needs its own loading state at the page level)
// rather than a second, independently-built skeleton.
export function Skeleton() {
  return (
    <>
      <style>{`@keyframes portalPulse { 0%, 100% { opacity: .45 } 50% { opacity: 1 } }`}</style>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{
            height: i === 0 ? 18 : 42, borderRadius: 8, background: SKELETON_BG,
            animation: 'portalPulse 1.4s ease-in-out infinite', animationDelay: `${i * 0.12}s`,
          }} />
        ))}
      </div>
    </>
  )
}

// Mobile floating pill nav (Step 2.C) — fully rounded container, real
// margin from every screen edge (never flush/full-width), soft shadow.
// The active tab gets its own larger circular badge, accent-filled,
// overlapping the pill's own top edge — plain z-index/paint-order
// stacking, the badge rendering on top of the pill where the two
// overlap, no gap, no seam, no transparency effect of any kind. A
// negative `top` offset on an element inside a container with no
// `overflow` set (the default, `visible`) renders fully un-clipped; the
// pill itself deliberately never sets `overflow: hidden` for exactly
// this reason. Every tab (active or not) is a real 44×44 touch target,
// matching this pass's own mobile-audit minimum (Step 2.D) — only the
// VISUAL badge grows for the active tab, the tap target doesn't shrink
// for the inactive ones.
//
// Phase 4c (corrected overlap spec): Phases 4 and 4b both chased a
// requirement — a genuinely transparent gap/cutout between the badge and
// the pill — that turned out to never be the actual design. The real
// reference is much simpler: a flat, solid circle overlapping a flat,
// solid pill, with **65% of the badge's own diameter sitting below the
// pill's top edge (overlapping into it) and 35% poking out above it**,
// rendered with plain stacking order — no border, no box-shadow, nothing
// between the badge and the pill but one shape drawn on top of the
// other. Phase 4b's own `top: -57` (a deliberate ZERO-overlap gap, the
// opposite of what's wanted here) is replaced with a value computed from
// the real measured badge diameter (`D = 44px`, unchanged from every
// prior pass) against the real measured pill position: target overlap
// `0.65 × 44 = 28.6px` below the pill's top edge, `0.35 × 44 = 15.4px`
// above it. With the pill's real top edge at 742px and the NavLink's own
// real absolute top at 747px (unchanged since Phase 4b — nothing about
// the surrounding layout moved), the badge's target absolute top is
// `742 − 15.4 = 726.6px`, giving `top: 726.6 − 747 = -20.4`. Verified
// empirically (post-fix measurement landed at 65.02%/34.98%, see
// DECISIONS.md's Phase 4c entry). `border`/`boxShadow` stay `none`
// (already true since Phase 4b, re-confirmed, not reintroduced) — the
// reference design has neither on the badge itself.
//
// Phase 4d (final piece of the same reference design): the ~65% of the
// badge embedded in the pill sits against a thin curved MOAT — a real
// circular hole cut into the pill's own material, tracing the badge's
// edge, through which the true page background shows (not the pill's
// own CARD_BG fill read as "close enough"). A border can't do this — a
// border paints on top of an element's existing background, it can't
// remove material the way a hole needs to. `mask-image`/
// `WebkitMaskImage` on the PILL itself does: a radial gradient, opaque
// (pill renders normally) everywhere except a ring from the badge's own
// radius (22px) out to radius + a 4px moat width (26px), which is
// transparent (the pill becomes genuinely see-through there, so
// whatever is truly behind the fixed nav shows). 4px was chosen by
// direct comparison against the 44px badge at real screen size — narrow
// enough to read as a deliberate, precise cut rather than an accidental
// gap, wide enough to be unambiguously visible as a curve, not a
// rounding artifact.
//
// The mask's center must track WHICH of the 4 equal-width nav items is
// active — each one centers its own badge over its own flex slot, not
// over the pill's overall center — so a single hardcoded position would
// only be correct for one tab. Measured directly via `pillRef`/
// `useLayoutEffect` (the real rendered badge's center relative to the
// real rendered pill's own box, both from `getBoundingClientRect()`),
// not computed from assumed flex-math, and re-measured on every real
// navigation (`useLocation()`) and viewport resize (the pill's own
// `maxWidth: 340` means its real width — and therefore each item's own
// center — changes on narrower screens). No mask is applied until the
// first real measurement lands (`moat` starts `null`), so there's no
// flash of a wrongly-positioned hole before layout settles.
//
// This only ever affects the pill's own painted area (its `<div>`'s own
// box) — the ~35% of the badge poking out above the pill's top edge is
// rendered by the BADGE's own element, a sibling the mask never touches,
// so it needed no separate handling, exactly as expected going in.
//
// Phase 4e: Phase 4d's own report verified the moat on Payments only —
// on Overview and My Details (the two tabs nearest the pill's own
// rounded ends) it produced a visibly irregular bite, not a clean ring.
// Direct measurement ruled out a coordinate bug first: the mask's parsed
// center matched the real badge center to 0.000px on all 4 tabs, both
// themes (8/8 exact). The real cause is geometric, confirmed by the
// actual numbers, not assumed: the pill's `border-radius: 999px` on a
// 54px-tall box clamps to a 27px corner radius (`height / 2`) at each
// end. For Overview, the distance from the badge's own center to the
// LEFT corner's own center is ~30.2px — less than the sum of the two
// radii (moat outer radius 26 + corner radius 27 = 53), so the moat's
// circle and the corner's own rounding circle genuinely intersect,
// leaving a thin lens-shaped sliver of pill material between two
// non-concentric, similarly-sized curves — which is exactly what reads
// as an irregular bite, not a coordinate offset (there is none). For
// Invoices/Payments (the 2 middle tabs), that same distance is ~105px,
// nowhere near either corner's own radius, which is why only those two
// looked correct in Phase 4d's own single-tab check.
//
// Fixed with a second, corner-protecting mask layer rather than moving
// the badge or shrinking the moat (both out of scope) — 2 more
// `radial-gradient()`s, one centered on each of the pill's own real
// corner centers (`cornerRadius`px from that end, `cornerRadius`px from
// the top — the exact center CSS itself already uses for the rounding),
// opaque within that same `cornerRadius` and transparent beyond it. CSS
// mask layers composite top-to-bottom with the default `add` (source-
// over) operator, which — for pure alpha masks — behaves as a union:
// wherever EITHER layer is opaque, the result is opaque. Listed above
// (before) the moat layer, these two guards force the pill's own
// natural corner material to stay solid regardless of what the moat
// ring alone would say there, cleanly capping the ring exactly at the
// edge of each corner's own real rounding — with zero visible effect on
// Invoices/Payments, where the guards' own opaque discs never overlap
// the moat's own transparent ring in the first place.
const BADGE_RADIUS = 22
const MOAT_WIDTH = 4

function PillNav() {
  const pillRef = useRef(null)
  const location = useLocation()
  // { x, y, pillWidth, pillHeight } — badge center relative to the
  // pill's own top-left corner, plus the pill's own real box size (used
  // to place the two corner-guard gradients, see above) — null until
  // the first real post-layout measurement.
  const [moat, setMoat] = useState(null)

  useLayoutEffect(() => {
    function measure() {
      const pill = pillRef.current
      const badge = pill?.querySelector('span')
      if (!pill || !badge) { setMoat(null); return }
      const pr = pill.getBoundingClientRect()
      const br = badge.getBoundingClientRect()
      setMoat({
        x: (br.left + br.right) / 2 - pr.left, y: (br.top + br.bottom) / 2 - pr.top,
        pillWidth: pr.width, pillHeight: pr.height,
      })
    }
    // Confirmed live (real repeated fresh page loads, not assumed): applying
    // a freshly-computed 3-layer mask-image synchronously in the SAME paint
    // as the layout measurement that produced it is a genuine Chromium
    // compositor race — the exact same mask string, verified correct via
    // getComputedStyle every time, rendered a visibly broken corner-guard
    // seam on some page loads and a clean one on others, with no other
    // variable changed between runs. Deferring the actual `setMoat` call to
    // the NEXT animation frame (rather than applying it in the same pass
    // `useLayoutEffect` runs) gives the compositor a settled prior frame to
    // diff against instead of computing the mask's own first-ever texture
    // in the same commit as the layout that positions it — this resolved
    // the flakiness across every repeated fresh-load test run afterward.
    const raf = requestAnimationFrame(measure)
    window.addEventListener('resize', measure)
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', measure) }
  }, [location.pathname])

  let maskImage
  if (moat) {
    const cornerRadius = moat.pillHeight / 2
    const leftGuard = `radial-gradient(circle at ${cornerRadius}px ${cornerRadius}px, black 0, black ${cornerRadius}px, transparent ${cornerRadius}px, transparent 100%)`
    const rightGuard = `radial-gradient(circle at ${moat.pillWidth - cornerRadius}px ${cornerRadius}px, black 0, black ${cornerRadius}px, transparent ${cornerRadius}px, transparent 100%)`
    const moatRing = `radial-gradient(circle at ${moat.x}px ${moat.y}px, black 0, black ${BADGE_RADIUS}px, transparent ${BADGE_RADIUS}px, transparent ${BADGE_RADIUS + MOAT_WIDTH}px, black ${BADGE_RADIUS + MOAT_WIDTH}px, black 100%)`
    maskImage = [leftGuard, rightGuard, moatRing].join(', ')
  }

  return (
    <div style={{
      position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 50,
      display: 'flex', justifyContent: 'center', pointerEvents: 'none',
      padding: '0 16px calc(16px + env(safe-area-inset-bottom, 0px))',
    }}>
      <div
        ref={pillRef}
        style={{
          pointerEvents: 'auto', position: 'relative',
          display: 'flex', alignItems: 'center', width: '100%', maxWidth: 340,
          background: CARD_BG, borderRadius: 999, boxShadow: MENU_SHADOW,
          border: `1px solid ${CARD_BORDER}`, padding: '4px 8px',
          maskImage, WebkitMaskImage: maskImage,
        }}
      >
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.path} to={item.path} end={item.end} aria-label={item.label}
            style={{
              position: 'relative', flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
              height: 44, textDecoration: 'none',
            }}
          >
            {({ isActive }) => (
              isActive ? (
                <span style={{
                  position: 'absolute', top: -20.4, left: '50%', transform: 'translateX(-50%)',
                  width: 44, height: 44, borderRadius: '50%', background: ACCENT,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: 'none', border: 'none',
                }}>
                  <item.icon size={19} color={TEXT_ON_ACCENT} />
                </span>
              ) : (
                <item.icon size={20} color={MUTED_TEXT} />
              )
            )}
          </NavLink>
        ))}
      </div>
    </div>
  )
}

function AccountMenu({ onLogout, loggingOut }) {
  const [open, setOpen] = useState(false)
  const { theme, toggleTheme } = usePortalThemeContext()

  // Escape-to-close — matches DropdownMenu.jsx's own established
  // convention exactly (a window keydown listener, not reused directly
  // here since DropdownMenu.jsx is theme-dependent, see this file's own
  // header comment on why the account menu is a small local component
  // instead).
  useEffect(() => {
    if (!open) return
    const handler = (e) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open])

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Account menu"
        aria-expanded={open}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', width: 40, height: 40,
          borderRadius: '50%', border: `1px solid ${CARD_BORDER}`, background: CARD_BG, cursor: 'pointer', color: NAVY,
        }}
      >
        <UserCircle2 size={20} />
      </button>
      {open && (
        <>
          {/* Invisible click-outside catcher, same pattern this codebase's
              own modals already use for a dismissible overlay — just with
              no dark background, since this isn't a modal. */}
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 60 }} />
          <div style={{
            position: 'absolute', top: 48, right: 0, zIndex: 61, minWidth: 200,
            background: CARD_BG, border: `1px solid ${CARD_BORDER}`, borderRadius: 10,
            boxShadow: MENU_SHADOW, padding: 6,
          }}>
            <MenuButton onClick={toggleTheme}>
              {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
              {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
            </MenuButton>
            <div style={{ height: 1, background: CARD_BORDER, margin: '4px 2px' }} />
            {/* Step 2.G — one "Log Out" action, no "logout-everywhere"
                wording anywhere; it invokes the exact same endpoint the
                old, now-removed "Log Out Everywhere" button called. */}
            <MenuButton disabled={loggingOut} onClick={() => { setOpen(false); onLogout() }}>
              <LogOut size={16} /> Log Out
            </MenuButton>
          </div>
        </>
      )}
    </div>
  )
}

function MenuButton({ children, disabled, onClick }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={disabledStyle({
        display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
        minHeight: 40, padding: '9px 10px', borderRadius: 7, border: 'none', background: 'transparent',
        fontSize: '0.85rem', fontWeight: 500, color: BODY_TEXT, cursor: 'pointer',
        fontFamily: "'DM Sans', sans-serif",
      }, disabled)}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = HOVER_BG }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
    >
      {children}
    </button>
  )
}

// Real LanceraOS wordmark asset (Step 2.F) — replaces the old plain-text
// "Powered by LanceraOS" footer. Sized and muted-opacity so it never
// visually competes with the freelancer's own logo/business name above
// it in the header (a much larger, full-opacity, primary-weight
// treatment there).
//
// Mobile Polish (Phase 3.5b): this component was previously rendered
// desktop-only (`{!isMobile && <WordmarkFooter/>}`) — confirmed directly
// by DOM inspection at 375px (`document.querySelectorAll('footer')`
// returned an empty array), so mobile had no footer at all, not a
// wrapping one. Now rendered on mobile too, as the last item inside
// `<main>`'s own scrollable content (see the shell below) — never
// outside it, which would place it inside the space reserved for the
// fixed PillNav and risk exactly the collision this pass is fixing
// elsewhere. "Powered by" + the wordmark were also joined onto one
// literal row via `display:flex` (matching AuthLayout.jsx's own
// `.orbit-form__brand` icon+wordmark lockup convention: `flex,
// alignItems:center, gap` — flex's own default `nowrap` guarantees a
// single line regardless of width, so there's no max-width/font-size
// combination left that can ever wrap it). A combined LogoSVG+Wordmark
// lockup (that convention's other half) was considered and deliberately
// NOT used here: LogoSVG has no `fill` override the way WordmarkSVG got
// for this exact isolated-theme scenario (see WordmarkSVG's own prop
// comment in Brand.jsx) — it resolves theme.css's `--logo-body`/
// `--logo-mark`, which don't exist inside this portal's separate
// `data-portal-theme` scope. Adding that override means editing a
// component shared by AppShell/AuthLayout/NotFound, a materially larger
// change than this pass's own scope for a cosmetic addition — the exact
// same call this codebase already made for FormField/FormSelect/FosAlert
// on this same page (see ClientPortal.jsx's own header comment).
function WordmarkFooter({ style }) {
  return (
    <footer style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '14px 24px 22px', ...style }}>
      <p style={{ margin: 0, fontSize: '0.68rem', color: MUTED_TEXT, whiteSpace: 'nowrap' }}>Powered by</p>
      <div style={{ opacity: 0.55, display: 'inline-flex', flexShrink: 0 }}>
        <WordmarkSVG width={78} height={12} fill={WORDMARK_COLOR} />
      </div>
    </footer>
  )
}

export default function PortalShell() {
  // 'loading' | 'ready' | 'needs_link' | 'error'
  const [state, setState] = useState('loading')
  const [overview, setOverview] = useState(null)
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(MOBILE_QUERY).matches)
  const [loggingOut, setLoggingOut] = useState(false)

  function load() {
    setState((prev) => (prev === 'ready' ? prev : 'loading'))
    api.get('/invoices/portal/overview/')
      .then(({ data }) => { setOverview(data); setState('ready') })
      .catch((e) => setState(e.response?.status === 401 ? 'needs_link' : 'error'))
  }

  useEffect(() => { load() }, [])

  // matchMedia's `change` event fires only when the (max-width: 768px)
  // query's own result actually flips — the browser's live layout
  // engine drives it directly, not a raw pixel-resize dispatch some
  // device-emulation transitions are documented to skip. Always
  // addEventListener/removeEventListener, never the deprecated
  // addListener/removeListener pair.
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY)
    const handler = (e) => setIsMobile(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  // Step 2.G — always logout-everywhere now; the single-session-only
  // path is gone from the UI entirely (the backend endpoint it called,
  // POST /clients/portal/logout/, is untouched and still exists — this
  // is a frontend consolidation only, per this task's own scope).
  async function handleLogout() {
    setLoggingOut(true)
    try {
      await api.post('/clients/portal/logout-everywhere/')
    } catch {
      // Same discipline as this page's own pre-existing handler before
      // this relocation: logging out locally doesn't depend on the
      // request having succeeded — the next Overview fetch (below)
      // re-checks the real session regardless.
    } finally {
      setLoggingOut(false)
      setOverview(null)
      setState('needs_link')
    }
  }

  if (state === 'loading') {
    return <PortalLayout><Skeleton /></PortalLayout>
  }

  if (state === 'needs_link') {
    return (
      <PortalLayout>
        <h1 style={{ margin: '0 0 8px', fontSize: '1.1rem', fontWeight: 700, color: NAVY }}>Your session has ended</h1>
        <p style={{ margin: 0, fontSize: '0.85rem', color: MUTED_TEXT }}>Enter your email and we'll send you a fresh link.</p>
        <PortalRequestLinkForm />
      </PortalLayout>
    )
  }

  if (state === 'error') {
    return (
      <PortalLayout>
        <p style={{ margin: '0 0 12px', fontSize: '0.9rem', color: ERROR }}>Something went wrong loading your portal.</p>
        <button onClick={load} style={publicBtnPrimary}>Try again</button>
      </PortalLayout>
    )
  }

  const { freelancer } = overview

  return (
    <PortalOverviewContext.Provider value={{ overview, reload: load }}>
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: PAGE_BG, fontFamily: "'DM Sans', sans-serif" }}>
      <header style={{ background: CARD_BG, borderBottom: `1px solid ${CARD_BORDER}` }}>
        <div style={{
          maxWidth: 760, margin: '0 auto', padding: isMobile ? '14px 16px' : '18px 24px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            {freelancer.logo && (
              <img
                src={freelancer.logo}
                alt={freelancer.business_name || 'Logo'}
                style={{ width: 36, height: 36, borderRadius: 8, objectFit: 'cover', flexShrink: 0, border: `1px solid ${CARD_BORDER}` }}
              />
            )}
            <div style={{ minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: NAVY, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {freelancer.business_name || 'Your Freelancer'}
              </p>
              <p style={{ margin: 0, fontSize: '0.7rem', fontWeight: 500, color: MUTED_TEXT, letterSpacing: '0.03em', textTransform: 'uppercase' }}>
                Client Portal
              </p>
            </div>
          </div>
          <AccountMenu onLogout={handleLogout} loggingOut={loggingOut} />
        </div>

        {!isMobile && (
          <nav style={{ maxWidth: 760, margin: '0 auto', padding: '0 24px', display: 'flex', gap: 22 }}>
            {NAV_ITEMS.map((item) => (
              <NavLink key={item.path} to={item.path} end={item.end} style={navLinkStyle}>
                <item.icon size={15} /> {item.label}
              </NavLink>
            ))}
          </nav>
        )}
      </header>

      <main style={{
        flex: 1, width: '100%', maxWidth: 760, margin: '0 auto', boxSizing: 'border-box',
        // Phase 4b: bottom padding increased 96px -> 140px — the badge's
        // real footprint from the viewport's own bottom edge grew once it
        // stopped overlapping the pill (now floating with a real gap
        // above it, not embedded 35px into it), so the old value no
        // longer reserves enough clearance. Re-verified with the same
        // scroll-to-bottom methodology as every prior pass — see
        // DECISIONS.md's Phase 4b entry for the real measured numbers.
        padding: isMobile ? '16px 16px 140px' : '28px 24px 40px',
      }}>
        <Outlet />
        {/* Mobile Polish (Phase 3.5b): rendered HERE, as the last item of
            main's own scrollable content, specifically so it sits ABOVE
            the fixed-position PillNav's reserved clearance (main's own
            padding-bottom, just above) rather than inside it — see this
            component's own header comment for why it was moved onto
            mobile at all. */}
        {isMobile && <WordmarkFooter style={{ padding: '24px 4px 4px' }} />}
      </main>

      {!isMobile && <WordmarkFooter />}
      {isMobile && <PillNav />}
    </div>
    </PortalOverviewContext.Provider>
  )
}
