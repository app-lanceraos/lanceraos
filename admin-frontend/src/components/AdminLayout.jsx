// src/components/AdminLayout.jsx
import { Link, Outlet, useLocation } from 'react-router-dom'
import useAdminAuthStore from '@/store/adminAuthStore'
import { LogoSVG, WordmarkSVG } from './Brand'

const navLink = (active) => ({
  color: active ? 'var(--accent)' : 'var(--text-secondary)',
  textDecoration: 'none', fontSize: '0.82rem', fontWeight: active ? 700 : 500,
})

export default function AdminLayout() {
  const admin = useAdminAuthStore((s) => s.admin)
  const logout = useAdminAuthStore((s) => s.logout)
  const location = useLocation()

  return (
    <div style={{ minHeight: '100vh' }}>
      <header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 24px', borderBottom: '1px solid var(--border-subtle)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
          <Link to="/users" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
            <LogoSVG size={24} />
            <WordmarkSVG width={86} height={13} />
            <span style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', marginLeft: 4 }}>Admin</span>
          </Link>
          <nav style={{ display: 'flex', gap: 18 }}>
            <Link to="/users" style={navLink(location.pathname.startsWith('/users'))}>Users</Link>
            <Link to="/audit-log" style={navLink(location.pathname === '/audit-log')}>Audit Log</Link>
            <Link to="/deletion-queue" style={navLink(location.pathname === '/deletion-queue')}>Deletion Queue</Link>
          </nav>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
            {admin?.email}
            {admin?.is_super_admin && <span style={{ color: 'var(--accent)', marginLeft: 6 }}>· super-admin</span>}
          </span>
          <button
            onClick={logout}
            style={{ padding: '6px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)', background: 'var(--bg-surface-2)', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '0.8rem' }}
          >
            Sign out
          </button>
        </div>
      </header>
      <main style={{ padding: 24, maxWidth: 900, margin: '0 auto' }}>
        <Outlet />
      </main>
    </div>
  )
}