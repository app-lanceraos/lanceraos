// src/pages/Settings.jsx
import { useEffect, useState } from 'react'
import {
  Bell, Briefcase, Laptop2, Mail as MailIcon, Receipt, ShieldCheck, User as UserIcon,
} from 'lucide-react'

import api from '@/lib/api'
import useTitle from '@/hooks/useTitle'
import AccountSection from './settings/AccountSection'
import SecuritySection from './settings/SecuritySection'
import BusinessSection from './settings/BusinessSection'
import TaxSection from './settings/TaxSection'
import SessionsSection from './settings/SessionsSection'
import NotificationsSection from './settings/NotificationsSection'
import SmtpSection from './settings/SmtpSection'

const TABS = [
  { id: 'account', label: 'Account', Icon: UserIcon },
  { id: 'business', label: 'Business', Icon: Briefcase },
  { id: 'tax', label: 'Tax & PSEB', Icon: Receipt },
  { id: 'security', label: 'Security', Icon: ShieldCheck },
  { id: 'sessions', label: 'Sessions', Icon: Laptop2 },
  { id: 'notifications', label: 'Notifications', Icon: Bell },
  { id: 'smtp', label: 'Email Sending', Icon: MailIcon },
]

function TabNav({ active, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border-subtle)', marginBottom: 20, overflowX: 'auto' }}>
      {TABS.map((tab) => {
        const isActive = active === tab.id
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '10px 16px', background: 'none', border: 'none',
              borderBottom: isActive ? '2px solid var(--accent)' : '2px solid transparent',
              color: isActive ? 'var(--text-primary)' : 'var(--text-tertiary)',
              fontWeight: isActive ? 600 : 500, fontSize: '0.875rem',
              cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: "'DM Sans', sans-serif",
              transition: 'color 0.15s ease, border-color 0.15s ease',
            }}
          >
            <tab.Icon size={15} />
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}

export default function Settings() {
  useTitle('LanceraOS | Settings')
  const [activeTab, setActiveTab] = useState('account')

  // Business and Tax both read/write the same FreelancerProfile object —
  // fetched once here so switching between those two tabs doesn't
  // re-fetch, and a save in one tab is immediately reflected if the
  // other is revisited in the same session.
  const [profile, setProfile] = useState(null)
  const [profileLoading, setProfileLoading] = useState(true)

  useEffect(() => {
    api.get('/auth/profile/')
      .then((res) => setProfile(res.data))
      .catch(() => {})
      .finally(() => setProfileLoading(false))
  }, [])

  const handleProfileUpdate = (patch) => {
    setProfile((prev) => ({ ...prev, ...patch }))
  }

  return (
    <div style={{ width: '100%' }}>
      <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4, fontFamily: "'DM Sans', sans-serif" }}>
        Settings
      </h1>
      <p style={{ fontSize: '0.875rem', color: 'var(--text-tertiary)', marginBottom: 20 }}>
        Manage your account, business details, security, and preferences.
      </p>

      <TabNav active={activeTab} onChange={setActiveTab} />

      {activeTab === 'account' && <AccountSection />}
      {activeTab === 'business' && <BusinessSection profile={profile} loading={profileLoading} onProfileUpdate={handleProfileUpdate} />}
      {activeTab === 'tax' && <TaxSection profile={profile} loading={profileLoading} onProfileUpdate={handleProfileUpdate} />}
      {activeTab === 'security' && <SecuritySection />}
      {activeTab === 'sessions' && <SessionsSection />}
      {activeTab === 'notifications' && <NotificationsSection />}
      {activeTab === 'smtp' && <SmtpSection />}

      <style>{`
        .settings-grid-2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 14px; }
      `}</style>
    </div>
  )
}