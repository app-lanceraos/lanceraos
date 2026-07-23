// src/pages/DeletionReview.jsx
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'

import api from '@/lib/api'
import useAuthStore from '@/store/authStore'
import useTitle from '@/hooks/useTitle'

const PALETTE = {
  pageBg: '#050508',
  cardBg: '#0B0916',
  cardBorder: '#221C3D',
  borderSub: '#1C1733',
  white: '#FFFFFF',
  subtext: '#C7C7C7',
  placeholder: '#8074C0',
  linkPurple: '#A89CF2',
  signinBg: '#A89CF2',
  signinText: '#F6F4FE',
  success: '#5FD08A',
  error: '#F2748B',
  info: '#6FA8FF',
}

function DangerButton({ children, onClick, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
        width: '100%', padding: '11px 20px', borderRadius: 20, border: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: "'DM Sans', sans-serif",
        fontWeight: 500, fontSize: '0.9rem', background: PALETTE.error, color: '#2A0A12',
        opacity: disabled ? 0.6 : 1, transition: 'opacity 0.15s ease',
      }}
    >
      {children}
    </button>
  )
}

function GhostButton({ children, onClick, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
        width: '100%', padding: '11px 20px', borderRadius: 20,
        border: `1px solid ${PALETTE.cardBorder}`, background: 'transparent', color: PALETTE.subtext,
        cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: "'DM Sans', sans-serif",
        fontWeight: 500, fontSize: '0.9rem', opacity: disabled ? 0.6 : 1, transition: 'opacity 0.15s ease',
      }}
    >
      {children}
    </button>
  )
}

function PrimaryButton({ children, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
        width: '100%', padding: '11px 20px', borderRadius: 20, border: 'none',
        cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", fontWeight: 500,
        fontSize: '0.9rem', background: PALETTE.signinBg, color: PALETTE.signinText,
      }}
    >
      {children}
    </button>
  )
}

