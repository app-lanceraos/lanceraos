import { useState, useEffect, useCallback } from 'react'

/**
 * useTheme
 * Single source of truth for dark/light mode.
 * Reads/writes to localStorage under the key 'theme' —
 * the same key Landing.jsx already uses, so they stay in sync.
 *
 * Usage:
 *   const { theme, toggleTheme, isDark } = useTheme()
 *
 * The hook applies [data-theme] to <html> so CSS variables
 * from theme.css take effect everywhere.
 */
const THEME_KEY = 'lanceraos-theme'

export default function useTheme() {
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem(THEME_KEY) || localStorage.getItem('theme')
    if (saved === 'dark' || saved === 'light') return saved
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem(THEME_KEY, theme)
  }, [theme])

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e) => {
      const saved = localStorage.getItem(THEME_KEY)
      if (!saved) setTheme(e.matches ? 'dark' : 'light')
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  const toggleTheme = useCallback(() => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark')
  }, [])

  const setThemeValue = useCallback((val) => {
    if (val === 'dark' || val === 'light') setTheme(val)
  }, [])

  return { theme, toggleTheme, setThemeValue, isDark: theme === 'dark' }
}