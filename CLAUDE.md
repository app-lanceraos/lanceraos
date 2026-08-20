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
   see DECISIONS.md), a real notification bell/panel backed by
   core/notifications.py (GET/POST /api/notifications/...) with a real
   WebSocket push (core/consumers.py's NotificationConsumer) — the badge
   is fetched immediately on mount, updated live, and stays in sync
   across multiple open tabs (see DECISIONS.md's 16 August 2026 entry),
   profile popup (Profile/Settings/Help/Sign out), theme toggle.
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
Mark-as-Sent was removed from the wizard entirely (stays in `InvoiceDetailPanel` only). Reminders
default is a two-part lifecycle rule as of 10 August 2026's second entry (superseding this same day's
earlier "default False everywhere" note): the wizard's own creation-time default is back to `True`
(what a user sees while creating), but `_finalise_invoice` now unconditionally forces the stored
value to `False` the moment an invoice actually leaves draft, regardless of what was submitted —
`Invoice.reminders_enabled`'s bare model-field default stays `False`, unrelated to the wizard and moot
post-finalise either way. Step 9c also fixed 3 real, confirmed bugs
found this pass — the "hasn't been sent" banner showing on every post-created status instead of just
`sent`; a new `InvoicePreset` never appearing in "From Preset" without a full reload; the 3 dashboard
KPI cards wrapping to one-per-row on phone widths — and renamed `created`'s DISPLAY label to
"Finalised" everywhere (the stored status value is untouched). See DECISIONS.md's 10 August 2026
entry for the full reasoning on each. The real `/send/` is now built (Step 10, 11 August 2026 —
`apps/invoices/email_service.py`'s custom-SMTP-vs-Resend routing chain, `core/email.py`'s
attachment/cc/reply_to/message-id extensions, `apps/invoices/tasks.py`'s day-3/7/14/30 reminder
Celery task, `apps/invoices/notifications.py`'s first-ever `@on(...)` handlers) — the reminder
*background task* now exists and runs daily at 9AM (`config/celery.py`'s beat_schedule), gated on
`sent_via_platform=True` (only the real send sets this; the manual mark-sent flip never does). The
client portal, payment claims *workflow* (confirm/reject), comments *delivery* (including the
inbound reply-to receiving endpoint — the OUTBOUND `reply+<view_token>@lanceraos.com` address is now
set correctly on every sent/reminder email, but nothing receives a reply to it yet, deliberately —
that's Step 13), recurring-invoice *generation*, and per-invoice design override at creation time
still don't exist yet — their tables/fields/backend contracts do (or, for the per-invoice override,
don't even have a UI field to plug into yet — confirmed directly against `InvoiceFormFields.jsx`,
flagged in DECISIONS.md rather than added) — but nothing calls them on a schedule, serves them
publicly, or wires them into invoice creation yet. The signature tool's own frontend (an upload UI
in Settings/Profile) also isn't built yet — Step 9 built the backend endpoint only, per this
project's established backend-first build order; flagged in DECISIONS.md rather than silently
added. 11 August 2026: the reload-feel complaint (10 August's
fix was real but incomplete) traced to status/Overdue filtering still being a real server round-trip
on every pill click — ported v1-reference's actual architecture for this one interaction
(`Invoices.jsx`'s `visibleInvoices`, a pure client-side filter over the already-loaded list, zero
network calls; `Clients.jsx`'s filter pills deliberately stay server-side, since v1's own Clients
page never had this client-side pattern to port). Both `Invoices.jsx` and `Clients.jsx` also gained a
mobile filter dropdown (`.filter-row-mobile`, ≤768px) collapsing the pill row into a single `<select>`
next to the existing sort dropdown. `InvoiceDetailPanel.jsx` gained a real "Send" action (Step 10,
second 11 August 2026 entry) at `status='created'`, alongside — not replacing — the existing manual
"Mark as Sent" flip; the 3-state send banner's third case (`sent_via_platform=True` → no warning) is
now exercised by real data for the first time. 13 August 2026 (Step 11) built Client Portal
Authentication (`apps/clients/models.py`'s `ClientPortalSession`, `apps/clients/portal.py`,
`apps/clients/cookies.py`, `apps/clients/views_portal.py`) — magic-link entry via the existing
`Client.portal_token`, self-serve link resend (rate-limited), logout/logout-everywhere, and a
standalone (not-yet-wired) freelancer-preview-mode guard — plus, as a required prerequisite, promoted
the custom-SMTP-vs-Resend routing chain out of `apps/invoices/email_service.py` into
`core/email.py` (`send_client_facing_email`) so `apps.clients` never needs to import `apps.invoices`.
Deliberately excludes Invoice.view_token as an alternate portal-entry credential, the portal's
invoice list, and wiring the preview guard into real call sites — all Step 12's job, since they need
real Invoice data this app doesn't reach into. 13 August 2026 (Step 12) closed every one of those
gaps, in `apps/invoices/` (importing FROM `apps.clients.portal`, never the reverse — confirmed with
the same AST-based zero-import check Step 11 ran on itself): `GET /api/invoices/portal/me/` +
`.../portal/<pk>/` (a real, minimal client-facing serializer, never the freelancer-facing one) +
`.../portal/view/<view_token>/` (the actual rendered HTML page — `build_portal_context`/
`render_invoice_portal_html`, `pdf_generator.py`, reuse the exact same template `_select_template_name`
picks for the PDF, with real `/static/...` font URLs swapped in for WeasyPrint's `file://` ones — the
"one HTML/CSS renderer, three outputs" principle, see DECISIONS.md); Invoice.view_token is now a
second real portal-entry credential alongside `Client.portal_token`, mints/renews the same
`ClientPortalSession` for a saved client and creates none at all for a one-time client (scoped to that
one invoice's own token only); `is_freelancer_previewing_portal` is wired to its first real call
sites — the Sent->Viewed transition and `InvoiceViewEvent` logging, both newly firing on a real
request path for the first time, gated by one shared check; Preview-as-Client
(`invoice_preview_as_client`) is a structurally separate, freelancer-authenticated endpoint reusing the
same renderer but never minting a session or logging a view; the "View Invoice Online" link (closing a
gap Step 10/11 explicitly flagged as stale) now appears in both the real send and every reminder tier.
A real, necessary frontend fix landed alongside this: `src/lib/api.js`'s global 401-refresh interceptor
would otherwise hard-redirect a session-less portal visitor to the freelancer's own `/login` — fixed by
adding `/clients/portal/`/`/invoices/portal/` to its existing `SKIP_REFRESH_URLS` allowlist. 14 August
2026 (Step 13) built Comments — `InvoiceComment`'s two real write paths (`invoice_comments`, `views.py`,
freelancer; `portal_invoice_comments`, `views_portal.py`, client — both immutable, no edit/delete
endpoint anywhere), the inbound email-reply webhook (`views_email.py`, a new `CLOUDFLARE_WEBHOOK_SECRET`
shared-secret setting, no prior scaffolding existed), and this codebase's first real WebSocket feature
(`apps/invoices/consumers.py`'s `ClientThreadConsumer`, dual freelancer-JWT/portal-session auth, routed
by `view_token` not `pk` — see DECISIONS.md for the full reasoning on all three). Real-time delivery
reuses Channels' own standard type-dispatch convention (no pre-existing `NotificationConsumer` was
found anywhere in this codebase to mirror, despite that being assumed — confirmed directly). The
unread-after-1hr batched email (`apps/invoices/tasks.py`'s `notify_unread_comments`, every 15 min, ONE
email per invoice) is symmetric by direction — a deliberate generalization beyond CLAUDE.md's own
original Client Messaging paragraph below, which only described client-authored comments; the
immediate in-app bell ping stays client-authored-only as originally written, and there's a real,
flagged gap where a SECOND bell ping at the 1-hour mark (the original paragraph's own wording) wasn't
built, only the email — see DECISIONS.md's 14 August entry. Frontend: a real `CommentThread.jsx`
(shared by both sides) and `src/hooks/useWebSocket.js` (built for real this pass — it existed only as
an empty placeholder file before, despite CLAUDE.md's frontend rules already describing it as
established convention). 15 August 2026 (Step 14) built Payment Claims — portal submission
(`portal_invoice_claims`, `views_portal.py`, reachable for a saved client via its portal session OR
a one-time client via that invoice's own `view_token`), freelancer list/confirm/reject (`invoice_claims`/
`invoice_claim_confirm`/`invoice_claim_reject`, `views.py` — confirm reuses the exact
`InvoicePartialPaymentSerializer` + `update_paid_status()` path `invoice_add_payment`/`invoice_mark_paid`
already use, never a third parallel payment-recording implementation), both real notification tiers
(`payment_claim_submitted` bell+email to the freelancer, `payment_claim_confirmed` email-only to the
client), and a real Step 13 gap closed alongside it — `portal_invoice_comments` never had the
freelancer-preview guard wired in; it does now, and so does the new claims endpoint. Also added
`PaymentClaim.review_note` (new field, v1 had no equivalent — see DECISIONS.md). Frontend: a real
"Report a Payment" form in `ClientPortal.jsx` (saved-client session path only — the one-time-client
`view_token` path is real and tested at the API layer with no frontend surface reaching it yet, same
honest gap Step 11's own portal-entry point had before Step 12) and a Claims tab in
`InvoiceDetailPanel.jsx` with confirm/reject actions. 15 August 2026 (second pass) built the module's
final three pieces. Step 15, Client Acknowledgment: `POST /invoices/portal/<pk>/acknowledge/`
(`portal_invoice_acknowledge`) — same saved-client-session-or-one-time-client-view_token access model
as claims (now shared via a `_resolve_portal_write_access` helper both endpoints call), idempotent
(a repeat call returns the existing timestamp with 200, never an error), no unacknowledge path
anywhere. Step 16, Recurring Invoices: `apps/invoices/tasks.py`'s `generate_recurring_invoices`
(daily, 8:30 AM PKT) — series settings (interval/auto_send/design) are read LIVE from the invoice's
own recurring root (`Invoice.get_recurring_root()`) at generation time, never copied onto a generated
child; `_duplicate_invoice_core` (extracted from `invoice_duplicate`, reused by both) creates each
occurrence, auto-send reuses `_finalise_invoice`/`_send_invoice_now` from Step 10/10b; calendar-month-
accurate advancement via `dateutil.relativedelta` for the 2-month/quarterly/annual intervals (a new
explicit dependency, `python-dateutil`); per-invoice failure isolation with 3-strikes auto-pause
(`recurring_failure_count`, new field); "edit the whole series" is a narrow allowance on the EXISTING
`PUT /api/invoices/<pk>/` (a recurring root, past its own draft status, may still change exactly
`recurring_interval_days`/`recurring_auto_send` via a new `RecurringSeriesSettingsSerializer`).
Step 17, Escalation + Formal Notice: confirmed `escalation_required` was already being set correctly
by Step 10's reminder task — only the notification handler was missing, now built
(`invoice_escalation_required`, bell+email); `POST /invoices/<pk>/dismiss-escalation/` clears the
prompt without erasing the historical flag; Formal Notice (`POST /invoices/<pk>/send-formal-notice/`,
manual-only, `confirm:true`, gated on `escalation_required OR status='bad_debt'`) is a real, distinct
firmer-toned email reusing the same send-email routing chain, trackable via a new
`Invoice.formal_notice_sent_at` (never blocks a deliberate re-send) and a real, enforced
`FreelancerProfile.formal_notice_enabled` kill switch (checked server-side, not just hidden in the
UI). Frontend: acknowledge button/permanent-state in `ClientPortal.jsx`; an escalation banner +
dismiss + Formal Notice actions, an "Edit Series" modal for a recurring root, and acknowledgment/
escalation/formal-notice timeline entries in `InvoiceDetailPanel.jsx`; the Formal Notice toggle in
Settings > Business's "Invoicing Defaults" card. 15 August 2026 (third pass) built the module's last
two functionally-new steps before bug-hardening + Admin. Step 18, Analytics: a weekly stale-draft
digest (`apps.invoices.tasks.notify_stale_drafts`, Monday 9:30 AM PKT, one batched notification per
user, per-currency breakdown never summed across currencies) and a real cross-invoice analytics
dashboard (`GET /api/invoices/analytics/`) distinct from `invoice_summary`'s own KPI strip —
month-over-month invoiced/collected trends (real grouping queries), top clients by revenue (a real
ORM ranking, reusing `Client.payment_stats` only for the reliability-score half), and a currency
breakdown with one genuine anchor-currency-unified USD total via `core.money.Money` — that value
object's first real consumer anywhere in this codebase (built in Foundations, never actually used
until now). Found and fixed a real, blocking gap along the way:
`InvoicePartialPayment.rate_to_usd` was never populated by any call site despite its own `help_text`
claiming otherwise — fixed via a new `_lookup_rate_to_usd` helper wired into `invoice_add_payment`/
`invoice_mark_paid`/`invoice_claim_confirm`. Frontend: Recharts installed for real (CLAUDE.md's tech
stack already named it, just never installed) — a new `/invoices/analytics` page with a real,
validated 2-color trend chart, a top-clients list, and a currency-breakdown card, reached via a new
"Analytics" header button in `Invoices.jsx`. Step 19, Client Statement PDF: `GET /api/clients/<pk>/statement/pdf/?start=&end=`
(freelancer-facing only — confirmed directly, no client-portal-facing equivalent is named anywhere in
the spec), live-rendered on every call (no frozen-artifact concept, unlike a sent invoice), reusing
the same WeasyPrint pipeline/font-sourcing convention and the same anchor-currency mechanism
`Invoice.client_currency_conversion` is built on (generalized to total/paid/outstanding via a new
`_invoice_amounts_in_client_currency` helper). A running balance is the cumulative outstanding total
across the listed invoices in chronological order. Frontend: a "Generate Statement" action + date-
range modal in `ClientDetailPanel.jsx`, downloading via a plain browser navigation (the httpOnly
session cookie already travels on a same-site top-level GET). See `INVOICES_CLIENTS_TECHNICAL_SPEC.md`
for the full design this is being built against, and `DECISIONS.md` for each step's reasoning as it lands.
16 August 2026 (verification pass) — a full pass against a real bug report/QA guide covering the whole
module, not a new Step. Two real REVERSALS of earlier rules (see DECISIONS.md for full reasoning on
both): (1) `invoice_summary`'s Outstanding/Past-Due no longer gate on `sent_via_platform` at all —
every invoice in `ACTIVE_STATUSES` counts regardless of how it was sent, since the old gate read a
near-permanent $0 for most real invoices (manually-marked-sent ones); `sent_via_platform`'s only two
remaining real uses anywhere are the `created`-status banner and the timeline's "sent by you" vs "sent
by LanceraOS" label. (2) `NewInvoiceWizard.jsx`'s stage-3 "Reminders enabled" toggle removed entirely —
it never actually controlled anything (standalone Finalise always forces it off; Finalise & Send has
its own separate confirm-step checkbox), so it was dead UI. Real, confirmed-by-reproduction bugs fixed:
a partially-paid overdue invoice missing from Past-Due (fully explained by reversal 1); a blank white
screen visiting the Timeline tab of a paid/partially-paid invoice (a real `ReferenceError` in
`invoiceHelpers.js` — `formatMoney` was only ever re-exported, never locally imported, so
`timelineLabel`'s own call to it threw; a new general-purpose `ErrorBoundary` component now also wraps
the Timeline tab); the PDF/portal "Pay online" link/QR pointed at a `/pay/<token>` frontend route that
never existed (`payment_page_url` now IS `portal_view_url`); Preview-as-Client silently failed to
render in its own iframe (Django's own clickjacking protection, `X_FRAME_OPTIONS`, blocked it in both
DEBUG and production — fixed with a single-view `@xframe_options_exempt`); a freelancer previewing
their own client's real portal link could falsely mark their own messages "seen by the client" (GET's
read-marking never checked `is_freelancer_previewing_portal`, only POST did); all 3 PDF/portal
templates showed a "Tax (0%) — $0.00" row even with no tax, and an empty "Payment methods" header with
nothing under it when none were configured; `professional.html` alone never rendered `signature_url`
despite this document's own earlier claim that all three did. `invoice_summary` and
`invoice_analytics`'s currency breakdown used to sum raw Decimals across every invoice's own currency
with zero conversion (e.g. "$64 + Rs.100" showing as "164") and the analytics unified total was
hardcoded to USD regardless of `FreelancerProfile.default_currency` — both fixed via one new shared
`_unify_amounts_to_currency` utility built on a new `Money.to_currency()` method. Finalise/Finalise &
Send were measurably slow (a real, profiled ~1.7s Cloudinary round trip synchronous inside the request)
— fixed by moving PDF render+store into a real Celery task fired via `.delay()`, with
`fetch_invoice_pdf_bytes`'s existing self-heal chain now also covering a routinely-blank `pdf_url`, not
just a failed fetch of a real one. Accounts Receivable Aging removed entirely (`invoice_aging_report`
view/URL/tests deleted, confirmed unused anywhere else first) — the "and the AR aging report" sentence
two paragraphs up is now historical, not current. List pagination reworked to a real tiered shape: 10
most recent by default, Show More to 20 (client-side append), real server-paged navigation (`Page X of
Y`) beyond that, Show fewer collapses back to 10 — status/Overdue filtering stays a pure client-side
operation with zero network calls at every depth, unchanged from the 11 August reload-feel fix.
`InvoiceDetailPanel`'s action-button footer reorganized into 3 groups (primary lifecycle / secondary
utility / destructive-terminal); comment threads gained real seen/sent double-check indicators and now
accept PDF attachments (not images only) with real server-side content validation for both, rendered
inline (thumbnail or document icon) via a shared click-to-view modal instead of a raw Cloudinary link.
`Invoice.issue_date` added to the wizard (was previously write-only reachable, never exposed) and
`due_date` made required + validated strictly after `issue_date`, both client- and server-side. See
DECISIONS.md's 16 August 2026 (verification pass) entry for the full reasoning behind every item above.
16 August 2026 (verification pass, second round) — another real REVERSAL (see DECISIONS.md): non-"All"
invoice-list filters (a specific status, or Overdue) are real, independently-paginated server queries
again (`?status=X`/`?overdue=true`, same tiered pagination shape as "All", own real `total`) — safe now
that the 11 August reload-feel fix's actual root cause (the loading skeleton unmounting the whole grid
on every refetch) is fixed on its own terms, so a real network call per filter click no longer feels
like a reload; "All" itself is unchanged (client-side window over the loaded page). Real bugs found and
fixed: notification click-through for comment/claim/acknowledgment/escalation/recurring-generation
events landed nowhere real — `core.notifications.EVENT_ACTION_URLS` built a `/invoices/{id}` path that
has never matched any real route (`Invoices.jsx`'s detail view is a state-driven panel, not a routed
page); now builds `/invoices?invoice={id}` (+ `&tab=comments`/`&tab=claims` for the two tab-specific
events), read by a new mount effect in `Invoices.jsx` that opens the target invoice directly on the
right tab via a new `initialTab` prop on `InvoiceDetailPanel`. Comment seen/sent status required a
manual refresh to update — `ClientThreadConsumer` already broadcast new comments but never read-state
changes; a new `read_state.update` WS message (`apps.invoices.comments.broadcast_read_state`) fixes
this, verified with a real 2-connection test. Payment claims could be submitted for more than the
invoice's real outstanding balance (accepted, then only rejected later at freelancer-review time) — now
capped at submission via the same real-balance-check pattern `InvoicePartialPaymentSerializer` already
established. New UX: the notification panel's bulk-select control no longer renders with zero
notifications; the Details-tab reminders toggle is hidden entirely on `paid`/`bad_debt`/`refunded`/
`cancelled` (terminal — nothing left to remind about); bulk delete in the invoice list (checkbox only on
draft/created invoices, Select-all scoped to only those, a real confirm step, client-side loop over the
existing single-delete endpoint — no bulk endpoint existed to reuse) alongside the detail panel's own
single-delete action (already correctly built in the prior round, confirmed unchanged); the client
portal's existing "Report a Payment" modal now also shows real claim history (status + the freelancer's
own rejection reason if applicable) via a new GET on `portal_invoice_claims`, and is reachable even once
an invoice is fully paid (it doubles as "check your claim status", not just "report a new payment"). See
DECISIONS.md's second 16 August 2026 entry for the full reasoning behind every item above.

