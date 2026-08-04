Working With Ali — Read This First (same standing instructions as every module before this one:
explain before implementing, present real tradeoffs honestly, production-quality code from the
first line, push back with real reasons when something's the wrong approach, ask when genuinely
unsure rather than guess).

Before writing anything at all: read `CLAUDE.md`, `DECISIONS.md`, `DATABASE.md`, `STANDARDS.md`,
`DESIGN.md`, `ADMIN.md`, `ADMIN_PANEL_DESIGN.md`, `EMAILS.md`, and `USER_ADMIN_FEEDBACK_PLAN.md` —
all in this project's knowledge — using `project_knowledge_search`, not assumed from general
Django/React knowledge. This project has many specific, deliberate conventions that override
generic defaults, and the single most common mistake across the entire Users/Auth build was
treating something as already true without actually checking the real, current code first.

## What this chat is building

Module 2 — Invoices + Client CRM (`apps/invoices/`), per `CLAUDE.md` Section 5. The most important
module in the product: professional invoice creation (USD/EUR/GBP/PKR, line items, tax/discount,
PKR-equivalent display, three PDF templates via WeasyPrint, email delivery via Resend), the invoice
status lifecycle (`draft → created → sent → viewed → partially_paid → paid → overdue → cancelled →
bad_debt`), partial payments, and the client CRM + client portal underneath it. Read `CLAUDE.md`'s
full Module 2 section for the complete scope before starting.

Old v1 source files for this module have been uploaded separately to project knowledge as
reference material for porting real, working behavior — not part of the actual v2 codebase.
`project_knowledge_search` should treat the real GitHub-synced repo as ground truth for what
currently exists; the v1 files are for "how did this actually work before," the same way v1 files
were used throughout the Users/Auth build.

## Hard-won lessons from the Users/Auth build — apply these from message one, don't rediscover them

**Verify against the real repo, every time, no exceptions.** This was, by far, the single most
recurring category of mistake across the entire prior build — treating a designed-but-never-built
field as already real (which nearly broke every `AuditLog` write in the app), assuming a CORS
origin was configured when it wasn't, confusing two similarly-named permission flags in a frontend
display, and — worst of all — two entire reference documents (`ADMIN_PANEL_DESIGN.md`,
`USER_ADMIN_FEEDBACK_PLAN.md`) being cited constantly across dozens of decisions despite never
actually existing in the repository. Before asserting that anything already exists, works a
certain way, or was already decided, search for it and confirm. If it can't be found, say so
plainly rather than proceeding on an assumption.

**Docs get updated as part of finishing the work, not in a deferred catch-up pass.** The entire
reason this kickoff document needed such an extensive verification pass before being written is
that documentation updates fell behind actual code for an extended stretch — `ADMIN.md` still
showed a fully-built, audited admin panel as "not yet built" for a long time after it was actually
done. Every prompt that changes real behavior should include the matching `DECISIONS.md` entry (and
`DATABASE.md`/`ADMIN.md`/`EMAILS.md` updates where relevant) in the same round, not saved up.

**Every prompt needs its own commit message, provided separately from the Claude Code prompt
itself** — Ali syncs to GitHub after each change and needs this to keep the repo and this chat's
understanding of it in sync. Don't skip this, and don't bundle multiple prompts' worth of commits
into one vague message.

**Security patterns already established — apply them from the start, not as a later audit finding:**
- Explicit field allowlists in serializers, never `Meta.exclude` (a critical vulnerability was
  found this way once already — an excluded-field approach silently let a mass-assignment bypass
  through).
- Every state-changing endpoint gets real rate limiting decided *at build time*, not left for a
  dedicated audit pass to discover missing later (five real gaps — including a completely
  unthrottled arbitrary-SMTP-relay endpoint — were found this way and shouldn't have needed a
  separate pass to catch).
- Backend enforcement always, never a frontend-only guard — a hidden button is a UX nicety, not a
  security boundary. Every frontend restriction in this project has a matching, independently
  tested backend check.
- Timing-safe comparisons wherever "does this record exist" could leak information through response
  latency (the pattern already established in `apps/users/views/auth.py`'s dummy-hash checks).
- Admin actions log both success *and* denial — a regular admin being correctly rejected from a
  super-admin-only action should leave a real audit trail entry, not silence. Apply this from the
  start for Invoices' own admin capabilities, not as a later fix.

**The admin panel is a living, per-module pattern, not a one-time project.** Per `ADMIN.md` and
`ADMIN_PANEL_DESIGN.md`: Invoices needs its own admin screen (what would an admin need to
search/view/act on for invoices and clients?) built *as part of* finishing this module, reusing
the already-established conventions — `AdminCookieJWTAuthentication`, the `IsSuperAdmin` permission
class where relevant, the `_admin_action_rate_limited` pattern, `log_event(..., actor=...)` for
admin-initiated actions. Update `ADMIN.md`'s per-module coverage table as part of this work, in the
same round it's actually built — this is the exact discipline that broke down last time and
required a large, avoidable cleanup pass to fix.

**Testing conventions already established, don't reinvent:** `Client(enforce_csrf_checks=True)`,
manual CSRF via `RequestFactory` + `get_token()`, standard test password `'Sup3r$ecret1'`, two
separate `Client()` instances for two-devices tests, mock at the *importing* module
(`@patch('apps.invoices.views.some_module.send_something_email')`, not where it's originally
defined), the global `SafeTestRunner` already patches outbound email/HTTP calls project-wide.
`STANDARDS.md` has the complete list — read it, don't guess.

**Verification means real, not just green checkmarks.** Every significant piece of work in the
prior module was verified against a real running server — real HTTP requests, real database
queries after the fact, real browser sessions where relevant — not just "the test suite passes."
When a fix doesn't actually solve the stated problem (this happened twice: an `AddPassword.jsx` fix
that silently broke the exact flow it was meant to fix, and a test with a false-positive selector
that would have passed even against broken code), the right response is catching it and saying so
plainly, the same way it was caught both times here — not smoothing it over.

## One open question worth resolving early, not late

`ADMIN.md` notes that whether `ApiRequestLog` (the raw HTTP debug log) belongs in the polished
admin UI was proposed once, early, and never explicitly revisited — treat it as the working
assumption (no, keep it out) unless there's a real reason to reconsider for this module
specifically.
