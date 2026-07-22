# DECISIONS.md

Running log of architectural decisions. Format: Date / Decision / Reason / Alternatives considered.

---

Date: July 2026 (Users/Auth module build)
Decision: JWT stored in httpOnly cookies, not localStorage.
Reason: localStorage is readable by any JavaScript running on the page — a single XSS vulnerability
becomes an instant account-takeover vector. httpOnly cookies can't be read by JS at all, even under XSS.
Alternatives considered: v1's approach (Authorization header + localStorage) — rejected, this is exactly
the anti-pattern being replaced.

---

Date: July 2026
Decision: New first-class `Session` model (device name, IP, refresh-token hash, timestamps), not
stateless-JWT-only. Enforces a 3-concurrent-session cap (4th login evicts the least-recently-used).
Reason: Required for the `/sessions/` list/revoke UI and the max-3-sessions rule. A pure JWT approach
has no way to list or individually revoke "logged in devices."
Alternatives considered: None seriously — this was locked in from the start of the module design.

---

Date: July 2026
Decision: Facebook OAuth built for real this pass, hand-rolled (not django-allauth), matching Google's
pattern exactly — verify token, run the same account-linking logic in `oauth/base.py`.
Reason: v1's working Google flow was hand-rolled and already handles the account-linking collision cases
correctly; django-allauth (named in CLAUDE.md's original tech-stack line, which was aspirational, not
locked in) would mean re-deriving that same logic inside allauth's own hooks. Stubbing Facebook for later
would mean revisiting the login UI, collision logic, and UserSocialAccount model a second time for no reason.
Alternatives considered: django-allauth (rejected — see above); stub now, build later (rejected per Ali:
"do it when it is required," and deferred work here is strictly more total work, not less).

---

Date: July 2026
Decision: UUID primary keys on every model in `apps/users` and `core`.
Reason: CLAUDE.md rule 13 — prevents account/record enumeration on a financial application. v1 used
default auto-increment integers throughout.
Alternatives considered: None — this was a locked CLAUDE.md rule from before the module build started.

---

Date: July 2026
Decision: Argon2 password hashing (`PASSWORD_HASHERS` in settings.py), not PBKDF2 or bcrypt.
Reason: CLAUDE.md rule 7. v1 never explicitly set `PASSWORD_HASHERS`, so it silently used Django's
default PBKDF2.
Alternatives considered: None — locked CLAUDE.md rule.

---

Date: July 2026
Decision: CNIC, NTN, and PSEB registration number are all Fernet-encrypted at rest with a uniqueness
constraint enforced via a separate HMAC "blind index" (`*_hash` columns, `unique=True`), using a
dedicated `BLIND_INDEX_KEY` secret that is never the same as `ENCRYPTION_KEY`. Normalization strips all
non-digit characters before encrypting/hashing (dash formatting is frontend-display-only, never stored).
Reason: Fernet's randomized IV means the same plaintext encrypts differently each time, so encrypted
columns can never carry a uniqueness constraint directly. The blind index gives one-way, deterministic
lookup without ever storing plaintext. Uniqueness matters here specifically to prevent one account from
entering someone ELSE's real CNIC/NTN/PSEB and having LanceraOS generate official tax documents under
that identity — not to prevent multi-accounting (NTN/PSEB alone don't gate any LanceraOS feature).
Alternatives considered: No uniqueness at all (rejected for CNIC/NTN/PSEB — identity-theft risk via
generated documents); reusing ENCRYPTION_KEY for the blind index too (rejected — the two keys have
opposite security properties by design and must be rotatable independently).

---

Date: July 2026
Decision: Account deletion anonymizes the User row in place (`User.anonymize()`) rather than hard-deleting
it. Financial-record foreign keys to User will use `on_delete=PROTECT` (not CASCADE) as those modules
are built. The daily Celery task is `anonymize_expired_accounts`, not v1's `delete_expired_accounts`.
Reason: v1's hard delete cascaded through every related table, including future invoices/payments — wrong
for a product generating FBR tax documents, where financial records likely need to survive account
deletion in some form. CNIC/NTN/PSEB hashes are nulled (not emptied to `''`) during anonymization so the
values become available again for a fresh registration — including by the same person re-registering later.
Alternatives considered: v1's hard delete (rejected, described above).

---

Date: July 2026
Decision: A single shared `core.AuditLog` table replaces v1's three overlapping tables (`AccountEvent`,
`LoginEvent`, `RegistrationAttempt`). `event` is a free-form string, not a fixed choices list, since this
table will be written to by every future module, not just users.
Reason: Three tables doing almost the same job in v1 was duplication with no benefit; a fixed choices
list would mean editing `core/models.py` for every future module's event names.
Alternatives considered: Keep the three-table pattern per-app (rejected — exactly the duplication being fixed).

---

