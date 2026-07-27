# DATABASE.md — LanceraOS v2 Schema Reference

**A note on this document's history**: the original `DATABASE.md` was lost — a filename mixup
(the same class of issue that briefly affected `apps/users/models.py`/`apps/users/urls.py`
earlier in this project) meant an older copy of `CLAUDE.md` ended up saved under this filename
instead, both locally and in the uploaded project files, and the real document wasn't recoverable
from anywhere in this conversation. This is a **reconstruction**, built directly from the actual,
current model files (`apps/users/models.py`, `core/models.py`) — accurate to what's really in the
database today, but not a recovery of whatever reasoning or phrasing the original document used.
Treat this as the new authoritative version going forward.

Per `CLAUDE.md`'s Database Design Rules: every table below answers the same 6 questions —
**Mutable? Soft deleted? Audit trail? Indexed? Encrypted? Cascade behavior?** — plus its schema
and the reasoning behind real design choices.

---

## `users` (`User`)

Django's `AbstractUser`, extended. Email-first (`USERNAME_FIELD = 'email'`), UUID primary key
(prevents account enumeration via sequential IDs on a financial application).

**Schema** (fields beyond what `AbstractUser` already provides):
```
id                          UUIDField, primary key
email                        EmailField, unique
is_email_verified            BooleanField, default False
date_of_birth                 DateField, nullable

two_fa_enabled                BooleanField, default False
two_fa_code                    CharField(6), blank
two_fa_code_expiry              DateTimeField, nullable

failed_login_attempts           IntegerField, default 0
account_locked_until              DateTimeField, nullable
last_login_ip                      GenericIPAddressField, nullable  (display-only — see below)
last_login_device                    CharField(300), blank            (display-only — see below)

pending_email                          EmailField, blank
pending_email_expires_at                 DateTimeField, nullable

password_history                          JSONField (list), default []
password_changed_at                         DateTimeField, nullable

is_deleted                                    BooleanField, default False
deleted_at                                      DateTimeField, nullable
deletion_requested_at                             DateTimeField, nullable
deletion_scheduled_at                               DateTimeField, nullable
anonymized_at                                         DateTimeField, nullable
```

1. **Mutable?** Yes — this is a live account record, updated throughout its life (login
   timestamps, 2FA state, lockout counters, etc.).
2. **Soft deleted?** Yes, and specifically **anonymized in place, never hard-deleted**. Future
   modules' financial records (invoices, payments) will hold a `PROTECT` FK to `User`, so the row
   must continue to exist even after the person is long gone — `anonymize()` (below) strips PII
   instead of removing the row.
3. **Audit trail?** Indirectly — individual security-relevant actions (login, password change, 2FA
   toggle, etc.) are logged to `AuditLog` by the views that perform them, not by the model itself.
4. **Indexed?** `email`, `username`, `is_email_verified`, `is_deleted`, `deletion_scheduled_at` —
   the last two specifically because the daily anonymization sweep filters on them.
5. **Encrypted?** No PII on this model itself is encrypted (CNIC/NTN/PSEB live on
   `FreelancerProfile` instead, where the actual tax-identity data is). Passwords use Django's
   standard Argon2 hashing (not "encryption" in the reversible sense).
6. **Cascade behavior?** `Session`, `TrustedDevice`, and `UserSocialAccount` all `CASCADE` from
   `User` — pure auth artifacts with no independent value once the account is gone.
   `FreelancerProfile` is a `OneToOneField` from its own side, also `CASCADE`.

**`last_login_ip`/`last_login_device` — important nuance**: these fields exist and are still
updated on every login, but they are **not** what decides whether a login email fires anymore.
That decision now runs through `TrustedDevice` (see below) — these two fields are legacy/display
metadata only. See `DECISIONS.md` for the bug this distinction was introduced to fix.

**Key methods**: `is_account_locked()`, `increment_failed_attempts()` (tiered lockout — 5 attempts
→ 15min, 11 → 60min, 16+ → 24h), `is_oauth_only()`, `anonymize()` (strips all PII on both `User`
and its linked `FreelancerProfile`, sets `is_active=False`, deletes all `Session`/`TrustedDevice`/
`UserSocialAccount` rows for the account).

