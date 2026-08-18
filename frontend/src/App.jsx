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
import AddPassword from '@/pages/AddPassword'
import DeletionReview from '@/pages/DeletionReview'
import Settings from '@/pages/Settings'
import Profile from '@/pages/Profile'
import Clients from '@/pages/Clients'
import Invoices from '@/pages/Invoices'
import InvoiceAnalytics from '@/pages/InvoiceAnalytics'
import DesignGallery from '@/pages/DesignGallery'
import DesignEditor from '@/pages/design-editor/DesignEditor'
import Onboarding from '@/pages/Onboarding'
import PrivacyPolicy from '@/pages/PrivacyPolicy'
import TermsOfService from '@/pages/TermsOfService'
import ClientPortal from '@/pages/portal/ClientPortal'
import PortalEnter from '@/pages/portal/PortalEnter'
import InvoiceView from '@/pages/InvoiceView'

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
        <Route path="/add-password/:uidb64/:token" element={<AddPassword />} />

        {/* Legal pages — auth-state-agnostic like the routes above: an
            authenticated user shouldn't be redirected away from viewing
            these (e.g. opened from the registration form's checkbox), and
            they need no session either. */}
        <Route path="/privacy" element={<PrivacyPolicy />} />
        <Route path="/terms" element={<TermsOfService />} />

        {/* Shell-less standalone flow — deliberately not wrapped in
            AppShell or a route guard (see DeletionReview.jsx). */}
        <Route path="/account/deletion-review" element={<DeletionReview />} />

        {/* Client Portal (Step 12) — its own auth entirely (a portal-
            session cookie, apps.clients.cookies), unrelated to
            useAuthStore/PrivateRoute, so neither route is wrapped in
            either. */}
        <Route path="/portal" element={<ClientPortal />} />
        <Route path="/portal/enter/:token" element={<PortalEnter />} />

        {/* The individual invoice VIEW — REWORKED (real frontend-domain
            invoice view page, see DECISIONS.md): now a real React route
            after all, superseding the earlier "non-SPA-navigation
            exception" this comment used to describe. Public/shell-less
            like the routes above (Invoice.portal_view_url now points
            here instead of the raw backend host) — InvoiceView.jsx is a
            thin wrapper that fetches the SAME backend-rendered HTML and
            displays it, never a second reimplementation of the invoice
            layout; see that file's own comment. */}
        <Route path="/invoice/:token" element={<InvoiceView />} />

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
        <Route
          path="/clients"
          element={<PrivateRoute><AppShell><Clients /></AppShell></PrivateRoute>}
        />
        <Route
          path="/invoices"
          element={<PrivateRoute><AppShell><Invoices /></AppShell></PrivateRoute>}
        />
        <Route
          path="/invoices/designs"
          element={<PrivateRoute><AppShell><DesignGallery /></AppShell></PrivateRoute>}
        />
        <Route
          path="/invoices/analytics"
          element={<PrivateRoute><AppShell><InvoiceAnalytics /></AppShell></PrivateRoute>}
        />
        {/* Step 8b's canvas editor — deliberately NOT wrapped in AppShell,
            same shell-less pattern as /account/deletion-review above (see
            DesignEditor.jsx's own comment and DECISIONS.md). Still gated by
            PrivateRoute — shell-less is a layout choice, not an auth one. */}
        <Route
          path="/invoices/designs/:id/edit"
          element={<PrivateRoute><DesignEditor /></PrivateRoute>}
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