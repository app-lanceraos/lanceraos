# apps/proposals/models.py
"""
Proposals, part 1 (02 November 2026): the data model. A freelancer pastes a
client's job post, gets an AI-written draft, edits it, prices it, and (part 2,
a later build) sends it to the client for an accept/decline answer.

Field names and the money arithmetic deliberately MIRROR apps.invoices
(Invoice / InvoiceItem: client_name/client_email/client_company, currency,
subtotal/tax_rate/tax_amount/discount_amount/total, notes-as-payment_terms,
view_token, item description/quantity/unit_price/total/sort_order) so part 2's
"convert an accepted proposal to a draft invoice" is a lossless field copy.

Only fields that code in this build actually reads or writes exist. Sending,
the public client page, accept/decline and conversion are part 2, and so are
the fields they need (sent/viewed/responded timestamps, the client's answer,
the response IP, the converted invoice, the proposal number): they are added
by the prompt whose code writes them.

`currency` is a CharField(3) with no `choices=`, same reasoning as
Invoice.currency: validation against the live exchange-rate snapshot lives in
the serializer (apps.clients.serializers.validate_currency_code).

Every text field here is PLAIN TEXT, never HTML. Consumers must display it
escaped (React does by default) and must never mark it safe.
"""
import secrets
import uuid
from decimal import Decimal

from django.conf import settings
from django.db import models
from django.utils import timezone

from apps.clients.models import Client

TONE_CHOICES = [
    ('professional', 'Professional'),
    ('friendly', 'Friendly'),
    ('technical', 'Technical'),
]

# All six are part of the model from the start because the status field is its
# core; only 'draft' is reachable in part 1 (sent/viewed/accepted/declined/
# withdrawn are written by part 2's endpoints).
STATUS_CHOICES = [
    ('draft', 'Draft'),
    ('sent', 'Sent'),
    ('viewed', 'Viewed'),
    ('accepted', 'Accepted'),
    ('declined', 'Declined'),
    ('withdrawn', 'Withdrawn'),
]

# Statuses in which a proposal is waiting on the client, so a passed
# valid_until means it has expired (see Proposal.is_expired).
AWAITING_RESPONSE_STATUSES = ('sent', 'viewed')


def _today():
    """Pakistan date: USE_TZ=False and TIME_ZONE='Asia/Karachi', so naive now() IS Pakistan time."""
    return timezone.now().date()


