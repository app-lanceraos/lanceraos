// src/pages/portal/PortalShell.jsx
//
// Client Portal Redesign, Phase 2 — the real portal app shell: header
// (freelancer branding + account menu), nav (Overview/Invoices), footer,
// and the frame every nested portal page renders inside via
// react-router's <Outlet/>. Registered in App.jsx as a layout route
// (`<Route path="/portal" element={<PortalShell />}>` with `index` =
// PortalOverview and `invoices` = ClientPortal as children) — the first
// use of react-router's nested-route/<Outlet/> composition in this
// codebase (AppShell.jsx, the freelancer-side equivalent, instead wraps
// each authenticated route's own page as a `children` prop from App.jsx
// directly — see CLAUDE.md's frontend rule 5). That's a deliberate,
// narrow departure here, not an unexplained new pattern: AppShell is
// re-mounted fresh on every route change (each authenticated route is
// its own top-level <Route>), which is fine for chrome that owns no
// fetched data of its own. This shell's own job is different — its
// Overview fetch (freelancer identity, balances, needs-attention) must
// happen exactly ONCE and stay available to every nested page without
// being re-fetched on every nav click between Overview and Invoices;
// nested routes + <Outlet/> is the idiomatic way to keep a layout
// component mounted across sibling route changes, which a per-route
// `children` wrapper (remounting on every navigation) cannot do.
//
// PortalLayout.jsx (the pre-existing narrow centered-card component)
// is NOT replaced by this file — it's reused here for the loading/
// needs-link/error states below, which have no freelancer identity to
// show yet and are closer in shape to the auth-adjacent screens
// PortalLayout already serves (PortalEnter.jsx etc.) than to the real
// app shell. Once the Overview fetch succeeds, this component renders
// its own wider frame instead.
//
// Session validity is resolved HERE, once, via the Overview fetch —
// not per nested page. A 401 here means no nested page is reachable at
// all (there's no freelancer identity/balances to show), so this shell
// renders the request-a-fresh-link flow directly rather than mounting
// <Outlet/> onto a broken session.
import { createContext, useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { Home, LogOut, Receipt, UserCircle2 } from 'lucide-react'

import api from '@/lib/api'
import PortalLayout from './PortalLayout'
import PortalRequestLinkForm from './PortalRequestLinkForm'
import {
  ACCENT, BODY_TEXT, CARD_BORDER, ERROR, MUTED_TEXT, NAVY, PAGE_BG,
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

// A single, centralized nav list (per this phase's own spec) — a later
// phase adds Payments/Messages/My Details entries here without
// restructuring the shell itself. `end: true` on Overview so its
// NavLink isn't left "active" while viewing /portal/invoices (both
// paths start with /portal).
const NAV_ITEMS = [
  { label: 'Overview', path: '/portal', icon: Home, end: true },
  { label: 'Invoices', path: '/portal/invoices', icon: Receipt, end: false },
]

// Matches AppShell.jsx's own established breakpoint exactly (DESIGN.md
// Section 11: "768px primary app breakpoint").
const MOBILE_BREAKPOINT = 768

function navLinkStyle({ isActive }, isMobile) {
  return isMobile
    ? {
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3,
        flex: 1, padding: '8px 4px 6px', textDecoration: 'none',
        color: isActive ? NAVY : MUTED_TEXT, fontSize: '0.68rem', fontWeight: isActive ? 700 : 500,
      }
    : {
        display: 'inline-flex', alignItems: 'center', gap: 7, padding: '12px 4px',
        textDecoration: 'none', fontSize: '0.85rem', fontWeight: isActive ? 700 : 500,
        color: isActive ? NAVY : MUTED_TEXT, borderBottom: isActive ? `2px solid ${ACCENT}` : '2px solid transparent',
      }
}

function Skeleton() {
  return (
    <>
      <style>{`@keyframes portalPulse { 0%, 100% { opacity: .45 } 50% { opacity: 1 } }`}</style>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{
            height: i === 0 ? 18 : 42, borderRadius: 8, background: 'rgba(30,58,95,.08)',
            animation: 'portalPulse 1.4s ease-in-out infinite', animationDelay: `${i * 0.12}s`,
          }} />
        ))}
      </div>
    </>
  )
}