17 August 2026 (List/Table restructure) — a real, large layout restructure of both `Invoices.jsx` and
`Clients.jsx` plus a new AppShell mechanism, not a component-by-component patch. Pagination: the tiered
"10 -> Show More -> 20 -> server-paged" system (and "All"'s client-side-window carve-out from the
previous entry) is GONE on both pages — every filter/search/sort/currency combination is now a
uniform, real server-paginated query at `PAGE_SIZE=20` (`Pagination.jsx`, real numbered nav desktop,
compact "Page X of Y" mobile), since the root cause the tiered system existed to work around was
already fixed on its own terms two entries ago. `invoice_summary` (KPI strip) gained a real
`?period=this_month|last_6_months|this_year|all_time` (default `this_month`) and `?currency=` param,
scoped ONLY to the 3 KPI cards, never the list below: Outstanding/Overdue scope to `issue_date` within
the window, Collected scopes to `InvoicePartialPayment.payment_date` instead (money that actually
arrived, regardless of the invoice's own issue period) via a new `_collected_amount` helper;
`all_time` keeps the exact pre-existing amount_paid-minus-refunded_amount math for backward
compatibility (refunds have no per-transaction date to scope into a window — a real, flagged gap, see
DECISIONS.md). Collected alone gets a real month-over-month delta, shown only at period=this_month.
"Total Paid"/"Past-Due" are now labeled "Collected"/"Overdue" (display-only; JSON keys unchanged). Both
list endpoints (`invoice_list`/`client_list`) gained a real `?currency=` WHERE-clause filter, backed by
new `GET /api/invoices/currencies/` + `GET /api/clients/currencies/` distinct-value endpoints for each
dropdown's real option list — deliberately separate from the KPI strip's own fixed-list currency
selector. Frontend: a real measured-width filter-row overflow (`useFilterOverflow.js`) into a "More
filters" dropdown rather than a fixed breakpoint; a real AppShell header-action-injection mechanism
(`usePageHeaderActions.js` + `PageHeaderActionsContext`, confirmed no such mechanism existed before
building it) that both pages' header actions (Analytics/More/New Invoice; Add Client) now use instead
of each page rendering its own inline header row, folding into AppShell's mobile 3-dot menu where
applicable. Two real bugs found and fixed during this pass (both in DECISIONS.md): a fresh-JSX-node-
every-render infinite loop in the new header-injection hook, and an invisible icon in `DropdownMenu`'s
default icon-only trigger caused by `.fos-btn`'s own padding colliding with a small fixed-size box
under this app's border-box reset. Verified with real backend + frontend tests (issue-date-vs-payment-
date fixtures, the delta calculation, both currency filters, the overflow arithmetic via a synthetic-
width harness) and real Playwright screenshots at 375/768/1280/1920, light and dark, against the actual
running dev servers with a seeded demo account. See DECISIONS.md's 17 August 2026 entry for full
reasoning on every item above.

