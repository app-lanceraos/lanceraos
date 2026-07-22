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