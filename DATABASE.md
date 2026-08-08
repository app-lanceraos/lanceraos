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

terms_accepted_at                                       DateTimeField, nullable
terms_version                                             CharField(20), blank

can_access_admin_panel                                      BooleanField, default False
is_super_admin                                                BooleanField, default False
is_suspended                                                    BooleanField, default False
suspended_at                                                      DateTimeField, nullable
suspension_reason                                                   TextField, blank
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

**`terms_accepted_at`/`terms_version`**: recorded server-side, not just gated by a frontend
checkbox — a client-side-only requirement isn't a real requirement at all, since a direct API call
bypasses it entirely with no record anything was ever agreed to. Set at registration for
email/password signups; for OAuth signups (who skip the registration wizard entirely and would
otherwise have no acceptance mechanism at all), set during onboarding instead, gated behind the
same checkbox pattern as `needsDob`. `terms_version` records *which* version of the Terms/Privacy
Policy was agreed to (see `apps/users/constants.py`'s `CURRENT_TERMS_VERSION`) — existing users are
never retroactively required to re-accept when the version bumps, but this preserves a real record
of what they actually agreed to at the time, which matters if terms are ever disputed.

**Key methods**: `is_account_locked()`, `increment_failed_attempts()` (tiered lockout — 5 attempts
→ 15min, 11 → 60min, 16+ → 24h), `is_oauth_only()`, `anonymize()` (strips all PII on both `User`
and its linked `FreelancerProfile`, sets `is_active=False`, deletes all `Session`/`TrustedDevice`/
`UserSocialAccount` rows for the account).

**`can_access_admin_panel` / `is_super_admin` / `is_suspended` / `suspended_at` /
`suspension_reason`** — added for the admin panel (`apps.admin_panel`; see `ADMIN.md`). Exact
reasoning comments from `apps/users/models.py`, verbatim:

```
# ── Admin panel access ─────────────────────────────────────────
# Deliberately separate from Django's own is_staff/is_superuser,
# which stay reserved for the raw Django /admin/ interface. This
# flag gates the real, purpose-built admin panel at
# admin.lanceraos.com — someone could have one without the other.
can_access_admin_panel = models.BooleanField(default=False)

# Only a super-admin may grant/revoke can_access_admin_panel for
# someone else — a regular admin can do everything else (search,
# suspend, view the audit log) but not manage who else has access.
is_super_admin = models.BooleanField(default=False)

# ── Admin-initiated suspension — distinct from is_active (used by
# permanent anonymization) and is_deleted (self-service deletion) ──
is_suspended = models.BooleanField(default=False)
suspended_at = models.DateTimeField(null=True, blank=True)
suspension_reason = models.TextField(blank=True)
```

None of these five fields carry their own database index — `can_access_admin_panel` and
`is_suspended` are checked on the authenticated-user's own row (already fetched by primary key) or
filtered in small admin-search result sets, not queried at table scale the way `is_deleted`/
`deletion_scheduled_at` are by the daily anonymization sweep.

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

# Onboarding — collected once, then locked (see LOCKED_FIELDS on
# FreelancerProfileSerializer); no longer editable anywhere afterward,
# including Settings > Business, which used to expose them
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

## `admin_sessions` (`AdminSession`, in `apps.admin_panel`)

Backs admin-panel login sessions at `admin.lanceraos.com`. Genuinely independent from
`apps.users.Session`, by design — quoting the model's own docstring verbatim:

```
Genuinely independent from apps.users.Session — an admin login must
never compete for the regular app's 3-concurrent-session cap (logging
into admin.lanceraos.com evicting a legitimate regular-app session
would be a real, undesirable side effect of sharing a model). Same
reasoning that gave TrustedDevice its own table rather than overloading
Session with a second purpose.
```

**Schema**:
```
id                     UUIDField, primary key
user                   FK to User, CASCADE
refresh_token_hash     CharField(64), unique  — SHA-256 of the raw admin refresh token
device_name            CharField(300), blank
ip_address             GenericIPAddressField, nullable
created_at             DateTimeField, auto_now_add
last_used_at           DateTimeField, auto_now_add
expires_at             DateTimeField
```

`MAX_ADMIN_SESSIONS_PER_USER = 2` (tighter than the regular app's 3 — "this is the
highest-privilege surface in the system," per the model's own comment). Default session lifetime
is 1 day (`ADMIN_REFRESH_DAYS` in `token_service.py`), deliberately short relative to the regular
app's 30/90-day sessions — an admin being forced to re-authenticate more often is the accepted
tradeoff for this privilege level.

1. **Mutable?** Yes — `rotate()` updates `refresh_token_hash`/`expires_at`/`last_used_at` on every
   token refresh (same row, not a new one, mirroring `apps.users.Session`); `touch()` bumps
   `last_used_at` alone.
2. **Soft deleted?** No — hard-deleted outright on logout, on admin-access revocation
   (`revoke_admin_access` deletes every `AdminSession` for that user immediately, not just blocking
   their next login), and via `cleanup_expired()`. A pure auth artifact with no retention value once
   it's no longer live, same reasoning as `apps.users.Session`.
3. **Audit trail?** Indirectly — `admin_login_success`, `admin_logout`, `admin_access_revoked`, etc.
   are logged to `AuditLog` by the views that perform them, not by this model itself.
4. **Indexed?** `(user, last_used_at)`, `refresh_token_hash`, `expires_at` — identical pattern to
   `apps.users.Session`.
5. **Encrypted?** No — `refresh_token_hash` is a plain SHA-256 hash of the raw refresh token, same
   reasoning as `Session.refresh_token_hash`: the token's own JWT-signing entropy makes a
   dictionary/HMAC concern moot, unlike CNIC/NTN/PSEB.
6. **Cascade behavior?** `CASCADE` from `User` — pure auth artifact, no independent value once the
   account is gone. (Deliberately not `SET_NULL` — unlike `AuditLog`, there's no reason for an
   admin session to outlive the account it belongs to.)

The `admin_sid` claim embedded on the admin access token (set only at admin-token-minting time,
required — never optional — by `AdminCookieJWTAuthentication`) is what stops a stolen regular-app
access token from being replayed against admin endpoints, or vice versa; see
`apps/admin_panel/authentication.py`'s module docstring for the full token-type-confusion
reasoning.

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
   `request_id` — plus the single-column index Django creates automatically on every `ForeignKey`
   (so `actor` alone is indexed too). See the correction below: there is **no** composite
   `(actor, created_at)` index, despite the pattern used for `user`/`event`/`ip_address`.
5. **Encrypted?** No — `metadata` should never contain raw secrets; sensitive request fields are
   redacted before logging (`core.observability.redact_sensitive_fields`).
6. **Cascade behavior?** `SET_NULL` on both `user` and `actor` — the log entry survives even if
   the account it describes (or the admin who performed the action) is later deleted.

**`actor` — correction: this document previously claimed this field was added during the
notification-bell work. That was wrong.** It was designed then (in `ADMIN_PANEL_DESIGN.md`, as a
proposal) but never actually implemented — the field genuinely didn't exist in the database until
the first real admin capability (user search/session management) was built, when a Claude Code
session correctly caught that an earlier instruction assumed it already existed, checked the real
model and migration history, found it didn't, and added it properly at that point instead of
applying a diff that would have silently broken every `log_event()` call in the application.
Every self-service call site leaves this `null`, since the actor and the subject are already the
same person captured in `user`. Only admin-initiated actions on someone else's account populate
it. **Resolved** (this document previously flagged this as unconfirmed): checked directly against
`core/migrations/0004_auditlog_actor.py` and `core/models.py`'s current `Meta.indexes` — the
migration is a bare `AddField`, no `AddIndex`/`index_together` operation, and `Meta.indexes` lists
only `user`, `event`, `ip_address`, and `request_id`. The composite `(actor, created_at)` index was
never created; only the bare `actor` column exists, indexed solely via Django's automatic
single-column FK index. Filtering the admin audit-log viewer by actor (`views_audit.py`) or by
`admin_only=true` therefore does not benefit from a `created_at`-ordered composite index the way
the other three filters do — worth adding one if that view's actor-filtered query ever shows up as
slow at real data volume.

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

## `exchange_rate_snapshots` (`ExchangeRateSnapshot`, in `apps.payments`)

One row per day, capturing the full USD-anchored rate table from `open.er-api.com` — the minimal
foundational slice of Module 3 (Payments + Expenses + P&L) built ahead of that module's real scope,
specifically so Module 2 (Invoices/Clients) has a real currency-conversion anchor to build against.
See `INVOICES_CLIENTS_TECHNICAL_SPEC.md` Section 4.

**Schema**:
```
id             UUIDField, primary key
date           DateField, unique, db_index=True
rates_to_usd   JSONField — value of 1 unit of that currency in USD, e.g.
                {"PKR": 0.0036, "EUR": 1.08, "GBP": 1.27, "USD": 1.0}
source         CharField — 'open.er-api.com'
fetched_at     DateTimeField
```

1. **Mutable?** No — append-only, one row per date. The daily `fetch_exchange_rates` Celery task
   checks for an existing row for today's date before creating a new one; it never updates an
   existing row in place.
2. **Soft deleted?** No — reference data with no deletion path at all.
3. **Audit trail?** N/A — fetched by a scheduled task, not a user action, so there's no actor for
   `core.AuditLog` to attribute it to.
4. **Indexed?** `date` — both the daily-fetch idempotency check and every "most recent snapshot"
   lookup filter on this field.
5. **Encrypted?** No — exchange rates aren't sensitive data.
6. **Cascade behavior?** N/A as of this table's creation — nothing FKs to it yet. The spec's planned
   `Invoice.exchange_rate_snapshot` FK (Module 2) will use `SET_NULL`, since an invoice must survive
   a snapshot row being pruned long after the fact.

**Anchor-currency design, not v1's PKR-hardcoded approach**: `rates_to_usd[X]` is the value of one
unit of currency X in USD, so any currency pair converts by routing through USD (via
`core.money.Money.convert()`) rather than needing a direct rate for every pair, and adding a new
currency later is a data change (the next day's fetch just includes it) — never a migration. The
daily fetch task (`apps.payments.tasks.fetch_exchange_rates`, Celery Beat at 8:00 AM PKT) captures
the API's full rate table, not just PKR/EUR/GBP, at no extra API cost.

**Inversion direction — the one thing worth double-checking here**: `open.er-api.com` returns
USD→X rates (1 USD = `api_rate` units of X). This table stores the opposite direction (1 unit of X
= `rates_to_usd[X]` USD), so the fetch task inverts every rate (`1 / api_rate`) before storing.
Getting this backwards would silently corrupt every downstream conversion — verified with a manual
sanity check before shipping (PKR at `api_rate≈278.5` inverts to `≈0.0036` USD/PKR; EUR at
`api_rate≈0.92` inverts to `≈1.09` USD/EUR — both the right order of magnitude) and covered by
`apps/payments/tests.py`.

---

## `clients` (`Client`, in `apps.clients`)

The Client CRM, built ahead of `apps.invoices` (which doesn't exist yet — see
`INVOICES_CLIENTS_TECHNICAL_SPEC.md` Section 3). No FK to Invoice exists here at all; the future
`Invoice.client` FK will point at this table with `SET_NULL`.

**Schema**:
```
id                          UUIDField, primary key
user                        FK → User, CASCADE
name / email / company / address / phone / country
default_currency            CharField(3), no choices= — see note below
default_payment_terms       PositiveIntegerField, default=30
notes                       TextField, blank — a single freeform field on the client card itself,
                              distinct from the structured ClientNote model below
is_active                   BooleanField, default=True — archive flag
is_flagged / flag_reason / flag_type / flagged_at   — manual flagging only
auto_flagged                BooleanField, default=False — reserved, no logic fires yet
portal_token                CharField(32), unique, db_index=True — persistent magic-link credential
tags                        ManyToManyField(ClientTag, blank=True)
created_at / updated_at
```

1. **Mutable?** Yes — a live CRM record, edited from the client detail page.
2. **Soft deleted?** No — archived via `is_active`, not deleted. Deletion is a separate, explicit,
   invoice-preserving-by-default action (matching v1's `keep_invoices` choice) that belongs to a
   later prompt once `apps.invoices` exists to actually offer that choice.
3. **Audit trail?** Via `core.events` (`ClientCreated`/`ClientArchived`/`ClientFlagged`), not a
   bespoke log — no handlers are subscribed yet (see `core/events.py`'s own docstring); a no-op
   `emit()` today is correct, not a bug. Turning these into real `core.AuditLog` rows happens when
   this module's notification/audit-log integration is built.
4. **Indexed?** `(user, is_active)`, `(user, email)`, `portal_token` (implicit via `unique=True`).
5. **Encrypted?** No — no CNIC/NTN-class data lives on this model.
6. **Cascade behavior?** `CASCADE` from `User` (a deleted/anonymized user's clients have no
   independent meaning). The future `Invoice.client` FK will be `SET_NULL` in the other direction.

**`default_currency` has no `choices=`, deliberately** — the same fix already applied to
`ExchangeRateSnapshot`. Validated at write time in `apps.clients.serializers.validate_currency_code`
against the most recent `ExchangeRateSnapshot.rates_to_usd` keys (plus `'USD'`, always valid even
before a single snapshot exists), so adding a currency later is a data change, never a migration.

**`portal_token`** is generated in `Client.save()` (via `secrets.token_urlsafe(16)`, uniqueness
checked in a loop against real collisions) only when blank — an explicitly-supplied value is never
overwritten. This is the actual magic-link credential for the future client portal ("view all
invoices with this freelancer"), not a session token — it's persistent and non-expiring by design.

**`payment_stats` (property, not a column)** — computes reliability-score stats by calling
`apps.clients.scoring.compute_reliability_stats()` with `self._invoices_for_scoring()`, which
returns `None` (not an exception) when `apps.invoices` hasn't added its reverse relation to this
model yet — this is what makes `GET /api/clients/<pk>/analytics/` callable today, correctly
returning a zero/`None`-shaped response rather than a 500. See the `client_analytics` endpoint and
`DECISIONS.md` for the reliability-score formula itself and the reasoning behind testing it via a
model-agnostic pure function rather than a fake Invoice stand-in.

**`flag_type` choices** — `payment_risk`/`communication`/`other`. Reconstructed for v2; v1's
original flag-type choice set wasn't available in this session (see `DECISIONS.md`). Kept
deliberately small; extend via migration if a real business need for finer-grained categories
emerges.

---

## `client_notes` (`ClientNote`, in `apps.clients`)

Structured, authored notes — distinct from `Client.notes` (the single freeform field on the client
card itself above). Private, never client-visible.

**Schema**: `id`, `client` (FK, `CASCADE`), `author` (FK → `User`, `CASCADE`), `content`,
`created_at`, `updated_at`.

1. **Mutable?** Yes — `content`/`updated_at` change on edit.
2. **Soft deleted?** No — a real, immediate hard delete; no business/legal significance to
   preserving a dead private note.
3. **Audit trail?** No dedicated `AuditLog` rows — low-stakes freelancer-private scratch notes, not
   the class of action `CLAUDE.md`'s audit rules target.
4. **Indexed?** `(client, created_at)` — the note list is always scoped to one client, by recency.
5. **Encrypted?** No.
6. **Cascade behavior?** `CASCADE` from both `Client` and `User` — a note has no meaning independent
   of the client it's about or the freelancer who wrote it.

---

## `client_tags` (`ClientTag`, in `apps.clients`)

Minimal, user-scoped label. Named as owned by `apps/clients/` in the decisions doc but never fully
designed there; this is the real implementation.

**Schema**: `id`, `user` (FK, `CASCADE`), `name` (CharField(40)), `color` (CharField(7), validated
as a hex value via `RegexValidator`). `unique_together = [('user', 'name')]`.

1. **Mutable?** Yes — name/color editable by their owner.
2. **Soft deleted?** No — a tag with no clients attached has no residual meaning; hard delete is
   correct.
3. **Audit trail?** No — a cosmetic organizational label, not a security- or finance-relevant action.
4. **Indexed?** Implicit via the `unique_together(user, name)` constraint — also serves as the
   lookup index for "does this user already have a tag with this name" (enforced at both the
   serializer layer, for a clean 400, and the database layer — verified directly with a real
   `IntegrityError` test, not just assumed from the serializer check).
5. **Encrypted?** No.
6. **Cascade behavior?** `CASCADE` from `User`. Removing a tag detaches it from every `Client`
   automatically via the M2M table — no separate cleanup needed.

---

## `invoices` (`Invoice`, in `apps.invoices`)

The Invoice Core, per `INVOICES_CLIENTS_TECHNICAL_SPEC.md` Section 5 — ported from
`v1-reference/apps/invoices/models.py` where v1 already had a correct, working implementation
(invoice numbering, `recalculate_totals()`, the core shape of `update_paid_status()`), adjusted for
the anchor-currency design and the no-stored-`overdue` fix. Step 4 built the models only; Step 5
added the CRUD + lifecycle endpoint surface (create/edit/finalise/mark-sent/mark-paid/payments/
undo/cancel/refund/bad-debt/duplicate/toggle-reminders/pause-resume-recurring/timeline/summary/
aging-report/exchange-rate/presets) — real `/send/` (needs `send_email()`, Step 10) and `/pdf/`
(needs `InvoiceDesign` rendering, Step 7) remain deliberately unbuilt, not stubbed.

**Schema** (grouped by purpose): `id` (UUID PK), `user` (FK, `CASCADE`), `client` (FK →
`clients.Client`, `SET_NULL`, nullable), `invoice_number` (see uniqueness note below), `status`
(9 choices — see below), `sent_via_platform`, `design` (FK → `InvoiceDesign`, `SET_NULL`,
nullable), `view_token` (unique, indexed), `client_name`/`client_email`/`client_company`/
`client_address`/`client_phone` (immutable snapshot at creation), `currency` (CharField(3), no
`choices=`), `subtotal`/`tax_rate`/`tax_amount`/`discount_amount`/`total`/`amount_paid`,
`rate_to_usd_at_issue` (Decimal(10,6), nullable), `exchange_rate_snapshot` (FK →
`payments.ExchangeRateSnapshot`, `SET_NULL`, nullable), `pdf_url`/`pdf_generated_at`,
`issue_date`/`due_date`/`paid_date`/`sent_at`, `notes`/`terms`, `reminders_enabled`/
`reminder_count`/`last_reminder_sent_at`, `late_fee_enabled`/`late_fee_rate`, `is_recurring`/
`recurring_interval_days`/`recurring_auto_send`/`recurring_paused`, `parent_invoice` (self FK,
`SET_NULL`), `next_recurring_date`, `escalation_required`/`escalation_dismissed`,
`is_one_time_client`, `pre_payment_status`, `client_acknowledged`/`client_acknowledged_at`,
`created_at`/`updated_at`.

**`status` choices** (exactly 9, no `overdue`): `draft`, `created`, `sent`, `viewed`,
`partially_paid`, `paid`, `cancelled`, `refunded`, `bad_debt`. `days_overdue` stays a pure
read-time `@property` layered on top — never a stored value.

1. **Mutable?** Yes — the most actively-updated table in this module.
2. **Soft deleted?** No — `cancelled`/`refunded`/`bad_debt` are real terminal statuses, not
   soft-delete. Hard delete only permitted pre-Sent, enforced at the view layer (a later step).
3. **Audit trail?** Every status transition and payment action emits an event via `core.events`
   (handler wiring is a later step — see `core/events.py`'s own docstring).
4. **Indexed?** `(user, status)`, `(user, due_date)`, `(status, due_date)`, `next_recurring_date`,
   `view_token` (implicit via `unique=True`), `(user, invoice_number)` (implicit via
   `unique_together` — see the bug note below).
5. **Encrypted?** No.
6. **Cascade behavior?** `CASCADE` from `User`; `SET_NULL` from `Client`, `InvoiceDesign`, and
   `ExchangeRateSnapshot`; self-referential `parent_invoice` is `SET_NULL`.

**A real bug found while writing this step's own tests, not carried forward from v1 on faith**: v1's
`invoice_number` was a bare `unique=True` CharField — globally unique across every user, even though
`generate_invoice_number()` only ever checks for collisions within one user's own invoices. Two
different users' first invoice of the same year both compute the identical string
`INV-2026-0001`; in v1's schema, whichever one saved first would succeed and every other user
creating their year's first invoice would hit a real `IntegrityError`. Caught here by writing the
"two different users" numbering test the spec asked for and watching it fail against a real
Postgres unique constraint — not by inspection. Fixed by moving the constraint to
`Meta.unique_together = [('user', 'invoice_number')]`, matching what "sequential per user per year"
actually means: the same number string is expected to recur across different users.

**Fields intentionally NOT ported from v1**: `template` (superseded by `design`), `show_pkr_to_client`
/ `include_payment_methods` (not in the spec's field table — plausibly absorbed into
`InvoiceDesign.design_data` now), `pkr_at_issue`/`pkr_at_payment`/`rate_at_issue`/`rate_at_payment`/
`exchange_rate_gain_loss` (the whole PKR-specific payment-time-rate concept, replaced by
`rate_to_usd_at_issue` + `exchange_rate_snapshot`), `autosaved_at`/`is_autosave` (not in the spec's
field table).

**`currency` has no `choices=`**, same reasoning as `Client.default_currency` — validated in
`InvoiceSerializer`/`InvoicePresetSerializer`/`InvoicePartialPaymentSerializer` (Step 5) by directly
reusing `apps.clients.serializers.validate_currency_code`, exactly as Step 4's model comment pointed
whoever built this step to do.

**`invoice_number` is nullable (`null=True, blank=True`), added in Step 5, not Step 4**: a draft
invoice has no real invoice number at all until `invoice_finalise()` assigns one — confirmed by the
spec's own `invoice_duplicate` behavior, which explicitly resets `invoice_number` on the new draft
copy it creates. Multiple drafts for the same user therefore all have `invoice_number=None`
simultaneously; Postgres's unique index treats every `NULL` as distinct from every other `NULL`
(standard SQL semantics, not merely assumed — this project verifies against its actual Postgres
rather than trusting general knowledge), so this doesn't collide with the `(user, invoice_number)`
constraint above.

**A second real bug found while writing Step 5's tests, inherited from v1 and carried into Step 4
unnoticed**: `issue_date` was `models.DateField(default=timezone.now)` — `timezone.now()` returns a
`datetime`, not a `date`. A freshly-created, not-yet-refreshed `Invoice` held a full datetime in a
`DateField` Python attribute; Postgres silently truncated it on write, so every Step 4 test that
round-tripped through the database (`refresh_from_db()`) never noticed. DRF's `DateField` serializer
is strict about datetime-vs-date and raised loudly (`AssertionError: Expected a 'date', but got a
'datetime'`) the first time Step 5 serialized a just-created instance directly, without a DB round
trip in between. Fixed with a real function (`_today()`, returning `timezone.now().date()`) as the
default instead of the bare `timezone.now` callable.

**`update_paid_status()`** — ported from v1 with the spec's core fix: `_RESTORABLE_STATUSES` no
longer includes `'overdue'` (v1's did), so a payment-undo round trip can never restore a stale
`'overdue'` value into `status`. Every "never flip a terminal status" guard (paid/partially_paid/
undo-restore branches) also now excludes `'refunded'` — a status v1 never had at all, so its guards
never needed to name it; extending the same protection to it is this step's own necessary addition,
not a v1 behavior change. `_capture_payment_rate()` and its PKR fields are dropped entirely — no
rate is stored at payment time, per the anchor-currency design.

---

## `invoice_items` (`InvoiceItem`, in `apps.invoices`)

Ported directly from v1 — no changes.

**Schema**: `id`, `invoice` (FK, `CASCADE`), `description`, `quantity`, `unit_price`, `total`
(computed on `save()`), `sort_order`.

1. **Mutable?** Yes — edited while an invoice is a draft. 2. **Soft deleted?** No — hard delete.
3. **Audit trail?** No dedicated rows — covered by the parent `Invoice`'s own transition events.
4. **Indexed?** None beyond the implicit FK index. 5. **Encrypted?** No.
6. **Cascade behavior?** `CASCADE` from `Invoice`.

---

## `invoice_partial_payments` (`InvoicePartialPayment`, in `apps.invoices`)

**Schema**: `id`, `invoice` (FK, `CASCADE`), `amount`, `currency`, `rate_to_usd` (Decimal(10,6),
nullable — anchor-currency replacement for v1's `amount_pkr`/`exchange_rate`), `source` (7
choices, unchanged from v1), `payment_date`, `notes`, `recorded_at`.

1. **Mutable?** No — append-only; record/undo creates or deletes a row, never edits in place.
2. **Soft deleted?** No — deletion IS the undo mechanism (see `Invoice.update_paid_status()`'s
   `pre_payment_status` restore path). 3. **Audit trail?** Record/undo emits events at the view
   layer (a later step); this table is itself the detailed record. 4. **Indexed?** None beyond the
   implicit FK index. 5. **Encrypted?** No. 6. **Cascade behavior?** `CASCADE` from `Invoice`.

**The spec's `payment` FK (→ `payments.Payment`, `SET_NULL`, "field ready for Module 3") is
deliberately NOT included yet.** `apps.payments` has no `Payment` model as of this step (verified
directly), and Django's system checks (`fields.E300`/`E307`, confirmed empirically before writing
this file) reject a `ForeignKey` to a model that doesn't exist at all — this isn't a lazy reference
Django tolerates, unlike a same-app forward string reference. Adding this FK is a real migration for
whichever step actually builds `apps.payments.Payment` (Module 3).

---

## `invoice_reminders` (`InvoiceReminder`, in `apps.invoices`)

Ported directly from v1 — no changes.

**Schema**: `id`, `invoice` (FK, `CASCADE`), `reminder_number`, `template_used` (4 choices),
`sent_at`, `delivered`, `days_overdue_at_send`. `unique_together = [('invoice', 'reminder_number')]`.

1. **Mutable?** No — append-only, one row per reminder actually sent. 2. **Soft deleted?** No.
3. **Audit trail?** The row itself is the record. 4. **Indexed?** Implicit via `unique_together`.
5. **Encrypted?** No. 6. **Cascade behavior?** `CASCADE` from `Invoice`.

---

## `invoice_view_events` (`InvoiceViewEvent`, in `apps.invoices`)

Ported directly from v1 — no changes.

**Schema**: `id`, `invoice` (FK, `CASCADE`), `viewed_at`, `ip_address`, `user_agent`, `source`
(4 choices).

1. **Mutable?** No — append-only. 2. **Soft deleted?** No. 3. **Audit trail?** The row itself is
   the record. 4. **Indexed?** None beyond the implicit FK index yet — worth revisiting if public
   invoice-page view volume ever demands it. 5. **Encrypted?** No.
6. **Cascade behavior?** `CASCADE` from `Invoice`.

Every write here must run through the freelancer-own-session guard (decisions doc Section 4) so a
freelancer viewing their own sent invoice never counts as a client view — that guard lives at the
view layer (a later step), not on this model.

---

## `invoice_comments` (`InvoiceComment`, in `apps.invoices`)

New — no v1 equivalent (v1 has no messaging at all, confirmed in an earlier session). The unified
two-way message thread (portal + email-reply + in-app) per the spec.

**Schema**: `id`, `invoice` (FK, `CASCADE`), `author_type` (`freelancer`/`client`), `author_user`
(FK → `User`, `SET_NULL`, nullable — set when `author_type='freelancer'`), `client_name`/
`client_email` (snapshot, blank — set when `author_type='client'`), `source` (`portal`/
`email_reply`/`app`), `body_text`, `body_html` (blank, only for `email_reply`), `attachment_url`,
`created_at`, `read_by_freelancer_at`/`read_by_client_at`. **No `updated_at`** — deliberately
different from `ClientNote` (which IS mutable): comments are immutable, never edited or deleted,
per the decisions doc.

1. **Mutable?** No, append-only, except the two `read_by_*_at` timestamps. 2. **Soft deleted?**
   No — permanent record by design. 3. **Audit trail?** The row itself is the record; posting also
   emits `CommentPosted` (handler wiring is a later step). 4. **Indexed?** `(invoice, created_at)`.
5. **Encrypted?** No. 6. **Cascade behavior?** `CASCADE` from `Invoice`; `SET_NULL` from `User` (a
   comment survives its author's account being anonymized — verified directly with a test using a
   commenter distinct from the invoice's own owner, since deleting the invoice's owner would
   CASCADE the invoice itself first).

---

## `payment_claims` (`PaymentClaim`, in `apps.invoices`)

Ported directly from v1 — no changes. Kept as a separate, structured flow per the decisions doc,
not merged into `InvoiceComment`.

**Schema**: `id`, `invoice` (FK, `CASCADE`), `client_email`, `client_name`, `amount_claimed`,
`currency`, `payment_source` (7 choices), `payment_date`, `client_note`, `status` (`pending`/
`confirmed`/`rejected`), `submitted_at`, `reviewed_at`.

1. **Mutable?** Yes — `status`/`reviewed_at` change once, on confirm/reject. 2. **Soft deleted?**
   No. 3. **Audit trail?** Confirm/reject emits events at the view layer (a later step); this row is
   itself the detailed record. 4. **Indexed?** None beyond the implicit FK index yet. 5.
   **Encrypted?** No. 6. **Cascade behavior?** `CASCADE` from `Invoice`.

---

## `invoice_designs` (`InvoiceDesign`, in `apps.invoices`)

New — no v1 equivalent (v1's PDF generation was reportlab code, not user-editable data). The
visual PDF/portal template system (decisions doc Section 9/10).

**Schema**: `id`, `user` (FK, `CASCADE`), `name`, `base_template` (`professional`/`minimal`/
`modern`), `source` (`builtin`/`custom`/`ai_seeded`), `color_variant` (blank, builtin-path only),
`design_data` (JSONField), `is_default`, `created_at`/`updated_at`.

1. **Mutable?** Yes — edited via the design editor (a later step). 2. **Soft deleted?** No — hard
   delete; `Invoice.design` is `SET_NULL`, so a deleted design never breaks an invoice that already
   rendered against it (the frozen `pdf_url` survives regardless). 3. **Audit trail?** No dedicated
   events — a design edit isn't a security/finance-relevant action. 4. **Indexed?** None beyond the
   implicit FK index yet. 5. **Encrypted?** No. 6. **Cascade behavior?** `CASCADE` from `User`.

**`is_default` enforcement** (one per user) is ported structurally from v1's
`InvoiceTemplate.save()` — same pattern, applied to this new model, verified directly with a test
creating two defaults for the same user and confirming the first is unset.

---

## `invoice_presets` / `invoice_preset_items` (`InvoicePreset` / `InvoicePresetItem`, in `apps.invoices`)

Renamed from v1's `InvoiceTemplate`/`InvoiceTemplateItem` per the spec's explicit naming decision
(avoids colliding with `InvoiceDesign` — flagged and approved two rounds ago, not reverted here).
"Quick-create defaults" — unrelated to visual design.

**`InvoicePreset` schema**: `id`, `user` (FK, `CASCADE`), `name`, `description`, `include_client`,
`client` (FK → `clients.Client`, `SET_NULL`, nullable), `client_name`/`client_email`/
`client_company` (snapshot), `currency` (no `choices=`), `tax_rate`, `discount_amount`,
`payment_terms`, `notes`/`terms`, `late_fee_enabled`/`late_fee_rate`, `is_default`,
`created_at`/`updated_at`. Per the spec's explicit field list for this model, v1's `template`/
`show_pkr_to_client`/`include_payment_methods` are dropped — same reasoning as `Invoice`'s own
dropped fields.

**`InvoicePresetItem` schema**: `id`, `preset` (FK, `CASCADE`), `description`, `quantity`,
`unit_price`, `sort_order`. Direct port of `InvoiceTemplateItem`, renamed FK target only.

1. **Mutable?** Yes. 2. **Soft deleted?** No — hard delete; no downstream financial record
   references a preset. 3. **Audit trail?** No — a personal productivity shortcut, not a
   security/finance action. 4. **Indexed?** None beyond the implicit FK indexes. 5. **Encrypted?**
   No. 6. **Cascade behavior?** `CASCADE` from `User`/`InvoicePreset`; `SET_NULL` from `Client`.

`is_default` enforcement (one per user) uses the identical pattern as `InvoiceDesign.save()` above.

---

## Not yet built

Tax, Health Score, Proposals, Contracts, Subscriptions, and the rest of Payments (income tracking,
expense tracking, P&L) — none of these exist yet. Within `apps.invoices` itself, this step was
models-only: no views, serializers, URLs, PDF generation, email delivery, the client portal,
payment claims *workflow* (the table exists; confirm/reject actions don't), comments *delivery*
(the table exists; posting/WebSocket endpoints don't), or recurring/reminder *tasks* (the fields and
`InvoiceReminder` table exist; the Celery Beat generation/escalation logic doesn't). This document
only covers what's actually in the database today (`apps.users`' six tables, `apps.admin_panel`'s
one table, `apps.payments`'s one table, `apps.clients`' three tables, `apps.invoices`' ten tables —
twenty-two tables spanning five apps — and the three shared `core` tables).