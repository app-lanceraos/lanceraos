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

---

Date: July 2026
Decision: Added GET /api/auth/csrf/ endpoint.
Reason: Discovered during frontend integration that no view ever called get_token(), so Django's
CSRF cookie was never actually sent to the browser — every authenticated mutating request from the
frontend would have failed with "CSRF cookie not set." This endpoint exists purely to trigger that.
Alternatives considered: Decorating every view with @ensure_csrf_cookie (rejected — one dedicated
endpoint the frontend calls once on load is simpler than touching every view).

---

Date: July 2026
Decision: Production frontend is served at the bare root domain `lanceraos.com`, not `app.lanceraos.com`.
The backend API keeps its own subdomain, `api.lanceraos.com`, unchanged. `COOKIE_DOMAIN=.lanceraos.com`
still covers both, so the SameSite=Lax cookie-sharing reasoning from the original cookie-architecture
decision above is unaffected — only which subdomain the frontend itself lives on changes.
Reason: Product decision — users should land on the plain root domain when they visit the site, not a
subdomain, since `app.` reads as a secondary/internal surface rather than the product itself.
Alternatives considered: Keep `app.lanceraos.com` for the frontend (rejected per this product decision).
Also considered serving both frontend and backend from the exact same origin with no subdomain split at
all (rejected — Vercel/Railway hosting are still two separate deployments; a shared registrable domain
via subdomains is what actually makes SameSite=Lax cookies work across them, not a single shared origin).

---

Date: July 2026
Decision: Profile and Settings are two separate pages/routes (`/profile`, `/settings`), not one combined
page. Profile holds only light personal identity (logo, display name, business name, phone, a completion
indicator). Settings holds 7 sections: Account, Business, Tax & PSEB, Security, Sessions, Notifications,
Email Sending (SMTP).
Reason: Explicit product direction — v1's single monolithic Profile page mixed "who you are" with "how
the account behaves," which reads as unpolished for a commercial SaaS product; every comparable product
(GitHub, Stripe, Linear, Notion) splits these. Also let each section adopt independent dirty-state
tracking and its own save call, rather than one giant form/save button covering everything.
Alternatives considered: Keep v1's single-page structure (rejected per the product direction above);
a single page with client-side tabs for everything including Profile fields (rejected — conflates two
different mental models, "who I am" vs. "how my account works," into one navigation surface).

---

Date: July 2026
Decision: `Settings.jsx` is a thin shell (~100 lines: tab nav + a single shared `GET /auth/profile/`
fetch) importing 7 section components from `src/pages/settings/`, rather than one large file containing
all section logic inline.
Reason: All 7 sections' logic combined would have put a single file well past 1,000 lines. Splitting by
section means a bug in, say, the SMTP form only requires opening `SmtpSection.jsx`, not scrolling through
every other section's code to find it. Business and Tax share one lifted `profile` fetch (passed down as
props) specifically because they both read/write the same `FreelancerProfile` object — switching between
those two tabs doesn't re-fetch, and a save in one is immediately visible in the other without a reload.
Alternatives considered: One large `Settings.jsx` with all 7 sections inline (rejected — the 1,000+ line
outcome above); each section fetching its own copy of the profile independently (rejected — would cause
Business and Tax to silently go out of sync with each other within the same session).

---

Date: July 2026
Decision: Five new shared React components exist for authenticated app pages — `Card.jsx`,
`FormField.jsx`, `FormSelect.jsx`, `FosAlert.jsx`, `SaveButton.jsx` — amending DESIGN.md Section 12's
"do not create new shared utility components" rule.
Reason: `FormField`/`FormSelect`/`FosAlert`/`SaveButton` wrap the already-sanctioned `.fos-*` CSS classes
rather than introducing new visual rules — they only extract the repeated label+input+error-message JSX
*structure* that all 7 Settings sections and Profile would otherwise each hand-roll independently.
`Card` is a genuine new structural component (title/subtitle/action bordered container), justified
because duplicating that exact structure inline across 8 files would itself violate STANDARDS.md's
single-source-of-truth rule — the two project rules were in direct tension here, and consistency-via-a-
thin-wrapper won over strict adherence to "no new components."
Alternatives considered: Duplicate the card/field markup inline in every section (rejected — the direct
STANDARDS.md conflict above); build these as a bigger, more generic component library (rejected — scope
was kept to exactly what Settings/Profile needed, not speculative future generality).

---

Date: July 2026
Decision: `AuthField.jsx`'s floating label was rebuilt from a JS-state-driven approach (tracking
focus/value in React state, no CSS pseudo-classes) to a CSS-native approach using
`:not(:placeholder-shown)` + a `::before` notch to hide the input border behind the floated label.
Reason: The CSS-native technique is the standard, well-established way to solve this exact problem, and
(like the `-webkit-autofill` override already in this file) it genuinely cannot be replicated via inline
styles or JS alone. This was authored directly by Ali rather than through the earlier build process; it's
a real improvement over the JS-state version, which needed an inline `background`-patch hack behind the
label to achieve a similar (less clean) visual result.
The floated-label `left` position is always `0.75rem`, regardless of whether the field has a leading icon
— this was flagged as a bug during review (reasoning that on icon fields the label would land underneath
the icon) and briefly "fixed" to an icon-aware value, but that reasoning was wrong and got corrected back.
The icon sits at `top: 50%` (vertically centered in the input); the floated label moves to `top: 0` (the
border line) — different heights entirely, so the two never actually overlap regardless of their
horizontal positions. The leftward slide toward the icon's x-position as the label floats up to the
border is an intentional, liked visual effect, not a collision. Left as originally authored. Covered by
`AuthField.test.jsx`, which asserts the same `0.75rem` value applies with or without an icon.
Alternatives considered: Icon-aware floated position (implemented briefly, reverted — solved a collision
that doesn't actually happen); fade the icon out on float (not implemented — the current behavior is
preferred as-is).

---

Date: July 2026
Decision: `AppShell.jsx` was rebuilt as a full, v1-faithful port — every nav group/item from v1 is
present (Dashboard, Invoices, Clients, Payments, Expenses, P&L, Tax, Proposals, Contracts, Health,
Income Certificate, Skill Analyzer), including for modules that don't exist yet. Profile/Settings/Help
moved back into the profile popup (matching v1), out of the main sidebar nav where an earlier, more
conservative version of this file had placed them. The notification bell + panel UI is included and
fully wired on the frontend side, with no backend behind it yet.
Reason: Explicit product direction — build out the complete v1 UI now rather than waiting for each
module to exist first, since the goal is to create as much of the intended product as possible before
returning to build out individual modules. Clicking a nav item for an unbuilt module resolves to a route
`App.jsx` doesn't recognize and redirects harmlessly to `/profile` — no crash, no dead page, just an
inert link until that module's route exists. `GET /notifications/` (and friends) 404 today; the failure
is caught and simply renders the same "No notifications yet" empty state a genuinely-empty inbox would
show — no WebSocket connection is attempted, since there is nothing to connect to.
v1's notification-type icons and its empty-state icon were bare emoji characters (🔔 👁 ✅ ⏰ etc.) —
replaced with `lucide-react` icons here, per the no-emoji rule; this is the one deliberate departure from
strict v1 fidelity in this pass.
The AI assistant widget from v1 was NOT ported — no source file was ever provided for it, and it wasn't
requested for this pass.
Alternatives considered: Only include nav items for modules that already exist (the previous, more
conservative version of this file — superseded by this explicit product direction); build a fake/stubbed
notification backend just to give the bell live data (rejected — pointless complexity for a UI element
that's explicitly acknowledged as inert for now).

---

Date: July 2026
Decision: The App Shell (header, sidebar, nav, profile popup) now has genuinely distinct light-mode and
dark-mode colors, reversing the original design decision (`theme.css`'s own comment used to read "sidebar/
header stay dark; main content follows --bg-page"). All shell-affecting tokens were consolidated into one
clearly-labeled `APP SHELL` block in each of `theme.css`'s two theme sections (`:root, [data-theme="light"]`
and `[data-theme="dark"]`) — nowhere else in the codebase defines a shell color.
Also found and removed during this consolidation: a `--shell-bg`/`--shell-text`/`--shell-border`/
`--shell-active-bg`/`--shell-active-text`/`--shell-icon-muted` token family that was completely dead code
— defined with different-but-both-still-dark values in each theme block, but never actually referenced by
`AppShell.jsx` or any other component (which uses `--bg` for the same purpose). Two overlapping token
systems for the same concept, where only one was real, is exactly the kind of confusing setup that made a
single source of truth hard to find — removed rather than kept as an alias, per STANDARDS.md's "dead code
is worse than no code" rule.
Reason: Explicit product direction — light mode should look genuinely light, including the shell, not a
marginally-different shade of the same dark palette forced onto it regardless of the theme toggle.
A real bug was introduced and fixed while making this edit: the light-mode `APP SHELL` block's closing
brace was accidentally placed mid-block (splitting the "Misc" and "Form elements" sections that were
meant to be the same CSS rule into two), which `vitest` never caught (it doesn't parse CSS) but a real
`vite build` did, failing with a PostCSS syntax error. A second, similar error followed: a code comment
containing the literal substring `--glass-*/--logo-*` accidentally closed the CSS comment early (`*/`
appearing mid-sentence), leaving "layout tokens are..." as invalid CSS outside any comment. Both are fixed
now; this is a good example of why a real `vite build` (not just the test suite) is worth running after
any theme.css edit — CSS syntax errors are invisible to JS-level tests entirely.
Alternatives considered: Keep `--shell-bg` etc. as an alias pointing at `--bg` for backward compatibility
(rejected — nothing external references it, so an alias would just be more dead code, not less).

---

Date: July 2026
Decision: Hovering any element with a tooltip (the sidebar collapse toggle, notification bell, theme
switch, collapsed-rail nav icons) now waits 500ms before the tooltip appears, instead of showing instantly.
Reason: Explicit product direction — instant tooltips felt like visual noise on every hover, not just
intentional dwelling. Implemented via a `setTimeout` gate in `useAppTooltip.js` for the JS-driven singleton
tooltip system, and via CSS `transition-delay: 0.5s` on the collapsed-rail tooltip's `:hover` rule (a
separate, pure-CSS mechanism keyed off `data-tip`, distinct from the JS one keyed off `data-tooltip`) —
both needed the same delay added, since they're two different mechanisms serving different UI spots.
Alternatives considered: A single unified tooltip mechanism instead of two (rejected — out of scope for
this change; the collapsed-rail tooltip's pure-CSS approach exists for a reason, likely performance with
many rail icons, and unifying it wasn't asked for).

---

Date: July 2026
Decision: Settings and Profile no longer cap their content width (previously `maxWidth: 1100`/`900`) —
they now fill 100% of whatever width `AppShell`'s main content area provides.
Reason: On wide viewports, a fixed max-width capped well short of the actual available space, leaving a
large empty gap on the right within the shell's main content frame — exactly the "ends in the screen
middle" complaint. `AppShell`'s inner content div already supplies its own responsive padding (`32px`
desktop / `20px 16px` mobile), so the pages themselves no longer need their own width cap or padding.
Alternatives considered: A smaller, deliberate max-width (e.g. 1400px) for readability on very wide
monitors (not implemented this pass — not requested, and the `repeat(auto-fit, minmax(240px,1fr))` grids
inside Settings already reflow into more columns rather than becoming unreadably wide single-column rows).

---

Date: July 2026
Decision: Ran a two-pass security audit (checklist-style, then attacker-scenario tracing) against
the full Users/Auth codebase before building further modules on top of it. Findings and fixes below;
this entry exists so the reasoning behind each fix — and one genuinely unresolved item — survives
past this conversation.

**Critical — fixed.** `FreelancerProfileSerializer` used `Meta.exclude` rather than an explicit
`fields` allowlist, which meant `onboarding_completed` and every `custom_smtp_*` field were
ordinary writable fields on `PUT /api/auth/profile/`. Since OAuth signups (Google/Facebook never
supply a birthday) are only age-checked once, inside `OnboardingSerializer`, this meant
`PUT {"onboarding_completed": true}` was a one-request bypass of the platform's mandatory 16+ age
gate — the single most serious finding across both audit passes. Fixed via `read_only_fields` on
the affected fields, then hardened further to reject (400) rather than silently no-op (200) an
attempted write to them, so a bypass attempt is distinguishable in logs from an innocent mistake.
`pseb_registered` has the identical structural issue (self-declarable with no corroborating check)
but was deliberately NOT locked down the same way — it backs a legitimate, currently-working
"I am registered with PSEB" checkbox in Settings > Tax. Note for whenever the Tax module is built:
SRO 586 eligibility logic must derive PSEB registration from `bool(profile.pseb_hash)` (a real,
validated PSEB number on file), never from this self-declared flag alone.
Alternatives considered: Rewrite the whole serializer to an explicit `fields` allowlist immediately
(rejected for this pass — larger diff, real risk of accidentally omitting a field the Business/Tax
UI currently depends on; `read_only_fields` closes the actual hole with a much smaller, safer diff).

**High — fixed.** `send_new_device_login_email` interpolated the raw, attacker-controlled
`User-Agent` header (and IP) directly into unescaped HTML (this module hand-builds HTML via
f-strings, no template-engine autoescaping). Exploitable by anyone who already has valid credentials
for an account (phishing, credential stuffing, a leaked password) — they could log in with a crafted
`User-Agent` and have LanceraOS's own legitimate "new sign-in" email deliver attacker HTML into the
real victim's inbox, at exactly the moment a takeover victim is primed to click a "secure your
account" link. Fixed by using the already-sanitized `ua_normalized` string instead of the raw
header, plus `django.utils.html.escape()` on both values as defense-in-depth. A second, identical-
class instance was found and fixed while checking for others: `send_email_changed_notification_to_old`
interpolated `new_email` unescaped, and the regex validating it (`^\S+@\S+\.\S+$`) doesn't exclude
HTML metacharacters — replaced with Django's real `validate_email`, plus `escape()` at the
interpolation site too.

**High — fixed.** Login was vulnerable to timing-based user enumeration: the "user not found" path
returned immediately after a DB lookup, while "wrong password" ran a real Argon2 hash (deliberately
slow by design) — identical response bodies, measurably different response times. Fixed by running
a precomputed dummy Argon2 check on the not-found path too. Verified empirically (10 samples each
side through the real view): medians landed within ~1ms of each other post-fix, versus an isolated
~30ms gap (bare DB miss vs. the dummy Argon2 check) that existed before — confirms the fix actually
closes the timing gap, not just theoretically.

**High — fixed, but with a genuinely unresolved dependency.** `get_client_ip()` trusted
`X-Forwarded-For`'s first entry unconditionally — fully client-controlled, defeating IP-based rate
limiting on `register`/`check_availability` (no account-scoped backstop exists for those) and
poisoning `Session.ip_address`/the audit trail. Fixed to trust the last entry instead, matching
standard reverse-proxy convention (nginx, AWS ALB, etc.).
**Open item, deliberately not treated as resolved:** which position (first or last) is actually
trustworthy for this app's specific Railway deployment is unconfirmed — Railway's own staff
contradict each other across multiple community support threads (one says "rightmost is real,"
another says "leftmost is real" while also claiming their edge "appends" — internally inconsistent
with itself — a third says the same, contradicted by a user in the same thread who received IPs
that included neither position). Railway's own docs say nothing about `X-Forwarded-For` handling at
all. `X-Real-IP` was considered as an alternative and rejected — Railway has a known, admitted bug
where it reflects a CDN edge IP instead of the real client IP when Fastly sits in front of a
deployment. The "trust the last entry" fix is kept as the safer default of the two options
regardless of which is correct (it's strictly better than the previous unconditional-first-entry
trust either way), but **this needs empirical verification against the actual production deployment
before it should be fully trusted** — log the raw header for a real request, send one request with
a known spoofed value from an external client, and confirm which position holds the genuine IP. A
support ticket to Railway for a current, authoritative answer is also worth filing, since community
threads alone aren't a reliable foundation for a security control and Railway's edge behavior may
have changed over time or depend on whether a CDN is in the path for a given deployment.
Alternatives considered: Do nothing until Railway's answer is confirmed (rejected — the previous
code was unambiguously wrong regardless of which position turns out to be correct, so shipping the
improvement now rather than waiting is the right call); trust neither header and only use
`REMOTE_ADDR` (rejected — if a reverse proxy genuinely sits in front of Django in production,
`REMOTE_ADDR` would just be the proxy's own IP for every request, losing client-IP info entirely
rather than gaining reliability).

**High — fixed.** Django admin (`/admin/`) had none of the app's own brute-force protections
(account lockout, rate limiting) despite being the highest-privilege path in the system. Added
`django-axes` (`AXES_FAILURE_LIMIT = 5`, `AXES_COOLOFF_TIME = 1` hour, keyed on
`['username', 'ip_address']`). Verified against a throwaway superuser: locked out on the 5th failed
attempt (axes intercepts before the 5th credential check even runs, not only starting at the 6th —
stricter than initially specified, not looser), and confirmed a subsequently-correct password is
also rejected while locked out (genuine account/IP lockout, not just another failed-credentials
response).
Alternatives considered: Hand-roll admin-specific rate limiting reusing the app's own cache-based
throttle pattern (rejected — `django-axes` is a well-tested, widely-used library for exactly this
problem; reimplementing it custom would be re-deriving the same logic for no benefit, the same
reasoning already applied to rejecting `django-allauth` for OAuth elsewhere in this file).

**Medium — not yet fixed, scoped for a following pass:** a TOCTOU race on the 3-session cap
(`Session.create_for_user` has no `select_for_update()`/atomic wrapping — concurrent logins for the
same user can produce 4+ live sessions, one over the documented cap); `forgot_password` has no
per-email throttle (only per-IP, unlike every sibling endpoint in the same file — `resend_verification`,
`initiate_deletion`, `request_email_change` all correctly key on the user/email too) and calls the
Resend API synchronously inline, which is a larger timing oracle than the login one just fixed
(tens-to-hundreds of ms of a real network round-trip, versus Argon2's single-digit-to-tens of ms of
local CPU work) — the same uniform-response-body claim ("If an account exists...") is only true of
the body, not the timing, for this endpoint specifically.

---