---

## `freelancer_profiles` (`FreelancerProfile`)

One-to-one with `User`. Everything that isn't core authentication state lives here: business
details, tax identity, payment methods, notification preferences, custom SMTP config, onboarding
data.

**Schema** (grouped by purpose):
```
id, user (OneToOne, CASCADE)

# Identity
display_name, phone

# Tax identity — Fernet-encrypted value + separate HMAC blind-index column each
cnic_encrypted, cnic_hash (unique, nullable)
ntn_encrypted, ntn_hash (unique, nullable)
pseb_registered (plain bool — see note below), pseb_encrypted, pseb_hash (unique, nullable)

# Business
logo, logo_public_id, business_name, address_line1/2, city, country,
default_currency, default_payment_terms

# Payment methods
bank_name, bank_account_number, jazzcash_number, easypaisa_number,
payoneer_email, wise_profile_id, wise_access_token, wise_refresh_token

# Onboarding (collected once, editable afterward via Settings > Business)
onboarding_completed, profession, income_source, platform_used

# Preferences
language, timezone, default_send_method

# Custom SMTP (Pro feature)
custom_smtp_enabled, custom_smtp_host, custom_smtp_port, custom_smtp_username,
custom_smtp_password (encrypted), custom_smtp_use_tls, custom_smtp_use_ssl,
custom_smtp_from_name, custom_smtp_verified, custom_smtp_verified_at

# Notification toggles — Security Alerts has NO field here; deliberately
# not exposed, since it can never be disabled
notif_invoice_events, notif_client_messages, notif_payments

# Future-module fields already present
client_onboarding_enabled, client_onboarding_message, income_type

last_email_changed_at, created_at, updated_at
```

1. **Mutable?** Yes — this is a live profile record, edited via Settings.
2. **Soft deleted?** N/A — deleted alongside `User` via `anonymize()`, never independently.
3. **Audit trail?** No dedicated audit rows for profile edits themselves — the security-relevant
   subset (email change, deletion, 2FA, SMTP save) each get their own `AuditLog` event from the
   view that handles them.
4. **Indexed?** None beyond the implicit `OneToOne` index on `user` — no field here is currently
   queried across users at scale (this changes once modules that filter by business attributes
   exist).
5. **Encrypted?** Yes — `cnic_encrypted`/`ntn_encrypted`/`pseb_encrypted` (Fernet, reversible,
   decrypted only via the `cnic`/`ntn`/`pseb` properties), `custom_smtp_password` (Fernet). The
   `*_hash` columns are **not** the encrypted value — they're a separate HMAC blind index,
   specifically so uniqueness can be enforced across accounts (Fernet's randomized IV makes
   uniqueness checks on the encrypted value itself impossible) without ever storing plaintext.
6. **Cascade behavior?** `CASCADE` from `User` (one-to-one) — no independent lifecycle.

**Known, deliberate schema quirk**: `pseb_registered` is a plain boolean, entirely decoupled from
`pseb_hash`/`pseb_encrypted` — a user can self-declare "I am PSEB registered" via a Settings
checkbox without ever having a real, validated PSEB number on file. This was flagged during a
security audit as something to close before the Tax module trusts it for a real SRO 586
eligibility determination — that module should derive PSEB status from `bool(pseb_hash)`, not
this flag alone. Not fixed yet; intentionally left as a forward note.

