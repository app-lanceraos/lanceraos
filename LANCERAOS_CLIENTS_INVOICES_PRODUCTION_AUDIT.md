# LanceraOS Clients & Invoices Production Audit

**Audit date:** 19 August 2026
**Auditor:** Claude Code, acting as a combined senior SaaS architect / backend / frontend / security / QA / database / production-reliability reviewer
**Method:** Full architecture-document reading (`CLAUDE.md`, `DECISIONS.md`, `DATABASE.md`, `ADMIN.md`, `STANDARDS.md`, `INVOICES_CLIENTS_TECHNICAL_SPEC.md`), exhaustive static code tracing of every file in `apps/clients/`, `apps/invoices/`, and their frontend counterparts, plus **live execution** against a real running instance (Django dev server + real PostgreSQL + real Redis + real Celery worker/beat) using the existing `superadmin` account and a second real account (`ali_amir`) for cross-tenant testing. No application code was modified. No existing user data was altered — all mutations were confined to newly created `AUDIT *`-prefixed test records under `superadmin`, which remain in the database for manual inspection (see §24).

---

## 1. Executive Summary

**Overall assessment: NOT READY for production.** This audit found **3 live-reproduced CRITICAL financial-data-corruption bugs** — not theoretical, not "could happen," but actually triggered on the running application with before/after database evidence — plus a further 9 HIGH-severity findings spanning concurrency, security, and a systemic audit-trail gap. The Users/Auth module (not in scope here) appears to be built to a materially higher standard of defensive rigor (locking, rate limiting, CSRF discipline) than large parts of this module; the Invoices/Clients module was clearly built fast, feature-by-feature, with correctness of the happy path prioritized over hardening against concurrency, malformed input, and adversarial edge cases.

**Finding counts:**
- **CRITICAL: 3** — all live-reproduced with concrete before/after database state (concurrent overpayment, invoice-numbering race, undo-payment-on-refunded-invoice corruption)
- **HIGH: 12**
- **MEDIUM: 15**
- **LOW: 10**
- **INFORMATIONAL: 9**

**Major security concerns:** No cross-tenant IDOR was found anywhere (this is a genuine strength — every endpoint tested, live and by code, correctly scopes to `request.user`). However: the client-portal write endpoints (comments/claims/acknowledge) have no CSRF enforcement; the freelancer-preview guard that's supposed to stop a freelancer's own portal browsing from being logged as a real client view doesn't check invoice/client ownership at all, so it can misfire across completely unrelated tenants; and there is a real, currently-unsanitized HTML-injection path from inbound email replies into outbound notification emails.

**Major data-integrity concerns:** This is the core of the "NOT READY" verdict. There is **no locking anywhere in this module** (`select_for_update`/`transaction.atomic` — zero real uses in `apps/invoices` or `apps/clients` production code). Concurrent payment submissions can jointly overpay an invoice past its total with no error and no correction path. Concurrent finalise calls on the same user's invoices crash with an unhandled 500. An invoice can be un-refunded into an impossible state (refunded + zero paid + full balance owed again) via the existing, reachable Undo Payment action. A draft invoice with zero line items can retain a stale non-zero total. And the majority of invoice lifecycle events (created, finalised, paid, partially paid, cancelled, refunded, marked bad debt, resent) write **no AuditLog row at all**, despite CLAUDE.md's own Rule 10 mandating one for every state-changing action — confirmed empirically by running the full lifecycle live and checking the actual `AuditLog` table afterward (8 real actions performed, only 1 event type logged).

**Major performance concerns:** Missing `.prefetch_related()` causes N+1 queries on invoice/client list pages and on every Django admin list page in both apps (no `list_select_related` anywhere). PDF rendering for `draft`/`created` invoices is synchronous in-request (a documented, accepted tradeoff, not a bug). Separately — and this is an operational, not application, finding — the Celery worker in this development environment segfaults on every single `render_and_store_invoice_pdf` task (a native WeasyPrint/GC crash CLAUDE.md already documents as known on this machine), meaning **no invoice in this test session ever actually got a frozen PDF**, and the client-portal "View Invoice" page 503'd for every sent invoice tested. This needs to be explicitly re-verified against the real production container before launch — if it reproduces there, no client can ever view an invoice online.

**Documentation quality note:** This project's internal documentation (`CLAUDE.md`, `DECISIONS.md`) is unusually extensive and largely accurate about *what was built*, but it is optimistic about *correctness* — several passages assert guarantees ("never overwritten," "the frozen PDF guarantee," design edits "feed rendering") that this audit found to not hold in the running code. See §3.

---

## 2. Architecture Understanding

**Stack (as documented and confirmed in code):** Django 5.2 + DRF 3.15, function-based `@api_view` views exclusively (confirmed — no CBVs found in either app), PostgreSQL 17, Redis 8, Celery 5 + Beat, Django Channels 4 for WebSockets, UUID primary keys throughout, httpOnly-cookie JWT auth via `apps.users.authentication.CookieJWTAuthentication`, React 19 + Vite frontend with inline-style theming.

**Apps in scope:**
- `apps/clients/` — Client CRM (`Client`, `ClientNote`, `ClientTag`) + the Client Portal's authentication layer (`ClientPortalSession`, magic-link entry, session issuance/renewal, the `is_freelancer_previewing_portal` guard).
- `apps/invoices/` — the Invoice Core (`Invoice`, `InvoiceItem`, `InvoicePartialPayment`, `InvoiceReminder`, `InvoiceViewEvent`, `InvoiceComment`, `PaymentClaim`, `InvoiceDesign`, `InvoicePreset`/`InvoicePresetItem`), the full lifecycle endpoint surface, PDF generation (WeasyPrint), the visual design editor's backend contract, email delivery (custom-SMTP-vs-Resend routing via `core/email.py`), the client-portal content endpoints, real-time comments (Channels), payment claims, recurring generation, reminders/escalation, and analytics.
- Supporting: `core/events.py` (a minimal synchronous pub/sub — `emit()`/`on()`), `core/money.py` (the `Money` value object), `core/email.py`, `apps/payments/` (only `ExchangeRateSnapshot` + its daily fetch task exists so far — the rest of Module 3 is unbuilt).

**Dependencies between the two apps:** `apps/invoices` imports from `apps.clients` (models, `portal.py`'s session utilities) — never the reverse, confirmed by the codebase's own AST-based zero-import check (referenced in `CLAUDE.md`) and independently by this audit's own grep of both apps' import statements.

**Database relationships:** `Invoice.client` → `Client`, `SET_NULL` (an invoice survives its client being deleted — though client deletion doesn't exist yet, see §4). `Invoice.user`/`Client.user` → `User`, `CASCADE` (see DB-003, a real contradiction of CLAUDE.md's own stated policy). Every child table (`InvoiceItem`, `InvoicePartialPayment`, `InvoiceReminder`, `InvoiceViewEvent`, `InvoiceComment`, `PaymentClaim`) → `Invoice`, `CASCADE`. `ClientPortalSession` → `Client`, `CASCADE`.

**Celery/background tasks confirmed present and registered:** `apps.invoices.tasks.generate_recurring_invoices`, `notify_stale_drafts`, `notify_unread_comments`, `render_and_store_invoice_pdf`, `send_invoice_reminders`, `apps.payments.tasks.fetch_exchange_rates` (plus `apps.users` tasks, out of scope).

**Notification/audit system:** `core/events.py`'s `emit()`/`on()` is a synchronous, in-process, no-retry dispatch — `emit()` itself writes nothing; an `AuditLog` row only happens if a handler registered via `@on(...)` explicitly calls `core.observability.log_event()`. This distinction is the direct cause of INV-002 below.

---

## 3. Documentation vs. Implementation — contradictions found

Per the audit brief, these are reported explicitly rather than silently resolved in either direction.

1. **`DATABASE.md`'s `invoices`/`clients` sections are materially stale relative to `CLAUDE.md`'s own later changelog and the actual running code.** `DATABASE.md`'s "Not yet built" closing section states the client portal, payment-claims *workflow*, comments *delivery*, and recurring/reminder *tasks* don't exist — all of these are fully built and live-tested in this audit. Likewise `DATABASE.md`'s `client_portal_sessions` section states `is_freelancer_previewing_portal` is "not yet wired to any real call site" — it IS wired (into `apps/invoices`, 5+ call sites), just not correctly (see PORTAL-001). `DATABASE.md` was evidently written once during early Client Portal work and never updated as the module matured, even though `CLAUDE.md` was updated continuously. **Recommendation:** either regenerate `DATABASE.md` from current models, or add a prominent "may lag behind CLAUDE.md — treat CLAUDE.md's Section 5 as authoritative for current build status" note.

2. **`INVOICES_CLIENTS_TECHNICAL_SPEC.md`'s endpoint table is aspirational, not current.** It lists a unified `/api/portal/...` surface, `GET /api/invoices/public/<token>/`, and a `ws://.../ws/invoices/<pk>/comments/` path — none of these match the actual implemented routes (`/api/clients/portal/...`, `/api/invoices/portal/view/<token>/`, `ws/invoices/thread/<view_token>/`). This is explicitly flagged in the spec's own document as a "no code has been written against it yet" design doc, so this is not a real contradiction — but it should not be confused for current API documentation by a future contributor, and nothing in the repo currently warns against that confusion at the top of the file itself.

3. **`InvoiceDesign.models.py`'s own docstring asserts a guarantee the code doesn't implement.** The model's docstring states a deleted design "never breaks an invoice that already **rendered against it**" — but per PDF-001 below, no invoice ever actually renders "against" a design's `design_data` at all; only `base_template` (one of 3 hardcoded strings) is read at render time. The docstring describes intended behavior that was never wired up, not actual behavior.

4. **CLAUDE.md's own Database Design Rules (§ "CASCADE BEHAVIOR?") directly contradict the actual `on_delete` on `Invoice.user`/`Client.user`.** CLAUDE.md states financial records should `PROTECT` against deletion; the code uses `CASCADE`. See DB-003. This is a real, unresolved contradiction between the project's own stated architecture and its implementation, not a documentation staleness issue — the rule and the account-deletion design (§ "Account deletion... financial records... retain a PROTECT relationship") were written with clear intent, and the model code simply doesn't follow it.

5. **CLAUDE.md's changelog repeatedly asserts a "frozen PDF, never re-rendered" guarantee that has a real, documented (by the codebase itself) exception** — the self-heal re-upload chain in `fetch_invoice_pdf_bytes`. The *content* is guaranteed identical (nothing about the frozen invoice's own fields can change post-freeze), but the *literal* claim ("`pdf_url` populated once... never re-rendered") is not accurate to the code, and — per PORTAL-004 — the live-render *fallback* branch of that same function can genuinely diverge from frozen content under a real infrastructure failure. Recommend correcting the doc wording rather than treating this as resolved.

