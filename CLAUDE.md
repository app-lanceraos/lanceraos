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
│   ├── ai.py              ← Shared Groq API utility (call_groq) [not yet built]
│   ├── email.py            ← Resend HTTP API sender (send_email)
│   ├── encryption.py        ← Fernet + HMAC blind-index helpers
│   ├── middleware.py        ← Request ID injection + API request logging
│   ├── models.py            ← AuditLog, ApiRequestLog
│   ├── observability.py     ← Logging/request-metadata helpers used by all modules
│   └── permissions.py       ← Shared DRF permission classes [not yet built]
├── apps/
│   ├── users/                      <- Auth, profile, settings — BUILT
│   ├── invoices/                   <- Invoice lifecycle + client CRM + portal
│   ├── payments/                   <- Income, expenses, P&L, CSV import
│   ├── tax/                        <- FBR tax, SRO 586, income certificate
│   ├── health/                     <- Financial health score
│   ├── proposals/                  <- Proposals + AI writer
│   ├── contracts/                  <- Contracts + digital signing
│   └── subscriptions/              <- Free/Pro plans and enforcement
├── frontend/                       <- React application
│   ├── src/
│   │   ├── App.jsx                 <- Routing root (BrowserRouter + all routes)
│   │   ├── components/
│   │   │   ├── AppShell.jsx        <- Layout: header, nav, frame (placeholder — see rule 5)
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
├── CLAUDE.md                       <- Master context file (this document)
├── .env                            <- Environment variables (never committed)
├── .env.example                    <- Template with all required keys
├── requirements.txt
└── manage.py

---

## 5. Modules — What Exists and What Each Does

### Module 1 — Users (Authentication + Profile + Settings)
Status: Backend complete. Frontend complete (12 pages, 127 tests passing).
App: apps/users/

Handles all authentication and user account management.

Registration: 3-step wizard (name + birthdate -> email + username ->
password), submitted as a single API call after the wizard completes.
Age must be >= 16. Email verification required before login.

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

2FA: OTP via email. Optional but available. A trusted-device cookie
(httpOnly, 30 days) can skip 2FA on a recognized device.

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
    danger-zone deletion), Sessions, Notifications, Email Sending (SMTP).

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
password+OTP steps, then hands off to the standalone (shell-less)
DeletionReview page with the resulting one-time token.

Key API endpoints:
- POST /api/auth/register/
- POST /api/auth/check-availability/ (live email/username availability
  during the registration wizard)
- GET /api/auth/verify-email/<uid>/<token>/
- POST /api/auth/resend-verification/
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
- POST /api/auth/2fa/verify/ + /api/auth/2fa/resend/ + /api/auth/2fa/toggle/
- POST /api/auth/change-password/
- POST /api/auth/forgot-password/ + /api/auth/reset-password/<uid>/<token>/
- POST /api/auth/email-change/request/ + /validate/<ecr_uid>/<token>/ (GET)
  + /complete/<ecr_uid>/<token>/ + /activate/<ecr_uid>/<token>/ + /cancel/
- POST /api/auth/deletion/initiate/ + /verify-otp/ + /confirm/ + /cancel/
- GET /api/auth/smtp/status/ + POST /api/auth/smtp/save/ + /disable/

---

### Module 2 — Invoices + Client CRM + Client Portal
Status: [updated as built]
App: apps/invoices/

The most important module. Two closely related features in one app.

Invoice Generator:
Professional invoice creation in USD, EUR, GBP, or PKR. Line items with
quantity and unit price. Tax rate and discount at invoice level. PKR
equivalent shown at current exchange rate. Three PDF templates
(Professional, Modern, Minimal) generated by WeasyPrint from HTML/CSS
templates. Direct email to client via Resend with PDF attached.

Invoice status lifecycle: draft -> created -> sent -> viewed ->
partially_paid -> paid -> overdue -> cancelled -> bad_debt.
The update_paid_status() method enforces all transitions.
Cancelled and bad_debt invoices are never modified by payment operations.

Partial payments: multiple partial payments per invoice, each tracked
with amount, currency, source, and date. Status updates automatically
as payments are recorded.

Recurring invoices: Celery Beat generates child invoices from parent
templates on schedule. Intervals: weekly, fortnightly, monthly.

Payment reminders: automated escalating reminders via Celery.
Configurable per invoice. Maximum 3 reminders.

Public invoice page: unique token-based URL (never guessable).
Client views invoice, submits payment confirmation, sees payment history.

Client CRM:
Client records with name, email, company, address, default currency.
Auto-populate invoice fields when client is selected.
Payment history per client. Reliability score based on payment speed,
consistency, and total value - weighted, transparent, shown with breakdown.
Flag problematic clients with reason. Archive inactive clients.
Client statement PDF (WeasyPrint) covering all transactions in a period.

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

Key API endpoints:
- CRUD /api/invoices/
- POST /api/invoices/{id}/send/
- POST /api/invoices/{id}/mark-paid/
- GET /api/invoices/{id}/pdf/
- POST /api/invoices/{id}/payments/ (partial payment)
- GET /api/invoices/public/{token}/ (unauthenticated)
- POST /api/invoices/public/{token}/claim/ (payment claim)
- CRUD /api/clients/
- GET /api/clients/{id}/statement/pdf/
- GET/POST /api/clients/{id}/messages/
- POST /api/portal/{token}/pin/verify/
- POST /api/portal/{token}/pin/resend/
- GET /api/portal/{token}/messages/
- POST /api/portal/{token}/messages/

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
that exists (core.AuditLog, core.ApiRequestLog, and all six
apps.users tables as of this writing).

---

## 7. Module Build Status

| Module               | Backend | Frontend | Tests | Status      |
|----------------------|---------|----------|-------|-------------|
| Users / Auth         | Built   | Built    | 127 passing (frontend) | Complete |
| Invoices + Clients   | -       | -        | -     | Not started |
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
  XSS vulnerability becomes an instant account-takeover vector.
  Alternatives considered: v1's Authorization-header + localStorage
  approach (rejected, exactly the anti-pattern being replaced).