Date: July 2026
Decision: Admin panel work is sequenced as "foundation now, incremental per-module after" — not
built as one project after the entire product is done, and not built as a single monolithic push
right now either.
Reason: Waiting until the whole product ships would leave a real operational gap the moment
Invoices/Payments exist — real users, real money, and zero way to look up an account or investigate
a support request in the meantime, which is a genuine risk for a financial product, not a
nice-to-have deferral. Building the entire admin panel immediately is equally wrong in the other
direction — there's nothing to administer yet beyond Users/Auth, and building screens for modules
that don't exist yet is the same "Payments tab" mistake already made and corrected once earlier in
this project. The chosen middle path: foundational, module-independent infrastructure
(`can_access_admin_panel`, the `AuditLog.actor` field, the separate `admin.lanceraos.com` session
mechanism, and Users/Auth's own admin screens) gets built now, since none of it depends on any
future module. Every subsequent module then builds its own admin screen as part of finishing that
module — the same incremental-growth philosophy already established for `AppShell`'s sidebar,
applied to admin instead of navigation. Tracked in the new `ADMIN.md` (separate from
`ADMIN_PANEL_DESIGN.md`, which holds the original design reasoning) — a living per-module status
table so future module chats have the established patterns in front of them rather than each
inventing its own admin conventions in isolation.
Alternatives considered: Defer all admin work to a dedicated chat after the full product ships
(rejected — the operational-blindness risk above); build the complete admin panel now, ahead of any
other module (rejected — nothing to administer yet for modules that don't exist).

---

Date: July 2026
Decision: A premium/paid tier is sequenced as "minimal data-model hook now, real billing/gating
logic deferred" — and treated as an entirely separate timing decision from the admin panel above,
not bundled with it despite both being "big cross-cutting" questions.
Reason: A `plan`/`tier` field on the relevant model, even with `'free'` as the only value in active
use for a long while, is a trivial addition today and a genuinely painful retrofit later if many
features get built first with no tier-awareness anywhere in the codebase. Actual billing integration
(payment processing, feature-gating, upgrade/downgrade flows) is deliberately deferred until there's
enough of the real product built that "premium" has validated content to actually sell — building
that machinery now would mean guessing at a business model with nothing to hang it on yet, a common
early-stage-SaaS failure mode. Note: the security audit's own findings already used the phrase
"any authenticated free-tier user" before this concept was explicitly defined anywhere, suggesting
a tier system was already being implicitly assumed — this decision makes that assumption real and
minimal, rather than leaving it implicit.
Alternatives considered: Build full billing/tier logic now, ahead of the modules a premium tier
would actually gate (rejected — nothing concrete to sell yet, high risk of designing the wrong tier
boundaries before real usage data exists); add no tier concept at all until a premium tier is
actually being launched (rejected — the retrofit cost of adding tier-awareness after many
tier-blind features exist is real and avoidable for the cost of one field today).

---

Date: July 2026
Decision: Every remaining actionable item from both security audit passes (`SECURITY_AUDIT.md`,
`SECURITY_AUDIT_PASS2.md`) was closed in a single consolidated fix pass. Specifics:
SMTP-test endpoint now rejects private/loopback/link-local targets before connecting (closes the
SSRF-adjacent finding) and no longer echoes raw exception text (specific `smtplib`/`socket`/`ssl`
exceptions mapped to safe messages, real exception logged server-side); Cloudinary upload failures
same treatment; logo upload now verifies actual file content via Pillow (`Image.verify()`) rather
than trusting the extension alone, and SVG was dropped from the allowed list entirely; the three
`!=` token comparisons in `security.py` replaced with `hmac.compare_digest`; every `NO_AUTH` POST
view now explicitly enforces CSRF via a new `enforce_csrf_standalone()` helper, independent of
`SameSite`'s incidental protection (this required updating seven existing test files to attach a
CSRF token before posting — the full 72-test suite was restored to passing, not left broken);
`Session.create_for_user` wrapped in `transaction.atomic()` with `select_for_update()`, closing the
concurrent-login race (verified with a 10-thread test: 7 sessions produced without the fix, exactly
3 with it); `forgot_password` gained a per-email throttle alongside its existing per-IP one, and
both it and `resend_verification`'s email sends moved onto Celery tasks, closing the timing-oracle
gap those synchronous sends created; `djangorestframework-simplejwt`/`daphne`/`cryptography` bumped
to CVE-patched versions; `.env.example`'s `DEBUG` default flipped to `False`.
Not fixed, deliberately deferred: the `react-router-dom` `npm audit` finding (a downgrade to a
SemVer-major-older version) — this needs a direct discussion before acting, not an automated fix,
since a downgrade risks breaking working features for a CVE (an RSC-mode CSRF bypass) that likely
doesn't even apply here, given this app doesn't use RSC mode.
Also confirmed (no changes needed): `linked_providers` on `UserSerializer` and the optional-
`last_name` validation, both requested in an earlier round, were already correctly in place —
verified directly rather than assumed.

---

Date: July 2026
Decision: Fixed a real bug where logging into an account with a scheduled deletion never showed
the "restore or continue?" modal at all — it silently landed on `/profile` instead, with no
warning the account would still be deleted on schedule.
Reason: `Login.jsx` calls `loginSuccess(data.user)` before it checks `data.deletion_pending` —
the moment that call runs, `isAuthenticated` flips to `true` in the shared store, and
`PublicRoute` (wrapping `/login`) reacts immediately with `<Navigate to="/profile" />`,
unmounting `Login.jsx` before its own deletion check and modal render ever get a chance to run.
Both pieces of code were individually correct; the bug only existed in the untested interaction
between them — a race between a route guard reacting to global state and a page component
reacting to the same state one tick later. Fixed by having `PublicRoute` also check the store's
existing `deletionScheduledAt` value (already correctly populated by `loginSuccess`, just never
consulted here) and skip its auto-redirect when it's set, deferring to `Login.jsx`'s own
navigation once the user makes an explicit choice.
Also changed, based on further review: "Continue with deletion" used to leave the user fully
signed in, with deletion still scheduled in the background — a "logged in but marked for
deletion" limbo state with no clear product purpose (no data-export feature exists to justify
continued access) and a whole category of unasked edge-case questions it would otherwise force
(can a soon-to-be-deleted account still change its email? Upload a new photo?). Changed to sign
the user back out immediately (revoking the session this same login just created) and return
them to `/login` with a dated confirmation message — the deletion schedule itself is untouched
either way; only whether they get a working session changes.
Alternatives considered: Auto-cancel the deletion on any successful login (rejected — an
incidental action like logging in shouldn't silently reverse a deliberate, deliberate-to-undo
decision; the explicit two-button choice puts the actual decision in the user's hands via an
unambiguous action).

---

Date: July 2026
Decision: Celery established from scratch on a new local development machine (a Mac, replacing
the Windows setup v1 was built on) — worker and Beat were previously never running locally on
this machine at all, meaning every scheduled background task (account anonymization, trusted-
device/session/email-change-request cleanup) had silently never executed, despite the schedule
itself already being correctly configured in `config/celery.py`.
Found and worked around: Celery's worker crashes on this Mac the moment it tries to fork a child
process to run a task (`WorkerLostError: signal 6 (SIGABRT)`) — a known macOS issue where Apple's
Objective-C runtime doesn't tolerate being forked into after certain frameworks initialize, not a
Celery bug. Fixed by setting `OBJC_DISABLE_INITIALIZE_FORK_SAFETY=YES` when starting the worker.
This needs to be set every time the worker starts on this machine — see CLAUDE.md's new
"Running This Locally" section.
Also found: `requirements.txt` pins `celery==5.4.*`, but the venv actually has `5.6.3` installed
and is what was verified working end-to-end (real task dispatched through a real Redis queue,
consumed by a real worker, account genuinely anonymized). A clean `pip install -r requirements.txt`
right now would install a different, never-actually-tested minor version. Not yet fixed —
flagging as a known, real drift to close out (bump the pin to match what's verified) rather than
silently carrying forward.
Decision: worker and Beat run manually alongside `runserver`, not as permanent background
services, for now. Reasoning: only one module exists, the beat schedule has 4 infrequently-
relevant entries, and a worker silently executing stale code because it was forgotten to be
running is a worse failure mode during active development than remembering to start it. Redis
itself does run as a permanent background service — it's stateless infrastructure, not
application code, the same distinction that puts `runserver` in the "start manually" bucket too.
Revisit once more modules land and scheduled tasks are relied on constantly rather than only
when deliberately testing this specific area.

---

Date: July 2026
Decision: Two real, related bugs fixed in `api.js`'s CSRF/session handling, both surfaced by
literally reading the browser console rather than assuming "no visible malfunction" meant nothing
was wrong.
First: the silent-refresh call inside the response interceptor used a raw `axios.post(...)` that
bypassed the CSRF-cookie-ensuring logic already built for the main `api` instance — meaning it
never attached a CSRF token, and since `/auth/token/refresh/` correctly enforces CSRF (from an
earlier security pass), this call would always fail with 403 unless a CSRF cookie happened to
already exist from some earlier request. Concretely: a returning user whose 15-minute access
token expired while their 30-90 day refresh token was still genuinely valid would get silently,
incorrectly logged out — not because their session was actually invalid, but because one specific
network call forgot to attach a header every other call already attaches correctly. Fixed by
routing this call through the same `ensureCsrfCookie()` helper before firing it. Verified with a
real before/after contrast on the same account (git-stashed the fix to prove the bug was real: 403,
silent logout, landed at `/login`; restored the fix: 200, session preserved, same page after reload).
Second, a related but distinct finding from asking "why does Google not show this but we do":
every page load was firing a `GET /auth/me/` (and, before the first fix, a resulting refresh
attempt) even for a completely fresh, never-logged-in visitor — technically correct behavior
(checking auth status), but avoidably noisy, and the noise was masking the real bug above by
making it look like "normal" console clutter. Fixed by adding a small, deliberately non-httpOnly
"session hint" cookie (`lanceraos_has_session`, carrying no secret — just `'1'`) set/cleared
alongside the real httpOnly auth cookies. The frontend checks for this hint first; if absent,
it skips the `/auth/me/` call entirely rather than firing it and getting back an expected-but-
noisy 401. This does not weaken the httpOnly protection on the real access/refresh tokens in any
way — the hint cookie carries nothing worth stealing even if read by an XSS payload, and was
verified to leave the actual token cookies' httpOnly flag untouched throughout.
Alternatives considered: Leave the `/me/` 401 as unavoidable noise (rejected once the actual
technique — a non-secret hint cookie — was properly considered, rather than assumed away).

---

Date: 02 August 2026
Decision: Fixed a real bug where toggling light mode anywhere in the app would corrupt the
auth pages' wordmark (turning it near-black, invisible against the auth pages' permanently-black
background) the next time a user landed on `/login` or similar.
Reason: `WordmarkSVG` (shared between `AppShell` and the auth pages, per DESIGN.md's Brand Assets
reference) renders using `var(--wordmark)` — a genuinely theme-dependent CSS custom property,
correctly designed for `AppShell`'s own theme-following shell. Since CSS custom properties are set
globally on `<html>`/`<body>` and cascade regardless of which page is currently rendered,
whichever theme was last active anywhere in the app leaked onto the auth pages too — which are
explicitly supposed to be fully theme-independent (a fixed, deliberate design decision already on
record: pre-login pages have no session or established user preference for "theme" to even
represent). Fixed by locally overriding `--wordmark` (and, defensively, `--logo-body`/
`--logo-mark`, which are already theme-invariant globally but pinned here too against that ever
changing) inside `.auth-orbit`'s own CSS rule in `AuthLayout.jsx` — a scoped override, not a
change to the shared `Brand.jsx` component, which correctly stays theme-aware for its other use
inside `AppShell`.
Alternatives considered: Design a full parallel light-mode palette for the auth pages (rejected —
a logged-out visitor has no established preference for a "theme" to reflect in the first place;
the original fixed-palette design was deliberate and the bug was a genuine leak of stale global
state, not evidence that a light variant was ever wanted here).

---

