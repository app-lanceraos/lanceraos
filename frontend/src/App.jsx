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
import TemplateBuilderV2 from '@/pages/design-editor-v2/TemplateBuilderV2'
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
        {/* The LanceraOS Template Builder's original (GrapesJS) editor —
            deliberately NOT wrapped in AppShell, same shell-less pattern
            as /account/deletion-review above (a real, focused,
            full-screen editing surface). Still gated by PrivateRoute —
            shell-less is a layout choice, not an auth one. Production
            cutover (29 August 2026): the same component always runs in
            real-persistence mode here, since a real `:id` route param
            (including the literal `new`) is always present. As of the
            gallery-wiring phase below, this is no longer the ONLY real
            editor route — DesignGallery.jsx now routes a real
            schema_version: 2 design to the newer editor's own
            /invoices/designs/:id/build route instead, and reserves this
            route for a pre-existing legacy-shaped design (which this
            editor still migrates on demand) and as that newer editor's
            own fallback link. */}
        <Route
          path="/invoices/designs/:id/edit"
          element={<PrivateRoute><DesignEditor /></PrivateRoute>}
        />

        {/* The standalone invoice-editor/ project, physically merged into
            frontend/ (see DECISIONS.md's merge entry) — a second, newer
            Template Builder that is now real, linked product UI (see
            DesignGallery.jsx's own handleEdit/handleUseTemplate/
            handleStartBlank/handleAiSeedUpload): every design creation
            path (blank/template/AI-seed) always produces real
            schema_version: 2 design_data (traced directly against
            design_duplicate/get_blank_design_data/design_ai_seed's own
            backend code, not assumed), and DesignGallery.jsx routes
            Edit here for any design whose own design_data already
            declares schema_version: 2. A legacy-shaped design (no
            schema_version key) still opens the ORIGINAL /edit route
            below instead, unchanged — GrapesJS remains the one path
            that migrates a legacy design on demand, and this editor's
            own LoadedTemplateBuilder additionally refuses to open one at
            all (a real, explicit "legacy" status screen with a link
            back to the classic editor) as a second line of defense.
            /invoices/designs/editor-v2 (no id) stays a bare, unlinked
            dev sandbox with no real design behind it. Shell-less +
            PrivateRoute-gated, matching DesignEditor.jsx's own treatment
            exactly. */}
        <Route
          path="/invoices/designs/editor-v2"
          element={<PrivateRoute><TemplateBuilderV2 /></PrivateRoute>}
        />
        {/* The new editor's own permanent, real route for an existing,
            owned InvoiceDesign (production schema_version: 2 only — see
            TemplateBuilderV2.jsx's LoadedTemplateBuilder). Deliberately
            NOT /invoices/designs/:id/edit (that path stays GrapesJS's
            own, untouched) and deliberately NOT renamed away from this
            editor's own component — "build" reads as this editor's own
            distinct verb (constructing a design from scratch on a free
            canvas) next to GrapesJS's "edit". Linked for real from
            DesignGallery.jsx as of this phase. */}
        <Route
          path="/invoices/designs/:id/build"
          element={<PrivateRoute><TemplateBuilderV2 /></PrivateRoute>}
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