Date: July 2026
Decision: Cookie architecture: `app.lanceraos.com` (frontend) + `api.lanceraos.com` (backend) subdomain
split in production, `SameSite=Lax`, `COOKIE_DOMAIN=.lanceraos.com`. Local dev: no domain set (host-only
cookie), which is why `SameSite=Lax` works locally despite frontend/backend running on different ports.
Reason: Frontend and backend on genuinely different domains (e.g. Vercel's own domain + Railway's own
domain) would make the auth cookies cross-SITE, requiring `SameSite=None` — which modern browsers'
tracking-prevention features increasingly block regardless, especially in Safari. Sharing a registrable
domain via subdomains avoids this entirely.
Alternatives considered: Frontend/backend on unrelated domains with `SameSite=None; Secure` (rejected —
real risk of silent breakage for a meaningful slice of users in browsers with strict third-party-cookie policies).

---

Date: July 2026
Decision: Trusted-device token (2FA "don't ask again for 30 days") moved to an httpOnly cookie. v1 sent
this via request body / a custom header, implying frontend localStorage.
Reason: Consistency with the JWT cookie decision above — this is also a 30-day bearer secret and belongs
off any surface JavaScript can read.
Alternatives considered: Keep v1's body/header pattern (rejected — same anti-pattern being fixed for JWTs).

---

Date: July 2026
Decision: `change_password` (in-app, authenticated) keeps the CURRENT device's session alive and
revokes every OTHER session. `reset_password` (email-link flow) revokes ALL sessions, including the
one making the request.
Reason: An in-app change proves device identity by virtue of already being logged in; an email-link
reset does not — there's no session to treat as "trusted" in that flow.
Alternatives considered: Uniform behavior across both flows (rejected — the two flows have genuinely
different trust guarantees and shouldn't be handled identically).

---

Date: July 2026
Decision: `confirm_deletion` now actually revokes every session and clears cookies. v1's docstring
claimed this ("logs out immediately") but the code never touched sessions or tokens at all.
Reason: Bug fix, not a new decision exactly — but recorded here since it changes observable behavior
from what v1 shipped. Leaving active sessions running on an account mid-deletion doesn't match the
stated intent and has no upside.
Alternatives considered: Reproduce v1's actual (buggy) behavior for parity — rejected, a stated
security guarantee that silently didn't hold isn't worth preserving.

---

Date: July 2026
Decision: Removed dead code found while porting v1: `EmailChangeStep1TokenGenerator` /
`EmailChangeStep2TokenGenerator` in `tokens.py` (v1's real email-change flow hashes a raw token onto
`EmailChangeRequest` directly and never calls these), and the DRF scoped-throttle-rate entries in
`REST_FRAMEWORK['DEFAULT_THROTTLE_RATES']` (v1 declared `'login': '10/minute'` etc. but never attached
`throttle_scope` to any view, so they did nothing).
Reason: Config or code that looks load-bearing but isn't is worse than no config at all — it actively
misleads whoever reads it next.
Alternatives considered: Carry forward unchanged for fidelity to v1 (rejected — v1's own bugs aren't
a spec to preserve).

---

Date: July 2026
Decision: Django cache backend switched from v1's `LocMemCache` to Redis.
Reason: Every rate limit, 2FA session, and deletion-OTP session lives in the cache. LocMemCache is
per-process memory — under more than one Railway worker process, this state silently splits across
processes (e.g. a login rate-limited on worker A looks fresh on worker B). Invisible with one dev
process, real in production once scaled past a single worker.
Alternatives considered: Keep LocMemCache (rejected — the bug above); a separate cache-only Redis
instance (unnecessary — the already-provisioned Redis handles this fine).

---

Date: July 2026
Decision: `core/email.py` calls Resend's HTTP API directly (`requests.post`); Django's global
`EMAIL_BACKEND` is not configured to point at Resend's SMTP relay the way v1 did.
Reason: v1's approach technically worked but contradicts its own CLAUDE.md rule 3 ("never use Django's
email backend or SMTP directly") and isn't what the actual sending code does anyway. Django's SMTP
backend IS still used, deliberately, inside `views/smtp.py`'s `save_custom_smtp()` — but that's testing
a USER'S OWN mail server, a different operation from LanceraOS sending its own platform email.
Alternatives considered: v1's SMTP-relay approach (rejected, described above).

---

Date: July 2026
Decision: `django-celery-beat` pinned to `2.9.*`, not an earlier version.
Reason: Confirmed by actually installing from `requirements.txt` into a clean virtualenv:
`django-celery-beat==2.7.*` only supports Django `<5.2`, which conflicts directly with the Django 5.2
LTS pin CLAUDE.md specifies. `2.9.x` is the version actually confirmed compatible.
Alternatives considered: Downgrade Django to satisfy `django-celery-beat==2.7` (rejected — Django 5.2
LTS is the locked tech-stack decision, not up for renegotiation over a Celery add-on).