class Proposal(models.Model):
    """
    6-question framework:
    1. Mutable? Only while `draft`. A sent proposal is exactly what the client
       saw, so part 2 locks it; every edit/regenerate/delete endpoint here
       refuses anything but a draft (403), enforced server-side.
    2. Soft deleted? No. Only drafts can be deleted (hard delete — a draft has
       no record-keeping value). A proposal that was sent or answered is a
       record: part 2 withdraws it, it is never deleted.
    3. Audit trail? Yes, via core.AuditLog: proposal_created / proposal_deleted
       / proposal_ai_generated (ids, tone, model — never the text), written by
       the handlers in notifications.py. Part 2's lifecycle events follow.
    4. Indexed? (user, status), (user, created_at), and the unique indexed
       view_token. Everything is queried scoped to one user.
    5. Encrypted? No — business text and prices, no credentials or PII beyond
       the client contact details Invoice already stores in the clear.
    6. Cascade behavior? `user` CASCADE, same as Invoice.user (a proposal has
       no meaning once its owner row is gone; accounts are anonymised, never
       hard-deleted, so this does not fire in practice). `client` SET_NULL:
       the client_* snapshot fields keep the proposal readable if the CRM
       record is ever removed.

    `body` is the proposal text (AI-written or typed). `job_description` and
    `my_experience` are kept so a regeneration can start from them; they are
    the user's own input and the third party's job post, stored as plain text.
    `ai_*` record how the current body was produced: `ai_generated_at` is None
    for a proposal written by hand, and is NOT cleared when the user later
    edits the AI text — it says "an AI draft was the starting point".
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='proposals',
    )
    client = models.ForeignKey(
        Client, null=True, blank=True, on_delete=models.SET_NULL, related_name='proposals',
        help_text='Optional: a freelancer often pastes a job post before the client exists in their CRM.',
    )
    client_name = models.CharField(max_length=200, blank=True)
    client_email = models.EmailField(blank=True)
    client_company = models.CharField(max_length=200, blank=True)

    title = models.CharField(max_length=200)
    tone = models.CharField(max_length=12, choices=TONE_CHOICES, default='professional')
    job_description = models.TextField(blank=True)
    my_experience = models.TextField(blank=True)
    body = models.TextField(blank=True)
    ai_tips = models.JSONField(default=list, blank=True)
    ai_generated_at = models.DateTimeField(null=True, blank=True)
    ai_model = models.CharField(max_length=100, blank=True)

    currency = models.CharField(max_length=3, default='USD')
    scope_sections = models.JSONField(default=list, blank=True, help_text='Items of {"title": str, "text": str}.')
    payment_terms = models.TextField(blank=True)
    tax_rate = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal('0'))
    discount_amount = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0'))
    subtotal = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0'))
    tax_amount = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0'))
    total = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0'))
    valid_until = models.DateField(null=True, blank=True)

    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='draft')
    view_token = models.CharField(max_length=32, unique=True, db_index=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'proposals'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['user', 'status']),
            models.Index(fields=['user', 'created_at']),
        ]

    def __str__(self):
        return f'{self.title} [{self.status}]'

    def save(self, *args, **kwargs):
        if not self.view_token:
            self.view_token = self._generate_unique_view_token()
        super().save(*args, **kwargs)

    @classmethod
    def _generate_unique_view_token(cls):
        """Same unique-token approach as Invoice._generate_unique_view_token."""
        while True:
            token = secrets.token_urlsafe(16)
            if not cls.objects.filter(view_token=token).exists():
                return token

    # ── Computed properties (never stored) ─────────────────────────

    @property
    def is_editable(self):
        return self.status == 'draft'

    @property
    def is_expired(self):
        """
        Computed on read, NEVER stored (the invoice `overdue` lesson in
        CLAUDE.md: a stored derived status is a status that goes stale or
        overwrites the real one). Only a proposal still waiting on the client
        can expire; a draft has not been offered yet and an answered one is
        final.
        """
        return (
            self.status in AWAITING_RESPONSE_STATUSES
            and self.valid_until is not None
            and self.valid_until < _today()
        )

    @property
    def ai_generated(self):
        return self.ai_generated_at is not None

    @property
    def word_count(self):
        return len(self.body.split())

    # ── Business logic ─────────────────────────────────────────────

    def recalculate_totals(self):
        """
        Reproduces Invoice.recalculate_totals() exactly (same Decimal
        quantisation, tax computed on the subtotal BEFORE the discount, the
        discount subtracted last, total clamped at zero) so part 2's
        conversion to an invoice is lossless. No pure helper exists in
        apps.invoices to import (the arithmetic is a method reading
        self.items), so it is mirrored here and pinned by a drift test
        (tests/test_models.py) that builds a proposal and an invoice from the
        same numbers. Unconditional, like the invoice fix for audit finding
        INV-001: zero items always means zero totals.
        """
        item_total = sum((item.total for item in self.items.all()), Decimal('0')) if self.pk else Decimal('0')
        self.subtotal = item_total
        self.tax_amount = (self.subtotal * self.tax_rate / 100).quantize(Decimal('0.01'))
        self.total = (self.subtotal + self.tax_amount - self.discount_amount).quantize(Decimal('0.01'))
        if self.total < Decimal('0'):
            self.total = Decimal('0')


class ProposalItem(models.Model):
    """
    A priced line on a proposal. Field names and limits copied from
    InvoiceItem (`sort_order`, not `position`, so the copy is a rename-free
    field-for-field one).

    6-question framework:
    1. Mutable? Yes, while the parent proposal is a draft (the view replaces
       the whole item list on update, like invoices do).
    2. Soft deleted? No — a removed line has no record-keeping value.
    3. Audit trail? No dedicated rows; covered by the parent Proposal's events.
    4. Indexed? Only the implicit FK index — always read scoped to one proposal
       ordered by `sort_order`.
    5. Encrypted? No.
    6. Cascade behavior? CASCADE from Proposal — a line has no meaning without
       its proposal.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    proposal = models.ForeignKey(Proposal, on_delete=models.CASCADE, related_name='items')
    description = models.CharField(max_length=300)
    quantity = models.DecimalField(max_digits=8, decimal_places=2)
    unit_price = models.DecimalField(max_digits=10, decimal_places=2)
    total = models.DecimalField(max_digits=12, decimal_places=2)
    sort_order = models.SmallIntegerField(default=1)

    class Meta:
        db_table = 'proposal_items'
        ordering = ['sort_order']

    def __str__(self):
        return f'{self.description} — {self.proposal.title}'

    def save(self, *args, **kwargs):
        self.total = (self.quantity * self.unit_price).quantize(Decimal('0.01'))
        super().save(*args, **kwargs)
