# INVOICES_CLIENTS_TECHNICAL_SPEC.md

Technical spec for Module 2 — `apps/clients/` and `apps/invoices/`, built from
`INVOICES_MODULE_KICKOFF.md`'s 32 questions, the final-decisions document, and the follow-up
resolution of Section 15's open items. This is a design document for review — no code has been
written against it yet.

Naming/scope calls made while drafting that weren't explicitly settled anywhere upstream (flagged,
not silently decided):
- v1's "saved defaults for fast invoice creation" concept is renamed `InvoicePreset` (was
  `InvoiceTemplate` in v1) to avoid colliding with the new visual PDF design system, which owns the
  name `InvoiceDesign` instead.
- `InvoiceEmailReply` no longer exists as its own model — email replies are `InvoiceComment` rows
  tagged `source='email_reply'`, per the unified-thread decision in Section 5 of the decisions doc.
- `ClientTag` is a new, minimal model — named as owned by `apps/clients/` in the decisions doc but
  never designed there.
- Client Acknowledgment, Stale-Draft Nudges, and AR Aging Report (decisions doc Section 13, items
  1–3) are confirmed in-scope for this build. Only Estimates (item 4) stays deferred as its own
  future module conversation.

---

## 1. Business Event System (minimal, per Ali's scoping note)

`core/events.py` — new, shared infrastructure, but Invoices/Clients is its first and only consumer
for now. This asymmetry gets a `DECISIONS.md` entry stating plainly that Users/Auth stays on
inline `send_email()`/`log_event()` calls, and retrofitting it there is a known, deferred cost —
not something to be "discovered" later.

Deliberately NOT built: a class hierarchy, async dispatch, event persistence/replay, or a plugin
system. Just:

```
_HANDLERS: dict[str, list[Callable]] = {}

def on(event_name):          # decorator, registers a handler
def emit(event_name, **payload):  # calls every registered handler synchronously, in order
```

Handlers are plain functions living next to the code they affect (e.g. a handler in
`apps/invoices/notifications.py` that turns `InvoicePaid` into an `AuditLog` write + WebSocket
push). `emit()` catches and logs (never raises) any individual handler's exception so one broken
side effect can't break the request that triggered it — same defensive posture as `Notification.create()`'s
`except Exception: pass` around the channel-layer call in v1, generalized.

**Event catalog for this module:**
`ClientCreated`, `ClientArchived`, `ClientFlagged`, `InvoiceCreated`, `InvoiceFinalised`,
`InvoiceSent`, `InvoiceViewed`, `InvoicePartiallyPaid`, `InvoicePaid`, `InvoiceCancelled`,
`InvoiceRefunded`, `InvoiceMarkedBadDebt`, `InvoiceAcknowledged`, `PaymentClaimSubmitted`,
`PaymentClaimConfirmed`, `PaymentClaimRejected`, `CommentPosted`, `RecurringInvoiceGenerated`,
`ReminderSent`, `EscalationRequired`, `CustomSmtpFailed`.

## 2. Money value object

`core/money.py` — a small, immutable dataclass, not an ORM concept:

```
@dataclass(frozen=True)
class Money:
    amount: Decimal
    currency: str          # ISO code
    rate_to_usd: Decimal | None = None   # None only for USD itself

    def to_usd(self) -> Decimal
    def convert(self, target_currency: str, snapshot: "ExchangeRateSnapshot") -> "Money"
```

Used at the business-logic layer (views, tasks, PDF rendering) wherever an amount and its currency
travel together — replacing the pattern of passing `amount` and `currency` as two separate
loose arguments. Does not replace the DB columns (`amount`/`currency` stay separate fields on
models, for queryability) — it's constructed from them at the point of use.

---

## 3. `apps/clients/` — Models

