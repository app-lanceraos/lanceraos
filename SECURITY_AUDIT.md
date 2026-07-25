# LanceraOS Security Audit

**Scope:** Full codebase as of commit `8efd38a` (main). Only the **Users/Auth module** is built
(backend + frontend) per CLAUDE.md's status table — invoices, payments, tax, health, proposals,
contracts, subscriptions, and dashboard modules do not exist yet, so this audit covers `apps/users/`,
`core/`, `config/`, and `frontend/src/`.

No fixes have been applied. Everything below is a finding for your review.

---

## Critical

None found. No hardcoded secrets, no committed `.env`, no raw SQL, no `eval`/`exec`/`pickle` on
user input, no obviously broken auth boundary.

---

## High

### H1. `get_client_ip()` trusts a client-supplied `X-Forwarded-For` header, defeating every IP-based rate limit
**File:** [core/observability.py:24-28](core/observability.py#L24-L28)

```python
def get_client_ip(request):
    forwarded = request.META.get('HTTP_X_FORWARDED_FOR')
    if forwarded:
        return forwarded.split(',')[0].strip()
    return request.META.get('REMOTE_ADDR', '') or None
```

This value is the *sole* key for every IP-scoped throttle in the app:
- `login` — 20/hour ([apps/users/views/auth.py:263](apps/users/views/auth.py#L263))
- `register` — 10/hour ([apps/users/views/auth.py:132-140](apps/users/views/auth.py#L132-L140))
- `check_availability` — 60/min ([apps/users/views/auth.py:216-220](apps/users/views/auth.py#L216-L220))
- `forgot_password` — 5/hour ([apps/users/views/auth.py:633-637](apps/users/views/auth.py#L633-L637))

`X-Forwarded-For` is an ordinary HTTP request header — any client can set it to an arbitrary
value unless a trusted reverse proxy strips or overwrites it before the request reaches Django.
Nothing in `settings.py` configures `SECURE_PROXY_SSL_HEADER`-style trusted-proxy handling, and
there's no allowlist of proxy IPs. An attacker brute-forcing a login, spamming registrations, or
enumerating emails via `check_availability` can simply rotate this header per request
(`X-Forwarded-For: 1.2.3.4`, `2.3.4.5`, …) to get a fresh rate-limit bucket every time. It also
poisons `Session.ip_address`, `AuditLog.ip_address`, and the "new device login" email
([apps/users/views/auth.py:112-129](apps/users/views/auth.py#L112-L129)) — the audit trail this
platform relies on for incident investigation (per CLAUDE.md's Observability Rules) can be
forged by the client on every request.

**Why it matters here:** this is a financial platform whose account-lockout and rate-limiting
story is a documented compliance control (CLAUDE.md rule 12). If it's trivially bypassable, the
whole brute-force-protection narrative is theater, and the audit trail used to investigate
"why did this happen" is not trustworthy.

**Fix:** Only trust `X-Forwarded-For` when Railway (or whatever's in front of Django) is known to
overwrite/append rather than pass through client values, and then take the correct entry from the
chain (last entry closest to your proxy, or use `django-xff` / Django's own guidance). Simplest
safe fix given a single reverse proxy: use the last IP in the `X-Forwarded-For` chain (the one the
proxy itself appended), not `.split(',')[0]`, and document/verify that Railway's edge actually
appends rather than trusts client input.

---

### H2. Django admin login has none of the app's brute-force protections
**File:** [config/urls.py:10](config/urls.py#L10), [apps/users/managers.py](apps/users/managers.py), [apps/users/admin.py](apps/users/admin.py)

`/admin/` is wired up with stock `django.contrib.admin` and `DjangoUserAdmin`. Its login view
uses Django's built-in `AuthenticationForm` → `ModelBackend.authenticate()` → `user.check_password()`
directly — it never touches `User.increment_failed_attempts()`, `is_account_locked()`, or any
cache-based throttle. Those protections only exist inside the hand-written `apps/users/views/auth.py:login`
view. DRF's `DEFAULT_THROTTLE_CLASSES` (settings.py:198-205) don't apply either — that's DRF-only,
`/admin/` isn't a DRF view.

Net effect: an attacker can brute-force any staff/superuser's password against `/admin/login/`
indefinitely with no lockout, no rate limit, and no email alert — the exact protections CLAUDE.md
rule 12 mandates are absent for the one login path that grants the most privilege (Django admin
gives a staff account visibility into every user row, including `Session`/`TrustedDevice`/
`EmailChangeRequest` tables, IPs, and device history for every user).

**Fix:** Put `/admin/` behind the same login-rate-limit cache check (or a small middleware keyed
on `get_client_ip` + path, once H1 is fixed), require 2FA for staff accounts, and/or move it off
the guessable `/admin/` path in production. At minimum, add `django-axes` or an equivalent
lockout mechanism scoped to the admin login view specifically.

---

### H3. Custom SMTP password test failure returns raw exception text to the client
**File:** [apps/users/views/smtp.py:83-84](apps/users/views/smtp.py#L83-L84)

```python
except Exception as exc:
    return Response({'error': f'SMTP connection failed: {exc}'}, status=status.HTTP_400_BAD_REQUEST)
```

`str(exc)` on an `smtplib`/`socket` exception can include internal detail beyond what's needed for
the user to fix their own settings (resolved IPs, full traceback-adjacent text for some exception
types, library-internal messages). It's scoped to the user's *own* mail server so the blast radius
is limited, but it's still unfiltered exception text reaching an HTTP response body, which
CLAUDE.md's security baseline explicitly calls out ("verbose stack traces or internal exception
details ever returned in an API response" is one of the audit's own checklist items). Reclassified
from the general "stack trace" item to High because it's the one place in the codebase where this
actually happens on a reachable, unauthenticated-adjacent-content path (any logged-in free-tier
user can trigger arbitrary outbound SMTP connection attempts to attacker-controlled hosts/ports via
this endpoint — see M6 below).

**Fix:** Catch specific `smtplib`/`socket`/`ssl` exception types and return a small set of safe,
templated messages ("Connection refused", "Authentication failed", "Timed out"), logging the full
exception server-side via `logging.getLogger(__name__)` instead.

---

## Medium

### M1. CSRF protection is bypassed entirely for `NO_AUTH` endpoints — relies solely on `SameSite=Lax`
**Files:** [apps/users/authentication.py](apps/users/authentication.py), [apps/users/views/auth.py:59](apps/users/views/auth.py#L59)

`CookieJWTAuthentication.enforce_csrf()` is the *only* CSRF check in the codebase (DRF's
`api_view` marks every view `csrf_exempt`, so Django's `CsrfViewMiddleware` never runs on any of
these views — this is explicitly documented in the file's own docstring). That check only fires
from inside `CookieJWTAuthentication.authenticate()`. Every view decorated with
`@authentication_classes(NO_AUTH)` — `login`, `refresh`, `register`, `verify_2fa`, `resend_2fa`,
`google_login`, `facebook_login`, `forgot_password`, `reset_password`, `verify_email`,
`resend_verification`, and the three email-change link endpoints — never instantiates
`CookieJWTAuthentication` at all, so `enforce_csrf()` never runs for them. CSRF protection on
these endpoints today is provided *entirely* by the `SameSite=Lax` attribute on the refresh/access
cookies (settings.py:170, cookies.py:26-36), not by an actual token check.

This happens to be safe right now (Lax blocks the cookie on cross-site `fetch`/form POSTs from a
third-party origin), but:
- It contradicts the code's own stated invariant ("every mutating endpoint enforces CSRF via
  `enforce_csrf`") and CLAUDE.md rule 14 ("CSRF protection is mandatory").
- `/api/auth/token/refresh/` — which rotates the session and issues new tokens — is one of the
  endpoints with zero explicit CSRF check. If `COOKIE_SAMESITE` is ever relaxed to `None` for a
  legitimate future reason (a third-party embed, a payment redirect flow), this whole class of
  endpoint loses CSRF protection silently, with no test or code path to catch the regression.

**Fix:** Call `CSRFCheck` (the same mechanism `enforce_csrf` already wraps) unconditionally in
these views too, independent of whether a valid JWT cookie is present — or factor it into a
small decorator/mixin so "NO_AUTH but still CSRF-checked" is an explicit, named state rather than
an accidental side effect of disabling authentication.

---

### M2. Non-constant-time comparison of email-change tokens
**File:** [apps/users/views/security.py:232, 253, 319](apps/users/views/security.py#L232)

```python
if ecr.step1_token != token_hash:
if ecr.step1_token != token_hash or not ecr.is_step1_valid():
if ecr.step2_token != token_hash or not ecr.is_step2_valid():
```

These compare SHA-256 hex digests of the URL-supplied token against the stored hash using Python's
`!=`, which short-circuits on the first differing byte — a textbook timing side-channel. The
practical exploitability over a network is low (SHA-256 hex comparison, small timing deltas, needs
huge sample sizes), but the audit explicitly calls this out, the values being compared genuinely
gate account takeover of the email-change flow, and the fix is trivial.

**Fix:** `hmac.compare_digest(ecr.step1_token, token_hash)` (and same for step2). Note
`deletion.py`'s OTP check already does this correctly via `django.contrib.auth.hashers.check_password`,
and `authentication.py`'s JWT signature verification is handled by `simplejwt`/PyJWT internally
with constant-time comparison — this file's three raw `!=` comparisons are the only outliers.

---

### M3. SVG accepted as a valid logo upload — stored XSS via directly-opened file URL
**File:** [apps/users/views/profile.py:17](apps/users/views/profile.py#L17)

```python
ALLOWED_LOGO_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tiff', '.svg'}
```

Validation is extension-only (`os.path.splitext`), with no magic-byte/content check — this is
also a direct match for the audit's own file-upload checklist item. SVG is the one format on this
list that isn't a passive bitmap: it can embed `<script>` tags. Cloudinary serves the file back as
`image/svg+xml` at `logo_public_id`'s `secure_url`. The frontend only ever renders this via
`<img src=...>` (confirmed — no `dangerouslySetInnerHTML` anywhere in `frontend/src`), which does
not execute embedded scripts, so today's in-app blast radius is contained. But:
- Anyone who opens that Cloudinary URL directly in a browser tab (not through the app — e.g. a
  future "view business logo" link sent to a client on an invoice, once the Invoices module ships)
  gets the SVG rendered as a top-level document, and any embedded script executes in Cloudinary's
  origin.
- A non-SVG file whose *content* doesn't match its extension (e.g., an HTML file renamed to
  `.jpg`) is also accepted today, since only the extension is checked.

**Why it matters here:** logos get shown to clients — real people outside the LanceraOS account —
in future invoice/proposal/contract modules that CLAUDE.md already specs out. Fixing this now, while
the only consumer is the single-file upload endpoint, is far cheaper than after client-facing
documents depend on it.

**Fix:** Verify actual file content (`Pillow`'s `Image.open().verify()`, or check magic bytes)
before upload; either drop SVG from the allowed set or sanitize it (strip `<script>`/event-handler
attributes) server-side before forwarding to Cloudinary.

---

### M4. Account-existence side channel in the login-lockout warning message
**File:** [apps/users/views/auth.py:303-325](apps/users/views/auth.py#L303-L325)

A nonexistent email/username always gets the flat `'Invalid credentials...'` message
(auth.py:274-279). A wrong password against a *real* account gets the same flat message for the
first couple of attempts, but once `attempts_remaining <= 2` it switches to
`'Warning: {n} attempt(s) remaining before lockout.'` (auth.py:316-321). An attacker who submits
3+ wrong passwords against a candidate email and starts seeing the "attempts remaining" warning
has confirmed the account exists — a nonexistent account never produces that branch. Every other
endpoint in this file (`resend_verification`, `forgot_password`) is deliberately silent on this;
this one path leaks it as a side effect of the lockout-warning UX.

**Fix:** Either show the same generic message for both cases even near lockout (drop the count),
or accept this as a deliberate, documented tradeoff (the UX value of warning a real user before
lockout) — but it should be a conscious decision, not a byproduct.

---

### M5. `save_custom_smtp` lets any authenticated user make the server open outbound connections to arbitrary host:port (SSRF-adjacent)
**File:** [apps/users/views/smtp.py:63-68](apps/users/views/smtp.py#L63-L68)

```python
conn = get_connection(
    backend='django.core.mail.backends.smtp.EmailBackend',
    host=host, port=port, username=username, password=password,
    use_tls=use_tls, use_ssl=use_ssl, fail_silently=False, timeout=15,
)
```

`host`/`port` are user-supplied with no restriction beyond "valid port number" (smtp.py:51-56).
This is a documented, intentional feature (test the user's own mail server) — not a bug on its
own — but it does mean any authenticated free-tier user can make the Django server initiate a raw
TCP connection to any host:port they choose (including internal/private IP ranges — Railway's
internal network, `169.254.169.254` metadata endpoints, etc.), timing the response via the 15s
timeout and the differentiated error message from H3. This is the classic SSRF-via-"test
connection" pattern.

**Fix:** Block requests to private/link-local/loopback IP ranges (resolve `host` first, reject
RFC1918/loopback/link-local targets) before calling `get_connection`, the same way you'd guard any
other user-supplied-URL fetch.

---

### M6. Same-key rendering of raw exception detail on `upload_logo`'s Cloudinary failure
**File:** [apps/users/views/profile.py:124-125](apps/users/views/profile.py#L124-L125)

```python
except Exception as exc:
    return Response({'error': f'Upload failed: {exc}'}, status=status.HTTP_502_BAD_GATEWAY)
```

Same pattern as H3 but against Cloudinary's own SDK exceptions rather than a user-supplied SMTP
host — lower severity since there's no attacker-controlled target driving the exception content,
but it's still unfiltered exception text in a response body.

**Fix:** Log `exc` server-side, return a generic `'Upload failed. Please try again.'` to the
client.

---

## Low

### L1. `pip-audit` findings against `requirements.txt`
Ran `pip-audit -r requirements.txt`. Findings (informational — none of these are exploitable via
the code as currently written, since `daphne`/`channels` have no consumers yet and `pyopenssl`/
`twisted` aren't reached by any app code path, but they're real CVEs against installed versions):

| Package | Installed | Vulnerability | Fix version |
|---|---|---|---|
| `djangorestframework-simplejwt` | 5.3.1 | CVE-2024-22513 — disabled users can still use existing tokens (missing `is_active` re-check in `for_user`) | 5.5.1 |
| `daphne` | 4.1.2 | CVE-2026-44546 — header-injection parser differential; CVE-2026-44545 — unbounded WebSocket frame size (DoS) | 4.2.2 |
| `cryptography` | 43.0.3 | Multiple: CVE-2026-34073 (name-constraint bypass), CVE-2026-26007 (missing curve-point validation), CVE-2024-12797 / GHSA-537c (bundled OpenSSL CVEs) | 46.0.6 |
| `requests` | 2.32.5 | CVE-2026-25645 — predictable temp filename in `extract_zipped_paths()` (not called anywhere in this codebase) | 2.33.0 |
| `pyopenssl` | 25.1.0 (transitive, via `twisted`) | CVE-2026-27459, CVE-2026-27448 | 26.0.0 |
| `twisted` | 25.5.0 (transitive, via `daphne`) | CVE-2026-42304 — DNS decompression DoS in `twisted.names` (not used — no DNS server here) | 26.4.0 |

**Most relevant to actually fix:** `djangorestframework-simplejwt` — the CVE (a disabled user
retaining API access via an already-issued token) directly touches this app's `is_active` /
account-lockout story. `daphne` next, since Channels/WebSockets are wired into `ASGI_APPLICATION`
even with no consumers yet, and will matter once real-time features (client messaging, per
CLAUDE.md's invoices module) land.

### L2. `npm audit` findings against `frontend/package.json`
| Package | Severity | Issue | Fix |
|---|---|---|---|
| `react-router` / `react-router-dom` | High | GHSA-qwww-vcr4-c8h2 — CSRF bypass in RSC mode allows action execution before the expected 400 response | Requires downgrade to `7.11.0` (SemVer-major relative to current `^7.13.1`) per `npm audit`'s own fix suggestion — the app doesn't use RSC mode today, so exposure is likely nil, but confirm before deciding whether to hold or downgrade. |

### L3. CNIC/NTN/PSEB are decrypted and returned in plaintext on every `GET /api/auth/profile/`
**File:** [apps/users/serializers.py:302-309](apps/users/serializers.py#L302-L309)

This is almost certainly the *intended* decrypt path (the user needs to see their own tax ID to
edit it on the Settings > Tax & PSEB page) rather than a bug — the model correctly never exposes
`*_encrypted`/`*_hash` (serializers.py:294-297), and `core.middleware`'s redaction only ever needs
to cover *request* bodies since response bodies aren't logged below 500 (core/middleware.py:76-77,
core/observability.py:78-85 already includes `cnic`/`ntn`/`pseb` in `SENSITIVE_KEYS` for the
request side). Flagging as a hardening suggestion, not a defect: for a field that identifies a
real government ID, consider masking most of the digits by default (e.g. `12345-•••••••-1`) with
an explicit "reveal" action on the frontend, so the full value isn't sitting in page memory /
React DevTools / a screen-share by default every time Settings loads.

### L4. `.env.example` ships `DEBUG=True`
**File:** [.env.example:10](.env.example#L10)

Harmless as written — `settings.py:20` defaults `DEBUG` to `False` if the env var is absent
entirely, so a *missing* `.env` fails safe. But `.env.example` is the template someone copies to
create a real `.env`, and the example value being `True` means a rushed production setup that
copies `.env.example` verbatim and only fills in secrets would deploy with `DEBUG=True`. Low
severity since `SECRET_KEY`/`DB_PASSWORD` etc. are blank in the example and would need to be
filled in anyway (forcing a deliberate edit pass), but worth flipping the example default to
`False` with a comment ("set True only for local dev") so the safe path is also the path of least
resistance.

---

## What's already solid (confirmed, not a finding — noted so it isn't re-litigated)

- No `.env` ever committed to git history; `.gitignore` correctly excludes it.
- `SECRET_KEY` is read from env, length-validated (≥50 chars) at startup, never has a hardcoded fallback.
- `DEBUG` defaults to `False`; production security headers (`SECURE_HSTS_*`, `X_FRAME_OPTIONS`, etc.) are gated on `not DEBUG`.
- `ALLOWED_HOSTS`, `CORS_ALLOWED_ORIGINS`, `CSRF_TRUSTED_ORIGINS` all come from env with safe localhost-only defaults — no `*` anywhere.
- JWTs live exclusively in httpOnly cookies; the raw access/refresh strings are never put in a JSON response body or read from a header/request body anywhere in the codebase (`_finalize_login_response` explicitly documents this).
- Argon2 is first in `PASSWORD_HASHERS`, so it's the hasher actually used for new passwords, not just imported.
- Session revocation (`revoke_session`), deletion endpoints, and email-change endpoints are all correctly scoped to `request.user` in their DB lookups — no IDOR found (session-by-id returns 404, not 403, for another user's session, so existence isn't confirmed either).
- OTP/deletion-token/2FA-session comparisons correctly go through `django.contrib.auth.hashers.check_password`, which is constant-time.
- No raw SQL, `eval`, `exec`, or `pickle.loads` anywhere in `apps/`, `core/`, or `config/`.
- No `dangerouslySetInnerHTML` anywhere in the frontend; the one `innerHTML` usage (`AuthLayout.jsx:49`) only clears a container, never injects content.
- `VITE_GOOGLE_CLIENT_ID` / `VITE_FACEBOOK_APP_ID` are public client IDs by design — no client *secret* is ever shipped to the frontend bundle.
- The one client-side gate found (`PrivateRoute.jsx`'s onboarding redirect) is pure UX — age/onboarding validation is independently and correctly re-enforced server-side in both `RegisterSerializer` and `OnboardingSerializer`.
- Custom SMTP passwords, Fernet-encrypted fields, and password hashes are all excluded from every serializer that could return them.

---

## Prioritized action list

1. **H1** — Stop trusting client-supplied `X-Forwarded-For` unconditionally; fix `get_client_ip()`. This undermines almost every other rate-limit/audit-trail control in the app, so it's the highest-leverage fix.
2. **H2** — Add brute-force protection to `/admin/` (rate limit or `django-axes`), since it's currently the least-protected path to the most privileged access.
3. **H3 / M5 / M6** — Harden `save_custom_smtp` and `upload_logo`: block private/internal targets, stop echoing raw exception text.
4. **M1** — Decide deliberately whether `NO_AUTH` endpoints should get an explicit CSRF check independent of `SameSite`, and implement it (cheap, closes a "silently regresses if `COOKIE_SAMESITE` ever changes" gap).
5. **M2** — Swap the three `!=` token comparisons in `security.py` for `hmac.compare_digest` (small, mechanical fix).
6. **M3** — Add real content validation to logo upload; decide whether to keep allowing SVG.
7. **L1** — Bump `djangorestframework-simplejwt` to 5.5.1 at minimum (directly relevant CVE); schedule `daphne`/`cryptography` bumps before the Channels/WebSocket-dependent modules ship.
8. **L2 / M4 / L3 / L4** — Low-cost cleanups: confirm `react-router-dom` RSC exposure, decide on the login-warning enumeration tradeoff, consider CNIC/NTN masking on the frontend, flip the `.env.example` `DEBUG` default.