17 August 2026 (InvoiceDetailPanel redesign) — a full rebuild of `InvoiceDetailPanel.jsx`'s header,
tabs, reminders UI, and action footer, plus a change to how the invoice list opens a row. Preview-as-
Client (the in-app iframe modal) is removed entirely — "View Invoice" now opens the real
`portal_invoice_view_html` page directly in a new tab; the freelancer-own-session guard
(`apps.clients.portal.is_freelancer_previewing_portal`) is untouched and re-verified by a new regression
test hitting that real endpoint directly. Header gained a real due-date countdown ("X days remaining" /
red "X days overdue", `dueDateCountdown()` in `invoiceHelpers.js`). Tabs reordered to Details/Timeline/
Claims/Comments. Reminders is now exactly one of two states — a top warning banner with a real "Turn on
reminders" button (`RemindersOffBanner`) when off, a plain on/off toggle in the Details tab when on,
never both — never either on a terminal invoice. The action footer collapsed to one real primary +
secondary pair per status (Send/Mark as Sent when `created`; Add Payment + View Invoice when active and
not overdue; Add Payment + a real new "Send Reminder N" when active and overdue, N computed from
`InvoiceReminder` rows and reusing the exact scheduled-task code path via a new `_send_reminder` helper,
disappearing entirely once all 4 are sent; Download Invoice + View Invoice once resolved), with
everything else — Duplicate, Save as Preset, a new Change Due Date (narrow-PUT allowance mirroring the
recurring-series pattern), Copy Invoice Link, Download Invoice, Refund, Undo Payment, a new Resend
Invoice (repeatable, scoped to `sent`/`viewed`/`partially_paid`, reuses the `/send/` email chain without
touching `status`/`sent_at`), Cancel, Mark Bad Debt, Formal Notice, and Delete folded into a "More"
dropdown that only ever shows what's actually reachable for the current status. Add Payment is now one
unified two-path popup ("Mark Fully Paid" / "Add a Partial Amount") replacing two separate modals. The
Comments tab gained its own fixed-recap/scrollable-thread/fixed-input internal layout (reusing
`CommentThread.jsx`'s own already-correct internal flex structure, just given real height for the first
time); the whole panel's outer container changed from one scrolling region to a real 3-region flex
column (fixed header/tabs, flexible per-tab content, fixed footer) to support it. Separately: the
invoice list's whole row is now the open-affordance (`InvoiceTable.jsx`'s dedicated Action column is
gone, matching `InvoiceCard`'s existing mobile pattern; the row checkbox stops click propagation so
selecting for bulk-delete can't also open the panel), and bulk delete's own trigger moved to the
existing floating action bar, unified this round to render at every width instead of being mobile-only.
Two real mobile bugs caught by this round's own Playwright screenshots (not assumed, not separately
requested, fixed alongside): the 4-tab row overflowing unreadable at 375px (now horizontally scrollable)
and `DropdownMenu.jsx`'s CSS-only positioning overflowing off-screen when its trigger sits near a
viewport edge (now viewport-clamped via `useLayoutEffect`, the same approach `useAppTooltip.js` already
uses) — the second fix is general, benefiting every other consumer of that shared component, not just
this one call site. See DECISIONS.md's 17 August 2026 (InvoiceDetailPanel redesign) entry for the full
reasoning on every item above, including the deliberate More-menu scoping calls (Edit and Archive
omitted as non-functional; Refund/Undo Payment/Delete included despite not being explicitly named).

18 August 2026 (real frontend-domain invoice view page + Download proxy fix) — a real, reported issue
fixed: every client-facing invoice link (the "View Invoice Online" email link, the portal list's own
row link, the PDF's QR code/"Pay online" link, "View Invoice"/Copy Invoice Link in InvoiceDetailPanel)
used to point at the raw backend/API host, never the actual product domain. `Invoice.portal_view_url`
(`apps/invoices/models.py`) now builds `{FRONTEND_URL}/invoice/<token>/` instead of the old
`{BACKEND_URL}/api/invoices/portal/view/<token>/` — every consumer flows through this one property
automatically. A real new React route, `/invoice/:token` (`frontend/src/pages/InvoiceView.jsx`, no
AppShell — shell-less like `DeletionReview.jsx`/`PortalEnter.jsx`), serves it: fetches the exact same
backend-rendered HTML `portal_invoice_view_html` already produces (unchanged — still every real
access-control side effect, `is_freelancer_previewing_portal` etc., entirely server-side) and displays
it in a fully sandboxed `<iframe srcDoc>`, with a real `<base href>` fix for a genuine bug this pass
caught (srcDoc content's relative `/static/...` font URLs otherwise resolve against the FRONTEND's own
origin, not the backend's, silently falling back to system fonts). This supersedes the earlier
"non-SPA-navigation exception" (`App.jsx`/`ClientPortal.jsx`/`PortalEnter.jsx` comments all updated) for
a purely cosmetic/branding reason — the one-shared-renderer principle itself is unchanged.
`InvoiceListSerializer` gained a real `portal_view_url` field so the frontend reads this authoritative
URL directly instead of re-deriving it from `view_token` (the exact drift that let the backend host leak
back in previously). Separately, `GET /api/invoices/<pk>/pdf/`'s old sent-or-beyond behavior — a bare 302
redirect straight to the stored Cloudinary `secure_url` — is what surfaced this account's real, already-
confirmed raw/PDF-delivery ACL restriction directly to the browser as a broken download; reworked to
proxy the actual bytes through the endpoint via `fetch_invoice_pdf_bytes` (the same self-heal chain
`/send/`/`/resend/` already use) with a real `Content-Disposition: attachment`, making Download resilient
regardless of that Cloudinary Console setting. A genuinely new public endpoint,
`GET /api/invoices/portal/view/<token>/pdf/` (`portal_invoice_pdf_download`), gives `InvoiceView.jsx`'s
own Download button something to call — the shared templates had no download link of their own, and the
freelancer-facing `/pdf/` is authenticated/owner-scoped, unreachable by an actual client. Verified live
against the real dev Cloudinary account's actual ACL restriction (not simulated): Copy Invoice Link/View
Invoice both produce the new frontend URL, the rendered page shows correct custom typography (not a
font-fallback), and Download on both the public and freelancer-authenticated paths produced a real, valid
PDF file even though a raw redirect to the same stored asset would 401. See DECISIONS.md's 18 August 2026
entry for the full reasoning.

18 August 2026 (second pass, same day) — closed a real gap the first pass's own `<iframe srcDoc>` HTML
approach left open: `build_portal_context`/`render_invoice_portal_html` were still being called on
EVERY view (just via a fetch instead of a direct navigation), still pulling the freelancer's CURRENT
`FreelancerProfile` fresh each time — a profile edit after sending an invoice could still silently
change what "View Invoice" showed a client later, even though the real downloadable PDF stayed frozen.
`portal_invoice_view_html` (`apps/invoices/views_portal.py`) no longer calls that renderer at all — it
now serves the ACTUAL FROZEN PDF inline (same bytes `portal_invoice_pdf_download` serves), with a real
503 "isn't ready to view yet" when nothing's frozen yet, never a live-render fallback.
`InvoiceView.jsx` was rewritten to match: fetches via blob (not `srcDoc` HTML text), shows the PDF in
the browser's own native viewer via a same-origin `blob:` object URL, and Download does the same (a
programmatic `<a download>` click, never a plain `<a href>`/`<iframe src>` pointing at the backend
host) — this is also what fully closes the backend-host-hiding item the first pass's Download button
alone didn't finish (`CORS_EXPOSE_HEADERS = ['Content-Disposition']` added so the real filename still
comes through). Two more real bugs fixed the same pass: `portal_invoice_list` (`GET .../portal/me/`)
used to return every invoice for the resolved client with no status filtering at all — a client with
portal access via one real sent invoice could see every OTHER invoice from that freelancer too,
including drafts; now excludes `draft`/`created` (the same "actually delivered by some real means"
boundary this app already draws elsewhere). `portal_invoice_claims`
(`apps/invoices/views_portal.py`) gained a real duplicate-pending-claim rejection, and — tracing the
actual failure path rather than assuming new logic was needed — a fix to the real reason an
already-fully-paid invoice's rejection (and every OTHER validation error on that endpoint) was showing
a generic "Could not submit" instead of its own real message: DRF's default field-keyed error shape was
never something `ClientPortal.jsx`'s `ClaimModal` could read at all (it only checks a flat top-level
`error` key) — now fixed at the source for every case on that endpoint, not just the two new ones. See
DECISIONS.md's second 18 August 2026 entry for the full reasoning, including an honest, live-tested
finding: the `fetch_invoice_pdf_bytes` self-heal chain's own live-render fallback (pre-existing,
unchanged, out of this pass's scope) still carries a narrower, infrastructure-failure-only version of
the same drift risk when this account's real Cloudinary ACL restriction forces it to trigger — a
materially separate, larger fix than this pass's own scope.

