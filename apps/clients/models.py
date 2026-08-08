# apps/clients/models.py
"""
Client CRM — Section 3 of INVOICES_CLIENTS_TECHNICAL_SPEC.md. Built ahead
of apps/invoices/ (which doesn't exist yet), so Client carries no FK to
Invoice at all; the future Invoice.client FK (SET_NULL) will point here.
"""
import secrets
import uuid

from django.conf import settings
from django.core.validators import RegexValidator
from django.db import models

from .scoring import compute_reliability_stats

# Reconstructed for v2 — v1's original flag-type choices weren't available
# in this session. Kept deliberately small; extend via migration if a real
# business need for finer-grained categories emerges.
FLAG_TYPE_CHOICES = [
    ('payment_risk', 'Payment Risk'),
    ('communication', 'Communication Issue'),
    ('other', 'Other'),
]


class Client(models.Model):
    """
    6-question framework:
    1. Mutable? Yes — a live CRM record, edited from the client detail page.
    2. Soft deleted? No — archived via `is_active`, not deleted. Deletion
       is a separate, explicit, invoice-preserving-by-default action
       (matching v1's `keep_invoices` choice) that belongs to a later
       prompt once apps/invoices/ exists to actually have that choice.
    3. Audit trail? Via core.events (ClientCreated/ClientArchived/
       ClientFlagged), not a bespoke log — handlers that turn those into
       core.AuditLog rows get wired up when apps/invoices/'s own
       notification integration is built.
    4. Indexed? `(user, is_active)`, `(user, email)`, `portal_token`.
    5. Encrypted? No — no CNIC/NTN-class data lives on this model.
    6. Cascade behavior? CASCADE from User (a deleted/anonymized user's
       clients have no independent meaning). The future
       Invoice.client FK is SET_NULL in the other direction (invoices
       outlive a deleted client record) — defined on Invoice, not here.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='clients',
    )
    name = models.CharField(max_length=200)
    email = models.EmailField()
    company = models.CharField(max_length=200, blank=True)
    address = models.TextField(blank=True)
    phone = models.CharField(max_length=30, blank=True)
    country = models.CharField(max_length=100, blank=True)
    # No choices= here deliberately — see the module docstring and
    # apps.clients.serializers.validate_currency_code. Validated at write
    # time against ExchangeRateSnapshot's most recent rates_to_usd keys
    # (plus 'USD', always valid even before a snapshot exists), the same
    # fix already applied to apps.payments.ExchangeRateSnapshot itself:
    # adding a currency later is a data change, never a migration.
    default_currency = models.CharField(max_length=3, default='USD')
    default_payment_terms = models.PositiveIntegerField(default=30)
    notes = models.TextField(blank=True)

    is_active = models.BooleanField(default=True, help_text='Archive flag — False means archived, not deleted.')

    is_flagged = models.BooleanField(default=False)
    flag_reason = models.TextField(blank=True)
    flag_type = models.CharField(max_length=30, choices=FLAG_TYPE_CHOICES, blank=True)
    flagged_at = models.DateTimeField(null=True, blank=True)
    # Reserved for the future reliability-score-threshold derivation
    # (INVOICES_CLIENTS_TECHNICAL_SPEC.md Section 15 #4) — field exists,
    # the logic that would actually set it doesn't fire yet. Flagging
    # today is manual-only, per the decisions doc.
    auto_flagged = models.BooleanField(default=False)

    # Persistent, non-expiring — this IS the magic-link credential for
    # "view all invoices with this freelancer," not a session token.
    # Generated on first save (see save(), below) rather than at the
    # database layer, since generation needs a uniqueness-check loop
    # against this same table.
    portal_token = models.CharField(max_length=32, unique=True, db_index=True, blank=True)

    tags = models.ManyToManyField('ClientTag', blank=True, related_name='clients')

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'clients'
        ordering = ['name']
        indexes = [
            models.Index(fields=['user', 'is_active']),
            models.Index(fields=['user', 'email']),
        ]

    def __str__(self):
        return f'{self.name} ({self.email})'

    def save(self, *args, **kwargs):
        if not self.portal_token:
            self.portal_token = self._generate_unique_portal_token()
        super().save(*args, **kwargs)

    @classmethod
    def _generate_unique_portal_token(cls):
        """Loop-checked against real collisions, mirroring v1's pattern — astronomically unlikely with 16 random bytes, but never assumed."""
        while True:
            token = secrets.token_urlsafe(16)
            if not cls.objects.filter(portal_token=token).exists():
                return token

    def _invoices_for_scoring(self):
        """
        Returns the client's invoices queryset, or None when
        apps.invoices (not yet built) hasn't added its reverse relation
        to this model yet. getattr(..., None) is what makes calling this
        safe today — client_analytics' endpoint SHAPE is final now per
        the spec, but its numbers are genuinely zero/empty (not faked)
        until Invoice.client (related_name='invoices') actually lands.
        """
        manager = getattr(self, 'invoices', None)
        return manager.all() if manager is not None else None

    @property
    def payment_stats(self):
        invoices = self._invoices_for_scoring()
        return compute_reliability_stats(invoices if invoices is not None else [])


class ClientNote(models.Model):
    """
    Structured, authored notes — distinct from Client.notes (a single
    freeform field on the client card itself). Private, never
    client-visible, unchanged in shape from v1.

    6-question framework:
    1. Mutable? Yes — content/updated_at change on edit.
    2. Soft deleted? No — deletion is a real, immediate hard delete;
       no business/legal significance to preserving a dead private note.
    3. Audit trail? No dedicated AuditLog rows for note edits — these
       are low-stakes freelancer-private scratch notes, not the kind of
       action CLAUDE.md's audit rules are aimed at.
    4. Indexed? `(client, created_at)` — the note list is always scoped
       to one client, ordered by recency.
    5. Encrypted? No — not the kind of sensitive data this project
       encrypts (CNIC/NTN/PSEB/credentials).
    6. Cascade behavior? CASCADE from both Client and User — a note has
       no meaning independent of the client it's about or the freelancer
       who wrote it.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    client = models.ForeignKey(Client, on_delete=models.CASCADE, related_name='client_notes')
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='authored_client_notes',
    )
    content = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'client_notes'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['client', 'created_at']),
        ]

    def __str__(self):
        return f'Note on {self.client.name} by {self.author}'


class ClientTag(models.Model):
    """
    Minimal, user-scoped label — named as owned by apps/clients/ in the
    decisions doc but never fully designed there; this is the real
    implementation.

    6-question framework:
    1. Mutable? Yes — name/color can be edited by their owner.
    2. Soft deleted? No — a tag with no clients attached has no residual
       meaning; hard delete is correct.
    3. Audit trail? No — a cosmetic organizational label, not a
       security- or finance-relevant action.
    4. Indexed? Implicit via unique_together(user, name) — also serves as
       the lookup index for "does this user already have a tag with this name."
    5. Encrypted? No.
    6. Cascade behavior? CASCADE from User. Removing a tag detaches it
       from every Client via the M2M table automatically — no separate
       cleanup needed.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='client_tags',
    )
    name = models.CharField(max_length=40)
    color = models.CharField(
        max_length=7,
        validators=[RegexValidator(regex=r'^#[0-9A-Fa-f]{6}$', message='Color must be a hex value like #3B82F6.')],
    )

    class Meta:
        db_table = 'client_tags'
        ordering = ['name']
        unique_together = [('user', 'name')]

    def __str__(self):
        return self.name
