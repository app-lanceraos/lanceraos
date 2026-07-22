# DATABASE.md

Grows as each module is built. For every table: the 6 questions answered + the schema + reasoning.
This is the authoritative reference for what exists in the database.

The 6 questions (from CLAUDE.md): Mutable? Soft deleted? Audit trail? Indexed? Encrypted? Cascade behavior?

---

## core.AuditLog

Replaces v1's three overlapping tables (`AccountEvent`, `LoginEvent`, `RegistrationAttempt`) with one
shared, cross-module table.

**Fields**: id (UUID), user (FK, nullable, SET_NULL), event (CharField, free-form — not a fixed
choices list, since every future module writes to this table), request_id, ip_address, user_agent,
metadata (JSONField), created_at.

1. **Mutable?** No — immutable, append-only. Never updated after creation.
2. **Soft deleted?** N/A — nothing is ever deleted from this table by application code.
3. **Audit trail?** This IS the audit trail.
4. **Indexed?** `(user, created_at)`, `(event, created_at)`, `(ip_address, created_at)`, `request_id`.
5. **Encrypted?** No — contains no PII beyond what's already visible elsewhere (IP, UA, event name).
6. **Cascade behavior?** `SET_NULL` from User — an audit entry for a deleted/anonymized user should
   still exist, just without a live user reference.

---

## core.ApiRequestLog

**Fields**: id (UUID), request_id (unique), user (FK, nullable, SET_NULL), method, path, status_code,
ip_address, user_agent, request_body (JSONField, sensitive fields redacted before storage),
response_body (JSONField, only populated when status_code >= 500), duration_ms, created_at.

1. **Mutable?** No — one row per request, written once by `core.middleware.RequestLoggingMiddleware`.
2. **Soft deleted?** N/A — not deleted by application code (a future retention-policy task may prune old rows).
3. **Audit trail?** This is the request-level companion to AuditLog (which is event-level).
4. **Indexed?** `(user, created_at)`, `(status_code, created_at)`, `created_at`.
5. **Encrypted?** No — but `request_body` is redacted (passwords, tokens, OTPs, CNIC/NTN/etc. replaced
   with a placeholder) before it's ever written, via `core.observability.redact_sensitive_fields`.
6. **Cascade behavior?** `SET_NULL` from User.

---

## users.User

**Fields**: id (UUID), email (unique), username (unique), password (Argon2), is_email_verified,
date_of_birth, two_fa_enabled + code/expiry, failed_login_attempts, account_locked_until,
last_login_ip/device, pending_email + expiry, password_history (JSON, last 3 hashes),
password_changed_at (never null — set at account creation, not just on first change; see
DECISIONS.md for why this matters), is_deleted, deleted_at, deletion_requested_at,
deletion_scheduled_at, anonymized_at.

1. **Mutable?** Yes — the core identity record, updated on every login, password change, profile edit.
2. **Soft deleted?** Yes: `is_deleted` + `deletion_scheduled_at` (30-day window). After the window,
   `User.anonymize()` strips PII in place — the row is never hard-deleted, so financial records with a
   `PROTECT` FK to User (future modules) remain valid.
3. **Audit trail?** Every state-changing event writes to `core.AuditLog`.
4. **Indexed?** `email`, `username` (both unique, implicitly indexed), `is_email_verified`, `is_deleted`,
   `deletion_scheduled_at`.
5. **Encrypted?** Password is hashed (Argon2), not reversibly encrypted. No other field on `User` itself.
6. **Cascade behavior?** User -> FreelancerProfile: `CASCADE` (profile has no independent meaning).
   User -> Session/TrustedDevice/UserSocialAccount: `CASCADE` (pure auth artifacts). User -> future
   financial records (Invoice, Payment, etc.): `PROTECT` — must never be silently deleted by user
   anonymization.

---

## users.FreelancerProfile

**Fields**: all business/tax/SMTP fields, plus `cnic_encrypted`/`cnic_hash`, `ntn_encrypted`/`ntn_hash`,
`pseb_encrypted`/`pseb_hash` (Fernet + HMAC blind index — see DECISIONS.md), `custom_smtp_password`
(Fernet), timezone (display-only, default `Asia/Karachi`), notif_* toggles (no toggle exists for
Security Alerts — CLAUDE.md requires it can never be disabled).

