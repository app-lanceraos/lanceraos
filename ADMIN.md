# ADMIN.md — Admin Panel, Cross-Module Tracker

Living document. Every module that adds its own admin capability updates this file as part of
finishing that module — not as a separate, later project. See `ADMIN_PANEL_DESIGN.md` for the full
original design reasoning (architecture, why a separate subdomain, the permission model). This file
is the running status: what exists, what each module still needs to add.

---

## Architecture (settled, see ADMIN_PANEL_DESIGN.md for full reasoning)

- `admin.lanceraos.com` — its own frontend deployment, own login, own session cookie (scoped
  specifically to that subdomain, never shared with the regular app's session).
- Same backend (`api.lanceraos.com`), same database as the main app. No duplication.
- Access gated by `can_access_admin_panel` (a new `User` field, deliberately separate from Django's
  own `is_staff`/`is_superuser`, which stay reserved for the raw `/admin/` interface).
- Mandatory 2FA for anyone with `can_access_admin_panel`.
- Every admin action recorded in `AuditLog`, using its `actor` field (new — see below) to record
  *who* performed the action, distinct from `user` (whose account it affected).

## Foundation status

| Piece | Status |
|---|---|
| `can_access_admin_panel` field on `User` | **Built.** Plus `is_super_admin`, `is_suspended`, `suspended_at`, `suspension_reason` — see `DATABASE.md`'s `users` table entry. |
| `actor` field on `AuditLog` | **Built.** `SET_NULL` FK to `User`, populated only on admin-initiated actions on someone else's account. See `DATABASE.md`'s `audit_log` entry for the resolved indexing question (no composite `(actor, created_at)` index — bare column only). |
| `admin.lanceraos.com`-ready session mechanism | **Built.** Separate `AdminSession` model (`apps.admin_panel`, `admin_sessions` table), separate `lanceraos_admin_access`/`lanceraos_admin_refresh` cookies distinct in *name* from the regular app's (both still travel to the shared `api.lanceraos.com`, so name collision — not domain scoping — is what keeps them apart), separate `AdminCookieJWTAuthentication` class requiring a mandatory `admin_sid` claim absent from every regular-app token. 2-session cap (`MAX_ADMIN_SESSIONS_PER_USER = 2`, tighter than the regular app's 3), 1-day token lifetime. `admin-frontend/` is a fully separate Vite project (own `App.jsx`, own `adminAuthStore.js`, own `AdminLayout.jsx`) — see `CLAUDE.md` Section 4. |
| Mandatory 2FA enforcement for admin accounts | **Built.** `admin_login` rejects any account with `two_fa_enabled=False` outright (403, "enable it from Settings in the main app first") — there is no path into the admin panel without it. Login itself is always two-step: email+password issues a 6-digit emailed OTP (never tokens directly), `admin_verify_2fa` is the only path that actually mints an `AdminSession` + cookies. |

## Per-module admin coverage

Each row: what a module needs admin visibility/action over, and whether it's been built. Add a new
row when a module is built, even if its admin screen is deferred — so the gap is visible, not silent.

| Module | Admin capability needed | Status |
|---|---|---|
| Users / Auth | **Built and verified**, backend + frontend, end to end against a real running application (see `DECISIONS.md`, 02–04 August 2026 entries for the build-then-audit-then-fix cycle). Covers: user search (`GET /admin/users/search/?q=`, email/username substring) and detail view; per-user session list + individual revoke (`GET`/`DELETE /admin/users/<id>/sessions/...`); suspend/reactivate (`POST /admin/users/<id>/suspend|reactivate/`) with the admin-protection rules — nobody can suspend their own account, and only a super-admin can suspend another admin account (verified at the backend, not just hidden in the UI); the two-tier `is_super_admin` grant/revoke model — `grant-admin/`/`revoke-admin/` are gated by the `IsSuperAdmin` permission class on top of the regular admin auth, admin access can only ever be granted to a `@lanceraos.com` email, revoking access immediately deletes every live `AdminSession` for that account (not just blocked on next login), and nobody can revoke their own access; the audit log viewer (`GET /admin/audit-log/` + `/audit-log/event-types/`) with self-view exclusion (an admin's own `admin_audit_log_viewed` events are hidden from the *default* view only, so loading the page doesn't bury what you were looking for under your own prior page-loads — still fully visible if explicitly searched) and an `admin_only=true` filter (actor-not-null); deletion-queue management (`GET /admin/deletion-queue/` + `POST /admin/users/<id>/restore/`, logged as `admin_deletion_restored`, distinct from self-service `deletion_cancelled`); resend-verification (`POST /admin/users/<id>/resend-verification/`). All consequential mutating actions (suspend/reactivate/grant/revoke/restore/resend-verification) share the `_admin_action_rate_limited` convention — 30/hour per acting admin, keyed on the admin's own user ID, not IP — blunting how much damage a single compromised admin session can do quickly. |
| Invoices + Clients | Not yet designed — module not started | — |
| *(future modules add their own row here)* | | |

## Open scoping question

Whether `ApiRequestLog` (full request/response debugging log) belongs in the admin UI at all, or
stays a database-only/Django-`/admin/`-only tool. This was never explicitly decided one way or the
other during the Users/Auth build — it simply wasn't built into the admin UI, which is consistent
with the original "leave it out, it's a developer tool" proposal, but no chat has actually revisited
and closed this question. Treat it as still genuinely open, not resolved by omission.

## Notes for whichever chat picks this up next

- Don't design a new admin screen for a module in isolation — check this file first for the
  established patterns (how sessions are shown, how the audit log viewer filters, the `actor`
  field convention) so every module's admin screen feels like the same product, not a patchwork.
- Two-tier permission model, now a real pattern to follow: every admin endpoint requires
  `AdminCookieJWTAuthentication` + `IsAuthenticated` at minimum; a small number of specifically
  consequential actions (currently: granting/revoking admin access) additionally require
  `apps.admin_panel.permissions.IsSuperAdmin`. Decide per-action, not per-module, which tier a new
  mutating admin action needs — most won't need the super-admin tier, but anything that changes
  *who else has admin access* should.
- `_admin_action_rate_limited(action, actor)` (`apps/admin_panel/views_users.py`) is the established
  convention for rate-limiting consequential admin mutations: 30/hour, keyed per acting admin
  (`ratelimit_admin_{action}_{actor.pk}`), separate from `admin_login`'s own IP-keyed limit. Reuse
  it (import from `views_users`, as `views_deletion.py` already does) for any new mutating action
  rather than inventing a new limiting scheme — pick a new `action` string per endpoint.
- Self-action guards matter and are cheap to forget: `suspend_user`/`revoke_admin_access` both
  explicitly block acting on the caller's own account (`user.pk == request.user.pk`), logged as
  `admin_action_denied` with a `reason` in metadata when blocked. Any future destructive
  self-targetable action should follow the same pattern.
- Update the table above when a module's admin screen ships, and note anything genuinely new the
  permission model needed to support it (a second role, a new action type, etc.) so the next module
  after that has the full picture too.