**Key methods**: `set_cnic()`/`set_ntn()`/`set_pseb()` (validate, check cross-account uniqueness,
encrypt — never assign the encrypted/hash fields directly), `can_change_email()` (90-day
cooldown), `completion_percentage` (property, drives the Profile page's completion bar).

---

## `sessions` (`Session`)

One row per active login (refresh token), capped at 3 concurrent per user.

**Schema**:
```
id, user (FK, CASCADE)
refresh_token_hash          CharField(64), unique  — SHA-256 of the refresh token, never the token itself
device_name                  CharField(300), blank  — normalized UA string, e.g. "Chrome on Windows"
trusted_device                 FK to TrustedDevice, nullable, SET_NULL
ip_address                       GenericIPAddressField, nullable
created_at, last_used_at, expires_at
```

1. **Mutable?** Yes — refreshing rotates `refresh_token_hash`/`last_used_at`/`expires_at` on the
   **same row**, deliberately (otherwise "3 sessions max" would silently mean "3 refreshes since
   login," not 3 actual devices).
2. **Soft deleted?** No — hard-deleted on logout, revocation, or expiry. No business/legal
   significance to preserving a dead session row.
3. **Audit trail?** Yes — session creation, revocation (`session_revoked`), and rotation-relevant
   events are logged via `log_event()` from the views that trigger them.
4. **Indexed?** `(user, last_used_at)` (the eviction-of-oldest query), `refresh_token_hash`
   (lookup on every authenticated request), `expires_at` (the daily cleanup sweep).
5. **Encrypted?** No — only a SHA-256 hash of the token is stored, never the raw value. No HMAC
   secret needed here (unlike CNIC/NTN/PSEB) since a JWT refresh token already carries its own
   entropy from signing — there's nothing a dictionary attack could exploit the way it could
   against a low-entropy tax ID.
6. **Cascade behavior?** `CASCADE` from `User`. `SET_NULL` from `TrustedDevice` — if the linked
   device record is ever removed, the session itself should still be valid, just without a
   nickname/recognition link.

**`trusted_device` — new field, added for the device-nickname feature**: links a session to the
`TrustedDevice` row (if any) recognized during that login, so a custom nickname persists across
that device's *future* sessions rather than needing to be re-set every time. One known, inherent
consequence: a device's very first-ever session is never retroactively linked, since the matching
`TrustedDevice` row is created moments *after* the `Session` row during login — only the second
login onward produces a renameable session. Not a bug; a consequence of the call order this was
built with. See `DECISIONS.md`.

Concurrency: `create_for_user()` locks the user row (`select_for_update()`) for the duration of
the check-evict-create sequence — without this, concurrent logins could both read the same
under-cap session count and race past the 3-session limit (a real bug that was found and fixed;
see `DECISIONS.md`).

---

## `user_social_accounts` (`UserSocialAccount`)

Links a `User` to a Google or Facebook identity.

**Schema**:
```
id, user (FK, CASCADE)
provider          CharField, choices ('google', 'facebook')
provider_uid      CharField(200)
created_at
```

1. **Mutable?** No — effectively append-only. A link is created once at OAuth signup/first-link
   and never edited.
2. **Soft deleted?** No — hard-deleted alongside the user via `anonymize()`. No independent
   significance once the account is gone.
3. **Audit trail?** Login events via this provider are logged (`login_google`/`login_facebook`),
   not the linking itself as a separate event.
4. **Indexed?** Implicit unique index on `(provider, provider_uid)` — this is what makes
   "does this Google/Facebook identity already have an account" a fast, safe lookup.
5. **Encrypted?** No — `provider_uid` is an opaque ID from Google/Facebook, not a secret.
6. **Cascade behavior?** `CASCADE` from `User`.

---

## `trusted_devices` (`TrustedDevice`)

Recognizes a browser across logins — created/updated on **every** successful login (regular, 2FA,
and OAuth) as of the trusted-device rework, not only when a user explicitly opts into it.

**Schema**:
```
id, user (FK, CASCADE)
token_hash        CharField(64), unique  — SHA-256 of a random token in an httpOnly cookie
device_name       CharField(300), blank  — system-generated label, e.g. "Chrome on Windows"
custom_name       CharField(100), blank  — user-editable nickname, shown instead of device_name when set
skip_2fa          BooleanField, default False  — see note below
ip_address        GenericIPAddressField, nullable
created_at, expires_at, last_used_at
```

1. **Mutable?** Yes — `last_used_at`/`expires_at` extend on every match (a **sliding** 30-day
   window from last use, not fixed from creation), and `custom_name`/`skip_2fa` are user/flow
   editable.
2. **Soft deleted?** No — hard-deleted on expiry (weekly cleanup sweep) or when 2FA is fully
   disabled cancels the *skip_2fa* grant specifically (see below), not the row.
3. **Audit trail?** Indirectly — `new_device_login` (when a device is genuinely new) and
   `trusted_device_added` (when "don't ask again" is checked) are both logged.
4. **Indexed?** `token_hash` — the lookup that happens on every login.
5. **Encrypted?** No — same reasoning as `Session.refresh_token_hash`: a hash of a
   high-entropy random cookie token, no HMAC/dictionary-attack concern.
6. **Cascade behavior?** `CASCADE` from `User`. `SET_NULL` onto `Session.trusted_device` (a
   `Session` outlives a deleted `TrustedDevice`, just loses its nickname link).

**The `skip_2fa` distinction — this is the important design point on this table**: device
*recognition* (does this browser get a "new device" email) is now automatic and universal, for
every login. Whether a recognized device may *also* skip the 2FA prompt entirely remains a
separate, explicit opt-in (the "don't ask again on this device" checkbox at 2FA-verify time).
These used to be the same concept (this table originally existed only to serve 2FA-skipping); they
were deliberately split so that disabling 2FA (`toggle_2fa`'s disable branch) only needs to revoke
`skip_2fa` (`user.trusted_devices.update(skip_2fa=False)`) rather than deleting every recognized
device outright — the earlier behavior, deleting all rows, would have caused a burst of incorrect
"new device" emails for already-known devices the next time each logged back in. See
`DECISIONS.md` for the full history of this table's evolution.

---

## `email_change_requests` (`EmailChangeRequest`)

Backs the two-step (current-inbox confirmation → new-inbox confirmation) email-change flow.

**Schema**:
```
id, user (FK, CASCADE)
new_email                                  EmailField, blank
step1_token, step2_token                   CharField(128) each
step                                       CharField, choices (step1_pending / step1_clicked /
                                             step2_pending / completed / cancelled / expired)
step1_expires_at, step2_expires_at         DateTimeField (step2 nullable until step1 completes)
created_at, completed_at
```

1. **Mutable?** Yes — `step` advances through the flow on the same row.
2. **Soft deleted?** No — no long-term retention value once completed/cancelled/expired; not
   currently cleaned up automatically (worth a cleanup task if these accumulate).
3. **Audit trail?** Yes — `email_change_requested`, `email_change_step1`, `email_change_done`,
   `email_change_cancelled` are all logged.
4. **Indexed?** `(user, step)`, `step1_token`, `step2_token` — all three are lookup paths (the
   two tokens from email links, the combination for "does this user have a pending request").
5. **Encrypted?** No — tokens are compared via `hmac.compare_digest` (constant-time, fixed after a
   security audit found the original `!=` comparisons were a timing side-channel), but the tokens
   themselves aren't secrets requiring encryption at rest the way CNIC/NTN/PSEB are — they're
   single-use, short-lived, and their value is in being unguessable, not undisclosed.
6. **Cascade behavior?** `CASCADE` from `User`.

---

## `audit_log` (`AuditLog`, in `core`)

Shared across every module — not `apps.users`-specific. Immutable, append-only by design: "this
table needs to say what the system believed was true *at the time*, never edited afterward."

**Schema**:
```
id                UUIDField, primary key
user              FK to User, nullable, SET_NULL  — the account the event is ABOUT
actor             FK to User, nullable, SET_NULL  — who PERFORMED the action, only populated
                                                       when different from `user` (admin actions)
event             CharField(60)  — free-form, not a fixed choices list, deliberately
request_id        CharField(36), nullable
ip_address        GenericIPAddressField, nullable
user_agent        CharField(500), blank
metadata          JSONField, default dict
created_at
```

1. **Mutable?** No — never updated after creation. This is the one hard rule on this table.
2. **Soft deleted?** No deletion at all under normal operation.
3. **Audit trail?** This *is* the audit trail for the whole application.
4. **Indexed?** `(user, created_at)`, `(event, created_at)`, `(ip_address, created_at)`,
   `(actor, created_at)`, `request_id`.
5. **Encrypted?** No — `metadata` should never contain raw secrets; sensitive request fields are
   redacted before logging (`core.observability.redact_sensitive_fields`).
6. **Cascade behavior?** `SET_NULL` on both `user` and `actor` — the log entry survives even if
   the account it describes (or the admin who performed the action) is later deleted.

**`actor` — added for the admin-panel foundation**: every existing call site (self-service events)
leaves this `null`, since the actor and the subject are already the same person captured in
`user`. Only admin-initiated actions on someone else's account populate it, making "show me
everything this admin has done" a real, indexed query rather than something buried in `metadata`.

**`event` is deliberately free-form, not an enum**: a fixed choices list here would mean editing
`core/models.py` for every future module's events, or every module reinventing its own event log —
exactly the duplication this table exists to avoid. Each app documents its own event-name
constants near its own `log_event()` call sites instead.

---

## `api_request_logs` (`ApiRequestLog`, in `core`)

One row per HTTP request, written by `core.middleware`. A developer debugging tool, distinct from
`AuditLog` — deliberately kept out of the notification/admin-facing UI.

**Schema**:
```
id, request_id (unique)
user               FK, nullable, SET_NULL
method, path, status_code
ip_address, user_agent
request_body       JSONField, nullable  — sensitive fields redacted before storage
response_body      JSONField, nullable  — only populated when status_code >= 500
duration_ms
created_at
```

1. **Mutable?** No — append-only, one row per request.
2. **Soft deleted?** No — not currently cleaned up automatically; worth a retention policy once
   volume matters.
3. **Audit trail?** This is the *technical* trail (what happened at the HTTP level), distinct from
   `AuditLog`'s *security-event* trail.
4. **Indexed?** `(user, created_at)`, `(status_code, created_at)`, `created_at`.
5. **Encrypted?** No — but request bodies are redacted for sensitive fields before storage; full
   response bodies are only ever captured on 5xx errors specifically (logging every response body
   at scale is mostly noise and mostly PII).
6. **Cascade behavior?** `SET_NULL` on `user`.

---

## `notification_reads` (`NotificationRead`, in `core`)

Per-user, per-notification UI state (read/dismissed) for the notification bell — deliberately kept
off `AuditLog` itself, which must stay immutable.

**Schema**:
```
id, user (FK, CASCADE)
audit_log         FK to AuditLog, CASCADE
read_at           DateTimeField, auto_now_add
dismissed_at      DateTimeField, nullable
```
`unique_together = [['user', 'audit_log']]` — one row per user per notification.

1. **Mutable?** Yes — `dismissed_at` is set after creation, on dismiss.
2. **Soft deleted?** N/A — this table itself *is* the soft-delete mechanism for notifications: a
   dismissed notification is hidden from the bell (`list_notifications` filters it out) while its
   underlying `AuditLog` row stays completely untouched. Verified directly, not just designed this
   way: dismissing a notification removes it from the API response while a direct database query
   confirms the `AuditLog` row is still present, unchanged.
3. **Audit trail?** N/A — this table exists specifically *because* the real audit trail
   (`AuditLog`) must never carry mutable UI state like read/dismissed.
4. **Indexed?** Implicit via the `unique_together` constraint (also serves as the lookup index for
   "has this user seen this notification").
5. **Encrypted?** No — carries no sensitive data of its own.
6. **Cascade behavior?** `CASCADE` from both `User` and `AuditLog` — if either is gone, the
   read-state record has no meaning either.

---

## Not yet built

Every table for Invoices, Clients, Payments, Tax, Health Score, Proposals, Contracts,
Subscriptions — none of these modules exist yet. This document only covers what's actually in the
database today (Users/Auth + the shared `core` tables).