# LanceraOS - v2 — Complete AI Chat Context Document
Please confirm you have read and understood this context before we begin."
---

## 1. What Is LanceraOS

LanceraOS is a production-grade, commercial SaaS platform — not a
university project, not a prototype. It is an AI-powered financial
management and business operations platform built exclusively for
Pakistani freelancers who earn income from international clients
through platforms like Upwork, Fiverr, Toptal, and direct contracts.

The platform is the only product in the Pakistani market that combines:
- Professional invoicing with PKR conversion and FBR tax compliance
- Payoneer and Wise CSV income import
- SRO 586(I)/2022 IT export tax exemption checking
- AI-powered proposal writing
- Financial health scoring
- Digital contract signing

Competitors either serve the global market without Pakistani localisation
(FreshBooks, Bonsai, Wave) or address only tax filing without business
management (Befiler). LanceraOS occupies the gap between them.

Target user: Pakistani freelancer aged 18-35, earning USD 500-5000/month
from international clients, receiving payments via Payoneer or Wise,
operating as a sole proprietor, with limited FBR tax knowledge.

Business model: Freemium. Free tier covers basics. Pro tier at
5$/month unlocks all AI features, unlimited invoices, CSV import,
and advanced reporting.

Domain: lanceraos.com
GitHub: github.com/lanceraos
Developer: Solo founder - Ali Amir

---

## 2. Tech Stack — Exact Versions, No Deviations

### Backend
- Language: Python 3.13
- Framework: Django 5.2 LTS + Django REST Framework 3.15
- Database: PostgreSQL 17
- Cache / Broker: Redis 8
- Background tasks: Celery 5 + Celery Beat
- ASGI server: Daphne
- WebSockets: Django Channels 4
- Authentication: djangorestframework-simplejwt
- Admin brute-force protection: django-axes (added after a security audit
  found /admin/ had none of the app's own account-lockout protections —
  see DECISIONS.md)
- OAuth: hand-rolled (Google + Facebook), same account-linking logic for
  both providers — not django-allauth. v1's working Google flow was
  hand-rolled and already handled account-linking collisions correctly;
  allauth would mean re-deriving that same logic inside its own hooks
  for no benefit. See DECISIONS.md.
- Email: Resend HTTP API (platform emails) + Custom SMTP per user (client-facing emails)
- PDF generation: WeasyPrint
- Media storage: Cloudinary
- AI inference: Groq API
- AI model (fast tasks): openai/gpt-oss-20b
- AI model (complex writing): llama-3.3-70b-versatile
- AI model (vision — image classify, Step 9): qwen/qwen3.6-27b, env-overridable via
  GROQ_MODEL_VISION (unlike the two above, which are hardcoded, not env-read — see DECISIONS.md)
- Encryption: cryptography library (Fernet)
- Node.js: 24 LTS


### Frontend
- Framework: React 19
- Build tool: Vite
- State management: Zustand
- Routing: React Router v7
- Charts: Recharts
- Styling: Inline styles + CSS custom properties (NO Tailwind, NO CSS modules)
- HTTP client: Axios with cookie-based auth (withCredentials), silent 401 refresh
- Icons: lucide-react exclusively — never emojis or bare Unicode symbols
  (⚠✓✗ etc.) anywhere in rendered UI. See DESIGN.md Section 0b.

### Infrastructure
- Backend hosting: Railway
- Frontend hosting: Vercel
- Database hosting: Railway managed PostgreSQL
- DNS: Cloudflare
- Domain: Hostinger (lanceraos.com)

---

## 3. Architecture Rules — Follow These Without Being Asked

These are non-negotiable decisions made at the project level.
Every module must follow them exactly.

### Backend rules
1. All API views use @api_view and @permission_classes decorators.
   Never use class-based views (ModelViewSet, APIView, etc.)
2. USE_TZ = False in settings. The platform stores and operates on
   Pakistan Standard Time only, with zero server-side timezone
   conversion anywhere. FreelancerProfile.timezone (user-set, defaults
   to Asia/Karachi) is used exclusively for FRONTEND display
   formatting — it never drives any backend conversion logic.
3. All emails go through a shared send_email() utility that calls
   the Resend HTTP API on port 443. Never use Django's email backend
   or SMTP directly for LanceraOS's own platform emails. (Django's SMTP
   backend IS still used, deliberately, inside apps/users/views/smtp.py's
   save_custom_smtp() — but that tests a USER'S OWN mail server, a
   different operation from LanceraOS sending its own mail.)
4. All AI calls go through a shared call_groq() utility function
   in core/ai.py. Never call the Groq API directly from views.
5. All prompts live in a prompts.py file inside the relevant app.
   Never hardcode prompt strings inside view functions.
6. Sensitive fields (SMTP passwords, API keys stored per user) are
   encrypted with Fernet before saving. Never store them in plain text.
   Fields that also need a uniqueness constraint (CNIC, NTN, PSEB
   registration number) additionally carry an HMAC blind-index column
   (`*_hash`, unique=True) using a SEPARATE key (BLIND_INDEX_KEY) from
   the Fernet encryption key (ENCRYPTION_KEY) — see DECISIONS.md.
7. Passwords are hashed with Argon2. Never bcrypt, never plain text.
8. All database queries go through Django ORM. No raw SQL anywhere.
9. All background tasks use @shared_task decorator, not @app.task.
10. Every state-changing action writes a row to the shared core.AuditLog
    table (replaces the pattern of one audit table per app).
11. Every API request is logged by middleware to core.ApiRequestLog.
    Request bodies are logged with sensitive fields auto-redacted.
    Response bodies are only logged when status_code >= 500.
12. Rate limiting is applied at three tiers:
    - Strict: auth endpoints (login, register, OTP)
    - Moderate: data-mutation endpoints
    - Generous: read-only endpoints
    Implemented via explicit Django-cache checks inside each view, not
    DRF's scoped-throttle mechanism (declaring throttle rates without
    attaching throttle_scope to a view does nothing — confirmed as dead
    config in v1 and not carried forward).
13. UUIDs as primary keys for all models (not auto-increment integers).
    This prevents enumeration attacks on a financial application.
14. CSRF protection is mandatory because auth uses httpOnly cookies.
15. Input validation uses DRF serializers with explicit field definitions.
    Never trust client-side validation alone.

### Custom Email (SMTP) Rules

Every email sent TO A CLIENT byt the LanceraOS user goes through this decision chain:
  1. Does this user have custom SMTP configured and verified? 
     YES → send via their SMTP server
     NO  → send via Resend HTTP API from noreply@lanceraos.com

2. Client-facing emails that use custom SMTP when configured:
   - Invoice delivery
   - Invoice reminders
   - Payment receipts
   - Proposal delivery
   - Contract delivery
   - Client portal PIN
   - Client messages

3. Emails that ALWAYS come from lanceraos.com regardless of custom SMTP:
   - User registration / email verification
   - Password reset
   - 2FA OTP codes
   - Security alerts (new login, password changed etc)
   - Subscription notifications
   These are platform security emails. They must never come from
   a user-controlled address.

4. If custom SMTP fails (wrong credentials, server down, timeout):
   - Immediately fall back and resend via Resend HTTP API
   - Send an in-app notification to the user:
     "Your email to [client] was sent from noreply@lanceraos.com
      because your custom email failed. Check your SMTP settings."
   - Log the failure with: user_id, smtp_host, error_message,
     fallback_used=True, timestamp
   - Do NOT tell the client the email came from a fallback

5. Custom SMTP credentials storage:
   - Host, port, username stored as plain text in user_profile
   - Password encrypted with Fernet before saving
   - Password never returned in any API response
   - Password only decrypted inside the email sending utility,
     never in views or serializers

6. SMTP settings the user configures:
   - SMTP host (e.g. smtp.gmail.com)
   - SMTP port (587 recommended, 465 also supported)
   - Username (usually their email address)
   - Password (app password for Gmail, regular password for others)
   - From name (e.g. "Ali Amir - Web Developer")
   - From email (e.g. ali@mybusiness.com)

7. Before saving SMTP settings, always send a test email to the
   user's own registered email address to verify credentials work.
   If the test fails, reject the settings with a clear error message.

### Observability Rules

Every operation that crosses a service boundary gets a request_id.
This is how you investigate "why didn't this happened?"