6. **CLAUDE.md documents 3 curated PDF templates and a real, working visual design editor as complete, functional features** (Steps 7, 8, 8b, 9) — technically true (the editor works, saves, validates), but per PDF-001, the entire editor's output currently has zero effect on any real invoice a client receives. CLAUDE.md's module-status table lists this as "built" without flagging this disconnect anywhere. This is the single most consequential documentation-vs-reality gap in the whole audit — a freelancer customizing their invoice design today gets no actual change in what their clients see.

---

## 4. Complete Client Audit

Full backend trace performed of `apps/clients/models.py`, `views.py`, `views_portal.py`, `serializers.py`, `portal.py`, `scoring.py`, `cookies.py`, `urls.py`, `admin.py`.

**Client CRUD, search, filter, sort, archive/restore, flag/unflag, notes, tags:** all built, all correctly scoped to `user=request.user` with no exceptions found (verified by exhaustive grep of every `Client.objects`/`ClientNote.objects`/`ClientTag.objects` call site — see CLIENT findings table, all IDOR checks pass). Mass-assignment is correctly blocked via an explicit serializer `fields` allowlist (`user`/`portal_token`/`is_active`/flag fields are never writable through the general create/update path).

**Client deletion and one-time-client conversion:** confirmed, by code inspection, genuinely **not built** (no route, no view, zero grep hits for `client_delete`/`convert_one_time` anywhere). This matches CLAUDE.md's own explicit statement. Not a bug.

**Reliability score (`scoring.py`):** verified correct against CLAUDE.md's documented formula in every particular — point values (+5/-3/-10/-20), the 0-day and 30-day boundary conditions, `cancelled`/`refunded` exclusion (not zero-scored, fully excluded from the denominator), and the normalized-average-not-raw-sum computation. No bugs found. This is the one area of this module I can report as unambiguously correct with high confidence.

**Client-email duplicate prevention is racy (CLIENT-003, MEDIUM):** the "you already have this client" check (confirmed live — see §23) is a pure application-level `.exists()` check with no backing `UniqueConstraint`. Two concurrent identical-email client creates would both succeed, producing two duplicate `Client` rows.

**Portal magic-link entry (`portal_enter`) has zero rate limiting (CLIENT-001, MEDIUM):** unlike its sibling `portal_request_link` (correctly rate-limited 5/email/hr + 20/IP/hr, verified in code), the actual session-minting entry point itself has no throttle at all. Mitigated by 128-bit token entropy but still a real gap relative to CLAUDE.md's own three-tier rate-limiting rule.

**Portal magic-link email interpolates the freelancer-controlled `client.name` unescaped into raw HTML (CLIENT-002, MEDIUM):** a freelancer could set a client's display name to arbitrary markup that renders in that client's actual inbox.

**N+1 on `client_list`'s `tags` field (CLIENT-004, MEDIUM):** missing `.prefetch_related('tags')` — up to ~200 extra queries on a max-size (200) result page.

**Django admin bypasses business rules with no audit trail (CLIENT-005, MEDIUM):** `is_active`/`is_flagged`/`flag_type`/`flag_reason`/`default_currency`/`email`/`user` are all directly editable in the Django admin with none of the API's validation (flag-reason-required, currency-must-exist-in-latest-snapshot, per-user email uniqueness) and no `core.events.emit()` call, meaning an admin-driven state change is invisible to the audit/notification system entirely, both today (where `emit()` is a documented no-op) and once real handlers land.

Full CLIENT-series findings table is in §25.

---

## 5. Complete Invoice Audit

Full backend trace of `apps/invoices/models.py`, `views.py`, `serializers.py`, `urls.py`.

**IDOR:** none found anywhere — every one of the 26+ `get_object_or_404(Invoice, pk=pk, user=request.user)` call sites, plus every preset/design/claim lookup, is correctly user-scoped. Live-verified with a real second account (see §18).

**Calculations:** tax is computed on the pre-discount subtotal (confirmed, not itself a bug, just documented behavior worth knowing); `total` correctly floor-clamps at 0 when discount exceeds subtotal+tax (live-verified: a $100 item with a $99,999 discount produced `total: "0.00"`, not negative); Decimal precision/rounding is consistent (`.quantize(Decimal('0.01'))`) at every step; large amounts (tested at $9,999,999.99 with 8.25% tax → `$10,824,999.99` total) computed correctly with no overflow (the `max_digits=12` field comfortably holds it).

**INV-001, HIGH — confirmed live: clearing all line items on a draft leaves a stale non-zero total.** `recalculate_totals()`'s guard `if item_total > 0: self.subtotal = item_total` means when the last item is deleted (`item_total == 0`), `subtotal`/`tax_amount`/`total` are never reset — they keep whatever value they held before. **Live reproduction:** an `AUDIT Invoice Draft` invoice with 2 line items ($900 subtotal, $945 total with 5% tax) was `PUT` with `{"items": []}`. Result: `items: []` but `subtotal: "900.00"`, `total: "945.00"` — a visibly empty invoice with a non-zero total, confirmed via a direct API round-trip in this session. This can't currently be finalised in this state (finalise separately checks `items.exists()`), but it's a real, live data-integrity bug in the draft-editing/autosave path (which is exactly the flow the wizard uses on every keystroke).

**INV-002, HIGH — confirmed live: no `AuditLog` row for the majority of invoice lifecycle events, violating CLAUDE.md Rule 10.** `core.events.emit()` only writes anything if a handler is registered via `@on(...)`. Grepping `apps/invoices/notifications.py` (the only file registering handlers) against every event name `emit()`'d from `views.py` shows `InvoiceCreated`, `InvoiceFinalised`, `InvoicePaid`, `InvoicePartiallyPaid`, `InvoiceCancelled`, `InvoiceRefunded`, `InvoiceMarkedBadDebt`, and `InvoiceResent` have **zero registered handlers**. **Live confirmation:** in this session I performed 8 finalise actions, 3 mark-paid actions, several partial payments, one cancel, one refund, and one bad-debt transition on real test invoices — then queried `core.AuditLog` directly. Result: **exactly 8 rows, all `invoice_sent`** (from `mark-sent`, the one lifecycle action that IS wired). Not one finalise, payment, cancel, refund, or bad-debt action left any forensic trace at all. For a financial application whose own architecture document mandates an audit row for "every state-changing action," this is a real, material gap — the admin panel's audit-log viewer (built and working for Users/Auth) has nothing to show for the majority of what happens to a client's money.

**INV-003, CRITICAL — confirmed live: no locking anywhere; concurrent payments overpay past the invoice total with no error.** See §9/§20 for full reproduction. This is the most serious finding in the entire audit.

**INV-004, HIGH — confirmed live: concurrent finalise on different invoices for the same user crashes with an unhandled 500.** `generate_invoice_number()` is a plain read-then-write with no lock; the DB's `unique_together(user, invoice_number)` constraint prevents silent duplicate numbers but turns the race into a raw Django debug-mode 500 (`IntegrityError`) for the losing request instead of a graceful retry. See §20 for the exact reproduction and error text.

**State machine:** the full verified transition table is in §6. Every intentionally-blocked backward/invalid transition (paid→draft, cancelled→paid, refunded→paid, bad_debt→paid, viewed→draft, draft→paid-by-skipping-send, cancelled→sent) is correctly and often double-guarded (both view-layer and model-layer). This is a genuine strength of the implementation.

**Undo-payment/refund interaction (INV-009 / FE-001, CRITICAL — confirmed live):** see §9. `invoice_undo_payment` has no status guard at all, and `update_paid_status()`'s status-preservation guard (which correctly protects `status` itself on `cancelled`/`bad_debt`/`refunded`) does NOT protect `amount_paid`, which is unconditionally recomputed from the live payment-row sum regardless of status. Combined with the frontend's own gate (`NO_PAYMENT_STATUSES` constant defined but never actually used — dead code; the real gate is a separately hand-rolled condition that omits `'refunded'`), "Undo Payment" is fully reachable and fully functional on a refunded invoice.

**Other invoice findings (MEDIUM/LOW):** `discount_amount` has no upper-bound validation at the serializer level (INV-005, MEDIUM — the *result* is safely clamped, but nothing stops the field itself holding an absurd value); `invoice_list` lacks `.prefetch_related('items')` (INV-006, LOW, real N+1); `pause`/`resume`-recurring rely on an unenforced invariant rather than an explicit `parent_invoice_id is None` check (INV-007, LOW); `invoice_duplicate` doesn't copy the source's `design` FK (INV-008, LOW).

---

## 6. Invoice State Machine Audit