function AccountMenu({ onLogout, loggingOut }) {
  const [open, setOpen] = useState(false)

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
          display: 'flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36,
          borderRadius: '50%', border: `1px solid ${CARD_BORDER}`, background: '#ffffff', cursor: 'pointer', color: NAVY,
        }}
      >
        <UserCircle2 size={19} />
      </button>
      {open && (
        <>
          {/* Invisible click-outside catcher, same pattern this codebase's
              own modals already use for a dismissible overlay — just with
              no dark background, since this isn't a modal. */}
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 60 }} />
          <div style={{
            position: 'absolute', top: 44, right: 0, zIndex: 61, minWidth: 190,
            background: '#ffffff', border: `1px solid ${CARD_BORDER}`, borderRadius: 10,
            boxShadow: '0 8px 28px rgba(0,0,0,.14)', padding: 6,
          }}>
            <MenuButton disabled={loggingOut} onClick={() => { setOpen(false); onLogout(false) }}>
              <LogOut size={14} /> Log Out
            </MenuButton>
            <MenuButton disabled={loggingOut} onClick={() => { setOpen(false); onLogout(true) }}>
              <LogOut size={14} /> Log Out Everywhere
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
        padding: '9px 10px', borderRadius: 7, border: 'none', background: 'transparent',
        fontSize: '0.82rem', fontWeight: 500, color: BODY_TEXT, cursor: 'pointer',
        fontFamily: "'DM Sans', sans-serif",
      }, disabled)}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = '#f1f5f9' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
    >
      {children}
    </button>
  )
}

export default function PortalShell() {
  // 'loading' | 'ready' | 'needs_link' | 'error'
  const [state, setState] = useState('loading')
  const [overview, setOverview] = useState(null)
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= MOBILE_BREAKPOINT)
  const [loggingOut, setLoggingOut] = useState(false)

  function load() {
    setState((prev) => (prev === 'ready' ? prev : 'loading'))
    api.get('/invoices/portal/overview/')
      .then(({ data }) => { setOverview(data); setState('ready') })
      .catch((e) => setState(e.response?.status === 401 ? 'needs_link' : 'error'))
  }

  useEffect(() => { load() }, [])

  useEffect(() => {
    function onResize() { setIsMobile(window.innerWidth <= MOBILE_BREAKPOINT) }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  async function handleLogout(everywhere) {
    setLoggingOut(true)
    try {
      await api.post(`/clients/portal/${everywhere ? 'logout-everywhere' : 'logout'}/`)
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
        <header style={{ background: '#ffffff', borderBottom: `1px solid ${CARD_BORDER}` }}>
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
                <NavLink key={item.path} to={item.path} end={item.end} style={(p) => navLinkStyle(p, false)}>
                  <item.icon size={15} /> {item.label}
                </NavLink>
              ))}
            </nav>
          )}
        </header>

        <main style={{ flex: 1, width: '100%', maxWidth: 760, margin: '0 auto', boxSizing: 'border-box', padding: isMobile ? '16px 16px 84px' : '28px 24px 40px' }}>
          <Outlet />
        </main>

        {!isMobile && (
          <footer style={{ textAlign: 'center', padding: '14px 24px 22px' }}>
            <p style={{ margin: 0, fontSize: '0.72rem', color: MUTED_TEXT }}>Powered by LanceraOS</p>
          </footer>
        )}

        {isMobile && (
          <nav style={{
            position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 50,
            background: '#ffffff', borderTop: `1px solid ${CARD_BORDER}`,
            display: 'flex', paddingBottom: 'env(safe-area-inset-bottom, 0px)',
          }}>
            {NAV_ITEMS.map((item) => (
              <NavLink key={item.path} to={item.path} end={item.end} style={(p) => navLinkStyle(p, true)}>
                <item.icon size={19} /> {item.label}
              </NavLink>
            ))}
          </nav>
        )}
      </div>
    </PortalOverviewContext.Provider>
  )
}
