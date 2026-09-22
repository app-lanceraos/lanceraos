// src/hooks/usePortalTheme.js
//
// Client Portal Redesign, Phase 3.5 — the portal's own dark/light theme
// state, deliberately separate from useTheme.js (the authenticated app's
// own hook, which applies `[data-theme]` to `document.documentElement`).
// This hook applies nothing to the DOM itself — PortalThemeRoot.jsx sets
// `data-portal-theme` declaratively on its own scoped wrapper div, not
// via a manual `setAttribute` call, since (unlike useTheme.js) this
// component owns direct render control over the one element that needs
// the attribute. Mirrors useTheme.js's own localStorage/matchMedia shape
// closely (same addEventListener('change', ...) convention, never the
// deprecated addListener) under a distinct, portal-only storage key so
// the two preferences never collide or read each other's value.
import { useCallback, useEffect, useState } from 'react'

const PORTAL_THEME_KEY = 'lanceraos-portal-theme'

export default function usePortalTheme() {
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem(PORTAL_THEME_KEY)
    if (saved === 'dark' || saved === 'light') return saved
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })

  useEffect(() => {
    localStorage.setItem(PORTAL_THEME_KEY, theme)
  }, [theme])

  // Only follow a LIVE OS preference change while the visitor has never
  // made an explicit choice on this device — the same "saved value wins"
  // rule useTheme.js already establishes.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e) => {
      const saved = localStorage.getItem(PORTAL_THEME_KEY)
      if (!saved) setTheme(e.matches ? 'dark' : 'light')
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))
  }, [])

  return { theme, toggleTheme, isDark: theme === 'dark' }
}