**Actual implemented statuses (9, confirmed against `models.py` — no stored `overdue`, matching CLAUDE.md's documented design):** `draft`, `created`, `sent`, `viewed`, `partially_paid`, `paid`, `cancelled`, `refunded`, `bad_debt`. `days_overdue` is correctly a pure read-time `@property`, never written to the DB — live-verified: the `AUDIT Invoice Overdue` test invoice (due date 30 days in the past, unpaid, sent) shows `status: "sent"` in the API response, never a stored `"overdue"` value, exactly as documented.

### Verified state-transition table

| Current status | Action | Resulting status | Allowed? | Correct? | Evidence |
|---|---|---|---|---|---|
| draft | finalise | created | ✅ | ✅ | Live-tested (INV-2026-0019 etc.) |
| draft | mark-sent (confirm:true) | sent (finalises first) | ✅ | ✅ | Live-tested |
| draft | finalise-and-send | sent | ✅ | ✅ | Code-verified |
| draft | mark-paid / add-payment | — | ❌ blocked (400) | ✅ | Code + live (attempted, correctly rejected before I supplied a valid source) |
| draft | PUT (edit) | draft (edited) | ✅ | ✅ | Live-tested; also exposed INV-001 |
| draft | DELETE | deleted | ✅ | ✅ | Code-verified |
| created | send | sent, `sent_via_platform=True` | ✅ | ✅ | Code-verified |
| created | mark-sent | sent, `sent_via_platform` untouched | ✅ | ✅ | Live-tested |
| created | mark-paid / add-payment | paid (skips a real "sent") | ✅ | ⚠️ allowed but no UI path (FE-003) | Code-verified |
| created | cancel | — | ❌ blocked (400) | ✅ | Code-verified |
| created | PUT (general edit) | — | ❌ blocked (403) | ✅ | Code-verified |
| created | DELETE | deleted | ✅ | ✅ | Code-verified |
| **sent → created** | *(any action)* | — | ❌ blocked | ✅ correct | No code path exists |
| sent/viewed | cancel | cancelled | ✅ | ✅ | Live-tested |
| sent/viewed | bad-debt | bad_debt | ✅ | ✅ | Live-tested |
| sent/viewed | payment reaching total | paid | ✅ | ✅ | Live-tested |
| sent/viewed | partial payment | partially_paid | ✅ | ✅ | Live-tested |
| **viewed → draft** | *(any action)* | — | ❌ blocked | ✅ correct | `is_editable` is draft-only, enforced |
| partially_paid | payment reaching total | paid | ✅ | ✅ | Code-verified |
| partially_paid | undo last payment (>0 left) | partially_paid (recomputed) | ✅ | ✅ | Code-verified |
| partially_paid | undo last payment (reaches 0) | restores to created/sent/viewed | ✅ | ✅ | Code-verified |
| partially_paid | cancel | cancelled | ✅ | ✅ | Code-verified |
| partially_paid | refund | refunded | ✅ | ✅ | Code-verified |
| **paid → draft** | *(any action)* | — | ❌ blocked | ✅ correct | Floor is `'created'`, never `'draft'` |
| **paid → sent** (direct flip) | *(no such endpoint)* | — | ❌ blocked | ✅ correct | No direct-flip endpoint exists |
| paid | undo payment (all payments removed) | restored to created/sent/viewed | ✅ | ✅ | Code-verified |
| paid | refund | refunded | ✅ | ✅ | Live-tested |
| **paid → cancel** | attempted | — | ❌ blocked (400) | ✅ correct | `paid` ∉ `ACTIVE_STATUSES` |
| **paid → bad-debt** | attempted | — | ❌ blocked (400) | ✅ correct | Same guard |
| **cancelled → sent** | *(no un-cancel action)* | — | ❌ blocked | ✅ correct | No code path exists |
| **cancelled → paid** | mark-paid / add-payment | — | ❌ blocked (400), double-guarded | ✅ correct | View AND model layer both exclude it |
| cancelled | refund | — | ❌ blocked (400) | ✅ correct | Only `paid`/`partially_paid` eligible |
| **refunded → paid** | mark-paid / add-payment | — | ❌ blocked (400), double-guarded | ✅ correct | View AND model layer both exclude it |
| refunded | refund again | — | ❌ blocked (400), explicit message | ✅ correct | One-shot only, by design |
| **refunded | undo-payment** | **"refunded" status but amount_paid reset to 0** | ✅ **allowed** | ❌ **INCORRECT — CRITICAL BUG** | **Live-reproduced, see §9** |
| **bad_debt → paid** | mark-paid / add-payment | — | ❌ blocked (400), double-guarded | ✅ correct | View AND model layer both exclude it |
| bad_debt | refund | — | ❌ blocked (400) | ✅ correct | `bad_debt` ∉ eligible set |

**Summary:** the *forward-declared* invalid transitions (paid→draft, cancelled→paid, refunded→paid, bad_debt→paid, viewed→draft, cancelled→sent, draft→paid-by-skip) are all correctly and often double-guarded — this part of the state machine is genuinely well built. The one real, serious gap is that `invoice_undo_payment` was never given a status guard at all, and it's reachable on every status including the three terminal ones (`cancelled`/`bad_debt`/`refunded`) where it produces nonsensical results (see §9 for the `refunded` case, live-reproduced; `cancelled`/`bad_debt` were not separately live-tested but share the identical unguarded code path, so the same class of corruption is expected there too — **NOT VERIFIED live for cancelled/bad_debt specifically, but the code path is identical and the fix should cover all three statuses uniformly**).

---

## 7. Client Portal Audit

**Authentication mechanism:** magic-link tokens (`Client.portal_token`, persistent/non-expiring; `Invoice.view_token`, same non-expiring design) mint/renew a `ClientPortalSession` — a real, separate session model (not `apps.users.Session`), hashed-at-rest (SHA-256) cookie token with 256 bits of entropy, sliding 60-day expiry, `httponly`+`secure`(prod)+`SameSite=Lax` cookie flags. **This entire cryptographic/session foundation was verified correct** — no weak tokens, no session fixation, no plaintext-stored credentials.

**PIN-based auth described in CLAUDE.md's Module 2 opening paragraph is confirmed superseded** (CLAUDE.md's own later text says so explicitly) — the actual, current design has no PIN anywhere. Not a bug; a documented, intentional design reversal, correctly reflected in the current code.

**PORTAL-001, HIGH — the freelancer-own-session guard doesn't check ownership.** `is_freelancer_previewing_portal(request)` (`apps/clients/portal.py`) is `has_freelancer_session and has_portal_session` — it never compares the authenticated freelancer (`request.user`) against the invoice's or client's actual owner. Any freelancer with a live JWT cookie for their own account, who *also* happens to be carrying a live `ClientPortalSession` cookie for ANY client of ANY freelancer (e.g. they clicked a portal link forwarded to them, or they are themselves someone else's client), will have that portal session's real actions treated as "preview mode" — suppressing Sent→Viewed transitions and view-event logging, and hard-rejecting real comment/claim/acknowledge POSTs with a 403 — even though the freelancer session and the portal session belong to two completely unrelated accounts. This is a real logic bug reachable by an entirely plausible browser-state combination (a freelancer who is themselves someone else's client, or who has multiple browser tabs open), not just a contrived edge case.

**PORTAL-002, HIGH — no CSRF enforcement on portal-session-authenticated write endpoints.** `portal_invoice_comments` (POST), `portal_invoice_claims` (POST), `portal_invoice_acknowledge` (POST) never call `enforce_csrf_standalone`. Root cause: the app's global CSRF enforcement only fires inside `CookieJWTAuthentication.authenticate()`, which returns early with no CSRF check at all when the JWT cookie is absent — exactly the normal case for a real client (portal-session-only, no JWT cookie). The sibling `apps/clients` portal module (`portal_logout`/`portal_logout_everywhere`) explicitly calls `enforce_csrf_standalone` for the identical reason — this app didn't follow the same pattern for its three real client-facing mutations. `SameSite=Lax` provides partial mitigation but this is a genuine, confirmed inconsistency with the codebase's own stated CSRF-mandatory rule (CLAUDE.md rule 14).

**Rate limiting** on portal writes matches documented figures exactly (comments 15/hr, claims 5/hr, acknowledge 5/hr, request-link 5/email+20/IP/hr), correctly keyed on non-spoofable identifiers (`client.pk`, not IP/header).

**Preview-as-client mode:** structurally separate endpoint (`invoice_preview_as_client`), never mints a session or logs a view — correctly isolated from the real portal flow, confirmed by code.

**Freelancer-own-portal-preview via the actual portal endpoint (the "Open Portal" button flow):** could not be fully live-verified end-to-end in this session — the WeasyPrint Celery-worker crash (see §19) meant no invoice in this test session ever got a frozen PDF, and `portal_invoice_view_html` now serves the frozen PDF only (503 otherwise, by design, since the second 18-August rework). I confirmed the 503 behavior itself fires correctly and a `ClientPortalSession` cookie is still minted on that path even when the PDF isn't ready — but I could not exercise the actual Sent→Viewed/view-logging suppression live. **NOT VERIFIED live; PORTAL-001 is a static-code finding corroborated by two independent audit passes reading the same code, not a live-witnessed incident.**

---

## 8. Online Invoice Audit

**Access without authentication:** by design — the `view_token`/`portal_token` IS the credential (128-256 bits of entropy, unguessable). Confirmed via code that an unknown/malformed token returns a real 404/401, never a 500 or a data leak.

**Token security:** cryptographically strong (`secrets.token_urlsafe`), never logged in plaintext anywhere found, hashed at rest for session cookies.

**Revoked/cancelled/paid/overdue invoice behavior in the portal:** the portal correctly reads live invoice status for the client-facing list/detail JSON endpoints (`portal_invoice_list`/`portal_invoice_detail`) — confirmed via code that these are not cached/frozen the way the PDF/HTML view is. `portal_invoice_list` correctly excludes `draft`/`created` invoices (a client only ever sees something actually delivered) — this was a real, deliberately fixed bug per CLAUDE.md's own changelog, and the exclusion logic is present in the current code.

**Cannot reproduce cross-tenant access by UUID/token substitution:** attempted directly (see §18) — blocked correctly.

**The PDF/HTML view itself could not be fully live-tested this session** due to the WeasyPrint worker crash described in §19 — every `sent`-status test invoice's frozen PDF never actually got generated, so `portal_invoice_view_html` consistently returned a real 503 rather than the actual document. This is the correct *designed* behavior for "nothing frozen yet" (verified: the endpoint's 503 branch fires cleanly, no crash, no fallback to stale data) — but it means **the actual rendered client-facing invoice document was NOT VERIFIED visually or structurally in this session**, only its access-control wrapper.

---

## 9. Payment & Partial Payment Audit — including the CRITICAL live-reproduced bugs

### CRITICAL-1 (INV-003/DB-002): Concurrent partial payments jointly overpay an invoice with no error, no lock, no correction path

**Live reproduction, exact steps:**
1. Created a real one-time-client invoice, $1000 total, USD, and moved it to `sent` status (`INV-2026-0031`).
2. Fired **3 concurrent** `POST /api/invoices/<id>/payments/` requests, each for **$700**, simultaneously (via 3 parallel `curl` processes against the live server).
3. **All 3 requests returned HTTP 201 (success).**
4. Final invoice state, confirmed directly against the database: `status: "paid"`, `total: "1000.00"`, **`amount_paid: "2100.00"`** — a 210% overpayment, with `outstanding_amount` displaying `"0.00"` (a display-only clamp; the underlying `amount_paid` field genuinely stores the corrupted value).

**Root cause:** `InvoicePartialPaymentSerializer.validate_amount()` checks `amount <= invoice.outstanding_amount` against a snapshot of the invoice read at the *start* of that individual request — with no `select_for_update()`, no `transaction.atomic()`, and no re-validation against a freshly-locked row. Three concurrent requests each independently see $1000 outstanding, each validate $700 as acceptable in isolation, and `update_paid_status()` (which recomputes `amount_paid` from a live `SUM()` over payment rows *after* each insert) has no clamp preventing the sum from exceeding `total`.