### `Client`
| Field | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `user` | FK → User, CASCADE | |
| `name` | CharField(200) | |
| `email` | EmailField | |
| `company` | CharField(200), blank | |
| `address` | TextField, blank | |
| `phone` | CharField(30), blank | |
| `country` | CharField(100), blank | |
| `default_currency` | CharField(3) | See "Currency field, no hard `choices=`" note below |
| `default_payment_terms` | PositiveIntegerField, default 30 | |
| `notes` | TextField, blank | |
| `is_active` | BooleanField, default True | archive flag |
| `is_flagged` / `flag_reason` / `flag_type` / `flagged_at` | as v1 | manual only, per decisions doc |
| `auto_flagged` | BooleanField, default False | reserved for the future reliability-score-threshold derivation (Section 15 #4) — field exists, logic doesn't fire yet |
| `portal_token` | CharField(32), unique, indexed | persistent, non-expiring — this **is** the magic-link credential for "view all invoices," not a session |
| `created_at` / `updated_at` | | |

**Currency field, no hard `choices=` (added on review):** a Django `choices=` enum on `default_currency`
would gate what a user can select behind a hardcoded list — the same migration-coupling problem
`ExchangeRateSnapshot`'s JSONField was specifically designed to avoid, just moved one field over.
Instead: `CharField(3)`, no `choices=`, validated at write time in the serializer against
`ExchangeRateSnapshot`'s most recent `rates_to_usd` keys (plus `USD` itself, always valid even
before a snapshot exists). Adding a currency (e.g. INR, BDT) is then purely a data change — extend
the daily-fetch task's currency list, the next snapshot has it, `Client`/`Invoice` can immediately
use it — no migration on either model. `Invoice.currency` had the identical problem and gets the
same fix (see below).

