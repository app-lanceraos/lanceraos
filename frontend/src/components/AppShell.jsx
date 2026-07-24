// src/components/AppShell.jsx
//
// Full v1-faithful port. Every nav group/item from v1 is included, even
// for modules that don't exist yet (Dashboard, Invoices, Clients,
// Payments, Expenses, P&L, Tax, Proposals, Contracts, Health, Income
// Certificate, Skill Analyzer) — this is a deliberate choice, not an
// oversight: clicking one of these today lands on a route App.jsx
// doesn't recognize, which redirects harmlessly back to /profile (no
// crash, no dead page) rather than a normal a click. As each module
// gets built, its route in App.jsx starts resolving and the same nav
// item becomes real with no further change needed here.
//
// The notification bell + panel UI is included and fully wired up on
// the frontend side, but there is no notifications backend yet —
// GET /notifications/ etc. will 404, which is caught and simply shows
// the same "No notifications yet" empty state v1 shows when the list
// is genuinely empty. No WebSocket connection is attempted (no
// backend to connect to).
//
// v1's notification-type icons and empty-state icon were bare emoji
// characters (🔔 👁 ✅ etc.) — replaced with lucide-react icons here,
// per the no-emoji rule.
//
// The AI assistant widget from v1 is NOT included — no AssistantWidget
// source was provided and it wasn't requested for this pass.
import { useCallback, useEffect, useRef, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import ReactDOM from 'react-dom'
import {
  Bell, CheckCircle2, Clock, CreditCard, DollarSign,
  FileText, HelpCircle, LayoutGrid, LogOut, Mail, RefreshCw,
  Receipt, Settings as SettingsIcon, TrendingUp, User as UserIcon,
  Users, Wallet, AlertTriangle, Eye,
} from 'lucide-react'

import useAuthStore from '@/store/authStore'
import useTheme from '@/hooks/useTheme'
import { initTooltipBindings } from '@/hooks/useAppTooltip'
import api from '@/lib/api'
import { LogoSVG, WordmarkSVG } from './Brand'

const PAGE_TITLES = {
  '/dashboard': 'Dashboard',
  '/invoices': 'Invoices',
  '/clients': 'Clients',
  '/payments': 'Payments',
  '/expenses': 'Expenses',
  '/pnl': 'Profit & Loss',
  '/tax': 'Tax',
  '/tax/guide': 'Tax Guide',
  '/health': 'Health Score',
  '/proposals': 'Proposals',
  '/contracts': 'Contracts',
  '/profile': 'Profile',
  '/settings': 'Settings',
  '/income-certificate': 'Income Certificate',
  '/skill-gap': 'Skill Analyzer',
}

// ── Nav groups — matches v1's structure exactly. Items for modules
// that don't exist yet will 404-redirect harmlessly until built. ──
const NAV_GROUPS = [
  {
    label: 'Menu',
    items: [
      { to: '/dashboard', label: 'Dashboard', tip: 'Dashboard', Icon: LayoutGrid, end: false },
      { to: '/invoices', label: 'Invoices', tip: 'Invoices', Icon: FileText, end: true },
      { to: '/clients', label: 'Clients', tip: 'Clients', Icon: Users, end: true },
    ],
  },
  {
    label: 'Finance',
    items: [
      { to: '/payments', label: 'Payments', tip: 'Payments', Icon: CreditCard, end: true },
      { to: '/expenses', label: 'Expenses', tip: 'Expenses', Icon: DollarSign, end: true },
      { to: '/pnl', label: 'P&L', tip: 'Profit & Loss', Icon: TrendingUp, end: true },
      { to: '/tax', label: 'Tax', tip: 'Tax', Icon: Receipt, end: false },
    ],
  },
  {
    label: 'Docs',
    items: [
      { to: '/proposals', label: 'Proposals', tip: 'Proposals', Icon: FileText, end: true },
      { to: '/contracts', label: 'Contracts', tip: 'Contracts', Icon: FileText, end: true },
    ],
  },
  {
    label: 'Account',
    items: [
      { to: '/health', label: 'Health Score', tip: 'Health Score', Icon: CheckCircle2, end: true },
      { to: '/income-certificate', label: 'Income Certificate', tip: 'Income Certificate', Icon: Receipt, end: true },
      { to: '/skill-gap', label: 'Skill Analyzer', tip: 'Skill Analyzer', Icon: TrendingUp, end: true },
    ],
  },
]

const NOTIF_ICONS = {
  invoice_viewed: Eye,
  invoice_paid: CheckCircle2,
  invoice_overdue: Clock,
  reminder_sent: Bell,
  payment_recorded: Wallet,
  recurring_generated: RefreshCw,
  payment_claimed: AlertTriangle,
  escalation_required: AlertTriangle,
  exchange_rate: DollarSign,
  custom_smtp_failed: Mail,
}

function relativeTime(iso) {
  try {
    const diff = Date.now() - new Date(iso).getTime()
    const mins = Math.floor(diff / 60000)
    const hours = Math.floor(diff / 3600000)
    const days = Math.floor(diff / 86400000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    if (hours < 24) return `${hours}h ago`
    if (days < 7) return `${days}d ago`
    return new Date(iso).toLocaleDateString()
  } catch { return '' }
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 36 36" fill="none" width="17" height="17">
      <path fill="currentColor" d="M12.5 8.473a10.968 10.968 0 0 1 8.785-.97 7.435 7.435 0 0 0-3.737 4.672l-.09.373A7.454 7.454 0 0 0 28.732 20.4a10.97 10.97 0 0 1-5.232 7.125l-.497.27c-5.014 2.566-11.175.916-14.234-3.813l-.295-.483C5.53 18.403 7.13 11.93 12.017 8.77l.483-.297Zm4.234.616a8.946 8.946 0 0 0-2.805.883l-.429.234A9 9 0 0 0 10.206 22.5l.241.395A9 9 0 0 0 22.5 25.794l.416-.255a8.94 8.94 0 0 0 2.167-1.99 9.433 9.433 0 0 1-2.782-.313c-5.043-1.352-8.036-6.535-6.686-11.578l.147-.491c.242-.745.573-1.44.972-2.078Z"/>
    </svg>
  )
}

function SunIcon() {
  return (
    <svg viewBox="0 0 36 36" fill="none" width="17" height="17">
      <path fill="currentColor" fillRule="evenodd" d="M18 12a6 6 0 1 1 0 12 6 6 0 0 1 0-12Zm0 2a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" clipRule="evenodd"/>
      <path fill="currentColor" d="M17 6.038a1 1 0 1 1 2 0v3a1 1 0 0 1-2 0v-3ZM24.244 7.742a1 1 0 1 1 1.618 1.176L24.1 11.345a1 1 0 1 1-1.618-1.176l1.763-2.427ZM29.104 13.379a1 1 0 0 1 .618 1.902l-2.854.927a1 1 0 1 1-.618-1.902l2.854-.927ZM29.722 20.795a1 1 0 0 1-.619 1.902l-2.853-.927a1 1 0 1 1 .618-1.902l2.854.927ZM25.862 27.159a1 1 0 0 1-1.618 1.175l-1.763-2.427a1 1 0 1 1 1.618-1.175l1.763 2.427ZM19 30.038a1 1 0 0 1-2 0v-3a1 1 0 1 1 2 0v3ZM11.755 28.334a1 1 0 0 1-1.618-1.175l1.764-2.427a1 1 0 1 1 1.618 1.175l-1.764 2.427ZM6.896 22.697a1 1 0 1 1-.618-1.902l2.853-.927a1 1 0 1 1 .618 1.902l-2.853.927ZM6.278 15.28a1 1 0 1 1 .618-1.901l2.853.927a1 1 0 1 1-.618 1.902l-2.853-.927ZM10.137 8.918a1 1 0 0 1 1.618-1.176l1.764 2.427a1 1 0 0 1-1.618 1.176l-1.764-2.427Z"/>
    </svg>
  )
}

function ThemeSwitch({ theme, onToggle, context }) {
  const idleColor = context === 'popup' ? 'var(--menu-text)' : 'var(--switch-idle)'
  const activeColor = context === 'popup' ? 'var(--menu-text-hover)' : 'var(--switch-active)'

  return (
    <div role="group" aria-label="Theme" style={{
      position: 'relative', display: 'flex', alignItems: 'center',
      gap: 2, padding: 3, borderRadius: '99em',
      background: 'color-mix(in srgb, var(--glass-tint) 10%, transparent)',
      backdropFilter: 'blur(12px) saturate(var(--saturation))',
      WebkitBackdropFilter: 'blur(12px) saturate(var(--saturation))',
      boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--glass-light) 8%, transparent), inset 1.5px 2px 0 -2px color-mix(in srgb, var(--glass-light) 70%, transparent), inset 0 -3px 4px -2px color-mix(in srgb, var(--glass-dark) 18%, transparent), 0 2px 6px 0 color-mix(in srgb, var(--glass-dark) 10%, transparent)',
    }}>
      <div style={{
        position: 'absolute', top: 3, left: 3,
        width: 30, height: 30, borderRadius: '99em',
        background: 'color-mix(in srgb, var(--glass-tint) 34%, transparent)',
        boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--glass-light) 10%, transparent), inset 2px 1px 0 -1px color-mix(in srgb, var(--glass-light) 80%, transparent), inset -1px 2px 3px -1px color-mix(in srgb, var(--glass-dark) 20%, transparent), 0 2px 5px 0 color-mix(in srgb, var(--glass-dark) 10%, transparent)',
        transform: theme === 'light' ? 'translateX(32px)' : 'translateX(0)',
        transition: 'transform var(--t)',
        zIndex: 0, pointerEvents: 'none',
      }} />
      {[{ val: 'dark', Icon: MoonIcon }, { val: 'light', Icon: SunIcon }].map(({ val, Icon }) => (
        <button
          key={val}
          onClick={() => onToggle(val)}
          aria-label={`${val} theme`}
          data-tooltip={val.charAt(0).toUpperCase() + val.slice(1) + ' theme'}
          style={{
            position: 'relative', zIndex: 1,
            width: 30, height: 30, border: 'none', background: 'transparent',
            borderRadius: '99em', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: theme === val ? activeColor : idleColor,
            transition: 'color var(--fast), transform 0.2s cubic-bezier(0.5,0,0,1)',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--nav-active)'; e.currentTarget.style.transform = 'scale(1.12)' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = theme === val ? activeColor : idleColor; e.currentTarget.style.transform = 'scale(1)' }}
        >
          <Icon />
        </button>
      ))}
    </div>
  )
}