18 August 2026 (fifth pass, same day) — a real console-error bug fix plus another InvoiceDetailPanel
bug-hardening round, frontend-only. Fixed the root cause of a real, reported "WebSocket connection ...
failed: WebSocket is closed before the connection is established" console error on every fast mount/
unmount: `useWebSocket.js`'s cleanup used to call `ws.close()` even while the socket was still
CONNECTING — fixed at the hook level (`onopen` now defers to a `stopped` guard and closes itself once
the handshake actually completes) so both real consumers (`useNotificationSocket.js`, `CommentThread.jsx`)
inherit the fix with no changes of their own; added this hook's first-ever dedicated test file
(`useWebSocket.test.jsx`) since both existing consumers mock it away in their own tests. In
`InvoiceDetailPanel.jsx`: the reminders on/off toggle moved out of the Details tab's own scrolling flow
to a docked position directly above the footer; the footer's real buttons were sized more compactly
(`FOOTER_BTN_STYLE`) so primary + secondary + "More" fit one line at normal desktop width even for the
longest realistic combination, with no button going icon-only; Duplicate now replaces View Invoice as
the footer's secondary button everywhere View Invoice used to appear there (View Invoice stays reachable
from the header), removed from the More menu only for the specific statuses where the footer now shows
it (kept in More for `created` and for an overdue-active invoice with reminders still available, since
Duplicate has no other way to be reached in those two states — see DECISIONS.md for the full reasoning);
the mobile header's invoice-number/due-date lines and the mobile tab row both got real responsive font/
padding shrink at ≤480px instead of wrapping/requiring horizontal scroll (never truncation for the
invoice number). `AppShell.jsx`'s page-level "More actions" mobile menu trigger swapped from
`MoreHorizontal` to lucide-react's own `SlidersHorizontal` (a real matching icon already in this
codebase's exclusive icon library — no custom SVG introduced), a visual-only change. See DECISIONS.md's
fifth 18 August 2026 entry for the full reasoning on every item above, including an honest note that no
live browser/Playwright tool was available this pass to screenshot-verify the 375px sizing.