1. **Mutable?** Yes — edited via the Profile page.
2. **Soft deleted?** No independent lifecycle — tied to User's (PII cleared during `User.anonymize()`).
3. **Audit trail?** SMTP credential changes and CNIC/NTN/PSEB changes each write an `AuditLog` entry.
4. **Indexed?** `user_id` (FK), the three `*_hash` columns (unique + indexed). Encrypted value columns
   are never queried directly, so no index needed on them.
5. **Encrypted?** `custom_smtp_password`, `cnic_encrypted`, `ntn_encrypted`, `pseb_encrypted` (all
   Fernet). Never assigned directly — only via `set_cnic()` / `set_ntn()` / `set_pseb()`, which run
   validation + the cross-account uniqueness check before encrypting.
6. **Cascade behavior?** `CASCADE` from User.

---

## users.Session

Backs the 3-concurrent-session cap and the `/sessions/` list/revoke UI. Did not exist in v1.

**Fields**: id (UUID), user (FK), refresh_token_hash (SHA-256, unique), device_name, ip_address,
created_at, last_used_at, expires_at.

1. **Mutable?** Partially — `last_used_at` updates on every refresh/request; `refresh_token_hash` and
   `expires_at` update on rotation (same row, not a new one).
2. **Soft deleted?** No — sessions are ephemeral. Logout/revoke/expiry is a hard delete. What happened
   (login, logout, revocation) is recorded in `AuditLog` independently of whether the row survives.
3. **Audit trail?** Creation and revocation write to `AuditLog`; the table itself is live state, not history.
4. **Indexed?** `(user, last_used_at)` (list + cap-enforcement queries), `refresh_token_hash` (lookup
   on every refresh), `expires_at` (cleanup task).
5. **Encrypted?** No — stores a hash of the refresh token, not the token itself. Nothing reversible to protect.
6. **Cascade behavior?** `CASCADE` from User.

---

## users.UserSocialAccount

**Fields**: id (UUID), user (FK), provider (`google`/`facebook`), provider_uid, created_at.

1. **Mutable?** No — append-only; a link is created or removed, never edited in place.
2. **Soft deleted?** No — hard delete on unlink.
3. **Audit trail?** Yes — link/unlink writes to `AuditLog`.
4. **Indexed?** `(provider, provider_uid)` unique-together, `user_id`.
5. **Encrypted?** No — `provider_uid` isn't a secret, it's the provider's own internal account ID.
6. **Cascade behavior?** `CASCADE` from User.

---

## users.TrustedDevice

**Fields**: id (UUID), user (FK), token_hash (SHA-256, unique), device_name, ip_address, created_at,
expires_at, last_used_at.

1. **Mutable?** `last_used_at` updates; everything else set once.
2. **Soft deleted?** No — hard delete on expiry or explicit revoke.
3. **Audit trail?** "Trusted device added" logged to `AuditLog`.
4. **Indexed?** `token_hash` (unique).
5. **Encrypted?** No — same reasoning as Session, it's a hash not a secret.
6. **Cascade behavior?** `CASCADE` from User.

---

## users.EmailChangeRequest

**Fields**: id (UUID), user (FK), new_email, step1_token, step2_token (both raw-SHA-256-hashed, stored
directly on the row — not Django's stateless token-generator pattern; see DECISIONS.md), step (choices),
step1_expires_at, step2_expires_at, created_at, completed_at.

1. **Mutable?** Yes — `step` progresses through its state machine in place.
2. **Soft deleted?** No — expired/cancelled requests just sit with that status; no legal weight.
3. **Audit trail?** Each step transition logs to `AuditLog`.
4. **Indexed?** `(user, step)`, `step1_token`, `step2_token`.
5. **Encrypted?** No — tokens are already one-time-use, short-lived, and hashed (not reversible).
6. **Cascade behavior?** `CASCADE` from User.