# STANDARDS.md

Coding conventions every module chat follows. Established during the Users/Auth module build;
apply the same conventions to every module built after this one.

---

## Naming

- **Models**: singular PascalCase (`User`, not `Users`; `FreelancerProfile`, not `FreelancerProfiles`).
- **URL paths**: plural/action kebab-case (`/sessions/`, `/change-password/`, `/email-change/request/`).
- **View function names**: verb_noun (`change_password`, `list_sessions`, `revoke_session`), not
  noun_verb or bare nouns.
- **Serializer names**: `ModelNameSerializer` for the primary representation
  (`UserSerializer`, `FreelancerProfileSerializer`); `ModelNamePurposeSerializer` for a distinct-purpose
  variant of the same model (`AccountUpdateSerializer` for the Profile page's Account tab, kept
  separate from `RegisterSerializer` even though field-level rules look similar — see the note on
  self-exclusion below).
- **Celery task names**: verb_noun_frequency style where it aids clarity in the beat schedule
  (`anonymize_expired_accounts`, `cleanup_expired_sessions`), matched by a beat-schedule key describing
  the same thing plus cadence (`'anonymize-expired-accounts-daily'`).

## File headers

Every file's first line (or first line of the module docstring) states its own project-relative path,
e.g. `# apps/users/models.py`. Established partway through the Users/Auth build — apply to every file
in every module going forward, including ones written before this convention (retrofitted for
`apps/users/*` and `core/*` already).

## Every model

- `__str__` returning a human-readable string — no bare model reprs.
- UUID primary key (`models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)`) unless
  there is a specific, stated reason not to (CLAUDE.md rule 13 — prevents enumeration on a financial app).
- Every model file runs through the 6-question framework (mutable? soft-deleted? audit trail? indexed?
  encrypted? cascade behavior?) before being written — see `DATABASE.md` for the answers already on
  record for `apps/users`.

## No print() statements anywhere

Use `logging.getLogger(__name__)`. Established in `core/observability.py`'s `log_event()` and followed
throughout — e.g. a failed `AuditLog` write logs via `logger.exception(...)`, never `print()`.

## Docstrings explain WHY, not just WHAT

A one-line "does X" docstring is not sufficient where a design decision or non-obvious constraint is
involved — explain the reasoning inline, the same way `apps/users/authentication.py`,
`apps/users/models.py` (`Session`, `anonymize()`), and `apps/users/token_service.py` do. A future reader
(including a future AI session with no memory of this conversation) should be able to understand *why*
a piece of code exists from reading it alone, not just what it does.

## Single source of truth for shared constants and logic

If two files need the same validation list, regex, or business rule, it lives in exactly one place and
the other file imports it. Concretely in this module: `DISPOSABLE_DOMAINS`, `RESERVED_USERNAMES`, and
`validate_password_strength` live only in `apps/users/serializers.py` — `views/auth.py` imports them
rather than redefining them (v1 duplicated these between `views.py` and `serializers.py`, which is
exactly the drift risk this rule exists to prevent). Similarly, `get_client_ip` / `get_user_agent` /
`normalize_user_agent` live only in `core/observability.py`, used by every app that needs them.

## Dead code and dead config are worse than no code