Date: 02 August 2026
Decision: Terms of Service / Privacy Policy acceptance is now recorded server-side
(`User.terms_accepted_at`, `User.terms_version`), not just gated by a frontend checkbox.
Reason: a checkbox that only exists in the UI isn't a real requirement — a direct API call to
`POST /auth/register/` would bypass it entirely, and there would be no record that anyone had ever
agreed to anything, which matters both for basic correctness and if terms are ever disputed.
`terms_version` records which version of the terms was agreed to (`CURRENT_TERMS_VERSION` in
`apps/users/constants.py`) — existing users are never forced to retroactively re-accept when this
bumps, but the historical record of what they agreed to at the time is preserved.
Also closes a related gap: OAuth signups (Google/Facebook) skip the registration wizard entirely
and previously had no acceptance mechanism at all. Handled via the existing mandatory-onboarding
flow — `OnboardingSerializer` requires `agreed_to_terms` only when `not user.terms_accepted_at`,
so an OAuth user is asked exactly once, during onboarding, while an email/password user (already
accepted at registration) is never asked again.
One real bug caught during implementation, not left for later discovery: `UserSerializer` didn't
expose `terms_accepted_at` at all, which would have made `Onboarding.jsx`'s `!user?.terms_accepted_at`
check always evaluate true — showing the checkbox again to every user, including ones who'd
already correctly accepted at registration. Fixed by adding the field to `UserSerializer.Meta.fields`
before this could ship as a real, if minor, annoyance for the first email/password user to go
through onboarding.
Alternatives considered: Rely on the frontend checkbox alone (rejected — provides no actual legal
or practical protection, since it's trivially bypassable via a direct API call).

---

Date: 02 August 2026
Decision: The `react-router-dom` `npm audit` finding (a CSRF-bypass vulnerability specific to RSC —
React Server Components — mode) is left as-is, not downgraded.
Reason: This app doesn't use RSC mode anywhere, so the actual exposure is very likely nil. The only
available fix is downgrading to an older version, which carries a real risk of breaking working
routing behavior that the entire frontend was built and tested against the current version for —
a concrete cost to fix a vulnerability whose applicability here is doubtful. Reviewed and
consciously accepted, not an oversight left unaddressed.
Alternatives considered: Downgrade anyway to eliminate the finding regardless of applicability
(rejected — the risk of introducing a real regression outweighs closing a finding that likely
doesn't apply to this app's actual usage).

---

Date: 02 August 2026
Decision: Built the WebSocket authentication foundation — `apps/users/ws_auth.py`'s
`CookieJWTAuthMiddleware`, wired into `config/asgi.py` alongside Channels' built-in
`OriginValidator`. Any future module (Invoices' client-portal chat, live notifications, etc.) can
now add its own consumer and inherit working, secure authentication for free, without needing to
touch `apps.users` code — the exact concern that originally motivated building this now rather
than deferring it to whenever the first real WebSocket feature arrives.
Deliberately reuses `CookieJWTAuthentication.get_validated_token()`/`get_user()` directly rather
than reimplementing token validation for the WebSocket context — this means a WebSocket connection
has identical security properties to an HTTP request, including the password-change invalidation
and session-revocation checks that already exist there, with no risk of a second implementation
quietly drifting out of sync with the first.
The middleware does not reject a connection outright when no valid token is present — it populates
`scope['user']` with either the real user or `AnonymousUser`, mirroring how
`CookieJWTAuthentication.authenticate()` returns `None` for the no-cookie HTTP case and lets
downstream code decide. Individual consumers are responsible for checking
`self.scope['user'].is_authenticated` themselves.
A minimal, explicitly-labeled test/reference consumer (`core/ws_test_consumer.py`,
`AuthEchoConsumer`) exists purely to prove this works end to end and to give whoever builds the
first real consumer a working pattern to copy — not a real product feature, safe to delete once a
genuine consumer exists.
Verified rigorously, not just claimed: a real Daphne server, a real HTTP login producing a real
cookie, that cookie reused over a real WebSocket connection with the echoed reply containing the
actual authenticated user's email; a tampered/expired token proven to behave identically to no
token at all (same rejection pattern, no crash); `OriginValidator` proven — via temporary
instrumentation inside the middleware, not just inferred from code structure — to reject a
mismatched-Origin connection *before* the auth middleware ever runs at all.
One real bug found and fixed during this verification: the reference consumer's original code
called `self.close(code=4001)` *before* `self.accept()` — per the ASGI spec, closing before
accepting means the handshake itself never completes, so the specific close code collapses into a
generic HTTP-level rejection rather than reaching the client as a real, readable WebSocket close
event. Fixed by accepting first, then closing with the code — the security behavior (unauthenticated
connections still get refused) was correct throughout; only the code's visibility to the client was
wrong.
Alternatives considered: Reimplement JWT validation independently for the WebSocket context
(rejected — real risk of the two implementations silently drifting apart over time, exactly the
kind of duplication this project has consistently avoided); reject unauthenticated connections at
the middleware level rather than deferring to each consumer (rejected — inconsistent with how HTTP
authentication already works in this codebase, where the authentication class itself never decides
whether authentication is *required*, only *who's asking*).

---

Date: 03 August 2026
Decision: Built the actual admin login flow on top of the foundation from the previous entry —
`admin_login`/`admin_verify_2fa`/`admin_logout`/`admin_refresh`/`admin_me` in `apps/admin_panel/`,
plus `issue_admin_tokens_and_session`/`rotate_admin_session` in a new `admin_panel/token_service.py`
mirroring the regular flow's exact shape.
Mandatory 2FA is enforced with no exception — an account with `can_access_admin_panel=True` but
`two_fa_enabled=False` is rejected outright at login, with a clear message to enable it via the
main app first, rather than the admin panel building its own separate 2FA-enrollment flow.
"Wrong password" and "not an admin account" deliberately return the identical error message and
status code — a distinct message would let someone probe which accounts have admin access at all,
independent of ever knowing the correct password for any of them.
Verified rigorously: the full 7-step flow (2FA-required rejection, real OTP email dispatch via
Resend's sandbox address, real `AdminSession` creation with no raw tokens ever in a JSON response
body, real authenticated `/me/` call, identical-message confirmation for both failure modes, real
session deletion on logout) — and, going beyond what was asked, a real regular-user access token
was captured from an actual `/api/auth/login/` call and presented as the admin cookie, confirming
`AdminCookieJWTAuthentication` genuinely rejects it via the missing `admin_sid` claim (not just a
differently-named cookie failing to match) — the exact token-type-confusion risk this whole
mechanism was designed to close.

---

Date: 03 August 2026
Decision / correction: `AuditLog.actor` — a field this project's own documentation has claimed
existed since the notification-bell work — never actually existed anywhere in the codebase until
now. It was designed then (a proposal in `ADMIN_PANEL_DESIGN.md`) and mistakenly treated as
already-implemented in later documentation and instructions, including a direct instruction to
modify `log_event()` to write to it. Applying that instruction as originally written would have
made every single `log_event()` call in the entire application raise `TypeError` and silently fail
to write any audit row at all — silently, because that failure sits inside `log_event()`'s own
blanket exception handler, meaning this would have gone completely undetected in production.
Caught correctly: rather than apply the diff on faith, the actual model and full migration history
were checked first, confirmed the field had never existed, and it was added properly (new
migration) before proceeding with the originally-requested `log_event()` change.
This is being recorded here plainly as a real process failure, not smoothed over: a design
proposal was mistaken for a shipped fact, that mistake propagated into `DATABASE.md` and at least
one prior `DECISIONS.md` entry, and it was only caught because a later step happened to touch the
same code and checked reality rather than trusting the accumulated record. `DATABASE.md` has been
corrected to reflect the real history.
The field is now genuinely real, backing the first actual admin action to use it: revoking a
user's session from the admin panel now correctly logs `user=<affected account>`,
`actor=<admin who did it>` — verified directly via database query, not just "a row exists."

---

Date: 03 August 2026
Decision: Built account suspension/reactivation — the one genuinely new admin capability, nothing
like it existed anywhere before this. Deliberately a separate set of fields
(`is_suspended`/`suspended_at`/`suspension_reason`) rather than reusing `is_active` (already used
by permanent anonymization — reusing it would make a suspended account indistinguishable from a
permanently deleted one) or `is_deleted` (the unrelated self-service deletion lifecycle).
A suspension takes effect on the affected user's very next request, not just future logins —
`CookieJWTAuthentication.get_user()` now checks `is_suspended` alongside its existing `pca`/`sid`
checks, and `suspend_user` additionally deletes every live `Session` row as defense in depth, so
there's genuinely nothing left to be "logged in" with, not just a check waiting to catch the next
request.
Verified with real rigor, not just the obvious path: an isolated test specifically proved the new
`is_suspended` check in `get_user()` fires independently of the session-deletion side effect (a
separate test user was suspended with their `Session` row deliberately left intact, and their
still-valid, non-revoked token still correctly failed on its very next request) — confirming the
new mechanism works on its own merits, not just riding along on an unrelated cleanup step.
Every edge case (suspending an already-suspended account, reactivating a non-suspended one,
suspending with no reason) returns a clean, explicit 400 rather than a silent no-op. Full existing
auth regression suite (119 tests) confirmed passing unchanged, since this touches shared
`authentication.py` code every login/refresh already depends on.

---

Date: 03 August 2026
Decision: Added a real two-tier admin permission model — `is_super_admin`, distinct from
`can_access_admin_panel`. Any admin can use the panel (search users, suspend/reactivate, view the
audit log); only a super-admin can grant or revoke someone else's admin access. Also enforces that
admin access can only ever be granted to a `@lanceraos.com` email, checked independently in two
places (at grant time, and again at every admin login) — so even if the flag were ever mistakenly
set on the wrong account some other way, login itself would still reject it.
Revoking access ends any of that person's live `AdminSession` rows immediately, and self-revocation
is explicitly blocked (a super-admin cannot revoke their own access).
There is deliberately no self-service path to create the first super-admin — `IsSuperAdmin` gates
the only endpoints that could do it. The first one is a one-time manual database step (see the
exact commands in this session's report), which itself still enforces the `@lanceraos.com` domain
check — the bootstrap cannot bypass that rule either.
Verified with real rigor at the most consequential action (revoke): confirmed at three independent
levels — the live session count, an already-open admin token immediately failing its next request,
and a fresh login attempt for the same account also being cleanly rejected — rather than trusting
any single check alone.
Alternatives considered: A self-registration flow for new admins (rejected — the actual process
described is "one person who already knows and trusts the new admin decides to grant them access,"
which the existing search-and-grant flow already covers; a separate signup system would be real,
unneeded complexity for what is fundamentally a one-person decision).

---

Date: 03 August 2026
Decision: Completed the last backend piece from the original v1 admin panel scope —
admin-triggered resend of the verification email, reusing the exact token-generation/dispatch
path the user-facing endpoint already uses, logged with `actor` since it's admin-initiated.
This closes out the **entire backend** for the admin panel's v1 scope, as originally defined in
`ADMIN_PANEL_DESIGN.md`: foundation (separate session/cookie/auth-class), the full login+mandatory-
2FA flow, user search/detail/session-management/revoke, suspend/reactivate, the audit log viewer,
a real two-tier permission model, deletion-queue management, and this resend action. Every piece
was verified end to end against a real running server, not just unit-tested in isolation — real
tokens followed through real endpoints, real Celery dispatches confirmed via worker logs, real
audit trail entries queried directly rather than assumed.
What remains for the admin panel as a whole: the entire `admin.lanceraos.com` frontend, which does
not exist in any form yet, and the fresh, admin-panel-scoped security pass that comes after it per
the project roadmap.

---

Date: 03 August 2026
Note: `admin-frontend`'s user detail page conflated `can_access_admin_panel` and `is_super_admin`
— the "Has admin access" display incorrectly read `user.is_super_admin` instead of
`user.can_access_admin_panel`, and no "Revoke admin access" button existed in the UI at all
(only "Grant"), despite the backend endpoint for it already existing. Fixed: the display now
correctly reads `can_access_admin_panel`, and both grant and revoke actions are present. The
backend's `_user_summary()` was also missing `can_access_admin_panel` entirely (only
`is_super_admin` had been added to it in an earlier round) — added.
Worth recording plainly: this is the fourth small mistake caught during the admin panel build
specifically involving confusion between these two admin-related flags or their surrounding
infrastructure (the `AuditLog.actor` false-premise, the missing admin-frontend CORS origin, the
missing `is_super_admin` exposure on `UserSerializer`, and now this). Not a single root cause, but
a real pattern worth being more deliberately careful about going forward — specifically
double-checking which of the two flags a given piece of admin-related logic should actually
reference, rather than assuming from context.

---

Date: 03 August 2026
Decision: Closed a real privilege-escalation-adjacent gap — any admin could suspend any other
account, including a super-admin's. Fixed with two rules, enforced at the backend (not just hidden
in the UI): nobody can suspend their own account, of any admin level, and only a super-admin can
suspend another admin account of any kind — a regular admin can still suspend ordinary users.
Verified at both layers deliberately: the UI hides the action with a clear explanation rather than
showing a button that would just fail, and a direct API call bypassing the UI entirely was
confirmed independently rejected with the same 403 — proving this is a real backend guard, not
just a client-side courtesy.
This also completes the entire v1 admin panel **frontend** — audit log viewer (filterable by user/
actor/event/date range, paginated, real metadata inspection) and deletion-queue management
(restore action, correct days-remaining computation) were built and verified this round, alongside
the fix above. Combined with the backend work completed earlier, every screen and every action from
the original `ADMIN_PANEL_DESIGN.md` v1 scope is now built and verified end to end against a real
running application — login, mandatory 2FA, user search/detail/sessions/revoke, suspend/reactivate
(now correctly protected), the two-tier grant/revoke admin-access model, the audit log, and the
deletion queue.
What remains for the admin panel as a whole: the fresh, admin-panel-scoped security pass that comes
after it, per the project roadmap — nothing here has had a dedicated audit yet, since none of it
existed when the first two passes ran.

---

Date: 03 August 2026
Decision: Closed out the admin-panel-scoped security audit — five real findings, all fixed and
verified.
Most significant: `admin_login` previously called the same `increment_failed_attempts()` counter
the main app's regular login uses — meaning anyone who merely knew an admin's email (no password
needed) could deliberately fail admin login repeatedly and lock that person out of their entire
regular account too, and the reverse was equally true. Fixed by having admin login stop
contributing to that shared counter entirely (an existing lock, from either surface, is still
correctly respected) — its own separate, tighter IP-based rate limit is the real defense here, not
a counter shared with an unrelated, more-public surface.
`log_event()`'s `metadata` is now redacted before being written to `AuditLog` — extended beyond
the original literal instruction (reusing the existing key-name-based redaction alone) once it
became clear that approach wouldn't catch a secret embedded inside a free-text *value* under an
innocuous key (e.g. a suspension reason containing "password=..." verbatim) — the same case the
verification step was specifically designed to test. A content-scanning pass was added instead,
reused by both `ApiRequestLog` and `AuditLog`. Deliberately does not touch `suspension_reason` on
the `User` model itself — a legitimate business record, not a log entry, out of scope for this fix.
Also closed: `user_sessions` now writes an audit entry (was the one read endpoint missing one,
inconsistent with its siblings); `token_service.py` guards against a null `password_changed_at`
defensively, matching every other read site for that field; `suspend_user`/`reactivate_user`/
`grant_admin_access`/`revoke_admin_access` now have a 30/hour per-admin rate limit beyond the
global DRF default, blunting how much damage a single compromised admin session could do quickly.
Every fix verified against real, live behavior — not just that the code changed, but that the
underlying database state (`failed_login_attempts` never moving, redacted metadata actually
readable back from the database, a null-`pca` token genuinely still authenticating afterward)
confirms the fix does what it claims.
This completes the admin panel end to end: built, then audited, then the audit's findings closed —
the same full cycle already applied to the rest of Users/Auth.

---

Date: 04 August 2026
Decision: `SaveButton` no longer renders at all until a real change has been made — changed from
the earlier convention (always visible, disabled, reading "No Changes"). Product direction from
Ali; a single shared component change covers all seven Settings sections at once, since each one
already used this one component rather than hand-rolling its own button.
Alternatives considered: Keep the always-visible disabled state (the original convention, and a
reasonable one — it gives a constant, discoverable affordance that a save mechanism exists at all).
Both are legitimate, common patterns; this was a deliberate style choice, not a correctness fix.
`STANDARDS.md`'s frontend conventions section updated to match.

---

Date: 04 August 2026
Decision: Comprehensive review of the full user/admin feedback plan (12 items) after all were
implemented — verified each against the real repo, then did a dedicated analytical pass looking
specifically for interaction bugs *between* the changes, not just re-checking each in isolation.
Found one genuine, previously-uncaught bug: `AddPassword.jsx` never refreshed the app's cached
user state after successfully adding a password — someone completing this flow while already
logged in (the common case, since it's requested from within Settings) would still see the old
"OAuth-only" restricted view until a hard refresh or fresh login, even though the backend had
already correctly unlocked their account. Fixed by refreshing `/auth/me/` and updating the store
on success, silently no-op if not currently authenticated on that device.
Also closed all five rate-limiting gaps identified in the prior audit: `save_custom_smtp`
(highest priority — an arbitrary user-supplied SMTP host had no limit at all), `change_password`/
`toggle_2fa` (shared limit, since both check the same underlying password), `google_login`/
`facebook_login` (previously unthrottled despite being an equally valid auth entry point),
`complete_email_change_step1` (keyed on the `EmailChangeRequest` itself rather than IP, which is
trivially rotated), and `upload_logo` (real Cloudinary/Pillow cost per call).
This closes the entire 12-item user/admin feedback plan — see `USER_ADMIN_FEEDBACK_PLAN.md` for
the full original list and final disposition of each item.

---

Date: 04 August 2026
Correction: The `AddPassword.jsx` fix from the previous entry was itself wrong — attempting to
refresh `/auth/me/` after success fails, because `complete_add_password` sets
`password_changed_at`, which invalidates every existing token via the same `pca` mechanism
`change_password` uses to log out other devices. Unlike `change_password`, this endpoint is
unauthenticated by design (verified via the email token, not a session), so it has no way to
identify and spare "the caller's own" session. The refresh attempt itself 401s, triggers the
app's global silent-refresh-then-logout interceptor, and hard-redirects to `/login` before the
success screen is ever visible.
Corrected by removing the refresh attempt entirely and updating the success message to honestly
state the person has been signed out and needs to sign in again with their new password — rather
than trying to paper over a logout that's going to happen regardless.
This closes the entire 12-item user/admin feedback plan, including this and the five rate-limiting
gaps from the prior entry. See `USER_ADMIN_FEEDBACK_PLAN.md` for the complete final status.

---

Date: 08 August 2026
Decision: Built the Module 2 foundations step (`core/events.py`, `core/money.py`, `apps/payments/`'s
`ExchangeRateSnapshot` + its daily-fetch Celery task) per `INVOICES_CLIENTS_TECHNICAL_SPEC.md`
Section 1/2/4 — the first prompt of the Invoices/Clients build, with no HTTP surface at all.

**Event system scope**: `core/events.py`'s `on()`/`emit()` is deliberately minimal — no class
hierarchy, no async dispatch, no persistence/replay — and `apps/invoices` (via a later prompt in
this same module) is its first real consumer. `apps/users` deliberately stays on its existing
inline `send_email()`/`log_event()` calls rather than being retrofitted onto this registry now.
Reason: nothing in Users/Auth currently needs multiple independent subscribers reacting to the same
action — every side effect there is already a direct, single-purpose call. Retrofitting it now would
mean touching a large, already-built-and-audited surface for no functional gain. This is a known,
deliberate, deferred cost, not something to be "discovered" as an inconsistency later — recorded
here explicitly so it reads as intentional. Alternatives considered: retrofit `apps/users` onto
`core/events.py` in this same pass for consistency (rejected — real risk to an already-audited
surface, for zero behavior change); build a fuller event framework (persistence, async dispatch) now
since Invoices will have many event types (rejected — speculative; the spec's 20-entry event catalog
doesn't need any of that, per-function `try`/`except` + synchronous, in-order dispatch is enough).

**Anchor-currency `ExchangeRateSnapshot` design, replacing v1's PKR-hardcoded approach**: stores
`rates_to_usd[X]` (value of 1 unit of currency X in USD) for every currency the upstream API
(`open.er-api.com`) returns, not just PKR/EUR/GBP. `core.money.Money.convert()` routes any
currency pair through USD as the anchor. Reason: v1 hardcoded which currencies existed and needed a
migration to add one; capturing the full API response and validating currencies against the
snapshot's own keys at the serializer layer (per the spec's `Client.default_currency` design) means
adding a currency later is a data change, not a migration — the next day's fetch just includes it.
The daily fetch task inverts the API's USD→X rates into X→USD (`1 / api_rate`) — verified with a
manual sanity check before shipping (PKR at `api_rate≈278.5` inverts to `≈0.0036` USD/PKR; EUR at
`api_rate≈0.92` inverts to `≈1.09` USD/EUR — both correct), since getting this backwards would
silently corrupt every downstream conversion with no obvious symptom.
Alternatives considered: keep v1's PKR/EUR/GBP-only, hardcoded-choices approach (rejected — the
exact migration-coupling problem this design avoids); a fixed `choices=` list on currency fields
(rejected for the same reason, and specifically avoided on `Client.default_currency`/`Invoice.currency`
too, per the spec).

**A real Celery-retry nuance found while testing, not assumed**: `fetch_exchange_rates` mirrors
`anonymize_expired_accounts`'s `try: raise self.retry(exc=exc, ...) except self.MaxRetriesExceededError`
shape, per instruction. Checking Celery 5.6.3's actual `Task.retry()` source (rather than assuming)
shows that because `exc` is passed, Celery re-raises that *original* exception once `max_retries` is
exhausted (`raise_with_context(exc)`) — `MaxRetriesExceededError` is only raised when `retry()` is
called with no `exc` at all. That `except` branch is therefore normally unreachable here, and
equally so in the pre-existing `anonymize_expired_accounts` it mirrors — kept for defensive symmetry
with that sibling task rather than removed, since fixing the older task's shape is out of scope for
this pass. `apps/payments/tests.py` asserts the real, verified behavior (the original exception
propagating after 4 total attempts via `.apply()`) rather than the originally-assumed one.

---

Date: 08 August 2026
Decision: Built `apps/clients/` — `Client`, `ClientNote`, `ClientTag`, full CRUD + archive/restore/
flag/notes/tags/analytics, per `INVOICES_CLIENTS_TECHNICAL_SPEC.md` Section 3. No `apps/invoices/`
code exists yet; this is the client-side-only slice.

**Reliability-score formula — a real, deliberate change from v1**, now the model's own
`payment_stats` property (via `apps.clients.scoring.compute_reliability_stats`):
  - paid on or before its due date: **+5**
  - paid 1-30 days late: **-3**
  - paid 31+ days late: **-10**
  - `bad_debt` outcome: **-20**
  - `cancelled`/`refunded` invoices: **excluded entirely** from scoring — not scored zero, not
    counted in the denominator or in `total_invoiced`/`total_paid` either, since they were never a
    real completed transaction.
  - the score is the **normalized average** of points across qualifying invoices (`paid` or
    `bad_debt` outcomes only), never a raw sum — a client with one bad invoice out of fifty must not
    score the same as a client with one bad invoice out of one.
Reason: a raw sum rewards volume over reliability (fifty perfect payments plus one bad-debt invoice
would swamp a client who has only ever sent one bad invoice, even though the second client is
objectively less reliable per-invoice) and gives a new client with few invoices no way to be scored
meaningfully relative to an established one. The normalized average fixes both. Recorded here
plainly since it's a real formula change, not a port — v1's original file wasn't available in this
session (see the note below), so v1's exact prior bands couldn't be diffed against; this formula was
built directly from the decisions doc's explicit point values given at kickoff.
Alternatives considered: a raw sum (rejected — the volume-reward and new-client problems above); a
0-100 rescaled score instead of a raw point average (not implemented — no product requirement
specified a particular display scale yet; the raw average is simpler and just as transparent, and
rescaling can be a pure presentation-layer decision later without touching this formula).

**A real gap, surfaced rather than worked around**: v1's original `apps/clients` (or equivalent)
source file — referenced by `INVOICES_MODULE_KICKOFF.md`/`INVOICES_CLIENTS_TECHNICAL_SPEC.md` as
"uploaded to project knowledge" for porting `Client.payment_stats` and the exact v1 flag-type
choices — was not present anywhere in this actual repository or available to this session. Per
`INVOICES_MODULE_KICKOFF.md`'s own explicit warning ("before asserting that anything already exists
... search for it and confirm. If it can't be found, say so plainly rather than proceeding on an
assumption"), this is recorded plainly rather than invented and presented as a port: `flag_type`'s
three choices (`payment_risk`/`communication`/`other`) were reconstructed fresh for v2, not carried
over from a v1 file this session never had access to. Kept deliberately small and easy to extend via
migration later, rather than guessing at a larger v1 set that can't be verified.

**Testing the reliability-score formula without a real Invoice model — a real judgment call, not a
mechanical one.** The prompt that requested this work offered two explicit options: a lightweight
local test-only stand-in Django model, or deferring these specific tests until `apps.invoices`
exists. A third option was used instead: the scoring formula was extracted into
`apps.clients.scoring.compute_reliability_stats()`, a pure function operating on any object exposing
`.status`/`.total`/`.amount_paid`/`.paid_date`/`.due_date` — real `Invoice` rows once that model
exists, or a plain `SimpleNamespace` today. `Client.payment_stats` calls it with
`self._invoices_for_scoring()` (which returns `None`, safely, until `apps.invoices` adds its reverse
relation — see `DATABASE.md`'s `clients` entry). This let the formula be written AND thoroughly,
directly tested this round (every point band, the cancelled/refunded exclusion, the
normalized-average-not-raw-sum behavior with a concrete 10-invoice example) with zero dependency on
Invoice, a fake Django model, or a database table that doesn't need to exist for this specific logic
to be correct.
Alternatives considered: a test-only stand-in Django model (rejected — extra migration/model-only-
for-tests machinery for no benefit over a plain object, since the formula never actually needs
Django ORM behavior, just five attributes); deferring these tests until `apps.invoices` exists
(rejected — the formula is the single most novel, error-prone piece of logic in this prompt and the
one most worth verifying now, not on faith until a much later module).

---

Date: 08 August 2026
Decision: Closed a real scope gap found while building the Step 3 frontend: `ClientNote` had no
PATCH/PUT endpoint at all. This was a genuine Step 2 omission, not a deliberate immutability
choice — unlike `InvoiceComment` (deliberately immutable per the spec, no `updated_at` field at
all), `ClientNote` has always carried a real `updated_at` column and was never designed as
append-only. The gap only surfaced because the frontend build tried to wire an edit UI to an
endpoint that turned out not to exist.
Fixed now rather than left queued, since it was small: `client_note_delete` (DELETE-only) became
`client_note_detail` (`PUT` + `DELETE` on the same `<pk>/notes/<note_id>/` path — Django/DRF route
one URL to one callable, so this project's existing `client_detail`-style combined-method pattern
was reused rather than adding a second path). Reuses the existing `ClientNoteSerializer` unchanged
(`content` was already its only writable field). Rate-limited under a new `note_update` action key,
keeping the existing `note_delete` key's behavior on the DELETE branch unchanged. This is a real
addition to `apps/clients/urls.py` outside that file's originally-scoped Step 2 work — noted here
per that step's own instruction to flag exactly this kind of drift. 4 new tests added (update
success, empty-content rejection, wrong-client 404, rate-limit exhaustion) — full suite (203 tests)
confirmed passing after the change.
Deliberately NOT done in this pass: wiring the frontend's `NotesTab` (built in Step 3) to actually
call this new endpoint — that UI still only supports add/list/delete. The backend gap is closed;
the "notes are add/list/delete-only in the UI" statement in the Step 3 summary is now only true on
the frontend side, not because the backend still lacks the capability. A future small pass should
add an edit affordance to `NotesTab` now that there's a real endpoint to wire it to.
Alternatives considered: leave it explicitly queued for Step 13 (Comments) to pick up alongside
`InvoiceComment` (rejected for this instance — small enough to fix immediately, and leaving a known,
findable gap open invites the exact rediscovery cost this entry is meant to prevent).

---

Date: 08 August 2026
Decision: Built `apps/invoices/` — Invoice Core, models only (Invoice, InvoiceItem,
InvoicePartialPayment, InvoiceReminder, InvoiceViewEvent, InvoiceComment, PaymentClaim,
InvoiceDesign, InvoicePreset, InvoicePresetItem — 10 tables), per
`INVOICES_CLIENTS_TECHNICAL_SPEC.md` Section 5, ported from `v1-reference/apps/invoices/models.py`
where v1 already had a correct, working implementation. No views/serializers/URLs/PDF/email/portal
in this step.

**A real, serious bug found by writing this step's own required tests, not by inspection**: v1's
`invoice_number` field was a bare `unique=True` CharField — globally unique across every user — even
though `generate_invoice_number()`'s numbering query only ever scopes by `(user, year)`. Two
different users' first invoice of the same calendar year both compute the identical string
`INV-2026-0001`. Under v1's schema this is a live production bug: whichever user's invoice saves
first claims that string, and the very next different user to create their year's first invoice
hits a real `IntegrityError` on save — not a rare edge case, but something that happens to nearly
every second-and-later user of the product, every January. Caught here specifically because the
prompt asked for a numbering test "across two different users," and running that test against a
real Postgres unique constraint failed loudly (`UniqueViolation: duplicate key value violates
unique constraint "invoices_invoice_number_key"`) rather than silently passing. Fixed by moving the
constraint from a bare field-level `unique=True` to `Meta.unique_together = [('user',
'invoice_number')]` — which is what "sequential per user per year" was always supposed to mean.
Alternatives considered: keep the global uniqueness and prefix invoice numbers with something
tenant-specific to guarantee global uniqueness incidentally (rejected — changes the visible
`INV-YYYY-NNNN` format the spec and v1 both specify, to fix a constraint that was simply wrong,
not a real product requirement for global uniqueness); leave the bug and just avoid writing a
cross-user test that would expose it (rejected — the whole point of the requested test was to
catch exactly this).

**`InvoicePartialPayment.payment` (FK to `payments.Payment`) is NOT included**, despite the prompt
explicitly asking for it as a field "ready for Module 3." Verified empirically before writing any
model code: Django's system checks (`fields.E300`/`fields.E307`) reject a `ForeignKey` string
reference to an app.model that doesn't exist at all — confirmed by deliberately writing a throwaway
model with exactly this shape and running `manage.py check` against it, which failed with both error
codes. This is different from the same-file forward reference `Invoice.design` uses (`'InvoiceDesign'`
resolves fine because that class exists elsewhere in the same already-loaded module) — a reference to
a model in an app that has genuinely never defined it can't be deferred the same way. `apps.payments`
has no `Payment` model as of this step. The field will be added via its own migration whenever Module
3 actually builds `apps.payments.Payment`; documented in both this entry and `DATABASE.md` so nobody
has to rediscover the same empirical check.
Alternatives considered: a plain non-FK `payment_id` UUID placeholder column, converted to a real FK
later (rejected — adds a column that looks like a foreign key but enforces nothing, exactly the kind
of "looks load-bearing but isn't" trap STANDARDS.md warns against); skip the field silently with no
note (rejected — the prompt explicitly asked for it, so silently dropping it without explanation
would misrepresent what was actually built).

**`update_paid_status()`'s terminal-status guards extended to cover `'refunded'`**, a status that
does not exist anywhere in v1 (v1's only terminal statuses were `cancelled`/`bad_debt`, and its
guards only ever named those two). This isn't a behavior change from v1 — v1 had no `'refunded'`
guard to change — it's this step's own necessary extension of the same protection principle to a
genuinely new terminal status the spec adds, so a payment add/remove cycle can't silently flip a
refunded invoice back to `paid`/`partially_paid`. Verified with dedicated tests (`refunded` invoice
resists both a full payment and a payment-removal restore attempt).

**The discount-exceeding-subtotal clamping question the build prompt flagged as a possible gap
turned out not to be one**: v1's `recalculate_totals()` already clamps `total` to `0` when it would
go negative (`if self.total < Decimal('0'): self.total = Decimal('0')`), ported directly and
verified with a dedicated test. No judgment call was actually needed here — recorded plainly rather
than inventing a decision that wasn't real.

**`is_editable` (a v1 property, not a spec field-table entry) was ported anyway** — real, correct,
unchanged v1 logic (`status == 'draft'`) with no v2-specific change needed, and no reason to leave
correct logic behind just because the spec's field table (which lists columns, not every computed
property) doesn't separately call it out. `autosaved_at`/`is_autosave`/`show_pkr_to_client`/
`include_payment_methods`/`template` were excluded for the opposite reason: genuinely absent from
the spec's field table, with no clear v2-era purpose, rather than carried forward on faith.

Verified: migration applied against a real local Postgres database (all 10 tables confirmed present
via direct SQL query); full test suite (254 tests, 51 new) passing; `manage.py check` clean.
Also caught mid-build and fixed before any migration was generated: every one of these 10 models
initially lacked an explicit UUID primary key (defaulting to Django's `BigAutoField` per
`apps.invoices.apps.InvoicesConfig`), violating CLAUDE.md rule 13 — caught by re-reading the
generated migration file rather than trusting `makemigrations`' summary output, exactly as this
step's own instructions required ("don't just trust makemigrations blindly, inspect the generated
migration file").

---

Date: 08 August 2026
Decision: Built `apps/invoices/`'s CRUD + lifecycle endpoint surface (serializers.py, views.py,
urls.py) — Step 5 of `INVOICES_CLIENTS_TECHNICAL_SPEC.md` Section 7, everything on the spec's
endpoint list that doesn't depend on `send_email()` (real `/send/`, Step 10) or `InvoiceDesign`
rendering (`/pdf/`, Step 7). Neither is stubbed — they simply don't exist yet.

