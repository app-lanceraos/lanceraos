# apps/invoices/models.py
"""
Invoice Core — Section 5 of INVOICES_CLIENTS_TECHNICAL_SPEC.md. Ported
from v1-reference/apps/invoices/models.py where v1 already had a correct,
working implementation (invoice numbering, recalculate_totals(), the
core shape of update_paid_status()), adjusted for the anchor-currency
design (rate_to_usd_at_issue replacing PKR-specific fields) and the
no-stored-'overdue' fix (see update_paid_status()'s docstring below and
DECISIONS.md for the full reasoning).

`currency` on Invoice (and InvoicePartialPayment) is a CharField(3) with
no `choices=` — same reasoning as apps.clients.Client.default_currency.
Validation against ExchangeRateSnapshot's current rates_to_usd keys (plus
'USD', always valid) belongs in the serializer layer, which doesn't exist
yet in this models-only step — whoever builds Step 5's serializers should
reuse apps.clients.serializers.validate_currency_code rather than
reinventing it.
"""
import secrets
import uuid
from decimal import Decimal

from django.conf import settings
from django.db import models
from django.utils import timezone

from apps.clients.models import Client
from apps.payments.models import ExchangeRateSnapshot


def _today():
    """A real function, not `timezone.now` — see Invoice.issue_date's field comment for why that distinction matters here."""
    return timezone.now().date()


# Statuses that should be restored when all partial payments are removed.
# 'overdue' deliberately excluded — v1 included it here (see v1-reference
# line 12), which is how a stale 'overdue' status could survive a
# payment-undo round trip. v2 has no stored 'overdue' status at all, so
# it can never legitimately end up in pre_payment_status to restore.
_RESTORABLE_STATUSES = frozenset({'created', 'sent', 'viewed'})

STATUS_CHOICES = [
    ('draft', 'Draft'),
    ('created', 'Created'),
    ('sent', 'Sent'),
    ('viewed', 'Viewed'),
    ('partially_paid', 'Partially Paid'),
    ('paid', 'Paid'),
    ('cancelled', 'Cancelled'),
    ('refunded', 'Refunded'),
    ('bad_debt', 'Bad Debt'),
]

RECURRING_INTERVAL_CHOICES = [
    (7, 'Weekly'), (14, 'Bi-weekly'), (30, 'Monthly'),
    (60, 'Every 2 months'), (90, 'Quarterly'), (365, 'Annually'),
]

# Shared by Invoice.days_overdue and Step 5's view-layer queries (invoice_list's
# ?overdue=true filter, invoice_summary, invoice_aging_report) that need the
# identical "is this invoice even eligible to be overdue" rule at the database
# level rather than re-deriving it in Python per row. Single source of truth,
# per STANDARDS.md — extracted here rather than left duplicated inline in
# views.py.
NON_OVERDUE_STATUSES = ('paid', 'cancelled', 'refunded', 'draft', 'created', 'bad_debt')

# Display symbols for the PDF templates (Step 7) — not exhaustive, since
# ExchangeRateSnapshot.rates_to_usd can hold any currency the upstream API
# returns, not just these four. Falls back to the bare currency code for
# anything not listed here. Same short list already used frontend-side
# (frontend/src/pages/clientHelpers.js's CURRENCY_OPTIONS, v1's
# getCurrencySymbol in v1-reference/frontend/src/pages/Invoices.jsx) —
# kept in sync deliberately, not redesigned independently.
CURRENCY_SYMBOLS = {'USD': '$', 'EUR': '€', 'GBP': '£', 'PKR': 'Rs. '}