function PopupItem({ icon, label, onClick, danger }) {
  return (
    <button
      onClick={onClick}
      className={`popup-item${danger ? ' danger' : ''}`}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '8px 12px', borderRadius: 9,
        color: danger ? 'var(--danger)' : 'var(--menu-text)',
        fontSize: 13, whiteSpace: 'nowrap', textDecoration: 'none',
        cursor: 'pointer', userSelect: 'none', border: 'none', background: 'transparent',
        width: '100%', textAlign: 'left', fontFamily: 'var(--font)',
        transition: 'background var(--fast), color var(--fast)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = danger ? 'var(--danger-hover)' : 'var(--menu-hover-bg)'
        if (!danger) e.currentTarget.style.color = 'var(--menu-text-hover)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent'
        e.currentTarget.style.color = danger ? 'var(--danger)' : 'var(--menu-text)'
      }}
    >
      <span className="nav-icon" style={{ width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        {icon}
      </span>
      {label}
    </button>
  )
}

function ProfilePopup({ position, theme, onSetTheme, collapsed, onNavigate, onSignOut, onClose }) {
  useEffect(() => {
    const handler = (e) => {
      if (!e.target.closest('#profile-popup') && !e.target.closest('.profile-row')) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  return ReactDOM.createPortal(
    <div id="profile-popup" style={{
      position: 'fixed',
      bottom: position.bottom,
      left: position.left,
      top: 'auto', right: 'auto',
      width: 240, padding: 6,
      borderRadius: 14,
      background: 'var(--menu-bg)',
      display: 'flex', flexDirection: 'column', gap: 2,
      backdropFilter: 'blur(24px) saturate(var(--saturation))',
      WebkitBackdropFilter: 'blur(24px) saturate(var(--saturation))',
      boxShadow: '0 -8px 32px rgba(0,0,0,0.55), 0 8px 32px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.07)',
      zIndex: 100000,
      fontFamily: 'var(--font)',
      animation: 'shell-popup-in 0.15s ease',
    }}>
      {collapsed && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '6px 6px 12px', marginBottom: 6,
          borderBottom: '1px solid var(--divider)',
        }}>
          <ThemeSwitch theme={theme} onToggle={onSetTheme} context="popup" />
        </div>
      )}
      <PopupItem icon={<UserIcon size={18} />} label="Profile" onClick={() => { onNavigate('/profile'); onClose() }} />
      <PopupItem icon={<SettingsIcon size={18} />} label="Settings" onClick={() => { onNavigate('/settings'); onClose() }} />
      <PopupItem icon={<HelpCircle size={18} />} label="Help" onClick={() => { onClose() }} />
      <PopupItem icon={<LogOut size={18} />} label="Sign out" danger onClick={() => { onSignOut(); onClose() }} />
      <style>{`
        @keyframes shell-popup-in {
          from { opacity: 0; transform: scale(0.95) translateY(6px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
    </div>,
    document.body,
  )
}

export default function AppShell({ children }) {
  const navigate = useNavigate()
  const location = useLocation()
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  const { theme, setThemeValue } = useTheme()

  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 768)
  const isMobileRef = useRef(window.innerWidth <= 768)
  const [collapsed, setCollapsed] = useState(() => {
    if (window.innerWidth <= 768) return false
    return localStorage.getItem('lanceraos_sidebar_collapsed') === 'true'
  })
  const [mobileOpen, setMobileOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [popupPos, setPopupPos] = useState({ left: 8, bottom: 60 })
  const [profileLogo, setProfileLogo] = useState(null)

  const sidebarRef = useRef(null)
  const pillRef = useRef(null)
  const resizeTimer = useRef(null)
  const profileRowRef = useRef(null)
  const collapsedRef = useRef(collapsed)
  const mobileOpenRef = useRef(false)

  // Notifications — UI fully wired, no backend behind it yet. Fetches
  // fail silently and just leave the list empty (the same empty state
  // that would show for a genuinely-empty inbox), rather than
  // attempting a WebSocket connection with nothing to connect to.
  const [showNotifPanel, setShowNotifPanel] = useState(false)
  const [notifications, setNotifications] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [notifLoading, setNotifLoading] = useState(false)
  const notifRef = useRef(null)
  const notifPanelRef = useRef(null)

  useEffect(() => { collapsedRef.current = collapsed }, [collapsed])
  useEffect(() => { mobileOpenRef.current = mobileOpen }, [mobileOpen])

  const collapsedGroupStyle = collapsed && !isMobile ? {
    alignItems: 'center',
    background: 'color-mix(in srgb, var(--glass-tint) 12%, transparent)',
    backdropFilter: 'blur(var(--glass-blur)) saturate(var(--saturation))',
    WebkitBackdropFilter: 'blur(var(--glass-blur)) saturate(var(--saturation))',
    boxShadow: 'var(--glass-shadow)',
  } : {}

  const placePill = useCallback((instant) => {
    const pill = pillRef.current
    if (!pill) return
    if (isMobileRef.current && !mobileOpenRef.current) { pill.style.opacity = '0'; return }
    const active = sidebarRef.current?.querySelector('.nav-item.active')
    if (!active) { pill.style.opacity = '0'; return }
    const isCol = collapsedRef.current && !isMobileRef.current
    const apply = () => {
      pill.style.borderRadius = isCol ? '50%' : '99em'
      pill.style.width = active.offsetWidth + 'px'
      pill.style.height = active.offsetHeight + 'px'
      pill.style.transform = `translate(${active.offsetLeft}px, ${active.offsetTop}px)`
      pill.style.opacity = '1'
    }
    if (instant) {
      pill.classList.add('no-anim')
      apply()
      requestAnimationFrame(() => requestAnimationFrame(() => pill.classList.remove('no-anim')))
    } else {
      pill.classList.remove('no-anim')
      apply()
    }
  }, [])

  useEffect(() => {
    if (mobileOpen && isMobile) setMobileOpen(false)
    requestAnimationFrame(() => {
      placePill(false)
      const active = sidebarRef.current?.querySelector('.nav-item.active')
      if (active) active.scrollIntoView({ block: 'nearest', behavior: 'auto' })
    })
  }, [location.pathname]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (isMobile) return
    const pill = pillRef.current
    if (pill) pill.style.opacity = '0'
    const aside = sidebarRef.current
    let done = false
    const settle = () => { if (!done) { done = true; placePill(true) } }
    const onEnd = (e) => { if (e.target === aside && e.propertyName === 'width') settle() }
    aside?.addEventListener('transitionend', onEnd)
    const fallback = setTimeout(settle, 380)
    return () => { aside?.removeEventListener('transitionend', onEnd); clearTimeout(fallback) }
  }, [collapsed, placePill]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isMobileRef.current) return
    if (!mobileOpen) { if (pillRef.current) pillRef.current.style.opacity = '0'; return }
    requestAnimationFrame(() => {
      placePill(true)
      const active = sidebarRef.current?.querySelector('.nav-item.active')
      if (active) active.scrollIntoView({ block: 'nearest', behavior: 'auto' })
    })
  }, [mobileOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    requestAnimationFrame(() => placePill(true))
    setTimeout(() => initTooltipBindings(), 100)
  }, [placePill])

  useEffect(() => {
    const onResize = () => {
      clearTimeout(resizeTimer.current)
      resizeTimer.current = setTimeout(() => {
        const mobile = window.innerWidth <= 768
        isMobileRef.current = mobile
        setIsMobile(mobile)
        if (mobile) {
          setMobileOpen(false)
          if (pillRef.current) pillRef.current.style.opacity = '0'
        } else {
          setTimeout(() => placePill(true), 360)
        }
      }, 150)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [placePill])

  useEffect(() => {
    if (!isMobile) document.body.classList.toggle('collapsed', collapsed)
    else document.body.classList.remove('collapsed')
    return () => document.body.classList.remove('collapsed')
  }, [collapsed, isMobile])

  useEffect(() => {
    const id = setTimeout(() => initTooltipBindings(), 60)
    return () => clearTimeout(id)
  }, [collapsed, isMobile])

  useEffect(() => {
    document.body.classList.add('app-shell-active')
    document.documentElement.classList.add('app-shell-active')
    return () => {
      document.body.classList.remove('app-shell-active')
      document.documentElement.classList.remove('app-shell-active')
    }
  }, [])

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') { setMobileOpen(false); setProfileOpen(false); setShowNotifPanel(false) } }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  useEffect(() => {
    if (!showNotifPanel) return
    const handler = (e) => {
      const inBell = notifRef.current && notifRef.current.contains(e.target)
      const inPanel = notifPanelRef.current && notifPanelRef.current.contains(e.target)
      if (!inBell && !inPanel) setShowNotifPanel(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showNotifPanel])

  useEffect(() => {
    const cached = sessionStorage.getItem('profile_logo')
    if (cached) { setProfileLogo(cached); return }
    api.get('/auth/profile/').then((r) => {
      if (r.data.logo) {
        setProfileLogo(r.data.logo)
        sessionStorage.setItem('profile_logo', r.data.logo)
      }
    }).catch(() => {})
  }, [])

  const fetchNotifications = async () => {
    setNotifLoading(true)
    try {
      const { data } = await api.get('/notifications/')
      setNotifications(data.notifications || [])
      setUnreadCount(data.unread_count || 0)
    } catch {
      // No notifications backend yet — same empty state as a genuinely empty inbox.
      setNotifications([])
      setUnreadCount(0)
    } finally {
      setNotifLoading(false)
    }
  }

  const markAllRead = async () => {
    try {
      await api.post('/notifications/read-all/')
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })))
      setUnreadCount(0)
    } catch { /* no backend yet */ }
  }

  const markOneRead = async (id) => {
    try {
      await api.post(`/notifications/${id}/read/`)
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)))
      setUnreadCount((prev) => Math.max(0, prev - 1))
    } catch { /* no backend yet */ }
  }

  const openNotifPanel = () => { setShowNotifPanel(true); fetchNotifications() }

  const handleLogout = () => { logout(); navigate('/login') }

  const toggleSidebar = () => {
    if (isMobile) {
      setMobileOpen((v) => !v)
    } else {
      setCollapsed((v) => {
        const next = !v
        localStorage.setItem('lanceraos_sidebar_collapsed', String(next))
        return next
      })
    }
  }

  const toggleProfile = () => {
    if (!profileOpen && profileRowRef.current && sidebarRef.current) {
      const row = profileRowRef.current.getBoundingClientRect()
      const side = sidebarRef.current.getBoundingClientRect()
      const W = 240
      const margin = 10
      const left = Math.max(margin, Math.min(side.left + 8, window.innerWidth - W - margin))
      const bottom = window.innerHeight - row.top + 8
      setPopupPos({ left, bottom })
    }
    setProfileOpen((v) => !v)
  }

  const avatarSrc = user?.profile_logo || profileLogo
  const displayName = user?.first_name ? `${user.first_name} ${user.last_name || ''}`.trim() : user?.username || ''
  const pageTitle = PAGE_TITLES[location.pathname] || 'LanceraOS'

  const mainLeft = isMobile ? 0 : (collapsed ? 'var(--sidebar-collapsed)' : 'var(--sidebar-w)')
  const mainRight = isMobile ? 0 : 16

  return (
    <>
      {/* ── Header ── */}
      <header style={{
        position: 'fixed', inset: '0 0 auto 0',
        height: 'var(--header-h)',
        background: 'var(--bg)',
        display: 'flex', alignItems: 'center',
        zIndex: 350,
        transition: 'background var(--t)',
        fontFamily: 'var(--font)',
      }}>
        <div style={{
          display: isMobile ? 'none' : 'flex',
          alignItems: 'center', gap: 10,
          height: '100%', padding: '0 16px', flexShrink: 0,
        }}>
          <a href="/profile" style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <div style={{ width: 32, height: 32, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <LogoSVG size={32} />
            </div>
            <div style={{
              display: 'flex', alignItems: 'center',
              height: 20, overflow: 'hidden',
              opacity: collapsed ? 0 : 1,
              maxWidth: collapsed ? 0 : 160,
              transition: 'opacity var(--t), max-width var(--t)',
            }}>
              <WordmarkSVG width={107} height={16} />
            </div>
          </a>
          <button
            onClick={toggleSidebar}
            data-tooltip={collapsed ? 'Open sidebar' : 'Close sidebar'}
            aria-label={collapsed ? 'Open sidebar' : 'Close sidebar'}
            style={{
              width: 32, height: 32, marginLeft: 2,
              border: 'none', borderRadius: 8, background: 'transparent',
              cursor: 'pointer', display: 'flex', alignItems: 'center',
              justifyContent: 'center', color: 'var(--header-icon)',
              transform: collapsed ? 'rotate(0deg)' : 'rotate(180deg)',
              transition: 'background var(--fast), color var(--fast), transform var(--t)',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--accent-hover)'; e.currentTarget.style.color = 'var(--nav-active)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--header-icon)' }}
          >
            <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
              <path d="M1.9 1.44L9.9 9.44L1.9 17.44" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M7.8 1.44L15.8 9.44L7.8 17.44" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>

        {isMobile && (
          <a href="/profile">
            <div style={{ display: 'flex', alignItems: 'center', padding: '0 8px 0 14px', height: '100%', flexShrink: 0 }}>
              <LogoSVG size={30} />
            </div>
          </a>
        )}

        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px 0 18px', minWidth: 0 }}>
          <span style={{
            fontSize: 22, fontWeight: 400, letterSpacing: '-0.04em',
            color: 'var(--header-title)', whiteSpace: 'nowrap',
            overflow: 'hidden', textOverflow: 'ellipsis',
            fontFamily: 'var(--font)',
          }}>
            {pageTitle}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            {/* Notification bell */}
            <div ref={notifRef}>
              <button
                data-tooltip="Notifications"
                aria-label="Notifications"
                onClick={() => (showNotifPanel ? setShowNotifPanel(false) : openNotifPanel())}
                style={{
                  position: 'relative', width: 38, height: 38,
                  border: 'none', borderRadius: '50%', background: 'transparent',
                  cursor: 'pointer', display: 'flex', alignItems: 'center',
                  justifyContent: 'center', color: 'var(--header-icon)',
                  transition: 'background var(--fast), color var(--fast)',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--nav-hover-bg)'; e.currentTarget.style.color = 'var(--nav-active)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--header-icon)' }}
              >
                <Bell size={20} strokeWidth={1.6} />
                {unreadCount > 0 && (
                  <span style={{
                    position: 'absolute', top: 7, right: 8,
                    width: 9, height: 9, borderRadius: '50%',
                    background: 'var(--notif)',
                    boxShadow: '0 0 0 2px var(--bg)',
                  }} />
                )}
              </button>
            </div>
            {isMobile && (
              <button
                onClick={toggleSidebar}
                aria-label="Open menu"
                style={{
                  display: 'flex', width: 40, height: 40, border: 'none', background: 'transparent',
                  cursor: 'pointer', alignItems: 'center', justifyContent: 'center',
                  borderRadius: 8, color: 'var(--header-icon)',
                  transition: 'background var(--fast), color var(--fast)',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--accent-hover)'; e.currentTarget.style.color = 'var(--nav-active)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--header-icon)' }}
              >
                <svg viewBox="0 0 24 24" width="22" height="22">
                  <rect x="3" y="5" width="18" height="2" rx="1" fill="currentColor" style={{ transformOrigin: 'center', transition: 'transform 0.34s cubic-bezier(0.65,0,0.35,1), opacity 0.2s ease', transform: mobileOpen ? 'translateY(7px) rotate(45deg)' : 'none' }} />
                  <rect x="3" y="11" width="18" height="2" rx="1" fill="currentColor" style={{ transformOrigin: 'center', transition: 'transform 0.34s cubic-bezier(0.65,0,0.35,1), opacity 0.2s ease', opacity: mobileOpen ? 0 : 1, transform: mobileOpen ? 'scaleX(0.4)' : 'none' }} />
                  <rect x="3" y="17" width="18" height="2" rx="1" fill="currentColor" style={{ transformOrigin: 'center', transition: 'transform 0.34s cubic-bezier(0.65,0,0.35,1), opacity 0.2s ease', transform: mobileOpen ? 'translateY(-7px) rotate(-45deg)' : 'none' }} />
                </svg>
              </button>
            )}
          </div>
        </div>
      </header>

      {isMobile && (
        <div
          onClick={() => setMobileOpen(false)}
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(0,0,0,0.65)', zIndex: 150,
            opacity: mobileOpen ? 1 : 0,
            pointerEvents: mobileOpen ? 'all' : 'none',
            transition: 'opacity 0.28s ease',
          }}
        />
      )}

      {/* ── Sidebar ── */}
      <aside
        ref={sidebarRef}
        style={{
          position: 'fixed',
          top: isMobile ? 0 : 'var(--header-h)',
          left: 0, bottom: 0,
          width: isMobile ? 'var(--sidebar-w)' : (collapsed ? 'var(--sidebar-collapsed)' : 'var(--sidebar-w)'),
          background: 'var(--bg)',
          display: 'flex', flexDirection: 'column',
          overflowY: 'hidden', overflowX: 'hidden',
          zIndex: isMobile ? 400 : 250,
          transition: 'width var(--t), transform var(--t), background var(--t)',
          transform: isMobile ? (mobileOpen ? 'translateX(0)' : 'translateX(-100%)') : 'none',
          height: isMobile ? '100dvh' : undefined,
          fontFamily: 'var(--font)',
        }}
      >
        {isMobile && (
          <a href="/profile">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 16px', height: 'var(--header-h)', flexShrink: 0 }}>
              <LogoSVG size={30} />
              <div style={{ display: 'flex', alignItems: 'center', height: 20 }}>
                <WordmarkSVG width={107} height={16} />
              </div>
            </div>
          </a>
        )}

        <nav
          className={`shell-nav${mobileOpen ? ' mobile-nav-open' : ''}`}
          style={{
            flex: '1 1 0%', overflowY: (collapsed && !isMobile) ? 'hidden' : 'auto',
            overflowX: 'hidden', minHeight: 0,
            padding: (collapsed && !isMobile) ? '0 8px 12px' : '14px 8px 8px', display: 'flex',
            flexDirection: 'column', gap: 4,
            scrollbarWidth: 'thin',
          }}
        >
          <div className="nav-capsule" style={{
            position: 'relative', display: 'flex', flexDirection: 'column',
            gap: 1, padding: (collapsed && !isMobile) ? 8 : 2, marginBottom: 4,
            borderRadius: '99em',
            ...((collapsed && !isMobile) ? { flex: '0 1 auto', minHeight: 0, overflowY: 'auto', overflowX: 'hidden', scrollbarWidth: 'none' } : {}),
            transition: 'background var(--t), backdrop-filter var(--t), box-shadow var(--t), padding var(--t)',
            ...collapsedGroupStyle,
          }}>
            <div ref={pillRef} className="nav-pill" />

            {NAV_GROUPS.map((group) => (
              <div key={group.label} className="nav-group">
                {(!collapsed || isMobile) && <div className="group-label">{group.label}</div>}
                {group.items.map(({ to, label, tip, Icon, end }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={end !== false}
                    data-tip={tip}
                    data-tooltip={(collapsed && !isMobile) ? tip : undefined}
                    className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
                    style={{ display: 'flex', alignItems: 'center', fontSize: '13.5px', whiteSpace: 'nowrap', textDecoration: 'none', cursor: 'pointer', userSelect: 'none' }}
                  >
                    <span className="nav-icon" style={{ width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Icon size={18} />
                    </span>
                    {(!collapsed || isMobile) && <span style={{ overflow: 'hidden', whiteSpace: 'nowrap' }}>{label}</span>}
                  </NavLink>
                ))}
              </div>
            ))}
          </div>
        </nav>

        {/* Sidebar bottom: theme switch + profile */}
        <div style={{
          position: 'relative', zIndex: 2, display: 'flex', flexDirection: 'column', gap: 2,
          margin: (collapsed && !isMobile) ? '0 0 8px' : '0 8px 8px',
          padding: (collapsed && !isMobile) ? '8px 0 0' : 8,
          borderRadius: (collapsed && !isMobile) ? 0 : '99em',
          alignItems: (collapsed && !isMobile) ? 'center' : undefined,
          justifyContent: (collapsed && !isMobile) ? 'center' : undefined,
          flexShrink: 0,
          background: 'var(--bg)',
          transition: 'background var(--t), padding var(--t), margin var(--t)',
        }}>
          {(!collapsed || isMobile) && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', padding: '4px 4px 8px' }}>
              <ThemeSwitch theme={theme} onToggle={setThemeValue} context="sidebar" />
            </div>
          )}

          <div
            ref={profileRowRef}
            className="profile-row"
            onClick={toggleProfile}
            style={{
              display: 'flex', alignItems: 'center',
              justifyContent: (collapsed && !isMobile) ? 'center' : 'flex-start',
              gap: (collapsed && !isMobile) ? 0 : 8,
              padding: (collapsed && !isMobile) ? 0 : '6px 8px',
              borderRadius: '99em',
              cursor: 'pointer', userSelect: 'none',
              transition: 'background var(--fast), padding var(--t)',
            }}
            onMouseEnter={(e) => { if (!collapsed) e.currentTarget.style.background = 'var(--nav-hover-bg)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
          >
            <div style={{
              width: 32, height: 32, borderRadius: '50%',
              background: 'var(--avatar-bg)',
              border: '1px solid var(--profile-b)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0, overflow: 'hidden', color: 'var(--profile-name)',
              boxSizing: 'border-box',
            }}>
              {avatarSrc
                ? <img src={avatarSrc} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <UserIcon size={16} />}
            </div>

            {(!collapsed || isMobile) && (
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                <span style={{ fontSize: '12.5px', fontWeight: 500, color: 'var(--profile-name)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {displayName || user?.email?.split('@')[0] || ''}
                </span>
                <span style={{ fontSize: '10.5px', color: 'var(--profile-email)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {user?.email}
                </span>
              </div>
            )}

            {(!collapsed || isMobile) && (
              <span style={{ flexShrink: 0, width: 22, height: 22, color: 'var(--chevron)', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'transform 0.22s ease', transform: profileOpen ? 'rotate(180deg)' : 'none' }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                  <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            )}
          </div>
        </div>
      </aside>

      {profileOpen && (
        <ProfilePopup
          position={popupPos}
          theme={theme}
          onSetTheme={setThemeValue}
          collapsed={collapsed && !isMobile}
          onNavigate={navigate}
          onSignOut={handleLogout}
          onClose={() => setProfileOpen(false)}
        />
      )}

      {/* ── Main content: fixed frame + inner scroll ── */}
      <div style={{
        position: 'fixed',
        top: 'var(--header-h)',
        left: mainLeft, right: mainRight, bottom: 0,
        background: 'var(--surface)',
        borderRadius: 'var(--radius) var(--radius) 0 0',
        overflow: 'hidden',
        transition: 'left var(--t), background var(--t)',
      }}>
        <div style={{ height: '100%', overflowY: 'auto', overflowX: 'hidden', WebkitOverflowScrolling: 'touch', padding: isMobile ? '20px 16px' : '32px' }}>
          {children}
        </div>
      </div>

      {/* ── Notification panel ── */}
      {showNotifPanel && (
        <div ref={notifPanelRef} style={{
          position: 'fixed',
          top: 'calc(var(--header-h) + 4px)',
          right: 12,
          width: 360,
          maxWidth: 'calc(100vw - 24px)',
          maxHeight: 480,
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
          zIndex: 500,
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
          animation: 'shell-popup-in 0.15s ease',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
            <span style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--text-primary)' }}>
              Notifications
              {unreadCount > 0 && (
                <span style={{ marginLeft: 8, background: '#ef4444', color: '#fff', fontSize: '0.65rem', fontWeight: 700, borderRadius: '999px', padding: '1px 6px' }}>
                  {unreadCount}
                </span>
              )}
            </span>
            {unreadCount > 0 && (
              <button onClick={markAllRead} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.75rem', color: 'var(--accent)', padding: '2px 6px', borderRadius: 'var(--radius-sm)' }}>
                Mark all read
              </button>
            )}
          </div>
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {notifLoading && (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '0.8rem' }}>
                Loading…
              </div>
            )}
            {!notifLoading && notifications.length === 0 && (
              <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '0.82rem' }}>
                <Bell size={24} style={{ marginBottom: 8, opacity: 0.5 }} />
                <div>No notifications yet</div>
              </div>
            )}
            {!notifLoading && notifications.map((n) => {
              const NIcon = NOTIF_ICONS[n.type] || FileText
              return (
                <div
                  key={n.id}
                  onClick={() => {
                    if (!n.is_read) markOneRead(n.id)
                    setShowNotifPanel(false)
                    if (n.action_url) navigate(n.action_url)
                  }}
                  style={{
                    padding: '12px 16px', borderBottom: '1px solid var(--border-subtle)',
                    cursor: n.action_url ? 'pointer' : 'default',
                    background: n.is_read ? 'transparent' : 'rgba(0,200,150,0.04)',
                    display: 'flex', gap: 10, alignItems: 'flex-start',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={(e) => { if (n.action_url) e.currentTarget.style.background = 'var(--bg-surface-2)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = n.is_read ? 'transparent' : 'rgba(0,200,150,0.04)' }}
                >
                  <span style={{ flexShrink: 0, color: 'var(--text-tertiary)', display: 'flex', marginTop: 2 }}>
                    <NIcon size={16} />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: '0.8rem', fontWeight: n.is_read ? 400 : 600, color: 'var(--text-primary)', lineHeight: 1.4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {n.title}
                    </p>
                    <p style={{ margin: '2px 0 0', fontSize: '0.72rem', color: 'var(--text-tertiary)', lineHeight: 1.4 }}>
                      {n.message?.length > 80 ? n.message.slice(0, 80) + '...' : n.message}
                    </p>
                    <p style={{ margin: '3px 0 0', fontSize: '0.68rem', color: 'var(--text-tertiary)' }}>
                      {relativeTime(n.created_at)}
                    </p>
                  </div>
                  {!n.is_read && <div style={{ width: 7, height: 7, background: '#00c896', borderRadius: '50%', flexShrink: 0, marginTop: 4 }} />}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </>
  )
}