export default function DeletionReview() {
  useTitle('LanceraOS | Account Deletion')
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const user = useAuthStore((s) => s.user)
  const clearLocalAuth = useAuthStore((s) => s.clearLocalAuth)
  const deletionToken = params.get('token')

  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  const scheduledDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    .toLocaleDateString('en-PK', { dateStyle: 'long' })

  useEffect(() => {
    if (!deletionToken) navigate('/profile', { replace: true })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleConfirm = async () => {
    setConfirming(true)
    setError('')
    try {
      await api.post('/auth/deletion/confirm/', { deletion_token: deletionToken })
      // The confirm call itself already revokes every session and clears
      // cookies server-side — the session is already dead by the time
      // this resolves, so calling the network-based logout() again would
      // be redundant (and would hit an already-invalidated session).
      // clearLocalAuth() just syncs the in-memory state to match reality.
      clearLocalAuth()
      setDone(true)
    } catch (err) {
      setError(err.response?.data?.error || 'Something went wrong. Please try again.')
      setConfirming(false)
    }
  }

  const pageStyle = {
    minHeight: '100vh',
    background: PALETTE.pageBg,
    backgroundImage: 'radial-gradient(ellipse 70% 55% at 50% 42%, #100a1c 0%, #060309 45%, #050508 82%)',
    backgroundAttachment: 'fixed',
    color: PALETTE.white,
    fontFamily: "'DM Sans', system-ui, sans-serif",
    WebkitFontSmoothing: 'antialiased',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px 16px',
  }

  const cardStyle = {
    background: PALETTE.cardBg,
    border: `1px solid ${PALETTE.cardBorder}`,
    borderRadius: 24,
    width: '100%',
    maxWidth: 520,
    overflow: 'hidden',
    boxShadow: '0 4px 6px rgba(0,0,0,0.25), 0 20px 60px rgba(0,0,0,0.45)',
  }

  if (done) {
    return (
      <div style={pageStyle}>
        <div style={{ ...cardStyle, padding: '48px 40px', textAlign: 'center' }}>
          <div
            style={{
              width: 72, height: 72, borderRadius: '50%', margin: '0 auto',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(95,208,138,0.12)', border: '1px solid rgba(95,208,138,0.4)', color: PALETTE.success,
            }}
          >
            <CheckCircle2 size={36} />
          </div>
          <h1 style={{ fontSize: '1.3rem', fontWeight: 700, margin: '20px 0 12px' }}>
            Account Scheduled for Deletion
          </h1>
          <p style={{ color: PALETTE.subtext, fontSize: '0.9rem', lineHeight: 1.6 }}>
            Your account will be permanently deleted on <strong style={{ color: PALETTE.white }}>{scheduledDate}</strong>.
            You have been logged out of all devices.
          </p>
          <p style={{ color: PALETTE.subtext, fontSize: '0.9rem', lineHeight: 1.6, marginTop: 10 }}>
            Changed your mind? You can cancel by logging in before {scheduledDate}.
          </p>
          <div style={{ marginTop: 28 }}>
            <PrimaryButton onClick={() => navigate('/login')}>Back to Login</PrimaryButton>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={pageStyle}>
      <div style={cardStyle}>
        <div style={{ background: 'rgba(242,116,139,0.08)', borderBottom: '1px solid rgba(242,116,139,0.25)', padding: '32px 36px 28px', textAlign: 'center' }}>
          <div
            style={{
              width: 64, height: 64, borderRadius: '50%', margin: '0 auto 16px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(242,116,139,0.15)', border: '1px solid rgba(242,116,139,0.4)', color: PALETTE.error,
            }}
          >
            <AlertTriangle size={32} />
          </div>
          <h1 style={{ fontSize: '1.3rem', fontWeight: 800, color: PALETTE.error, marginBottom: 8 }}>
            Confirm Account Deletion
          </h1>
          <p style={{ fontSize: '0.875rem', color: PALETTE.error, opacity: 0.75 }}>
            Please read everything below carefully before proceeding.
          </p>
        </div>

        <div style={{ padding: '24px 36px', borderBottom: `1px solid ${PALETTE.borderSub}`, display: 'flex', flexDirection: 'column', gap: 16, position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: PALETTE.error, flexShrink: 0, marginTop: 4 }} />
            <div>
              <p style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: 2 }}>Right now</p>
              <p style={{ fontSize: '0.82rem', color: PALETTE.subtext }}>You will be logged out of all devices immediately</p>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: PALETTE.placeholder, flexShrink: 0, marginTop: 4 }} />
            <div>
              <p style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: 2 }}>{scheduledDate}</p>
              <p style={{ fontSize: '0.82rem', color: PALETTE.subtext }}>All your data is permanently deleted</p>
            </div>
          </div>
        </div>

        <div style={{ padding: '20px 36px', borderBottom: `1px solid ${PALETTE.borderSub}` }}>
          <h2 style={{ fontSize: '0.85rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>
            What will be permanently deleted
          </h2>
          <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8, margin: 0, padding: 0 }}>
            {[
              'Your account and personal information',
              'All invoices and client records',
              'All payment and income records',
              'All saved proposals',
              'Tax profiles and financial health reports',
              'Profile photo and business details',
            ].map((item) => (
              <li key={item} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.875rem', color: PALETTE.subtext }}>
                <X size={14} color={PALETTE.error} style={{ flexShrink: 0 }} />
                {item}
              </li>
            ))}
          </ul>
        </div>

        <div style={{ padding: '20px 36px', borderBottom: `1px solid ${PALETTE.borderSub}`, background: 'rgba(111,168,255,0.08)', display: 'flex', alignItems: 'flex-start', gap: 12, color: PALETTE.info }}>
          <Info size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          <div>
            <p style={{ fontSize: '0.875rem', lineHeight: 1.5 }}>
              <strong style={{ color: PALETTE.white }}>You can cancel this at any time before {scheduledDate}.</strong>
            </p>
            <p style={{ fontSize: '0.875rem', lineHeight: 1.5, marginTop: 4, opacity: 0.85 }}>
              Simply log in to LanceraOS and you will be prompted to restore your account.
            </p>
          </div>
        </div>

        <div style={{ padding: '16px 36px', borderBottom: `1px solid ${PALETTE.borderSub}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.82rem', color: PALETTE.placeholder }}>
          <p>Deleting account for</p>
          <strong style={{ fontSize: '0.875rem', color: PALETTE.white, fontWeight: 600 }}>{user?.email}</strong>
        </div>

        {error && (
          <div style={{ margin: '16px 36px 0', padding: '12px 14px', borderRadius: 10, background: 'rgba(242,116,139,0.1)', border: '1px solid rgba(242,116,139,0.3)', color: PALETTE.error, fontSize: '0.85rem' }}>
            {error}
          </div>
        )}

        <div style={{ padding: '24px 36px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <GhostButton onClick={() => navigate('/profile')} disabled={confirming}>
            Cancel — Keep My Account
          </GhostButton>
          <DangerButton onClick={handleConfirm} disabled={confirming}>
            {confirming ? 'Scheduling deletion…' : 'Yes, Delete My Account'}
          </DangerButton>
        </div>
      </div>
    </div>
  )
}