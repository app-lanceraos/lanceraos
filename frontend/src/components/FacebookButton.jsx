// src/components/FacebookButton.jsx
import { useState } from 'react'
import api from '@/lib/api'
import useAuthStore from '@/store/authStore'
import { authTokens } from './AuthLayout'

const FB_APP_ID = import.meta.env.VITE_FACEBOOK_APP_ID

function FacebookF({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="#1877F2" aria-hidden="true">
      <path d="M22.675 0h-21.35C.6 0 0 .6 0 1.325v21.351C0 23.4.6 24 1.325 24H12.82v-9.294H9.692v-3.622h3.128V8.413c0-3.1 1.893-4.788 4.659-4.788 1.325 0 2.463.099 2.795.143v3.24h-1.918c-1.504 0-1.795.715-1.795 1.763v2.313h3.587l-.467 3.622h-3.12V24h6.116C23.4 24 24 23.4 24 22.676V1.325C24 .6 23.4 0 22.675 0" />
    </svg>
  )
}

function loadFacebookSdk() {
  return new Promise((resolve, reject) => {
    if (window.FB) return resolve(window.FB)
    if (!FB_APP_ID) return reject(new Error('Facebook sign-in is not available yet.'))

    window.fbAsyncInit = function () {
      window.FB.init({ appId: FB_APP_ID, cookie: false, xfbml: false, version: 'v19.0' })
      resolve(window.FB)
    }

    const script = document.createElement('script')
    script.src = 'https://connect.facebook.net/en_US/sdk.js'
    script.async = true
    script.defer = true
    script.onerror = () => reject(new Error('Could not load the Facebook SDK.'))
    document.body.appendChild(script)
  })
}

/**
 * FACEBOOK_APP_ID is not yet in .env (the Meta app hasn't been created).
 * This button degrades to a disabled, clearly-labeled state in that case
 * rather than crashing or silently doing nothing on click — same
 * "fail predictably" philosophy as the backend's
 * apps/users/oauth/facebook.py.
 */
export default function FacebookButton({ onError, onSuccess, disabled = false }) {
  const loginSuccess = useAuthStore((s) => s.loginSuccess)
  const [loading, setLoading] = useState(false)
  const configured = Boolean(FB_APP_ID)

  const handleClick = async () => {
    if (!configured) {
      onError?.('Facebook sign-in is not available yet.')
      return
    }
    setLoading(true)
    try {
      const FB = await loadFacebookSdk()
      FB.login(
        async (response) => {
          if (response.authResponse?.accessToken) {
            try {
              const res = await api.post('/auth/facebook/', {
                access_token: response.authResponse.accessToken,
              })
              loginSuccess(res.data.user)
              onSuccess?.(res.data)
            } catch (err) {
              onError?.(err?.response?.data?.error || 'Facebook sign-in failed. Please try again.')
            }
          } else {
            onError?.('Facebook sign-in was cancelled.')
          }
          setLoading(false)
        },
        { scope: 'email,public_profile' },
      )
    } catch (err) {
      onError?.(err.message || 'Facebook sign-in failed. Please try again.')
      setLoading(false)
    }
  }

  const isDisabled = disabled || loading || !configured

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isDisabled}
      title={configured ? undefined : 'Facebook sign-in is being set up'}
      style={{
        width: '100%',
        height: '2.5rem',
        borderRadius: 20,
        border: `1px solid ${authTokens.inputBorder}`,
        background: 'transparent',
        color: '#F6F4FE',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        fontSize: 14,
        fontWeight: 500,
        cursor: isDisabled ? 'not-allowed' : 'pointer',
        opacity: isDisabled ? 0.5 : 1,
        transition: 'background 0.15s ease',
      }}
      onMouseEnter={(e) => {
        if (!isDisabled) e.currentTarget.style.background = 'rgba(255,255,255,0.04)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent'
      }}
    >
      <FacebookF size={16} />
      {loading ? 'Connecting…' : 'Continue with Facebook'}
    </button>
  )
}