# LanceraOS — Production Baseline Audit (PART 0)

**Date:** 21 August 2026
**Scope:** Full-repository baseline — architecture, module inventory, API inventory, database inventory, auth/authz map, external services, background jobs, observability, testing, deployment, previous-audit reconciliation, documentation contradictions, risk map, 100-point model mapping, final verdict.
**Method:** Direct inspection of the codebase (models, urls, views, tasks, middleware, settings, tests, migrations) cross-referenced against all project documentation (`CLAUDE.md`, `DECISIONS.md`, `DATABASE.md`, `STANDARDS.md`, `EMAILS.md`, `ADMIN.md`, `ADMIN_PANEL_DESIGN.md`, `DESIGN.md`, `INVOICES_CLIENTS_TECHNICAL_SPEC.md`, `INVOICES_MODULE_KICKOFF.md`, `SECURITY_AUDIT.md`, `SECURITY_AUDIT_PASS2.md`, `LANCERAOS_CLIENTS_INVOICES_PRODUCTION_AUDIT.md`, `USER_ADMIN_FEEDBACK_PLAN.md`).
**This is an inventory pass, not a deep security/reliability audit.** No code was changed. Severities below are assigned only where the evidence gathered in this pass directly supports them; many items are explicitly flagged as "requires dedicated audit" rather than scored.

---

## 1. Executive Summary

LanceraOS is a Django 5.2 / React 19 SaaS with one fully complete module (Users/Auth, including a separately-architected admin panel) and one large module in active, iterative development (Invoices + Client CRM + Client Portal). Seven of nine remaining planned modules (Payments proper, FBR Tax, Health Score, Proposals, Contracts, Subscriptions, Dashboard, Help/AI) have **no code at all** — not partially built, simply absent (confirmed: `apps/` contains only `admin_panel`, `clients`, `invoices`, `payments`, `users`; `apps/payments` itself contains only a currency-conversion foundation, not the module described in CLAUDE.md).

The Invoices/Clients module has been through a real, live-executed production audit (`LANCERAOS_CLIENTS_INVOICES_PRODUCTION_AUDIT.md`, 19 Aug 2026, verdict **NOT READY**) that found 3 live-reproduced CRITICAL financial-data-corruption bugs and 9 further HIGH findings. Two same-day fix rounds closed 7 of those 12 findings, verified with genuine concurrent-thread tests. Three HIGH findings from that audit remain **unconfirmed as fixed** by this pass's cross-reference against `DECISIONS.md` (PORTAL-003, FE-002, DB-003), and the full MEDIUM/LOW backlog (30+ items) is untouched by design — that audit itself scoped those as non-blocking hardening work, not urgent.

Independently of that audit, a chain of **four same-family SEV1 bugs** in the design-editor feature was found and fixed across 19–21 August 2026, each fix revealing the next: a renderer that read design data but was never assigned to real invoices; assignment that worked but produced no visible color; color that worked but wasn't visible in the gallery preview; and finally — found by the actual user with his own mouse on 21 August, the day before this audit — a GrapesJS drag-and-drop argument-order bug that meant **nothing could ever be dragged onto the canvas at all**. That last fix is explicitly **not yet confirmed working** by the user as of this writing; the DECISIONS.md entry itself states verification is still pending.

This pass's own code inspection (independent of any prior audit) surfaced a further ~15 new findings never previously documented, spanning a genuine class-based-view rule violation, a completely untested highest-privilege admin panel, plaintext-stored Wise OAuth tokens sitting next to correctly-encrypted CNIC/NTN fields on the same model, a Sentry integration that exists only as an unused environment variable, and a total absence of CI/CD, Dockerfile, staging environment, backup policy, and health-check endpoint.

**Verdict: NOT READY for any production traffic handling real money or real client relationships.** See Section 15 for full reasoning. The product is genuinely further along than a prototype — one module is complete and well-tested, and the in-progress module has undergone real adversarial-style auditing with real fixes — but core production-operations infrastructure (deployment, CI, observability, backup) does not exist yet in any form, and the most recently-touched user-facing feature (the design editor) has a bug chain whose final link is still open.

---

## 2. System Architecture

### 2.1 Textual architecture diagram

```
                                   ┌─────────────────────────┐
                                   │        Cloudflare        │  DNS + (implied) CDN/edge
                                   └────────────┬─────────────┘
                                                │
              ┌─────────────────────────────────┼─────────────────────────────────┐
              │                                 │                                 │
   lanceraos.com (root)                admin.lanceraos.com              api.lanceraos.com
   ┌──────────────────┐              ┌──────────────────────┐         ┌──────────────────────┐
   │ frontend/ (React  │              │ admin-frontend/ (React│         │  Django 5.2 + DRF     │
   │ 19, Vite, Vercel) │──── HTTPS ──▶│ 19, separate Vite app, │──HTTPS─▶│  (Railway, gunicorn/  │
   │ Zustand, Recharts,│              │  Vercel)               │         │  Daphne ASGI)         │
   │ Axios+cookies     │              └──────────────────────┘         │                       │
   └──────────────────┘                                                │  ┌─────────────────┐  │
              │                                                        │  │ apps.users       │  │
              │  client portal (magic link, no login)                 │  │ apps.admin_panel │  │
              ▼                                                        │  │ apps.clients     │  │
   /invoice/:token, ClientPortal.jsx ───────── HTTPS ───────────────────▶  │ apps.invoices    │  │
                                                                        │  │ apps.payments    │  │
                                                                        │  │  (core/*)        │  │
                                                                        │  └─────────────────┘  │
                                                                        └───────────┬───────────┘
                                                                                    │
                        ┌───────────────────────────────────┬───────────────────────┼───────────────────────┬───────────────────┐
                        ▼                                   ▼                       ▼                       ▼                   ▼
              ┌──────────────────┐                ┌──────────────────┐   ┌──────────────────┐    ┌──────────────────┐  ┌────────────────┐
              │ PostgreSQL 17    │                │ Redis 8           │   │ Celery 5 worker  │    │ Celery Beat      │  │ Django Channels │
              │ (Railway managed)│                │ (broker + channel │   │ (--pool=solo on  │    │ (cron schedule,  │  │ 4 / Daphne (WS) │
              │                  │                │  layer)           │   │  macOS dev; std  │    │  Asia/Karachi)   │  │                 │
              └──────────────────┘                └──────────────────┘   │  prefork expected │    └──────────────────┘  └────────────────┘
                                                                          │  in prod, NOT      │
                                                                          │  verified)         │
                                                                          └──────────────────┘
                                                                                    │
                        ┌───────────────────────────────────┬───────────────────────┼───────────────────────┬───────────────────┐
                        ▼                                   ▼                       ▼                       ▼                   ▼
              ┌──────────────────┐                ┌──────────────────┐   ┌──────────────────┐    ┌──────────────────┐  ┌────────────────┐
              │ Resend (HTTP API)│                │ Cloudinary        │   │ Groq API          │    │ open.er-api.com  │  │ Google/Facebook │
              │ platform email + │                │ (logos, invoice   │   │ (AI: fast/quality/│    │ (exchange rates, │  │ OAuth (hand-    │
              │ fallback for     │                │  PDFs)            │   │  vision models)   │    │  free/keyless)   │  │ rolled)         │
              │ client email     │                │                   │   │                   │    │                  │  │                 │
              └──────────────────┘                └──────────────────┘   └──────────────────┘    └──────────────────┘  └────────────────┘
                        │
                        ▼ (fallback path only)
              ┌──────────────────┐
              │ User's own SMTP  │   client-facing email, when configured+verified
              │ server           │
              └──────────────────┘

   Observability: core.middleware.RequestLoggingMiddleware → core.ApiRequestLog (per-HTTP-request)
                  core.AuditLog (state-changing actions — coverage now broad but not total, see §8)
                  Sentry: env var only, NOT wired up (no sentry-sdk dependency, no init() call) — see §8
```