18 August 2026 (sixth pass, same day) — a real performance fix plus a third InvoiceDetailPanel/AppShell
bug-hardening round, this one actually screenshot-verified (a real Playwright + Chromium session was
available this pass, correcting the previous pass's own honest gap). `apps/invoices/email_service.py`'s
`fetch_invoice_pdf_bytes` gained a short-lived, per-invoice circuit breaker
(`PDF_REUPLOAD_BREAKER_TTL_SECONDS = 300`, `django.core.cache.cache`) — real terminal evidence showed every
view/download of an invoice affected by this account's confirmed Cloudinary ACL restriction paying for a
full render PLUS a doomed re-upload PLUS a doomed retry fetch on every single request; the breaker skips
straight from the render to the live-render fallback once a re-upload+retry has failed for that invoice
within the last 5 minutes, a real measured 65-66% speed-up (~0.17s -> ~0.06s per the new
`PdfReuploadCircuitBreakerTests`' own timing test). This does not fix the underlying Cloudinary Console
setting — that's still Ali's own separate, non-code fix. Frontend: the RemindersOffBanner and the
reminders-on toggle (both `InvoiceDetailPanel.jsx`) were genuinely oversized despite the previous round's
own claims — both redesigned to real compact pills/inline rows, sized to their actual content. The
footer's previous single `FOOTER_BTN_STYLE` (an inline style, which can't respond to a media query) either
looked cramped at desktop or still wrapped at real 375px — split into a moderate desktop baseline plus a
genuinely separate `.idp-footer-btn` CSS class with its own `@media (max-width: 480px)` override, verified
this time with real screenshots against every real per-status footer combination. `AppShell.jsx`'s mobile
"More actions" icon reverted from the previous round's `SlidersHorizontal` back to `MoreVertical` (a real
vertical three-dot ellipsis) — the previous swap was confirmed directly not what was wanted. Mobile header
spacing got real, measured reductions (logo-to-title gap 26px -> 14px; icon-row gap 6px -> 4px; each
mobile icon button's own box shrunk too, e.g. the bell 38px -> 34px). The desktop logo/wordmark got a real,
checked-first increase: `LogoSVG size={32}` -> `size={38}`, `WordmarkSVG width={107} height={16}` ->
`width={128} height={19}`. See DECISIONS.md's sixth 18 August 2026 entry for the full reasoning and the
real screenshot-verification details (375/768/1280/1920, light and dark, against the running dev servers
with the seeded `screenshot-demo@example.com` account).

19 August 2026 (production audit + first fix round) — `LANCERAOS_CLIENTS_INVOICES_PRODUCTION_AUDIT.md`
(dated 19 August 2026, project root) is a full production-readiness audit of this module, executed live
against a real running instance under the `superadmin` account — not a code-review-only pass. It found 3
CRITICAL, live-reproduced financial-data-corruption bugs (concurrent payments jointly overpaying an invoice
with no lock; a reachable "Undo Payment" action corrupting a refunded invoice into an impossible state) plus
9 further HIGH findings spanning concurrency, the freelancer-portal-preview guard, missing CSRF on client-
portal writes, and a systemic gap where the majority of invoice lifecycle events never reach `core.AuditLog`
despite CLAUDE.md's own Rule 10. Verdict: NOT READY. Two intentionally-corrupted invoices from the audit's
own live testing — `c6559f99-48b1-45e8-a562-76ab950f6500` / `INV-2026-0031` (`amount_paid=2100.00` on a
`1000.00` total) and `76472345-cdb5-4800-a2f0-6cc8ba1547e8` / `INV-2026-0025` (`status=refunded,
amount_paid=0.00, refunded_amount=300.00, outstanding_amount=900.00`) — remain in the database, deliberately
untouched, as historical before-evidence for the fixes below; they are not repaired by this pass (a real,
separate data-repair task, not undertaken here).

This same-day follow-up closed the audit's 4 top-priority findings (its own §26 "must fix before launch"
items 1-4; item 5, the WeasyPrint/Celery production-container verification, is an operational check outside
this pass's scope): **INV-003/DB-002** (concurrent payments overpaying an invoice) — every payment-recording/
status-mutating endpoint (`invoice_add_payment`, `invoice_mark_paid`, `invoice_claim_confirm`,
`invoice_cancel`, `invoice_refund`, `invoice_mark_bad_debt`) now runs its full read-check-write sequence
under a real, shared `select_for_update()` lock (`_get_locked_invoice`, `apps/invoices/views.py`), one
helper reused by all 6 rather than 6 independently-written locking blocks. **INV-009/FE-001** (Undo Payment
reachable on a terminal-status invoice) — `invoice_undo_payment` gained the same status guard its sibling
payment endpoints already had (reject cancelled/bad_debt/refunded/draft), and the frontend's own dead
`NO_PAYMENT_STATUSES` constant (defined, never actually used — the real gate had separately drifted and
omitted `refunded`) is now the single source of truth the More-menu gate reads from, not a second hand-
rolled copy. **INV-004** (invoice-number generation race) — a first attempt at a bounded retry (the audit's
own offered approach (b)) proved insufficient under real 8-way concurrent-request testing (independent
retries kept colliding with each other); switched to `select_for_update()` on the invoice's own `User` row
during number generation, the identical pattern `apps.users.models.Session.create_for_user` already
established for the same class of per-user-counter race. **INV-001** (stale total after clearing all line
items) — `recalculate_totals()`'s `if item_total > 0` guard is now unconditional, so a zero-item invoice
always resolves to a zero subtotal/tax/total, not a stale pre-edit value. All 4 fixes verified with GENUINE
concurrent-request tests (real Python threads, real separate DB connections, `TransactionTestCase` — not
sequential calls dressed up as concurrent) reconstructing the audit's own exact scenarios at higher
concurrency than originally reproduced, in a new `apps/invoices/tests/test_concurrency.py`; full
`apps.invoices` backend suite (646 tests) and frontend suite (220 tests, up from 215) both pass with no
regressions, production `vite build` clean. See DECISIONS.md's four 19 August 2026 "audit fix" entries
(one per finding) for the full before/after evidence and the alternatives each one considered.

19 August 2026 (production audit fix round 2 — INV-002, PORTAL-001, PORTAL-002) — closed 3 more findings
from the same 19 August 2026 audit (`LANCERAOS_CLIENTS_INVOICES_PRODUCTION_AUDIT.md`), backend-only this
round. **INV-002** (the AuditLog gap) — `apps/invoices/notifications.py` gained 8 real `@on(...)` handlers
(`InvoiceCreated`/`InvoiceFinalised`/`InvoicePaid`/`InvoicePartiallyPaid`/`InvoiceCancelled`/
`InvoiceRefunded`/`InvoiceMarkedBadDebt`/`InvoiceResent`), each reusing the pre-existing `InvoiceSent`
handler's exact shape (`User.objects.get` + `log_event(event, user=user, metadata={...})`), closing the gap
where 7 of 8 real lifecycle events left zero forensic trail — live-reconstructed and confirmed via a new
`apps/invoices/tests/test_audit_trail.py` querying `core.AuditLog` directly. **PORTAL-001** (the
freelancer-preview guard not checking ownership) — `apps.clients.portal.is_freelancer_previewing_portal`
now takes a required `owner_user_id` parameter and only returns `True` when the authenticated freelancer
session's own user actually matches it, closing the gap where a freelancer's own session combined with an
UNRELATED client's portal-session cookie was incorrectly treated as preview mode; all 5 real call sites in
`apps/invoices/views_portal.py` updated to pass `owner_user_id=invoice.user_id`. Verified with two genuinely
distinct real accounts (`apps/clients/tests/test_portal.py`'s new same-owner-vs-different-owner test, and a
new `CrossAccountFreelancerPreviewGuardTests` class in `apps/invoices/tests/test_portal.py` proving a real
client view/comment/claim/acknowledgment from an unrelated-freelancer-plus-portal-session combination now
behaves as a genuine client action, not suppressed or 403'd — the exact scenario the original audit flagged
as plausible but live-unverified). **PORTAL-002** (missing CSRF) — `portal_invoice_comments`/
`portal_invoice_claims`/`portal_invoice_acknowledge` (`apps/invoices/views_portal.py`) now call
`enforce_csrf_standalone(request)`, matching `apps/clients/views_portal.py`'s own established
`portal_logout`/`portal_logout_everywhere` pattern exactly; a new `PortalWriteEndpointsCSRFEnforcementTests`
class proves both directions — a real 403 with zero database side effect when the CSRF header is missing,
and unaffected real traffic when the token the frontend's shared Axios instance already sends is present.
Full backend suite: 776 passing (up from 759), no regressions; this round touched no frontend files. See
DECISIONS.md's three 19 August 2026 "audit fix, second round" entries for the full before/after evidence,
including the real test-design bug this pass's own AuditLog test caught and fixed along the way (a
loosely-scoped assertion that could grab the wrong invoice's event row).

19 August 2026 (design_data render path — closes PDF-001) — the design editor (Steps 8/8b) now
genuinely affects real invoice output, not just built-and-validated in isolation: a real, second
renderer (`apps/invoices/design_renderer.py` + `templates/invoices/dynamic_design.html`) reads
`InvoiceDesign.design_data` — every element position/size/style the canvas editor produces — and
actually renders it, closing a real audit finding (PDF-001) where `design_data`/`color_variant` were
validated and saved but never read by any real PDF/portal render path (only `base_template` was, to
pick one of the 3 static templates regardless of what a user actually built). Wired into
`pdf_generator.py`'s existing `render_invoice_pdf`/`render_invoice_portal_html` via one shared branch
(`_render_invoice_html`) — the 3 static templates remain the default, unchanged path; the dynamic
renderer only activates when a design's `design_data` is a real, structurally complete payload that
differs from the pure unedited seed for its own `base_template` (decided from `design_data` itself,
not `InvoiceDesign.source` — that field turns out not to reliably track whether a builtin design was
ever actually opened and edited, since the editor's own save call never sends it; see DECISIONS.md
for the full reasoning). Absolutely-positioned Zone 1, flow-based Zone 2 with real
`paired_side_by_side` two-column rows, the `modern.html` sidebar compromise (`style.sidebar: true`)
replicated as a real fixed, full-height, page-repeating container, and the same font-sourcing/
content-binding conventions (`FONT_CONTEXT`/`PORTAL_FONT_CONTEXT`, the same omit-when-unset rules)
the 3 static templates already established — no third, disconnected implementation. Verified with a
real 25-item multi-page stress test through this specific path and real PyMuPDF font-embedding
checks, plus zero regression to every invoice still on the 3 static templates (the overwhelming
majority of real `InvoiceDesign` rows today, since an untouched builtin pick is byte-identical to its
seed and deliberately still takes the faster static path). `color_variant` remains genuinely unused
by any render path — a pre-existing Step 8/8b gap, not touched by this pass, flagged in DATABASE.md
rather than silently left undocumented. Full `apps.invoices` suite: 700 passing (up from 671; 29 new
tests in `apps/invoices/tests/test_design_renderer.py`). See DECISIONS.md's 19 August 2026
"design_data render path" entry for the full design and reasoning.

19 August 2026 (SEV1 — the design-to-invoice assignment gap, same-day follow-up) — a real, direct
report that "NOTHING in the design editor actually works" was investigated from scratch, live, with
zero trust in any prior claim including this same document's own entry immediately above. Verdict,
stated plainly: that entry's claims were correct, and so were Step 8b's original "browser-verified"
editor claims — both re-proven live this pass (a real Chromium browser driven with Playwright against
the real dev servers, since no project run-skill existed for this app; a real drag AND a real
style-panel color change each independently survived a genuine fresh page reload). The actual, single
root cause was a third, OLDER, previously-undetected gap: `Invoice.design` was **never assigned by any
code path in the entire application** — confirmed against real production data before the fix, 82 real
invoices, 0 with `design_id` set, 13 real `InvoiceDesign` rows, 0 referenced by anything.
`InvoiceDesign.is_default` (the gallery's "Set as default" star, real since Step 8) was write-only —
set, never read, by anything, anywhere. Fixed: `invoice_create` now assigns the user's real default
design at creation time; `_finalise_invoice` backfills it for any pre-existing draft (all 32 real ones
in the database predate this fix); `_duplicate_invoice_core` carries a design forward like every other
copied field (Step 16's own recurring-generation override, reading the root's design live, still wins
unconditionally — verified with a real regression test). `DesignGallery.jsx`'s "Use this template" and
AI-seed upload now immediately set the result as the real default (matching the button's own name and
the report's own literal verification bar), and the gallery shows a real, live "Currently active for
new invoices: [Name] ([Template] — [Color])" banner — including an honest fallback state when nothing
is marked default, never silent. `InvoiceListSerializer` gained a real `design` field, previously
absent. Deliberately NOT built: a per-invoice design-override picker in the wizard (confirmed, still
genuinely absent — a real, separate, larger feature, named rather than silently added as unplanned
scope). A second, related, still-open gap surfaced but not fixed this pass: `color_variant` remains
completely inert even at design-CREATION time (a "Slate" pick produces `design_data` byte-identical to
"Sage") — real recoloring is a nontrivial content-design decision flagged for later, not rushed in.
Full `apps.invoices` suite: 710 passing (up from 700; 10 new tests in `apps/invoices/tests/
test_design_assignment.py`); full frontend suite: 224 passing; `vite build` clean. Verified live,
end to end, beyond the automated suite: a real invoice created through the actual `POST /api/invoices/`
endpoint automatically picked up a real edited (dragged + recolored) default design, and its real
rendered PDF contained the exact dragged coordinates. See DECISIONS.md's "SEV1 — the design-to-invoice
assignment gap" entry for the full investigation.

20 August 2026 (SEV1 — gallery previews + color_variant wiring) — another real, direct report:
a screenshot showing all 3 gallery template cards rendering the exact same generic thumbnail, not
reflecting the real template or the selected color swatch at all. Item 0 (verify first): base_template
selection itself already worked correctly for a genuinely new invoice — but a real, separate,
previously-undetected edge case was found and fixed: a still-`draft` invoice created BEFORE any default
design existed showed stale colors in its own LIVE preview even after a default was set, since the prior
round's backfill only ran at finalise. Fixed with `pdf_generator._effective_design`, a read-time-only
fallback to the user's current default for `draft`-status invoices exclusively — never past draft, where
the frozen-PDF guarantee holds absolutely (stated plainly, with real evidence from Ali's own account: all
29 of his non-draft invoices are permanently frozen at plain Professional colors and will never
retroactively change, by design — only his 1 remaining draft benefits). Item 1: the gallery's preview
cards (`DesignCanvasPreview.jsx`, now deleted) never received the selected color swatch at all and
rendered every element as a near-identical low-opacity gray box — fixed with a real backend HTML render
(`apps/invoices/design_preview.py`, 2 new endpoints, both `@xframe_options_exempt` like
`invoice_preview_as_client`) reusing the EXACT SAME `render_html_for_design` a real invoice uses, real
sample data, the user's own real logo — embedded via a scaled `<iframe>` (`DesignLivePreview.jsx`) that
updates live on every swatch click with zero page reload. Item 2: `color_variant` was genuinely inert
everywhere — traced to the 3 static templates using hardcoded hex throughout (not CSS custom properties,
confirmed directly), with a useful discovery along the way: each template's own hardcoded brand-accent
hex was already byte-identical to its own `COLOR_VARIANTS` `'default'` entry, making a real, contained
Django-template-variable substitution sufficient (`design_primary_color`/`design_secondary_color`,
resolved once via the same `_effective_design` + a new `design_seeds.resolve_design_colors`, shared by
both the static and dynamic render paths — plus a real pre-existing inconsistency in the dynamic
renderer's own sidebar CSS, hardcoded to Modern's colors regardless of the actual design's base_template,
caught and fixed the same pass). Verified live, all 9 real (template × color) combinations: gallery
screenshots showing 3 genuinely distinct template layouts, a live swatch-click color update with no
reload, and a real invoice created through the actual API rendering a PDF that visually matches its
gallery card exactly (plum sidebar + mint total pill, screenshotted directly). Full `apps.invoices` suite:
730 passing (up from 710; 20 new tests in `apps/invoices/tests/test_design_color_and_preview.py`); full
frontend suite: 224 passing (`DesignCanvasPreview.jsx` deleted, no test file existed for it); `vite
build` clean. See DECISIONS.md's 20 August 2026 "SEV1 — gallery previews + color_variant wiring" entry.

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
Client statement PDF is built (Step 19 — see this module's own Step 19 entry above and the
Key API endpoints list below). One-time-client conversion (the spec's own `convert-one-time`
endpoint) is NOT built yet — scoped to a later step in this module's build order.

Client Portal (secure, magic-link-authenticated):
SUPERSEDED from this section's original PIN-based description — see
DECISIONS.md's 13 August 2026 entry. The real, built design (Step 11,
matching INVOICES_CLIENTS_TECHNICAL_SPEC.md's own ClientPortalSession
spec) has no PIN anywhere: Client.portal_token is a persistent,
non-expiring credential (not a 6-digit code, never re-issued) that IS
the magic link itself. Visiting it mints/renews a real
ClientPortalSession — hashed cookie token, never stored raw, sliding
60-day window from last use (not 30, and not fixed-from-issue). New
device: client self-serves a fresh copy of the SAME still-valid link via
"Resend PIN" -> now "request-link" (POST /api/clients/portal/request-
link/, rate-limited 5/email/hour + 20/IP/hour) - freelancer not
involved. Existing sessions on other devices remain active when a new
one is minted. "Log out everywhere" available (revokes every session
for that client at once). An invoice's own view_token link is the
SECOND real portal entry point (Step 12) alongside Client.portal_token —
visiting any invoice link mints/renews the same ClientPortalSession for
a saved client (one click grants access to the client's entire portal,
not just that invoice); a one-time client's invoice (client=null)
creates NO session at all, scoped to that exact invoice's own
view_token only, per the spec's "no portal, no session" rule. The
freelancer-own-session guard
(apps.clients.portal.is_freelancer_previewing_portal, built standalone
in Step 11) is now wired to its first real call sites (Step 12): the
Sent->Viewed status transition and InvoiceViewEvent logging, both gated
by one shared check inside portal_invoice_view_html
(apps/invoices/views_portal.py) — neither ever fired from any real
request path before this. Preview-as-Client (freelancer-facing, inside
the authenticated app) is a structurally separate endpoint
(invoice_preview_as_client) that reuses the same HTML renderer but never
mints a session or logs a view, with its own "You're previewing as
[client]" banner rendered as pure React chrome around an iframe.

Portal shows (Step 12, built): invoice list (GET /api/invoices/portal/me/)
and the real rendered invoice document (GET /api/invoices/portal/view/<token>/,
the SAME Django template the PDF renders, with browser-fetchable
/static/ font URLs instead of WeasyPrint's file:// ones — see
DECISIONS.md's "one HTML/CSS renderer" entry). Payment history and the
two-way message thread are NOT built yet — Steps 13/14.

Client Messaging (inside portal) — BUILT, Step 13:
Full two-way chat thread between client (in portal, ClientPortal.jsx's
per-invoice Messages panel) and freelancer (InvoiceDetailPanel's
Comments tab) — real InvoiceComment rows via GET/POST
/api/invoices/{id}/comments/ (freelancer) and
/api/invoices/portal/{id}/comments/ (client, portal-session-
authenticated), plus a real inbound email-reply webhook
(POST /api/invoices/email/incoming/, apps/invoices/views_email.py,
authenticated via a CLOUDFLARE_WEBHOOK_SECRET shared-secret header) that
turns a reply to reply+<view_token>@lanceraos.com into the same thread,
tagged source='email_reply'. No account needed for client — messages
tied to the portal session. Real-time delivery via WebSocket
(ws/invoices/thread/<view_token>/, apps/invoices/consumers.py's
ClientThreadConsumer — dual auth, freelancer JWT cookie OR portal
session cookie, see DECISIONS.md), with a 15s polling fallback in the
frontend if the socket doesn't connect. No edit/delete endpoint exists
for InvoiceComment anywhere, by design (immutable, verified with a real
405 test on both endpoints). One image attachment per comment (Cloudinary,
same validation discipline as logo/signature uploads).
When client sends a message: immediate in-app notification to freelancer
(gated by their own notif_client_messages toggle). If EITHER side's
comment is still unread after exactly 1 hour: one batched reminder email
(apps/invoices/tasks.py's notify_unread_comments, every 15 min, ONE email
per invoice covering everything unread at that threshold, never one per
comment) — routed through send_email (freelancer recipient) or
send_client_facing_email (client recipient), see DECISIONS.md for why
those differ. No further reminders (InvoiceComment.unread_reminder_sent_at
is the real "already notified" marker). NOTE: unlike this paragraph's
original wording, only ONE in-app bell notification fires per client
comment (the immediate one) — there is deliberately no SECOND bell ping
at the 1-hour mark alongside the email; see DECISIONS.md's 14 August
entry for the full reasoning and how to close this gap if it matters
later.

Key API endpoints — apps/clients/ (built, real):
- GET/POST /api/clients/ (filter/search/sort per the Client CRM section above; ?currency= added
  17 August 2026, a real WHERE-clause filter on Client.default_currency)
- GET /api/clients/currencies/ (17 August 2026 — distinct default_currency values in use, real query,
  populates the list's own currency filter dropdown)
- GET/PUT /api/clients/{id}/
- POST /api/clients/{id}/archive/ + /restore/ + /flag/
- GET/POST /api/clients/{id}/notes/ + PUT/DELETE /api/clients/{id}/notes/{note_id}/
- GET /api/clients/{id}/analytics/ (payment_stats + reliability breakdown)
- GET/POST /api/clients/tags/
- POST /api/clients/{id}/tags/{tag_id}/attach/ + DELETE /api/clients/{id}/tags/{tag_id}/

Key API endpoints — apps/clients/ portal auth (built, real — Step 11; distinct from
INVOICES_CLIENTS_TECHNICAL_SPEC.md Section 7's eventual unified /api/portal/... surface, which needs
Invoice.view_token support this app deliberately doesn't have yet — see DECISIONS.md):
- GET /api/clients/portal/{token}/ (magic-link entry via Client.portal_token; mints/renews a
  ClientPortalSession; returns client identity only, not an invoice list)
- POST /api/clients/portal/request-link/ (self-serve resend, rate-limited 5/email/hr + 20/IP/hr)
- POST /api/clients/portal/logout/ + /logout-everywhere/ (both require a valid current portal session)

Key API endpoints — apps/invoices/ (built, real):
- GET/POST /api/invoices/
- GET/PUT/DELETE /api/invoices/{id}/ (PUT: draft only; DELETE: draft/created only — both 403 otherwise)
- GET /api/invoices/{id}/pdf/ (live-render for draft/created; redirect to stored pdf_url for sent+)
- POST /api/invoices/{id}/finalise/ + /mark-sent/ + /mark-paid/
- POST /api/invoices/{id}/payments/ + DELETE /api/invoices/{id}/payments/undo/
- POST /api/invoices/{id}/cancel/ + /refund/ + /bad-debt/ + /duplicate/
- POST /api/invoices/{id}/toggle-reminders/ + /pause-recurring/ + /resume-recurring/
- GET /api/invoices/{id}/timeline/
- GET /api/invoices/summary/ (?period=/?currency= added 17 August 2026 — KPI-strip-only period window
  + currency override, see this module's own 17 August entry above) + /exchange-rate/ (/aging-report/
  removed 16 August 2026 — see DECISIONS.md)
- GET /api/invoices/currencies/ (17 August 2026 — distinct invoice currencies in use, real query,
  populates the list's own currency filter dropdown; ?currency= also added to GET /api/invoices/
  itself, a real WHERE-clause filter)
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

Key API endpoints — apps/invoices/ portal content (built, real — Step 12; imports
apps.clients.portal's session utility, never the reverse — see DECISIONS.md):
- GET /api/invoices/portal/me/ (the resolved client's own invoice list — minimal, client-safe
  serializer, never the freelancer-facing InvoiceListSerializer; excludes draft/created as of 18
  August 2026's second pass — a client only ever sees an invoice once it's actually been delivered
  by some real means, see DECISIONS.md)
- GET /api/invoices/portal/<uuid:pk>/ (a single invoice's client-visible detail; real 404, not 403,
  for another client's invoice)
- GET /api/invoices/portal/view/<str:view_token>/ (REWORKED 18 August 2026, second pass — see
  DECISIONS.md's frozen-PDF-vs-live-render entry: serves the ACTUAL FROZEN PDF inline once one
  exists — same bytes the /pdf/ sibling below serves — never a live re-render of
  build_portal_context/render_invoice_portal_html from current invoice+profile data; a real 503
  with a specific message when nothing's frozen yet, never a fallback render. Still mints/renews a
  real ClientPortalSession for a saved client, creates none for a one-time client; still where the
  Sent->Viewed transition + InvoiceViewEvent logging fire, unconditionally regardless of which
  branch produced the response, gated by the freelancer-own-session guard built ahead of time in
  Step 11. Reached today via the frontend's own /invoice/:token route, InvoiceView.jsx, which
  fetches this as a blob and hands the browser a same-origin blob: URL — never linked to directly,
  never exposing this URL itself to a client)
- GET /api/invoices/portal/view/<str:view_token>/pdf/ (18 August 2026 — real, public, side-effect-free
  PDF download for InvoiceView.jsx's own Download button; same view_token-is-the-credential trust model
  as the HTML view beside it, AllowAny, real 404 for an unknown token; proxies real bytes via
  fetch_invoice_pdf_bytes rather than redirecting, so it works even under this account's real
  Cloudinary raw/PDF-delivery ACL restriction)
- GET /api/invoices/{id}/preview-as-client/ (freelancer-facing, IsAuthenticated — renders the same
  HTML inside the authenticated app; never mints a session, never logs a view — the one remaining
  real consumer of render_invoice_portal_html, since portal_invoice_view_html no longer calls it)

Key API endpoints — apps/invoices/ Comments (built, real — Step 13):
- GET/POST /api/invoices/{id}/comments/ (freelancer side — IsAuthenticated; GET marks unread
  client-authored comments read_by_freelancer_at)
- GET/POST /api/invoices/portal/{id}/comments/ (client side — portal-session-authenticated, rate
  limited 15/hour per client session; GET marks unread freelancer-authored comments read_by_client_at)
- POST /api/invoices/email/incoming/ (the inbound email-reply webhook — CLOUDFLARE_WEBHOOK_SECRET
  shared-secret header required; parses reply+<view_token>@lanceraos.com, rejects untrusted/malformed
  input with real 400/403/404s, see DECISIONS.md)
- WS ws/invoices/thread/<view_token>/ (apps/invoices/consumers.py's ClientThreadConsumer — dual
  auth: freelancer JWT cookie via the existing global CookieJWTAuthMiddleware, OR a portal-session
  cookie checked inside the consumer itself; view_token, not pk — see DECISIONS.md)
- No edit/delete endpoint exists anywhere for InvoiceComment, by design (immutable)

Key API endpoints — apps/invoices/ Payment Claims (built, real — Step 14; also closed a real Step 13
gap in this same pass — the freelancer-preview guard was never wired into portal_invoice_comments,
see DECISIONS.md):
- POST /api/invoices/portal/{id}/claims/ (portal submission — portal-session-authenticated for a
  saved client, OR reachable for a one-time client via that exact invoice's own view_token supplied
  in the request body, matching Step 12's own precedent since a one-time client has no
  ClientPortalSession possible at all; rate limited 5/hour, tighter than comments; rejects the
  freelancer-preview-mode case with a real 403; amount_claimed capped at the invoice's real current
  outstanding_amount at submission time, 16 August 2026 second verification-pass fix — see DECISIONS.md.
  18 August 2026, second pass: rejects outright with a specific message when a real pending claim
  already exists for this invoice, or when outstanding_amount is already 0 — and every OTHER
  validation error on this endpoint now surfaces its real, specific message under a flat top-level
  `error` key instead of DRF's default field-keyed shape, which ClientPortal.jsx's ClaimModal was
  never actually able to read — a real, confirmed bug that silently swallowed every specific error
  message this endpoint ever built, not just the two new checks; see DECISIONS.md)
- GET /api/invoices/portal/{id}/claims/ (16 August 2026 second verification pass — real, confirmed
  gap: a client previously had no way to see whether their own submitted claim was confirmed/
  rejected. Same access model as the POST above, including the one-time-client path — via
  ?view_token= in the query string there, since a GET has no body. Reuses PaymentClaimSerializer
  directly, the same freelancer-facing read representation, since none of its fields are sensitive
  to the client who submitted them)
- GET /api/invoices/{id}/claims/ (freelancer list)
- POST /api/invoices/{id}/claims/{claim_id}/confirm/ + /reject/ (freelancer review — confirm creates
  a real InvoicePartialPayment via the exact same InvoicePartialPaymentSerializer +
  update_paid_status() path invoice_add_payment/invoice_mark_paid already use, so a stale claim that
  no longer fits the invoice's current outstanding balance is rejected with a real error rather than
  silently over-crediting; reject has zero financial effect and requires a real review_note reason;
  both require confirm:true)
- Both payment_claim_submitted (bell + immediate email to the freelancer, gated by notif_payments)
  and payment_claim_confirmed (immediate email to the client only, no bell — the freelancer
  triggered it themselves) are real, wired notification tiers.

Key API endpoints — apps/invoices/ Client Acknowledgment (built, real — Step 15):
- POST /api/invoices/portal/{id}/acknowledge/ (same saved-client-session-or-one-time-client-view_token
  access model as claims, via a shared _resolve_portal_write_access helper; idempotent — a repeat
  call returns the existing client_acknowledged_at with a 200, never an error; no unacknowledge path
  exists anywhere; rate limited 5/hour; rejects the freelancer-preview-mode case with a real 403)

Key API endpoints — apps/invoices/ Recurring Invoices (built, real — Step 16):
- Celery task apps.invoices.tasks.generate_recurring_invoices, daily at 8:30 AM PKT — series settings
  (interval/auto_send/design) read live from Invoice.get_recurring_root() at generation time, never
  copied onto a generated child; calendar-month-accurate advancement for 2-month/quarterly/annual
  intervals; per-invoice failure isolation with 3-strikes auto-pause (recurring_failure_count)
- PUT /api/invoices/{id}/ — a recurring ROOT invoice past its own draft status may still change
  exactly recurring_interval_days/recurring_auto_send here ("edit the whole series going forward"),
  via a narrow RecurringSeriesSettingsSerializer allowance; every other field/invoice still hits the
  ordinary is_editable 403

Key API endpoints — apps/invoices/ Escalation + Formal Notice (built, real — Step 17):
- escalation_required was already being set correctly by Step 10's reminder task at the real day-30
  threshold — only the notification handler (invoice_escalation_required, bell + immediate email)
  was missing; built this pass
- POST /api/invoices/{id}/dismiss-escalation/ (clears the PROMPT only — escalation_required itself,
  the historical fact, is never reset; idempotent)
- POST /api/invoices/{id}/send-formal-notice/ (manual-only, confirm:true, gated on
  escalation_required OR status='bad_debt'; a real, distinct, firmer-toned email reusing the same
  send-email routing chain every other invoice email uses; tracked via formal_notice_sent_at, never
  blocks a deliberate re-send; a real, server-enforced FreelancerProfile.formal_notice_enabled kill
  switch, not just hidden client-side — Settings > Business's "Invoicing Defaults" card)

Key API endpoints — apps/invoices/ Analytics (built, real — Step 18):
- GET /api/invoices/analytics/?months=<int> (default 6, clamped [1,24] — month-over-month
  invoiced/collected trend via real grouping queries, top 5 clients by USD-converted amount_paid
  reusing Client.payment_stats only for the reliability-score half, and a currency breakdown with one
  real anchor-currency-unified USD total via core.money.Money, that value object's first real
  consumer anywhere in this codebase)
- Celery task apps.invoices.tasks.notify_stale_drafts, weekly (Monday 9:30 AM PKT) — one batched
  in-app + email notification per user with any draft invoice older than 7 days, per-currency
  breakdown never summed across currencies

Key API endpoints — apps/clients/ Statement PDF (built, real — Step 19; the view lives in
apps.invoices, registered at this clients-prefixed URL directly in config/urls.py — see DECISIONS.md
for why):
- GET /api/clients/{id}/statement/pdf/?start=&end= (freelancer-facing only, confirmed directly — no
  client-portal-facing equivalent is named anywhere in the spec; both params optional, defaulting to
  a real trailing year, never "all time"; live-rendered on every call, no frozen-artifact concept;
  reuses the same WeasyPrint pipeline/font-sourcing convention and the same anchor-currency mechanism
  Invoice.client_currency_conversion is built on, generalized to total/paid/outstanding)

Key API endpoints — apps/invoices/ (deliberately NOT built — excluded, not stubbed):
- Per-invoice design override at invoice-creation time — `InvoiceFormFields.jsx` has no design-picker
  field at all yet (confirmed directly), so there's genuinely nowhere for it to plug into today —
  flagged in DECISIONS.md's Step 8b entry rather than added as unplanned scope.

**Design system (`InvoiceDesign.design_data`) — backend contract, editor, real render path, real
design-to-invoice assignment, real color_variant wiring, AND real gallery previews all built (Steps
8/8b, render path + assignment fix 19 August 2026, color/preview fix 20 August 2026)**: a saved design
now genuinely affects real invoice PDF/portal output end to end, with the actually-selected color, and
the gallery correctly shows what a client will actually see before a user ever picks anything — a
saved design's `design_data` is actually rendered (`apps/invoices/design_renderer.py`, closed audit
finding PDF-001), a real invoice actually gets that design assigned in the first place
(`invoice_create`/`_finalise_invoice` reading the user's real default design), `color_variant` actually
affects real output (`design_seeds.resolve_design_colors`, wired into both render paths), and the
gallery's own preview cards are a real backend render of that exact same output
(`apps/invoices/design_preview.py`), not a client-side approximation — closing 3 separate real,
live-browser-verified SEV1 reports across 2 days; see this module's own three 19-20 August 2026
entries above and DECISIONS.md for the full design of each. Each fix exposed the next: the render path
alone had zero real-world effect until invoices actually got designs assigned; a design being assigned
still showed no color until `color_variant` itself was wired in; none of it was visible in the gallery
until the preview cards stopped rendering a generic approximation. The backend contract itself is a
documented two-zone JSON schema
(`apps/invoices/design_schema.py`) — `zone_1` (logo/business_info/
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
| Invoices + Clients   | apps/clients/ + apps/invoices/ (models + CRUD/lifecycle endpoints incl. real GET .../pdf/, `finalised_at` + PDF-freeze-at-finalise, design_data schema/CRUD + AI-seed/signature tool, Step 9; payment-amount-exceeds-due validation + client duplicate-email validation, Step 9c; real `/send/` + custom-SMTP-vs-Resend routing + reminder Celery task, Step 10; combined `/finalise-and-send/` action + PDF fetch self-heal chain (re-upload+retry, then live-render fallback) + `Invoice.pdf_public_id` + a one-time backfill command, Step 10b; routing chain promoted to `core.email.send_client_facing_email` + Client Portal Authentication — magic-link entry/request-link/logout/logout-everywhere + `ClientPortalSession`, Step 11; Client Portal invoice content — list/detail/rendered-HTML-view endpoints, Sent->Viewed + InvoiceViewEvent wired to the freelancer-own-session guard for the first time, Preview-as-Client, "View Invoice Online" email link, Step 12; Comments — dual-write (freelancer/portal) + inbound email-reply webhook + real-time WebSocket delivery (dual freelancer/portal auth) + unread-after-1hr batched email, Step 13; Payment Claims — portal submission (saved-client session OR
one-time-client view_token), freelancer list/confirm/reject reusing the exact InvoicePartialPaymentSerializer
+ update_paid_status() path, both notification tiers, plus the Step 13 freelancer-preview-guard gap
closed in portal_invoice_comments, Step 14 — see DECISIONS.md for the confirmed, still-unresolved
Cloudinary account-level ACL restriction Step 10b works around; Client Acknowledgment (idempotent
portal action, Step 15), Recurring Invoice generation (Celery task + root-settings-read model +
calendar-accurate scheduling + 3-strikes failure handling, Step 16), and Escalation notification +
Formal Notice (a real, distinct, manual-only email with its own enforced disable setting, Step 17))
built | Invoices list/detail/lifecycle/timeline (AR aging report removed 16 August 2026 — see DECISIONS.md) + delayed-creation 3-stage wizard with draft-edit mode + search-driven client step (`NewInvoiceWizard.jsx`, Step 9b/9c) + design gallery/canvas editor + AI-seed upload + real Send action (Step 10) + combined Finalise & Send action with honest partial-failure handoff (Step 10b) + Preview-as-Client modal + a real Comments tab in InvoiceDetailPanel.jsx + a real Claims tab in InvoiceDetailPanel.jsx (confirm/reject, Step 14) + the standalone Client Portal frontend (`ClientPortal.jsx` list + per-invoice Messages panel + a "Report a Payment" claim form + acknowledge action, `PortalEnter.jsx` magic-link handoff, `PortalRequestLinkForm.jsx`; the invoice VIEW itself is a real React route as of 18 August 2026 — `InvoiceView.jsx` at `/invoice/:token`, superseding the earlier plain-`<a href>`-to-the-backend approach, see DECISIONS.md) + `CommentThread.jsx`/`useWebSocket.js` (shared between both sides) + an escalation banner/dismiss/Formal-Notice action + an "Edit Series" modal for a recurring root + a Formal Notice enable toggle in Settings > Business + a new `/invoices/analytics` page (Recharts, installed for real this pass) + a "Generate Statement" action + date-range modal in ClientDetailPanel.jsx, Step 12/13/14/15/16/17/18/19 built (Client CRM frontend, signature upload UI not yet); Invoices.jsx status/Overdue filtering is a real, independently-paginated server query again as of the 16 August second verification-pass reversal (only "All" stayed the 11 Aug client-side window until the 17 August List/Table restructure removed the tiered/client-side pagination system entirely — see DECISIONS.md), both list pages collapse their filter pills into a mobile dropdown ≤768px; send banner simplified to a draft/created/reminders-only rule (Step 10b, supersedes the short-lived 3-state version). 17 August 2026: both list pages rebuilt on top of the above — uniform real pagination (`Pagination.jsx`), a real filter-row overflow (`useFilterOverflow.js`), a real WHERE-clause currency filter on both lists, a real KPI period+currency strip (`InvoiceKPIStrip.jsx`) with a Collected-only month-over-month delta, and header actions relocated into AppShell's own header via a new `usePageHeaderActions.js` mechanism (see DECISIONS.md's 17 August entry). Same day, InvoiceDetailPanel redesign: Preview-as-Client removed (View Invoice opens the real portal page directly, freelancer-own-session guard untouched and re-verified), header/tabs/reminders-banner-vs-toggle/action-footer all rebuilt, a new Send Reminder N + Resend Invoice + Change Due Date, a unified Add Payment two-path popup, a real 3-region flex layout so the Comments tab gets its own fixed/scrollable structure, and the invoice list's whole row now opens the panel (`InvoiceTable.jsx`'s Action column removed, bulk delete unified into the existing floating action bar) — see DECISIONS.md's 17 August 2026 (InvoiceDetailPanel redesign) entry. 18 August 2026: the KPI strip's mobile swipe carousel removed for a uniform always-3-columns grid with a compact delta variant below phone width (`InvoiceKPIStrip.jsx`, see DECISIONS.md); `Invoice.portal_view_url` now builds a real frontend URL (`/invoice/:token`, `InvoiceView.jsx`) instead of the backend host, and `GET /api/invoices/<pk>/pdf/` proxies real bytes instead of redirecting to Cloudinary, both verified live against the real dev Cloudinary account's actual ACL restriction — see DECISIONS.md's 18 August 2026 entry. Second pass, same day: closed the gap the first pass's own `<iframe srcDoc>` HTML approach left open — `portal_invoice_view_html` no longer live-renders from current invoice+profile data AT ALL, it serves the ACTUAL FROZEN PDF inline (a real 503 when nothing's frozen yet, never a fallback render); `InvoiceView.jsx` rewritten to fetch as a blob and show it via the browser's native PDF viewer through a same-origin `blob:` URL (Download does the same, `CORS_EXPOSE_HEADERS` added for the real filename) — this is what actually finishes hiding the backend host everywhere client-facing, not just Download's own link. Plus two more real bugs: `portal_invoice_list` now excludes draft/created invoices (a client could previously see every invoice from a freelancer they had portal access to, not just ones actually delivered to them), and `portal_invoice_claims` gained a duplicate-pending-claim rejection plus a fix to the real reason validation error messages (the already-fully-paid case included) were never reaching the client at all — see DECISIONS.md's second 18 August 2026 entry, including an honest, live-tested note on the self-heal chain's own separate, pre-existing, out-of-scope residual drift risk | Backend: 730 passing across `apps.invoices` (`python manage.py test`, `--keepdb` — every test module passes individually/in batches; a full single-process run intermittently hits an unrelated, already-documented native WeasyPrint/GC segfault on this dev machine, not a real failure, see DECISIONS.md), incl. the 19 August 2026 design_data render path pass's new `test_design_renderer.py` (29 tests — closes audit finding PDF-001, see this module's own 19 August 2026 "design_data render path" entry above and DECISIONS.md), the same-day SEV1 follow-up's new `test_design_assignment.py` (10 tests — real invoice_create/_finalise_invoice/_duplicate_invoice_core design-assignment coverage plus a recurring-generation regression guard, see this module's own "SEV1" entry above), and the 20 August 2026 SEV1 follow-up's new `test_design_color_and_preview.py` (20 tests — all 9 real color combinations, the draft-live-default-fallback, both preview endpoints, see this module's own 20 August 2026 "SEV1" entry above), the first real WebSocket tests in this codebase via `channels.testing.WebsocketCommunicator`, this pass's own KPI-period/currency-filter coverage, the InvoiceDetailPanel redesign's Send Reminder/Resend/Change Due Date/freelancer-preview-guard-regression coverage, the first 18 August pass's real end-to-end Cloudinary-401 proof for both PDF download endpoints, the second 18 August pass's frozen-PDF-vs-live-render/portal-list-scoping/payment-claim-message coverage (incl. a direct before/after profile-edit drift test), the sixth 18 August pass's `PdfReuploadCircuitBreakerTests` (`test_send.py`, incl. a real measured before/after timing test showing a genuine 65-66% speed-up from the new per-invoice breaker), the 19 August 2026 production-audit fix round's new `apps/invoices/tests/test_concurrency.py` (real, genuinely-concurrent-thread regression tests for the audit's INV-003/DB-002/INV-004/INV-001/INV-009 findings), and that same audit's second fix round's new `apps/invoices/tests/test_audit_trail.py` (real AuditLog-row-per-lifecycle-event coverage, INV-002) plus `test_portal.py`'s new `CrossAccountFreelancerPreviewGuardTests`/`PortalWriteEndpointsCSRFEnforcementTests` classes (real two-distinct-account ownership-guard coverage and real CSRF-rejection-vs-legitimate-traffic coverage, PORTAL-001/PORTAL-002) — see below. Frontend: 224 passing (`npm test`, `frontend/`, incl. `Invoices.test.jsx`, `Clients.test.jsx`, `Pagination.test.jsx`, `InvoiceKPIStrip.test.jsx` (rewritten for the no-carousel/compact-delta redesign), `useFilterOverflow.test.jsx`, `NewInvoiceWizard.test.jsx`, `invoiceHelpers.test.js`, `pages/portal/*.test.jsx`, `CommentThread.test.jsx`, `InvoiceAnalytics.test.jsx`, `ErrorBoundary.test.jsx`, `InvoiceTable.test.jsx` rewritten for row-click-vs-checkbox-click, `InvoiceDetailPanel.test.jsx` substantially expanded past its prior narrow tooltip-only suite (now also covering the Duplicate/More-menu footer scoping, fifth 18 August pass, and the 19 August audit fix round's Undo Payment More-menu gate regression tests), `InvoiceView.test.jsx` rewritten for the blob-based rework, `useWebSocket.test.jsx` — this hook's first dedicated test file, fifth 18 August pass) + a production `vite build` check + real Playwright screenshots (375/768/1280/1920 light/dark for the InvoiceDetailPanel redesign; 320/375/480/600/768 for the KPI strip fix; two live runs against the real dev Cloudinary account, one per 18 August pass, for the frontend-domain/Download fix and the frozen-PDF/portal-list/claims fixes) against the running dev servers — the fifth 18 August pass's own mobile 375px sizing was test-covered but NOT screenshot-verified at the time (no live browser/Playwright tool available that session); the sixth 18 August pass corrected this with real Playwright + Chromium screenshots at 375/768/1280/1920, light and dark, against the real running dev servers with a seeded demo account (see DECISIONS.md) | Two 16 August 2026 verification passes, the 17 August 2026 List/Table restructure, the same-day InvoiceDetailPanel redesign, both 18 August 2026 passes (KPI-strip/frontend-domain/Download-proxy, then frozen-PDF/portal-list/payment-claims), a fifth 18 August 2026 pass (WebSocket console-error fix + a third InvoiceDetailPanel bug-hardening round), a sixth 18 August 2026 pass (PDF re-upload circuit breaker + a fourth InvoiceDetailPanel/AppShell bug-hardening round, screenshot-verified), and a 19 August 2026 full production-readiness audit (`LANCERAOS_CLIENTS_INVOICES_PRODUCTION_AUDIT.md`, verdict NOT READY — 3 live-reproduced CRITICAL financial-corruption bugs plus 9 further HIGH findings) with two same-day fix rounds closing 7 of its findings total — round 1: INV-003/DB-002 concurrent-overpayment locking, INV-009/FE-001 Undo-Payment-on-terminal-status guard, INV-004 invoice-numbering race, INV-001 stale-total-on-empty-items (see DECISIONS.md's four 19 August 2026 "audit fix" entries); round 2: INV-002 (8 new AuditLog handlers closing the lifecycle-audit-trail gap), PORTAL-001 (the freelancer-preview guard now checks real ownership, not just "a freelancer session exists somewhere"), PORTAL-002 (CSRF enforcement added to the 3 portal write endpoints that lacked it — see DECISIONS.md's three 19 August 2026 "audit fix, second round" entries) — complete (see DECISIONS.md) — the audit's remaining MEDIUM/LOW findings (CLIENT-001 through CLIENT-009, PORTAL-004 through PORTAL-009, PDF-002 through PDF-004 — PDF-001 closed 19 August 2026, see this module's own "design_data render path" entry above, DB-004, INV-005 through INV-008, FE-003/FE-004, and DB-003's dormant CASCADE-vs-PROTECT landmine — see the audit document's own §25/§26 for the full remaining list), the still-open PERF-001 verification (whether the dev-machine WeasyPrint/Celery segfault reproduces in the real production container), Admin panel screens, and the full-module verification pass (Section 8, steps 20-21) remain |
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
# Also used to build Invoice.portal_view_url (the invoice VIEW itself,
# InvoiceView.jsx's real /invoice/:token route) as of 18 August 2026 —
# see DECISIONS.md's real-frontend-domain-invoice-view-page entry.
# REMOVED same day: BACKEND_URL (config/settings.py) — its one real
# consumer was that same link, back when it pointed at the raw backend/
# API host instead. Left removed rather than defined-but-unused, per
# this project's own dead-config convention.

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
celery -A config worker -l info --pool=solo      # actually executes scheduled/background tasks
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

**macOS-specific gotcha, will bite you every time otherwise — use `--pool=solo`:** the default
prefork pool crashes the worker the moment it forks a child process to actually run a task
(`WorkerLostError: signal 11 (SIGSEGV)`). Real, confirmed cause (closing PERF-001 from the
19 August 2026 production audit — see DECISIONS.md for the full investigation): something in
WeasyPrint's native library chain (Cairo/Pango/GObject, loaded via `ctypes`, pulled in by any
task touching invoice PDF generation) is not fork-safe on macOS specifically — forking a process
that has already loaded these libraries corrupts their internal state, and the child segfaults
the instant it tries to use them. `--pool=solo` runs the worker as a single process with no
forking at all, trading task concurrency for stability — for local dev, where you're rarely
running more than one background task at a time anyway, that trade is free.

**Two things this is NOT, confirmed directly rather than assumed:**
- **Not an Objective-C-runtime-specific issue.** The previously-documented
  `OBJC_DISABLE_INITIALIZE_FORK_SAFETY=YES` workaround was real-world tested (with the default
  prefork pool, both with and without this env var) and did **not** stop the segfault either way —
  ruling out that specific ObjC-runtime mechanism as the actual cause, not just an ineffective
  band-aid over the real one. Dropped from this doc; `--pool=solo` is the one real fix.
- **Not (as far as this session could determine) an import-timing issue.** WeasyPrint used to be
  imported at Django module-load time in `apps/invoices/pdf_generator.py` — transitively pulled in
  by `apps.invoices.tasks` at Celery worker startup, before any fork. That import is now deferred
  into the two functions that actually call it (see DECISIONS.md) as a real, independently-good
  practice regardless — but this was done ON TOP OF `--pool=solo` being the confirmed fix, not
  verified as a fix on its own against the default prefork pool. Don't assume it would let you drop
  `--pool=solo` and go back to prefork without testing that combination for real first.

**Believed macOS-only — genuinely unconfirmed on Linux, flagged rather than assumed:** this
project's actual deployment target (Railway, per this doc's own Infrastructure section) runs
Linux containers, where this specific fork-safety failure mode is NOT expected to reproduce —
standard prefork concurrency (no `--pool=solo` restriction) is expected to work there. This has
**not actually been verified against a real Linux staging/production container** as of this
writing — treat `--pool=solo` as a local-macOS-dev-only requirement until someone confirms
prefork's real behavior on the actual deployment target directly, not by assumption.

**To manually trigger a scheduled task right now**, without waiting for Beat's schedule (useful
for testing deletion/cleanup behavior): `python manage.py shell`, then
`from apps.users.tasks import anonymize_expired_accounts; anonymize_expired_accounts.delay()`
— this publishes a real task through the real Redis queue to a running worker, not a shortcut
that bypasses the actual pipeline.
  XSS vulnerability becomes an instant account-takeover vector.
  Alternatives considered: v1's Authorization-header + localStorage
  approach (rejected, exactly the anti-pattern being replaced).