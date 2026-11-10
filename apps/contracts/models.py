# apps/contracts/models.py
"""
Contracts (Prompt 22): the data model. A freelancer picks a template (optionally starting from an accepted proposal),
edits it while it is a draft, types their full name and sends it. The client opens a private link (no login) and
either signs by typing their name or declines. Both names, the times and a SHA-256 fingerprint of the exact text that
was signed are stored with the contract.

The contract body is a list of numbered sections (`sections`) plus "Key terms" that come from FIELDS (fee, currency,
payment terms, dates), never from text inside a clause. Every text field here is PLAIN TEXT, never HTML; consumers
must display it escaped and must never mark it safe.

Field names deliberately mirror apps.proposals.Proposal (client_name/client_email/client_company, view_token,
status, the sent/viewed/responded/withdrawn timestamps, response_ip/response_user_agent) so the two modules behave
the same way where they can.

`currency` is a CharField(3) with no `choices=`, same reasoning as Invoice.currency and Proposal.currency:
validation against the live exchange-rate snapshot lives in the serializer.
"""
import secrets
import uuid
from decimal import Decimal

from django.conf import settings
from django.db import models
from django.utils import timezone

from apps.clients.models import Client

from .constants import AWAITING_RESPONSE_STATUSES, SENT_VIA_CHOICES, STATUS_CHOICES, TEMPLATE_CHOICES


def _today():
    """Pakistan date: USE_TZ=False and TIME_ZONE='Asia/Karachi', so naive now() IS Pakistan time."""
    return timezone.now().date()