1. **Mutable?** Yes. 2. **Soft deleted?** No — archived via `is_active`, not deleted (deletion is a
separate explicit action, invoice-preserving by default, matching v1's `keep_invoices` choice).
3. **Audit trail?** Via events → `AuditLog`, not a bespoke log. 4. **Indexed?** `(user, is_active)`,
`(user, email)`, `portal_token`. 5. **Encrypted?** No — no CNIC/NTN-class data here. 6. **Cascade?**
`CASCADE` from `User` (a deleted/anonymized user's clients have no independent meaning); `Invoice.client`
is `SET_NULL` in the other direction (invoices outlive a deleted client record).

### `ClientNote`
`client` FK CASCADE, `author` FK→User CASCADE, `content`, `created_at`, `updated_at`. Unchanged
from v1 in shape. Private, never client-visible.

### `ClientTag`
`id` UUID, `user` FK CASCADE, `name` CharField(40), `color` CharField(7, hex). `unique_together =
[('user', 'name')]`. `Client.tags = ManyToManyField(ClientTag, blank=True)`.

### `ClientPortalSession`
Structurally mirrors `TrustedDevice`, scoped to `(client, device)` instead of `(user, device)`.

| Field | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `client` | FK → Client, CASCADE | |
| `token_hash` | CharField, indexed | hashed session cookie value, never stored raw |
| `device_name` / `ip_address` / `user_agent` | | display-only, same as `TrustedDevice` |
| `created_at` | | |
| `last_used_at` | | refreshed on every authenticated portal request — this is what makes the 60-day window sliding |
| `expires_at` | | `last_used_at + 60 days`, recomputed on refresh |
| `revoked_at` | nullable | set by "log out everywhere"; session is invalid once set, row kept for history rather than deleted |

1. **Mutable?** Yes (`last_used_at`, `expires_at`, `revoked_at`). 2. **Soft deleted?** N/A — `revoked_at`
is the soft-delete. 3. **Audit trail?** Session creation/revocation emit events. 4. **Indexed?**
`token_hash`, `(client, revoked_at)`. 5. **Encrypted?** No — `token_hash` is a one-way hash, same
treatment as `TrustedDevice.token_hash`. 6. **Cascade?** `CASCADE` from `Client`.

No separate "magic link request" model — per the decisions doc, the credential is the persistent
`portal_token` / an invoice's `view_token`, both non-expiring. "Request a fresh link" is just
re-sending an email containing the same still-valid link, rate-limited at the view layer (cache-based,
matching the existing `email_change_req_{user.pk}` pattern) — 5/email/hour, 20/IP/hour, per your
confirmation.

---

## 4. `apps/payments/` — minimal, this module only

### `ExchangeRateSnapshot`
| Field | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `date` | DateField, unique, indexed | |
| `rates_to_usd` | JSONField | `{"PKR": 0.0036, "EUR": 1.08, "GBP": 1.27, "USD": 1.0}` — value of 1 unit of that currency in USD. Adding a currency later is a data change, not a migration. |
| `source` | CharField | `open.er-api.com` |
| `fetched_at` | DateTimeField | |

1. **Mutable?** No — append-only, one row per day. 2. **Soft deleted?** No. 3. **Audit trail?** N/A
(reference data, not a user action). 4. **Indexed?** `date`. 5. **Encrypted?** No. 6. **Cascade?**
N/A — nothing FKs to individual rate entries inside the JSON; `Invoice.exchange_rate_snapshot` FKs
to the row itself, `SET_NULL`.

The daily fetch task now captures the **full** table `open.er-api.com` already returns instead of
discarding all but 3 currencies (no new API cost — just keeping more of what's already fetched).

---

## 5. `apps/invoices/` — Models

### `Invoice`
| Field | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `user` | FK → User, CASCADE | |
| `client` | FK → clients.Client, SET_NULL, nullable | null = one-time client |
| `invoice_number` | CharField(30), unique | `INV-YYYY-NNNN`, unchanged from v1 |
| `status` | CharField, choices | `draft, created, sent, viewed, partially_paid, paid, cancelled, refunded, bad_debt` — **no stored `overdue`** |
| `sent_via_platform` | BooleanField, default False | set only by the real Send action; gates reminders only |
| `design` | FK → InvoiceDesign, SET_NULL, nullable | which saved visual design rendered this invoice's PDF |
| `view_token` | CharField(32), unique, indexed | public URL token; also a valid portal magic-link credential |
| `client_name/email/company/address/phone` | snapshot fields | immutable copy at creation, as v1 |
| `currency` | CharField(3), no `choices=` | validated at write time against `ExchangeRateSnapshot` — see `Client.default_currency`'s note in Section 3 |
| `subtotal/tax_rate/tax_amount/discount_amount/total/amount_paid` | Decimal | as v1 |
| `rate_to_usd_at_issue` | Decimal(10,6), nullable | replaces v1's PKR-specific `rate_at_issue`/`pkr_at_issue` |
| `exchange_rate_snapshot` | FK → payments.ExchangeRateSnapshot, SET_NULL, nullable | |
| `pdf_url` | URLField, blank | Cloudinary URL of the frozen, rendered PDF artifact. Populated exactly once, by the real `/send/` action — never re-rendered or overwritten after that, even if `design` is later edited. See "Stored PDF" note below. |
| `pdf_generated_at` | DateTimeField, nullable | when `pdf_url` was captured |
| `issue_date/due_date/paid_date/sent_at` | | |
| `notes/terms` | TextField, blank | |
| `reminders_enabled/reminder_count/last_reminder_sent_at` | | |
| `late_fee_enabled/late_fee_rate` | | |
| `is_recurring/recurring_interval_days/recurring_auto_send/recurring_paused` | | 6 interval options kept (Section 12) |
| `parent_invoice` | FK → self, SET_NULL, nullable | |
| `next_recurring_date` | | |
| `escalation_required/escalation_dismissed` | | |
| `is_one_time_client` | | |
| `pre_payment_status` | CharField, blank | undo mechanism, unchanged from v1 |
| `client_acknowledged` | BooleanField, default False | new — Section 13 #1 |
| `client_acknowledged_at` | DateTimeField, nullable | |
| `created_at/updated_at` | | |

Dropped from v1: `pkr_at_payment`, `rate_at_payment`, `exchange_rate_gain_loss` property — the
anchor-currency design computes display-currency conversion live from `ExchangeRateSnapshot`
history rather than storing a payment-time rate on the invoice itself. `days_overdue` and
`outstanding_amount` stay as computed properties, unchanged in spirit from v1.

**Stored PDF note (added on review):** without `pdf_url`, `GET /invoices/<pk>/pdf/` would have
nothing to serve except a live render from `InvoiceDesign.design_data` — which breaks the
frozen-at-send guarantee the decisions doc requires (editing a design later must never change what
an already-sent invoice's PDF looks like). Behavior: `draft`/`created` invoices always live-render
(nothing frozen yet, nothing to break). The real `/send/` action renders once and writes `pdf_url` +
`pdf_generated_at`; every status from `sent` onward serves that stored artifact, never a fresh
render, regardless of subsequent `InvoiceDesign` edits. The manual `mark-sent` dropdown-flip path
(no real send happened) also triggers this same one-time render+store, since the invoice is
leaving `created` either way and the same frozen-artifact guarantee applies. `duplicate_invoice`
resets `pdf_url`/`pdf_generated_at` to empty on the new draft, since a duplicate hasn't been sent
yet in its own right.

**`update_paid_status()` rewrite** — the core behavior change from v1: this method never writes
`'overdue'` into `status`. It only ever transitions between the 9 real stored statuses based on
`amount_paid` vs `total`. `days_overdue` stays a pure read-time property layered on top, exactly as
already true in v1 — the difference is the nightly Celery task no longer *also* overwrites status
to `'overdue'` for sent/viewed/created invoices (that was the actual bug being fixed). The task is
retained solely to drive reminder-escalation timing.

1. **Mutable?** Yes — this is the most actively-updated table in the module. 2. **Soft deleted?**
No — Cancel/Refund/Bad-Debt are real terminal statuses, not soft-delete; hard delete only permitted
pre-Sent (enforced at the view layer, not the model). 3. **Audit trail?** Every status transition and
payment action emits an event → `AuditLog`. 4. **Indexed?** `(user, status)`, `(user, due_date)`,
`(status, due_date)`, `(next_recurring_date)`, `view_token`. 5. **Encrypted?** No. 6. **Cascade?**
`CASCADE` from `User`; `SET_NULL` from `Client` and `InvoiceDesign`; self-referential `parent_invoice`
is `SET_NULL`.

### `InvoiceItem`
`invoice` FK CASCADE, `description`, `quantity`, `unit_price`, `total` (computed on save), `sort_order`.
Unchanged from v1.

### `InvoicePartialPayment`
`invoice` FK CASCADE, `payment` FK → payments.Payment (SET_NULL, nullable — Payment model doesn't
exist yet, field ready for Module 3), `amount`, `currency`, `rate_to_usd` (captured at record time,
anchor-generalized from v1's `exchange_rate`/`amount_pkr`), `source`, `payment_date`, `notes`,
`recorded_at`.

### `InvoiceReminder`
Unchanged from v1: `invoice` FK CASCADE, `reminder_number`, `template_used`, `sent_at`, `delivered`,
`days_overdue_at_send`. `unique_together = [('invoice', 'reminder_number')]`.

### `InvoiceViewEvent`
Unchanged from v1: `invoice` FK CASCADE, `viewed_at`, `ip_address`, `user_agent`, `source`.
Every write here runs through the freelancer-own-session guard (Section 4 of decisions doc) so a
freelancer viewing their own sent invoice never counts as a client view.

### `InvoiceComment` — new, replaces v1's absent messaging + `InvoiceEmailReply`
| Field | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `invoice` | FK CASCADE | |
| `author_type` | CharField, choices `freelancer` / `client` | |
| `author_user` | FK → User, SET_NULL, nullable | set when `author_type='freelancer'` |
| `client_name` / `client_email` | snapshot, blank | set when `author_type='client'` — no real account to FK to |
| `source` | CharField, choices `portal` / `email_reply` / `app` | |
| `body_text` | TextField | |
| `body_html` | TextField, blank | only populated for `email_reply` |
| `attachment_url` | URLField, blank | Cloudinary, same validation discipline as logo uploads |
| `created_at` | | |
| `read_by_freelancer_at` | nullable | |
| `read_by_client_at` | nullable | |

No `updated_at` — comments are immutable, never edited or deleted, per the decisions doc. 1.
**Mutable?** No, append-only (except the two `read_by_*_at` timestamps). 2. **Soft deleted?** No —
permanent record by design. 3. **Audit trail?** The comment row itself *is* the record; posting also
emits `CommentPosted`. 4. **Indexed?** `(invoice, created_at)`. 5. **Encrypted?** No. 6. **Cascade?**
`CASCADE` from `Invoice`; `SET_NULL` from `User` (comment survives an account being anonymized).

### `PaymentClaim`
Unchanged from v1: kept as a separate, structured flow per the decisions doc — not merged into
comments.

### `InvoiceDesign` — the visual PDF/portal template system (decisions doc Section 9/10)
| Field | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `user` | FK CASCADE | |
| `name` | CharField(100) | |
| `base_template` | CharField, choices `professional` / `minimal` / `modern` | which of the 3 built templates this started from, even for custom designs (used for the "closest-matching layout preset" AI-seed path) |
| `source` | CharField, choices `builtin` / `custom` / `ai_seeded` | |
| `color_variant` | CharField, blank | curated palette key, used by the `builtin` path only |
| `design_data` | JSONField | element positions/styles/data-bindings — the one shared structure feeding editor preview, portal page, and WeasyPrint, per the single-source-of-truth principle |
| `is_default` | BooleanField, default False | one per user, enforced in `save()` like v1's `InvoiceTemplate.is_default` |
| `created_at` / `updated_at` | | |

### `InvoicePreset` / `InvoicePresetItem` — renamed from v1's `InvoiceTemplate`/`InvoiceTemplateItem`
Same shape as v1 (client defaults, currency, tax_rate, discount, payment_terms, notes/terms,
late-fee settings, `is_default`) — this is the "quick-create defaults" feature, unrelated to visual
design. Renamed only to stop colliding with `InvoiceDesign`.

### `Notification` model — **removed entirely**
Confirmed: replaced by `AuditLog` + `NotificationRead`, extending `core/notifications.py`'s
`NOTIFICATION_EVENTS`/`EVENT_TITLES`/`EVENT_ACTION_URLS` dicts (Section 6 below) rather than
building a parallel table.

---

## 6. Notification entries — additions to `core/notifications.py`

Three tiers per the decisions doc. Every entry needs a real `action_url`, per the existing
compulsory rule.

| Event | Tier | Email? | Action URL |
|---|---|---|---|
| `invoice_viewed` | In-app only | No | `/invoices/{id}` |
| `invoice_sent` | In-app only | No | `/invoices/{id}` |
| `client_created` | In-app only | No | `/clients/{id}` |
| `invoice_paid` | In-app + immediate | Yes | `/invoices/{id}` |
| `invoice_partially_paid` | In-app + immediate | Yes | `/invoices/{id}` |
| `payment_claim_submitted` | In-app + immediate | Yes | `/invoices/{id}?tab=claims` |
| `payment_claim_confirmed` | In-app + immediate | Yes (to client, separate template) | `/invoices/{id}` |
| `custom_smtp_failed` | In-app + immediate | Yes | `/settings?tab=smtp` |
| `recurring_generation_failed` | In-app + immediate | Yes | `/invoices/?filter=recurring` |
| `invoice_escalation_required` | In-app + immediate | Yes | `/invoices/{id}` |
| `invoice_acknowledged` | In-app + immediate | Yes | `/invoices/{id}` |
| `comment_posted` | In-app + delayed/batched (1hr) | Yes, batched per invoice | `/invoices/{id}?tab=comments` |
| `recurring_invoice_generated` | In-app only | No | `/invoices/{id}` |
| `exchange_rate_alert` | In-app + immediate | Yes | `/dashboard` |

Security-notice precedent (password_changed, new_device_login, etc.) stays exempt from mute
preferences — confirmed. Everything in this table respects the `notif_invoice_events` /
`notif_client_messages` / `notif_payments` toggles already present in `FreelancerProfile` (built
ahead of this module in Users/Auth, per `NotificationsSection.jsx`) — `comment_posted` maps to
`notif_client_messages`, payment-related events to `notif_payments`, the rest to
`notif_invoice_events`.

---

## 7. Endpoint surface

### `apps/clients/`
```
GET/POST    /api/clients/
GET/PUT     /api/clients/<uuid:pk>/
POST        /api/clients/<uuid:pk>/archive/
POST        /api/clients/<uuid:pk>/restore/
POST        /api/clients/<uuid:pk>/flag/
GET/POST    /api/clients/<uuid:pk>/notes/
DELETE      /api/clients/<uuid:pk>/notes/<uuid:note_id>/
GET         /api/clients/<uuid:pk>/analytics/       (payment_stats + reliability score)
GET         /api/clients/<uuid:pk>/statement/pdf/
GET/POST    /api/clients/tags/
POST        /api/clients/<uuid:pk>/tags/<uuid:tag_id>/attach/
DELETE      /api/clients/<uuid:pk>/tags/<uuid:tag_id>/
POST        /api/clients/<uuid:pk>/convert-one-time/   (attach a prior one-time invoice's client)

# Portal — session issuance and content that belongs to client identity, not invoices
GET         /api/portal/<str:link_token>/                enter via any valid link (invoice view_token or Client.portal_token) — mints/renews ClientPortalSession
POST        /api/portal/request-link/                     self-serve "email me a fresh link" (rate-limited)
POST        /api/portal/logout/
POST        /api/portal/logout-everywhere/
GET         /api/portal/me/                                current session's client identity + invoice list
```

### `apps/invoices/`
```
GET/POST    /api/invoices/
GET/PUT     /api/invoices/<uuid:pk>/
DELETE      /api/invoices/<uuid:pk>/                       draft/created only, enforced server-side
POST        /api/invoices/<uuid:pk>/finalise/
POST        /api/invoices/<uuid:pk>/send/                  real send; sets sent_via_platform=True
POST        /api/invoices/<uuid:pk>/mark-sent/              manual dropdown flip; explicit confirm + reminders-toggle
POST        /api/invoices/<uuid:pk>/mark-paid/
POST        /api/invoices/<uuid:pk>/payments/                add partial payment
DELETE      /api/invoices/<uuid:pk>/payments/undo/           undo most recent (no id needed — always most-recent)
POST        /api/invoices/<uuid:pk>/cancel/
POST        /api/invoices/<uuid:pk>/refund/                  amount required, supports partial
POST        /api/invoices/<uuid:pk>/bad-debt/
POST        /api/invoices/<uuid:pk>/duplicate/
POST        /api/invoices/<uuid:pk>/acknowledge/              client-side action, portal-authenticated
GET         /api/invoices/<uuid:pk>/pdf/                       draft/created: live-render; sent+: serves stored pdf_url, never re-renders
GET         /api/invoices/<uuid:pk>/timeline/                  unified activity feed (views, comments, claims, reminders)
POST        /api/invoices/<uuid:pk>/toggle-reminders/
POST        /api/invoices/<uuid:pk>/pause-recurring/

GET/POST    /api/invoices/<uuid:pk>/comments/
GET/POST    /api/invoices/<uuid:pk>/claims/
POST        /api/invoices/<uuid:pk>/claims/<uuid:claim_id>/confirm/
POST        /api/invoices/<uuid:pk>/claims/<uuid:claim_id>/reject/

GET         /api/invoices/summary/                             dashboard KPIs
GET         /api/invoices/aging-report/                         AR aging — Section 13 #3
GET         /api/invoices/exchange-rate/

GET/POST    /api/invoices/designs/                              InvoiceDesign CRUD
GET/PUT     /api/invoices/designs/<uuid:pk>/
POST        /api/invoices/designs/<uuid:pk>/set-default/
POST        /api/invoices/designs/ai-seed/                      vision-model classify call, one-shot
POST        /api/invoices/signature/                             upload + background-removal + confirm

GET/POST    /api/invoices/presets/
GET/PUT     /api/invoices/presets/<uuid:pk>/
POST        /api/invoices/presets/<uuid:pk>/set-default/
POST        /api/invoices/presets/<uuid:pk>/create-invoice/

# WebSocket
ws://.../ws/invoices/notifications/       reuses the cookie-authenticated pattern designed for Users/Auth's notification consumer, generalized off any query-param-token approach
ws://.../ws/invoices/<uuid:pk>/comments/  live comment delivery when both sides have the thread open

# Public / unauthenticated
GET         /api/invoices/public/<str:token>/
GET         /api/invoices/public/<str:token>/pdf/
POST        /api/invoices/public/<str:token>/claim/
POST        /api/invoices/email/incoming/                        Cloudflare webhook → InvoiceComment(source='email_reply')
```

---

## 8. Build order — actual prompts

Matches the decisions doc's stated order (Clients → Invoice Core → PDF → Email → Portal Auth →
Portal Messaging → Payment Claims → Recurring → Reminders → Analytics), broken into individually
reviewable prompts. Each includes its own `DECISIONS.md`/`DATABASE.md`/`ADMIN.md` updates and its
own commit message, per standing convention.

1. **Foundations** — `core/events.py`, `core/money.py`, `ExchangeRateSnapshot` + the daily-fetch
   Celery task (full rate table). `DECISIONS.md` entry for the event-system scoping/inconsistency
   note.
2. **`apps/clients/` core** — `Client`, `ClientNote`, `ClientTag` models + migrations, CRUD
   endpoints, search/filter/sort, archive/restore, flag, analytics endpoint (reliability score).
   No portal yet.
3. **`apps/clients/` frontend** — Clients list, detail, notes, tags, analytics view.
4. **`apps/invoices/` core models** — `Invoice`, `InvoiceItem`, `InvoicePreset`/`InvoicePresetItem`,
   `update_paid_status()` rewrite (no more destructive overdue overwrite), invoice numbering,
   `recalculate_totals()`.
5. **Invoice CRUD + lifecycle endpoints** — create/edit/finalise/send(manual+real)/cancel/refund/
   bad-debt/duplicate, undo mechanics, `sent_via_platform` gating logic + the persistent UI-banner
   data the frontend needs.
6. **Invoice frontend core** — list, create/edit form, detail view, status badges reflecting the
   Overdue-as-computed-flag model (not a stored status).
7. **`InvoiceDesign` — built-in templates** — the 3 real WeasyPrint HTML/CSS templates
   (Professional/Minimal/Modern) as static, non-editable designs first; PDF generation endpoint;
   public invoice page sharing the same markup.
8. **`InvoiceDesign` — custom editor** — two-zone canvas, drag-and-drop tooling integration,
   save-time validation, sample-row-count preview toggle.
9. **`InvoiceDesign` — AI-seeding path + signature tool** — vision classify call, background
   removal, both wired into the editor from step 8.
10. **Email engine** — `send_email()`-based sending for invoice delivery, `CLAUDE.md`'s custom-SMTP
    routing chain built here (first real consumer of that deferred logic), reply-to tracking wired
    to the existing Cloudflare webhook.
11. **`apps/clients/` portal — auth** — `ClientPortalSession`, magic-link entry via `view_token`/
    `portal_token`, request-fresh-link flow + rate limiting, "log out everywhere," the
    freelancer-own-session guard function (generalized across all 4 places it's needed).
12. **Portal frontend** — client-facing invoice list, individual invoice view, Preview-as-Client
    mode inside the authenticated app.
13. **Comments** — `InvoiceComment` model, dual entry (portal + email webhook), WebSocket delivery,
    unread-1hr batched email task, attachments.
14. **Payment claims** — submission from portal, confirm/reject from the main app, wired into
    `update_paid_status()`.
15. **Client acknowledgment** — the explicit ack action + timestamp, portal-side.
16. **Recurring invoices** — generation task, template-lock to first-in-series `InvoiceDesign`,
    pause/resume. Failure/editing mechanics (Section 15 #5) get designed here, not before.
17. **Reminders + escalation** — schedule, `InvoiceReminder`, Formal Notice (Section 15 #1 designed
    here), escalation-required flow.
18. **Analytics** — dashboard summary endpoint, AR aging report, stale-draft weekly digest.
19. **Client statement PDF** — content/layout design happens here (Section 15 #6), reusing the
    WeasyPrint pipeline from step 7.
20. **Admin panel screens** — separate `Clients` and `Invoices` admin screens per
    `ADMIN.md`'s per-module pattern, built last so there's something real to administer.
21. **Full-module verification pass** — real server, real requests, adversarial PDF content
    (long names, wrapping descriptions, edge-case totals) per the honest caveat already on record
    that the 3 templates are conversation-proven, not yet production-proven.

Each numbered item above is one prompt's worth of scope, not one message — some (7, 8, 16) will
likely need to split further once we're in them. Happy to start at 1 whenever you give the word.