**Impact:** this is not a contrived race — it is exactly the failure mode a client's "Report a Payment"/portal claim-confirm flow, a double-clicked "Add Payment" button hitting the network twice, or two staff members recording the same payment simultaneously would trigger in production, on real money. There is no automatic correction path — an overpaid invoice's `amount_paid` field simply sits wrong until someone notices and manually intervenes (there's no "reduce payment" action, only full undo-of-most-recent, which per the next finding is itself unsafe).

### CRITICAL-2: Undoing a payment on a refunded invoice produces an impossible, corrupted financial record

**Live reproduction, exact steps:**
1. Took `INV-2026-0025` (a real test invoice, £900 total, GBP), which had already been: sent → marked fully paid (`amount_paid: 900.00`) → partially refunded (`refunded_amount: 300.00`, `status: "refunded"`).
2. Confirmed via direct DB query: `status=refunded, amount_paid=900.00, refunded_amount=300.00` — a sensible, if unconventional, resting state (fully paid, partially refunded).
3. Called `DELETE /api/invoices/<id>/payments/undo/` — the standard, currently-reachable "Undo Payment" action.
4. **Request succeeded, HTTP 200.**
5. Resulting invoice state: **`status: "refunded"`, `amount_paid: "0.00"`, `refunded_amount: "300.00"`, `outstanding_amount: "900.00"`.**

This is an internally contradictory financial record: the invoice claims to be "refunded" (implying money was returned to the client from a real payment) while simultaneously claiming the client owes the full $900 again (`outstanding_amount: 900.00`) and has a payment history showing $0 ever paid. There is no code path to reconcile this — the payment row that was undone is genuinely gone, `refunded_amount` is untouched, and nothing re-derives a consistent state from here.

**Root cause:** `invoice_undo_payment` (`apps/invoices/views.py`) has no `invoice.status` guard at all — unlike `invoice_add_payment`/`invoice_mark_paid`, which correctly reject `cancelled`/`bad_debt`/`refunded`/`draft`. `update_paid_status()`'s status-preservation logic protects the `status` *field* from flipping on those three terminal statuses, but does not protect `amount_paid`, which it unconditionally recomputes from the live payment-row sum every time it's called. On the frontend, a `NO_PAYMENT_STATUSES` constant exists (`['cancelled', 'bad_debt', 'refunded', 'draft']`) that would have correctly hidden this button — but it is **dead code, never referenced anywhere else in the file**; the real gate governing the "Undo Payment" menu item is a separately hand-written condition that checks only `!['cancelled', 'bad_debt'].includes(status)`, omitting `'refunded'` by what looks like a copy-paste/maintenance drift between the two lists.

**Same underlying code path is unguarded for `cancelled` and `bad_debt` too** (not separately live-reproduced this session, but the guard clause is identical and status-blind for all three — treat as the same bug class, same fix, same urgency).

### Other partial-payment findings

- Overpayment via a **single** request is correctly blocked (`InvoicePartialPaymentSerializer.validate_amount`, live-verified indirectly by the successful individual $700 payments each staying under the then-current $1000 outstanding — the bug is specifically the *concurrent* case).
- `invoice_mark_paid`'s payload is always exactly `str(invoice.outstanding_amount)`, so it cannot itself overpay by construction — correctly safe by design.
- Undo-payment's 7-day-old confirmation gate (`UNDO_CONFIRMATION_AGE_DAYS`, requires `confirmed_old: true` for anything older) is correctly implemented and was exercised indirectly (all test payments were same-day, so this gate never blocked the live reproductions above — worth noting the corruption bug fires regardless of payment age).
- Payment-claim confirm (`invoice_claim_confirm`) reuses the exact same serializer/validation path as `invoice_add_payment` — it inherits the identical concurrency gap (two simultaneous claim-confirms, or a claim-confirm racing a manual payment, is unguarded for the same reason) — **NOT independently live-reproduced, but the code path is shared, so treat as the same finding**.

---

## 10. PDF Audit

**H1 (PDF-001), HIGH — the visual design editor's output never reaches the actual PDF.** `pdf_generator.py`'s `build_pdf_context` reads only `invoice.design.base_template` (one of 3 fixed template names) — `design_data` (every position/size/style edit made in the drag-and-drop editor) and `color_variant` are never read anywhere in the render path, confirmed by a repo-wide grep across every PDF/portal template file. Every element a user drags, resizes, or recolors in the design editor, every AI-seeded color/layout choice, is validated and saved correctly — and then has literally zero effect on what a client ever receives. This is the single largest gap between documented feature-completeness and actual functional completeness found in this audit.

**Templates are XSS-safe:** no `|safe`, no `autoescape off`, no `mark_safe` anywhere in the 3 templates or their Python builders — verified by full grep. All freelancer/client-controlled text fields are auto-escaped.

**No page-break/overflow CSS protection (PDF-002, MEDIUM):** none of the 3 templates declare `page-break-inside`/`break-inside` anywhere — a long line-item description, a client with many items, or a long notes/terms field has no protection against splitting mid-block across a WeasyPrint page boundary. Not tested visually this session (blocked by the Celery/WeasyPrint crash, §19) — a static-code finding, high-confidence but **NOT VERIFIED visually**.

**No Arabic/Urdu-capable font (PDF-003, MEDIUM) — a real risk for the stated Pakistan target market.** The embedded font set (IBM Plex Sans/Mono, Source Serif 4, Space Grotesk, Caveat) is entirely Latin-script. A Pakistani freelancer's client name or notes entered in Urdu/Arabic script has no declared fallback and will render via whatever the deployment container's fontconfig happens to resolve — an environment-dependent, unverified outcome that should be tested against the actual production container before launch, not assumed safe.

**`design_schema.py` validates shape, not bounds or content (PDF-004, MEDIUM):** no upper/lower bound on `x`/`y`/`width`/`height` (e.g. `x=-99999` passes cleanly), and `style` dict *values* are never validated at all, only that `style` itself is an object — a live CSS-injection surface the moment PDF-001 is fixed and `style` starts feeding real template CSS. Recommend closing this before, not after, wiring rendering.

**QR code / portal URL correctness — verified correct.** `payment_page_url` → `portal_view_url` → the real `FRONTEND_URL` domain, confirmed in code, matching the documented 18-August fix.

**Signature tool and AI-design pipeline — both verified sound.** Real image-content validation (Pillow `.verify()`, not extension-trust alone), safe handling of malformed Groq responses, output re-validated through the same schema validator before saving, `commit` flag correctly gates persistence, rate limits match documented figures.

**Async offload — verified correct against code, not just the changelog.** `_finalise_invoice` genuinely fires `render_and_store_invoice_pdf.delay()` and returns immediately; `draft`-status PDF preview is intentionally synchronous (nothing to freeze yet). This part of the async architecture is real, not aspirational — the *operational* problem (§19) is that the Celery task itself crashes in this environment, not that it was never actually offloaded.

---

## 11. Email & Delivery Audit

**Fallback chain (custom SMTP → Resend) — verified correct in code.** No code path silently drops a client email; the client-facing content is byte-identical regardless of path; only the sending address differs; the client is never shown any indication of a fallback (confirmed — no conditional wording keyed on `sent_via`); the freelancer IS notified in-app + audit-logged on fallback (`CustomSmtpFailed`, one of the few events that DOES have a registered handler).

**PORTAL-003, HIGH — reminder and unread-comment-digest tasks send email BEFORE writing their own idempotency marker.** `_send_reminder` (`apps/invoices/tasks.py`) calls `send_invoice_related_email(...)` and only afterward creates the `InvoiceReminder` row that the next run's `already_sent` check relies on. A crash between those two lines (worker restart, OOM, deploy) means the next scheduled run has no record the email went out and resends it — a real duplicate delivered to the client. The identical ordering flaw exists in `notify_unread_comments`. **NOT VERIFIED live** (requires an actual mid-flight crash or genuine Celery Beat double-fire to reproduce) — this is a structural, code-level finding from reading the exact statement order, not an observed incident, but the mechanism is concrete and the fix (write the marker first, or wrap both in one transaction/lock) is straightforward.

**M2/M3 — non-constant-time secret comparisons + unsanitized inbound HTML (MEDIUM):** the `CLOUDFLARE_WEBHOOK_SECRET` check and the one-time-client `view_token` check both use plain `!=` rather than `hmac.compare_digest` — low practical risk (network jitter dwarfs the timing signal) but a real defense-in-depth gap on a long-lived, rarely-rotated shared secret. Separately, `InvoiceComment.body_html` (populated only from the inbound email-reply webhook) is stored completely unsanitized — currently **not exploitable via the shipped frontend** (`CommentThread.jsx` only ever renders `body_text`, confirmed by grep, no `dangerouslySetInnerHTML` anywhere in the file or the rest of `frontend/src`), but it's a live, unsanitized landmine sitting in the API response the moment any future surface renders it.

**FE-002, HIGH — real, currently-live HTML injection into outbound notification emails (distinct from the dormant `body_html` issue above).** `build_unread_comments_email_for_freelancer`/`...for_client` (`apps/invoices/email_service.py`) interpolate `comment.body_text` and `client_name` **directly into an f-string HTML `<li>` element with no escaping at all** — no `django.utils.html.escape()`, no `strip_tags` at this specific point. `body_text` for an email-reply-sourced comment is only `strip_tags`'d (tags removed, but not entity-escaped) — a crafted reply body can still inject markup into the batched "you have unread messages" HTML email sent to the *other* party's real inbox. This is live and reachable today via the real inbound-email-reply path, not a latent/future risk like the `body_html` finding above.

**Reply-to correctness:** verified correct — `get_reply_to_address` is consistently wired into every invoice-related send (real send, reminders, resend, formal notice), confirmed by tracing all 4 call sites.

**Rate limits:** all match documented figures, correctly keyed on non-spoofable identifiers (`client.pk`, authenticated `user.pk`), never a raw client-supplied header.

**Attachment handling (comments):** real allowlist (images + PDF), 5MB cap, genuine content verification (not extension-trust), no predictable-URL enumeration risk (Cloudinary auto-generates `public_id`s).

---

## 12. Notifications / Activity / Audit Audit

This section is dominated by INV-002 (§5) — the single largest gap found in this audit for this section. To restate the concrete evidence: a full real invoice lifecycle (create → finalise → send-manually → mark-paid, plus a separate cancel, a separate refund, a separate bad-debt transition, and 4 payment records) was performed live in this session; querying `core.AuditLog` immediately afterward showed **8 rows total, all `invoice_sent`** — meaning finalise, mark-paid, cancel, refund, bad-debt, and every payment record left **zero** trace in the one table CLAUDE.md designates as the security/forensic audit trail for the whole application.

**What IS correctly wired:** `InvoiceSent` (manual mark-sent and real send both), `CustomSmtpFailed`, `CommentPosted`, `PaymentClaimSubmitted`/`Confirmed`, `InvoiceAcknowledged`, `EscalationRequired`, the 3 recurring-generation event variants, `FormalNoticeSent`, `StaleDraftsDigest` — all confirmed to have real registered handlers in `apps/invoices/notifications.py` and to correctly distinguish in-app-only vs. immediate-email vs. batched-email tiers per the documented `notif_invoice_events`/`notif_client_messages`/`notif_payments` toggle mapping.

**Distinguishing "what the freelancer sees" vs. "what requires attention" vs. "what's recorded for accountability":** the notification-tier design itself is sound and matches the spec's own 3-tier table — the gap is specifically that a large set of financially significant events never reach `AuditLog` at all, meaning even if a freelancer never opens the notification bell, there's no record for anyone (including a future admin-panel viewer) to reconstruct what happened to an invoice's money.

---

## 13. Recurring Invoice & Celery Audit

**Calendar-month math:** `dateutil.relativedelta` usage for the 2-month/quarterly/annual intervals is correct by inspection — `relativedelta` correctly clamps day-of-month at month/year boundaries (Jan 31 + 1 month → Feb 28/29). No bug found here.

**PORTAL-007, MEDIUM — no lock against a Celery Beat double-fire generating duplicate recurring invoices.** `generate_recurring_invoices`'s eligibility query and its advance of `next_recurring_date` are not wrapped in `select_for_update()`/a transaction, and there's no unique constraint analogous to `InvoiceReminder`'s to catch a duplicate after the fact. Two concurrent executions (a well-known, real operational Celery Beat risk, not a contrived scenario) could each generate — and if `recurring_auto_send` is on, each independently finalise-and-send — a duplicate invoice to the same client for the same billing period. **NOT VERIFIED live** (would require an actual double-fire, out of scope to force safely in this session) — a structural absence-of-protection finding.

**3-strikes failure/auto-pause (`recurring_failure_count`):** logic confirmed present and reasonable by code inspection; not independently live-exercised this session (would require forcing 3 consecutive generation failures, not attempted).

**Idempotency of the reminder task itself:** see PORTAL-003 in §11 — the check-then-act ordering flaw applies here too.

**Both `pause`/`resume`-recurring views correctly reject a non-recurring invoice**, but rely on the invariant "only a root invoice ever has `is_recurring=True`" rather than an explicit `parent_invoice_id is None` check (INV-007, LOW) — true today by construction, but not defensively enforced.

---

## 14. Database Audit

**Migration hygiene:** `apps/clients/migrations/` (2 files) and `apps/invoices/migrations/` (10 files) are sequential, cleanly named, no squash markers, no gaps. `python manage.py makemigrations --check --dry-run` returns **"No changes detected"** — confirmed, no pending model drift.

**Indexes:** every index documented in `DATABASE.md` for `clients`/`invoices` and their child tables was cross-checked directly against `Meta.indexes` in the actual model code — **all match exactly**, no discrepancies found.

**DB-003, HIGH — `Invoice.user`/`Client.user` are `CASCADE`, contradicting CLAUDE.md's own explicit database-design rule.** CLAUDE.md states verbatim that financial records should `PROTECT` against deletion, and separately describes account deletion as leaving "financial records... [with] a PROTECT relationship to the now-anonymized user." The actual code uses `CASCADE` on both FKs. **Mitigating factor, confirmed by grep:** no in-app code path anywhere in `apps.users`/`apps.admin_panel`/`core` calls `user.delete()` — the account-deletion flow is genuinely anonymize-only, matching the documented design in practice. But the model-level `CASCADE` is a real, independent landmine: any future maintenance script, a Django-admin bulk-delete action, or a bug in the anonymization flow that ever falls through to a real `.delete()` would silently destroy every invoice/client/payment/comment for that user with no confirmation, no audit trail, and no error — precisely the failure mode the project's own `PROTECT` rule exists to prevent.

**Raw SQL:** zero hits across both apps (`grep -rn ".raw(\|cursor.execute\|RawSQL"`) — CLAUDE.md's rule fully respected.

**Concurrency/locking:** **zero real uses of `select_for_update()` or `transaction.atomic()`** in either app's production code (only found inside a code comment describing the gap, and in test files). This is the direct root cause of both live-reproduced CRITICAL findings in §9 and the invoice-numbering race in §20 — not an isolated oversight but a systemic absence across every money-mutating and counter-generating code path in this module.

**Admin N+1 (DB-004, MEDIUM):** no `list_select_related` anywhere in either app's `admin.py`, despite nearly every `ModelAdmin.list_display` referencing a FK field directly — a comprehensive, easily-fixed N+1 pattern across the entire admin surface for both apps.

---

## 15. API Audit

Every mutating endpoint in both apps was checked for: authentication, authorization/ownership scoping, rate-limit tier correctness, and error-shape consistency. Summary (full detail in §4/§5/§7):

- **Authentication:** correct throughout — `IsAuthenticated` for freelancer-side, `AllowAny`-with-manual-session-check for portal-side (a deliberate, correct pattern, not a gap — see §7).
- **Authorization:** no IDOR found anywhere, live-verified (§18).
- **Rate limiting:** matches CLAUDE.md's documented 3-tier model (Strict/Moderate/Generous) consistently — every mutation is Moderate-tier (30/hr per user per action), every read endpoint correctly has none, portal writes have their own tighter tiers. One real gap: `portal_enter` itself (CLIENT-001).
- **Idempotency:** correctly enforced via `confirm: true` flags on several destructive actions (mark-sent, refund, bad-debt, formal-notice) — but this is request-level confirmation, not true idempotency-key-based deduplication, so it does not protect against the double-submit/concurrency scenarios in §9/§20.
- **Error shapes:** mostly DRF-standard field-keyed 400s; one confirmed-fixed historical bug (payment-claim errors previously not surfacing to the client, per CLAUDE.md's own changelog) — not independently re-verified this session but no regression found in the current code.

---

## 16. Frontend Audit

**Frontend-vs-backend guard parity:** cross-checked every InvoiceDetailPanel action's visibility condition against the real backend guard clause. The large majority match exactly or are narrower than the backend (safe). Two real gaps found:

- **FE-001 (§9, CRITICAL):** "Undo Payment" — both the frontend gate and the backend guard independently omit `refunded`, with a dead, unused `NO_PAYMENT_STATUSES` constant sitting right next to the actual (wrong) hand-rolled condition — a real maintenance-drift bug, not a one-sided gap.
- **FE-003, MEDIUM:** Add Payment/Mark Paid — the frontend correctly only shows these for `ACTIVE_STATUSES`, but the backend accepts them on `created` (never sent) or already-`paid` invoices too. No UI path reaches this today, but a direct API call from the account owner's own session could.

**Double-submission protection:** verified genuinely solid — a single `busy`/`busyKey` state disables every mutating control across the whole `InvoiceDetailPanel`/`NewInvoiceWizard`/`ClientDetailPanel` while any action is in flight. This correctly prevents same-tab double-clicks from firing duplicate requests. **Explicit caveat:** this offers zero protection against the actual exposure in §9/§20 — two separate browser tabs, or two different devices, are not covered by any in-tab busy flag, and that's exactly the class of concurrency this audit reproduced live at the backend.

**FE-004, LOW/MEDIUM:** 8 mutating handlers in `ClientDetailPanel.jsx`/`Clients.jsx` (archive, restore, unflag, add-note, delete-note, attach-tag, detach-tag, quick-archive/restore) silently swallow errors with an empty `catch` block and no user-visible feedback — inconsistent with the same files' other handlers, which correctly surface `e.response?.data?.error`.

**Confirmation dialogs, loading/empty/error states, mobile breakpoints, portal error handling:** all verified present and correct by code inspection. No `dangerouslySetInnerHTML`, no bare `eval`, no emoji-as-icon violations found anywhere in `frontend/src` or `admin-frontend/src` (full repo grep, zero hits on all three).

---

## 17. Security Audit

**IDOR/BOLA:** none found — see §18, live-verified with a real second account.

**Authentication bypass / privilege escalation:** none found in either app.

**CSRF:** correctly enforced everywhere the JWT cookie is present; **PORTAL-002 (HIGH)** — genuinely missing on the 3 real portal-session-authenticated write endpoints.

**XSS:** none found in any server-rendered surface (PDF/portal templates all auto-escape correctly); a real, live HTML-injection path exists in outbound notification emails (FE-002, HIGH) and a dormant one in stored `body_html` (MEDIUM); a real, unescaped-email-content injection into the client-portal magic-link email (CLIENT-002, MEDIUM).

**SQL injection:** not applicable — zero raw SQL anywhere in either app (confirmed by grep); a client name/address containing `'; DROP TABLE clients;--` was live-created as test data specifically to probe this (`AUDIT Client 005`) and round-trips safely through the ORM with no anomaly.

**Insecure file upload:** signature/AI-design-reference image uploads both do real content verification (not extension-trust), size caps, and safe error handling on malformed input — no findings.

**Timing attacks:** two non-constant-time secret comparisons (PORTAL-005/M2), low practical exploitability, real defense-in-depth gap.

**Enumeration/information disclosure:** portal magic-link entry and request-link flows correctly avoid confirming/denying whether a given email has an account — no enumeration vector found.

**Session hijacking/fixation:** no vulnerability found in either the freelancer JWT/cookie stack or the client-portal session stack (both use fresh, high-entropy tokens hashed at rest, never token reuse across a privilege boundary).

---

## 18. Multi-Tenant Isolation Audit

**This is a genuine strength of the implementation and was directly, live re-verified as part of this audit, not just taken on the strength of code inspection.**

**Live test performed:** using a real second existing account (`ali_amir`), I attempted to:
1. `GET` a `superadmin`-owned invoice by its real UUID → **404** ("No Invoice matches the given query"), not a 403 with data leakage and not the actual invoice data.
2. `GET` a `superadmin`-owned client by its real UUID → **404**, same pattern.
3. `POST .../cancel/` on that same `superadmin` invoice (an attempted cross-tenant mutation, not just a read) → **404**, correctly rejected before any mutation could occur.

All three attempts correctly returned "does not exist" rather than either leaking data or a bare 403 that would confirm the object's existence to an attacker — the strongest form of this protection (indistinguishable from a genuinely nonexistent ID). This matches the code-level finding from every research pass in this audit: every single object lookup in both apps is scoped with `user=request.user` (or, for portal endpoints, `client=client`/`view_token`-match), with zero exceptions found across ~40+ distinct endpoints inspected.

**No IDOR/BOLA vulnerability was found anywhere in `apps/clients` or `apps/invoices`.** This stands in real contrast to the concurrency findings elsewhere in this report — the *ownership* boundary is solid; the *concurrent-access-within-one-owner's-own-data* boundary is not.

---

## 19. Performance Audit

**N+1 queries, confirmed:**
- `client_list` — missing `.prefetch_related('tags')` (CLIENT-004).
- `invoice_list` — missing `.prefetch_related('items')` (INV-006).
- Every `ModelAdmin` in both apps — missing `list_select_related` (DB-004).

**Verified NOT an N+1 problem (checked directly, not assumed):** `invoice_summary`'s per-row iteration only touches scalar fields already on the loaded row; `client_notes` correctly uses `select_related('author')`; the analytics endpoints' top-clients query correctly uses `select_related('client')`.

**PDF generation performance:** `draft`-status live-render is synchronous in-request by deliberate design (nothing to freeze yet) — a real, bounded per-request cost, not a bug. Finalise's PDF generation is genuinely offloaded to Celery, confirmed in code.

**Operational finding, not a code bug — IMPORTANT, flag before launch:** in this development environment, the Celery worker **segfaults (SIGSEGV) on every single `render_and_store_invoice_pdf` task**, confirmed repeatedly across this session's testing (multiple `WorkerLostError: signal 11` crashes logged, each correlating exactly with a queued PDF-render task). This matches CLAUDE.md's own already-documented "known WeasyPrint/GC segfault on this dev machine" caveat for full-suite test runs — but this audit observed it firing on the *production task itself*, not just the test suite, meaning in this exact environment **no invoice ever actually gets a frozen PDF**, and the client-portal "View Invoice" page 503s for every real sent invoice. **This needs to be explicitly re-verified against the actual production deployment container before launch** — if the same native-library/fork-safety incompatibility exists there (the documented workaround is a macOS-specific `OBJC_DISABLE_INITIALIZE_FORK_SAFETY` env var, which strongly suggests this is a macOS-dev-machine-specific issue rather than a Linux-container issue, but this was **NOT independently confirmed against a real Linux production-like container in this audit** — treat as an open verification item, not a resolved non-issue).

---

## 20. Concurrency & Race Conditions

This is the section containing the audit's most serious findings. Summary of every concurrency-sensitive operation inspected:

| Operation | Locked/atomic? | Live-tested? | Result |
|---|---|---|---|
| Invoice number generation | ❌ No | ✅ Yes | **CONFIRMED RACE** — 5 concurrent drafts finalised simultaneously for the same user; 2 succeeded, 2 failed with a raw, unhandled `IntegrityError` 500 (`duplicate key value violates unique constraint... Key (user_id, invoice_number)=(..., INV-2026-0029) already exists.`) — Django's debug error page was served directly to the client. |
| Partial payment recording | ❌ No | ✅ Yes | **CONFIRMED CRITICAL BUG** — see §9. 3 concurrent $700 payments on a $1000 invoice all succeeded, producing `amount_paid: 2100.00`. |
| Undo-payment status guard | ❌ No status guard at all | ✅ Yes | **CONFIRMED CRITICAL BUG** — see §9. Reachable and destructive on a `refunded` invoice. |
| Client-email duplicate check | ❌ No (app-level only) | Not live-tested concurrently | Real TOCTOU race per code inspection (CLIENT-003) |
| Portal session issuance | ❌ No | Not live-tested concurrently | Benign — worst case is a harmless duplicate session row, not a security/correctness issue |
| Recurring invoice generation | ❌ No | Not live-tested (requires forcing a Beat double-fire) | Real structural gap per code inspection (PORTAL-007) |
| Reminder/unread-comment email send-then-mark ordering | N/A (ordering, not locking) | Not live-tested (requires a mid-flight crash) | Real structural gap per code inspection (PORTAL-003) |
| Status transitions generally (cancel/refund/bad-debt vs. payment reaching paid) | ❌ No | Not independently live-tested beyond the two confirmed cases above | Real lost-update risk per code inspection — two different concurrent actions on the same invoice can silently overwrite each other's status change with no error |

**Root cause, stated once for the whole module:** `apps/invoices` and `apps/clients` contain **zero production uses** of `select_for_update()` or `transaction.atomic()`. Every state-mutating endpoint follows a read-then-check-then-write pattern with no row lock and no transaction boundary wider than Django's implicit per-statement autocommit. This is not a collection of isolated bugs; it is the module's dominant, systemic architectural gap, and it is the primary reason for this report's "NOT READY" verdict.

---

## 21. Internationalization / Currency / Timezone

**Currency:** no hardcoded `choices=` anywhere (by design, validated against `ExchangeRateSnapshot`'s live rate table) — confirmed working across USD/EUR/GBP/PKR test invoices, all calculated correctly, all displayed with correct symbols in the API responses tested.

**Timezone:** `USE_TZ = False`, PKT-only storage/display per CLAUDE.md's documented design — not independently re-audited in depth this session (out of this module's primary scope; the daily/weekly Celery Beat schedule times — 8:30/9:00/9:30 AM PKT — were confirmed present in `config/celery.py` by the research agents but their actual firing behavior across a DST-adjacent boundary was **NOT VERIFIED**, since Pakistan doesn't observe DST, making this a low-risk gap specifically for this deployment's stated target market, though the code contains no explicit protection against a future multi-region expansion).

**Arabic/Urdu font support:** see PDF-003 (§10) — a real, unresolved risk specifically relevant to this project's own stated target market, not a generic i18n nitpick.

**Decimal precision/rounding:** verified consistent and correct across every currency and amount tier tested (from $0.00 zero-amount invoices to $10.8M large-amount invoices, and fractional-quantity/fractional-price decimal invoices).

---

## 22. Edge Case Audit

All of the following were created as real, live test data (see §24) and round-tripped successfully through the create/calculate pipeline with correct results, except where noted:

- **Empty client / empty invoice:** a zero-line-item state is reachable via the INV-001 bug path (§5) — not a designed "empty invoice" feature, but confirmed reachable.
- **Huge invoice amount:** $9,999,999.99 unit price + 8.25% tax → `$10,824,999.99` total, computed correctly, no overflow (verified against the `max_digits=12` field).
- **Very long client name/company/address** (150-400 characters): accepted and stored correctly by the `Client` model (no `max_length` violation encountered at the tested lengths).
- **Unicode/emoji/special characters** (`日本語`, `العربية`, mixed-script names): accepted and stored correctly at the API layer; **visual PDF rendering was NOT verified** (blocked by §19's Celery crash) — this is exactly where PDF-003's font-fallback risk matters most and remains unconfirmed.
- **SQL-injection-shaped string** (`Test"'; DROP TABLE clients;-- St`) as a client address: stored and returned safely, no anomaly — ORM parameterization holds.
- **HTML/script-tag-shaped string** (`<script>alert(1)</script>`) as a client company name and an invoice line-item description: stored safely; confirmed NOT rendered unescaped in any API JSON response or (by code inspection) in the PDF template path.
- **Discount exceeding subtotal:** `$99,999` discount on a `$100` item → `total: "0.00"`, correctly clamped, never negative.
- **Zero-amount line item:** `$0.00` unit price accepted, invoice total correctly `$0.00`.
- **Many line items** (20): all created and totaled correctly (`$200.00`).
- **Duplicate client email (same user):** correctly rejected with a clear 400 error on the first attempt (live-tested — this is what surfaced CLIENT-003's underlying app-level-only enforcement).
- **Invalid/expired/malformed portal token:** by code inspection, returns a clean 404/401, never a crash — not independently live-probed with a fabricated token string this session.
- **Nonexistent UUID on every endpoint tested:** correctly 404s, never a 500 or an IDOR-adjacent information leak.
- **Repeated/simultaneous requests:** see §20 — this is where the audit's most serious findings live.

---

## 23. Test Results

**Live-executed tests performed against the real running application (Django + real PostgreSQL + real Redis + real Celery worker/beat), all under the `superadmin` account plus one cross-tenant probe from a real second account:**

1. Authenticated as `superadmin` via a real, legitimately-minted session (token service, not a password reset — no existing credential was touched).
2. Created 9 real `AUDIT Client *`-prefixed clients covering: standard USD, EUR, GBP, PKR, very-long-name, Unicode/SQL-injection/XSS-probe content, zero-payment-terms, and two clients reserved for archive/flag testing.
3. Created 18 real `AUDIT Invoice *`-prefixed invoices covering every lifecycle status (draft, created, sent, paid, partially paid, overdue-but-not-a-stored-status, cancelled, refunded, bad debt, one-time-client, zero-amount, large-amount, decimal-precision, many-items, unicode/long-description, max-discount-clamped-to-zero, recurring) plus 4 additional throwaway invoices used specifically for the concurrency-race tests.
4. Live-drove the full lifecycle via the real API for each: finalise, mark-sent, mark-paid, add-payment, cancel, refund, bad-debt — confirming the state-machine table in §6.
5. **Fired 4 real concurrent finalise requests** against 4 fresh draft invoices for the same user → 2 succeeded, 2 crashed with a real, unhandled `IntegrityError` 500 (full Django debug traceback captured).
6. **Fired 3 real concurrent partial-payment requests** against one $1000 invoice → all 3 succeeded, producing a confirmed `amount_paid: $2100.00` overpayment.
7. **Performed a real undo-payment on a refunded invoice** → succeeded, producing a confirmed corrupted state (`refunded` status, `$0` paid, `$300` refunded, `$900` outstanding).
8. **Cross-tenant IDOR probe** using a real second account (`ali_amir`) against `superadmin`'s invoice and client records (GET, GET, and a mutating POST) → all three correctly returned 404.
9. Verified the `AuditLog` table directly against the 8+ real lifecycle actions performed — confirmed only `invoice_sent` events were recorded.
10. Verified the max-discount clamp (`total: "0.00"`, never negative) and large-amount/decimal-precision calculations directly against API responses.
11. Observed, via the real Celery worker log, repeated `WorkerLostError: signal 11 (SIGSEGV)` crashes correlated exactly with every `render_and_store_invoice_pdf` task dispatched during this session.
12. Attempted the client-portal invoice-view flow (`portal_invoice_view_html`) for a real sent invoice → correctly received the designed 503 ("nothing frozen yet") response, and confirmed a `ClientPortalSession` cookie was still minted on that path.

**Not live-tested (explicitly marked NOT VERIFIED throughout this report), with reasons:**
- Actual visual PDF/portal-page rendering (Celery/WeasyPrint crash in this environment made frozen PDFs unavailable for every sent test invoice).
- Real inbound-email-webhook delivery and real Celery Beat double-fire scenarios (both require either external mail infrastructure or forcing a genuine scheduler race, judged unsafe/impractical to force in a shared dev environment within this audit's scope).
- Real email delivery to the 7 provided test addresses (composing/sending real emails was not attempted this session, given the Celery/PDF rendering instability observed and the time budget of this audit — this is a genuine gap in this audit's coverage, not a "verified working" claim).
- Django-admin-panel UI testing for either app (no admin screen exists yet for this module per ADMIN.md — code-level bypass risks were reported in §4/§14 instead).
- DST/timezone-boundary behavior (out of primary module scope, PKT-only design, low practical risk for the stated target market).

---

## 24. Test Data Created

All records below were created under the real `superadmin` account (`admin@lanceraos.com`) during this audit and were **deliberately left in the database** for manual inspection, per the audit brief. No existing user data was modified or deleted.

### Clients

| Name | ID | Currency | Purpose |
|---|---|---|---|
| AUDIT Client 001 - Standard USD | `6410c32c-bbb1-42db-b7a3-cd2349ae07cd` | USD | Baseline |
| AUDIT Client 002 - EUR Client | `30f840e5-cb54-4de7-b0c2-3c4ecaf342fe` | EUR | Currency coverage |
| AUDIT Client 003 - GBP Client | `6697907c-8c88-431f-81ac-7228e1a5225f` | GBP | Currency coverage |
| AUDIT Client 004 - Very Long Name... | `34d134be-f5eb-4ef7-b8dd-ecab2b81058d` | USD | Long-string edge case |
| AUDIT Client 005 - Unicode Special Chars 日本語 العربية | `f7ff2595-2995-49ab-b13a-ecf4220fdcdd` | USD | Unicode / XSS / SQLi probe (company/address fields) |
| AUDIT Client 006 - Zero Terms | `1f9858a3-1b96-4103-a1a8-939db117268b` | USD | Zero payment-terms edge case |
| AUDIT Client 007 - PKR Client | `c66ed007-bcd2-4a73-b588-5c06cdb80521` | PKR | Currency coverage |
| AUDIT Client 008 - To Be Archived | `8c4dc2e9-f088-4e4f-ae8c-7749a9f85e6a` | USD | Reserved for archive testing |
| AUDIT Client 009 - To Be Flagged | `d804140c-1bef-488c-818c-2797c61af715` | USD | Reserved for flag testing |

### Invoices

| Label | ID | Final invoice # | Final status | Total | Notes |
|---|---|---|---|---|---|
| AUDIT Invoice Draft | `c45e346f-815e-452b-b63f-928f8c60a1fe` | (none) | draft | 945.00 (stale — see INV-001) | Items cleared via PUT to reproduce INV-001; currently 0 items but non-zero total |
| AUDIT Invoice Created | `53e7db15-72cd-417c-b243-40c924a2844a` | INV-2026-0019 | created | 1200.00 | Finalised, never sent |
| AUDIT Invoice Sent | `91fdb0df-ec48-4729-89fc-b6b8fce2613e` | INV-2026-0020 | viewed | 902.00 | EUR, tax+discount combo |
| AUDIT Invoice Paid | `01f4f912-b229-4f8f-bf11-cc6c79d4c273` | INV-2026-0021 | paid | 2500.00 | Fully paid |
| AUDIT Invoice Partially Paid | `6c6774cc-662a-4c76-a1ff-3ec42b504b81` | INV-2026-0022 | partially_paid | 3000.00 | GBP, £1000 paid of £3000 |
| AUDIT Invoice Overdue | `afc524bb-7c1c-4489-ba9b-91de7df8d1ae` | INV-2026-0023 | sent | 500.00 | Due date 30 days in the past, unpaid — confirms no stored `overdue` status |
| AUDIT Invoice Cancelled | `48dc26b6-c4c8-4687-8511-fd04a1ad982a` | INV-2026-0024 | cancelled | 1500.00 | |
| **AUDIT Invoice Refunded** | `76472345-cdb5-4800-a2f0-6cc8ba1547e8` | INV-2026-0025 | refunded | 900.00 | **CORRUPTED via CRITICAL-2 (§9): status=refunded, amount_paid=0.00, refunded_amount=300.00, outstanding_amount=900.00 — left in this state intentionally as live proof** |
| AUDIT Invoice Bad Debt | `ee036ec1-e7ac-4c00-a970-efe94f99c83c` | INV-2026-0026 | bad_debt | 150000.00 | PKR |
| AUDIT Invoice One-Time Client | `60927f7f-688e-4ad0-9ed7-c0890b506f6b` | INV-2026-0027 | created | 400.00 | `client=null`, `is_one_time_client=true` |
| AUDIT Invoice Zero Amount | `f5e91933-8bf2-4046-80b3-668841070891` | (none) | draft | 0.00 | $0 line item |
| AUDIT Invoice Large Amount | `e833dd47-516d-42ff-9413-1520dee7c190` | (none) | draft | 10824999.99 | $9,999,999.99 + 8.25% tax |
| AUDIT Invoice Decimal Precision | `a41f6f06-7df5-4569-b90b-b0fa049c1708` | (none) | draft | 299.40 | Fractional qty/price, fractional discount |
| AUDIT Invoice Many Items | `ce34513e-d6e5-4753-b5e6-3becc3d48afc` | (none) | draft | 200.00 | 20 line items |
| AUDIT Invoice Unicode Long Description | `df4f348d-f228-42e4-bd33-e079e839a1ae` | (none) | draft | 100.00 | Unicode + XSS-probe line-item description |
| AUDIT Invoice Max Discount Exceeds Subtotal | `b33b47ec-c5cd-4ce1-934a-45b50d3d0d7c` | (none) | draft | 0.00 | Correctly clamped, verified not negative |
| AUDIT Invoice Recurring Monthly | `2406a758-0a80-434d-9829-1ffccc44fc94` | INV-2026-0028 | created | 500.00 | EUR, `is_recurring=true`, 30-day interval |
| **CRITICAL-1 proof invoice** (created inline, "OverpayRaceTest") | `c6559f99-48b1-45e8-a562-76ab950f6500` | INV-2026-0031 | paid | 1000.00 | **`amount_paid: 2100.00` — left in this overpaid state intentionally as live proof of §9's concurrency bug** |
| 5 throwaway "RaceTest N" invoices (invoice-numbering race test) | see `1eaf07c2…`, `3a94e86d…`, `e794a154…`, `22055de9…`, `283c8d96…` | INV-2026-0029, INV-2026-0030 (2 succeeded), 2 crashed with 500 (no number assigned, left as `draft` in a partially-processed state), 1 unaccounted | mixed | 10.00 each | Concurrency-race test fixtures — left as-is, do not "clean up" without first re-confirming the race is fixed |

**No cleanup was performed.** The two intentionally-corrupted records (`INV-2026-0025` refunded-but-owing, `INV-2026-0031` overpaid) are the clearest, most concrete evidence in this entire audit and should be inspected directly before any fix is applied, then used as the regression-test fixtures for whatever fix is chosen.

---

## 25. Findings Master Table

| ID | Severity | Area | Finding | Evidence | Verified? |
|---|---|---|---|---|---|
| INV-003 | **CRITICAL** | Concurrency/Payments | Concurrent partial payments jointly overpay an invoice with no lock, no clamp, no error | Live: 3×$700 on $1000 invoice → `amount_paid: 2100.00` | **Verified by execution** |
| INV-009 | **CRITICAL** | State machine / Payments | Undo Payment has no status guard; reachable on `refunded` (and by identical unguarded code, `cancelled`/`bad_debt`) invoices, producing an internally contradictory record | Live: refunded invoice → undo → `refunded`+`$0 paid`+`$900 owed` | **Verified by execution** (refunded case); cancelled/bad_debt cases plausible-by-identical-code, not separately executed |
| DB-002 | **CRITICAL** | Concurrency | Same root cause as INV-003, module-wide: zero `select_for_update`/`transaction.atomic` usage anywhere | Grep-confirmed absence + live reproduction above | **Verified by execution** |
| INV-004 | HIGH | Concurrency | Invoice-number generation race — concurrent finalise crashes with unhandled 500 `IntegrityError` | Live: 4 concurrent finalise calls, 2×500 with full traceback | **Verified by execution** |
| INV-001 | HIGH | Calculations | Clearing all line items via PUT leaves a stale non-zero `subtotal`/`total` | Live: 2-item $945 invoice → `items:[]` → still `$945` | **Verified by execution** |
| INV-002 | HIGH | Audit trail | No `AuditLog` handler for Created/Finalised/Paid/PartiallyPaid/Cancelled/Refunded/MarkedBadDebt/Resent | Live: 8+ real actions → only `invoice_sent` logged | **Verified by execution** |
| PORTAL-001 | HIGH | Portal security | `is_freelancer_previewing_portal` doesn't check invoice/client ownership — misfires across unrelated tenants | Code-verified, corroborated by 2 independent passes | Code-verified; live end-to-end blocked by §19 |
| PORTAL-002 | HIGH | Portal security | No CSRF enforcement on portal comment/claim/acknowledge POST endpoints | Code-verified (grep for `enforce_csrf_standalone`) | Code-verified |
| PORTAL-003 | HIGH | Email reliability | Reminder/unread-comment tasks send email before writing their own idempotency marker — real double-send risk on crash/retry | Code-verified (exact statement ordering read) | Code-verified, not live-forced |
| PDF-001 | HIGH | Design system | `InvoiceDesign.design_data`/`color_variant` never reach the PDF/portal renderer — the entire design editor has zero effect on real invoices | Code-verified (repo-wide grep of template files) | Code-verified |
| FE-001 | HIGH | Frontend/Backend | Frontend `NO_PAYMENT_STATUSES` dead code + real gate both omit `refunded` — same bug as INV-009 from the UI side | Code-verified, corroborates live INV-009 | Code-verified + live (via INV-009) |
| FE-002 | HIGH | Email/XSS | `body_text`/`client_name` interpolated unescaped into outbound HTML notification emails | Code-verified (exact f-string interpolation read) | Code-verified |
| DB-003 | HIGH | Schema | `Invoice.user`/`Client.user` are `CASCADE`, contradicting CLAUDE.md's own PROTECT-for-financial-records rule | Code-verified; no live delete-path found (dormant landmine) | Code-verified |
| CLIENT-001 | MEDIUM | Rate limiting | `portal_enter` has zero rate limiting, unlike its sibling `portal_request_link` | Code-verified | Code-verified |
| CLIENT-002 | MEDIUM | Email/XSS | Freelancer-controlled `client.name` interpolated unescaped into the portal magic-link email HTML | Code-verified | Code-verified |
| CLIENT-003 | MEDIUM | Concurrency | Client-email duplicate check is a TOCTOU race, no DB `UniqueConstraint` | Code-verified; duplicate-rejection itself live-confirmed (single-request path only) | Partially verified |
| CLIENT-004 | MEDIUM | Performance | N+1 on `client_list`'s `tags` (missing `.prefetch_related`) | Code-verified | Code-verified |
| CLIENT-005 | MEDIUM | Admin/Audit | Django admin bypasses flag/currency/email validation, no audit event on `is_active`/`is_flagged`/`user` edits | Code-verified | Code-verified |
| PORTAL-004 | MEDIUM | PDF/Portal integrity | Live-render fallback in `fetch_invoice_pdf_bytes` can show current (not frozen) freelancer profile data for a sent+ invoice during an infrastructure failure | Code-verified | Code-verified |
| PORTAL-005 | MEDIUM | Security | Non-constant-time comparison for webhook secret and one-time-client `view_token` | Code-verified | Code-verified |
| PORTAL-006 | MEDIUM | Security (dormant) | `InvoiceComment.body_html` from email-reply webhook stored unsanitized; not currently rendered by any frontend | Code-verified | Code-verified |
| PORTAL-007 | MEDIUM | Concurrency | `generate_recurring_invoices` has no lock against a Celery Beat double-fire | Code-verified | Code-verified, not live-forced |
| PDF-002 | MEDIUM | PDF rendering | No page-break/overflow CSS protection in any of the 3 templates | Code-verified | Code-verified; not visually confirmed (blocked by §19) |
| PDF-003 | MEDIUM | i18n | No Arabic/Urdu-capable font embedded or declared as fallback | Code-verified | Code-verified; runtime behavior environment-dependent, not confirmed |
| PDF-004 | MEDIUM | Design schema | No page-bound checks on x/y/width/height; `style` values never validated — live CSS-injection surface once PDF-001 is fixed | Code-verified | Code-verified |
| FE-003 | MEDIUM | Backend under-enforcement | Add Payment/Mark Paid backend accepts `created`/already-`paid` invoices; frontend hides but backend doesn't block | Code-verified | Code-verified |
| DB-004 | MEDIUM | Performance | Missing `list_select_related` on every `ModelAdmin` in both apps | Code-verified | Code-verified |
| INV-005 | MEDIUM | Validation | `discount_amount` has no upper-bound validation (result is safely clamped, input isn't) | Code-verified | Code-verified |
| CLIENT-006 | LOW | Concurrency | `ClientTag` name race surfaces as unhandled 500 instead of clean 400 | Code-verified | Code-verified |
| CLIENT-007 | LOW | Concurrency | `portal_token` collision unhandled (practically inert, 128-bit entropy) | Code-verified | Code-verified |
| CLIENT-008 | LOW | Validation | `default_payment_terms` has no upper bound | Code-verified | Code-verified |
| CLIENT-009 | LOW | Security | No rate limit on repeated invalid portal-cookie probing (low risk, 256-bit token) | Code-verified | Code-verified |
| INV-006 | LOW | Performance | `invoice_list` N+1 on `items` (missing `.prefetch_related`) | Code-verified | Code-verified |
| INV-007 | LOW | Robustness | Pause/resume-recurring rely on an unenforced invariant rather than an explicit check | Code-verified | Code-verified |
| INV-008 | LOW | Correctness | `invoice_duplicate` doesn't copy the source's `design` FK | Code-verified | Code-verified |
| PORTAL-008 | LOW | Observability | Email success-path logging omits `user_id` | Code-verified | Code-verified |
| FE-004 | LOW/MEDIUM | Frontend UX | 8 mutating handlers in `ClientDetailPanel.jsx`/`Clients.jsx` silently swallow errors | Code-verified | Code-verified |
| CLIENT-010 | INFO | Admin/Ops | `ClientPortalSession` has no Django admin registration | Code-verified | Code-verified |
| PORTAL-009 | INFO | Design tradeoff | Non-expiring `portal_token` + durable session grants long-lived access from a single leaked link (documented, deliberate) | Code-verified | Code-verified |
| PERF-001 | INFO/OPERATIONAL | Infrastructure | Celery worker segfaults on every `render_and_store_invoice_pdf` task in this dev environment | **Directly observed live**, repeatedly, this session | **Verified by execution** in this environment; production container **NOT independently verified** |
| SEC-001 | INFO (positive finding) | Multi-tenancy | No IDOR/BOLA found anywhere; cross-tenant GET/POST correctly 404s | Live-tested with a real second account | **Verified by execution** |

---

## 26. Critical / High Priority Fix List

Ordered by what should block launch vs. what should follow immediately after.

### Must fix before launch (blocking)

1. **INV-003 / DB-002 — Add row-locking to every payment-recording and status-mutating endpoint.** Wrap `invoice_add_payment`, `invoice_mark_paid`, `invoice_claim_confirm`, `invoice_cancel`, `invoice_refund`, `invoice_mark_bad_debt` in `transaction.atomic()` with `Invoice.objects.select_for_update().get(...)`, and re-validate `amount <= outstanding_amount` against the freshly-locked row. This is the single highest-priority fix in this audit — it is live-proven to corrupt real money data under ordinary concurrent use.
   - **Why it matters:** direct, unrecoverable financial-record corruption, no error surfaced to anyone.
   - **Dependencies:** none — this is a self-contained backend change.
   - **Priority: P0.**

2. **INV-009 / FE-001 — Add a status guard to `invoice_undo_payment`** (backend) mirroring the existing guard on `invoice_add_payment`/`invoice_mark_paid` (reject `cancelled`/`bad_debt`/`refunded`), and fix the frontend's dead `NO_PAYMENT_STATUSES` constant to actually be used (or delete it and fix the real hand-rolled condition to include `refunded`).
   - **Why it matters:** live-proven to produce an internally contradictory financial record with no reconciliation path.
   - **Dependencies:** none.
   - **Priority: P0.**

3. **INV-004 — Wrap `_finalise_invoice`'s invoice-number assignment in a lock or a retry-on-`IntegrityError`.** Either `select_for_update()` on a per-user counter, or a simple `try/except IntegrityError: retry once with a fresh number` around the 3 call sites.
   - **Why it matters:** live-proven to crash with a raw Django debug-mode 500 under ordinary concurrent use (two tabs, two devices).
   - **Dependencies:** none.
   - **Priority: P0.**

4. **INV-001 — Fix `recalculate_totals()` to zero `subtotal`/`tax_amount`/`total` when `item_total == 0`,** not just when it's negative. One-line fix (`if item_total > 0` → unconditional assignment, or explicit `else: self.subtotal = Decimal('0')`).
   - **Why it matters:** live-proven stale-total bug in the exact path the wizard/autosave uses on every edit.
   - **Dependencies:** none.
   - **Priority: P0.**

5. **PERF-001 — Confirm, before launch, that the WeasyPrint/Celery segfault observed in this dev environment does NOT reproduce in the actual production container.** If it does, no invoice PDF will ever freeze and no client can ever view an invoice online — this alone would make the product non-functional for its core use case.
   - **Why it matters:** this audit could not verify the client-facing invoice-viewing experience at all, in either direction, due to this crash.
   - **Dependencies:** access to a real staging/production-equivalent container to test against.
   - **Priority: P0 (verification), potentially P0 (fix) depending on outcome.**

### Should fix before launch (high priority, not necessarily blocking)

6. **INV-002 — Wire real `@on(...)` handlers for `InvoiceCreated`/`InvoiceFinalised`/`InvoicePaid`/`InvoicePartiallyPaid`/`InvoiceCancelled`/`InvoiceRefunded`/`InvoiceMarkedBadDebt`/`InvoiceResent`** into `apps/invoices/notifications.py`, writing to `core.AuditLog` the same way `InvoiceSent` already does. This is the majority of this module's actual financial audit trail, currently missing entirely.
7. **PORTAL-001 — Fix `is_freelancer_previewing_portal`** to require the freelancer session's `request.user` to actually own the invoice/client in question before suppressing any tracking/logging or rejecting any write.
8. **PORTAL-002 — Add `enforce_csrf_standalone` to `portal_invoice_comments`/`portal_invoice_claims`/`portal_invoice_acknowledge`**, matching the pattern already established in `apps/clients/views_portal.py`.
9. **PDF-001 — Decide and communicate the actual status of the design editor.** Either wire `design_data`/`color_variant` into `pdf_generator.py`'s render context (the larger fix), or clearly flag in the product/UI that custom designs are not yet reflected in sent invoices (the smaller, honest interim fix). Shipping the editor as fully functional while it has zero real effect is a user-trust risk independent of any code-quality concern.
10. **FE-002 — Escape `body_text`/`client_name` before HTML interpolation** in `build_unread_comments_email_for_freelancer`/`...for_client`.
11. **DB-003 — Change `Invoice.user`/`Client.user` to `on_delete=models.PROTECT`**, matching CLAUDE.md's own stated policy, closing the dormant-but-real landmine even though no current code path triggers it.
12. **PORTAL-003 — Reorder the reminder/unread-comment tasks to write their idempotency marker before (or atomically with) sending the email**, or wrap both in a lock, to close the crash-mid-flight double-send window.

### Recommended, not blocking

13–20. All MEDIUM findings in §25 (CLIENT-001 through PORTAL-007, DB-004, INV-005) — real, worth fixing in the next iteration, none individually severe enough to block launch on their own, but collectively they represent the same "correctness of the happy path, thin on hardening" pattern that produced the CRITICAL findings above, and are worth a dedicated hardening pass rather than one-off fixes.

---

## 27. Production Readiness Verdict

# NOT READY

This module must not launch in its current state. The determining factor is not the volume of findings (a mature codebase always has a findings list) — it is that **this audit did not have to construct an elaborate attack scenario to reach financial-data corruption. Ordinary, expected concurrent usage — a client double-clicking a payment button, two browser tabs, a freelancer undoing a payment on an invoice they'd already refunded — reproducibly corrupts real money data, live, on the first attempt, with no error surfaced to anyone.** A financial SaaS product cannot launch with this class of bug outstanding.

**Conditions that must be resolved before this module can be considered launch-ready:**

1. All 3 CRITICAL findings (§9, §20) must be fixed and the exact reproduction steps in this report re-run to confirm the fix holds under real concurrency, not just unit-tested in isolation.
2. INV-004 (invoice-numbering race) must be fixed — a raw Django debug-mode 500 reaching a real client is unacceptable regardless of data-integrity impact.
3. PERF-001 must be resolved or definitively ruled out against the real production container — this audit cannot confirm the core "client views their invoice online" flow works at all in a Celery-worker-crash-affected environment, and this needs a real answer, not an assumption, before launch.
4. INV-002 (the audit-trail gap) should be closed before launch — for a financial application handling real client money, "we have no record of who cancelled/refunded/marked-bad-debt this invoice or when" is not an acceptable state to launch with, independent of whether it's ever needed for a dispute.
5. PORTAL-001 and PORTAL-002 should be closed before any real client is exposed to the portal in production — both are real, live-reachable gaps in the trust boundary between "a client's own portal session" and "everything else."

Once those five items are resolved and re-verified (ideally with the exact live reproduction steps in §9/§20/§19 repeated against the fix), the remaining HIGH/MEDIUM findings in this report represent a reasonable, prioritizable hardening backlog for a "ready with conditions" reassessment — they do not, on their own, need to block a relaunch attempt the way the items above do.

---

## 28. Closing note

The strengths found in this audit are real and worth naming plainly, not just the gaps: multi-tenant isolation is genuinely solid (§18), the invoice state machine's *forward* guard logic is well built and often double-guarded (§6), the reliability-score formula is exactly correct (§4), calculation precision holds up under real stress-testing (§21/§22), and the email-fallback architecture (custom SMTP → Resend, never silently dropping a client email) is correctly implemented (§11). This is not a poorly-designed system — it is a fast-moving one where the concurrency and audit-trail disciplines that were clearly applied rigorously in the Users/Auth module (session locking, tiered rate limiting, CSRF discipline throughout) were not carried forward with the same rigor into this module's payment-mutating code paths. That is a fixable, well-scoped gap, not a fundamental architecture problem — but it is real, it is live-reproducible, and it must be closed before this module is trusted with real freelancers' real client payments.