class Contract(models.Model):
    """
    6-question framework:
    1. Mutable? Content only while `draft`. A sent contract is exactly what the client saw, so every edit/delete
       endpoint refuses anything but a draft (403), enforced server-side. At send the server freezes `parties` and
       computes `content_hash`; signing recomputes the hash from the stored row and refuses on a mismatch. After the
       draft stage only the lifecycle fields change (status, the timestamps, the signatures, signed_copies_sent_at).
       A signed contract is final: no withdraw, no edit, no delete.
    2. Soft deleted? No. Only drafts can be deleted (hard delete: a draft has no record-keeping value). A contract
       that was sent or answered is a record: it is withdrawn, never deleted.
    3. Audit trail? Yes, every transition, via core.AuditLog (ids, numbers, method, hashes and counts - never the
       contract text, a name, the client's reason or an email address): contract_created / _deleted / _sent /
       _viewed / _withdrawn / _signed / _declined, written by the handlers in notifications.py regardless of any
       notification toggle.
    4. Indexed? (user, status), (user, created_at), the unique indexed view_token, unique (user, contract_number)
       and the implicit FK indexes. Everything is queried scoped to one user, except the public page, which looks up
       by view_token.
    5. Encrypted? No - business text and prices, no credentials. `response_ip` / `response_user_agent` /
       `owner_signed_ip` / `owner_signed_user_agent` are evidence of who signed, stored only when a person signs,
       declines or sends, never on a plain view, and returned only to the owner (signature_record), never publicly.
    6. Cascade behavior? `user` CASCADE, same as Proposal.user (a contract has no meaning once its owner row is
       gone; accounts are anonymised, never hard-deleted, so this does not fire in practice). `client`, `proposal`
       and `invoice` SET_NULL: the client_* snapshot fields and the frozen `parties` keep the contract readable if a
       linked record is removed; a contract never owns its proposal or invoice.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='contracts')
    client = models.ForeignKey(
        Client, null=True, blank=True, on_delete=models.SET_NULL, related_name='contracts',
        help_text='Optional: a contract can be drafted before the client exists in the CRM.',
    )
    client_name = models.CharField(max_length=200, blank=True)
    client_email = models.EmailField(blank=True)
    client_company = models.CharField(max_length=200, blank=True)

    proposal = models.ForeignKey(
        'proposals.Proposal', null=True, blank=True, on_delete=models.SET_NULL, related_name='contracts',
        help_text='A plain reference to the accepted proposal this contract started from.',
    )
    invoice = models.ForeignKey(
        'invoices.Invoice', null=True, blank=True, on_delete=models.SET_NULL, related_name='contracts',
        help_text='A plain reference. It changes nothing on the invoice.',
    )

    title = models.CharField(max_length=200)
    template_key = models.CharField(max_length=20, choices=TEMPLATE_CHOICES)
    template_version = models.CharField(max_length=20, blank=True)
    sections = models.JSONField(default=list, blank=True, help_text='Ordered items of {"id", "title", "text"}.')

    currency = models.CharField(max_length=3, default='USD')
    fee_amount = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0'))
    payment_terms = models.TextField(blank=True)
    start_date = models.DateField(null=True, blank=True)
    end_date = models.DateField(null=True, blank=True)
    valid_until = models.DateField(null=True, blank=True, help_text='The sign-by date.')

    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='draft')
    view_token = models.CharField(max_length=32, unique=True, db_index=True, blank=True)

    # Assigned at send, AFTER the email succeeded, under the User-row lock. NULL while a draft (NULLs are distinct
    # in PostgreSQL, so drafts never collide on the unique constraint).
    contract_number = models.CharField(max_length=30, null=True, blank=True)
    sent_via = models.CharField(max_length=10, blank=True, choices=SENT_VIA_CHOICES)
    sent_at = models.DateTimeField(null=True, blank=True)

    # Frozen at send: the parties as they were, and the SHA-256 of the exact text the client is asked to sign.
    parties = models.JSONField(default=dict, blank=True)
    content_hash = models.CharField(max_length=64, blank=True)

    # The freelancer signs at send by typing their full name (decision K3).
    owner_signed_name = models.CharField(max_length=120, blank=True)
    owner_signed_at = models.DateTimeField(null=True, blank=True)
    owner_signed_ip = models.GenericIPAddressField(null=True, blank=True)
    owner_signed_user_agent = models.CharField(max_length=500, blank=True)

    viewed_at = models.DateTimeField(null=True, blank=True, help_text='The FIRST client view only.')
    responded_at = models.DateTimeField(null=True, blank=True)
    withdrawn_at = models.DateTimeField(null=True, blank=True)

    signed_name = models.CharField(max_length=120, blank=True)
    response_message = models.TextField(blank=True, help_text="The client's optional reason for declining. Plain text.")
    response_ip = models.GenericIPAddressField(null=True, blank=True)
    response_user_agent = models.CharField(max_length=500, blank=True)
    signed_hash = models.CharField(max_length=64, blank=True)
    signed_copies_sent_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'contracts'
        ordering = ['-created_at']
        unique_together = [('user', 'contract_number')]
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
        """Same unique-token approach as Proposal._generate_unique_view_token."""
        while True:
            token = secrets.token_urlsafe(16)
            if not cls.objects.filter(view_token=token).exists():
                return token

    @classmethod
    def generate_contract_number(cls, user):
        """
        CON-YYYY-NNNN, sequential per user per year - Proposal.generate_proposal_number's twin. MUST be called while
        holding the User-row lock (`User.objects.select_for_update().get(pk=user.pk)`) inside the same transaction
        that saves the number: two concurrent calls for one user would otherwise read the same "last" number.
        """
        year = timezone.now().year
        prefix = f'CON-{year}-'
        last = cls.objects.filter(
            user=user, contract_number__startswith=prefix,
        ).order_by('-contract_number').first()
        if last:
            try:
                next_num = int(last.contract_number.split('-')[-1]) + 1
            except ValueError:
                next_num = 1
        else:
            next_num = 1
        return f'{prefix}{str(next_num).zfill(4)}'

    # -- Computed properties (never stored) -------------------------------------------------------------------

    @property
    def public_url(self):
        """The client-facing link (the frontend's own /contract/<token> page), same style as Proposal.public_url."""
        return f'{settings.FRONTEND_URL}/contract/{self.view_token}'

    @property
    def is_editable(self):
        return self.status == 'draft'

    @property
    def is_expired(self):
        """
        Computed on read, NEVER stored (a stored derived status goes stale or overwrites the real one). Only a
        contract still waiting on the client can expire; a draft has not been offered yet and an answered one is
        final.
        """
        return (
            self.status in AWAITING_RESPONSE_STATUSES
            and self.valid_until is not None
            and self.valid_until < _today()
        )