If a class, function, or config entry isn't actually exercised by any real code path, remove it rather
than carry it forward for "fidelity" to a previous version. Found and removed during this build:
`EmailChangeStep1TokenGenerator` / `EmailChangeStep2TokenGenerator` (v1's `tokens.py` defined them, v1's
actual view logic never called them) and the DRF `DEFAULT_THROTTLE_RATES` scoped-rate entries for
`login`/`register`/etc. (declared in v1's settings, never attached to any view via `throttle_scope`).
Config or code that looks load-bearing but isn't actively misleads whoever reads it next — treat
discovering it as a signal to delete it, not preserve it.

## Testing discipline for this project

Every file that touches the database, an external service, or security-sensitive logic gets exercised
with real code before being considered done — not just read over. Concretely: every model change ran
through an actual migration; every view ran through Django's real test `Client` against real URL
routing; every external call (Resend, Google, Facebook, Cloudinary, SMTP) was tested against a mocked
boundary rather than skipped, so the surrounding logic (error handling, redaction, state transitions)
is still proven. When a test's assumption turns out to be wrong, that's worth surfacing before shipping,
not smoothing over — e.g. the `password_changed_at` gap found by specifically testing a user's *first*
password change, or the anonymization bug found by anonymizing two users back-to-back instead of one.

## Comment on WHY a deviation from the obvious/expected approach was made

If a reader would reasonably expect approach A and the code does B, say why in a comment at the point
of divergence — don't rely on this document or chat history being available to a future reader. E.g.
`core/email.py`'s docstring explains why it doesn't use Django's mail backend even though that's the
"obvious" Django way to send email.

---

## Frontend conventions

Established during the Users/Auth frontend build (12 pages, 127 tests). Apply the same conventions to
every module's frontend built after this one.

### Never emojis or bare symbols — icon components only

No emoji and no bare Unicode symbols (⚠ ✓ ✗ etc.) standing in for an icon, anywhere in rendered UI —
always a real `lucide-react` component instead, even for small inline indicators that feel throwaway.
Full rule and reasoning: DESIGN.md Section 0b. Found and fixed during this build: `Login.jsx`'s `⚠` and
`Register.jsx`/`ResetPassword.jsx`'s `✓`/`✗` password-match indicators.

### Two distinct visual languages, two distinct component sets

Auth pages (Login, Register, password reset, etc.) use a fixed "orbit" palette that never responds to
the light/dark theme toggle — their own components (`AuthField`, `AuthButton`, `AuthAlert`, `AuthSelect`,
all in `src/components/`) use inline styles with JS-tracked focus/value state, not CSS pseudo-classes,
specifically so the floating-label pattern doesn't depend on `:not(:placeholder-shown)` (which v1 relied
on via a large per-page `<style>` block — a real violation of DESIGN.md's "no per-page `<style>` blocks"
rule that v2 corrected rather than carried forward). Authenticated app pages (Settings, Profile) use the
theme-responsive `.fos-*` classes and `var(--*)` tokens instead, via `Card`/`FormField`/`FormSelect`/
`FosAlert`/`SaveButton` (see DESIGN.md Section 12's amended shared-component rule). Never mix the two —
an auth-page component reaching for a `var(--text-primary)` token, or a Settings section hand-rolling the
orbit palette, is a sign something's been copy-pasted from the wrong context.

### Independent per-section state, not one giant form

Every editable section (an Account tab, a Settings section, Profile) tracks its own dirty state
independently against a `useRef` snapshot of the last-saved values, and its own `saving`/error state — no
single page-wide "Save All" button covering unrelated sections. The Save button itself reads "No Changes"
and is disabled until something is actually edited, and doesn't flip back to that until the server
confirms the save succeeded (never optimistically on click).

### Field-specific errors land on the field, not a generic banner

When the server rejects a request with field-keyed errors (DRF's standard `{field: [msg, ...]}` shape),
map each one to that exact field's `error` prop — never a single generic "Something went wrong" banner
when a specific field is actually the problem. Reserve a generic alert banner for errors that are
genuinely not field-specific (e.g. `{error: "Incorrect password."}` on a delete-account confirmation).
Watch for the specific bug this guards against: treating every JSON error response as field-mappable
will silently swallow a generic `{error: "..."}` response into a field key nothing renders — found in
v1's `ChangeEmail.jsx`, fixed in v2 by explicitly distinguishing real form-field keys from everything else.

### Test discipline for async/debounced UI (a real bug found twice)

When testing a debounced action (availability checks, notification-toggle auto-save), wait on the actual
async signal — a mock's call count, or a `waitFor` on the resulting state change — never on text that's
assumed to appear. Found twice during this build: once waiting on the literal word "checking" when the
UI actually renders an ellipsis character, and once using `getByText` on a button label that also
matched a card heading, both of which made the test pass or fail for the wrong reason. A passing test
whose wait condition is wrong isn't a safety net — verify what the test is actually waiting on, not just
that it eventually goes green.

### Test files live next to what they test

`ComponentName.test.jsx` sits in a `__tests__/` folder alongside `ComponentName.jsx`, not in one
project-wide test directory. Section components under `pages/settings/` have their own
`pages/settings/__tests__/` folder for the same reason.