class Invoice(models.Model):
    """
    6-question framework:
    1. Mutable? Yes — the most actively-updated table in this module.
    2. Soft deleted? No — cancelled/refunded/bad_debt are real terminal
       statuses, not soft-delete. Hard delete is only permitted pre-Sent,
       enforced at the view layer (Step 5), not here.
    3. Audit trail? Every status transition and payment action emits an
       event via core.events (handlers wired up in a later step).
    4. Indexed? `(user, status)`, `(user, due_date)`, `(status, due_date)`,
       `next_recurring_date`, `view_token` (implicit via unique=True),
       `(user, invoice_number)` (implicit via unique_together — see the
       real bug note below).
    5. Encrypted? No.
    6. Cascade behavior? CASCADE from User; SET_NULL from Client, from
       InvoiceDesign, and from ExchangeRateSnapshot; self-referential
       `parent_invoice` is SET_NULL.

    **A real bug found while writing this step's own tests, not carried
    forward from v1 on faith**: v1's `invoice_number` was a bare
    `unique=True` CharField — globally unique across every user, even
    though `generate_invoice_number()` only ever checks for collisions
    within one user's own invoices. Two different users' first invoice of
    the same year both compute the identical string `INV-2026-0001`; in
    v1's schema, whichever one actually saved first would succeed and
    every other user creating their year's first invoice would hit a
    real `IntegrityError` — a serious latent multi-tenant bug that a
    single-user manual test would never surface. Caught here specifically
    by writing the "two different users" numbering test the spec asked
    for and watching it fail against a real Postgres unique constraint,
    not by inspection. Fixed by moving the uniqueness constraint to
    `Meta.unique_together = [('user', 'invoice_number')]`, matching what
    "sequential per user per year" actually means: the same number
    string is expected to recur across different users' invoices.

    Fields intentionally NOT ported from v1, and why:
      - `template` (CharField choice) — superseded by `design` (FK to
        InvoiceDesign), the new visual design system.
      - `show_pkr_to_client` / `include_payment_methods` — not in the
        spec's Section 5 field table; these display-option concerns now
        plausibly belong inside InvoiceDesign.design_data instead of as
        Invoice columns. Not reconstructed here since nothing in the spec
        calls for them as Invoice fields.
      - `pkr_at_issue` / `pkr_at_payment` / `rate_at_issue` /
        `rate_at_payment` / `exchange_rate_gain_loss` — the whole
        PKR-specific payment-time-rate-tracking concept. Replaced by the
        single `rate_to_usd_at_issue` + `exchange_rate_snapshot` FK;
        conversions are computed live from ExchangeRateSnapshot history
        rather than stored at payment time (per the spec).
      - `autosaved_at` / `is_autosave` — not in the spec's Section 5 field
        table at all; excluded rather than carried forward on faith.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    # ── Ownership ──────────────────────────────────────────────────
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='invoices',
    )
    client = models.ForeignKey(
        Client, null=True, blank=True, on_delete=models.SET_NULL, related_name='invoices',
        help_text='Null means a one-time client (see is_one_time_client).',
    )

    # ── Identity ───────────────────────────────────────────────────
    # NOT globally unique=True — see Meta.unique_together and the class
    # docstring's "real bug found" note. Uniqueness is scoped to
    # (user, invoice_number), matching the numbering scheme's actual
    # design ("sequential per user per year" — every user's year starts
    # its own INV-YYYY-0001, so the same string is expected to recur
    # across different users).
    #
    # null=True (added in Step 5, not Step 4): a draft invoice has no
    # real invoice_number at all until invoice_finalise() assigns one —
    # confirmed by invoice_duplicate's own spec, which explicitly resets
    # invoice_number on the new draft copy it creates. Multiple drafts
    # for the same user therefore all have invoice_number=None
    # simultaneously; Postgres's unique index treats every NULL as
    # distinct from every other NULL (standard SQL semantics, verified
    # against this project's actual Postgres, not assumed), so this
    # doesn't collide with Meta.unique_together above.
    invoice_number = models.CharField(max_length=30, null=True, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='draft')
    sent_via_platform = models.BooleanField(
        default=False,
        help_text='Set only by the real /send/ action (not the manual mark-sent flip). Gates reminders only.',
    )
    design = models.ForeignKey(
        'InvoiceDesign', null=True, blank=True, on_delete=models.SET_NULL, related_name='invoices',
        help_text='Which saved visual design rendered this invoice\'s PDF.',
    )

    # Public URL token — cryptographically random, unguessable. Also a
    # valid client-portal magic-link credential (per the spec).
    view_token = models.CharField(max_length=32, unique=True, db_index=True, blank=True)

    # ── Client snapshot (immutable copy at creation time) ──────────
    client_name = models.CharField(max_length=200)
    client_email = models.EmailField()
    client_company = models.CharField(max_length=200, blank=True)
    client_address = models.TextField(blank=True)
    client_phone = models.CharField(max_length=30, blank=True)

    # ── Financials ─────────────────────────────────────────────────
    # No choices= — see module docstring.
    currency = models.CharField(max_length=3, default='USD')
    subtotal = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0'))
    tax_rate = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal('0'))
    tax_amount = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0'))
    discount_amount = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0'))
    total = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0'))
    amount_paid = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0'))
    # Added in the Step 5 review — invoice_refund had nowhere to persist
    # the refunded amount before this existed (it only appeared in the
    # emitted event's payload, not queryable from the row itself). Same
    # shape as `total`. See invoice_refund's own docstring for why this
    # is set once per invoice, not accumulated across repeated calls.
    refunded_amount = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0'))

    # Anchor-currency design — replaces v1's pkr_at_issue/rate_at_issue.
    rate_to_usd_at_issue = models.DecimalField(max_digits=10, decimal_places=6, null=True, blank=True)
    exchange_rate_snapshot = models.ForeignKey(
        ExchangeRateSnapshot, null=True, blank=True, on_delete=models.SET_NULL, related_name='invoices',
    )

    # ── Stored PDF (frozen-at-finalise artifact) ────────────────────
    pdf_url = models.URLField(
        blank=True,
        help_text='Cloudinary URL of the frozen, rendered PDF. Populated once by _finalise_invoice '
                   '(the moment an invoice leaves draft — via either the explicit Finalise action or '
                   'a Mark-as-Sent/real Send called directly on a draft) — never re-rendered '
                   'afterward even if design is later edited. NOT the real /send/ action (Step 10) — '
                   'that action was the original design intent here, but the freeze point moved '
                   'earlier once is_editable was confirmed to already forbid any edit past draft, '
                   'making a live render on every created-status GET pointless work. See DECISIONS.md.',
    )
    pdf_generated_at = models.DateTimeField(null=True, blank=True)
    # Mirrors FreelancerProfile.signature_public_id's exact pattern — the
    # Cloudinary public_id, kept alongside the delivery URL so a re-upload
    # (self-heal, or the one-time backfill for invoices frozen before this
    # field existed) can target/overwrite the exact same asset rather than
    # accumulating orphaned ones. See DECISIONS.md's Cloudinary access-mode
    # entry for why a re-upload is sometimes needed at all.
    pdf_public_id = models.CharField(max_length=200, blank=True)

    # ── Dates ──────────────────────────────────────────────────────
    # default=_today (not timezone.now, which v1 used verbatim on a
    # DateField — a real bug, ported unnoticed until Step 5's own
    # serializer tests caught it): timezone.now() returns a datetime, so
    # a freshly-created, not-yet-refreshed Invoice held a full datetime
    # in a DateField attribute in memory. Postgres silently truncated it
    # on write, so every test that round-tripped through the DB
    # (refresh_from_db) never noticed — DRF's DateField serializer is
    # strict about datetime-vs-date and raised loudly the first time
    # Step 5 serialized a just-created instance directly. See DECISIONS.md.
    issue_date = models.DateField(default=_today)
    due_date = models.DateField(null=True, blank=True)
    paid_date = models.DateField(null=True, blank=True)
    sent_at = models.DateTimeField(null=True, blank=True)
    # Added in this pass — invoice_timeline had no way to surface a real
    # "Finalised" lifecycle event (only views/reminders/payments existed).
    # Set once, in invoice_finalise (or the shared _finalise_invoice() helper
    # invoice_mark_sent calls when it finalises a still-draft invoice on the
    # way to 'sent') — never touched again, same one-time-set convention as
    # sent_at.
    finalised_at = models.DateTimeField(null=True, blank=True)

    # ── Content ────────────────────────────────────────────────────
    notes = models.TextField(blank=True)
    terms = models.TextField(blank=True)

    # ── Reminders ──────────────────────────────────────────────────
    # Defaults False (was True, ported unchanged from v1) — a brand-new
    # invoice hasn't been sent yet, so there's nothing real to remind about
    # until the freelancer actually sends it and makes a real choice (the
    # Mark-as-Sent modal's own reminders checkbox, or Step 10's /send/).
    # This is a going-forward default only — see DECISIONS.md.
    reminders_enabled = models.BooleanField(default=False)
    reminder_count = models.SmallIntegerField(default=0)
    last_reminder_sent_at = models.DateTimeField(null=True, blank=True)

    # ── Late fee ───────────────────────────────────────────────────
    late_fee_enabled = models.BooleanField(default=False)
    late_fee_rate = models.DecimalField(
        max_digits=5, decimal_places=2, default=Decimal('2.00'),
        help_text='Percentage per month charged after the due date.',
    )

    # ── Recurring ──────────────────────────────────────────────────
    is_recurring = models.BooleanField(default=False)
    recurring_interval_days = models.PositiveIntegerField(
        null=True, blank=True, choices=RECURRING_INTERVAL_CHOICES,
    )
    recurring_auto_send = models.BooleanField(default=False)
    recurring_paused = models.BooleanField(default=False)
    parent_invoice = models.ForeignKey(
        'self', null=True, blank=True, on_delete=models.SET_NULL, related_name='recurring_children',
    )
    next_recurring_date = models.DateField(null=True, blank=True)
    # Step 16 — consecutive failed generation attempts for THIS invoice
    # (the one whose next_recurring_date keeps getting checked; in
    # practice always the series root, since a generated child never
    # gets its own next_recurring_date set — see generate_recurring_invoices'
    # own docstring). Reset to 0 on a successful generation; at 3, the
    # task auto-pauses the series (recurring_paused=True) rather than
    # retrying forever.
    recurring_failure_count = models.SmallIntegerField(default=0)

    # ── Escalation ─────────────────────────────────────────────────
    escalation_required = models.BooleanField(
        default=False, help_text='Set after the final reminder is sent — prompts freelancer action.',
    )
    escalation_dismissed = models.BooleanField(
        default=False, help_text='Set when the freelancer dismisses the escalation prompt without acting.',
    )

    # ── Formal Notice (Step 17 — manual-only, never automatic) ──────
    formal_notice_sent_at = models.DateTimeField(
        null=True, blank=True,
        help_text='Set once a formal notice email is sent. Does not block a deliberate second send — '
                   'only surfaces that one already went out, same one-shot-timestamp pattern as finalised_at/sent_at.',
    )

    # ── Client options ─────────────────────────────────────────────
    is_one_time_client = models.BooleanField(
        default=False,
        help_text='If True, the client is not saved to the address book when this invoice is '
                   'finalised or sent.',
    )

    # ── Payment undo tracking ──────────────────────────────────────
    pre_payment_status = models.CharField(
        max_length=20, blank=True, default='',
        help_text='Status before the first partial payment was recorded; restored exactly when '
                   'all payments are removed (undo).',
    )

    # ── Client acknowledgment (new — spec Section 13 #1) ────────────
    client_acknowledged = models.BooleanField(default=False)
    client_acknowledged_at = models.DateTimeField(null=True, blank=True)

    # ── Audit ──────────────────────────────────────────────────────
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'invoices'
        ordering = ['-created_at']
        unique_together = [('user', 'invoice_number')]
        indexes = [
            models.Index(fields=['user', 'status']),
            models.Index(fields=['user', 'due_date']),
            models.Index(fields=['status', 'due_date']),
            models.Index(fields=['next_recurring_date']),
        ]

    def __str__(self):
        number = self.invoice_number or '(unnumbered draft)'
        return f'{number} — {self.client_name} [{self.status}]'

    def save(self, *args, **kwargs):
        if not self.view_token:
            self.view_token = self._generate_unique_view_token()
        super().save(*args, **kwargs)

    @classmethod
    def _generate_unique_view_token(cls):
        while True:
            token = secrets.token_urlsafe(16)
            if not cls.objects.filter(view_token=token).exists():
                return token

    # ── Computed properties ────────────────────────────────────────

    @property
    def outstanding_amount(self):
        return max(Decimal('0'), self.total - self.amount_paid)

    @property
    def days_overdue(self):
        """
        Pure read-time property, never a stored field — this is the
        entire point of the spec's fix. A terminal or not-yet-sent
        status is never "overdue" by definition.
        """
        if self.status in NON_OVERDUE_STATUSES:
            return 0
        if not self.due_date:
            return 0
        delta = (timezone.now().date() - self.due_date).days
        return max(0, delta)

    @property
    def late_fee_amount(self):
        if not self.late_fee_enabled:
            return Decimal('0')
        if self.days_overdue <= 0:
            return Decimal('0')
        months_overdue = Decimal(str(self.days_overdue)) / Decimal('30')
        fee = self.total * self.late_fee_rate / 100 * months_overdue
        return fee.quantize(Decimal('0.01'))

    @property
    def is_editable(self):
        """Only draft invoices can be edited. Ported from v1 — not in the spec's field table (it's a property, not a column) but real, correct, unchanged logic worth keeping."""
        return self.status == 'draft'

    # ── PDF template properties (Step 7 — data-wiring only) ─────────

    @property
    def currency_symbol(self):
        """`{{ invoice.currency_symbol }}` in the PDF templates. See CURRENCY_SYMBOLS above."""
        return CURRENCY_SYMBOLS.get(self.currency, self.currency + ' ')

    @property
    def payment_page_url(self):
        """
        The public "pay online" URL the PDF's QR code should encode —
        same construction v1's get_payment_page_url() used
        (v1-reference/apps/invoices/pdf_generator.py), just as a property
        instead of a free function so the templates can reference it
        directly. The actual QR *image* is intentionally NOT generated
        here — that image-generation call is Step 7b's job, once the real
        render endpoint exists; this only computes the URL the image
        would encode. Templates should treat the QR `<img>` itself as
        conditional on a `qr_code_data_uri` context variable Step 7b will
        supply (there's nothing to compute that image from yet).
        """
        return f'{settings.FRONTEND_URL}/pay/{self.view_token}'

    @property
    def portal_view_url(self):
        """
        The real, live-rendered HTML view of this invoice (Step 12) — a
        direct Django-served endpoint with no React wrapper (see
        apps/invoices/views_portal.py's own docstring: clicking an
        invoice in the portal list is a real browser navigation to this
        URL, not a route the frontend reimplements). Backend's own
        public URL (BACKEND_URL), not FRONTEND_URL — unlike
        payment_page_url above, this page IS served directly by Django,
        not the React app.
        """
        return f'{settings.BACKEND_URL}/api/invoices/portal/view/{self.view_token}/'

    @property
    def client_currency_conversion(self):
        """
        Backs the PDF's "≈ {symbol}{converted_total} at rate {rate}" line
        — the freelancer's own informational cross-check of what this
        invoice is worth in their client's preferred currency. Frozen at
        issue time (rate_to_usd_at_issue + exchange_rate_snapshot), not a
        live conversion — consistent with this model's anchor-currency
        design elsewhere (capture_issue_rate(), update_paid_status()).

        Returns None — meaning the template shows no conversion line at
        all — in every case where there's genuinely nothing correct to
        show, rather than guessing:
          - `client` is null (a one-time client). Invoice has no
            client-currency snapshot field at all (only client_name/
            client_email/client_company/client_address/client_phone are
            snapshotted), so there is truly no currency info to convert
            to. Documented in DECISIONS.md rather than inventing one.
          - The client's currency matches the invoice's own currency —
            never show "≈ $100 at rate 1.0".
          - No exchange_rate_snapshot is attached to this invoice. Real,
            found gap, recorded in DECISIONS.md: capture_issue_rate()
            (Step 5) returns early for a USD invoice (USD is the anchor
            currency, rate_to_usd_at_issue=1) WITHOUT setting
            exchange_rate_snapshot, since converting USD-to-USD needs no
            snapshot — but that means a USD invoice has no snapshot to
            source a *different* currency's rate from either, so this
            property can never show a conversion line for a USD invoice,
            even when the client's currency differs. Not fixed here —
            capture_issue_rate() is Step 5/6 lifecycle code, out of this
            step's data-wiring scope.
          - The client's currency isn't a key in that snapshot's
            rates_to_usd (e.g. an obscure currency the upstream fetch
            didn't include that day).
        """
        if not self.client:
            return None
        client_currency = self.client.default_currency
        if client_currency == self.currency:
            return None
        if self.rate_to_usd_at_issue is None or not self.exchange_rate_snapshot:
            return None
        client_rate_to_usd = self.exchange_rate_snapshot.rates_to_usd.get(client_currency)
        if not client_rate_to_usd:
            return None
        rate = (self.rate_to_usd_at_issue / Decimal(str(client_rate_to_usd))).quantize(Decimal('0.01'))
        converted_total = (self.total * rate).quantize(Decimal('0.01'))
        return {
            'currency': client_currency,
            'symbol': CURRENCY_SYMBOLS.get(client_currency, client_currency + ' '),
            'converted_total': converted_total,
            'rate': rate,
        }

    # ── Class methods ──────────────────────────────────────────────

    @classmethod
    def generate_invoice_number(cls, user):
        """
        Generates INV-YYYY-NNNN, sequential per user per year. Ported
        directly from v1 (v1-reference/apps/invoices/models.py lines
        347-360) — logic unchanged.

        Known, pre-existing characteristic carried over from v1, not
        fixed here: two concurrent calls for the SAME user in the SAME
        year could both read the same "last" number before either saves,
        producing a duplicate — invoice_number's unique=True constraint
        turns that into an IntegrityError rather than silent corruption,
        but doesn't prevent the race. Fixing this (e.g. select_for_update
        on a per-user/year counter row) is a call-site concern for
        whichever view actually creates invoices (Step 5) — there is no
        call site to wrap yet in this models-only step.
        """
        year = timezone.now().year
        prefix = f'INV-{year}-'
        last = cls.objects.filter(
            user=user, invoice_number__startswith=prefix,
        ).order_by('-invoice_number').first()
        if last:
            try:
                next_num = int(last.invoice_number.split('-')[-1]) + 1
            except ValueError:
                next_num = 1
        else:
            next_num = 1
        return f'{prefix}{str(next_num).zfill(4)}'

    def get_recurring_root(self):
        """
        Walks parent_invoice back to the invoice with no parent — the
        series' single source of truth for recurring_interval_days/
        recurring_auto_send/design (Step 16's own design decision: series
        settings are read live from the root at generation time, never
        copied/frozen onto each generated child). A root invoice
        (parent_invoice is None) returns itself. Bounded by construction —
        parent_invoice is only ever set once, at creation, to an
        already-existing invoice, so a cycle is not reachable through
        normal use of this field.
        """
        node = self
        while node.parent_invoice_id:
            node = node.parent_invoice
        return node

    # ── Business logic ─────────────────────────────────────────────

    def recalculate_totals(self):
        """
        Recalculates subtotal, tax, and total from line items. Ported
        directly from v1 (lines 364-372) — no field-name changes needed,
        since none of the fields this touches (subtotal/tax_rate/
        tax_amount/discount_amount/total) changed shape from v1.
        """
        item_total = sum((item.total for item in self.items.all()), Decimal('0')) if self.pk else Decimal('0')
        if item_total > 0:
            self.subtotal = item_total
        self.tax_amount = (self.subtotal * self.tax_rate / 100).quantize(Decimal('0.01'))
        self.total = (self.subtotal + self.tax_amount - self.discount_amount).quantize(Decimal('0.01'))
        if self.total < Decimal('0'):
            self.total = Decimal('0')

    def capture_issue_rate(self):
        """
        Stores the USD exchange rate (and which snapshot it came from) at
        issue time. Anchor-currency replacement for v1's capture_issue_rate()
        (lines 374-388), which stored a PKR amount + PKR-specific rate and
        called ExchangeRateSnapshot.get_rate() — a method that never
        existed on apps.payments.ExchangeRateSnapshot in v2 (verified
        directly against apps/payments/models.py). Looks up rates_to_usd
        directly instead.

        Real, found-and-fixed gap (Step 7b, see DECISIONS.md): this used to
        return immediately for a USD invoice, setting rate_to_usd_at_issue=1
        but leaving exchange_rate_snapshot unset — correct for USD's OWN
        rate (1 USD is always worth 1 USD, no lookup needed), but it meant
        a USD invoice had no snapshot attached at all, so
        client_currency_conversion could never source a *different*
        currency's rate for it either, even when the client's own
        default_currency genuinely differed. Fixed by still attaching
        whatever snapshot is available — rates_to_usd['USD'] is always
        explicitly 1.0 in every real snapshot (apps/payments/tasks.py's
        daily fetch sets it explicitly, never left to the upstream API's
        own USD entry alone), so this doesn't change rate_to_usd_at_issue's
        value, only which snapshot row backs it.
        """
        snapshot = (
            ExchangeRateSnapshot.objects.filter(date=timezone.now().date()).first()
            or ExchangeRateSnapshot.objects.order_by('-date').first()
        )
        if self.currency == 'USD':
            self.rate_to_usd_at_issue = Decimal('1')
            self.exchange_rate_snapshot = snapshot
            return
        if snapshot is None:
            return
        rate = snapshot.rates_to_usd.get(self.currency)
        if rate is None:
            return
        self.rate_to_usd_at_issue = Decimal(str(rate))
        self.exchange_rate_snapshot = snapshot

    def update_paid_status(self):
        """
        Called after each partial payment change. Updates amount_paid and
        status. Ported from v1 (lines 406-458) with the spec's core fix:
        never writes the literal string 'overdue' into status, under any
        code path.

        What changed from v1, specifically:
          - `_RESTORABLE_STATUSES` no longer includes 'overdue' (see its
            own comment above) — this is the actual fix; every other
            branch below is structurally identical to v1.
          - The `total_paid >= self.total` ("paid") branch no longer calls
            `self._capture_payment_rate()` — that method, and the
            pkr_at_payment/rate_at_payment fields it wrote, are dropped
            entirely per the spec (anchor-currency conversions are
            computed live from ExchangeRateSnapshot history, never stored
            at payment time). `update_fields` no longer lists those two
            columns for the same reason.
          - The `total_paid <= 0` ("undo") branch no longer resets
            pkr_at_payment/rate_at_payment (same reason — the columns
            don't exist).
          - Every "never flip a terminal status" guard below also
            excludes 'refunded' — a status that didn't exist in v1 at
            all (v1's guards only ever named 'cancelled'/'bad_debt',
            since those were its only two terminal statuses). This isn't
            a behavior change from v1; it's extending the same guard
            principle to a genuinely new terminal status the spec adds,
            so a payment add/remove cycle can't silently flip a refunded
            invoice back to 'paid' or 'partially_paid'.
        """
        total_paid = self.partial_payments.aggregate(s=models.Sum('amount'))['s'] or Decimal('0')
        self.amount_paid = total_paid

        update_fields = ['amount_paid', 'status', 'paid_date', 'pre_payment_status']

        if total_paid <= Decimal('0'):
            # All payments removed — restore to the last meaningful status.
            # Leave cancelled / bad_debt / refunded / draft as-is.
            if self.status not in ('cancelled', 'bad_debt', 'refunded', 'draft'):
                if self.pre_payment_status in _RESTORABLE_STATUSES:
                    self.status = self.pre_payment_status
                else:
                    has_views = InvoiceViewEvent.objects.filter(invoice=self).exists()
                    if self.sent_at:
                        self.status = 'viewed' if has_views else 'sent'
                    else:
                        self.status = 'created'
                self.pre_payment_status = ''
            self.paid_date = None

        elif total_paid >= self.total:
            # Guard: never flip cancelled/bad_debt/refunded to paid.
            if self.status not in ('cancelled', 'bad_debt', 'refunded'):
                self.status = 'paid'
                self.pre_payment_status = ''
                last_pp = self.partial_payments.order_by('-recorded_at').first()
                self.paid_date = last_pp.payment_date if last_pp.payment_date else last_pp.recorded_at.date()

        else:
            # Guard: never flip cancelled/bad_debt/refunded to partially_paid.
            if self.status not in ('cancelled', 'bad_debt', 'refunded'):
                if self.status in _RESTORABLE_STATUSES and not self.pre_payment_status:
                    self.pre_payment_status = self.status
                if self.status in ('sent', 'viewed') and not self.sent_at:
                    self.sent_at = timezone.now()
                    update_fields.append('sent_at')
                self.status = 'partially_paid'
                self.paid_date = None

        self.save(update_fields=update_fields)


# ══════════════════════════════════════════════════════════════════
# INVOICE ITEM
# ══════════════════════════════════════════════════════════════════

class InvoiceItem(models.Model):
    """
    Ported directly from v1 — no changes.

    6-question framework:
    1. Mutable? Yes — line items are edited while an invoice is a draft.
    2. Soft deleted? No — hard delete; a removed line item has no
       independent record-keeping value.
    3. Audit trail? No dedicated rows — covered by the parent Invoice's
       own status-transition events, not per-line-item.
    4. Indexed? None beyond the implicit FK index — always queried
       scoped to one invoice via `sort_order`.
    5. Encrypted? No.
    6. Cascade behavior? CASCADE from Invoice — a line item has no
       meaning independent of its invoice.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    invoice = models.ForeignKey(Invoice, on_delete=models.CASCADE, related_name='items')
    description = models.CharField(max_length=300)
    quantity = models.DecimalField(max_digits=8, decimal_places=2)
    unit_price = models.DecimalField(max_digits=10, decimal_places=2)
    total = models.DecimalField(max_digits=12, decimal_places=2)
    sort_order = models.SmallIntegerField(default=1)

    class Meta:
        db_table = 'invoice_items'
        ordering = ['sort_order']

    def __str__(self):
        return f'{self.description} — {self.invoice.invoice_number}'

    def save(self, *args, **kwargs):
        self.total = (self.quantity * self.unit_price).quantize(Decimal('0.01'))
        super().save(*args, **kwargs)


# ══════════════════════════════════════════════════════════════════
# INVOICE PARTIAL PAYMENT
# ══════════════════════════════════════════════════════════════════

class InvoicePartialPayment(models.Model):
    """
    6-question framework:
    1. Mutable? No — append-only; recording/removing a payment creates
       or deletes a row, never edits amount/date in place (matches v1).
    2. Soft deleted? No — deletion is the real "undo" mechanism (see
       Invoice.update_paid_status()'s pre_payment_status restore path).
    3. Audit trail? Payment record/undo emits events at the view layer
       (Step 5) — this table is itself the detailed record.
    4. Indexed? None beyond the implicit FK index — always queried
       scoped to one invoice.
    5. Encrypted? No.
    6. Cascade behavior? CASCADE from Invoice.

    `payment` (FK to payments.Payment, per the spec — "field ready for
    Module 3") is deliberately NOT included yet: apps.payments has no
    Payment model as of this step (verified directly against
    apps/payments/models.py, which only defines ExchangeRateSnapshot), and
    Django's system checks (fields.E300/E307, confirmed empirically before
    writing this file) reject a ForeignKey to a model that doesn't exist
    at all — this isn't a lazy/deferred reference Django tolerates. Adding
    this FK is a real migration for whichever step actually builds
    apps.payments.Payment (Module 3), not something that can be
    pre-declared here. See DECISIONS.md.
    """
    SOURCE_CHOICES = [
        ('payoneer', 'Payoneer'), ('wise', 'Wise'),
        ('jazzcash', 'JazzCash'), ('easypaisa', 'Easypaisa'),
        ('bank', 'Bank Transfer'), ('cash', 'Cash'), ('other', 'Other'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    invoice = models.ForeignKey(Invoice, on_delete=models.CASCADE, related_name='partial_payments')
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    currency = models.CharField(max_length=3, default='USD')
    # Anchor-currency design — replaces v1's amount_pkr/exchange_rate.
    rate_to_usd = models.DecimalField(
        max_digits=10, decimal_places=6, null=True, blank=True,
        help_text='Value of 1 unit of `currency` in USD, captured at record time.',
    )
    source = models.CharField(max_length=20, choices=SOURCE_CHOICES, default='other')
    payment_date = models.DateField()
    notes = models.CharField(max_length=300, blank=True)
    recorded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'invoice_partial_payments'
        ordering = ['payment_date']

    def __str__(self):
        return f'{self.currency} {self.amount} on {self.invoice.invoice_number}'


# ══════════════════════════════════════════════════════════════════
# INVOICE REMINDER
# ══════════════════════════════════════════════════════════════════

class InvoiceReminder(models.Model):
    """
    Ported directly from v1 — no changes.

    6-question framework:
    1. Mutable? No — append-only, one row per reminder actually sent.
    2. Soft deleted? No.
    3. Audit trail? The row itself is the record.
    4. Indexed? Implicit via unique_together(invoice, reminder_number).
    5. Encrypted? No.
    6. Cascade behavior? CASCADE from Invoice.
    """
    TEMPLATE_CHOICES = [
        ('reminder_1', 'Polite (Day 3)'),
        ('reminder_2', 'Firm (Day 7)'),
        ('reminder_3', 'Formal (Day 14)'),
        ('reminder_4', 'Final (Day 30)'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    invoice = models.ForeignKey(Invoice, on_delete=models.CASCADE, related_name='reminders')
    reminder_number = models.SmallIntegerField()
    template_used = models.CharField(max_length=20, choices=TEMPLATE_CHOICES)
    sent_at = models.DateTimeField(auto_now_add=True)
    delivered = models.BooleanField(default=True)
    days_overdue_at_send = models.SmallIntegerField(default=0)

    class Meta:
        db_table = 'invoice_reminders'
        ordering = ['sent_at']
        unique_together = [('invoice', 'reminder_number')]

    def __str__(self):
        return f'Reminder {self.reminder_number} on {self.invoice.invoice_number}'


# ══════════════════════════════════════════════════════════════════
# INVOICE VIEW EVENT
# ══════════════════════════════════════════════════════════════════

class InvoiceViewEvent(models.Model):
    """
    Ported directly from v1 — no changes.

    6-question framework:
    1. Mutable? No — append-only.
    2. Soft deleted? No.
    3. Audit trail? The row itself is the record.
    4. Indexed? None beyond the implicit FK index yet — worth revisiting
       if the public invoice page's view-tracking volume ever demands it.
    5. Encrypted? No.
    6. Cascade behavior? CASCADE from Invoice.

    Every write here must run through the freelancer-own-session guard
    (decisions doc Section 4) so a freelancer viewing their own sent
    invoice never counts as a client view — that guard lives at the view
    layer (Step 5+), not here.
    """
    SOURCE_CHOICES = [
        ('email_pixel', 'Email pixel'),
        ('link_click', 'Link click'),
        ('whatsapp', 'WhatsApp'),
        ('platform_view', 'Platform view page'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    invoice = models.ForeignKey(Invoice, on_delete=models.CASCADE, related_name='view_events')
    viewed_at = models.DateTimeField(auto_now_add=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.CharField(max_length=300, blank=True)
    source = models.CharField(max_length=20, choices=SOURCE_CHOICES, default='link_click')

    class Meta:
        db_table = 'invoice_view_events'
        ordering = ['-viewed_at']

    def __str__(self):
        return f'View of {self.invoice.invoice_number} at {self.viewed_at}'


# ══════════════════════════════════════════════════════════════════
# INVOICE COMMENT — new, no v1 equivalent (v1 has no messaging at all)
# ══════════════════════════════════════════════════════════════════

class InvoiceComment(models.Model):
    """
    Unified two-way message thread (portal + email-reply + in-app) per
    the spec — replaces v1's complete absence of messaging. No
    `updated_at`: comments are immutable, never edited or deleted, per
    the decisions doc — deliberately different from ClientNote, which
    IS mutable (see apps.clients.models.ClientNote and DECISIONS.md).

    6-question framework:
    1. Mutable? No, append-only, except the two `read_by_*_at` timestamps
       and `unread_reminder_sent_at` (Step 13).
    2. Soft deleted? No — permanent record by design.
    3. Audit trail? The comment row itself is the record; posting also
       emits CommentPosted (handler wiring is a later step).
    4. Indexed? `(invoice, created_at)`.
    5. Encrypted? No.
    6. Cascade behavior? CASCADE from Invoice; SET_NULL from User (a
       comment survives its author's account being anonymized).
    """
    AUTHOR_TYPE_CHOICES = [('freelancer', 'Freelancer'), ('client', 'Client')]
    SOURCE_CHOICES = [('portal', 'Portal'), ('email_reply', 'Email Reply'), ('app', 'App')]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    invoice = models.ForeignKey(Invoice, on_delete=models.CASCADE, related_name='comments')
    author_type = models.CharField(max_length=20, choices=AUTHOR_TYPE_CHOICES)
    author_user = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name='invoice_comments',
        help_text="Set when author_type='freelancer'.",
    )
    # Snapshot fields, set when author_type='client' — no real account to FK to.
    client_name = models.CharField(max_length=200, blank=True)
    client_email = models.EmailField(blank=True)
    source = models.CharField(max_length=20, choices=SOURCE_CHOICES, default='app')
    body_text = models.TextField()
    body_html = models.TextField(blank=True, help_text="Only populated for source='email_reply'.")
    attachment_url = models.URLField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    read_by_freelancer_at = models.DateTimeField(null=True, blank=True)
    read_by_client_at = models.DateTimeField(null=True, blank=True)
    # Step 13 — the "already notified" marker the unread-after-1hr batched
    # email task needs: without this, a comment still unread on the NEXT
    # task run (every 15 min) would generate a second email, then a third,
    # etc., violating the spec's "no further reminders" rule. Set once,
    # the moment this comment is included in a batched reminder email —
    # never cleared, never re-checked after that (matches read_by_*_at's
    # own append-only spirit: this row is otherwise fully immutable).
    unread_reminder_sent_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = 'invoice_comments'
        ordering = ['created_at']
        indexes = [
            models.Index(fields=['invoice', 'created_at']),
        ]

    def __str__(self):
        who = self.author_user.email if self.author_user else (self.client_name or self.client_email or 'client')
        return f'Comment by {who} on {self.invoice.invoice_number}'


# ══════════════════════════════════════════════════════════════════
# PAYMENT CLAIM
# ══════════════════════════════════════════════════════════════════

class PaymentClaim(models.Model):
    """
    Ported directly from v1, plus one new field this step adds:
    `review_note` (v1 had no equivalent — confirm/reject was a bare
    status flip with nowhere to record why a claim was rejected). Kept
    as a separate, structured flow per the decisions doc, not merged
    into InvoiceComment.

    6-question framework:
    1. Mutable? Yes — `status`/`reviewed_at`/`review_note` change once
       when the freelancer confirms or rejects the claim.
    2. Soft deleted? No.
    3. Audit trail? Confirm/reject emits events at the view layer
       (Step 14); this row is itself the detailed record.
    4. Indexed? None beyond the implicit FK index yet.
    5. Encrypted? No.
    6. Cascade behavior? CASCADE from Invoice.
    """
    STATUS_CHOICES = [
        ('pending', 'Pending freelancer review'),
        ('confirmed', 'Confirmed — payment recorded'),
        ('rejected', 'Rejected — payment not found'),
    ]
    SOURCE_CHOICES = [
        ('payoneer', 'Payoneer'), ('wise', 'Wise'),
        ('jazzcash', 'JazzCash'), ('easypaisa', 'Easypaisa'),
        ('bank', 'Bank Transfer'), ('cash', 'Cash'), ('other', 'Other'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    invoice = models.ForeignKey(Invoice, on_delete=models.CASCADE, related_name='payment_claims')
    client_email = models.EmailField()
    client_name = models.CharField(max_length=200, blank=True)
    amount_claimed = models.DecimalField(max_digits=12, decimal_places=2)
    currency = models.CharField(max_length=3, default='USD')
    payment_source = models.CharField(max_length=20, choices=SOURCE_CHOICES, default='other')
    payment_date = models.DateField()
    client_note = models.TextField(blank=True, help_text='Message from the client about the payment.')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    submitted_at = models.DateTimeField(auto_now_add=True)
    reviewed_at = models.DateTimeField(null=True, blank=True)
    review_note = models.TextField(
        blank=True,
        help_text='Freelancer note on confirm/reject — required on reject (why the claim was not accepted), optional on confirm.',
    )

    class Meta:
        db_table = 'payment_claims'
        ordering = ['-submitted_at']

    def __str__(self):
        return f'Claim: {self.client_email} paid {self.amount_claimed} for {self.invoice.invoice_number}'


# ══════════════════════════════════════════════════════════════════
# INVOICE DESIGN — new, no v1 equivalent (v1's pdf_generator.py is
# reportlab-based, not a data model)
# ══════════════════════════════════════════════════════════════════

class InvoiceDesign(models.Model):
    """
    The visual PDF/portal template system (decisions doc Section 9/10).
    Genuinely new — v1's PDF generation was code (reportlab), not
    user-editable data.

    6-question framework:
    1. Mutable? Yes — edited via the design editor (a later step).
    2. Soft deleted? No — hard delete; Invoice.design is SET_NULL, so a
       deleted design never breaks an invoice that already rendered
       against it (the frozen pdf_url survives regardless).
    3. Audit trail? No dedicated events — a design edit isn't a
       security/finance-relevant action the way an invoice status
       transition is.
    4. Indexed? None beyond the implicit FK index yet.
    5. Encrypted? No.
    6. Cascade behavior? CASCADE from User.

    `is_default` enforcement (one per user) ported structurally from
    v1's InvoiceTemplate.save() (lines 708-714) — same pattern, applied
    to a new model.
    """
    BASE_TEMPLATE_CHOICES = [
        ('professional', 'Professional'), ('minimal', 'Minimal'), ('modern', 'Modern'),
    ]
    SOURCE_CHOICES = [
        ('builtin', 'Built-in'), ('custom', 'Custom'), ('ai_seeded', 'AI-seeded'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='invoice_designs')
    name = models.CharField(max_length=100)
    base_template = models.CharField(
        max_length=20, choices=BASE_TEMPLATE_CHOICES,
        help_text='Which of the 3 built templates this started from, even for custom designs.',
    )
    source = models.CharField(max_length=20, choices=SOURCE_CHOICES, default='builtin')
    color_variant = models.CharField(max_length=50, blank=True, help_text='Curated palette key — builtin path only.')
    design_data = models.JSONField(
        default=dict, blank=True,
        help_text='Element positions/styles/data-bindings — the single structure feeding editor '
                   'preview, the portal page, and WeasyPrint rendering.',
    )
    is_default = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'invoice_designs'
        ordering = ['-is_default', 'name']

    def __str__(self):
        return f'{self.name} ({self.user})'

    def save(self, *args, **kwargs):
        if self.is_default:
            InvoiceDesign.objects.filter(user=self.user, is_default=True).exclude(pk=self.pk).update(is_default=False)
        super().save(*args, **kwargs)


# ══════════════════════════════════════════════════════════════════
# INVOICE PRESET — renamed from v1's InvoiceTemplate, per the spec's
# explicit naming decision (avoids colliding with InvoiceDesign)
# ══════════════════════════════════════════════════════════════════

class InvoicePreset(models.Model):
    """
    "Quick-create defaults" — unrelated to visual design (that's
    InvoiceDesign). Ported from v1's InvoiceTemplate (lines 653-714),
    renamed only. Per the spec's explicit field list for this model,
    `template`/`show_pkr_to_client`/`include_payment_methods` are
    dropped — not mentioned there, same reasoning as Invoice's own
    dropped fields above.

    6-question framework:
    1. Mutable? Yes.
    2. Soft deleted? No — hard delete; has no downstream financial
       record referencing it.
    3. Audit trail? No — a personal productivity shortcut, not a
       security/finance action.
    4. Indexed? None beyond the implicit FK indexes.
    5. Encrypted? No.
    6. Cascade behavior? CASCADE from User; SET_NULL from Client.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='invoice_presets')
    name = models.CharField(max_length=100, help_text='Friendly name, e.g. "Web Dev Project".')
    description = models.CharField(max_length=300, blank=True)

    include_client = models.BooleanField(default=False)
    client = models.ForeignKey(
        Client, null=True, blank=True, on_delete=models.SET_NULL, related_name='invoice_presets',
    )
    client_name = models.CharField(max_length=200, blank=True)
    client_email = models.EmailField(blank=True)
    client_company = models.CharField(max_length=200, blank=True)

    # No choices= — same reasoning as Invoice.currency.
    currency = models.CharField(max_length=3, default='USD')
    tax_rate = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal('0'))
    discount_amount = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0'))
    payment_terms = models.PositiveIntegerField(default=30, help_text='Default days until due date.')

    notes = models.TextField(blank=True)
    terms = models.TextField(blank=True)

    late_fee_enabled = models.BooleanField(default=False)
    late_fee_rate = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal('2.00'))

    is_default = models.BooleanField(default=False, help_text='If True, new invoices start from this preset.')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'invoice_presets'
        ordering = ['-is_default', 'name']

    def __str__(self):
        return f'{self.name} ({self.user})'

    def save(self, *args, **kwargs):
        if self.is_default:
            InvoicePreset.objects.filter(user=self.user, is_default=True).exclude(pk=self.pk).update(is_default=False)
        super().save(*args, **kwargs)


class InvoicePresetItem(models.Model):
    """
    Line items belonging to an InvoicePreset. Ported directly from v1's
    InvoiceTemplateItem, renamed FK target only.

    6-question framework: identical to InvoiceItem's — mutable, no
    soft-delete, no dedicated audit trail, no extra indexes, not
    encrypted, CASCADE from its parent (InvoicePreset here).
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    preset = models.ForeignKey(InvoicePreset, on_delete=models.CASCADE, related_name='items')
    description = models.CharField(max_length=300)
    quantity = models.DecimalField(max_digits=8, decimal_places=2, default=Decimal('1'))
    unit_price = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0'))
    sort_order = models.SmallIntegerField(default=1)

    class Meta:
        db_table = 'invoice_preset_items'
        ordering = ['sort_order']

    def __str__(self):
        return f'{self.description} — {self.preset.name}'
