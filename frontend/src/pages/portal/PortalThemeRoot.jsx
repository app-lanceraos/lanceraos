// src/pages/portal/PortalThemeRoot.jsx
//
// Client Portal Redesign, Phase 3.5 — the one scoped root every portal
// route renders inside (both the `/portal` layout route's subtree AND
// the sibling `/portal/enter/:token` route — see App.jsx), so the
// `data-portal-theme` attribute and portalTheme.css's own `--portal-*`
// custom properties are available identically regardless of which of
// the two top-level portal routes is active. Registered as a real
// react-router layout route (`<Route element={<PortalThemeRoot />}>`
// wrapping both with `<Outlet/>`) — the same nested-route composition
// PortalShell.jsx already established in Phase 2, reused here for the
// same reason: a wrapper that must stay mounted/consistent across
// sibling routes, which App.jsx's older per-route `children`-prop
// convention can't provide.
//
// Deliberately does NOT touch `document.documentElement`/`<body>` or
// theme.css's own `[data-theme]` attribute at all — see portalTheme.css's
// own header comment for why that separation is load-bearing, not
// incidental.
import { createContext, useContext } from 'react'
import { Outlet } from 'react-router-dom'

import usePortalTheme from '@/hooks/usePortalTheme'
import './portalTheme.css'

export const PortalThemeContext = createContext({ theme: 'light', toggleTheme: () => {} })

export function usePortalThemeContext() {
  return useContext(PortalThemeContext)
}

export default function PortalThemeRoot() {
  const { theme, toggleTheme } = usePortalTheme()

  return (
    <PortalThemeContext.Provider value={{ theme, toggleTheme }}>
      <div className="portal-theme-root" data-portal-theme={theme}>
        <Outlet />
      </div>
    </PortalThemeContext.Provider>
  )
}
