// src/App.jsx
import { useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'

import useAuthStore from '@/store/authStore'
import PrivateRoute from '@/components/PrivateRoute'
import PublicRoute from '@/components/PublicRoute'
import AppShell from '@/components/AppShell'

import Login from '@/pages/Login'
import Register from '@/pages/Register'
import ForgotPassword from '@/pages/ForgotPassword'
import ResetPassword from '@/pages/ResetPassword'
import VerifyEmail from '@/pages/VerifyEmail'
import EmailVerificationPending from '@/pages/EmailVerificationPending'
import TwoFAVerify from '@/pages/TwoFAVerify'
import ChangeEmail from '@/pages/ChangeEmail'
import ActivateEmail from '@/pages/ActivateEmail'
import DeletionReview from '@/pages/DeletionReview'
import Settings from '@/pages/Settings'
import Profile from '@/pages/Profile'
import Onboarding from '@/pages/Onboarding'
import PrivacyPolicy from '@/pages/PrivacyPolicy'
import TermsOfService from '@/pages/TermsOfService'

export default function App() {
  const initialize = useAuthStore((s) => s.initialize)

  useEffect(() => {
    initialize()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <BrowserRouter>
      <Routes>
        {/* Public — redirect away if already logged in */}
        <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
        <Route path="/register" element={<PublicRoute><Register /></PublicRoute>} />

        {/* Stateless action-link flows — work regardless of auth state,
            since the person may or may not be logged in on this device
            when they click the email link. */}
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password/:uid/:token" element={<ResetPassword />} />
        <Route path="/verify-email/:uid/:token" element={<VerifyEmail />} />
        <Route path="/verify-email-pending" element={<EmailVerificationPending />} />
        <Route path="/2fa-verify" element={<TwoFAVerify />} />
        <Route path="/change-email/:ecr_uid/:token" element={<ChangeEmail />} />
        <Route path="/activate-email/:ecr_uid/:token" element={<ActivateEmail />} />

        {/* Legal pages — auth-state-agnostic like the routes above: an
            authenticated user shouldn't be redirected away from viewing
            these (e.g. opened from the registration form's checkbox), and
            they need no session either. */}
        <Route path="/privacy" element={<PrivacyPolicy />} />
        <Route path="/terms" element={<TermsOfService />} />

        {/* Shell-less standalone flow — deliberately not wrapped in
            AppShell or a route guard (see DeletionReview.jsx). */}
        <Route path="/account/deletion-review" element={<DeletionReview />} />

        {/* Private — require an active session */}
        {/* Onboarding is deliberately NOT wrapped in AppShell — it's a
            continuation of the signup journey, not a page within the
            app itself (see PrivateRoute.jsx for the redirect that sends
            people here until onboarding_completed is true). */}
        <Route
          path="/onboarding"
          element={<PrivateRoute><Onboarding /></PrivateRoute>}
        />
        <Route
          path="/profile"
          element={<PrivateRoute><AppShell><Profile /></AppShell></PrivateRoute>}
        />
        <Route
          path="/settings"
          element={<PrivateRoute><AppShell><Settings /></AppShell></PrivateRoute>}
        />

        {/* No dedicated landing page yet (separate future work) — send
            the root straight to Profile; PrivateRoute bounces to /login
            if there's no active session. */}
        <Route path="/" element={<Navigate to="/profile" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}