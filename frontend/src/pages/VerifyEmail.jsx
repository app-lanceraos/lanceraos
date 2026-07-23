// src/pages/VerifyEmail.jsx
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { CheckCircle2, Info, XCircle } from 'lucide-react'

import api from '@/lib/api'
import useTitle from '@/hooks/useTitle'
import AuthLayout, { authTokens } from '@/components/AuthLayout'
import AuthButton from '@/components/AuthButton'

function Spinner() {
  return (
    <div
      style={{
        width: 40, height: 40, margin: '0 auto 16px',
        border: `3px solid ${authTokens.focus}`, borderTopColor: 'transparent',
        borderRadius: '50%', animation: 'verify-email-spin 0.7s linear infinite',
      }}
    >
      <style>{'@keyframes verify-email-spin { to { transform: rotate(360deg); } }'}</style>
    </div>
  )
}

function StatusIcon({ variant, children }) {
  const palettes = {
    success: { bg: 'rgba(95,208,138,0.12)', border: 'rgba(95,208,138,0.4)', color: authTokens.success },
    error: { bg: 'rgba(242,116,139,0.12)', border: 'rgba(242,116,139,0.4)', color: authTokens.error },
    info: { bg: 'rgba(111,168,255,0.12)', border: 'rgba(111,168,255,0.4)', color: '#6FA8FF' },
  }
  const p = palettes[variant]
  return (
    <div
      style={{
        width: 64, height: 64, borderRadius: '50%', margin: '0 auto 20px',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: p.bg, border: `1px solid ${p.border}`, color: p.color,
      }}
    >
      {children}
    </div>
  )
}

export default function VerifyEmail() {
  useTitle('LanceraOS | Verify Email')
  const { uid, token } = useParams()
  const navigate = useNavigate()
  const [status, setStatus] = useState('loading') // loading | already | success | error
  const [message, setMessage] = useState('')

  useEffect(() => {
    api.get(`/auth/verify-email/${uid}/${token}/`)
      .then((res) => {
        setMessage(res.data.message || 'Success.')
        setStatus(res.data.already_verified ? 'already' : 'success')
        setTimeout(() => {
          navigate('/login', { state: { message: 'Your email has been verified. Please sign in.' } })
        }, 2000)
      })
      .catch((err) => {
        setMessage(err.response?.data?.error || 'This link is invalid or has expired.')
        setStatus('error')
      })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (status === 'loading') {
    return (
      <AuthLayout maxWidth={360}>
        <div style={{ textAlign: 'center', padding: '20px 0' }}>
          <Spinner />
          <p style={{ color: '#C7C7C7', fontSize: '0.9rem' }}>Please wait…</p>
        </div>
      </AuthLayout>
    )
  }

  if (status === 'already') {
    return (
      <AuthLayout maxWidth={360}>
        <div style={{ textAlign: 'center' }}>
          <StatusIcon variant="info"><Info size={30} /></StatusIcon>
          <p style={{ color: '#C7C7C7', fontSize: '0.9rem', marginBottom: 8 }}>Your email is already verified.</p>
          <p style={{ color: authTokens.placeholder, fontSize: '0.78rem', marginBottom: 20 }}>Redirecting to login…</p>
          <AuthButton onClick={() => navigate('/login')}>Sign In Now</AuthButton>
        </div>
      </AuthLayout>
    )
  }

  if (status === 'success') {
    return (
      <AuthLayout maxWidth={360}>
        <div style={{ textAlign: 'center' }}>
          <StatusIcon variant="success"><CheckCircle2 size={30} /></StatusIcon>
          <p style={{ color: '#C7C7C7', fontSize: '0.9rem', marginBottom: 8 }}>{message}</p>
          <p style={{ color: authTokens.placeholder, fontSize: '0.78rem', marginBottom: 20 }}>
            Redirecting to login in a moment…
          </p>
          <AuthButton onClick={() => navigate('/login')}>Sign In Now</AuthButton>
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout maxWidth={360}>
      <div style={{ textAlign: 'center' }}>
        <StatusIcon variant="error"><XCircle size={30} /></StatusIcon>
        <p style={{ color: '#C7C7C7', fontSize: '0.9rem', marginBottom: 20 }}>{message}</p>
        <Link to="/verify-email-pending" style={{ textDecoration: 'none' }}>
          <AuthButton>Request New Verification Link</AuthButton>
        </Link>
      </div>
    </AuthLayout>
  )
}