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
- **Event names** (`core.events.on()`/`emit()`): PascalCase, past-tense (`InvoiceCreated`,
  `InvoicePaid`), deliberately distinct from the existing snake_case convention used for
  `AuditLog`/`log_event()` event strings (`account_anonymized`, `session_revoked`) — the two systems
  serve different purposes (a business event other code can react to, vs. a security-audit record)
  and the naming difference makes it visually obvious at a glance which one a given string belongs to.

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

## AI calls

Feature code calls `core.ai.run_ai_task()` — never raw HTTP, never `requests` for AI, never a Groq URL or key
(`core/tests/test_ai_boundaries.py` fails the build if it finds one outside `core/ai.py`). Prompts live in the
app's `prompts.py`. Never call it inside `transaction.atomic()` or while holding `select_for_update()` locks.
Always handle `result.ok == False` (every feature must still work with AI off or failing), and let code calculate
every figure — the model only explains. `core.AiCallLog` stores sizes, never prompt or reply text.
A change to a feature's prompt or model is re-measured with that feature's evaluation before release and the result
is recorded (Proposals: `python manage.py evaluate_proposal_ai --yes`, results in `AI_EVALUATION.md`).
Facts and numbers come from code; a feature that shows model text next to numbers must check the numbers (see
`apps/dashboard/insights.py`): per-fact allowed figures (spelled numbers included), a direction check, a banned-word list, and a
fixed fallback sentence per fact so the feature works with AI off. Send the model only what is needed and nothing that identifies a
person or client. Decide the pass rule of an evaluation BEFORE running it and do not edit the prompt afterwards to pass it.

## Multi-row writes are atomic; state-dependent edits re-check state under a lock

A write that touches more than one row (a record plus its line items, a total recalculated afterwards) runs in ONE
`transaction.atomic()` — nothing in this project sets `ATOMIC_REQUESTS`, so without it a failure part-way leaves
half a record. An edit or delete that depends on the record's current state (`status == 'draft'`) fetches the row
with `select_for_update()` inside that same transaction and re-checks the state there, so a concurrent state change
cannot slip between the check and the write. Amounts are validated against the column limit BEFORE anything is
written, so an oversize number is a 400, never a 500 after a half-created record. Emit events only after the
transaction commits.

## Free-text fields are plain text

User- or model-written prose (proposal bodies, job posts, notes) is stored and returned as PLAIN TEXT and displayed
escaped. No serializer sanitises or strips markup because nothing downstream may treat it as markup: never render it
with `dangerouslySetInnerHTML`, never mark it safe in a template or email, never put it in an HTML context unescaped.

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

## Shared template partials: structure lives in the partial, skin stays in the template

When two or more Django templates render genuinely identical structure (not just similar-looking —
byte-identical content/markup shape), extract it to `<app>/templates/<app>/_partials/<name>.html` and
`{% include %}` it, rather than letting each template keep its own copy that can silently drift.
The partial owns shared structure (the CSS declaration or markup shape); the including template still
owns its own skin (color, exact positioning) — pass those in via `{% include %}`'s own `with` clause, or
append extra same-selector CSS rules directly after the include (CSS cascade only overrides the specific
properties the later rule names, it doesn't replace the partial's own declarations — verified directly,
not assumed, before relying on this in `apps/invoices/templates/invoices/modern.html`'s own footer
override). Don't force-extract a partial library out of independently-written templates before it's
been validated against real content that will actually reuse it — `apps/invoices/templates/invoices/
_partials/footer.html` (Template Gallery Foundation, 13 September 2026) was extracted first specifically
because it was being rewritten anyway and was already byte-identical across all 3 static invoice
templates bar one color value; the templates' own remaining structure stayed independent, deliberately,
until a real second consumer justifies extracting more. That second consumer arrived with the
20-Template Import (Batch 1, 14 September 2026): `_partials/` grew to 9 shared HTML partials plus
`base_components.css`, once real, byte-identical shared structure existed across a genuinely large set
of new templates to justify it — see `_partials/README.md` for the full current inventory.

