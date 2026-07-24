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