1. Every incoming HTTP request gets a UUID assigned by middleware
   (core.middleware.RequestLoggingMiddleware). This request_id is:
   - Added to every log line for that request
   - Passed to every Celery task spawned by that request
   - Returned in the response header as X-Request-ID
   - Stored in core.ApiRequestLog

2. Every Celery task logs:
   - task_id (Celery's own ID)
   - request_id (from the HTTP request that spawned it)
   - started_at, completed_at
   - success or failure with error detail

3. Every email sent logs:
   - request_id
   - recipient email
   - subject
   - sent_via (resend or custom_smtp)
   - smtp_host (if custom)
   - provider_message_id (Resend's ID if used)
   - status (sent / failed / fallback_used)
   - timestamp

4. Every PDF generated logs:
   - request_id
   - document_type (invoice / contract / statement / certificate)
   - generated_at
   - duration_ms
   - success or error

5. When investigating a support issue:
   - Find the request_id from core.ApiRequestLog by user + timestamp
   - Search all logs for that request_id
   - You get a complete timeline: HTTP request → task queued →
     PDF generated → email attempted → fallback or success

### Frontend rules
1. All styling uses inline style={{}} objects with CSS custom
   properties (variables). Never Tailwind utility classes in JSX.
   Never separate CSS files per component.
2. All CSS tokens (colors, spacing, fonts, transitions) live in
   src/styles/theme.css as CSS custom properties on :root.
3. API calls go through a shared Axios instance in src/lib/api.js
   that automatically attaches cookies (withCredentials: true) and
   handles silent token refresh on 401 responses via the httpOnly
   refresh cookie. Never handles raw access/refresh token strings —
   those never appear in JS-visible storage or in any response body.
4. Auth state (user object, loading, isAuthenticated) lives in
   src/store/authStore.js using Zustand.
5. The AppShell layout component (src/components/AppShell.jsx)
   owns the sidebar, header, and main content frame. Page components
   render inside it via App.jsx passing them as children. Page components
   never define their own layout frame.
   CURRENT STATE: AppShell.jsx is now the full, v1-faithful
   implementation — collapsible sidebar with the liquid-glass nav pill,
   every nav group/item from v1 (including modules not yet built —
   see DECISIONS.md), notification bell/panel UI (no backend behind it
   yet), profile popup (Profile/Settings/Help/Sign out), theme toggle.
   Shell colors (header/sidebar/nav/popup) follow the light/dark theme
   toggle — see DESIGN.md Section 2.8 for the single source of truth.
6. JWT tokens are stored in httpOnly cookies, never localStorage.
7. WebSocket connection is managed by a shared hook
   src/hooks/useWebSocket.js. Never open WebSocket connections
   directly inside page components.

### Database Design Rules

Before writing any Django model, answer these 6 questions for every table:

1. MUTABLE?
   Can existing records be updated, or are they append-only?
   Financial records (payments, invoices) should be append-only
   where possible. Use status fields and new records instead of
   editing existing ones.

2. SOFT DELETED?
   When a user "deletes" this record, do we actually delete it
   or just hide it? Default to soft delete (deleted_at timestamp)
   for anything with financial or legal significance.
   Hard delete only for things with no business consequence.

3. AUDIT TRAIL?
   Does every change to this record need to be tracked?
   If yes, write to core.AuditLog on every create/update/delete.

4. INDEXED?
   Which fields will be used in WHERE clauses or ORDER BY?
   Those need database indexes. At minimum: user_id on every
   user-owned table, status on lifecycle tables, created_at
   on tables that are queried by date range.

5. ENCRYPTED?
   Does this field contain PII or credentials that must be
   encrypted at rest? SMTP passwords, NTN numbers, and any
   field that would cause legal or financial harm if the
   database were breached. If the field also needs a uniqueness
   constraint, add a separate HMAC blind-index column rather than
   trying to enforce uniqueness on the encrypted value directly
   (Fernet's randomized IV makes that impossible).

6. CASCADE BEHAVIOR?
   What happens to this record when a related record is deleted?
   PROTECT (block deletion) for financial records.
   SET_NULL for optional relationships.
   CASCADE only when child records have no independent meaning.

### Security baseline (applies to every module)
- SQL injection: ORM parameterised queries only, no raw SQL
- XSS: React JSX escaping handles output; never use
  dangerouslySetInnerHTML with user content
- CSRF: CSRF tokens on all state-changing requests
- Secrets: all API keys and credentials in environment variables,
  never hardcoded, never committed to git
- Auth: every protected endpoint requires @permission_classes([IsAuthenticated])
- HTTPS: enforced in production; Secure flag on all cookies

---

### Architecture Decision Rule

All decisions in this document are current best decisions,
not permanent commitments. When a better approach is found:
- Update CLAUDE.md
- Add an entry to DECISIONS.md explaining what changed and why
- Never silently change the architecture without recording the reason

## 4. Project Structure

lanceraos/                          <- Django project root
├── config/
│   ├── settings.py                 <- Django settings
│   ├── urls.py                     <- Root URL configuration
│   ├── celery.py                   <- Celery configuration
│   ├── asgi.py                     <- ASGI config (Daphne + Channels)
│   └── wsgi.py                     <- WSGI fallback entrypoint
├── core/
│   ├── ai.py              ← Shared Groq API utility (call_groq) — built Step 9,
│   │                         apps.invoices' AI-seeded designs is the first real consumer
│   ├── email.py            ← Resend HTTP API sender (send_email)
│   ├── encryption.py        ← Fernet + HMAC blind-index helpers
│   ├── events.py             ← Minimal on()/emit() event registry — apps.clients is its first
│   │                            real consumer; apps.users deliberately not retrofitted (see
│   │                            DECISIONS.md, 08 August 2026)
│   ├── money.py               ← Immutable Money value object (USD-anchored currency conversion)
│   ├── middleware.py        ← Request ID injection + API request logging
│   ├── models.py            ← AuditLog, ApiRequestLog
│   ├── observability.py     ← Logging/request-metadata helpers used by all modules
│   └── permissions.py       ← Shared DRF permission classes [not yet built]
├── apps/
│   ├── users/                      <- Auth, profile, settings — BUILT
│   ├── admin_panel/                <- Admin panel backend (admin.lanceraos.com's API) — BUILT.
│   │   │                              Separate session/cookie/auth-class stack from apps.users —
│   │   │                              see Section 5, Module 1's admin-panel subsection.
│   │   ├── models.py                <- AdminSession (own table, own concurrency cap)
│   │   ├── authentication.py         <- AdminCookieJWTAuthentication (requires admin_sid claim)
│   │   ├── permissions.py             <- IsSuperAdmin (gates grant/revoke admin access)
│   │   ├── cookies.py                  <- Admin-only cookie names, distinct from apps.users.cookies
│   │   ├── token_service.py             <- Mints AdminSession + admin JWT pair
│   │   ├── constants.py                  <- ADMIN_EMAIL_DOMAIN
│   │   ├── views.py                       <- Login (mandatory 2FA) / logout / refresh / me
│   │   ├── views_users.py                  <- Search/detail/sessions/suspend/reactivate/grant/revoke
│   │   ├── views_audit.py                   <- Audit log viewer (filterable)
│   │   └── views_deletion.py                 <- Deletion-queue management
│   ├── invoices/                   <- BUILT: models.py (10 tables — Invoice/InvoiceItem/
│   │                                  InvoicePartialPayment/InvoiceReminder/InvoiceViewEvent/
│   │                                  InvoiceComment/PaymentClaim/InvoiceDesign/InvoicePreset/
│   │                                  InvoicePresetItem) + serializers.py/views.py/urls.py
│   │                                  (CRUD + lifecycle endpoints, incl. real GET .../pdf/ —
│   │                                  only /send/ excluded, see Module 2) + pdf_generator.py
│   │                                  (WeasyPrint render pipeline) + design_schema.py/
│   │                                  design_seeds.py (InvoiceDesign's validated design_data
│   │                                  contract + the 3 builtin templates decomposed into it) +
│   │                                  ai_design.py (Step 9 — classify-only AI design seeding via
│   │                                  core.ai.call_groq) + signature_tool.py (Step 9 — classical
│   │                                  Pillow background removal, not AI).
│   │                                  Email delivery/client portal — NOT YET BUILT.
│   ├── clients/                    <- Client CRM — BUILT. Client/ClientNote/ClientTag,
│   │                                  scoring.py (reliability-score formula, pure/testable
│   │                                  independent of Invoice — see DECISIONS.md)
│   ├── payments/                   <- BUILT so far: ExchangeRateSnapshot + daily fetch task
│   │                                  only (the currency-conversion anchor). Income tracking,
│   │                                  expenses, P&L, CSV import — NOT YET BUILT.
│   ├── tax/                        <- FBR tax, SRO 586, income certificate
│   ├── health/                     <- Financial health score
│   ├── proposals/                  <- Proposals + AI writer
│   ├── contracts/                  <- Contracts + digital signing
│   └── subscriptions/              <- Free/Pro plans and enforcement
├── frontend/                       <- React application (the main, freelancer-facing app)
│   ├── src/
│   │   ├── App.jsx                 <- Routing root (BrowserRouter + all routes)
│   │   ├── components/
│   │   │   ├── AppShell.jsx        <- Layout: header, nav, frame — full, v1-faithful
│   │   │   │                          implementation, see rule 5
│   │   │   ├── PrivateRoute.jsx    <- Redirects to /login if not authenticated
│   │   │   ├── PublicRoute.jsx     <- Redirects logged-in users away from Login/Register
│   │   │   ├── Card.jsx, FormField.jsx, FormSelect.jsx,
│   │   │   │   FosAlert.jsx, SaveButton.jsx  <- Shared authenticated-app primitives,
│   │   │   │   wrapping the .fos-* classes (see DESIGN.md Section 6 exception)
│   │   │   └── AuthField.jsx, AuthButton.jsx, AuthAlert.jsx,
│   │   │       AuthSelect.jsx, AuthLayout.jsx  <- Auth-page-only equivalents
│   │   │       (fixed orbit palette, never theme-responsive — see DESIGN.md)
│   │   ├── pages/                  <- One file per module page
│   │   │   └── settings/           <- Settings page's 7 sections, one file each,
│   │   │       plus validators.js  <- imported by Settings.jsx as a thin shell
│   │   ├── store/
│   │   │   └── authStore.js        <- Zustand auth state
│   │   ├── lib/
│   │   │   └── api.js              <- Shared Axios instance
│   │   ├── hooks/
│   │   │   └── useWebSocket.js     <- Shared WebSocket hook [not yet built]
│   │   └── styles/
│   │       └── theme.css           <- All CSS custom properties
│   └── index.html
├── admin-frontend/                 <- Admin panel's React app — a fully separate Vite project
│   │                                  from frontend/ (own package.json, own deployment target,
│   │                                  own dev server), not a route inside the main app. Mirrors
│   │                                  frontend/'s conventions (Zustand store, shared Axios
│   │                                  instance, inline-style theming) rather than sharing code
│   │                                  with it directly.
│   ├── src/
│   │   ├── App.jsx                 <- Routing root for admin.lanceraos.com
│   │   ├── components/
│   │   │   ├── AdminLayout.jsx     <- Admin shell (sidebar/header), admin_panel's AppShell analog
│   │   │   ├── AdminPrivateRoute.jsx <- Redirects to admin login if not authenticated
│   │   │   └── Brand.jsx
│   │   ├── pages/                  <- AdminLogin, AdminTwoFAVerify, AdminUserSearch,
│   │   │                              AdminUserDetail, AdminAuditLog, AdminDeletionQueue
│   │   ├── store/
│   │   │   └── adminAuthStore.js   <- Zustand auth state, separate from the main app's authStore
│   │   ├── lib/
│   │   │   └── api.js              <- Separate Axios instance, admin cookie-aware
│   │   └── styles/
│   │       └── theme.css
│   └── index.html
├── CLAUDE.md                       <- Master context file (this document)
├── .env                            <- Environment variables (never committed)
├── .env.example                    <- Template with all required keys
├── requirements.txt
└── manage.py

---

## 5. Modules — What Exists and What Each Does

### Module 1 — Users (Authentication + Profile + Settings)
Status: Backend complete. Frontend complete (17 pages, 123 tests passing).
Includes the admin panel (backend + its separate admin-frontend/ app — see
its own subsection below) — the admin panel is part of this module's
"Complete" status, not separately tracked.
App: apps/users/ (+ apps/admin_panel/ for the admin panel — see below)

Handles all authentication and user account management.

Registration: 3-step wizard (name + birthdate -> email + username ->
password), submitted as a single API call after the wizard completes.
Age must be >= 16. Email verification required before login.
check-availability suggests a real, available alternative username
(base+2, base+3, ... up to base+99, then a random suffix) when the
requested one is taken or reserved, not just "not available" — the
suggestion is clickable in the wizard and re-validates. Immediately
before that final submit, a confirm-your-email modal ("We'll send your
verification link to X — is this correct?") catches typos before a
wasted send; declining sends the user back to the email/username step.

Auth providers: Email/password, Google OAuth, Facebook OAuth (hand-rolled,
identical account-linking logic for both — see DECISIONS.md).
Account linking: if a user registers via email then tries Google or
Facebook OAuth with the same email, it auto-links to the existing
account. Never creates duplicate accounts.

JWT strategy: access token 15 minutes, refresh token 30 days (90 days
if Remember Me), stored in httpOnly cookies (never localStorage,
never returned in any JSON response body). Silent background refresh
works even when the access-token cookie has already expired. Maximum
3 concurrent sessions per account, tracked via a first-class Session
model (device, IP, refresh-token hash, timestamps) — 4th login evicts
the least-recently-used session. Sessions listable/individually
revocable at GET/DELETE /api/auth/sessions/ (frontend: Settings > Sessions).

2FA: OTP via email. Optional but available — requires a real password,
so an OAuth-only account must add one first (see below) before 2FA can
be enabled at all. A trusted-device cookie (httpOnly, 30 days) can skip
2FA on a recognized device.

OAuth-only accounts adding a password: an account that signed up via
Google/Facebook and never set a password (is_oauth_only()) can add one
from Settings > Security. Requires an email-confirmation step rather
than setting the password directly from the already-authenticated
session — if that session were ever hijacked (XSS, stolen cookie),
setting a password directly would hand an attacker a persistent
password-login backdoor surviving the OAuth session ending; email
confirmation means they'd also need the real inbox. Completing this
flow sets password_changed_at, which — via the same pca mechanism
change_password uses — invalidates every existing token including the
caller's own, so the person is signed out and must sign in again with
the new password (the success screen says so honestly; an earlier
attempt to silently refresh the session in place was reverted, since
complete_add_password is deliberately unauthenticated-by-design and has
no way to identify and spare "the caller's own" session — see
DECISIONS.md). Adding a password unlocks 2FA and, per the deletion
flow below, unlocks password+OTP-based deletion in place of the
OAuth-only re-authentication path.

Account deletion for OAuth-only accounts: since there's no password to
confirm with, initiate-deletion-oauth re-authenticates via the OAuth
provider itself (a fresh Google/Facebook sign-in) instead of a password
prompt, then proceeds through the same OTP -> confirm -> 30-day-recovery
pipeline as the password path below.

Frontend information architecture — Profile and Settings are two
separate pages, not one (v1 had a single monolithic Profile page mixing
personal identity with account configuration; this was a deliberate
product decision to split them — see DECISIONS.md):
  - Profile (/profile): light personal identity only — logo/photo
    (with crop-and-zoom), display name, business name, phone, and a
    profile-completion indicator.
  - Settings (/settings): 7 sections — Account (email/username/name/DOB),
    Business (address, currency, payment terms, bank/JazzCash/Easypaisa/
    Payoneer), Tax & PSEB (CNIC/NTN/PSEB), Security (password, 2FA,
    add-password for OAuth-only accounts, danger-zone deletion),
    Sessions, Notifications, Email Sending (SMTP). Email-change is
    hidden entirely (not shown-but-disabled) inside Account for an
    OAuth-only account — with no password to confirm the change with,
    the flow doesn't apply until a password exists.
  - SaveButton (shared across all seven Settings sections) renders
    nothing at all until a real change has been made, rather than the
    earlier convention of always showing a disabled "No Changes" button
    — see DECISIONS.md.

Notification preferences: exactly 3 real per-category toggles (Invoice
Events, Client Messages, Payments) — notif_invoice_events,
notif_client_messages, notif_payments on FreelancerProfile. Security
Alerts has no toggle anywhere in the UI or the backend — cannot be
disabled, by omission of any control rather than a disabled-but-visible
one. Every notification a user receives beyond security alerts is one
they have explicitly enabled; nothing is opt-out.

Account deletion: password -> OTP -> confirm -> 30-day recovery window
-> anonymize (never hard-delete) -> financial records (future modules)
retain a PROTECT relationship to the now-anonymized user, in anonymized
form. Confirming deletion revokes every session and clears cookies
immediately. Frontend: Settings > Security > Danger Zone initiates the
password+OTP steps (or the OAuth-reauthentication step for an
OAuth-only account, see above), then hands off to the standalone
(shell-less) DeletionReview page with the resulting one-time token.

Key API endpoints:
- POST /api/auth/register/
- POST /api/auth/check-availability/ (live email/username availability
  during the registration wizard; suggests an alternative when taken)
- GET /api/auth/verify-email/<uid>/<token>/
- POST /api/auth/resend-verification/
- GET /api/auth/check-verification-status/
- POST /api/auth/login/
- POST /api/auth/logout/
- POST /api/auth/token/refresh/
- GET /api/auth/csrf/ (triggers Django's CSRF cookie issuance)
- GET /api/auth/me/ (session check on app load)
- POST /api/auth/google/
- POST /api/auth/facebook/
- GET/PUT /api/auth/account/ (Settings > Account: name/username/DOB)
- GET/PUT /api/auth/profile/ (Profile page + Settings > Business/Tax —
  same FreelancerProfile object, partial=True so each page/section can
  save independently without clobbering the others)
- POST /api/auth/profile/upload-logo/ (multipart; Cloudinary-backed)
- GET/PUT /api/auth/settings/notifications/
- GET /api/auth/sessions/ + DELETE /api/auth/sessions/<id>/
  + POST /api/auth/sessions/<id>/rename/
- POST /api/auth/2fa/verify/ + /api/auth/2fa/resend/ + /api/auth/2fa/toggle/
- POST /api/auth/change-password/
- POST /api/auth/forgot-password/ + /api/auth/reset-password/<uid>/<token>/
- POST /api/auth/security/add-password/request/
  + /security/add-password/validate/<uidb64>/<token>/ (GET)
  + /security/add-password/complete/<uidb64>/<token>/ (OAuth-only accounts)
- POST /api/auth/email-change/request/ + /validate/<ecr_uid>/<token>/ (GET)
  + /complete/<ecr_uid>/<token>/ + /activate/<ecr_uid>/<token>/ + /cancel/
- POST /api/auth/deletion/initiate/ + /deletion/initiate-oauth/
  + /verify-otp/ + /confirm/ + /cancel/
- GET /api/auth/smtp/status/ + POST /api/auth/smtp/save/ + /disable/

#### Admin panel (apps/admin_panel/ + admin-frontend/)

A separate, purpose-built admin surface at admin.lanceraos.com — not
Django's raw /admin/, which stays reserved for direct database
administration. Built, audited, and had its audit findings closed (see
DECISIONS.md's 02-04 August 2026 entries); see ADMIN.md for the living
per-module coverage tracker and DATABASE.md for the admin_sessions
schema entry.

Architecture, deliberately independent from the main app's own
auth/session stack end to end, not layered on top of it:
- Access is gated by can_access_admin_panel on User — deliberately
  separate from Django's own is_staff/is_superuser. A second field,
  is_super_admin, gates the two most consequential actions (granting
  and revoking someone else's admin access) behind a stricter check
  than every other admin endpoint uses — a regular admin can search,
  view, suspend/reactivate, and read the audit log, but only a
  super-admin can change who else has admin access.
- Sessions use their own model (AdminSession, apps/admin_panel/models.py)
  and their own cookies (lanceraos_admin_access/lanceraos_admin_refresh
  — names deliberately distinct from the main app's cookies, since both
  sets travel to the same api.lanceraos.com), not apps.users.Session —
  an admin login must never compete for the regular app's 3-session cap.
  Capped at 2 concurrent admin sessions (tighter than the main app's 3),
  1-day token lifetime (vs. 30/90 days).
- AdminCookieJWTAuthentication requires an admin_sid claim, embedded
  only by admin token minting — this is what stops a stolen regular
  access token from being replayed against admin endpoints (or vice
  versa), since without it a valid JWT for the same user ID would
  otherwise be accepted by either surface.
- 2FA is mandatory, not optional, for admin access: admin_login rejects
  any account with two_fa_enabled=False outright, and login is always
  two-step (email+password issues an emailed OTP; only verifying that
  OTP actually mints an admin session).
- admin_login's own IP-keyed rate limit is deliberately NOT the same
  counter as the main app's increment_failed_attempts() — sharing it
  would let anyone who merely knows an admin's email lock that person
  out of their entire regular account with no password needed at all
  (a real finding from the admin-panel security audit, since fixed).

What's built (frontend + backend, verified end to end): login with
mandatory 2FA; user search/detail; per-user session list + individual
revoke; suspend/reactivate (protected — nobody can suspend their own
account, and only a super-admin can suspend another admin account,
enforced at the backend, not just hidden in the UI); the two-tier
is_super_admin grant/revoke model; the audit log viewer (filterable by
user/actor/event/date range, paginated, with self-view exclusion from
the default view and an admin-only filter); deletion-queue management
(restore action); resend-verification. Every consequential mutating
admin action shares the _admin_action_rate_limited convention — 30/hour
per acting admin, independent of admin_login's own limit.
admin-frontend/ is its own Vite project (see Section 4), not a route
inside the main frontend/ app.

---

### Module 2 — Invoices + Client CRM + Client Portal
Status: In progress. Foundations (`core/events.py`, `core/money.py`, `apps/payments/`'s
`ExchangeRateSnapshot` + daily fetch task), the Client CRM backend (`apps/clients/`), the Invoice
Core (data layer + CRUD/lifecycle endpoints + the real PDF render pipeline), the design system's
backend contract (`InvoiceDesign.design_data`'s schema, validation, and CRUD), the design system's
real drag-and-drop canvas editor and template gallery (Step 8b), AND Path 3 (AI-seeded designs,
Step 9 — classify-only against a real Groq vision call, `core/ai.py` + `apps/invoices/ai_design.py`)
plus the signature tool (Step 9, classical image processing, `apps/invoices/signature_tool.py`) are
all built and tested, plus a real frontend for invoices (list/detail/lifecycle actions, aging
report, autosave) — see Section 4's `frontend/` tree. Invoice creation (Step 9b) was reworked from
an eagerly-created empty draft to a delayed-creation, 3-stage wizard (`NewInvoiceWizard.jsx`) — no
backend row exists until a real threshold (a valid client) is crossed; see DECISIONS.md's
09 August 2026 entry for the full reversal reasoning. The one-time PDF render+store also moved
this pass from mark-sent to finalise (`_finalise_invoice`, `apps/invoices/views.py`) — `created`-
and-beyond invoices now always redirect to the frozen `pdf_url` rather than live-rendering on every
`GET`; a "Preview PDF" wizard action covers the pre-finalise case via the same live-render endpoint
still available at `status='draft'`. `Invoice.finalised_at` (new field, Step 9b) backs both the PDF
freeze point and a real `invoice_timeline` (now surfaces created/finalised/sent lifecycle events,
not just views/reminders/payments — including WHO sent it, Step 9c: "Sent by LanceraOS" vs "Marked
as sent by you", no new actor field needed since a manual mark-sent only ever has one possible human
actor). Step 9c (10 August 2026) reworked the wizard further: it now doubles as the edit surface for
an already-existing draft (`editInvoiceId` prop) — every status=draft invoice opens here instead of
`InvoiceDetailPanel`, pre-filled with real saved data; the client step is search-driven against the
real `GET /clients/?search=` endpoint (no more Existing/One-Time toggle) with an opt-in "save as new
client" flow backed by real server-side duplicate-email validation
(`ClientSerializer.validate_email`); currency/tax/discount moved into stage 2 alongside line items;
Mark-as-Sent was removed from the wizard entirely (stays in `InvoiceDetailPanel` only); and
`reminders_enabled` now defaults to `False` for new invoices (was `True`, ported from v1) at both the
model field default and the wizard's own blank-form state. Step 9c also fixed 3 real, confirmed bugs
found this pass — the "hasn't been sent" banner showing on every post-created status instead of just
`sent`; a new `InvoicePreset` never appearing in "From Preset" without a full reload; the 3 dashboard
KPI cards wrapping to one-per-row on phone widths — and renamed `created`'s DISPLAY label to
"Finalised" everywhere (the stored status value is untouched). See DECISIONS.md's 10 August 2026
entry for the full reasoning on each. One endpoint is deliberately excluded, not
stubbed: the real `/send/` (needs `core.email.send_email()`, Step 10). The client portal, payment
claims *workflow* (confirm/reject), comments *delivery*, recurring/reminder *background tasks*, and
per-invoice design override at creation time also don't exist yet — their tables/fields/backend
contracts do (or, for the per-invoice override, don't even have a UI field to plug into yet —
confirmed directly against `InvoiceFormFields.jsx`, flagged in DECISIONS.md rather than added) —
but nothing calls them on a schedule, serves them publicly, or wires them into invoice creation yet.
The signature tool's own frontend (an upload UI in Settings/Profile) also isn't built yet — Step 9
built the backend endpoint only, per this project's established backend-first build order; flagged
in DECISIONS.md rather than silently added. See `INVOICES_CLIENTS_TECHNICAL_SPEC.md` for the full design
this is being built against, and `DECISIONS.md` for each step's reasoning as it lands.
App: apps/invoices/ (+ apps/clients/ for the Client CRM — see below; apps/payments/ supplies the
currency-conversion anchor both depend on)

The most important module. Two closely related features in one app.

Invoice Generator — built (apps/invoices/), including real PDF rendering, email delivery still not:
Invoice creation in any currency with no hardcoded choices (validated in the serializer layer via
apps.clients.serializers.validate_currency_code, reused directly rather than duplicated). Line items
(InvoiceItem) with quantity and unit price; `recalculate_totals()` derives subtotal/tax/total from
them, ported directly from v1. Tax rate and discount at invoice level, with total clamped to never
go negative if a discount exceeds subtotal+tax. Anchor-currency conversion (`rate_to_usd_at_issue` +
a snapshot FK, locked in by `invoice_finalise`/`invoice_mark_sent`) replaces v1's PKR-specific rate
tracking — conversions are computed live from ExchangeRateSnapshot history, never stored at payment
time; `capture_issue_rate()` attaches a snapshot for USD invoices too (Step 7b fix), so this line
shows correctly even when the invoice currency is USD and the client's isn't. The three PDF
templates (`apps/invoices/templates/invoices/{professional,minimal,modern}.html`) are built, wired
to real Invoice/Client/InvoiceItem/FreelancerProfile data, and actually rendered to real PDFs via
WeasyPrint (`apps/invoices/pdf_generator.py`, Step 7b) — real embedded/subsetted custom fonts
(IBM Plex Sans/Mono, Source Serif 4, Space Grotesk), a real QR code (base64 data URI, ported from
v1's `generate_qr_image`) encoding `Invoice.payment_page_url`, and `FreelancerProfile.signature_url`
(new field, mirrors `logo`'s exact pattern) rendering when set. `GET /api/invoices/<pk>/pdf/`
live-renders for draft/created invoices and redirects to a frozen, stored Cloudinary `pdf_url` for
sent-or-beyond invoices, populated exactly once by `invoice_mark_sent`. Template selection is an
interim default (`FreelancerProfile` default-template setting checked first, then `'professional'`)
until Step 8b's editor lets a real `InvoiceDesign` get picked per invoice. The real `/send/` action
and the manual `mark-sent` dropdown flip both exist now, but only the latter is built (the former
needs the email engine).

Invoices start as a draft with NO invoice number at all — `invoice_finalise` (draft -> created) is
what assigns the real INV-YYYY-NNNN, confirmed against `invoice_duplicate`'s own behavior (which
resets invoice_number on the copy it makes). Editing (PUT) and hard-deleting (DELETE) are only
permitted on draft (edit) or draft/created (delete) invoices — enforced server-side with a 403, not
frontend-trusted, and covered by a dedicated regression-test category per status value.

Invoice status lifecycle: draft -> created -> sent -> viewed -> partially_paid -> paid, with
cancelled/refunded/bad_debt as terminal states reachable from most of those (cancel/bad-debt only
from sent-or-beyond; refund only from paid/partially_paid). There is deliberately NO stored
`overdue` status — a real v1 bug (a nightly task that overwrote status to `'overdue'`, destroying
the real underlying status) is fixed by never writing that value anywhere; `days_overdue` is a pure
read-time property layered on top instead. `Invoice.update_paid_status()` (ported from v1, fix
applied) enforces every payment-driven transition. Cancelled, refunded, and bad_debt invoices are
never modified by payment operations — verified directly with tests, including for `refunded`, a
status v1 never had at all so its own guards never covered it.
The manual "mark as sent" dropdown flip (`invoice_mark_sent`) requires an explicit confirm plus a
reminders on/off choice, and deliberately never sets `sent_via_platform` — that flag is reserved for
the real `/send/` action alone (Step 10) and only gates automated reminders, confirmed against its
own field documentation.

Partial payments (InvoicePartialPayment): multiple partial payments per invoice, each tracked with
amount, currency, an anchor-currency rate_to_usd, source, and date. Status updates automatically via
update_paid_status() as payments are recorded or removed. "Mark paid" pre-fills the full outstanding
balance as a real payment record (never a bare status edit) via the same flow. Undo removes exactly
the most-recently-recorded payment and restores the exact pre-payment status — repeatable, walking
back through multiple payments one at a time; undoing a payment recorded more than 7 days ago
requires an explicit confirmation flag (this app's own judgment call, not spec-pinned). A `payment`
FK to a future `apps.payments.Payment` model is NOT yet added — that model doesn't exist, and Django
rejects a FK to a nonexistent model outright (verified empirically); it'll be a real migration once
Module 3 builds `Payment`.

Dashboard KPIs (`GET /api/invoices/summary/`) — Outstanding / Total Paid this month / Past-Due —
and the AR aging report (Current/1-30/31-60/61-90/90+ days, the "broader version": every unpaid
invoice regardless of how it was sent) are both built. The summary endpoint's exact
sent_via_platform-gating rules couldn't be verified against their original source document (not
present in this repo); built fully unconditional instead, on the one piece of concrete evidence
available (`sent_via_platform`'s own field docs say it only gates reminders) — see DECISIONS.md.

Recurring invoices: model fields exist (is_recurring, recurring_interval_days — 6 options kept from
v1, recurring_auto_send, parent_invoice, next_recurring_date) and pause/resume actions are built, but
the Celery Beat generation task does NOT exist yet.

Payment reminders: InvoiceReminder table exists (ported directly from v1, unique per invoice per
reminder number), toggle-reminders is built, but the escalating-reminder Celery task does NOT exist
yet.

Public invoice page: `view_token` exists on Invoice (unique, indexed, unguessable) but the actual
public page/endpoint does NOT exist yet (needs the client portal, Step 11). InvoiceViewEvent (view
tracking) and InvoiceComment (new — the unified two-way message thread replacing v1's complete
absence of messaging) and PaymentClaim (ported directly from v1) all exist as tables with no
comment-posting/claim-confirm view layer yet either — invoice_timeline (built) surfaces views,
reminders, and payments today, and will pick up comments/claims additively once those steps land,
with no change to entries already there.

Client CRM — backend built (apps/clients/), no frontend yet:
Client records with name, email, company, address, phone, country, default currency (no hardcoded
choices — validated against apps.payments' ExchangeRateSnapshot instead, so a new currency is a
data change, never a migration), default payment terms, and a freeform notes field. A separate
ClientNote model holds structured, timestamped, freelancer-authored notes (private, never
client-visible) — distinct from the single freeform field on the client record itself. ClientTag is
a minimal user-scoped label (name + hex color), many-to-many with Client.
Archive (is_active=False) instead of delete — deletion is a separate, later, invoice-preserving-by-
default action that needs apps/invoices to actually have that choice. Flag problematic clients
manually, with a reason and one of three flag types (payment_risk/communication/other); an
auto_flagged field is reserved on the model for a future score-threshold-derived version of this,
but no logic fires it yet.
Reliability score: computed via Client.payment_stats, weighted and transparent, shown with a
breakdown by outcome — +5 paid on/before the due date, -3 paid 1-30 days late, -10 paid 31+ days
late, -20 bad_debt; cancelled/refunded invoices excluded entirely (not counted at all, not scored
zero); the score itself is the NORMALIZED AVERAGE across qualifying invoices (paid or bad_debt
outcomes only), never a raw sum. Every number in this is genuinely zero/None today, honestly, not
faked — apps/invoices doesn't exist yet, so there are no real invoices to score. See DECISIONS.md
(08 August 2026) for the full formula reasoning.
List/search/filter/sort: filter by active/flagged/archived/all/new_this_month (with_overdue exists
as a filter option but returns empty until apps/invoices exists — there's no overdue data yet, and
returning "all clients" instead would be misleading); search by name/email/company; sort by
name/recent now, total_invoiced/overdue fall back to name-sort until apps/invoices exists (both need
real invoice data to mean anything).
Client statement PDF (WeasyPrint) and one-time-client conversion are NOT built yet — both need real
invoice data and are scoped to a later step in this module's build order.

Client Portal (secure, PIN-authenticated):
Clients access a dedicated portal via token link in invoice emails.
First access: 6-digit PIN sent to client's email. PIN is hashed before
storage, never stored in plain text. Session persists 30 days after PIN
entry. New device: client self-serves a new PIN via "Resend PIN" -
freelancer not involved. Existing sessions on other devices remain active
when a new PIN is issued. "Log out everywhere" available.
Freelancer's "Open Portal" button bypasses PIN (they are already authed).

Portal shows: all invoices with this freelancer, payment history,
upcoming invoices, two-way message thread.

Client Messaging (inside portal):
Full two-way chat thread between client (in portal) and freelancer
(in main app). No account needed for client - messages tied to portal
session. When client sends a message: immediate in-app notification to
freelancer. If unread after exactly 1 hour: one reminder email + one
in-app notification. No further reminders. Freelancer replies from
within the app. Messages stored with sender, timestamp, read status.

Key API endpoints — apps/clients/ (built, real):
- GET/POST /api/clients/ (filter/search/sort per the Client CRM section above)
- GET/PUT /api/clients/{id}/
- POST /api/clients/{id}/archive/ + /restore/ + /flag/
- GET/POST /api/clients/{id}/notes/ + PUT/DELETE /api/clients/{id}/notes/{note_id}/
- GET /api/clients/{id}/analytics/ (payment_stats + reliability breakdown)
- GET/POST /api/clients/tags/
- POST /api/clients/{id}/tags/{tag_id}/attach/ + DELETE /api/clients/{id}/tags/{tag_id}/

Key API endpoints — apps/invoices/ (built, real):
- GET/POST /api/invoices/
- GET/PUT/DELETE /api/invoices/{id}/ (PUT: draft only; DELETE: draft/created only — both 403 otherwise)
- GET /api/invoices/{id}/pdf/ (live-render for draft/created; redirect to stored pdf_url for sent+)
- POST /api/invoices/{id}/finalise/ + /mark-sent/ + /mark-paid/
- POST /api/invoices/{id}/payments/ + DELETE /api/invoices/{id}/payments/undo/
- POST /api/invoices/{id}/cancel/ + /refund/ + /bad-debt/ + /duplicate/
- POST /api/invoices/{id}/toggle-reminders/ + /pause-recurring/ + /resume-recurring/
- GET /api/invoices/{id}/timeline/
- GET /api/invoices/summary/ + /aging-report/ + /exchange-rate/
- GET/POST /api/invoices/presets/ + GET/PUT/DELETE /api/invoices/presets/{id}/
- POST /api/invoices/presets/{id}/set-default/ + /create-invoice/
- GET/POST /api/invoices/designs/ + GET/PUT/DELETE /api/invoices/designs/{id}/ (Step 8 — the
  validated design_data contract; see this module's own design-system note below)
- POST /api/invoices/designs/{id}/set-default/ + /designs/duplicate/ (instantiates one of the 3
  builtin templates as a real, owned InvoiceDesign row — Path 1 of the design-system flow)

Key API endpoints — apps/invoices/ (built, real — Step 9):
- POST /api/invoices/designs/ai-seed/ (Path 3 — classify-only AI seeding, see this module's own
  design-system note below; rate limited separately/stricter than every other design endpoint,
  5/hour, since it's a real external Groq API cost per call)
- POST /api/invoices/signature/ (classical Pillow background removal, not AI — preview-then-commit
  via a `commit` flag on the same call; writes FreelancerProfile.signature_url/signature_public_id,
  Step 7b's fields. Backend only — no frontend upload UI yet, see DECISIONS.md)

Key API endpoints — apps/invoices/ (deliberately NOT built — excluded, not stubbed):
- POST /api/invoices/{id}/send/ (real send — needs core.email.send_email(), Step 10)
- POST /api/invoices/{id}/acknowledge/, GET/POST .../comments/, GET/POST .../claims/ + confirm/reject,
  WebSocket endpoints, all public/* portal endpoints, email/incoming webhook — each needs a later
  step (portal auth Step 11, comments Step 13, claims Step 14) that hasn't landed yet.
- Per-invoice design override at invoice-creation time — `InvoiceFormFields.jsx` has no design-picker
  field at all yet (confirmed directly), so there's genuinely nowhere for it to plug into today —
  flagged in DECISIONS.md's Step 8b entry rather than added as unplanned scope.
- GET /api/clients/{id}/statement/pdf/ (needs real invoice data + WeasyPrint, later step)
- GET/POST /api/clients/{id}/messages/, portal PIN endpoints — client portal, Step 11.

**Design system (`InvoiceDesign.design_data`) — backend contract AND editor both built (Steps 8/8b)**:
a documented two-zone JSON schema (`apps/invoices/design_schema.py`) — `zone_1` (logo/business_info/
client_info/dates, absolutely positioned, save-time overlap-checked) above the line-items table, and
`zone_2` (the mandatory table + totals block, plus notes/signature/payment_info as a
spacing-relative flow that can never overlap something that might grow) — validated at save time
with specific, per-violation error messages, not a generic rejection. The 3 built templates are
decomposed into real seed `design_data` (`apps/invoices/design_seeds.py`) — Python constants, not
database rows (`InvoiceDesign.user` is a required FK, so there's no ownerless "builtin" row) —
materialized into a real, owned `InvoiceDesign` row via `design_duplicate` the moment a user picks
one.

A real, working drag-and-drop canvas editor (`frontend/src/pages/design-editor/DesignEditor.jsx`,
full-screen and shell-less like `/account/deletion-review`, reached via "Manage Designs" in
`Invoices.jsx`'s header -> `DesignGallery.jsx`) is built on top of GrapesJS core (evaluated against
Puck and rejected — Puck's own docs confirm a slot/zone-only model with no absolute-positioning
support at all, a hard blocker for Zone 1's real coordinate requirement; GrapesJS's core, free,
BSD-3 API genuinely supports `dmode:'absolute'` drag + `resizable` handles, confirmed directly
against its installed source). Real free-form drag/resize in Zone 1, flow-reorder-only in Zone 2,
the mandatory table/totals block genuinely non-removable in the UI (not just backend-enforced —
and a real bug in the first implementation of this was caught and fixed by this step's own browser
testing, see DECISIONS.md), a pairing toggle restricted to signature/payment_info, a style panel
writing into each element's free-form `style` dict, undo/redo, a Preview toggle, and a
3/8/20-sample-row toggle that genuinely reflows Zone 2 are all real and browser-verified. One
confirmed, deliberate gap: no client-side Zone 1 overlap prevention — only the backend catches that
today, demonstrated directly (dragging one element onto another and saving surfaces
`design_schema.py`'s exact real error message in the editor).

Path 3 (AI-seeded designs, Step 9, `apps/invoices/ai_design.py`) is also built and reached from the
same gallery: upload a reference image, one real Groq vision call (`GROQ_MODEL_VISION`, via the now-
real `core/ai.py`) classifies it against the same 3 base templates + a couple of real extracted
colors + a coarse layout-density choice — deliberately CLASSIFY-only, never full HTML generation
(a separate real POC explored that and was rejected for this system specifically; see DECISIONS.md
for the full reasoning). The resulting `design_data` is produced by adjusting one of
`design_seeds.py`'s own seeds — provably overlap-safe by construction (a uniform scale transform,
not independent per-element nudges) — then re-validated against the exact same schema validator
before the row is ever saved. Verified live against the real Groq API, not just mocked: a real bug
(the vision model's own `<think>` reasoning was exhausting the token budget before ever reaching the
JSON answer) was found and fixed this way. Full detail in DATABASE.md's `invoice_designs` section
and DECISIONS.md's Step 8/8b/9 entries.

---

### Module 3 — Payments + Expenses + P&L
Status: [updated as built]
App: apps/payments/

Income tracking:
Manual payment entry with amount, currency, source, date, notes.
Payoneer CSV import: parses Payoneer's specific CSV format, deduplicates
via external_id, supports batch rollback.
Wise CSV import: same pattern, different column mapping.
Custom spreadsheet import: flexible column alias detection (20+ synonyms
per field) to handle user-exported spreadsheets.
Payment-invoice matching: link a recorded payment to an outstanding
invoice. Outstanding balance updates automatically.

Expense tracking:
Expenses with amount, category, date, description, receipt image
(uploaded to Cloudinary). Categories: software, equipment, internet,
office, travel, professional development, other.
Deductible/non-deductible flag per expense (affects FBR calculation).

Exchange rates:
Daily USD, EUR, GBP to PKR snapshots via external rate API.
Fetched by Celery Beat at 6:00 AM PKT daily.
Used for PKR conversion on invoices and payments.
Exchange rate alerts: user sets target rate + direction (above/below).
Celery checks hourly, sends in-app + email notification once when
threshold crossed. Alert auto-deactivates after firing.

P&L Report:
Date range selector + quick filters (current year, last year, Q1-Q4).
Shows: total income by category, total expenses by category, gross
profit, taxable income (after deductible expenses), estimated FBR tax.
Downloadable as PDF (WeasyPrint).

Income Certificate (sub-feature of this module, not a separate module):
Formal PDF document suitable for banks, visa applications, PSEB
registration. Configurable period and purpose. Shows monthly income
breakdown in USD and PKR equivalent. Uses WeasyPrint with a formal
letterhead layout. Triggered from the P&L section.

Key API endpoints:
- CRUD /api/payments/
- POST /api/payments/import/payoneer/
- POST /api/payments/import/wise/
- POST /api/payments/import/custom/
- DELETE /api/payments/import/{batch_id}/ (rollback)
- POST /api/payments/{id}/link-invoice/
- CRUD /api/expenses/
- GET /api/payments/pnl/
- GET /api/payments/pnl/pdf/
- GET /api/payments/income-certificate/pdf/
- GET /api/payments/exchange-rates/
- CRUD /api/payments/alerts/

---

### Module 4 — FBR Tax
Status: [updated as built]
App: apps/tax/

FBR income tax compliance for Pakistani freelancers.
Covers the current tax year (2025-26 slabs from Finance Act 2025).
Tax year runs July 1 to June 30.

Tax calculation:
Uses actual FBR 2025-26 slab structure. Pulls income from
apps/payments/ for the current tax year. Deducts recorded deductible
expenses from apps/payments/. Calculates taxable income and tax owed.
Shows effective rate. Projects year-end based on monthly average.

SRO 586(I)/2022 checker:
Checks if user qualifies for complete IT export tax exemption.
Eligibility requires: income from IT export, PSEB registration number
in profile. Displays eligibility status, missing requirements, links to
PSEB registration at pseb.org.pk and FBR Iris at iris.fbr.gov.pk.

Quarterly advance tax schedule:
Shows Q1-Q4 payment deadlines and amounts based on projected annual income.
Overdue quarters highlighted. Direct link to FBR Iris for payment.
Celery Beat sends reminder notifications before each deadline.

Monthly income breakdown:
Month-by-month view of income and tax liability for the full tax year.

Tax statement:
Printable formal statement for accountant submission or FBR reference.
Generated by WeasyPrint.

FBR filing guide:
Step-by-step guide to filing annual return on FBR Iris. Static content.

Context injection for AI tax guidance:
The actual text of FBR 2025-26 slabs and SRO 586 notification is
embedded directly in every AI prompt for tax-related questions.
The model is not asked to recall tax law from training - it is given
the law as context. This produces accurate, updatable guidance without
fine-tuning. When tax law changes, only the injected text needs updating.

Key API endpoints:
- GET /api/tax/overview/
- GET /api/tax/quarterly/
- GET /api/tax/monthly/
- GET /api/tax/sro586/
- POST /api/tax/calculator/
- GET /api/tax/statement/pdf/

---

### Module 5 — Financial Health Score
Status: [updated as built]
App: apps/health/

Scores the freelancer's business health out of 100 across 5 dimensions.
Configurable analysis window: 3, 6, 12, or 24 months.

5 dimensions:
1. Income Consistency (25 pts) - regularity and predictability of income
2. Savings Buffer (20 pts) - expenses vs income ratio, financial cushion
3. Tax Compliance (20 pts) - NTN registered, PSEB registered, income
   tracked, expenses recorded, FBR awareness
4. Income Growth (20 pts) - trend vs prior period
5. Client Diversity (15 pts) - income spread across clients

Each dimension shows current score, what is needed for a higher score,
and specific actionable steps.

Priority improvement tips:
Ranked list of the improvements with highest score-gain potential.
Specific, not generic. References the user's actual numbers.

Radar chart: Recharts radar chart showing all 5 dimensions visually.

Mini widget: Compact health score component shown on the dashboard.
Score, grade (Excellent/Good/Fair/Poor), and top 1 improvement tip.

Key API endpoints:
- GET /api/health/score/?months=12
- GET /api/health/mini/

---

### Module 6 — Proposals
Status: [updated as built]
App: apps/proposals/

Manual proposal creation:
Scope sections, line items with pricing, payment terms, validity period.
Client details auto-filled from CRM. Proposal number auto-generated.

AI proposal generation:
Freelancer pastes a job description. System sends to Groq with a
carefully engineered prompt returning structured JSON: proposal text,
quality score (1-10), improvement feedback, word count.
Three tone options: Professional, Friendly, Technical.
Generated proposals saved as drafts automatically.

Client response flow:
Proposal sent to client via email with secure token link.
Client views proposal on public page (no account needed).
Client accepts or declines with optional message.
Client IP address and timestamp recorded on response.
Freelancer receives immediate in-app + email notification.
Proposal expiry date: client cannot accept after expiry.

Convert to invoice:
One click converts an accepted proposal to a draft invoice.
Line items, client details, and amounts pre-populated. No re-entry.

Key API endpoints:
- CRUD /api/proposals/
- POST /api/proposals/{id}/send/
- POST /api/proposals/{id}/generate-ai/
- GET /api/proposals/public/{token}/
- POST /api/proposals/public/{token}/respond/
- POST /api/proposals/{id}/convert-to-invoice/

---

### Module 7 — Contracts
Status: [updated as built]
App: apps/contracts/

5 pre-built templates: Web Development, Design, Consulting,
Content Writing, Custom. Each is a WeasyPrint HTML template.

Sending: contract sent to client via email with secure token link.
Client views on public page using same PIN portal auth as invoices.

Digital signing: client types name as signature. On submit: name,
IP address, user agent, and timestamp recorded. Freelancer notified
immediately via in-app + email.

Decline flow: client can decline with reason. Freelancer notified.

Contract linking: can link to a proposal or to an invoice.

Key API endpoints:
- CRUD /api/contracts/
- POST /api/contracts/{id}/send/
- GET /api/contracts/public/{token}/
- POST /api/contracts/public/{token}/sign/
- POST /api/contracts/public/{token}/decline/

---

### Module 8 — Subscriptions
Status: [updated as built]
App: apps/subscriptions/

Plans:
- Free: 5 invoices/month, 3 clients, manual payments only,
  no AI features, no CSV import
- Pro ($5/month): unlimited everything, all AI features,
  CSV import, health score, exchange rate alerts

Enforcement: every endpoint that creates invoices, clients, or
payments checks subscription tier before proceeding. Returns 403
with upgrade prompt if free tier limit reached.

Key API endpoints:
- GET /api/subscriptions/status/
- GET /api/subscriptions/plans/
- POST /api/subscriptions/upgrade/

---

### Module 9 — Dashboard
Status: [updated as built]
Not a separate app - aggregates data from all other apps.

Contents:
- Time-aware greeting
- 4 KPI cards: Outstanding, Paid this month, Overdue, Active clients
- Income trend bar chart (last 6 months, PKR) via Recharts
- Financial health mini widget
- AI income insights (3 specific insights, cached 24 hours)
- Upcoming recurring invoices (next 7 days)
- Recent activity feed
- Live exchange rates (USD/EUR/GBP to PKR)
- Needs attention section (overdue invoices, unread messages,
  unanswered proposals)

Key API endpoints:
- GET /api/dashboard/summary/
- GET /api/dashboard/insights/

---

### Module 10 — Help / AI Assistant
Status: Built last, after all other modules complete.

A dedicated Help page (not a floating widget).
Uses Groq AI with LanceraOS documentation embedded in system prompt
as context. Answers questions about how to use the platform only.

---

## 6. Database Schema
See DATABASE.md — the 6-question framework answered for every table
that exists: core.AuditLog, core.ApiRequestLog, core.NotificationRead,
all six apps.users tables, and apps.admin_panel's admin_sessions table
(the users/admin tables being seven, spanning two apps) — as of this writing.

---

## 7. Module Build Status

| Module               | Backend | Frontend | Tests | Status      |
|----------------------|---------|----------|-------|-------------|
| Users / Auth (incl. admin panel) | Built | Built | 123 passing (`python manage.py test`, backend) | Complete |
| Invoices + Clients   | apps/clients/ + apps/invoices/ (models + CRUD/lifecycle endpoints incl. real GET .../pdf/, `finalised_at` + PDF-freeze-at-finalise, design_data schema/CRUD + AI-seed/signature tool, Step 9; payment-amount-exceeds-due validation + client duplicate-email validation, Step 9c; only /send/ excluded, pending Step 10) built | Invoices list/detail/lifecycle/aging report/timeline + delayed-creation 3-stage wizard with draft-edit mode + search-driven client step (`NewInvoiceWizard.jsx`, Step 9b/9c) + design gallery/canvas editor + AI-seed upload built (Client CRM frontend, per-invoice design picker, signature upload UI not yet) | Backend: 518 passing (`python manage.py test`). Frontend: 51 passing (`npm test`, `frontend/`, incl. `NewInvoiceWizard.test.jsx`, `invoiceHelpers.test.js`) + real browser-driven verification (not yet a committed E2E suite) | In progress |
| Payments + Expenses  | -       | -        | -     | Not started |
| FBR Tax              | -       | -        | -     | Not started |
| Health Score         | -       | -        | -     | Not started |
| Proposals            | -       | -        | -     | Not started |
| Contracts            | -       | -        | -     | Not started |
| Subscriptions        | -       | -        | -     | Not started |
| Dashboard            | -       | -        | -     | Not started |
| Help / AI Assistant  | -       | -        | -     | Not started |

---

## 8. Environment Variables Required

SECRET_KEY=
DEBUG=
ALLOWED_HOSTS=
DB_NAME=
DB_USER=
DB_PASSWORD=
DB_HOST=
DB_PORT=
REDIS_URL=
CELERY_BROKER_URL=
CELERY_RESULT_BACKEND=
CHANNEL_LAYER_URL=
GROQ_API_KEY=
GROQ_MODEL_FAST=openai/gpt-oss-20b
GROQ_MODEL_QUALITY=llama-3.3-70b-versatile
RESEND_API_KEY=
RESEND_FROM_EMAIL=noreply@lanceraos.com
RESEND_FROM_NAME=LanceraOS
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
GOOGLE_CLIENT_ID=
FACEBOOK_APP_ID=
FACEBOOK_APP_SECRET=
VITE_API_URL=http://localhost:8000
VITE_WS_URL=ws://localhost:8000
FRONTEND_URL=http://localhost:5173

### Cookies (httpOnly JWT + CSRF — see DECISIONS.md)
COOKIE_DOMAIN=
# Local dev: leave blank (host-only cookie). Production: .lanceraos.com
COOKIE_SECURE=False
# Production: True
COOKIE_SAMESITE=Lax
CSRF_TRUSTED_ORIGINS=
# Production: https://lanceraos.com (users visit the root domain directly —
# there is no app.lanceraos.com. The API backend lives on a separate
# subdomain, api.lanceraos.com, which users never visit directly; see the
# domain decision entry in DECISIONS.md.)

### Encryption
# Fernet key — reversible encryption (CNIC/NTN/PSEB, custom SMTP passwords)
ENCRYPTION_KEY=
# HMAC key for blind-indexing CNIC/NTN/PSEB — NEVER reuse ENCRYPTION_KEY
# here. Opposite security properties by design (randomized vs.
# deterministic) and must be rotatable independently.
BLIND_INDEX_KEY=

### Observability
SENTRY_DSN=

---

## 8b. Three Supporting Documents

Alongside CLAUDE.md, maintain these three files in the project root.
Update them as you build. All three now have real content as of the
Users/Auth module build — see DATABASE.md, STANDARDS.md, DECISIONS.md.

### STANDARDS.md
Coding conventions every module chat must follow.
Contains:
- Model naming: singular PascalCase (Invoice not Invoices)
- URL naming: plural kebab-case (/api/invoices/ not /api/invoice/)
- View function naming: verb_noun (create_invoice, get_invoice_list)
- Serializer naming: ModelNameSerializer, ModelNameCreateSerializer
- Test naming: test_[action]_[condition]_[expected_result]
- Every model must have __str__ returning a human-readable string
- Every view must have a docstring explaining what it does
- No print() statements anywhere — use logging.getLogger(__name__)
- File path as the first line of every file
- Dead code/config gets removed on discovery, not preserved for fidelity

### DATABASE.md
Grows as each module is built.
For every table: the 6 questions answered + the schema + reasoning.
This is the authoritative reference for what exists in the database.

### DECISIONS.md
Running log of architectural decisions.
Format for each entry:
  Date: [date]
  Decision: [what was decided]
  Reason: [why]
  Alternatives considered: [what else was evaluated]
  
Example:
  Date: July 2026
  Decision: JWT stored in httpOnly cookies, not localStorage.
  Reason: localStorage is readable by any JS on the page — a single

## 8c. Running This Locally

Four things need to be running simultaneously for the app to actually work end to end — not
just the two (`runserver` + `npm run dev`) that were enough before scheduled background tasks
(account deletion, session/device cleanup) started mattering.

```
redis-server                                    # brew services start redis — leave this always-on
python manage.py runserver                      # Django backend, :8000
npm run dev                                      # Vite frontend, :5173  (run from frontend/)
celery -A config worker -l info                  # actually executes scheduled/background tasks
celery -A config beat -l info                    # actually triggers them on schedule
```

**Redis** is cheap, stateless infrastructure — leave it running permanently as a background
service (`brew services start redis`), the same way you'd never think to manually start/stop a
database.

**Celery worker + beat** are your own application code, not infrastructure — start them
manually alongside `runserver` when you're working on anything that touches deletion, sessions,
2FA, or email-sending, same as you'd start `runserver` itself. Don't run them as a permanent
background service yet — with only one module built and a small, infrequently-changed beat
schedule, a silently-running worker executing stale code because you forgot it was still up is a
worse failure mode than "oh right, I need to start it." Revisit this once more modules land and
scheduled tasks are relied on constantly, not just when deliberately testing this specific area.

**macOS-specific gotcha, will bite you every time otherwise:** the Celery worker crashes the
moment it tries to fork a child process to actually run a task (`WorkerLostError: signal 6
(SIGABRT)`, from Apple's Objective-C runtime not tolerating being forked into). Not a Celery bug
— start the worker with this env var set:
```
OBJC_DISABLE_INITIALIZE_FORK_SAFETY=YES celery -A config worker -l info
```

**To manually trigger a scheduled task right now**, without waiting for Beat's schedule (useful
for testing deletion/cleanup behavior): `python manage.py shell`, then
`from apps.users.tasks import anonymize_expired_accounts; anonymize_expired_accounts.delay()`
— this publishes a real task through the real Redis queue to a running worker, not a shortcut
that bypasses the actual pipeline.
  XSS vulnerability becomes an instant account-takeover vector.
  Alternatives considered: v1's Authorization-header + localStorage
  approach (rejected, exactly the anti-pattern being replaced).