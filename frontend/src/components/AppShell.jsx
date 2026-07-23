// src/components/AppShell.jsx
//
// NOTE: this is a minimal, functional shell so Settings/Profile are
// actually reachable and reviewable in a browser — it is NOT the final
// AppShell design (sidebar, notifications bell, full nav, etc. are a
// separate, later piece of work). Everything in it is real and working
// (theme toggle, logout, nav), just deliberately unstyled/simple.
import { Link, useNavigate } from 'react-router-dom'
import { LogOut, Moon, Sun } from 'lucide-react'

import useAuthStore from '@/store/authStore'
import useTheme from '@/hooks/useTheme'

export default function AppShell({ children }) {
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  const navigate = useNavigate()
  const { isDark, toggleTheme } = useTheme()

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)' }}>
      <header
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 24px', borderBottom: '1px solid var(--border-subtle)',
          background: 'var(--bg-surface)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          <span style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-primary)', fontFamily: "'DM Sans', sans-serif" }}>
            LanceraOS
          </span>
          <nav style={{ display: 'flex', gap: 16 }}>
            <Link to="/profile" style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', textDecoration: 'none' }}>
              Profile
            </Link>
            <Link to="/settings" style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', textDecoration: 'none' }}>
              Settings
            </Link>
          </nav>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {user?.email && (
            <span style={{ fontSize: '0.82rem', color: 'var(--text-tertiary)' }}>{user.email}</span>
          )}
          <button
            onClick={toggleTheme}
            aria-label="Toggle theme"
            style={{ background: 'none', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: 6, cursor: 'pointer', display: 'flex', color: 'var(--text-secondary)' }}
          >
            {isDark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <button
            onClick={handleLogout}
            style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: '6px 12px', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '0.82rem' }}
          >
            <LogOut size={14} /> Log Out
          </button>
        </div>
      </header>

      <main>{children}</main>
    </div>
  )
}