## CSS custom-property skinning for a template FAMILY, not a mixed one

When multiple templates share not just structure (the case above) but a whole family of component CSS
that only differs by a small, fixed set of color/tone values, skin them with CSS custom properties
instead of duplicating the ruleset per template: each template declares its own `--ink`/`--accent`/etc.
values once (interpolating server-resolved values like `design_primary_color`/`design_secondary_color`
directly into the custom-property declaration — by the time the CSS is parsed these are already literal
hex, so no indirection cost), then `{% include %}`s one shared stylesheet partial written generically
against `var(--...)`. Confirmed via the 20-Template Import's own Part 0b spike that the prototype these
4 new templates were ported from already used exactly this pattern, byte-identical across all 20 source
templates — a strong, validated signal, not a guess, that the abstraction actually fits. Don't
retroactively convert an already-hardened template onto this system just for consistency — `professional
.html`/`minimal.html`/`modern.html` keep their own established direct-substitution convention
(`color: {{ design_primary_color }};`, no custom-property indirection at all) untouched; the two
conventions coexist deliberately rather than one being "correct" project-wide.

## Numeric table columns need a real protected gutter, not just `text-align:right`

A shared `.inv-table` (or any invoice-style table with Description + right-aligned numeric columns)
must give the numeric columns a real minimum box — `min-width` + `white-space:nowrap` — AND a real
`padding-left` gutter on the numeric columns themselves (never `padding-right` on all columns
uniformly; that shifts the LAST column off the table's own right edge, breaking alignment with
anything positioned separately below it, like a totals block). `text-align:right` alone is not
protection: under WeasyPrint's table auto-layout, when Description's own content pushes the table's
total preferred width past the available space, the numeric columns get squeezed toward their bare
content width — and with zero horizontal padding anywhere (the state `base_components.css` shipped
in for the whole 14-15 September 2026 template import), "bare content width" means adjacent
right-aligned values end up touching, with no visible gap between them at all. A column's own
`padding` is what survives that squeeze (padding is part of a cell's minimum content box, so it
can't be squeezed away the way pure whitespace can) — this is why some templates (Classic, Compact,
Modern, Commerce, Statement, Studio) never showed the bug: each happened to already set nonzero
horizontal `.inv-table td` padding for unrelated skin reasons. Don't assume a template's own skin
override makes it safe going forward — always verify the ACTUAL rendered gap on a real 4-figure
amount (`1,020.00`-class values), not just eyeball the CSS. See DECISIONS.md's 16 September 2026
Invoice Template Review Phase 1 entry for the real, measured before/after evidence.

## Signature images: set the real size ceiling as an inline style, not a stylesheet rule

Any shared image element whose real-world size matters for legibility/professionalism (a
signature is the concrete case; a similar rule would apply to anything else in this category) needs
its size set as an inline `style=""` on the element itself inside the shared partial, not as a
plain rule in the included stylesheet. A stylesheet rule of equal specificity can always be
re-overridden by whichever template's own `<style>` block loads after it — which is exactly how
this codebase's own signature sizes drifted to a 6.5mm–17mm spread across the 20-Template Import,
several of them genuinely illegible. An inline style on the partial's own markup wins over any
later same-specificity external rule without needing `!important` anywhere, so no per-template
override can shrink (or grow) it again by accident. Use `max-width` (a cap), never a fixed `width`,
alongside a fixed `height` — a fixed width creates a box wider than the image's own natural
rendered size, and `object-fit:contain` then letterboxes the real image inside that oversized box
rather than letting it render at its own natural width, which breaks any parent relying on
`text-align:center` to center the image by its own real width (a real regression this project's own
`SignatureCenteringTests` caught directly — see DECISIONS.md). Pick the actual numeric ceiling by
rendering a real candidate size against a representative spread of the family (a plain layout, the
densest/most compact one, and a narrow persistent-rail one), not by guessing a number that merely
looks reasonable in isolation.

## A shared-component fix can shift page counts — always re-run the real page-count-parity sweep

