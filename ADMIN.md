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
| `can_access_admin_panel` field on `User` | Designed, not yet built |
| `actor` field on `AuditLog` | Designed, not yet built |
| `admin.lanceraos.com` deployment + separate login/session | Designed, not yet built |
| Mandatory 2FA enforcement for admin accounts | Designed, not yet built |

## Per-module admin coverage

Each row: what a module needs admin visibility/action over, and whether it's been built. Add a new
row when a module is built, even if its admin screen is deferred — so the gap is visible, not silent.

| Module | Admin capability needed | Status |
|---|---|---|
| Users / Auth | Search/view users; view + revoke sessions; suspend/reactivate account; view audit log; manage deletion queue; resend verification email | Scoped in `ADMIN_PANEL_DESIGN.md`, not yet built |
| Invoices + Clients | Not yet designed — module not started | — |
| *(future modules add their own row here)* | | |

## Open scoping question

Whether `ApiRequestLog` (full request/response debugging log) belongs in the admin UI at all, or
stays a database-only/Django-`/admin/`-only tool. Proposed: leave it out of the polished admin UI —
it's a developer debugging tool, not an admin-facing one. Unconfirmed.

## Notes for whichever chat picks this up next

- Don't design a new admin screen for a module in isolation — check this file first for the
  established patterns (how sessions are shown, how the audit log viewer filters, the `actor`
  field convention) so every module's admin screen feels like the same product, not a patchwork.
- Update the table above when a module's admin screen ships, and note anything genuinely new the
  permission model needed to support it (a second role, a new action type, etc.) so the next module
  after that has the full picture too.