**Two real, latent model bugs found by writing this step's own required tests, neither caught by
Step 4's own test suite**:
1. `invoice_number`'s uniqueness needed to move from a bare field-level constraint to
   `Meta.unique_together = [('user', 'invoice_number')]` (already recorded in the 08 August 2026
   entry above from Step 4) — but Step 5 additionally discovered that a *draft* invoice should have
   **no** `invoice_number` at all until `invoice_finalise()` assigns one, confirmed directly against
   the spec's own `invoice_duplicate` behavior (which explicitly resets `invoice_number` on the copy
   it creates — nonsensical unless drafts are expected to be number-less). This required actually
   changing the field to `null=True, blank=True` this round; Postgres allows multiple `NULL`s in a
   unique index by standard SQL semantics, so this doesn't reopen the original bug.
2. `issue_date = models.DateField(default=timezone.now)` — ported verbatim from v1, present in Step
   4 unnoticed. `timezone.now()` returns a `datetime`; Step 4's own tests never caught this because
   they always called `refresh_from_db()` before asserting anything, and Postgres silently truncates
   a datetime written into a `date` column on the way in. The first time Step 5 serialized a
   freshly-created (`.objects.create()`, no refresh) `Invoice` directly through `InvoiceListSerializer`,
   DRF's strict `DateField` representation logic raised immediately
   (`AssertionError: Expected a 'date', but got a 'datetime'`). Fixed with a real function
   (`_today()`) as the default. Recorded plainly as a genuine gap in Step 4's own verification, not
   smoothed over — the fix belongs with the field, so it's applied directly to `models.py` rather
   than worked around in the serializer.

**The referenced "decisions doc Section 6" (dashboard tracking rules) is not available in this
session** — verified directly: `INVOICES_CLIENTS_TECHNICAL_SPEC.md`'s own Section 6 is "Notification
entries," not dashboard rules, confirming this refers to a separate document (the "final-decisions
document" the technical spec's own intro mentions) that was never present in this repo, the same
situation as Step 2's unavailable v1 flag-type choices. `invoice_summary`'s three KPIs
(Outstanding/Total Paid this month/Past-Due) were built fully **unconditional** — not gated by
`sent_via_platform` at all — on the strength of the one piece of concrete, verified evidence
available: `Invoice.sent_via_platform`'s own field `help_text` explicitly scopes its effect to
"Gates reminders only." Exact rules implemented, each with its own test:
  - Outstanding: invoices with status in `sent`/`viewed`/`partially_paid` only — a client can't owe
    money on an invoice they haven't received (draft/created excluded); paid/cancelled/refunded/
    bad_debt aren't real outstanding money.
  - Total Paid (this month): `status='paid'` with `paid_date` in the current calendar month.
  - Past-Due: same eligible-status set as Outstanding, filtered to `due_date` in the past —
    identical eligibility to `Invoice.days_overdue`.
Flagged plainly as worth double-checking against the original document if it ever surfaces, rather
than silently presenting this as verified against "the spec... exactly," which it isn't.

**`invoice_aging_report` implements the spec's stated "leaning toward the broader version"
literally, not as an independent decision**: everything with an eligible status and a past due date
counts, regardless of `sent_via_platform` — not restricted to platform-sent invoices only. The
"decisions doc Section 13 #3" this leaning is attributed to is the same unavailable document
referenced above; implementing the explicitly-stated leaning from this prompt's own text is the
correct move regardless, since no more authoritative source is available to consult.

**`invoice_undo_payment`'s "old payment" threshold is set at >7 days**, this endpoint's own
judgment call — the spec didn't pin a number, and confirmation-strictness scaling by payment age is
explicitly a Step 6 (frontend) concern, not this endpoint's. 7 days was chosen as a reasonable
"probably already reconciled elsewhere (bank statement, accounting records) by now" line for a
freelancer's own undo action, not derived from any cited source. Tested at the boundary with a
one-minute safety margin on the "not yet old" side (not literally 7 days exactly) — real wall-clock
time elapses between setting a test fixture's `recorded_at` and the view computing
`timezone.now() - recorded_at`, so an exact-instant boundary fixture would nondeterministically land
on the wrong side of `age > 7 days` depending on test execution speed.

**`invoice_resume_recurring` was added alongside `invoice_pause_recurring`**, which is all the spec's
endpoint table actually lists. Pausing a recurring invoice with no corresponding way to un-pause it
isn't a real, usable feature — this is a small, obviously-necessary completion of what the spec
named, not scope creep beyond it.

**Rate limiting deliberately replicates `apps.clients.views`'s `_check_moderate_rate_limit`/
`_too_many_requests` shape rather than importing them** — same cache-based check, same 30/hour
threshold, same return-value contract, but with an `"invoices"`-scoped cache key prefix
(`ratelimit_invoices_{action}_{user.pk}`) instead of reusing `apps.clients`'s
`ratelimit_clients_{action}_{user.pk}`. Importing directly would mean invoice actions either share a
budget with any client action that happens to use the same action-string name, or get mislabeled
under a `"clients"`-prefixed cache key that has nothing to do with clients. Behavior is identical;
only the key namespace differs.

**`invoice_refund`'s partial-refund amount is not persisted anywhere on the `Invoice` row** — Step
4's schema has no `refunded_amount` field (not in the spec's Section 5 field table), so a partial
refund's exact amount only ever appears in the emitted `InvoiceRefunded` event's payload, which
`core.events` doesn't persist. This is a real, known limitation for whoever needs refund-amount
reporting later, not silently papered over — flagged here rather than adding an undiscussed new
column to close it in this step.

**`InvoiceSerializer`/`InvoicePresetSerializer` scope their `client` field's queryset to the
requesting user's own clients** (`Client.objects.filter(user=request.user)`, set in `__init__` from
`self.context['request']`) rather than accepting any client ID and validating ownership afterward.
This means a foreign client ID gets the exact same DRF "does not exist" rejection a genuinely
nonexistent ID would get — no separate error message exists that could tell an attacker "this ID
exists but isn't yours" apart from "this ID doesn't exist at all."

Verified: two migrations applied against the real local Postgres database (`invoice_number`
nullable, `issue_date` default fix) — both single-field `AlterField` operations, no new tables this
step. Full test suite (368 tests, 114 new) passing; `manage.py check` clean.

---

Date: 08 August 2026
Decision: Closed two real issues found in the Step 5 review — a code gap (`refunded_amount` never
persisted) and a documentation bug (the prior entry above cited "the spec's Section 6" when it
actually meant a different, unavailable document).

**The Section 6 ambiguity, recorded plainly as a documentation cross-reference bug, not a code
bug**: the previous entry's `invoice_summary` writeup said the rules "supposed to be matched
exactly" came from "the spec's Section 6," and separately noted that `INVOICES_CLIENTS_TECHNICAL_SPEC.md`'s
own Section 6 is "Notification entries." Both statements were true, but sitting next to each other
they read as "the spec contradicts itself," when the real situation is that two *different*
documents were both being called "the spec" in different places: `INVOICES_CLIENTS_TECHNICAL_SPEC.md`
(present in this repo) and the original decisions document it was built from (per its own intro:
"built from `INVOICES_MODULE_KICKOFF.md`'s 32 questions, the final-decisions document, and the
follow-up resolution of Section 15's open items" — that middle document, never present in this
repo or session). The actual Section 6 rules lived in the *latter*, unavailable document the whole
time; `invoice_summary` was built unconditional not because the rules were genuinely absent, but
because this session had no way to read them. Worth naming explicitly for future prompts: when a
prompt says "per the spec's Section N," ask which document — the checked-in technical spec, or the
original decisions document it summarizes — since section numbers aren't unique across the two and
guessing wrong reads as an internal contradiction rather than a missing source.