Any change to a shared partial/stylesheet that invoice PDF templates include (a size, a padding, a
gutter) changes real rendered height across every template that includes it, not just the one you
were looking at when you made the change. Before considering such a change done, re-render a real
page-count sweep (several item counts, from a genuinely small 1-item invoice up through this
project's own established 40-item stress boundary) across every affected template, compared
against a real "before" baseline (a git stash/worktree of the pre-change tree, not a guess) — not
just the one or two templates you visually spot-checked. A change that's individually correct and
well-verified in isolation can still tip an already-boundary-tight template from 1 page to 2 (a real
regression worth fixing with a small, targeted per-template spacing trim) or shift a deliberately
extreme stress fixture across an exact page boundary (a real, honestly-documented, but generally
acceptable trade-off, not something to chase indefinitely). See DECISIONS.md's 16 September 2026
Invoice Template Review Phase 1 entry for a worked example of both outcomes from the same pass.

## A parallel implementation's naming gets promoted the moment it becomes the only one

A generation-suffixed name (`_v2`, a "Phase N" module docstring, an "isolated"/"experimental"
qualifier) is fine WHILE two implementations genuinely coexist — it's how a reader tells them
apart. The moment one is retired and the other becomes the sole production path, that suffix stops
describing reality and starts actively misleading whoever reads it next, exactly like dead code
above. Rename the promoted implementation to the plain, un-suffixed name (freeing that name by
first renaming the retired implementation to an explicit `legacy_*`/`_legacy` name, so nothing is
ever briefly unnamed), and rewrite any module docstring that described the promoted code as
"isolated"/"not wired into any real path" — an accurate description when written, actively false
once the cutover happens. A version discriminator on the DATA itself (e.g. `InvoiceDesign
.design_data`'s `schema_version` key) is a different thing and can stay indefinitely — it's what
lets genuinely old, un-migrated records remain readable, not a naming convention for parallel code.
Found and fixed during the LanceraOS Template Builder's production cutover (see DECISIONS.md's
29 August 2026 entry): five backend modules (`design_renderer_v2.py`, `design_schema_v2.py`,
`design_seeds_v2.py`, `design_canvas_v2.py`, `views_design_v2.py`) and their frontend counterparts
(`design-editor-v2/`, `designEditorV2/`, `DesignEditorV2.jsx`) were promoted to their plain names,
and half a dozen module docstrings that still said "Phase 1/2/3, isolated, non-production" were
rewritten to state current reality.

## A number rendered with a currency symbol must be denominated in that currency

Never display a raw sum across rows of different currencies, and never attach a currency label to a figure
that wasn't actually converted into it. Found 02 October 2026: `Client.payment_stats.total_invoiced` was a raw
sum of every invoice's `total` (USD and PKR alike, drafts included) and the UI formatted it with the client's
`default_currency` — a PKR client invoiced in USD and PKR showed "PKR 10,881" for what was really PKR 1,168,920.
A money figure that crosses currencies is converted with `core.money.convert_amount` (frozen rate into USD,
one current snapshot out), carries the currency it is denominated in as a field of the same payload, and
reports rows it cannot honestly convert as a count (`unconverted_count`) rather than guessing or silently
dropping them. The frontend formats with the payload's own `currency` field, never a guessed one.

**One rounding rule (Prompt 16, 08 November 2026): a converted row is rounded to the cent ONCE, in `rollup.convert_row` (`ROUND_HALF_UP`), and every total is a sum of rounded rows.** Never round a total, never sum unrounded values and round for display, and never round in a second place: months must add up to the period total on a document someone else reads, and every screen that shows the same period must show the same paisa. Pin a change to it with the golden masters in `apps/payments/tests/` (diff before and after against the bound 0.005 x (rows + 1) per figure).

A ledger row shows its cents (a payment is `USD 1,234.50`, never `USD 1,235`), only aggregates (KPI cards, chart axes) are rounded to whole units, and any arithmetic on amounts on the frontend is done in integer cents (`toCents` in `paymentsHelpers.js`), never with a float `<`, `Math.min` or `-` — `0.1 + 0.2` is not `0.3`, and a float comparison is exactly what lets an amount through for one cent too much.

## List endpoints must have a constant query count, asserted by a test

A list endpoint's query count must not grow with page size. Every nested relation and per-row computed field
needs `prefetch_related`/`select_related` or an annotation, and every per-request lookup (an exchange-rate
snapshot, a profile) is fetched once and passed down — not once per row. Assert it: build 1 row and N rows,
count queries with `CaptureQueriesContext`, require equality, and add an explicit ceiling so a regression to
per-row queries fails loudly. Found 02 October 2026: `GET /api/clients/` cost 4 / 12 / 26 queries for 1 / 5 /
12 rows (2 per client) until fixed (constant 6 now, `apps/invoices/tests/test_client_list_money.py`).

## Never hand-roll a `rate is None` skip — all currency conversion goes through `core.money.convert_amount`

Any code that turns an amount in one currency into another (a KPI, a chart bucket, a ranking, a client total)
calls `core.money.convert_amount(amount, currency, rate_to_usd, target, snapshot)` (or
`unify_amounts_to_currency` over rows) and treats a `None` result as "cannot be honestly converted" — counted or
skipped, never guessed. Do not write `if row['rate'] is None: continue` yourself. Found 02 October 2026: the
analytics trend and top-clients code did exactly that, which would have silently dropped every USD row with a
missing rate even though USD→USD needs no rate (it is 1 by definition) — while the KPI strip, the client list and
the currency breakdown, which used the shared helper, counted the same rows. One conversion implementation means a
fix to it reaches every reader. A related rule for tests: to build a LEGACY row that violates a model invariant
(e.g. a USD invoice with a NULL rate, which `Invoice.save()` now prevents), use a queryset `.update()` — that is
how the real ones were created — never `create(rate=None)`, which the guard would quietly fix and make the test
vacuous.

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
single page-wide "Save All" button covering unrelated sections. The Save button itself is not rendered
at all until something is actually edited — changed from an earlier "always visible, disabled, reads
'No Changes'" convention; see `DECISIONS.md` for the reasoning — and doesn't disappear again until the
server confirms the save succeeded (never optimistically on click).

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

### List pages with a table share one table-styles module; a page's header comment must describe what it renders

A list page that renders a table (Invoices, Clients) takes its wrapper, header row, `th`/`td` and clickable-row
hover styles from `frontend/src/components/listTableStyles.js` — never a hand-copied set of style objects in the
table component. Found 02 October 2026: `InvoiceTable.jsx` held the only copy, so a second table could only have
been a duplicate that drifts the next time either is tuned; the module was extracted (the Invoices page was
pixel-compared before and after: table region identical) and `ClientTable.jsx` built on it.

A page or component's header comment must describe what the file ACTUALLY renders, not what it was meant to
mirror. `Clients.jsx` claimed for weeks to "apply the identical pattern" of Invoices.jsx while only its search/
sort/filter/pagination chrome had been carried over and the list body was still a card grid at every width. When a
file's behavior changes, rewrite its header comment in the same change.

### A deep link that resolves an invoice must route by status exactly as the list's row click does, in one place

`Invoices.jsx`'s row click sends a draft to the wizard (edit mode) and everything else to the detail panel
(`openDetail`). Any URL that opens an invoice — notification click-through, a link from the client panel — must make
the same decision, and make it in ONE effect, not at each call site: the `?invoice=` mount effect fetches the invoice
and branches on `status`. Before 02 October 2026 it always opened the detail panel, silently sending a draft down a path
the product treats as unreachable (a real case: a `recurring_invoice_generated` notification for an auto-send-off series
points at a draft). Resolve asynchronous deep links with a request id (not effect-cleanup cancellation, which the
param-clearing re-run would trip) so a late response never opens a surface after the user moved on.

### Never put an inline `background` on an element whose :hover rule is a class

An inline style beats any stylesheet selector, so an inline `background: 'transparent'` silently disables a class-based
`:hover` background. `InvoiceTable`'s rows had one and never showed a hover state; a row that needs both a state tint
and a hover rule should set the tint inline only when active (`isSelected ? tint : undefined`) or move the base
background into the stylesheet. Known remaining instance: `DropdownMenu`'s ghost trigger (see DECISIONS.md backlog).

### Tooltips are mouse/keyboard only and never carry essential information

A `data-tooltip` is shown on a 500ms mouse/pen hover or on keyboard focus, and NEVER on touch (there is no hover on
touch, and a tap-to-toggle tooltip would be a second interaction model). So anything a user needs to read — why a
button is disabled, what a number excludes, a validation reason — is VISIBLE text (or a visible hint beside the
control); a `title=`/`data-tooltip` may repeat it, never be its only home. Icon-only controls also carry an
`aria-label` (a tooltip is not an accessible name). Found 03 October 2026: several "essential" explanations lived only
in a native `title` and were unreachable on a phone (see DECISIONS.md's audit backlog for the list).

### Never bind tooltip listeners per element, and never re-scan the DOM to wire tooltips up

Tooltips are one delegated controller on `document` (`hooks/useAppTooltip.js`, installed once in `main.jsx`). Per-element
`mouseenter`/`mouseleave`/`focus`/`blur` listeners cannot cover a target that unmounts under its own click (no
`mouseleave`, and Safari/iOS never blur a removed button), a touch tap (compatibility `mouseenter` with no
`mouseleave`), a scroll, a resize, a route change or Escape — each of which left a tooltip stuck on screen — and needed a
full-document `querySelectorAll` after every render to find new targets (13 scans on one list-page load). A new
tooltip is just the attribute; do not add an init/bind call, and do not add a second tooltip mechanism for the same job.

### Hover styles are gated by `(hover: hover)`; JS hover goes through `hoverProps`

A CSS `:hover` rule on a tappable control sits inside `@media (hover: hover)`, and a hover effect set from JS uses
`hoverProps` (`lib/hoverProps.js`, pointer events, touch ignored) — never `onMouseEnter`/`onMouseLeave`. On touch, a tap
leaves `:hover` applied and fires `mouseenter` without `mouseleave` until something else is tapped, so the "hovered"
look (a highlighted row, a scaled icon, a collapsed-rail tooltip on an iPad) stayed stuck. Exceptions that are fine
ungated: scrollbar thumbs (desktop-only), a `:hover` that changes nothing visible, a browser-internal pseudo-class
(`:-webkit-autofill:hover`).

### A download that can be refused with a sentence is fetched as a blob, never a plain link

A download that can be refused with a sentence (an empty period, a number that is not saved, a rate limit) is fetched with `api.get(path, { responseType: 'blob' })`, and its error body is read as text (`blobToText`); never a plain link (a refused download would show the person a raw JSON page, with no loading state). The saved file name comes from `Content-Disposition` only when it is a safe name (`^[A-Za-z0-9._-]{1,120}$`), otherwise a fallback built by the page. See `lib/downloadBlob.js` and `hooks/useReportDownload.js`.

### Test files live next to what they test

`ComponentName.test.jsx` sits in a `__tests__/` folder alongside `ComponentName.jsx`, not in one
project-wide test directory. Section components under `pages/settings/` have their own
`pages/settings/__tests__/` folder for the same reason.

## Dependency direction between apps

Apps form a tree, and imports only go down it. `apps.dashboard` (Module 9) is the TOP: it aggregates everything, so it may
import models and shared helpers (`apps.invoices.kpis`, `core.*`) from any other app, but

- **no other app may import `apps.dashboard`**, and
- the dashboard never imports another app's `views*` modules (a view is an HTTP boundary, not a library; share the logic by
  moving it to a pure module the way `apps/invoices/kpis.py` was extracted from `invoice_summary`).

Both rules are enforced by `apps/dashboard/tests/test_import_direction.py`, which parses the real source with `ast`. The same
rule family already holds lower down (`apps.clients` never imports `apps.invoices`; `core/` imports no app).

**`apps.payments` is the BOTTOM of the tree (07 November 2026).** It imports only `core.*` and itself — never `apps.invoices`,
`apps.clients`, `apps.dashboard`, `apps.proposals` or `apps.users` (the user model is `settings.AUTH_USER_MODEL`, a string). It reads
invoice data only through the reverse accessor `Payment.invoice_allocations`. Anything that needs both models (linking a payment to an
invoice, `check_payment_ledger`) lives in `apps.invoices`. Shared helpers it needs were promoted DOWN to it or to `core/`
(`validate_currency_code` -> `apps/payments/validators.py`, `rate_limited` -> `core/ratelimit.py`).
Enforced by `apps/payments/tests/test_direction.py` (AST, lazy imports inside functions included).

**`apps.health` sits above `apps.payments` (Prompt 18, 09 November 2026).** It imports only the standard library, Django/DRF, `core.*` and, from `apps.payments`, the non-view modules `ledger`, `expense_ledger`, `rollup`, `models`, `constants` and `http`; never `apps.invoices`, `apps.clients`, `apps.dashboard`, `apps.proposals`, `apps.users`, `apps.admin_panel` or a `views*` module. **No app imports it** (only `config/urls.py` and `config/settings.py` name it), and `apps.payments` is forbidden from importing it. Enforced by `apps/health/tests/test_direction.py` and `apps/payments/tests/test_direction.py`.

**A score or a grade is computed in a pure module from a facts object (Prompt 18).** The database is read in one place (`apps/health/facts.py`) and turned into a frozen `Facts`; `scoring.py`, `tips.py` and `copy.py` import no Django and no `apps.*`, so they are tested without a database. **A "how to improve" figure is computed by re-running the same scoring on a modified copy of the facts** (`dataclasses.replace`), and the gain shown is the change in the DISPLAYED total, never estimated separately; a step worth under one point is dropped. A sentence a person reads is built from the person's numbers by a template and from the same constants the formula uses, so the words cannot disagree with the maths. An area with too little data is "not enough data", never zero, and the total is rescaled over the areas that could be scored.

**Two ledgers, one app (Prompt 14, 08 November 2026).** Money in (`Payment`) and money out (`Expense`) are two ledgers inside
`apps.payments`. They share `rates.py` (the frozen nearest-snapshot rate) and `rollup.py` (the one windowed summary loop that both
`ledger.summary_for_user` and `expense_ledger.summary_for_user` call), and the expense modules (`expense_services.py`,
`expense_ledger.py`, `expense_serializers.py`, `views_expenses.py`, `expense_urls.py`) sit flat next to the income ones. A report (the
P&L, the Tax module, the income certificate) reads BOTH ledgers through `apps.payments` — `ledger` for income, `expense_ledger` for
spending — never through `InvoicePartialPayment` or invoice totals, and never by re-deriving the maths. A rule fixed in `rollup.py` is
fixed for both; do not copy that loop. Pin any change to it with the golden master in `apps/payments/tests/test_rollup.py`.

**Reports (Prompt 16, 08 November 2026).** A money report reads both ledgers through `apps.payments` only: `ledger.income_rows` / `expense_ledger.expense_rows` for the rows (one query each) and `rollup.summarize_range` for the totals (one period, one or more target currencies, a row counts only if it converts into every target). The report maths and its JSON endpoints live in `apps.payments` (`report.py`, `views_reports.py`); the PDF of a money document lives in `apps.invoices` (`report_pdf.py`, `views_reports.py`, registered at `/api/payments/...` in `config/urls.py`) until a shared PDF module exists, because WeasyPrint and the fonts are there. **Identity data (CNIC, NTN) appears on a document only when the request opts in**, is decrypted only inside the PDF builder, and never reaches JSON, a log line or audit metadata; the identity block is an explicit allowlist, never an iteration over profile fields.

**One ledger rule: money received is a `Payment`; an invoice allocates it.** Never add a second place that records money received.
A report of income reads `apps.payments.ledger` (converted with each payment's own frozen snapshot), not `InvoicePartialPayment`
directly. `InvoicePartialPayment.save()` is what guarantees the ledger row exists, so create allocations through the model (a
`bulk_create` or queryset `.update()` bypasses it on purpose only in tests and migrations). Lock order for anything touching both:
invoice row first, then payment row.

When two screens need the same number, extract the rule into a request-free module and call it from both. A second copy of
an invoice rule is how the Dashboard and the Invoices page end up disagreeing.

## Public (token) endpoints

A public endpoint is reachable by anyone holding a URL token (an invoice's or proposal's `view_token`), with no login. Rules,
first applied to `apps/proposals/views_public.py`:

- `@authentication_classes([])` plus `@permission_classes([AllowAny])`. Otherwise a stale freelancer cookie in the browser makes DRF
  answer 401 on a public page. If the view must know whether a cookie belongs to the owner, read it with a probe that never
  raises and never enforces CSRF.
- An unknown token, an over-long token and a not-yet-published record (a draft) return the SAME 404 body, so nobody can tell
  "draft" from "does not exist".
- The response is an ALLOWLIST: a plain `serializers.Serializer` with every field declared by name — never a `ModelSerializer`,
  never `exclude`. A field added to the model later stays invisible until someone adds it on purpose. Prove it with a sentinel test
  that fills every private field and searches the whole JSON text.
- `Cache-Control: no-store` on EVERY response, errors and DRF's own 405 included (a decorator outside `@api_view`).
- Rate limit by client IP with an atomic cache counter (`cache.add` + `cache.incr`), and switch DRF's blanket `AnonRateThrottle`
  off on the view (`@throttle_classes([])`) so the documented limit is the real one. Rate limit BEFORE the lookup so token
  guessing is limited too.
- Validate any client IP with `ipaddress` before storing it; store NULL when it is not an IP. `get_client_ip` returns whatever the last
  `X-Forwarded-For` entry is, and a non-IP value makes a PostgreSQL `inet` insert fail and poisons the surrounding transaction.
- A state change takes a row lock (`select_for_update`) and re-checks the status inside it; a read-only "first view" marker is
  one conditional `UPDATE ... WHERE status=...`, emitting only if it changed a row.
- Escape every interpolated value (`django.utils.html.escape`) in HTML email, and collapse whitespace in subjects. A client's
  free text and a freelancer's titles can both contain markup.

## Uploads and exports (Prompt 12, 08 November 2026)

- Uploads are read with a byte cap (`file.read(MAX + 1)`, and `Content-Length` checked before the body is parsed) and are never trusted by file name or content type: the bytes are inspected (zip/PDF/UTF-16 magic, NUL bytes) and every refusal is a fixed sentence that never echoes file content.
- CSV/Excel EXPORTS must neutralise cells that start with `=`, `+`, `-` or `@` (prefix with an apostrophe or a tab). The import side stores such text exactly as typed and React escapes it on screen; an export puts it in front of a spreadsheet, which executes it.

## Tax figures (Prompt 20, 10 November 2026)

- Tax law lives in ONE versioned data file (`apps/tax/law.py`, twin of `TAX_LAW.md`) with a source, a confidence and a last-verified date for
  every fact. No view, service, serializer or template contains a rate, a band, a date or a source URL; a test greps for it.
- A figure whose law is unverified is not computed. The code refuses (a 400 that says so) instead of guessing, and the fact sheet says UNKNOWN.
- Nothing is "corrected" from memory. A doubt about a rate or a sentence goes into the report or the DECISIONS entry, and the law file changes
  only with a source.
- Every tax sentence says "estimate" where it is one and never tells a person what they owe, what to choose or that they are "compliant".
  Uncertain topics say "ask a tax advisor".
- PSEB status for tax purposes comes from the saved, validated number (`pseb_hash`), never from the self-declared `pseb_registered` checkbox.
- Tax money follows the ledger rules: one conversion rule (`rollup.convert_row`), the tax of one payment rounded half-up to the cent, every
  total the exact sum of rounded parts, and an unconverted payment counted and left out, never guessed.
- The Tax pages render the server's tax sentences as plain text and never state a rate, band, date or rule in a static string; a test scans every static string for percent figures and dates.

