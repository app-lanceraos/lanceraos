# ADMIN_PANEL_DESIGN.md — Original Design Reasoning

**A note on this document's history**: this document was referenced throughout `DECISIONS.md` and
`ADMIN.md` as the source of the admin panel's original design reasoning, but it never actually
existed in the repository or git history — the same class of gap that once affected `DATABASE.md`.
This is a **reconstruction**, built from the real, detailed decision trail already on record in
`DECISIONS.md` and the actual, current implementation — accurate to what was genuinely decided and
why, not a recovery of original phrasing. `ADMIN.md` is the living status tracker; this document is
the one-time design reasoning behind it.

---

## Why a separate `admin.lanceraos.com`, not a page inside the main app

The admin panel is the highest-privilege surface in the entire system — the one place capable of
reading any user's account details, suspending accounts, and granting further admin access. It
gets genuine architectural isolation from the regular app, not just a permission check bolted onto
existing pages:

- **Its own frontend deployment** (`admin-frontend/`, a separate Vite project, not a route inside
  `frontend/`) — a real, separate build and deployment, not a `/admin` path in the main app.
- **Its own login, its own session, its own cookies** — entirely distinct cookie *names*
  (`lanceraos_admin_access`/`lanceraos_admin_refresh`, never the same as the regular app's), and a
  token that's cryptographically distinguishable from a regular access token (an `admin_sid` claim
  that only admin-issued tokens ever carry) — closing the risk of a stolen regular-user token being
  replayed against admin endpoints, or vice versa.
- **Mandatory two-factor authentication**, no exception — enforced at login, not optional the way
  it is for a regular account.

## Why not built as one monolithic project up front

Two wrong extremes were both explicitly rejected:

- **Wait until the whole product ships**: rejected — the moment a future module involves real
  users and real money, having zero way to look up an account or investigate a support request is
  a genuine operational risk, not a nice-to-have deferral.
- **Build the complete admin panel immediately, covering every future module**: rejected — the
  same mistake already made and corrected once with `AppShell.jsx`'s nav (building a "Payments
  tab" for a module that doesn't exist yet). There's nothing to administer for modules that aren't
  built.

**The chosen middle path**: foundational, module-independent infrastructure gets built first, since
none of it depends on any future module — `can_access_admin_panel`, `AuditLog.actor`, the separate
session/cookie/auth-class mechanism, and Users/Auth's own admin screens. Every module after that
builds its own admin screen as part of finishing that module, updating `ADMIN.md`'s tracking table
at the same time — never as a deferred, separate project.

## The permission model — why two tiers, not one flag

`can_access_admin_panel` alone was the original, minimal design — sufficient while only one person
(Ali) would ever hold it. Once a real need emerged to let *other* admins exist without giving them
unrestricted power over who else gets admin access, a second flag, `is_super_admin`, was added:
any admin can use the panel itself, but only a super-admin can grant or revoke someone else's
admin access, or suspend another admin's account. Admin access is also restricted to a
`@lanceraos.com` email specifically, checked independently both when granting access and again at
every login — so even a mistakenly-set flag on the wrong account still can't be used to sign in.

There is deliberately no self-service way to create the first super-admin — that gate is the whole
point of `IsSuperAdmin`. The very first one is a one-time manual database step; every one after
that goes through the real, audited grant flow.

## v1 scope — what the admin actually needs to do

Settled early and built in full:

- Search and view any user's account — verification/2FA/suspension/deletion status, linked OAuth
  providers, onboarding state, terms acceptance.
- View and force-revoke a user's sessions.
- Suspend and reactivate accounts — a genuinely new capability, protected so a regular admin can
  suspend an ordinary user but never another admin, and nobody can suspend themselves.
- Grant/revoke admin access itself (super-admin only).
- A searchable, filterable audit log across every user — filterable by user, actor, event, date
  range, with the admin's own "viewed the log" actions excluded from the default view so they
  don't bury what was actually being looked for.
- The deletion queue — accounts currently in their 30-day recovery window, with an admin-assisted
  restore action.
- Resend a verification email — the classic "I never got the email" support request.

`ApiRequestLog` (the raw HTTP debugging log, distinct from `AuditLog`) was deliberately scoped
*out* of the admin UI — a developer tool, not an admin-facing one. This was proposed early and
never explicitly revisited or overturned, so it should be treated as the working assumption, not
as a fully closed decision.

## What was deliberately deferred

- IP allowlisting for admin access — a real option for tighter security, but breaks the moment
  someone's home IP changes or they travel; revisit only if there's a specific need for it.
- A self-service admin-registration flow — rejected outright, not just deferred. The real process
  is "one person who already trusts the new admin decides to grant them access," which the
  existing search-and-grant flow already covers.
- Cross-Account Protection (Google's RISC-based account-compromise notification system) — a real,
  optional, advanced feature; genuinely non-trivial to build (a dedicated verified webhook
  endpoint), and explicitly confirmed via Google's own documentation as optional, not a baseline
  expectation.