**`refunded_amount`** — a new `DecimalField` on `Invoice` (`max_digits=12, decimal_places=2,
default=Decimal('0')`, matching `total`'s exact shape), added because `invoice_refund` had nowhere
to persist the refund amount when it was first built — it only ever appeared in the emitted
`InvoiceRefunded` event's payload, which `core.events` doesn't store. Real migration
(`0004_invoice_refunded_amount`), applied against the real database, `AddField` only.

**Accumulate vs. reject on a second refund call — chose reject**: `invoice_refund` now explicitly
rejects a second call once `status == 'refunded'`, with its own clear message ("This invoice has
already been refunded"), rather than accumulating multiple partial refunds into `refunded_amount`
while the invoice stays in `paid`/`partially_paid`. Reasoning: refund was originally specified as
"amount required, supports partial, sets status=refunded" — a single call, unconditionally
terminal — matching how `invoice_cancel`/`invoice_mark_bad_debt` already behave (also one-shot
terminal transitions with no "call again" concept anywhere in this module). Accumulating refunds
across multiple calls while a non-terminal status persists is a materially different, bigger
feature (effectively a running refund ledger) that was never actually requested. `refunded_amount`
is therefore set once, directly to the single call's amount, not incremented via `F('refunded_amount')
+ amount`.
Alternatives considered: accumulate across repeated calls, only flipping to `refunded` once the
running total reaches `amount_paid` (rejected — bigger feature than asked for, and the original
Step 5 wording already committed to "sets status=refunded" unconditionally on one call); silently
let a second call fall through to the existing generic "only paid/partially_paid" rejection with no
dedicated message (rejected — indistinguishable from a genuine wrong-status error to whoever reads
the response, when the real reason is specifically "already done, not eligible again").

**`invoice_summary` rewritten against the real Section 6 rules**, supplied in full this round:
Outstanding requires `sent_via_platform=True` AND an active status (`sent`/`viewed`/
`partially_paid`) — currently always zero in practice, since no code path sets
`sent_via_platform=True` yet (only the real `/send/`, Step 10, would). Total Paid sums `amount_paid`
across every non-draft/created invoice regardless of `sent_via_platform`, minus summed
`refunded_amount` — cancelled and bad_debt invoices' `amount_paid` still counts, since money already
received isn't erased by a later status change. Past-Due Amount reuses Outstanding's exact filter,
further restricted to a past due date. Draft/created are excluded from all three via one shared
`exclude()` on the base queryset rather than repeated per-figure. One dedicated test per bullet, per
the original Step 5 instruction re-emphasized this round specifically because this was the part that
was wrong the first time.

**`invoice_aging_report` checked against the corrected Outstanding definition, not assumed
independent**: both endpoints filter on the same `ACTIVE_STATUSES` constant (the genuine shared
source of truth), but the aging report deliberately does NOT add the `sent_via_platform=True`
filter Outstanding now has. This is intentional divergence, not drift — the aging report implements
the confirmed "broader version" (everything the freelancer believes is unpaid, regardless of
platform tracking); the dashboard's Outstanding KPI counts only platform-verified money. Both
functions now carry an explicit cross-reference comment pointing at each other and explaining why
they differ on this one dimension, so a future reader doesn't "fix" this as an inconsistency.

Date: 09 August 2026
Decision: Step 7 — wired the three real, WeasyPrint-tested PDF templates (Professional/Minimal/
Modern, handed off as static HTML with hardcoded sample data) to real `Invoice`/`Client`/
`InvoiceItem`/`FreelancerProfile` fields. Data-wiring only, per that step's explicit scope — the
actual WeasyPrint render endpoint, font sourcing, and `InvoiceDesign.design_data` decomposition are
still not built (Steps 7b/8).

**Template location**: the handoff notes described `backend/templates/invoices/*.html`, but this
project's Django root has no literal `backend/` directory (the repo root itself is the project
root, per this document's own structure listing) — placed at the Django-idiomatic equivalent
instead: `apps/invoices/templates/invoices/{professional,minimal,modern}.html`. `TEMPLATES[0]` in
`config/settings.py` already has `APP_DIRS: True` and an empty `DIRS: []`, so this needed zero
settings changes; referenced as `'invoices/professional.html'` etc., matching Django's own
app-template-dirs convention (namespaced by app label to avoid collision with a future app's own
`invoices/` folder — there isn't one, but the convention exists for exactly this reason).

**Client-currency-conversion line — final implemented design**: added
`Invoice.client_currency_conversion` (a property, no migration) rather than a template
filter/tag or a separate context-builder module, since the templates already receive `invoice`
directly and a property keeps the one piece of real arithmetic (division) in one testable place
each of the three templates can reach identically. Returns `None` — meaning the template omits the
"≈ {symbol}{converted_total} at rate {rate}" line entirely — whenever there's genuinely nothing
correct to show, rather than guessing a default:
  - `invoice.client` is null (a one-time client). `Invoice` has no client-currency snapshot field
    at all (only `client_name`/`client_email`/`client_company`/`client_address`/`client_phone` are
    frozen at creation) — verified directly against the model, not assumed — so there is truly no
    currency info to convert to for a one-time client. Chose to omit the line entirely rather than
    inventing a fallback currency, per the room this step's prompt explicitly left for that choice.
  - The client's `default_currency` matches the invoice's own `currency` — never shows "≈ $100 at
    rate 1.00".
  - No `exchange_rate_snapshot` is attached to the invoice.
  - The client's currency isn't a key in that snapshot's `rates_to_usd` (an obscure currency the
    day's upstream fetch didn't happen to include).
`rate` is computed as `rate_to_usd_at_issue / rates_to_usd[client_currency]` (units of the client's
currency per 1 unit of the invoice's currency) and `converted_total = invoice.total * rate` — this
is the same arithmetic direction the original hardcoded placeholder text implied ("≈ Rs. 1,384,220
at rate 279.08" for a $4,960.00 USD invoice: 1,384,220 / 4,960 ≈ 279.08), just generalized to any
currency pair instead of being PKR-specific. Verified with real fixture data via both a committed
Django-only render test and a throwaway WeasyPrint render: a €3,465.00 invoice
(`rate_to_usd_at_issue=1.08`) to a PKR client (`rates_to_usd['PKR']=0.0036`) produced `rate=300.00`
and `converted_total=Rs. 1,039,500.00` — exact arithmetic match (3,465 × 300 = 1,039,500).

**Real, found gap — `capture_issue_rate()` never attaches a snapshot for a USD invoice**: `Invoice.
capture_issue_rate()` (Step 5) returns early for `currency == 'USD'` (USD is the anchor currency,
`rate_to_usd_at_issue = 1`, no conversion needed for USD's own rate) *without* setting
`exchange_rate_snapshot`. That means `client_currency_conversion` can never show a conversion line
for a USD-currency invoice, even when the client's currency genuinely differs — there's no snapshot
attached to source the client's currency's rate from at all. Confirmed directly (not assumed) via a
dedicated test (`test_currency_line_omitted_when_usd_anchor_has_no_snapshot`) that pins this as the
current, honest behavior. Not fixed here — `capture_issue_rate()` is Step 5/6 lifecycle code, out of
this step's data-wiring-only scope; flagging for whoever picks this up next, likely by having it
attach the latest snapshot even for USD so a *different* currency's rate is always reachable.

**Real, found gap — no signature URL field exists anywhere**: `FreelancerProfile` has `logo` (a
Cloudinary URL `CharField`, confirmed directly) but no equivalent signature field, and neither does
`InvoiceDesign` or `Invoice` itself — checked directly across all three models, not assumed. The
handoff templates' `signature_clean.png` (`minimal.html`/`modern.html` only — `professional.html`
never had a signature image, only the "Authorised signature" text line) is now gated behind
`{% if signature_url %}`, a context variable no current model field backs — the `<img>` simply
never renders until a future step adds a real field (most likely on `FreelancerProfile`, alongside
`logo`) and a render view that passes it in. Not invented here. Same treatment for the QR code:
`{% if qr_code_data_uri %}` — the actual QR *image* generation (matching v1's `generate_qr_image`
in `v1-reference/apps/invoices/pdf_generator.py`, which encoded the invoice's payment-page URL) is
Step 7b's job once the render endpoint exists; this step only added
`Invoice.payment_page_url` (a property, `f'{FRONTEND_URL}/pay/{view_token}'`, mirroring v1's
`get_payment_page_url()`) for the "Pay online" link text and for whatever Step 7b's QR generator
will encode.

**`modern.html`'s sidebar logo**: the handoff HTML referenced a separate `logo_on_dark.png` (a
presumed light-on-dark logo variant for its dark purple sidebar) distinct from the other two
templates' `logo_placeholder.png`. `FreelancerProfile` only stores one logo URL — bound both to the
same `freelancer.logo`. A logo with dark colors of its own may not read well against Modern's dark
sidebar; not solved here (would need a second stored variant, a real product decision, not a
data-wiring one).

**`professional.html` didn't have the `@page` counter footer** the other two do (predates that
test, per the handoff notes) — added, using the identical `@bottom-left`/`@bottom-right` /
`counter(page)`/`counter(pages)` technique already proven in `minimal.html`/`modern.html`, not a new
approach. The page margin is deliberately asymmetric (`margin: 0 0 16mm 0` — zero on top/right/left,
16mm bottom only) rather than matching Minimal's all-sides margin, specifically so the decorative
full-bleed "ledger spine" (a `position:absolute` element reaching the true left/top page edge) keeps
bleeding correctly — confirmed with a real WeasyPrint render plus a raw pixel check at the page's
left edge (`RGB(168,128,59)` from x=0 through the spine's 3mm width, matching its declared
`#a8813c` almost exactly), not assumed safe. The old static, absolutely-positioned `footer.pagefoot`
(hardcoded "Page 1 of 1") was removed entirely in favor of the real margin-box counters; verified via
a 22-item stress invoice producing a real 3-page PDF with "Page 1 of 3" / "Page 2 of 3" / "Page 3 of
3" each appearing on the correct page.

**`django.contrib.humanize` added to `INSTALLED_APPS`**: needed for the `intcomma` filter
(thousands-separator money formatting, e.g. `€3,300.00` not `€3300.00`) — a standard Django contrib
app, no models/migrations, not part of "the render pipeline" this step was told not to build.

**NTN deliberately not wired onto the "From" party block**: `FreelancerProfile.ntn_encrypted` is
Fernet-encrypted with only a `set_ntn()` method — no corresponding decrypt-for-display getter exists
yet (confirmed directly, not assumed). Displaying it on an invoice PDF would mean writing new
decryption-calling code, which is a materially different, bigger change than binding an existing
plaintext field; the "From" block's NTN line was dropped rather than left showing fake placeholder
text. Wise wasn't added to the conditional payment-methods list for the same reason in spirit —
`FreelancerProfile.wise_profile_id`/`wise_access_token`/`wise_refresh_token` are OAuth plumbing, not
a client-facing payment identifier, so there's no field that means what the old hardcoded "Wise —
fahad.horizon" row implied.

Verified: `apps.invoices` test suite (189 tests, 14 net new, in `test_pdf_templates.py`) passing
using Django's own `render_to_string` only — deliberately no WeasyPrint dependency in the committed
suite, since WeasyPrint isn't a project dependency yet (Step 7b). Additionally, and not committed:
WeasyPrint + PyMuPDF were installed into the venv temporarily for this session only (never added to
`requirements.txt`) to actually render all three templates against fixture data, including a
22-item multi-page stress case, confirming real computed page counts, the repeating table header
(`minimal.html`), the repeating sidebar (`modern.html`), the new `professional.html` footer, and the
currency-conversion arithmetic end-to-end against a rendered PDF — then uninstalled afterward,
restoring the venv to its prior state. `manage.py check` clean.

Verified: one migration (`0004_invoice_refunded_amount`) applied against the real local Postgres
database. Full test suite (376 tests, 8 net new/changed) passing; `manage.py check` clean.

Date: 09 August 2026
Decision: Step 7b — built the actual PDF render pipeline (`apps/invoices/pdf_generator.py`), the
real `GET /api/invoices/<pk>/pdf/` endpoint, font sourcing, QR generation, and closed the two real
gaps Step 7 found and pinned rather than fixed.

**`capture_issue_rate()` USD-anchor gap — closed**: moved the `ExchangeRateSnapshot` lookup ahead of
the `currency == 'USD'` branch so both branches share it — a USD invoice now gets
`exchange_rate_snapshot` attached (still `rate_to_usd_at_issue = 1`, `rates_to_usd['USD']` is always
explicitly `1.0`), so `client_currency_conversion` can finally source a *different* currency's rate
for a USD invoice with a non-USD client. The test that pinned this as a known gap
(`test_currency_line_omitted_when_usd_anchor_has_no_snapshot`) was replaced with
`test_capture_issue_rate_attaches_snapshot_for_usd_invoices_too`, which calls the real method (not
hand-setting `exchange_rate_snapshot` the way other fixtures in that file do) and asserts the fix
through to the rendered "at rate 277.78" line in all three templates.

**Signature field — closed**: added `FreelancerProfile.signature_url`/`signature_public_id`
(`apps/users/models.py`), verified and mirrored `logo`/`logo_public_id`'s exact field type
(`CharField(max_length=500, blank=True)`, not `URLField` — the intuitive guess going in, wrong once
checked) and lifecycle role. Storage only; the upload/background-removal tool is a separate, later
step.

**Font sourcing**: real IBM Plex Sans/Mono, Source Serif 4, Space Grotesk, and Caveat files
downloaded from their real upstream GitHub release paths into `apps/invoices/static/invoices/
fonts/` (Caveat unused by any template's `@font-face` today — downloaded anyway per instruction,
not invented a use for it). `pdf_generator.py`'s `FONT_CONTEXT` computes real `file://` URIs via
`Path.as_uri()` and injects them as template variables — WeasyPrint's own URL fetcher resolves
these directly; Django's `{% static %}` tag only resolves in a browser context and was never used.
Two real template bugs found and fixed along the way: a multi-line Django `{# #}` comment
containing the literal text `{% static %}` closed early (the comment tokenizer isn't DOTALL),
so the literal text got parsed as a real tag — fixed by switching to CSS `/* */` comments inside
`<style>` blocks, never parsed by Django's tokenizer at all. WeasyPrint doesn't support CSS4's
`font-weight: 400 700` range syntax in `@font-face` (logs a warning and silently drops the whole
declaration) — fixed in `modern.html` by declaring two ordinary single-weight `@font-face` rules
for Space Grotesk pointing at the same variable font file.

**QR generation**: ported v1's `generate_qr_image` approach directly (`v1-reference/apps/invoices/
pdf_generator.py` — same `qrcode.QRCode(version=None, error_correction=ERROR_CORRECT_M,
box_size=10, border=2)` call), but output as a base64 PNG data URI instead of v1's ReportLab
`ImageReader`, since WeasyPrint just needs a normal `<img src>`. Encodes `Invoice.payment_page_url`
(the `/pay/<view_token>` link — the portal page itself still doesn't exist, same "not built yet"
404 already noted for other steps).

**Interim template-selection default**: `Invoice.design` is null for every real invoice today
(nothing creates `InvoiceDesign` rows yet as of this step). `pdf_generator._select_template_name`
checks `FreelancerProfile` for a default-template setting first (none exists), then falls back to
`'professional'` — commented clearly in the code as interim, explicitly superseded once Step 8's
real design records exist to select from.

**`/pdf/` — redirect, not proxy**: draft/created invoices always live-render (call the pipeline
fresh, return PDF bytes, `Content-Type: application/pdf`); `sent`-or-beyond invoices redirect
(302) to the frozen `pdf_url`. Checked how the only other Cloudinary-served asset in this app
(the profile logo) is actually consumed — the backend returns the raw `secure_url` in an API
response and the frontend fetches it directly, no backend proxy exists anywhere — so a redirect is
the closest analog for a GET endpoint that must serve either live bytes or a stored asset
uniformly. If a sent+ invoice somehow has a blank `pdf_url` (shouldn't happen, but not asserted
away), falls back to a live render and logs it as an anomaly rather than 404ing or crashing.

**`store_invoice_pdf` — Cloudinary `resource_type='raw'`**: mirrors `upload_logo`'s lazy
`import cloudinary.uploader` convention exactly, but `resource_type='raw'` (not `'image'`) since a
PDF is a document, not an image Cloudinary should attempt to transform.

**Mark-sent PDF failure is non-fatal to the status transition**: `invoice_mark_sent`'s one-time
render+store is wrapped in a bare `try`/`except`, logging on failure but still completing the
`status='sent'` transition with `pdf_url` left blank. Reasoning: refusing to record a real-world
event ("I already sent this invoice myself") just because PDF generation failed would be more
confusing than useful for a manual dropdown flip — paired with `/pdf/`'s own defensive live-render
fallback above for exactly this case.

Verified: `invoice_duplicate` (Step 5) already correctly omits `pdf_url`/`pdf_generated_at` from
its `Invoice.objects.create()` kwargs (relying on model field defaults) — confirmed with a real
test (`test_duplicate_resets_pdf_url_and_generated_at`) rather than assumed from the existing code
comment. Real WeasyPrint PDFs generated and inspected directly (not just "rendered without
error"): PyMuPDF font-table inspection confirmed genuine subsetted embedding for all custom fonts
(e.g. `XHSHVD+IBM-Plex-Sans`, the random-prefix-plus-hyphenated-name pattern that itself proves
real embedding, not a system-font-name collision) across all three templates; QR data URIs
confirmed well-formed and encoding the real `payment_page_url`; the currency-conversion line
confirmed actually appearing for a USD invoice with a non-USD client through the real pipeline
end-to-end. `weasyprint`, `qrcode[pil]`, and `pymupdf` added to `requirements.txt` for real this
time (Step 7a used WeasyPrint only temporarily, uninstalled afterward — Step 7b is the step that
actually needs it committed).

Verified: full test suite (454 tests as of Step 8 below; 413 immediately after this step) passing;
`manage.py check` clean.

Date: 09 August 2026
Decision: Step 8 — defined the `design_data` JSON schema for `InvoiceDesign` for real (`apps/
invoices/design_schema.py`), built validated CRUD + `set-default` + `duplicate` endpoints against
it, and decomposed the 3 built templates into real seed `design_data` (`apps/invoices/
design_seeds.py`). Backend contract only, per this step's explicit scope — no canvas UI.

**"Decisions doc Section 9/10" doesn't exist — flagged, not silently assumed**: both
`INVOICES_CLIENTS_TECHNICAL_SPEC.md` and `DATABASE.md` cite `InvoiceDesign` as "the visual
PDF/portal template system (decisions doc Section 9/10)". Checked directly: no file in this repo
(`DECISIONS.md`, `INVOICES_MODULE_KICKOFF.md`, `DESIGN.md`, the tech spec itself) contains a
literal "Section 9" or "Section 10" heading — this was already independently discovered and noted
during Step 7b as well ("the actual 'Section 9-10' reference... didn't exist in the technical
spec"). Rather than block on a document that isn't in this repo, this step's own task description
(a complete, unambiguous zone_1/zone_2/pairing-rule specification) became the working spec,
cross-checked against the real `InvoiceDesign` model fields and the real template HTML/CSS. This
entry, plus `design_schema.py`'s own module docstring, is now the closest thing to a real "Section
9/10" that exists in this codebase.

**Schema shape**: `zone_1.elements[]` (`{type, x, y, width, height, style}`, types `logo`/
`business_info`/`client_info`/`dates`, absolutely positioned since Zone 1's height is always
known) and `zone_2` (`{table: {style}, elements: [{type, spacing_after_previous, style,
paired_side_by_side?}]}`, types `totals`/`notes`/`signature`/`payment_info`, spacing-relative flow
since the table's height depends on line-item count). See DATABASE.md's `invoice_designs` section
for the full validation-rule list; not duplicated here.

**`source` defaults to `'custom'` at the serializer layer, not the model's own `'builtin'`
default**: `InvoiceDesign.source`'s model-level `default='builtin'` was a Step 4 placeholder from
before any design CRUD existed. A user calling `design_create` today is authoring a genuinely
custom design, not a builtin one — `InvoiceDesignSerializer.create()` calls
`validated_data.setdefault('source', 'custom')` before saving. `design_duplicate` sets `source`
explicitly to `'builtin'` regardless, since that path IS instantiating a builtin seed. Left the
model's own default alone rather than changing it — `design_duplicate`'s explicit set and the
serializer's override cover every real write path today, and changing a model default is a
migration for a value nothing currently depends on defaulting to.

**`design_duplicate` — why this mechanism, and why scoped this narrowly**: the spec's own language
is that picking a built-in template + color variant "converts into this same structure under the
hood" (Path 1). That conversion needs a starting point. `InvoiceDesign.user` is a required FK with
no `null=True` (verified directly against the model, not assumed) — so there is no "ownerless" row
a `builtin` design could live as ahead of a real user picking one, and making `user` nullable or
pre-creating rows for every user were both rejected as bigger, unnecessary changes for what's
fundamentally a one-line copy operation. `POST /api/invoices/designs/duplicate/` with
`{base_template, color_variant?, name?}` creates a new, real, owned `InvoiceDesign` row from
`design_seeds.get_builtin_design_data(base_template)` (a `copy.deepcopy`, confirmed independent of
the shared module-level constant with a dedicated test). Deliberately does NOT also support
duplicating an arbitrary existing custom `InvoiceDesign` — nothing in the spec asks for that (a
design is already `PUT`-editable in place), and adding it would be scope creep beyond what this
step was asked to build.

**Seed decomposition — honest, not pixel-perfect**: all 3 templates' real CSS was read directly
(not from memory) and translated into `zone_1`/`zone_2` element positions in mm, matching each
template's own `@page`/padding values. Two places where the real HTML doesn't map cleanly onto the
two-zone vocabulary, resolved pragmatically rather than by forcing a bad fit:
  - `professional.html`/`minimal.html`'s `.lower` row genuinely places `notes` and the bank-methods
    `payment_info` block side by side in the real CSS, but the pairing rule only permits
    `signature`+`payment_info` (the only two fixed-height, non-reflowing zone_2 types — `notes` can
    grow). Represented as two sequential, unpaired elements instead of forcing an invalid pairing —
    consistent with the "reasonable, not pixel-perfect" bar this step's instructions explicitly set.
  - `modern.html`'s sidebar is `position:fixed`, running the full page height beside the table, not
    strictly "above" it — and its pay-online QR block has no valid zone_1 type at all (`payment_info`
    isn't in that vocabulary). Kept honest: the sidebar's logo/business_info still use those zone_1
    types with `style.sidebar: true` marking where they really render, and the QR block became a
    zone_2 `payment_info` element with the same flag, left unpaired (matching the real HTML, where
    `modern.html`'s signature block has nothing paired next to it — zero pairs is valid per the
    schema).
All 3 seeded designs pass `validate_design_data_schema` with zero errors — dogfooded directly in
`apps/invoices/tests/test_designs.py::SeedDataValidationTests`, not just trusted by construction.

**Validation error format**: `InvoiceDesignSerializer.validate_design_data` raises
`serializers.ValidationError` with the full list of violation strings from
`validate_design_data_schema` (not fail-fast on the first one) — each message names the specific
element index/type and rule violated (e.g. "zone_2.elements[1] has paired_side_by_side=true but
type \"notes\" is not pairable — only ['payment_info', 'signature'] may be paired side-by-side."),
per this step's explicit requirement that Step 8b's editor be able to show the user exactly what's
wrong, not a generic "invalid design."

Verified: 41 new tests (`apps/invoices/tests/test_designs.py`) covering schema validation (every
rule above, including a real intentionally-colliding zone_1 fixture derived from the seed data
itself, not synthetic-only), all 3 seeds dogfooded against the same validator, CRUD, cross-user
isolation (404, not 403, matching the established `get_object_or_404(..., user=request.user)`
pattern), set-default uniqueness (including that setting one user's default never touches
another's), `design_duplicate` (valid/invalid `base_template`, independence from the shared seed
constant, default naming), serializer allowlist regression (client-supplied `id` ignored, `user`
always the requesting user), and rate limiting for every mutating design endpoint. Full project
test suite: 454 tests passing (up from 413 before this step); `manage.py check` clean.

Date: 09 August 2026
Decision: Step 8b — the drag-and-drop canvas editor for `InvoiceDesign.design_data`, built against
Step 8's real backend contract. Frontend only (`frontend/src/lib/designEditor/`, `frontend/src/pages/
design-editor/`, `frontend/src/pages/DesignGallery.jsx`) — no backend changes.

**Canvas library: GrapesJS, not Puck — verified, not assumed, and the opposite of the initial
expectation.** The task itself expected Puck to be the better fit (React-native, fits this
codebase's component patterns) unless a concrete blocker showed up. One did: Puck's own
documentation (fetched directly, not recalled from training) describes a slot/zone/DropZone
component model — ordered, structured, flow-based — with no mention of absolute positioning,
arbitrary pixel placement, or free resizing anywhere. Zone 1's requirement is genuinely
coordinate-based (real x/y/width/height per design_schema.py), which Puck's model has no path to
without building a positioning system on top of it from scratch — precisely the "don't build a
canvas from scratch" the task's own framing warned against defeating. GrapesJS, by contrast: its
core (free, open-source, BSD-3-licensed `grapesjs` npm package, confirmed via its own bundled
`dist/grapes.mjs` source, not just docs) supports a real per-component `dmode: 'absolute'` drag
mode and a `resizable` trait with full 8-handle configuration — both used directly in `componentTypes.js`.
(The polished, snap-to-grid "Absolute Mode" *plugin* GrapesJS blogs about is a paid Studio SDK
feature — confirmed and explicitly NOT what's used here; the underlying `dmode`/`resizable` this
build depends on are core-free, a different and lower-level thing.) An official React wrapper
(`@grapesjs/react`) exists and is used for the `<GjsEditor>`/`<Canvas>` mounting only — everything
else (component types, blocks, style panel) is built directly against the real `grapesjs` Editor
API via `onEditor`, since `@grapesjs/react`'s own README is explicit that it provides no UI
components of its own, "let you define your own." Zone 2's flow-reorder-only requirement needed no
special support either way — normal GrapesJS component sorting (the default, non-absolute drag
mode) already does exactly that.

**Full-screen, shell-less editor — not AppShell-embedded.** A real, working precedent for a
shell-less authenticated route already exists in this codebase (`/account/deletion-review`,
`DeletionReview.jsx`, confirmed directly in `App.jsx` rather than assumed) — `DesignEditor.jsx`
follows that exact pattern (`<Route path="/invoices/designs/:id/edit" element={<PrivateRoute>
<DesignEditor /></PrivateRoute>}>`, no `<AppShell>` wrapper) rather than inventing a new one. The
canvas genuinely needs more width than AppShell's standard main-content frame gives every other
page — a real A4-proportioned page plus a block palette plus a style panel doesn't fit
comfortably inside the ~calc(100%-sidebar) frame DESIGN.md Section 5 describes. The "obvious way
back" the task required: a persistent top bar (`EditorTopBar.jsx`) with a "← Designs" button,
always visible, including in Preview mode — never a dead end. `DesignGallery.jsx` (the list/gallery
page one level up) stays inside AppShell as normal — nothing about *that* page needed to break
precedent, only the canvas itself.

**Two-zone editor mechanics, matching design_schema.py exactly**:
- Zone 1: a `lancera-zone1` container (`droppable` restricted to `lancera-zone1-element` children
  only, via a real per-instance function check, not a static flag) holding free-form
  `dmode:'absolute'`, `resizable`-enabled children — one per `ZONE_1_TYPES` (logo/business_info/
  client_info/dates), added via GrapesJS's real `BlockManager` (mounted with
  `editor.BlockManager.render(undefined, {external:true})`, not reimplemented — GrapesJS's own
  drag-drop mechanics are mouse-event-based, not native HTML5 DnD, specifically so they work across
  the canvas iframe boundary, confirmed empirically by actually dragging in the real browser).
- Zone 2: a `lancera-zone2` container holding normal-flow, sortable-only children (no `dmode`
  override, `resizable:false` — there is no x/y/width/height for zone_2 at all, per the schema) —
  one per `ZONE_2_TYPES` (totals/notes/signature/payment_info). `spacing_after_previous` is a real
  `margin-top` style value, editable both by GrapesJS's own resize-adjacent drag AND a direct
  numeric field in the custom settings panel.
- The mandatory line-items table is a **standalone root-level sibling**, not a child of the Zone 2
  sortable list at all — deliberately, so "the table always starts Zone 2" is true by construction
  (it was never in the reorderable collection to begin with) rather than needing runtime protection
  against a drag-reorder edge case leapfrogging something ahead of it.
- `paired_side_by_side` is a per-element boolean **trait**, not a separate pair-container block —
  simpler to serialize (zone_2 stays a flat, ordered list; no nested structure to unpack) and the
  trait is only ever shown in the settings panel for `signature`/`payment_info` types (checked
  directly in `ElementSettingsPanel.jsx`), satisfying "disabled/hidden otherwise" without needing
  GrapesJS's own Trait Manager component-type restrictions. The exact "signature" visual side-by-
  side re-layout inside the editable canvas itself is NOT rendered live — the elements still stack
  in the Zone 2 list for editing, flagged with a "⇄ paired" badge instead of a physical reflow.
  That reflow is a rendering concern the real templates/pdf_generator.py express, not something the
  editor canvas itself needs to pixel-preview; scoped out deliberately given the time this step had,
  not silently skipped.
- `modern.html`'s `style.sidebar: true` compromise (Step 8's own documented gap) is exposed as a
  "Render in sidebar region" checkbox trait on every Zone 1 element type (not schema-restricted to
  any one type) rather than a second, differently-mechanised droppable region — sidebar-flagged
  elements render with a distinct purple dashed border + a 🗄 marker in the canvas so they read as
  visually different from an ordinary Zone 1 box, per the task's own requirement, without needing a
  second drag-and-drop target with different mechanics grafted onto the same container.
- Style panel: a plain React form (`ElementSettingsPanel.jsx`), not GrapesJS's own Trait Manager UI
  — deliberate, so it can use this project's real inline-style/lucide-icon conventions instead of
  theming a Backbone-view-based panel, and so per-type field definitions (label/font/color/align/
  etc., a `FIELD_DEFS` map per element type) stay declarative and easy to extend once Step 8b's own
  scope grows. Reads/writes `component.getAttributes()['data-style-json']` directly — the one place
  the free-form style dict actually lives on the live component.
- Sample-row-count (3/8/20): real row `<div>`s rendered inside the table component's own view,
  driven by a `data-sample-rows` attribute — changing it changes the table's real rendered height,
  which pushes Zone 2's real, normal-flow siblings down exactly the way a heavier real invoice
  would (confirmed directly: switching to 20 rows and reading the live DOM showed the literal text
  "Sample line item 20" and the later zone_2 elements visibly lower on the page) — a real functional
  exercise of the flow model, not a decorative counter.
- Undo/redo: GrapesJS's own `UndoManager` (`.undo()`/`.redo()`/`.hasUndo()`/`.hasRedo()`), no
  custom history stack. Preview: GrapesJS's own built-in command — its real registered id is
  `'preview'`, **not** `'core:preview'` as commonly assumed/documented elsewhere; confirmed directly
  against this project's actual installed `grapesjs/dist/grapes.mjs` source
  (`commandsDef = [['preview', 'Preview', 'preview'], ...]`) before wiring `runCommand`/`stopCommand`
  to it, rather than shipping a silently-broken button.

**A real bug found and fixed by this step's own Playwright verification, not assumed correct from
reading GrapesJS's docs**: the first implementation tried enforcing "totals removable only while
another totals sibling exists" via a custom `isRemovable()` method on the component model. This did
nothing — GrapesJS's real delete command and toolbar-delete-button code (confirmed directly in
`dist/grapes.mjs`) check `component.get('removable')` as a **plain property read**, never a method
call, and a function stored there is read back as a truthy value rather than invoked. A live
Playwright test (delete one of two totals elements — allowed — then try to delete the last
remaining one — should be blocked) caught this directly: the second delete also succeeded, which
should never happen. Fixed by *actively setting* the real `removable` property on every totals
sibling in response to real editor-level `'component:add'`/`'component:remove'` events (which do
fire for any change anywhere in the tree, unlike a plain component model's own `.on('add remove',
...)`, which — a second wrong guess, also caught by re-running the same test — listens on the wrong
object: those events fire on the child *collection* (`component.components()`), not the parent
model itself, and Backbone does not bubble collection events onto the model that owns the
collection). The fix lives in `DesignEditor.jsx`'s `onEditorInit`, calling
`refreshTotalsRemovability` (`componentTypes.js`) on every add/remove anywhere in the tree — verified
correct in both directions afterward: deleting a design's second totals element (the minimal
seed's own real shape) succeeds, and deleting the resulting last one is then blocked.

**A real, confirmed gap, not silently swallowed**: this step does **not** implement client-side
zone_1 overlap prevention — only the two rules the task explicitly asked for UI-level enforcement
of (mandatory-element non-removal, the pairing count) got a real UI affordance; overlap is
backend-only, exactly as the task's own framing anticipated might be the case ("if the backend
catches an overlap the canvas UI itself somehow let through, that's a real gap worth noting"). This
was directly demonstrated, not hypothesized: dragging "Bill to" on top of "From" in a real browser
and saving surfaced `design_schema.py`'s exact real message — "zone_1.elements[3] (client_info)
overlaps zone_1.elements[4] (business_info) — bounding boxes collide." — verbatim in the editor's
error banner, confirming both that the gap is real (the canvas let the drag happen) and that the
error-surfacing requirement works correctly (the specific, per-element backend message reaches the
user, not a generic failure). Left unfixed deliberately — adding real-time client-side overlap
detection during drag is a reasonable follow-up for whoever picks this up next, not silently added
here beyond what was asked.

**Path 1 gallery preview — a real, flagged data duplication, not a new backend endpoint**:
`design_seeds.py`'s 3 `BUILTIN_DESIGNS` live only in Python; there's no "list builtins" backend
endpoint (`design_duplicate` only *creates* a real row once a user has already picked one). Rather
than add a backend endpoint for this frontend-only step, `builtinDesigns.js` hand-mirrors the same 3
JSON structures for the gallery's preview cards (`DesignCanvasPreview.jsx`, rendered as a scaled
static approximation using the same element vocabulary the editor edits — not a WeasyPrint render,
a different pipeline entirely). If `design_seeds.py` changes, this file needs a matching manual
update or the gallery silently drifts from what `design_duplicate` actually creates — flagged
directly in both files' own comments, not hidden.

**Per-invoice design override — confirmed absent, not built here.** `InvoiceFormFields.jsx` has no
design-picker field of any kind (checked directly) — the spec's per-invoice design-override flow at
invoice-creation time has nowhere to plug into yet. Out of this step's scope by the task's own
explicit instruction; flagged rather than silently added. `DesignGallery.jsx`'s "Manage Designs"
entry point (wired from `Invoices.jsx`'s header, next to the existing "From Preset" button) is the
management-side half this step was actually asked to build.

**New frontend dependencies**: `grapesjs@^0.22.16` (pinned below its latest 0.23.4 to satisfy
`@grapesjs/react`'s own `peerDependencies` range, confirmed via `npm view`/`npm install`'s own
ERESOLVE error rather than guessed) and `@grapesjs/react@^2.0.0`. `npm audit fix` run immediately
after install brought the resulting tree to 0 vulnerabilities (the handful `npm install` initially
reported — `brace-expansion`, `js-yaml`, `nanoid`, `postcss`, `undici`, `react-router`'s own
existing range — were all transitive, non-breaking patch bumps, not anything specific to the two
new packages). `package.json` is strict JSON and can't hold the per-dependency rationale comments
`requirements.txt` uses — this entry, plus each file's own header comment, is the closest
equivalent for this step's additions.

Verified: this step's own vitest suite (`serialization.test.js` — the real design_data <-> GrapesJS
round-trip, including all 3 real builtin seeds, with an explicit, documented ~1px/0.3mm tolerance on
coordinates since the canvas's internal working unit is px while the schema is mm, never a false
exact match; `rules.test.js` — the mandatory-totals and pairing-count logic in isolation) — 18 tests,
all passing. Real browser verification via a throwaway Playwright script (not committed, per this
project's established convention): logged in as a real test user, opened the gallery, used a real
template (`design_duplicate` called for real), opened the resulting design in the editor, selected a
real element (settings panel populated correctly), dragged it via real mouse events (confirmed via
screenshot, not just a DOM-property read — which is what surfaced the overlap gap above), changed
sample rows from 3 to 20 (confirmed via live DOM text), toggled Preview (confirmed palette/panel
hide), toggled Undo, attempted to delete the mandatory table and the mandatory totals block via
Backspace (both correctly blocked; the totals bug above was found and fixed via this exact test),
confirmed a totals element genuinely becomes removable/protected as its sibling count changes both
directions, toggled the pairing checkbox and watched the live status message update, saved a clean
design successfully (confirmed via a follow-up real API GET that the persisted name and design_data
matched), and confirmed dark mode renders the gallery correctly. Zero console errors across every
run except the one, expected 400 from the deliberately-forced overlap-save test.

Date: 09 August 2026
Decision: Step 9 — AI-seeded designs (Path 3) and the signature tool. `core/ai.py` (new — genuinely
built now; was a `[not yet built]` placeholder comment in CLAUDE.md's tree since the Users/Auth
build), `apps/invoices/ai_design.py`, `apps/invoices/signature_tool.py`,
`POST /api/invoices/designs/ai-seed/`, `POST /api/invoices/signature/`.

**Classify, not generate — recorded explicitly so this doesn't get relitigated later.** A separate,
real proof of concept (`~/Downloads/invoice_template_poc/backend/main.py`) explored full HTML
generation with an iterative "nudge and regenerate" loop: upload a reference image, extract a
design-spec, then have a text/vision model generate a complete standalone HTML invoice document
from scratch, re-generating on each user nudge. That approach was evaluated directly (its real code
was read, not assumed) and rejected for this system, for two separate reasons, not one:
1. It defeats the actual point of Step 8's `InvoiceDesign` system — one shared `design_data`
   structure that the editor, the portal, and WeasyPrint all render from. A one-off generated HTML
   blob is a dead end nothing else in the system can open, edit, or reuse; it would need its own
   parallel storage/rendering path, permanently disconnected from everything Step 8/8b already
   built.
2. Full-HTML-generation-under-token-constraints was already shown to be fragile, by the POC's own
   code: its `generate_invoice` prompt spends several paragraphs defensively instructing the model
   never to use absolute positioning for the totals block because "every previous attempt... caused
   the text to overlap and become unreadable," and manually hand-holds the model through an exact
   SVG wave-banner pattern to copy because free-form generation kept failing to produce one
   correctly. That's not a fixable prompt-engineering problem for THIS system specifically — it's
   the generic HTML-generation approach's actual failure mode, live in the reference code, not
   speculation about it.

What DID carry over from the POC, ported directly rather than reinvented, because it's genuinely
good and entirely orthogonal to the classify-vs-generate question:
- Image compression before the API call (`compress_image` — downscale to 700px wide, re-encode as
  JPEG). Verified again directly in this step, not just re-trusted: a synthetic 3000x4000 test
  image with real per-channel noise (a flat/solid-color test image would have compressed trivially
  well under PNG anyway, making the comparison meaningless) went from several MB to well under
  100KB after compression, and the result still decodes as a normal, correctly-proportioned image.
- `<think>`-tag and markdown-fence stripping (`core.ai.strip_model_reply_wrapper`, verbatim from the
  POC's `strip_fences`) — genuinely necessary, confirmed by this step's own live testing below, not
  just carried over on faith.
- 429 retry-with-backoff parsing the real "try again in Ns" Groq error message (`core.ai.call_groq`,
  ported from the POC's own `call_groq`).

**The classify schema is deliberately narrower than the POC's `DESIGN_SPEC_SCHEMA`** — that schema
had 10 free-text fields (layout/table_style/corner_style/header_treatment/etc.) scoped for
generating arbitrary HTML from scratch. This system can only ever start from one of 3 fixed
templates, so the real schema here is `{base_template, primary_color, secondary_color,
layout_density, reasoning}` — nothing the seeding logic can't actually use gets asked for.

**Overlap-safety is a real mathematical property of the adjustment, not a hope the validator
catches problems.** Colors only ever touch `style` dict values (never coordinates), so they can
never cause an overlap. Proportions apply a single uniform scale factor to every zone_1 element's
x/y/width/height together, from the shared origin — the axis-aligned overlap test
(`design_schema.py`'s `_boxes_overlap`) is a linear inequality, and multiplying every term in it by
the same positive constant preserves its direction, so a seed with no overlaps (guaranteed — every
seed already passes `validate_design_data_schema`) cannot develop one from a uniform scale. This
step's own test suite proves the contrast directly, not just the safe path: a "naive" independent
per-element nudge (deliberately NOT what `apply_ai_adjustments` does) genuinely produces a real
overlap on the same fixture where the uniform scale doesn't — see
`test_a_naive_independent_nudge_WOULD_overlap...` in `test_ai_design.py`. `layout_density` is 3
fixed discrete choices (compact/balanced/spacious -> 0.92/1.0/1.08), not an arbitrary model-returned
float, partly for robustness against a creative reply and partly because the real seeds' own
margins were checked directly per template at the extreme end (1.08x) and confirmed to still fit
inside the fixed canvas bounds without even needing the defensive clamp `_clamp_zone1_bounds`
provides as a second, currently-inert layer.

**GROQ_MODEL_VISION is env-overridable with a real default** (`qwen/qwen3.6-27b`, the model the POC
was actually tested against) — noted directly in settings.py's own comment: this is NOT actually
"the same pattern as GROQ_MODEL_FAST/QUALITY" a naive reading might assume, since those two are
checked directly and are plain hardcoded strings, not env reads, despite the naming symmetry
suggesting otherwise. Env-overridable felt like the right call for a model id Groq could deprecate;
not silently "fixing" FAST/QUALITY to match, since that wasn't asked for.

**A real bug, found only by testing against the live Groq API, not by reasoning about the code**:
the first version of `classify_design_image` called `call_groq(..., max_tokens=500)`, reasoning
that this schema's own final JSON answer is tiny. A real end-to-end test (a synthetic navy-sidebar-
plus-lime-accent reference image, uploaded through the real running frontend, hitting the real
Groq API) failed every time with "returned non-JSON reply" — the actual raw reply, visible in the
server log, was qwen/qwen3.6-27b's own `<think>...</think>` reasoning block, truncated mid-thought,
with the real JSON answer never reached at all. `max_tokens` budgets the ENTIRE reply including a
thinking model's internal reasoning tokens, not just the final answer — 500 was being consumed
entirely by reasoning before any output. Fixed by raising it to 2000 (the POC's own
`analyze_design` used 4000 for a bigger schema, for the exact same underlying reason). Re-tested
live immediately after the fix: the same reference image was correctly classified as `"modern"`
(matching its real navy-sidebar-plus-accent-color design), the resulting `InvoiceDesign` saved
successfully, and opened correctly in Step 8b's real editor. This is exactly the kind of failure
that mocked tests alone cannot catch — the committed test suite's own mocked `call_groq` calls
never exercise the real model's actual reasoning-token behavior; only hitting the live API surfaced
it. The committed tests intentionally still mock Groq (per this project's own external-service
convention), so this bug now lives fixed in the code with the reasoning documented here, not
re-provable by the test suite itself.

**`_instantiate_design_from_builtin`** (`apps/invoices/views.py`) is the one real "create an
`InvoiceDesign` row from a builtin seed" code path, extracted out of `design_duplicate`'s own body —
`design_ai_seed` calls the exact same function with its own AI-adjusted `design_data` and
`source='ai_seeded'` rather than growing a second row-creation path, per the task's own explicit
instruction.

**AI-seed rate limiting is separate and stricter than every other design endpoint** — 5/hour
(`AI_SEED_RATE_LIMIT`), its own cache-key prefix, independent of `_check_moderate_rate_limit`'s
30/hour used by every CRUD design action — because this is the one design endpoint with a real
external API cost per call, not a free database operation.

**The reference image is never persisted** — read into memory (`image.read()`) for the one Groq
call and never written to Cloudinary or disk anywhere in the view or in `ai_design.py`, per the
spec's real liability/copyright reasoning (a reference image is often someone else's licensed
template design). Verified directly, not just by absence of an obvious upload call:
`test_reference_image_is_never_persisted_anywhere` mocks `cloudinary.uploader.upload` and asserts
it's never called at all during a full successful AI-seed request.

**Signature tool: classical image processing, not AI** — per the spec's own reasoning (a narrow,
well-defined problem classical thresholding solves reliably and for free; no reason to spend a Groq
call on it). `remove_signature_background` uses `Image.point()` with a 256-entry lookup table (built
once from a `threshold`/`feather` pair, applied via Pillow's C internals) rather than a per-pixel
Python loop, for real performance regardless of the photo's resolution — confirmed correct against
a realistic synthetic fixture (off-white paper with a shadow gradient AND per-pixel noise, not a
flat two-tone test pattern — a hard threshold with no feathering would have visibly aliased the
stroke edges, confirmed by testing the feathered version against corners, a shadowed-but-still-
background area, and real ink-stroke pixels separately).

**Preview-then-commit via a `commit` flag on the same endpoint, not a separate confirm endpoint with
server-side staged state.** Background removal is a cheap, deterministic, non-AI operation — the
same input bytes always produce the same output — so re-running it on the confirm call costs
nothing meaningful. There's no reason to hold processed bytes in a cache/session between the preview
and commit calls just to avoid a second, near-instant Pillow pass; the frontend simply re-submits
the same file with `commit=true` once the user approves the preview. (Contrast with the AI-seed
path above, where re-calling would mean a second real Groq charge — that asymmetry is exactly why
the two features use different patterns here rather than forcing one "confirm" convention onto
both.)

**Signature tool frontend UI is NOT built this step** — backend endpoint only
(`POST /api/invoices/signature/`), matching this project's established incremental build order
(backend first, frontend flagged and built in an announced later step, the same pattern Client
CRM/admin panel/etc. already followed). `FreelancerProfile.signature_url`/`signature_public_id`
(Step 7b) already had a real writer gap noted; this step closes the *backend* half of that gap only.
Path 3 (AI-seeded designs) DID get its frontend entry point built this step, per the task's own
explicit, separate instruction to confirm that wiring specifically — the two aren't symmetric asks
and weren't treated as if they were.

Verified: `core/tests/test_ai.py` (12 tests — retry/backoff against the real "try again in Ns"
message format, missing-key/network/non-200/malformed-response error paths, `<think>`/fence
stripping), `apps/invoices/tests/test_ai_design.py` (compression against real noisy synthetic
images, classify parsing/error-paths mocked, the overlap-safety proof across all 3 real seeds at
every density including a direct naive-vs-safe contrast, no-persistence, view-level rate limiting),
`apps/invoices/tests/test_signature_tool.py` (background removal against a realistic synthetic
photo fixture, content-validation, preview/commit/replace-and-destroy behavior, rate limiting) — all
mocking the real Groq API, per this project's established external-service test convention. Full
backend suite: 504 tests passing (up from 454 before this step). Frontend: 18 tests still passing
(unchanged by this step's frontend addition, which is upload-flow UI wired to a real endpoint, not
a data-layer change). Real, live end-to-end browser verification against the actual Groq API (not
mocked) as described above — the max_tokens bug and its fix were found and confirmed this way, not

---

Date: 09 August 2026
Decision: Reload-on-click investigation re-run from scratch (result: no reproductions found,
contradicting the premise it was raised under); invoice creation reworked from an eagerly-created
empty draft to a delayed-creation 3-stage wizard (`NewInvoiceWizard.jsx`); PDF freeze point moved
from mark-sent to finalise; timeline/banner/badge/reminders follow-on fixes.

**Reload investigation: re-run in full, honest result is zero reproductions.** This was raised as
"genuinely unfixed, not a regression — do not assume any prior 'fixed' claim holds," so it got a
real, broad, unscripted click-through (not a single scripted pass) across the entire
invoice/client surface: list, filters, sort, every card, every panel open/close, every lifecycle
button, the old and new create flows, Step 8b's design gallery/canvas editor (including inside
GrapesJS's own rendered UI — its toolbar icons were checked directly via
`el => el.tagName`, confirmed real `<div>`s, never `<a>`/`<form>`), and Step 9's AI-seed upload.
Every click was cross-checked against the Network tab for a real document-type navigation. Result:
0 click-caused unexpected navigations across the whole pass. This is reported as-is rather than
assumed fixed from a partial check, per the task's own instruction — but it's also not proof the
underlying Step 6 `AppShell.jsx` fix has zero remaining gaps anywhere in the app, only that this
specific, broad pass over this specific surface found none.

**Empty-draft creation model reversed — a deliberate second decision, not a silent overwrite of the
Step 6 Gmail-compose-style choice.** That earlier decision made "New Invoice" create a real backend
draft row the instant the button was clicked, reasoning it should feel like an always-saved Gmail
compose window. Revisited here because an invoice draft isn't actually disposable the way an empty
email compose window is — it's a real row that shows up in the invoice list, in `summary()` counts,
and in aging reports, for a business object the user hasn't actually decided to create yet (e.g.
every accidental "New Invoice" click, or a click immediately regretted, left a stray permanent
`draft` row with no client and no line items). Fixed by moving record creation to a real threshold —
at least a client (existing client selected, or a one-time client's name + email both filled in) —
crossed at Stage 1's "Next". Before the threshold, all form state lives in React only
(`NewInvoiceWizard.jsx`); closing discards it with nothing to clean up server-side. Crossing it
fires the real `POST /invoices/` and switches into the exact same continuous-autosave behavior an
existing draft already had — extracted into `useInvoiceAutosave.js` (used by both
`NewInvoiceWizard.jsx` and `InvoiceDetailPanel.jsx`) specifically so the delicate race-safe
serialization logic (verified once already, by deliberately forcing a real 2.5s-delayed network
race) never had to be hand-derived a second time.

**3 stages, boundaries given directly rather than mirrored from v1's exact split**: Stage 1 —
client + due date (where the threshold is crossed). Stage 2 — line items. Stage 3 — currency/tax/
discount/notes/terms/options. `InvoiceFormFields.jsx` now takes a `stage` prop and renders each
section conditionally; the underlying field-editing UI itself is unchanged. Finalise/Mark-as-Sent
only render at all once stage 3 is reached, and stay disabled (`canFinalise`) unless a valid client
AND at least one real line item are both true — re-checked on every render from `form`/`invoiceId`
directly, not assumed from "the user won't jump backwards" — confirmed as a real UI-state guarantee
by a dedicated test that fills stage 3 as valid, jumps back to stage 1, blanks the client email, and
jumps forward again, and finds both actions disabled again
(`NewInvoiceWizard.test.jsx`). This also subsumes what would otherwise have been a separate
"don't let mark-sent fire on an empty draft" fix — with creation now gated behind the same
threshold Finalise/Mark-as-Sent are gated behind, there's no longer a code path that reaches either
action with an empty invoice. A defensive backend check was still added to `invoice_mark_sent`
(reject a direct call with no line items) as pure defense-in-depth against the endpoint being hit
directly, bypassing the wizard entirely — not asked for explicitly, but a 3-line mirror of
`invoice_finalise`'s own existing check, closing an easily-avoidable gap rather than leaving it open
on the assumption nobody would call the API directly.

**Backend validation errors route to the stage that owns the failing field**
(`routeErrorsToStage`), the same pattern v1's own `InvoiceForm` used
(`if (mapped.client_name...) setStep(1)`), adapted to v2's real field/error names — a
`client_name`/`client_email`/`due_date` error goes to stage 1, any `items`/`item_N_*` error goes to
stage 2, anything else falls through to stage 3.

**PDF freeze point moved from mark-sent to finalise.** `is_editable` already only allows edits at
`status='draft'` — a `created` invoice is already fully immutable, so freezing the PDF at
mark-sent/send meant every `GET .../pdf/` on a `created`-but-not-yet-sent invoice was live-rendering
pointlessly. `_finalise_invoice()` (new shared helper, called by both `invoice_finalise` directly and
by `invoice_mark_sent` when it's invoked on a still-draft invoice, since Finalise and Mark-as-Sent
are parallel choices in the UI, not a strict sequence) now does the one-time render+store; the
now-redundant render+store call was removed from `invoice_mark_sent`. `GET .../pdf/`'s boundary moved
from "live-render draft or created" to "live-render draft only" — `created`-and-beyond always
redirects to the frozen `pdf_url`. `invoice_duplicate` was re-confirmed to still reset `pdf_url`/
`pdf_generated_at`/the new `finalised_at` on the fresh draft it creates (all three are simply
omitted from its explicit `create()` kwargs, the same pattern as before). This also directly backs
Stage 2's new "Preview PDF" action — it calls the same live-render endpoint against the
still-draft invoice, so no separate preview-specific code path was needed.

**`finalised_at` added** (`apps/invoices/migrations/0005_invoice_finalised_at.py`) — didn't exist
before this pass; set inside `_finalise_invoice()`, the same place this pass was already touching for
the PDF-freeze move, rather than as a separate migration pass. `invoice_timeline` now always seeds a
`created` entry from `Invoice.created_at`, and conditionally adds `finalised` (from `finalised_at`)
and `sent` (from `sent_at`, tagged `via: 'platform'|'manual'` from `sent_via_platform`) before the
existing view/reminder/payment entries — additive only, nothing already surfaced there changed.

**3-state "hasn't been sent through LanceraOS" banner** (`getSendBannerCopy`,
`invoiceHelpers.js`) — the same field-level facts already on `Invoice`
(`status`, `sent_via_platform`, `sent_at`, `reminders_enabled`) drive 3 genuinely different messages
rather than one generic "not sent" warning: `created`-never-mark-sent keeps the original copy;
`sent`-via-manual-dropdown acknowledges the freelancer's own choice, states the real reminders
on/off decision they made, and clarifies tracking activates only once the client opens the link;
`sent_via_platform=True` shows no banner at all. That third branch has no real data reaching it yet
(the real `/send/` action is Step 10) but the condition is written correctly now rather than left as
a guess for later. A real, separate success toast (via `useTimedMessage`, the same pattern already
used in `Profile.jsx`) now fires on Finalise/Mark-as-Sent alongside whichever banner applies, not
instead of it — carried across the wizard-to-`InvoiceDetailPanel` hand-off (the wizard unmounts on
success, discarding its own toast state) via a new `initialMessage`/`onInitialMessageShown` prop
pair, confirmed working end to end via Playwright.

**Status badge differentiation uncovered a real, pre-existing bug affecting the whole app, not just
invoices.** `INVOICE_STATUS_META` mapped `created`/`sent`/`viewed` all to the same `'blue'` bucket —
textually different statuses, visually identical badges. Fixed within DESIGN.md's existing 5-color
token set (no new hex values) by adding a `variant` (`filled`/`outline`) per status and, while
verifying the fix in a real browser, finding that `getComputedStyle(document.documentElement)
.getPropertyValue('--status-green-bg')` (and the other 14 `--status-{color}[-bg|-text]` tokens)
returned `''` — they were referenced everywhere via `STATUS_BADGE_STYLE` but had never actually been
defined in `theme.css`, so every status badge in the app had been silently rendering with browser
fallback values (`background` falls back to its own initial value, `transparent`, rather than
erroring) for an unknown period before this. Added all 15 tokens to `theme.css` per DESIGN.md
Section 2.5's own spec values; `draft`/`created` now render as outline variants of gray/blue,
`sent`/`viewed`/`paid`/`partially_paid`/`bad_debt` as filled, distinguishing every status that
shares a color bucket with a sibling.

**Preview PDF's popup: a real Playwright/Chromium automation artifact, not a real bug — recorded so
it isn't "fixed" a second time later on a false premise.** The implementation opens a blank tab
synchronously (before any `await`, so it's still a direct result of the click — a tab opened only
after an `await` is exactly what popup blockers target) and navigates it directly to the real,
authenticated `GET /invoices/{id}/pdf/` endpoint once the pending autosave flushes — a normal
top-level navigation, so the httpOnly auth cookie rides along on the same registrable domain
(`localhost:5173`/`:8000` share one) exactly like a real link click, no blob URL involved. An earlier
attempt used a blob URL instead (`axios` GET the PDF bytes, `URL.createObjectURL`, then
`window.open()` to it) and was abandoned after confirming directly that Chrome never actually
navigated the tab to it — blob URLs are scoped to the document that created them and don't reliably
transfer into a separate top-level browsing context via `window.open`. The direct-navigation version
looked broken under Playwright too (`page.waitForURL` timing out with `net::ERR_ABORTED; maybe frame
was detached?`, `popup.url()` stuck on `about:blank`) until checked against the real network layer
directly (`context.on('response', ...)`), which showed the actual request completing
(`GET /invoices/{id}/pdf/ -> 200 [application/pdf]`) with the popup still open and attached
(`context.pages().length === 2`, `popup.isClosed() === false`). This matches a known Chromium
behavior: a top-level navigation that resolves to a PDF response hands the frame to Chrome's
internal PDF viewer (a separate guest-view process), which a real user sees as the PDF simply
rendering, but which Playwright's own navigation-tracking (`waitForURL`/`.url()`) doesn't follow —
an automation-harness limitation, not a defect in the app. No app-code fix was needed; the debug
`console.log` statements added while isolating this were removed once confirmed.

Verified: full backend suite, 510 tests passing (up from 508 — 2 net additions this pass on top of
the pre-existing rewrites the freeze-point boundary move required across `test_pdf_pipeline.py` and
`test_views.py`). Frontend: 28 tests passing (up from 18) — the pre-existing design-editor
`serialization`/`rules` suites unchanged, plus a new `NewInvoiceWizard.test.jsx` (10 tests, React
Testing Library + `axios-mock-adapter` against the real shared `api` instance, no
`@testing-library/jest-dom` in this project's devDependencies so assertions use plain `expect` +
raw DOM properties) covering: closing before the threshold creates no backend row; Next without a
client is blocked and creates nothing; crossing the threshold fires exactly one `POST` and a second
Back/Next cycle never fires a second one; Back-then-Next preserves both client and item field state;
a `client_*`-field backend error on finalise routes back to stage 1 while an `item_*` error routes
to stage 2; Finalise/Mark-as-Sent are absent before stage 3, disabled with a blank line item, enabled
once it's filled, and re-disabled after bouncing back to stage 1 and invalidating the client. Real
browser verification (Playwright, ad-hoc, not committed) confirmed the same scenarios end to end
against the live backend, plus the reload investigation's full click-through and the Preview PDF
network-layer check described above.

---

Date: 10 August 2026
Decision: Reload-on-filter-click root cause found (a generic auth-expiry hard-redirect, not a filter
bug); wizard gains a real draft-edit mode and a search-driven client step; currency/tax/discount move
into stage 2; Mark-as-Sent removed from the wizard entirely; reminders default reversed to off;
payment-amount-exceeds-due validation added; several real bugs fixed (banner condition, preset-list
refresh, KPI mobile layout); invoice numbering isolation re-verified and confirmed still correct.

**Reload-on-filter-click: found, with real Network-tab evidence — but the root cause is not in the
filter pills at all.** The exact interaction (every status pill, the Overdue toggle, the client/sort
selects, on both Invoices.jsx and Clients.jsx) was re-tested with the rigorous check this task asked
for — a `window.__markerCheck` set before each click, verified to survive after it, plus
`framenavigated` event tracking — across both Chromium and WebKit. Zero reproductions, confirming
every filter control really is a plain `<button>`/`<select>` with no form ancestor (ruling out the
implicit-submission theory directly). A whole-codebase grep for anything capable of a real
`window.location` write turned up exactly two: `NewInvoiceWizard.jsx`'s Preview PDF (a different tab,
irrelevant here) and `api.js`'s `_forceLogout()` — the ONLY code path in the entire frontend that can
produce a genuine full-page navigation. Reproduced directly: wiping the auth cookies mid-session
(simulating an already-dead session — natural 15-minute access-token expiry with a since-invalidated
refresh token, or the session getting evicted by the 3-concurrent-session cap, very plausible given
how many fresh test-user logins this project's own iterative Playwright-testing workflow has produced
across sessions) and then clicking a filter pill produces exactly what was reported: `GET /invoices/
-> 401`, a failed silent-refresh attempt, then a real hard navigation to `/login`. This isn't specific
to filter pills — it's the first API call made after the session dies, which happens to be a filter
click simply because that's usually the first thing someone does after leaving a tab idle. The
previous investigation's "zero reproductions" was accurate for what it tested (a live, valid session
throughout) — it just never tested an expired one, which is the one condition that reproduces this.
One real improvement made alongside the diagnosis (not a fix to the mechanism, which is correct and
necessary as-is): `_forceLogout()` now redirects to `/login?session_expired=1`, and `Login.jsx` shows
"Your session has ended — please sign in again." instead of silently dumping the user on a blank
login form with no explanation — the message is captured once on mount (before a cleanup effect
strips the query param) so it survives the URL rewrite. `overscroll-behavior-x: contain` was also
added to both pages' horizontally-scrollable pill rows as a separate, purely defensive hardening
against macOS trackpad swipe-to-navigate — a real, well-documented browser gesture risk for this
exact CSS pattern, but NOT something this pass could confirm or rule out as a contributing cause
(Playwright's `.click()` has zero lateral pointer travel, and a synthetic CDP wheel-delta burst aimed
at reproducing it produced no navigation either) — added because it's zero-risk and closes a
plausible secondary gap, not reported as "the fix."

**Wizard gains a real draft-edit mode (`editInvoiceId` prop) — every status=draft invoice now opens
the wizard, not `InvoiceDetailPanel`.** A draft is still being built, so it belongs in the same guided
flow a brand-new one does, pre-filled with its real saved data instead of starting blank. Wired at
both real entry points: `Invoices.jsx`'s `openDetail` now branches on `invoice.status === 'draft'`,
and `preset_create_invoice`'s result (also a real, immediately-usable, but still `status='draft'`
invoice) opens the same way instead of the detail panel. Lands on stage 1 if the client isn't valid
yet, stage 2 if the client is set but items aren't, or stage 1 as the reasonable default once
everything's already filled in — there's nothing further to prompt for, and stage 1 is the more
natural "you're editing this" landing spot than jumping straight to line items. `InvoiceDetailPanel`'s
own `status === 'draft'` rendering branch is now unreachable through any known UI path (both entry
points route drafts to the wizard) but was deliberately left in place rather than deleted — a
defensive fallback that still works correctly if ever reached, not dead code removed without being
asked to.

**Wizard restructure**: currency/tax/discount moved out of stage 3 and into stage 2, alongside line
items, so the running total (`computeTotals`, unchanged) is visible while it's still being built, not
only after moving on. Stage 3 is now just notes/terms + reminders/late-fee/recurring options.
`routeErrorsToStage` updated to match — a `currency`/`tax_rate`/`discount_amount` backend error now
routes to stage 2, not 3.

**Preview PDF relocated to the bottom action row, available from stage 2 onward (once ≥1 real item
exists); Mark-as-Sent removed from the wizard entirely.** Preview used to render inline inside stage
2's body — it's now a permanent fixture of the footer, gated by `canPreview` (`stage >= 2 &&
itemValid`) rather than only existing while stage 2 happens to be showing. Mark-as-Sent never made
sense inside a "build this invoice" flow — marking something sent before it's even finalised isn't a
real state a user should be able to reach — so its handler, button, and API call were deleted from
`NewInvoiceWizard.jsx` outright, not just hidden. It stays exactly as it was in `InvoiceDetailPanel`,
for already-created invoices only; confirmed no wizard code path can reach it (grepped directly —
`mark-sent`/`mark_sent` appear nowhere in `NewInvoiceWizard.jsx` after this change).

**Client step rebuilt around a real, debounced, backend search (`ClientSearchField`, inside
`InvoiceFormFields.jsx`) — replaces the Existing/One-Time button toggle entirely.** The old
`ClientCombobox` filtered whatever client array happened to already be in memory (capped at
`client_list`'s own default page size, 50) client-side; it's replaced with the Name field itself
doubling as a live search trigger against the real `GET /clients/?search=...` endpoint (the exact
query Clients.jsx's own search already uses server-side — `Q(name__icontains) | Q(email__icontains)
| Q(company__icontains)`), 300ms debounced. Picking a result fills every client field directly and
sets `client`; manually editing Name or Email afterward detaches the link (`client` back to `null`) —
editing means this invoice is being customized for this one send, not mutating the saved record.
Company/Phone are now always-visible plain fields regardless of whether a client is linked, matching
one-time-client data entry with no separate mode switch anywhere. `clientMode` is gone from the form
shape entirely (`blankInvoiceForm`/`invoiceToForm`/`formToPayload` in `invoiceHelpers.js` all
updated) — `is_one_time_client` is now derived directly as `!form.client`.

**"Save this as a new client" — a real, opt-in POST /clients/ at the threshold-crossing moment, OFF
by default.** Shown only when no client is linked and both name+email are filled in, and only before
the invoice exists (`allowSaveAsNewClient={!invoiceId}` — once an invoice exists, whether freshly
created this session or a loaded existing draft, there's no more "threshold" to hook a client-save
into). Checked at `handleNextFromStage1`: if the toggle is on, `POST /clients/` fires FIRST, so the
invoice's own `client` FK can point to the new record from creation, not a follow-up PUT; a rejection
here (duplicate email) stops before the invoice is ever created, staying on stage 1 with the real
error surfaced. The duplicate check itself is new, real, server-side validation
(`ClientSerializer.validate_email` in `apps/clients/serializers.py`) — case-insensitive, checked
across archived clients too (a re-added email should surface as "you already have this client," not
create a second row) — and applies to every caller of this serializer, not just the wizard's new
flow, since the underlying problem (silently creating a duplicate Client record) is identical for the
plain "Add Client" modal too. There was no such check anywhere before this — `Client.email` has never
carried a uniqueness constraint at the DB level, and nothing validated it at the serializer level
either.

**Reminders default reversed to False for new invoices** — was `True`, ported unchanged from v1 all
the way through the last several passes. A brand-new invoice hasn't been sent yet, so defaulting
reminders on means enabling a schedule for something that isn't even going out yet; there's nothing
real to remind about until the freelancer actually sends it and makes a real choice (the Mark-as-Sent
modal's own checkbox, or Step 10's `/send/`). Changed in both places that need to agree, confirmed
directly rather than assumed: `Invoice.reminders_enabled`'s own model field default
(migration `0006_alter_invoice_reminders_enabled`) and `blankInvoiceForm()` in `invoiceHelpers.js`
(the wizard's pre-creation state). Every other creation path was checked for an explicit override that
would fight this: `preset_create_invoice` sets nothing, correctly inheriting the model default;
`invoice_duplicate` deliberately copies the ORIGINAL invoice's own `reminders_enabled` value (a
duplicate should preserve settings, not reset them — unrelated to this default and left alone); the
Mark-as-Sent modal's own local checkbox still defaults to checked, which is correct and unrelated —
that's a distinct, deliberate choice made AT the moment of explicitly marking something sent, not the
"what does a brand-new, unseen draft start with" question this change answers. Existing invoices are
completely unaffected — this is a schema default for new rows, not a backfill.

**Payment-amount-exceeds-due validation** — `invoice_add_payment` (manual partial-payment entry, the
one path where a user can type any number) previously had no check against `outstanding_amount` at
all; `InvoicePartialPaymentSerializer.validate_amount` now rejects any amount greater than the
invoice's real outstanding balance, with the actual remaining amount stated in the error. The
comparison is deliberately naive about currency — it compares the payment's raw `amount` directly
against `outstanding_amount` with no conversion, matching `update_paid_status()`'s own pre-existing
convention of summing `partial_payments.amount` directly regardless of each payment's own `currency`
field (a real, separate simplification already baked into this system, not something this fix changes
or was scoped to touch). `mark_paid` was already safe by construction (pre-fills exactly the
outstanding balance) and needed no change. Frontend: `AddPaymentModal` checks the same comparison
client-side for immediate feedback; `InvoiceDetailPanel`'s `runAction` error handler was also
generalized to surface a DRF field-level error (e.g. `{"amount": [...]}`) as a fallback message
instead of only ever showing a generic "Action failed" when something reaches the backend anyway —
the backend check is the one that actually matters, per the task's own framing, and this makes sure
its message is visible when it fires.

**Real bugs found and fixed, each confirmed with direct evidence, not assumed from the report alone**:
- The "hasn't been sent through LanceraOS" banner (`getSendBannerCopy`) was showing on every status
  beyond `created` with `sent_via_platform=False` — i.e. `viewed`/`partially_paid`/`paid`/`cancelled`/
  `refunded`/`bad_debt` too, not just `sent`. The `else` branch fell through for anything past
  `created`; fixed by checking `status === 'sent'` explicitly as its own branch, with a bare `return
  null` for everything else.
- Saving a new `InvoicePreset` from `InvoiceDetailPanel` never appeared in `Invoices.jsx`'s "From
  Preset" picker without a full reload — `presets` was fetched once on mount with no way to learn a
  new one existed. Fixed with a real callback (`onPresetSaved`, called with the server row on
  success) rather than Invoices.jsx re-fetching the whole list — confirmed working via Playwright: a
  freshly-saved preset now appears in "From Preset" with no reload.
- The 3 dashboard KPI cards (`SummaryStrip` in `Invoices.jsx`) were wrapping to one-per-row well
  before 375px (`minmax(200px, 1fr)` × 3 + gaps exceeds any phone width). Fixed with a `≤480px` media
  query forcing exactly 3 explicit columns with reduced padding/font, verified with real screenshots
  at 375/768/1280/1920 — unaffected at the 3 wider breakpoints, all 3 cards genuinely stay in one row
  at 375px.
- The `created` status's DISPLAY label was renamed to "Finalised" everywhere it appears
  (`INVOICE_STATUS_META`, `STATUS_FILTER_OPTIONS`, the pill/badge/timeline text) to match the
  "Finalise" action button's own name — a display-layer rename only. The stored status VALUE stays
  `'created'` in the database, the API, and every filter query param; nothing backend-side changed.
- `invoice_timeline`'s `created`/`finalised`/`sent` entries (added last pass) had never actually
  gotten matching frontend rendering — `timelineLabel`/`timelineIcon`/`timelineDotColor` only handled
  `payment`/`reminder`/`view`, so these 3 event types rendered as a raw, unstyled type string. Fixed
  as part of adding the "who sent it" requirement: `sent` now reads "Sent by LanceraOS" (`via:
  'platform'`) or "Marked as sent by you" (`via: 'manual'`) — no new actor field needed, since a
  manual mark-sent only ever has one possible human actor (the invoice's own freelancer); `created`/
  `finalised` got real labels and icons too. `timelineLabel`/`timelineDotColor` moved from
  `InvoiceDetailPanel.jsx` into `invoiceHelpers.js` (pure, no JSX) specifically so they're directly
  unit-testable without rendering the whole panel; `timelineIcon` (returns JSX) stayed inline.

**Invoice numbering — re-verified, not assumed broken, and it genuinely still holds.** A real,
end-to-end test (`InvoiceNumberingInterleavedIsolationTests`, `test_views.py`) creates two distinct
users, each with 3 real draft invoices, and finalises them through the actual `POST .../finalise/`
endpoint in a genuinely interleaved order (user A, user B, user A, user B, ...) using two independent
authenticated sessions — not one client re-logging in between calls. Both users' numbers came out as
their own clean 0001/0002/0003 sequence, completely unaffected by the other's interleaved activity,
in both interleave directions. `generate_invoice_number`'s only real call site was also confirmed
directly (grepped, not assumed) to still be exactly one place — `_finalise_invoice`
(`apps/invoices/views.py`) — so numbering has NOT shifted to draft-creation time despite this and the
previous pass's changes around the freeze-point/wizard rework; every draft in the new test starts
with a genuinely blank `invoice_number`, confirmed directly before finalising. Zero-padding past 9999
was also verified empirically rather than trusted from the format string: a real `INV-{year}-9999`
followed by a real finalise call produces `INV-{year}-10000`, not a truncated or colliding value.
The only real regression risk named in the task (numbering shifting to draft-creation time) does not
exist; the numbering system is correct as-is.

Verified: full backend suite, 518 tests passing (up from 510 before this pass) — includes the 2
`InvoiceNumberingInterleavedIsolationTests` isolation tests + 1 zero-padding test, 4 new
`AddPaymentTests` payment-validation tests, 2 new `ReminderDefaultTests`, and 2 stale assertions in
`test_toggle_reminders_on_created_status_specifically` fixed to match the new reminders default
(this test predates this pass and asserted the OLD `True` default — a necessary update, not a
regression). Frontend: 51 tests passing (up from 28) — `NewInvoiceWizard.test.jsx` fully rewritten
(22 tests: threshold/back-forward/error-routing/gating from before, plus new coverage for the client
search-and-pick flow, the save-as-new-client toggle's success and duplicate-rejection paths, the
reminders-default-false payload check, and 4 new tests for draft-loading mode landing on the right
stage with real data) and a new `invoiceHelpers.test.js` (11 tests) covering the banner condition's
exact 2-state restriction and the timeline's who-sent-it label logic directly. Real browser
verification (Playwright, ad-hoc, not committed) confirmed every scenario above end to end against
the live backend, including the reload investigation's dead-session reproduction and the KPI-mobile
screenshots at all 4 required breakpoints.

---

Date: 10 August 2026 (second entry)
Decision: The real root cause of the "everything feels like a page reload" complaint found —
loading-state re-render, not navigation. Four prior rounds investigating this as a routing/navigation
bug never found anything because there was nothing there to find. Also: search's stale-closure bug
fixed, out-of-order response protection added, status/Overdue filters made mutually exclusive, the
client filter dropdown removed, the real KPI tablet-wrap breakpoints found and fixed, and the
reminders lifecycle rule refined into two distinct defaults (wizard vs. finalise), reversing part of
the same-day earlier entry above.

**Root cause: `load()` set `loading=true` unconditionally on every filter/search/sort change, and the
render logic was `{loading && <InvoiceGridSkeleton />}` — every interaction unmounted the entire list
and rebuilt it from an empty skeleton, which looks and feels exactly like a page reload without
being one.** Confirmed directly against the real, current, GitHub-synced `frontend/src/pages/
Invoices.jsx` (verified before touching anything: `LIMIT = 60`, `buildParams`, `statusFilter`/
`overdueOnly`/`clientFilter` as separate state variables — the real file, not the `v1-reference`
copy) before making any change. Same shape confirmed directly in `Clients.jsx` too (not assumed
identical — its `load()` and render both had the exact same unconditional-`setLoading(true)` /
`{loading && <Skeleton/>}` pattern, though its `handleSearchChange` did NOT have the stale-closure bug
described below, since it already passed the typed value as an explicit argument into `load()` rather
than reading `search` state inside `load` itself).

**Fix**: the skeleton now only renders on a genuine first load (`loading && invoices.length === 0 &&
!error`, applied identically to `clients.length` in `Clients.jsx`). Every subsequent refetch keeps the
existing grid mounted and dims it to `opacity: 0.55` during the fetch instead of unmounting it — a
plain CSS transition, not a new component; no established shimmer/progress-bar pattern existed
anywhere else in the app to match, so the simpler "subtle opacity dim" option (offered as an
alternative alongside a thin progress bar) was picked over inventing new animation/positioning
machinery. An in-flight error on a refetch that still has a list showing now surfaces as an inline
`FosAlert` with its own Retry button ABOVE the grid, rather than replacing the whole grid with the
centered full-page error state — that centered state is now reserved for when there's truly nothing
to show (`error && invoices.length === 0`). Verified directly, not just by reading the diff: a
Playwright check tagged the actual rendered DOM nodes with a `data-testmark` attribute before
switching filters, then confirmed marked nodes were still present in the DOM at the 30ms mark
(before the mocked response could possibly have resolved) — the skeleton never appeared mid-flight,
and the list never disappeared.

**Search stale closure**: `handleSearchChange`'s debounced `setTimeout` callback called `load(buildParams(0))`,
and `buildParams` reads `search` state via closure — for rapid typing, the closure captured over `search`
from whichever render was current when `setTimeout` was scheduled, which could be one keystroke behind the
actual final value by the time the debounce fired. Fixed by passing the just-typed value directly into the
call instead: `load({ ...buildParams(0), search: value || undefined })` — the explicit spread always wins
over whatever `buildParams(0)`'s own (possibly stale) internal reference to `search` produces. Verified with
a real rapid-fire keystroke sequence (a/ac/acm/acme in a Playwright script, and separately in a
`fireEvent.change` sequence in `Invoices.test.jsx`) — the network request that actually goes out carries
the true final value ("acme"), and only one debounced call fires for the whole burst.

**Stale (out-of-order) response protection**: added a monotonically increasing request-id
(`latestRequestId` ref), checked before every commit to state in both `Invoices.jsx`'s and
`Clients.jsx`'s `load()`. No existing `AbortController`/request-id pattern existed anywhere else in
the app to match — the only mention of `AbortController` anywhere is a comment in
`useInvoiceAutosave.js` explaining why it was REJECTED for THAT hook's problem (aborting a client-side
promise doesn't stop Django from finishing an in-flight PUT, so an aborted write could still land in
Postgres after a newer one — a write-ordering concern). That reasoning doesn't transfer here: these
are reads, and all that's needed is "don't let an out-of-order response overwrite state with stale
data," which a simple request-id counter handles without any special abort-error handling. Verified
with a real out-of-order scenario in `Invoices.test.jsx`: a slow mocked response (150ms, for a `sent`
filter clicked FIRST) engineered to resolve AFTER a fast mocked response (10ms, for a `draft` filter
clicked SECOND) — the final rendered state correctly reflects the `draft` result, never the `sent`
one, despite the `sent` response physically arriving later in wall-clock time.

**Overdue and status filter made mutually exclusive** — confirmed directly this round that the
previous design intent (independently combinable, so a sent-and-overdue invoice was reachable by
both at once) is no longer what's wanted. Selecting any status pill now clears `overdueOnly`;
toggling Overdue now clears `statusFilter`. The header comment describing "independent combinability"
was rewritten to state the new rule plainly rather than left contradicting the actual code. A
sent-and-overdue invoice is still reachable — via Overdue alone, or the Sent pill alone — just not by
both applied together.

**Client filter dropdown removed from the frontend** (state, `buildParams` entry, the `<select>`
itself, and the now-fully-dead `clients`/`setClients` state + its mount-time fetch, which had no other
use in the file once the dropdown was gone) — redundant with client search inside invoice creation.
The backend's `?client=` query param is completely untouched; only this one frontend consumer of it
is gone.

**KPI tablet-wrap: the real breakpoints, measured, not guessed.** A width sweep against the actual
running app (Playwright, `boundingBox()` checks on `.kpi-card`, not a visual guess) found the 3 KPI
cards actually wrap in TWO separate zones, not one continuous "tablet width": `(480,659]` and
`[769,939]`, with a genuinely fine zone in between (660-768) and above (940+). The second zone exists
because `AppShell.jsx`'s own `isMobile = window.innerWidth <= 768` switch introduces a persistent
sidebar at 769px that eats enough horizontal width to reintroduce the wrap despite the viewport being
WIDER than the already-fine mobile range below it — auto-fit's 200px-per-card minimum (600px+gaps)
needs more contiguous width than is available with the sidebar present until ~940px. Fixed by
extending the existing `≤480px` "force 3 explicit columns" rule to `≤939px` as a single rule — safe to
apply across the already-fine 660-768 gap too, since forcing exactly the same 3-equal-column result
auto-fit already produces there changes nothing visually. Native `auto-fit` is left alone at 940px+,
confirmed working correctly on its own from 940 through at least 1020 (and, by the same math, every
wider desktop width too, since more room only helps auto-fit, never hurts it).

**Reminders: reverted the wizard's own default back to `true`, replaced the earlier same-day "flip
one default everywhere" decision with the real, two-part lifecycle rule this round actually asked
for.** The earlier entry above this one changed `blankInvoiceForm()`'s `reminders_enabled` to `false`
site-wide (both the model field default and the wizard's own state). This entry reverses HALF of
that: the wizard's own creation-time default is `true` again — the frontend-visible starting state a
user sees while creating an invoice, with their explicit choice (if they turn it off) respected
through creation and autosave. What's NEW and does the actual work this round intended:
`_finalise_invoice` (`apps/invoices/views.py`) now unconditionally sets `reminders_enabled = False` on
every invoice at the moment it leaves draft, REGARDLESS of whatever value was submitted during
creation — a deliberate override, not an oversight, with its own inline comment explaining why:
finalising never sets `sent_via_platform=True`, and per that field's own help_text ("gates reminders
only"), reminders are structurally inert until a real send happens, so storing `True` here would be a
value nothing can act on. `Invoice.reminders_enabled`'s bare model-field default is deliberately LEFT
at `False` — it's moot the instant any invoice is finalised, and the one narrow case where it could
still show through (a preset-created draft, which skips both the wizard's payload and this function
entirely, reopened before being finalised) is flagged in `invoiceHelpers.js`'s own comment rather than
silently resolved, since the task scoped this default specifically to the wizard/creation UI.
`invoice_mark_sent`'s own handling was traced end to end, not assumed: when invoked directly on a
still-draft invoice, it calls `_finalise_invoice` FIRST (forcing `False`), then immediately applies
its own `send_reminders` choice from the confirm dialog — so the two rules never actually conflict,
they just apply in sequence, and mark-sent's own choice is always what's actually stored in the end.
Frontend: no change was needed to make the detail panel show the real post-finalise value — it
already does a genuine `GET /invoices/{id}/` on mount (`loadInvoice`), so the moment the wizard hands
off to it, the "on-during-creation, off-after-finalise" transition is just what a real refetch
naturally shows; confirmed directly with Playwright (wizard's stage-3 toggle checked by default,
finalise, detail panel's "Automatic reminders" row reads "Off"). A `TODO(Step 10 /send/)` was added at
the override's exact line, flagging — not deciding — whether the real `/send/` action should restore
the user's original wizard choice or simply default `True` again; that's Step 10's call, not this
one's.

**A real discrepancy between this task's stated premise and the actual code, left as the task
explicitly directed but flagged for the record**: the task asserted "Manual mark-sent's own
confirm-dialog reminders toggle: UNCHANGED, still correctly defaults false, not touched by this fix."
Checked directly against `MarkSentModal`'s real source (`InvoiceDetailPanel.jsx`) — its default is
`useState(true)`, not `false`. Per the task's own explicit instruction that this file is "not touched
by this fix," it was left exactly as-is; this entry records the mismatch rather than silently treating
the incorrect premise as confirmed fact, or silently "fixing" something declared out of scope.

Verified: full backend suite, 520 tests passing (up from 518) — 3 new tests in `FinaliseTests`
(the two-starting-values reminders-forced-false proof via `subTest`, and the mark-sent-from-draft
sequencing proof), plus 1 pre-existing test (`test_toggle_reminders_on_created_status_specifically`)
updated to start from `reminders_enabled=True` specifically so it proves the override rather than
coincidentally matching the unrelated model default. Frontend: 60 tests passing (up from 51) — a new
`Invoices.test.jsx` (7 tests: first-load-vs-refetch skeleton behavior with real DOM-identity marker
checks, the search stale-closure fix, the engineered out-of-order-response scenario, both directions
of status/Overdue mutual exclusivity, and the client-dropdown removal) and 2 new tests plus 1 rewritten
test in `NewInvoiceWizard.test.jsx` covering the reminders default reversal (payload check, visible
toggle state, and that an explicit user off-choice survives through autosave to finalise). Real
browser verification (Playwright, ad-hoc, not committed) confirmed every fix end to end against the
live backend at the exact measured breakpoints and interaction sequences described above.
through the mocked test suite.