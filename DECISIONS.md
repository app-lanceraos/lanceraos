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