### 2.2 Every external dependency (at a glance)

Resend · user-configured custom SMTP servers (arbitrary, per-user) · Cloudinary · Groq API · `open.er-api.com` (exchange rates, no key) · Google OAuth · Facebook OAuth (documented as **not yet actually configured** — code exists, credentials don't) · Railway (backend + Postgres hosting, per docs only — no committed config) · Vercel (both frontend apps, per docs only — no committed config) · Cloudflare (DNS) · Hostinger (registrar only).

### 2.3 Environments

- **Development**: fully described (`CLAUDE.md` §8c) — `redis-server`, `runserver`, `npm run dev`, `celery worker --pool=solo`, `celery beat`, run manually and simultaneously; `--pool=solo` is a confirmed macOS-only workaround for a WeasyPrint/Cairo fork-safety segfault, explicitly **not verified** against the real Linux production target.
- **Staging**: **does not exist.** Every mention of "staging" found in any document is a request for one, not a description of one (e.g. CLAUDE.md's own PERF-001 note: "not actually been verified against a real Linux staging/production container").
- **Production**: described only in prose (Railway/Vercel/Cloudflare/Hostinger, §2.1 above) — **no committed configuration of any kind** backs this description (no Dockerfile, Procfile, railway.json/toml, nixpacks.toml, vercel.json, or CI/CD workflow exists anywhere in the repo). See §10.
- **CI/CD**: **does not exist.** No `.github/workflows/`, no other CI config found anywhere.

---

## 3. Module Inventory

| Module | Purpose | Backend | Frontend | DB | API | Background tasks | WebSocket | Admin | Tests | Docs | Prod-ready | Known open issues |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Users / Auth** (incl. Admin Panel) | Registration, login, 2FA, OAuth, sessions, deletion, settings; separate admin surface | **BUILT** | **BUILT** | 6 tables (`apps/users`) + 1 (`admin_panel`) | ~40 endpoints | 6 tasks | — | **BUILT** (own auth/session stack) | 125 backend tests (users) + **0 for admin_panel** | Complete (CLAUDE.md, DATABASE.md, ADMIN.md) | Module itself: strong. Admin panel: **zero test coverage** on the highest-privilege surface. | See §12 finding NEW-2; two Security Audit items (M4, and two Pass-2 hygiene items) not confirmed closed. |
| **Invoices + Client CRM + Portal** | Invoicing, PDF/portal delivery, design editor, comments, claims, recurring, escalation, analytics | **BUILT** (Steps 1–19 of a 19-step build order) | **BUILT** (mirrors backend steps) | 10 tables (`invoices`) + 4 (`clients`) | ~90 endpoints | 9 tasks | 2 consumers | **NOT BUILT** (ADMIN.md: "not started") | 752 tests (invoices) + 109 (clients) | Extensive, but 2 docs (DATABASE.md's "not yet built" section, `INVOICES_CLIENTS_TECHNICAL_SPEC.md`) are stale/superseded | **PARTIALLY BUILT, audited NOT READY** 19 Aug, 7/12 findings since closed | 3 HIGH findings unconfirmed fixed (PORTAL-003, FE-002, DB-003); 30+ MEDIUM/LOW backlog untouched; design-editor SEV1 chain's final fix (21 Aug) unconfirmed by user |
| **Payments + Expenses + P&L** | Income/expense tracking, CSV import, P&L, income certificate | **NOT BUILT** (only `ExchangeRateSnapshot` + daily fetch task exist, built as an Invoices-module dependency) | **NOT BUILT** | 1 table | **NO HTTP surface at all** | 1 task | — | — | 5 tests (task-only) | CLAUDE.md describes the intended module; none of it exists | **NOT BUILT** | Entire module (income tracking, expenses, CSV import, P&L, income certificate, exchange alerts) does not exist |
| **FBR Tax** | Tax calc, SRO 586 checker, quarterly schedule | **NOT BUILT** | **NOT BUILT** | — | — | — | — | — | — | Described only | **NOT BUILT** | No app exists |
| **Financial Health Score** | 5-dimension business health score | **NOT BUILT** | **NOT BUILT** | — | — | — | — | — | — | Described only | **NOT BUILT** | No app exists |
| **Proposals** | AI proposal writing, client response flow | **NOT BUILT** | **NOT BUILT** | — | — | — | — | — | — | Described only | **NOT BUILT** | No app exists |
| **Contracts** | Templates, digital signing | **NOT BUILT** | **NOT BUILT** | — | — | — | — | — | — | Described only | **NOT BUILT** | No app exists |
| **Subscriptions** | Free/Pro plan enforcement | **NOT BUILT** | **NOT BUILT** | — | — | — | — | — | — | Described only | **NOT BUILT** | No app exists — meaning there is currently **no enforcement mechanism at all** limiting free-tier usage on the modules that DO exist |
| **Dashboard** | Cross-module aggregation | **NOT BUILT** | **NOT BUILT** | — | — | — | — | — | — | Described only | **NOT BUILT** | No app exists |
| **Help / AI Assistant** | In-app AI help | **NOT BUILT** | **NOT BUILT** | — | — | — | — | — | — | Described only | **NOT BUILT** | No app exists; explicitly documented as "built last" |

**Note on Subscriptions being unbuilt**: since apps.subscriptions doesn't exist, the two built modules (Users, Invoices/Clients) currently have **no tier enforcement whatsoever** — every account today effectively has unlimited invoices/clients regardless of CLAUDE.md's documented Free-tier caps. This is expected at this stage of the build (Subscriptions is explicitly a later module), but it is a monetization gap worth naming plainly for the risk map (§13) and 100-point model (§14).

---

## 4. API Inventory

Full endpoint-by-endpoint tables (method, view, file:line, auth mechanism, docstring presence, DB-write/Celery/external-service touch, test presence) were built by direct code inspection for all ~140 real routes across `apps.users`, `apps.admin_panel`, `apps.clients`, `apps.invoices`, and the root-mounted `core.notifications` endpoints. `apps.payments` has no HTTP surface at all (confirmed by its own in-code comment in `config/urls.py`).

**Full routing tree** (`config/urls.py`):
```
/admin/                                   → Django's own raw admin (never the app's real admin surface)
/api/auth/           → apps.users.urls
/api/admin/          → apps.admin_panel.urls
/api/clients/        → apps.clients.urls
/api/clients/<uuid>/statement/pdf/ → apps.invoices.views_statement (registered here deliberately,
                                       to keep apps.invoices → apps.clients a one-directional import)
/api/invoices/       → apps.invoices.urls
/api/notifications/… → core.notifications (root-mounted, not under /api/auth/)
```

### 4.1 Headline findings from the endpoint-level pass

- **One Rule-1 violation found**: `apps/admin_panel/views.py:48`, `class AdminCsrfView(APIView)` — the sole class-based view in the entire codebase (confirmed via `grep -rn "APIView\|ModelViewSet\|generics\."` across all apps; every other ~139 routes are `@api_view` functions). Sits in the same file as ~40 correctly function-based admin views.
- **No raw SQL anywhere** (`grep` for `.raw(`/`cursor.execute` = zero hits) — Rule 8 fully honored.
- **DRF `ScopedRateThrottle`/`throttle_scope` confirmed unused** everywhere, exactly as CLAUDE.md claims — a `config/settings.py:225` comment documents this was deliberately not carried forward from v1 since it never actually worked there. All real rate limiting is hand-rolled, inline `cache.get`/`cache.set` counters, per view.
- **Docstring coverage is uneven by app**: `apps.clients` — 100% (every view documented). `apps.users` — ~60-70%, with gaps notably on security-critical flows (`login`, `verify_2fa`, `resend_2fa`, `verify_email`, `forgot_password`, `reset_password`). `apps.invoices` — 9 of ~42 view functions in `views.py` lack docstrings, including the AI-seeding endpoint (real external cost per call) and the entire preset/design CRUD cluster. `apps.admin_panel` — most endpoints undocumented.
- **`select_for_update()` concurrency locking (the INV-003/DB-002 fix) is real and present**, not just claimed: 7 call sites in `apps/invoices/views.py` (`invoice_mark_paid`, `invoice_add_payment`, `invoice_undo_payment`, `invoice_cancel`, `invoice_refund`, `invoice_mark_bad_debt`, `invoice_claim_confirm` — the last one locks both `Invoice` and `PaymentClaim`), plus a separate per-`User`-row lock in `_finalise_invoice` for invoice-number generation (INV-004 fix), and the identical pattern independently in `apps.users.models.Session.create_for_user`/`apps.admin_panel.models.AdminSession.create_for_user` for the session-cap race.
- **CSRF enforcement on portal write endpoints (PORTAL-002 fix) is real**: `enforce_csrf_standalone(request)` confirmed present in `portal_invoice_comments`, `portal_invoice_claims`, `portal_invoice_acknowledge`.

### 4.2 Endpoints flagged for deeper security review in a later phase

Every endpoint that mutates financial state (`apps.invoices` payment/status-transition views), every portal-facing endpoint (session-cookie-authenticated, `AllowAny` at the DRF layer, manual auth inside the view body), the entire `apps.admin_panel` surface (zero tests), and `apps/invoices/views_email.py`'s inbound webhook (shared-secret header auth, parses arbitrary inbound email content) all warrant dedicated security review — flagged here, not audited here.

---

## 5. Database Inventory

**Universal compliance confirmed**: every model across all 5 apps uses `UUIDField(primary_key=True, default=uuid.uuid4, editable=False)` (Rule 13 — zero exceptions found) and every model has a `__str__` method (STANDARDS.md rule — zero exceptions found). Timestamp discipline (`auto_now_add`/`auto_now`) is used correctly and consistently everywhere.

### 5.1 Model summary by app

| App | Models | Encrypted fields (Fernet+HMAC blind index where unique) | Soft-delete pattern | Cascade behavior notes |
|---|---|---|---|---|
| `apps.users` | User, FreelancerProfile, Session, UserSocialAccount, TrustedDevice, EmailChangeRequest | `cnic_encrypted`/`ntn_encrypted`/`pseb_encrypted` + `*_hash` blind index, `custom_smtp_password` — all correct | `User.is_deleted`/`anonymize()` (PII-stripping anonymization, not hard delete) | `Session`/`TrustedDevice`/`EmailChangeRequest` all `CASCADE` from User — correct, no independent meaning without the user |
| `apps.admin_panel` | AdminSession | — | — | `CASCADE` from User — correct |
| `apps.clients` | Client, ClientNote, ClientTag, ClientPortalSession | none | `Client.is_active` (archive flag) | **`Client.user` is `CASCADE`** — flagged, see §5.3 |
| `apps.invoices` | Invoice, InvoiceItem, InvoicePartialPayment, InvoiceReminder, InvoiceViewEvent, InvoiceComment, PaymentClaim, InvoiceDesign, InvoicePreset, InvoicePresetItem | none (no PII/secrets modeled at this layer) | none — terminal statuses (cancelled/refunded/bad_debt) serve as the "soft delete" for financial history; hard delete only allowed pre-Sent (view-layer enforced) | **`Invoice.user` is `CASCADE`** — flagged, see §5.3. `Invoice.client` is `SET_NULL` (correct — orphaned invoice keeps standing on its own) |
| `apps.payments` | ExchangeRateSnapshot | n/a | n/a (append-only reference data) | no FKs |
| `core` | AuditLog, ApiRequestLog, NotificationRead | n/a | `AuditLog`/`ApiRequestLog` immutable by design | `user`/`actor` both `SET_NULL` — correct, a deleted user's audit trail must survive |

### 5.2 A real, previously-fixed bug worth noting in the schema itself

`Invoice.invoice_number` is deliberately **not** globally unique — it's `unique_together(user, invoice_number)`. The model's own docstring documents this as a fix for a real v1 bug: two different users' first invoice of a calendar year both computing `INV-2026-0001` caused a cross-tenant `IntegrityError`. This is good evidence of institutional memory being carried forward correctly.

### 5.3 CASCADE vs PROTECT — the one finding this pass corroborates most strongly

CLAUDE.md's own Database Design Rule #6 states: *"PROTECT (block deletion) for financial records."* The actual code has `Invoice.user` and `Client.user` both set to `on_delete=CASCADE`. This is **exactly finding DB-003** from the 19 Aug production audit, and this pass's independent code read confirms it is **still present, unfixed**, in the current schema. Practical effect: hard-deleting a `User` row (which the app's own account-deletion flow deliberately never does — it anonymizes instead) would cascade-delete every invoice and client that user ever had. The risk is latent (the anonymize-not-delete design currently prevents it from firing), not active — but it is a landmine sitting directly against the project's own stated rule, and the admin panel's `apps.admin_panel` deletion-queue "restore" feature (and Django's raw `/admin/` surface, which nothing prevents a superuser from using to hard-delete a User directly) are both realistic paths that could trigger it.

### 5.4 Migrations

All 6 apps show clean, linear migration histories (`admin_panel`: 1, `clients`: 2, `invoices`: 10, `payments`: 1, `users`: 10, `core`: 4) — no branching, no squash/reset patterns, `makemigrations --check --dry-run` returns "No changes detected" (model state and migrations are in sync).

### 5.5 A new encryption-discipline gap found this pass

`FreelancerProfile.wise_access_token` / `wise_refresh_token` are plain `TextField`s — **not** run through `core.encryption`'s Fernet helpers, despite `custom_smtp_password` and the CNIC/NTN/PSEB fields on that *exact same model* correctly using them. These are live OAuth credential pairs for a payment provider (Wise). See Finding NEW-3, §12.

---

## 6. Authentication / Authorization Surface Map

Three genuinely separate, non-overlapping auth stacks exist, confirmed consistent across code and docs:

| Surface | Session model | Cookie names | Token lifetime | Concurrency cap | 2FA | Authorization gate |
|---|---|---|---|---|---|---|
| **Main app** | `apps.users.models.Session` | (standard JWT httpOnly cookies) | 15-min access / 30-day (or 90-day Remember Me) refresh | 3 concurrent, LRU-evicted | Optional, email OTP | `IsAuthenticated` + object-ownership checks inline in each view (no shared "ownership" permission class found — each view does its own `.filter(user=request.user)`/`get_object_or_404(..., user=request.user)`) |
| **Admin panel** | `apps.admin_panel.models.AdminSession` (own table, own concurrency cap) | `lanceraos_admin_access` / `lanceraos_admin_refresh` (deliberately distinct names since both travel to the same `api.` host) | 1-day | 2 concurrent | **Mandatory**, no bypass (`admin_login` rejects any account with `two_fa_enabled=False` outright) | `AdminCookieJWTAuthentication` (requires an `admin_sid` JWT claim absent from regular tokens — this is the actual mechanism preventing cross-surface token replay) + `can_access_admin_panel` (separate from Django's `is_staff`/`is_superuser`) + `IsSuperAdmin` (grant/revoke admin access only) |
| **Client portal** | `apps.clients.models.ClientPortalSession` | hashed session cookie, sliding 60-day expiry | 60-day sliding | not capped (multi-device access is a deliberate feature — "resend link" doesn't revoke other devices) | none (no account exists to attach 2FA to) | `AllowAny` at the DRF layer + manual session-cookie/token verification inside each view body (`_resolve_portal_write_access`, `is_freelancer_previewing_portal`) |

### 6.1 Authorization mechanisms inventory

- `IsAuthenticated` — used on every main-app and admin-panel protected endpoint (confirmed, no bare unauthenticated endpoint found outside the documented `NO_AUTH` allowlist and portal surface).
- `IsSuperAdmin` (`apps/admin_panel/permissions.py`) — gates exactly 2 endpoints (grant-admin, revoke-admin).
- **No shared, reusable "ownership" or "tenant" permission class exists anywhere** (`core/permissions.py` is a **0-byte empty file** — see Finding NEW-4). Every view enforces ownership by manually filtering querysets by `request.user` inline. This is a real architectural gap: correctness today depends on every single view author remembering to add that filter by hand, with no structural backstop. The 19 Aug audit's own SEC-001 finding notes no IDOR/BOLA was actually found in practice — but that is a track record, not a guarantee, given there is no shared enforcement mechanism.
- Portal access control (`is_freelancer_previewing_portal`, `_resolve_portal_write_access`) is hand-rolled per-endpoint logic, not a DRF permission class — the PORTAL-001 fix (requiring `owner_user_id` to actually be checked) had to be applied to 5 separate call sites individually rather than in one place.

### 6.2 Areas flagged for deeper audit

The complete absence of a shared ownership/tenant permission abstraction; the client-portal auth model's reliance on per-endpoint manual checks; the still-unconfirmed PORTAL-003 (reminder/unread-comment tasks writing their idempotency marker only after sending, not before — a real double-send race on crash) and DB-003 (CASCADE landmine) findings; and the completely untested `apps.admin_panel` authorization surface (grant/revoke/suspend/reactivate — the highest-consequence actions in the whole system, with zero regression tests).

---

## 7. External Service Map

| Service | Purpose | Auth | Timeout | Retry/fallback | Failure handling | Outbound rate limit | Prod SPOF? |
|---|---|---|---|---|---|---|---|
| **Resend** | Platform email + fallback for client email | `RESEND_API_KEY` | 10s | None (single attempt) | Never raises — returns `(False, None, error)`, logged | None | **Yes, broad** — every registration, password reset, 2FA code, invoice email, and notification silently fails to send (but the HTTP request itself still succeeds) if Resend is down |
| **Custom SMTP** (per-user) | Client-facing email when configured | User's own credentials, Fernet-encrypted at rest | 15s | Falls back to Resend automatically on any failure | Logged, `CustomSmtpFailed` event → AuditLog + (per docs) in-app notice | None | No — has automatic Resend fallback |
| **Cloudinary** | Logo/invoice-PDF storage | `CLOUDINARY_*` env vars, global SDK config | **No explicit timeout set anywhere** (relies on SDK default) | Invoice-PDF path has a self-heal fallback to live-render-on-demand; logo-upload path has no equivalent fallback confirmed | Background PDF task swallows and logs; logo-upload failure behavior not independently verified this pass | None found | Yes, for logo uploads specifically (no fallback); softened for invoice PDFs by the render-on-demand path |
| **Groq** | AI (design classification, invoice AI-seed) | `GROQ_API_KEY` | 90s | Retries only on HTTP 429, up to 2x, honoring Groq's own backoff hint | Never swallowed — raises `RuntimeError`, caller converts to a user-facing error | 5/hour, enforced app-side on the one consuming endpoint | Only for the AI-seed feature — not platform-wide |
| **Exchange rate API** (`open.er-api.com`) | Daily FX snapshot | None (free, keyless endpoint) | 10s | Celery-level retry, up to 3x, 5-min backoff | Logs `critical` on exhaustion, no downstream alerting beyond the log line | None | Moderate — a multi-day outage leaves currency conversion running on stale snapshots; documented as tolerated by design (daily-idempotent task skips if today's snapshot already exists) |
| **Google OAuth** | Login | `GOOGLE_CLIENT_ID` only (ID-token flow) | 10s (fallback access-token path only; ID-token path has no explicit timeout, relies on the `google-auth` library's own key-fetch caching) | None | Raises a specific `OAuthVerificationError` | None | No — email/password login is an unaffected, separate path |
| **Facebook OAuth** | Login | `FACEBOOK_APP_ID`/`SECRET` | 10s | None | Raises `OAuthVerificationError` | None | **Not currently a real dependency at all** — code exists but credentials are explicitly documented as not yet provisioned; feature is dormant |
| **Railway** (hosting) | Backend + Postgres | n/a | n/a | n/a | n/a | n/a | Total — but **no committed deployment config exists to describe or reproduce this dependency** (see §10) |
| **Vercel** (hosting) | Both frontends | n/a | n/a | n/a | n/a | n/a | Total — same caveat |
| **Cloudflare** (DNS) | Domain resolution | n/a | n/a | n/a | n/a | n/a | Total, standard for any hosted app |

**Two documented-but-dead env vars found**: `EXCHANGE_RATE_API_KEY` (the actual code calls the free, keyless endpoint and never reads this var) and `SENTRY_DSN` (no code anywhere consumes it — see §8). Both are present in `.env.example` with comments suggesting future/reserved use, but `.env.example`'s own header claim that "none are aspirational" is not fully accurate.

---

## 8. Background Job Inventory

Celery Beat schedule (`config/celery.py`, timezone `Asia/Karachi`) — 8 scheduled tasks, plus 3 event-driven-only tasks with no schedule entry:

| Task | Trigger | Schedule | Retry policy | Idempotency | Test coverage |
|---|---|---|---|---|---|
| `anonymize_expired_accounts` | Beat | Daily 02:00 | `max_retries=3`, per-user retry | Safe — filters already-anonymized rows out | Yes (2 tests) |
| `cleanup_trusted_devices` | Beat | Weekly Sun 03:00 | None | Safe (delete-expired) | **No test** |
| `cleanup_expired_sessions` | Beat | Daily 02:15 | None | Safe (delete-expired) | **No test** |
| `cleanup_email_change_requests` | Beat | Daily 02:30 | None | Safe (bulk update, idempotent) | **No test** |
| `send_password_reset_email_task` | Event (`.delay()` from view) | — | None | Caller-controlled, no internal dedup | Yes |
| `send_verification_email_task` | Event (3 call sites) | — | None | No internal dedup | **No test** |
| `fetch_exchange_rates` | Beat | Daily 08:00 | `max_retries=3`, 5-min backoff | **Explicitly idempotent** — checks today's snapshot exists before calling the API | Yes (5 tests) |
| `send_invoice_reminders` | Beat | Daily 09:00 | None (per-invoice try/except) | Idempotent — checked + DB `unique_together` backstop | Yes |
| `notify_unread_comments` | Beat | Every 15 min | None | Idempotent via `unread_reminder_sent_at`, **but set only after send succeeds — a crash between send and marker-write can double-send** (this is finding PORTAL-003) | Yes |
| `generate_recurring_invoices` | Beat | Daily 08:30 (deliberately before the 09:00 reminder task) | None (per-invoice try/except, 3-strikes auto-pause) | Mostly safe; task's own docstring acknowledges a narrow window where a crash after child-invoice creation but before `next_recurring_date` advancement could double-generate one cycle | Yes |
| `notify_stale_drafts` | Beat | Weekly Mon 09:30 | None | Read-only + notify, naturally safe | Yes |
| `render_and_store_invoice_pdf` | Event (post-finalise) | — | None, deliberately non-fatal | Safe to re-run (overwrites) | Yes |

**Cross-cutting gap**: `request_id` (the HTTP-request UUID CLAUDE.md's own Observability Rule 2 says must be "passed to every Celery task spawned by that request") is **not actually propagated anywhere** — confirmed by grep; every task-originated `AuditLog`/log entry carries `request_id=None`. This breaks the documented "find the request_id, search all logs, get a complete timeline" support-investigation workflow for anything that touches a background task.

**`ReminderSent` has no registered audit handler** — of the 8 real invoice lifecycle events emitted, only `EscalationRequired` (not `ReminderSent` itself) has an `@on(...)` handler in `apps/invoices/notifications.py`. Routine day-3/7/14 reminder sends currently leave zero `AuditLog` trail, unlike every other lifecycle event fixed by the INV-002 round.

---

## 9. Observability Inventory

| Component | Status |
|---|---|
| `core.middleware.RequestLoggingMiddleware` | **Working** — assigns `request_id`, captures method/path/status/IP/UA/duration, writes to `core.ApiRequestLog`, redacts sensitive request-body fields, only logs response body on 5xx. Failures in the logging itself are caught, never propagate. |
| `request_id` → Celery propagation | **Not implemented**, despite being documented as a firm rule. See §8. |
| `core.AuditLog` | **Broad but not total coverage.** Users app: mature, comprehensive. Invoices app: 17 of ~18 real lifecycle/portal events now have handlers (post-19-Aug fixes) — the one gap is `ReminderSent` (§8). Admin panel: covered. Payments/Clients: partial (some models reference AuditLog for read paths, no dedicated events module of their own). |
| Sentry | **Not wired up at all.** `sentry-sdk` is absent from `requirements.txt`; no `sentry_sdk.init()` call exists anywhere in `config/settings.py` or elsewhere. The only trace in the whole repo is the unused `SENTRY_DSN=` line in `.env.example`. There is currently **zero automated error-tracking/exception-aggregation** in this system — production errors are only visible via whatever the hosting platform's own raw logs happen to capture. |
| WebSocket logging | **None.** `apps/invoices/consumers.py`'s `ClientThreadConsumer` has no connect/disconnect/error logging anywhere in the file — rejection paths (`close(code=4004)`/`close(code=4001)`) log nothing. There is no `ApiRequestLog`-equivalent for the WebSocket layer; WS activity is entirely invisible to any observability system in this codebase today. |
| Email logging | Present per CLAUDE.md's documented shape (`sent_via`, `smtp_host`, `provider_message_id`, `status`) — confirmed via `core/email.py`'s design (not independently re-verified field-by-field this pass). |
| PDF generation logging | Present per the same pattern; the circuit-breaker fix (PDF re-upload) added its own timing-test coverage. |

**Do not assume Sentry is production-ready because the env var exists** — this is stated explicitly per the audit brief's own instruction, and this pass confirms the concern is real: the env var is decorative.

---

## 10. Testing Inventory

| Category | Count / status |
|---|---|
| Backend tests (`def test_`) | users: 125 · clients: 109 · invoices: 752 · payments: 5 · **admin_panel: 0** — **991 total** |
| Frontend tests (Vitest, `it(`/`test(`) | frontend/: 218 across 20 files · **admin-frontend/: 0** |
| E2E / browser-driven tests | **None exist as an automated suite.** No Playwright config anywhere in the repo. All "browser-verified" claims in DECISIONS.md (screenshots at various breakpoints, live Chromium/Playwright sessions) were **manual, one-off verification sessions**, not a repeatable, CI-runnable E2E suite. |
| WebSocket tests | Only `apps/invoices/tests/test_consumers.py` (covers `ClientThreadConsumer`). `core.consumers.NotificationConsumer` (the notification bell) has **no** `WebsocketCommunicator`-based test. |
| Concurrency tests | Real — `apps/invoices/tests/test_concurrency.py`, genuine multi-thread/multi-connection tests (not sequential calls dressed up as concurrent), covering the INV-003/DB-002/INV-004/INV-009 fixes. |
| Payment/portal tests | Extensive within `apps.invoices`/`apps.clients` (claims, comments, acknowledgment, cross-account preview-guard, CSRF-rejection). |
| Regression tests | Present and growing per-fix (each DECISIONS.md fix entry names its own new test file/class). |

### 10.1 Coverage gaps

- **`apps.admin_panel`: zero tests, backend or frontend** — grant/revoke-admin, suspend/reactivate, session-list/revoke, audit-log viewer, deletion-queue restore, and the CBV CSRF endpoint are all completely unverified by automation. This is the single largest coverage gap in the repository, on the highest-privilege surface in the system.
- **`apps.payments`: 5 tests total**, all narrowly scoped to the exchange-rate task's retry/skip logic — consistent with the module being "barely started," but worth naming since even the one piece that exists (currency conversion via `core.money.Money`) has no dedicated test file located in this pass beyond the task tests.
- **Four Celery tasks with zero test coverage**: `cleanup_trusted_devices`, `cleanup_expired_sessions`, `cleanup_email_change_requests`, `send_verification_email_task`.
- **No E2E suite** — every "verified in the browser" claim in the project's own history is a manual, non-repeatable act, not something CI can re-check on the next commit. The 21 Aug SEV1 (canvas dragging) bug is direct proof of the cost of this gap: prior "verified" claims used toolbar/API-level shortcuts that happened to bypass the exact code path the real bug lived in.
- **No test gates any deploy** — since there is no CI (§11), none of these 991+218 tests are guaranteed to run before code reaches whatever "production" currently means for this project.

---

## 11. Deployment / Production Inventory

**Findings, stated plainly:**

- **No Dockerfile, no Procfile, no railway.json/toml, no nixpacks.toml, no docker-compose.yml, no vercel.json** exist anywhere in the repository (root, `frontend/`, `admin-frontend/`).
- **No `.github/workflows/` directory, no CI/CD configuration of any kind.**
- **No health-check endpoint** exists in `config/urls.py` or anywhere in the active (non-`v1-reference`) codebase.
- **No static-file production story**: `DEBUG=False` disables Django's own static serving (as it should), but there is no WhiteNoise, no `STATICFILES_STORAGE`/`DEFAULT_FILE_STORAGE` override, and no `collectstatic`-driven CDN/nginx config committed — if Railway's platform doesn't independently solve this, static assets have no defined serving path in production.
- **`config/settings.py` itself is well-structured for a prod/dev split**: `DEBUG` env-sourced (default `False`, i.e. fails safe), `SECRET_KEY` required with no hardcoded fallback and a ≥50-char validation, `COOKIE_SECURE` correctly tied to `DEBUG`, a real `if not DEBUG:` block enabling `SECURE_SSL_REDIRECT`/HSTS/`X_FRAME_OPTIONS`. This part of the story is genuinely solid — the gap is entirely in *what deploys this settings file*, not the settings file itself.
- **Migrations are clean** (§5.4) — `makemigrations --check` shows no drift.
- **No evidence of a rollback mechanism** — no release tagging, no deploy scripts, nothing beyond git itself.
- Untracked local Celery Beat artifacts (`celerybeat-schedule*` files) sitting in the repo working directory are evidence that Beat has only ever been run locally/manually, never as a separately deployed, managed process — consistent with "no deployment config exists."

**Can this be deployed reproducibly today?** No — not from anything committed to this repository. Whatever deployment exists (if any) depends entirely on manual, undocumented, out-of-repo platform configuration.
**Is there a staging environment?** No.
**Is production configuration clearly separated?** The Django settings layer, yes. The infrastructure/deploy layer, there is no evidence it exists at all.

---

## 12. Previous Audit Reconciliation

### 12.1 SECURITY_AUDIT.md (24 Jul 2026) + SECURITY_AUDIT_PASS2.md (24 Jul 2026) — Users/Auth scope

Nearly every finding from both passes was closed in a single, well-documented consolidated fix pass shortly after. Reconciled against DECISIONS.md:

| ID | Severity | Status |
|---|---|---|
| SEC-H1 (trusted-last-IP fix) | High | **Fixed**, honestly caveated as unverified against Railway's real edge behavior |
| SEC-H2 (django-axes on /admin/) | High | **Fixed** |
| SEC-H3 (raw exception text, SMTP test) | High | **Fixed** |
| SEC-C1/H3/M3 (mass-assignment onboarding bypass — Pass 2's Critical) | **Critical** | **Fixed** (`read_only_fields` hardening); `pseb_registered` deliberately left self-declarable as a real feature, with a documented future constraint for the Tax module |
| SEC-M1 (CSRF on NO_AUTH endpoints) | Medium | **Fixed** |
| SEC-M2 (non-constant-time token compare) | Medium | **Fixed** |
| SEC-M3 (SVG logo upload, stored XSS) | Medium | **Fixed** |
| SEC-M5 (SMTP-test SSRF) | Medium | **Fixed** |
| SEC-M6 (raw exception text, logo upload) | Medium | **Fixed** |
| Pass2-H1 (unescaped UA/IP in security emails) | High | **Fixed**, plus one twin bug found and fixed in the same pass |
| Pass2-H2 (login timing user-enumeration) | High | **Fixed**, empirically verified |
| Pass2-M1 (session-cap TOCTOU race) | Medium | **Fixed**, verified with a 10-thread test |
| Pass2-M2 (forgot-password throttle + sync-send timing oracle) | Medium | **Fixed** |
| SEC-M4 (account-existence side channel in lockout message) | Medium | **No fix confirmed** — status unresolved by this pass's search |
| SEC-L1 (dependency CVEs) | Low | **Partially fixed** (3 of the named packages bumped) |
| SEC-L2 (react-router-dom CVE, needs major downgrade) | Low | **Deliberately deferred**, not fixed |
| SEC-L3 (CNIC/NTN/PSEB plaintext in GET /profile/ response) | Low | **No fix confirmed** |
| SEC-L4 (.env.example DEBUG=True) | Low | **Fixed** |
| Pass2-L1 (host-header poisoning) | Low | Confirmed not exploitable at audit time, no fix needed |
| Pass2-L2 (open redirect hardening gap) | Low | **No fix confirmed** |
| Pass2-L3 (implicit JWT algorithm) | Low | **No fix confirmed** (hygiene only) |
| Pass2-L4 (Cloudinary public_id predictability) | Low | Confirmed not exploitable, no fix needed |

### 12.2 LANCERAOS_CLIENTS_INVOICES_PRODUCTION_AUDIT.md (19 Aug 2026) — Master reconciliation

Original verdict: **NOT READY**. 3 CRITICAL (live-reproduced) + 12 HIGH + 15 MEDIUM + 10 LOW + 9 INFO. Two corrupted proof invoices (`INV-2026-0031`, `INV-2026-0025`) were deliberately left unrepaired as before-evidence.

| ID | Severity | Status now |
|---|---|---|
| INV-003 / DB-002 (concurrent overpayment, no lock) | **CRITICAL** | **Fixed 19 Aug**, `select_for_update()` + `transaction.atomic()`, verified with real concurrent-thread tests. Confirmed present in code this pass (§4.1). |
| INV-009 / FE-001 (Undo Payment reachable on terminal status) | **CRITICAL** | **Fixed 19 Aug**, status guard added; frontend dead-constant now wired live. |
| INV-004 (invoice-number race) | High | **Fixed 19 Aug** — retry-only approach tried first and found insufficient under real concurrency, escalated to per-user row lock. |
| INV-001 (stale total after clearing all line items) | High | **Fixed 19 Aug**, unconditional recalculation. |
| INV-002 (7 lifecycle events with no AuditLog handler) | High | **Fixed 19 Aug**, 8 new `@on(...)` handlers — **except `ReminderSent`, which this pass found still has no handler** (§8, new finding). |
| PORTAL-001 (preview guard doesn't check ownership) | High | **Fixed 19 Aug**, `owner_user_id` param added, verified cross-tenant. |
| PORTAL-002 (missing CSRF on 3 portal endpoints) | High | **Fixed 19 Aug**, confirmed present in code this pass (§4.1). |
| PORTAL-003 (reminder/comment tasks: send-then-mark ordering) | High | **Not confirmed fixed** — this pass's independent task-level inspection (§8) shows `notify_unread_comments` still marks its idempotency flag only after the send call, i.e. the same race the audit named. Treat as **still open**. |
| PDF-001 (design_data never reaches the renderer) | High | **Fixed 19 Aug** (`design_renderer.py`) — but this fix had **zero real-world effect** until the same-day SEV1 fix (design-to-invoice assignment) that followed it; see §12.3. |
| FE-002 (unescaped HTML interpolation in notification emails) | High | **Not confirmed fixed** — no DECISIONS.md entry closing this was found by either research pass. Treat as **still open**. |
| DB-003 (CASCADE vs documented PROTECT rule) | High | **Not confirmed fixed** — independently reconfirmed present in the schema this pass (§5.3). **Still open.** |
| CLIENT-001…010, PORTAL-004…009, PDF-002…004, DB-004, INV-005…008, FE-003/004 (30 MEDIUM/LOW/INFO items) | Mixed | **Untouched** — the audit's own §26 scoped these as non-blocking hardening backlog, not urgent; no evidence any were addressed. |
| PERF-001 (WeasyPrint/Celery fork-safety segfault) | Info/Operational | **Root-caused and fixed for local macOS dev** (`--pool=solo`) 19 Aug — **explicitly still unverified against real Linux/Railway production**, per both DECISIONS.md and CLAUDE.md's own §8c wording. |
| SEC-001 (no IDOR/BOLA found) | Info (positive) | Confirmed strength at the time; not re-verified independently this pass beyond noting the structural gap in §6.1 (no shared ownership permission class) that makes this a track record rather than a guarantee. |

### 12.3 The four-bug SEV1 chain (19–21 Aug 2026) — design editor

This chain was **not** part of the formal production audit above; it was a sequence of direct user reports, each investigated live. Reconciliation:

1. **19 Aug, "design_data render path" (closes PDF-001 as scoped)** — built a real renderer for `design_data`. **Fixed and verified** (25-item stress test, font-embedding checks).
2. **19 Aug, "SEV1 — design-to-invoice assignment gap"** — discovered, same day, that step 1's fix had never mattered: `Invoice.design` was never assigned by any code path anywhere (82 real invoices, 0 with `design_id` set). **Fixed and verified** against real production-shaped data. Explicitly still-open sub-gap named: no manual per-invoice design-override picker exists yet; `color_variant` confirmed still fully inert.
3. **20 Aug, "SEV1 — gallery previews + color_variant wiring"** — fixed 3 issues: a draft-status live-preview staleness edge case, generic non-representative gallery preview cards, and `color_variant` being inert everywhere (root cause: hardcoded hex in all 3 static templates, not CSS variables). **Fixed and verified**, 9 real template×color combinations screenshotted.
4. **20 Aug, "frozen-PDF colors, second investigation"** — a false alarm in effect: root cause was a **stale, unrestarted Celery worker** executing pre-fix bytecode for ~17 hours, not a code defect. Fixed by restarting the worker; CLAUDE.md's own operational guide updated with an explicit "restart Celery after every backend change" warning.
5. **20 Aug, "SEV1 — canvas editor loads a disconnected abstraction"** — the editor showed synthetic placeholder content/fonts unrelated to real render output, so resize/drag actions in the editor didn't correlate with real layout. **Fixed** by sourcing canvas content from real backend-rendered HTML fragments. **Honestly caveated**: automating a real mouse-drag resize via Playwright never worked in that session; the fix was proven via direct model-mutation instead of an actual interactive drag.
6. **21 Aug, "SEV1 — canvas dragging genuinely broken"** — a fourth, distinct bug in the same feature family, found by the actual user's own mouse: nothing could be dragged onto the canvas at all. Root cause: GrapesJS's `draggable` trait callback receives `(source, destination)`, but the code checked the first argument as if it were the destination — the check could structurally never pass. This entry **explicitly documents why round 5's own "verified" claims missed this**: round 5 used the toolbar's "move" icon and direct API calls, both of which bypass the exact validation path this bug lived in. **Fix applied 21 Aug, but this entry is explicitly marked NOT complete** — DECISIONS.md states plainly that the user needs to verify it himself before it's considered done, and dev servers were deliberately left running for that purpose.

**As of this audit (21 Aug), item 6's fix has not been confirmed working by the user.** This is the single most immediately-relevant open item in the entire reconciliation — it is the most recent change, touches a core, heavily-marketed feature (the visual invoice design editor), and its own fix entry says verification is still pending.

---

## 13. Documentation Contradictions

Classified per the audit brief's own taxonomy:

| Contradiction | Class | Detail |
|---|---|---|
| `DATABASE.md`'s "Not yet built" section | **Documentation-only, stale** | Independently re-confirmed this pass: it still lists payment-claims workflow, comment delivery, and recurring/reminder tasks as unbuilt — all were completed by Steps 13-17 (14-15 Aug), well before DATABASE.md's own last-modified date (20 Aug). The file was not fully updated even though it was touched after those features shipped. |
| `INVOICES_CLIENTS_TECHNICAL_SPEC.md`'s endpoint table vs. real routes | **Historical/deprecated wording** | Spec predates the real implementation and explicitly self-labels as a pre-code design doc; several routes (unified `/api/portal/...`, a different WS path shape) were never built as specified. Not a "bug," but the file carries no warning against being read as current API documentation. |
| CLAUDE.md's Database Design Rule #6 vs. actual `CASCADE` FKs | **Code issue** | See §5.3/§12.2 (DB-003) — an unresolved contradiction between a stated architecture rule and the actual schema. |
| CLAUDE.md's "frozen PDF, never re-rendered" language vs. the documented self-heal re-upload chain | **Intentional divergence, imprecisely worded** | Content is guaranteed identical, but the literal "never re-rendered" phrasing isn't accurate to the code's actual re-upload/retry behavior. |
| AR Aging Report: present in `INVOICES_CLIENTS_TECHNICAL_SPEC.md`, removed from the real code 16 Aug | **Intentional divergence, spec now stale** | Spec (13 Aug) predates removal by 3 days; the spec was never updated to reflect the reversal. |
| Client portal PIN-based auth (CLAUDE.md's original Module 2 prose) vs. the real magic-link design | **Superseded wording, later corrected in CLAUDE.md itself** | CLAUDE.md's current text already carries the correction; flagged here only because it demonstrates the document has been kept current in at least this instance, unlike DATABASE.md. |
| `ADMIN_PANEL_DESIGN.md` and `USER_ADMIN_FEEDBACK_PLAN.md` | **Unresolved-ambiguity-turned-real** | Both documents' own front matter/kickoff notes admit they were cited constantly in decisions before they actually existed as committed files in the repo. They exist now (reconstructed), but this is worth naming as a documentation-process weakness — decisions were made citing documents that did not yet exist. |
| Preview-as-Client removal (17 Aug) vs. `INVOICES_CLIENTS_TECHNICAL_SPEC.md`'s build-order item 12 | **Intentional divergence, spec stale** | The feature named in the spec's own build order was built, then deliberately removed in a later redesign; the spec was never amended. |
| Sentry: `.env.example` presence vs. zero implementation | **Code issue presented as documentation gap** | Not a "contradiction between two documents" so much as a placeholder that reads as evidence of a capability that doesn't exist — see §9. |
| No staging/CI/CD/backup documentation anywhere | **Clean absence, not a contradiction** | Confirmed by repo-wide search — there is nothing to contradict because nothing is documented (or built) in any of these areas. Named here per the audit brief's explicit instruction to report absence clearly. |

---

## 14. Production Readiness Risk Map

Severity assigned only where this pass's evidence directly supports it.

### CRITICAL
- **C-1**: The 21 Aug canvas-dragging fix for the design editor is unverified by the actual user — a core, actively-marketed feature may currently be non-functional in production-equivalent conditions. *(Requires: user verification, then a deeper design-editor regression pass — this class of bug has recurred 4 times in 3 days.)*
- **C-2**: `apps.admin_panel` — the highest-privilege surface in the system (grant/revoke admin, suspend/reactivate any account, restore deleted accounts) — has **zero automated test coverage**, backend or frontend. *(Requires: dedicated admin-panel security + correctness audit before this surface is trusted in production.)*
- **C-3**: No deployment configuration of any kind is committed to the repository — the described Railway/Vercel architecture cannot be verified, reproduced, or rolled back from what exists in version control today. *(Requires: a deployment-readiness audit as its own phase.)*

### HIGH
- **H-1**: DB-003 — `Invoice.user`/`Client.user` `CASCADE`, contradicting the project's own PROTECT-for-financial-records rule (§5.3, §12.2). Latent, not currently exploitable given the anonymize-not-delete design, but a real landmine.
- **H-2**: PORTAL-003 — reminder/unread-comment tasks can double-send email on a crash between send and idempotency-marker write (§8, §12.2).
- **H-3**: FE-002 — unescaped HTML interpolation in outbound notification emails, reachable via the real inbound-email-reply path (§12.2) — not confirmed fixed.
- **H-4**: No error tracking (Sentry) is wired up anywhere — production errors are only as visible as raw platform logs happen to make them (§9).
- **H-5**: `FreelancerProfile.wise_access_token`/`wise_refresh_token` stored in plaintext next to correctly-encrypted CNIC/NTN/PSEB fields on the same model (§5.5) — a live payment-provider OAuth credential pair with no encryption at rest.
- **H-6**: No shared ownership/tenant-check permission class exists (`core/permissions.py` is empty) — every view's cross-tenant safety depends on manual, per-view diligence with no structural backstop (§6.1).
- **H-7**: No CI/CD — 991+ backend tests and 218 frontend tests exist but are not gated on any merge or deploy; nothing prevents a regression from reaching whatever "production" currently means.
- **H-8**: No staging environment — every fix in this project's history has been verified either in local dev or, at best, live against Ali's own real production-adjacent account data (e.g. the SEV1 chain, the concurrency fixes) — there is no safe intermediate environment.

### MEDIUM
- **M-1**: `request_id` doesn't propagate into Celery tasks, breaking the documented request-id-based support-investigation workflow for anything background-job-related (§8, §9).
- **M-2**: `ReminderSent` has no AuditLog handler — routine automated reminder sends leave no audit trail (§8, §12.2).
- **M-3**: `AdminCsrfView` is a class-based view, the sole Rule-1 violation in ~140 routes (§4.1) — low risk in itself, but a real, unambiguous standards deviation.
- **M-4**: No health-check endpoint exists (§11) — relevant to zero-downtime deploy support on Railway/similar platforms.
- **M-5**: No production static-file serving solution is committed (§11).
- **M-6**: 30 MEDIUM/LOW/INFO findings from the 19 Aug production audit remain untouched by design (its own scoping decision, not new to this pass) — named here as a real, sizeable backlog, not urgent individually but material in aggregate.
- **M-7**: Two SECURITY_AUDIT items (M4 account-enumeration message; and Pass 2's open-redirect hardening gap / implicit JWT algorithm) have no confirmed fix.
- **M-8**: No subscription/tier enforcement exists at all (`apps.subscriptions` unbuilt) — every account currently has unlimited usage of both built modules, a monetization-readiness gap rather than a security one.

### LOW
- **L-1**: No E2E/Playwright suite — all cross-browser/interactive verification to date has been manual and non-repeatable.
- **L-2**: Cloudinary calls have no explicit timeout set (relies on SDK default).
- **L-3**: `generate_recurring_invoices` has a narrow, self-documented double-generation race window on process crash mid-cycle.
- **L-4**: Four Celery tasks and the admin-panel WebSocket-adjacent notification consumer have no test coverage individually (distinct from the app-wide admin_panel gap already called out at C-2).

### INFO
- Password hashing (Argon2), `USE_TZ=False`, UUID PKs everywhere, no raw SQL, no dead DRF-throttle config, clean migrations, and the concurrency-locking fixes are all genuine, verified strengths — not gaps.

---

## 15. Mapping to the 100-Point Production Model

| Category | Assessment |
|---|---|
| **P0 — Production baseline** | Partially complete. Settings-layer prod/dev split is solid; deployment config layer is entirely absent (C-3). |
| **P1 — Authentication/session security** | Already strong. Two independent security audits, both substantially remediated; three distinct, well-isolated auth stacks; real concurrency fixes for session-cap races. Two minor items (M4, hygiene) unconfirmed closed. |
| **P2 — Authorization/multi-tenancy** | Partially complete, with a known-gap: no shared ownership/tenant permission class exists (H-6); track record is clean (SEC-001) but structurally fragile. Admin-panel authorization entirely untested (C-2). |
| **P3 — Database/data integrity/business logic** | Partially complete. Real, live-reproduced financial-corruption bugs were found and fixed with genuine concurrency tests — a real strength. DB-003 (CASCADE landmine) remains open. Recurring-invoice double-generation edge case is self-documented and unresolved. |
| **P4 — Monetization/payments/subscriptions** | **Known gap, effectively unbuilt.** No `apps.subscriptions` exists; no tier enforcement anywhere; no payment-processor integration exists at all (Payments module itself is unbuilt beyond the FX-rate foundation). |
| **P5 — API/application security** | Partially complete. CSRF, rate limiting (hand-rolled but consistent), input validation via DRF serializers, no raw SQL, no IDOR found to date — real strengths. FE-002 (unescaped email HTML) and the one CBV rule violation are open items. |
| **P6 — Reliability/background jobs/external services** | Partially complete. Idempotency is thoughtfully handled in most tasks; PORTAL-003's send-before-mark ordering is a real gap; every external service has documented failure behavior, though several (Resend, Cloudinary) are single points of failure with no queuing/dead-letter mechanism for failed sends beyond what's described. |
| **P7 — Observability/audit/incident response** | **Known gap.** `AuditLog`/`ApiRequestLog` are real and reasonably comprehensive for HTTP-originated events, but Sentry is decorative-only (H-4), `request_id` doesn't reach Celery (M-1), WebSocket activity is entirely unlogged, and there is no incident-response process documented anywhere. This category needs a dedicated audit before any real production incident would be diagnosable end-to-end. |
| **P8 — Backup/disaster recovery** | **Unknown / known gap.** No backup or DR policy is documented anywhere in the repository (confirmed clean absence, §2.3, §13). Whatever backup posture exists (if any) is entirely outside version control and this audit's visibility — requires a dedicated infrastructure-focused audit, likely conducted partly outside the repo itself (Railway's own managed-Postgres backup settings, etc.). |
| **P9 — Performance/scalability/infrastructure** | Unknown for production. PERF-001 (WeasyPrint fork-safety) is root-caused and fixed for local macOS dev but explicitly unverified on the real Linux/Railway target. No load-testing evidence exists anywhere in the docs. Database indexing looks deliberate and reasonable (§5) but has not been tested under realistic production volume. |
| **P10 — UX/accessibility/compatibility/final launch** | Partially complete. Real, repeated responsive/breakpoint verification work is documented (375/768/1280/1920, light/dark) for the Invoices module specifically. No accessibility (a11y) audit of any kind was found referenced anywhere in the documentation set. No cross-browser compatibility testing beyond Chromium-via-Playwright manual sessions is documented. |

---

## 16. Final Verdict

**NOT READY.**

None of the four more-permissive verdicts (internal testing / staging / limited beta / public launch) fit the evidence:

- It is not even **ready for staging**, because no staging environment, deployment configuration, or CI/CD exists to put it in one.
- It is not ready for **internal testing** in a "trust the numbers" sense either, given the still-unverified 21 August canvas-editor fix on a core feature, the completely untested admin panel, and three unresolved HIGH findings from a formal audit (PORTAL-003, FE-002, DB-003) sitting alongside a real, if latent, CASCADE-vs-PROTECT data-integrity landmine.
- The one module that IS complete (Users/Auth) is in genuinely good shape — two real security audits, substantially remediated, is meaningfully more diligence than most early-stage products receive. That module alone, in isolation, would support a much more permissive verdict.
- The in-progress module (Invoices/Clients) has undergone real, live-executed, adversarial-style auditing with real concurrency tests proving real fixes — this is not "tests pass, ship it" territory, it's closer to genuine engineering rigor. But that same module's own audit verdict was NOT READY five days before this pass, and the fixes since have addressed the CRITICAL/live-reproduced items specifically, not the full findings list.
- Seven of nine planned modules do not exist. This is expected at this stage of a build, not itself a defect — but it means "LanceraOS" as described in its own product pitch (a complete Pakistani-freelancer financial platform) is, today, two modules: authentication and invoicing.

**What would change this verdict, roughly in order of leverage:** a committed, reproducible deployment configuration; a CI pipeline gating merges on the existing 991+218 tests; Sentry actually wired up; the admin panel gaining any test coverage at all; the three open HIGH findings (PORTAL-003, FE-002, DB-003) closed or explicitly re-scoped; and the user confirming the 21 August canvas-drag fix actually works.

---

## 17. Recommended Order for Next Audits

1. **Design-editor SEV1 chain closure** (not really an "audit," a verification) — get the user to confirm the 21 Aug drag fix works, then do a real, repeatable interaction-level regression pass on the canvas editor specifically, since 4 bugs in 3 days in one feature is a pattern, not a coincidence. Cheapest to close, highest immediate user-facing value.
2. **Admin panel security + correctness audit** — zero test coverage today on the highest-privilege surface (grant/revoke admin, suspend, restore). Should happen before this module is ever exposed to a second real admin user.
3. **Deployment/infrastructure readiness audit** — establish what (if anything) actually runs in production today outside this repo, then build the missing Dockerfile/CI/staging/health-check/static-file story. Blocks every other "is this ready" question in a durable way.
4. **Deep financial-integrity re-audit of Invoices/Clients** — re-run something like the 19 Aug production audit's own methodology (live execution, real concurrent load, real data) specifically against PORTAL-003, FE-002, and DB-003, plus a sample of the 30-item MEDIUM/LOW backlog, to get a genuine "is Invoices/Clients actually ready" answer rather than a partial one.
5. **Observability/incident-response audit** — wire up Sentry for real, fix `request_id` Celery propagation, add WebSocket logging, and write down an actual incident-response runbook. Do this before, not after, the first real production incident.
6. **Authorization/tenancy hardening pass** — design and retrofit a shared ownership/tenant permission mechanism (`core/permissions.py` is currently empty) so cross-tenant safety stops depending entirely on every view author remembering to filter by `request.user`.
7. **Full API/application security review** — the deep pass this document's brief explicitly deferred; now that the inventory (§4) exists, a dedicated security review can move endpoint-by-endpoint rather than starting from zero.
8. **Backup/disaster-recovery policy definition** — currently a clean absence; needs to be designed, not just audited, since there is nothing yet to audit.
9. **Performance/load verification on the real production target** — specifically PERF-001's Linux/prefork behavior, and a first real load test of the WeasyPrint/Celery pipeline under concurrent invoice generation.
10. **Everything else** — the remaining 30-item MEDIUM/LOW backlog from the 19 Aug audit, accessibility, cross-browser compatibility, and the eventual builds of the 7 unbuilt modules, each of which will need its own audit when it exists.

---

## AUDIT RULE

No code was changed during this audit.

Every finding above with a file:line citation was independently verified against the actual code by direct inspection during this pass (not assumed from documentation). Findings sourced from prior audit documents are explicitly labeled as such and cross-referenced against `DECISIONS.md` and the current code state rather than trusted at face value — several (PORTAL-003, FE-002, DB-003, and two Security-Audit items) were found to be claimed-fixed nowhere in `DECISIONS.md` and were independently re-checked against the live code, where DB-003 and PORTAL-003 were reconfirmed still present.

If something discovered during this audit is obviously broken, it was documented here — with evidence, affected code location, impact, and a recommended next-audit phase — and was **not** fixed, changed, or worked around.
