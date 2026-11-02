# apps/proposals/models.py
"""
Proposals (02 November 2026): the data model. A freelancer pastes a client's
job post, gets an AI-written draft, edits it, prices it, sends it to the client
(part 2) and the client accepts or declines it on a public page.

Field names and the money arithmetic deliberately MIRROR apps.invoices
(Invoice / InvoiceItem: client_name/client_email/client_company, currency,
subtotal/tax_rate/tax_amount/discount_amount/total, notes-as-payment_terms,
view_token, item description/quantity/unit_price/total/sort_order) so part 2's
"convert an accepted proposal to a draft invoice" is a lossless field copy.

Only fields that code actually reads or writes exist. Part 2 added the ones its
endpoints write: proposal_number, sent_via, the sent/viewed/responded/withdrawn
timestamps, the client's answer (message, IP, user agent) and converted_invoice.

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

# draft -> sent -> viewed -> accepted | declined, and sent/viewed -> withdrawn.
# `expired` is NOT a status: it is computed on read (Proposal.is_expired).
STATUS_CHOICES = [
    ('draft', 'Draft'),
    ('sent', 'Sent'),
    ('viewed', 'Viewed'),
    ('accepted', 'Accepted'),
    ('declined', 'Declined'),
    ('withdrawn', 'Withdrawn'),
]

SENT_VIA_CHOICES = [
    ('email', 'Email'),
    ('link', 'Link'),
]

# Statuses in which a proposal is waiting on the client, so a passed
# valid_until means it has expired (see Proposal.is_expired).
AWAITING_RESPONSE_STATUSES = ('sent', 'viewed')


# The largest value any money column here can store (max_digits=12, decimal_places=2).
# ONE constant: the serializer's amount validation and every message that names the
# limit read it, so the limit and the columns cannot drift apart.
MAX_AMOUNT = Decimal('9999999999.99')


def _today():
    """Pakistan date: USE_TZ=False and TIME_ZONE='Asia/Karachi', so naive now() IS Pakistan time."""
    return timezone.now().date()


class Proposal(models.Model):
    """
    6-question framework:
    1. Mutable? Content only while `draft`. A sent proposal is exactly what the
       client saw, so every edit/regenerate/delete endpoint refuses anything but
       a draft (403), enforced server-side. After the draft stage only the
       lifecycle fields change (status, the timestamps, the client's answer,
       converted_invoice, and `client` when a conversion saves the client):
       sent/viewed/answered/withdrawn proposals are records.
    2. Soft deleted? No. Only drafts can be deleted (hard delete — a draft has
       no record-keeping value). A proposal that was sent or answered is a
       record: it is withdrawn, never deleted.
    3. Audit trail? Yes, every transition, via core.AuditLog (ids, tone, model,
       method — never the text): proposal_created / _deleted / _ai_generated /
       _sent / _viewed / _accepted / _declined / _withdrawn / _converted,
       written by the handlers in notifications.py regardless of any
       notification toggle.
    4. Indexed? (user, status), (user, created_at), the unique indexed
       view_token, unique (user, proposal_number) and the implicit FK indexes.
       Everything is queried scoped to one user, except the public page, which
       looks up by view_token.
    5. Encrypted? No — business text and prices, no credentials or PII beyond
       the client contact details Invoice already stores in the clear.
       `response_ip` / `response_user_agent` are the CLIENT's own data, stored
       only when they accept or decline (evidence of who answered), never on a
       plain view, and never returned by any API.
    6. Cascade behavior? `user` CASCADE, same as Invoice.user (a proposal has
       no meaning once its owner row is gone; accounts are anonymised, never
       hard-deleted, so this does not fire in practice). `client` SET_NULL:
       the client_* snapshot fields keep the proposal readable if the CRM
       record is ever removed. `converted_invoice` SET_NULL: deleting the draft
       invoice a conversion made leaves the accepted proposal intact (and
       lets it be converted again); an invoice never owns its proposal.

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

    # ── Sending / the client's answer (part 2) ─────────────────────
    # Assigned at send, AFTER the email succeeded, under the User-row lock.
    # NULL while a draft (NULLs are distinct in PostgreSQL, so drafts never
    # collide on the unique constraint).
    proposal_number = models.CharField(max_length=30, null=True, blank=True)
    sent_via = models.CharField(max_length=10, blank=True, choices=SENT_VIA_CHOICES)
    sent_at = models.DateTimeField(null=True, blank=True)
    viewed_at = models.DateTimeField(null=True, blank=True, help_text='The FIRST client view only.')
    responded_at = models.DateTimeField(null=True, blank=True)
    withdrawn_at = models.DateTimeField(null=True, blank=True)
    response_message = models.TextField(blank=True, help_text='The client\'s optional note. Plain text, at most 1000 characters.')
    response_ip = models.GenericIPAddressField(null=True, blank=True)
    response_user_agent = models.CharField(max_length=500, blank=True)
    converted_invoice = models.ForeignKey(
        'invoices.Invoice', null=True, blank=True, on_delete=models.SET_NULL, related_name='source_proposals',
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'proposals'
        ordering = ['-created_at']
        unique_together = [('user', 'proposal_number')]
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

    @classmethod
    def generate_proposal_number(cls, user):
        """
        PRO-YYYY-NNNN, sequential per user per year — Invoice.generate_invoice_number's
        twin. MUST be called while holding the User-row lock
        (`User.objects.select_for_update().get(pk=user.pk)`) inside the same
        transaction that saves the number: two concurrent calls for one user
        would otherwise read the same "last" number, and the unique
        (user, proposal_number) constraint would turn the race into an
        IntegrityError instead of preventing it (see _finalise_invoice's long
        docstring for the invoice version of this exact problem).
        """
        year = timezone.now().year
        prefix = f'PRO-{year}-'
        last = cls.objects.filter(
            user=user, proposal_number__startswith=prefix,
        ).order_by('-proposal_number').first()
        if last:
            try:
                next_num = int(last.proposal_number.split('-')[-1]) + 1
            except ValueError:
                next_num = 1
        else:
            next_num = 1
        return f'{prefix}{str(next_num).zfill(4)}'

    # ── Computed properties (never stored) ─────────────────────────

    @property
    def public_url(self):
        """The client-facing link (the frontend's own /proposal/<token> page), same style as Invoice.portal_view_url."""
        return f'{settings.FRONTEND_URL}/proposal/{self.view_token}'

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
        self.tax_amount, self.total = self.compute_amounts(self.subtotal, self.tax_rate, self.discount_amount)

    @staticmethod
    def compute_amounts(subtotal, tax_rate, discount_amount):
        """
        The ONE copy of the money arithmetic: returns (tax_amount, total). Tax is
        computed on the subtotal BEFORE the discount, the discount is subtracted
        last, both are quantised to cents, and the total is clamped at zero —
        identical to Invoice.recalculate_totals(). recalculate_totals() and the
        serializer's amount validation both call this, so the limit check can
        never disagree with what is actually stored; the drift test pins it to
        the invoice.
        """
        tax_amount = (subtotal * tax_rate / 100).quantize(Decimal('0.01'))
        total = (subtotal + tax_amount - discount_amount).quantize(Decimal('0.01'))
        return tax_amount, max(total, Decimal('0'))


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
