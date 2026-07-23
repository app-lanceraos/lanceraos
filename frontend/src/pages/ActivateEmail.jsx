// src/pages/ActivateEmail.jsx
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { CheckCircle2, XCircle } from 'lucide-react'

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
        borderRadius: '50%', animation: 'activate-email-spin 0.7s linear infinite',
      }}
    >
      <style>{'@keyframes activate-email-spin { to { transform: rotate(360deg); } }'}</style>
    </div>
  )
}

export default function ActivateEmail() {
  useTitle('LanceraOS | Activate New Email')
  const { ecr_uid, token } = useParams()
  const navigate = useNavigate()

  const [status, setStatus] = useState('loading') // loading | success | error
  const [message, setMessage] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    api.post(`/auth/email-change/activate/${ecr_uid}/${token}/`)
      .then((res) => {
        setNewEmail(res.data.new_email || '')
        setMessage(res.data.message || 'Email changed successfully.')
        setStatus('success')
        setTimeout(() => navigate('/login'), 5000)
      })
      .catch((err) => {
        setErrorMsg(err.response?.data?.error || 'This link is invalid or has expired.')
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

  if (status === 'error') {
    return (
      <AuthLayout maxWidth={360}>
        <div style={{ textAlign: 'center' }}>
          <div
            style={{
              width: 60, height: 60, borderRadius: '50%', margin: '0 auto 20px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(242,116,139,0.12)', border: '1px solid rgba(242,116,139,0.4)', color: authTokens.error,
            }}
          >
            <XCircle size={28} />
          </div>
          <p style={{ color: '#C7C7C7', fontSize: '0.9rem', marginBottom: 20 }}>{errorMsg}</p>
          <Link to="/profile" style={{ textDecoration: 'none' }}>
            <AuthButton>Back to Profile</AuthButton>
          </Link>
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout maxWidth={360}>
      <div style={{ textAlign: 'center' }}>
        <div
          style={{
            width: 64, height: 64, borderRadius: '50%', margin: '0 auto 20px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(95,208,138,0.12)', border: '1px solid rgba(95,208,138,0.4)', color: authTokens.success,
          }}
        >
          <CheckCircle2 size={32} />
        </div>

        <div style={{ background: 'rgba(20,17,38,0.5)', border: `1px solid ${authTokens.inputBorder}`, borderRadius: 10, padding: '14px 16px', marginBottom: 20 }}>
          <p style={{ fontSize: '0.82rem', color: authTokens.placeholder, marginBottom: 4 }}>Your new email address</p>
          <p style={{ fontSize: '0.95rem', fontWeight: 600, color: authTokens.focus, wordBreak: 'break-all' }}>{newEmail}</p>
        </div>

        <p style={{ fontSize: '0.875rem', color: '#C7C7C7', lineHeight: 1.6, marginBottom: 16 }}>
          {message} You will be redirected to the sign in page shortly. Please sign in with your new email address.
        </p>
        <p style={{ fontSize: '0.78rem', color: authTokens.placeholder, marginBottom: 20 }}>Redirecting to login…</p>

        <AuthButton onClick={() => navigate('/login')}>Sign In Now</AuthButton>
      </div>
    </AuthLayout>
  )
}