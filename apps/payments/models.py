# apps/payments/models.py
"""
Module 3 (Payments + Expenses + P&L), built in slices. Built so far:
  - ExchangeRateSnapshot, the currency-conversion anchor Module 2 builds against;
  - Payment, the income ledger (Payments core, 07 November 2026).
Expenses, CSV import, P&L reporting and exchange-rate alerts are later builds.

apps.payments is the BOTTOM of the dependency tree: it imports nothing from another
feature app (use settings.AUTH_USER_MODEL strings), only core.* and itself.
"""
import uuid
from decimal import Decimal

from django.conf import settings
from django.db import models

from .constants import (
    ORIGIN_CHOICES,
    PAYMENT_SOURCE_CHOICES,
    RATE_BASIS_CHOICES,
    RATE_NONE,
)


class ExchangeRateSnapshot(models.Model):
    """
    One row per day, capturing every currency the upstream API returns
    (not just PKR/EUR/GBP) — an anchor-currency design: rates_to_usd[X]
    is the value of one unit of currency X in USD, so any currency pair
    converts by routing through USD rather than needing a direct rate
    for every pair. Adding a new currency later is a data change (the
    next day's fetch just includes it), never a migration.

    6-question framework:
    1. Mutable? No — append-only, one row per date, never edited after
       creation. The daily fetch task checks for an existing row before
       creating a new one rather than updating in place.
    2. Soft deleted? No — reference data with no deletion path at all.
    3. Audit trail? N/A — this is reference data fetched by a scheduled
       task, not a user action, so there's nothing for core.AuditLog to
       attribute it to.
    4. Indexed? `date` — the daily-fetch idempotency check and every
       "most recent snapshot" lookup query on this field.
    5. Encrypted? No — exchange rates aren't sensitive data.
    6. Cascade behavior? N/A as of this table's creation — nothing FKs
       to it yet. Future FKs (e.g. Invoice.exchange_rate_snapshot) should
       use SET_NULL, since an invoice must survive a snapshot row being
       pruned long after the fact.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    date = models.DateField(unique=True, db_index=True)
    rates_to_usd = models.JSONField(
        help_text="Value of 1 unit of that currency in USD, e.g. "
                  '{"PKR": 0.0036, "EUR": 1.08, "GBP": 1.27, "USD": 1.0}.',
    )
    source = models.CharField(max_length=100)
    fetched_at = models.DateTimeField()

    class Meta:
        db_table = 'exchange_rate_snapshots'
        ordering = ['-date']

    @classmethod
    def get_current(cls):
        """
        Today's snapshot, falling back to the most recent one — or None
        when none exists yet. The single definition of "the current rate
        table" for read paths that convert amounts (invoice KPIs/analytics
        via apps.invoices.views._get_latest_snapshot, client payment_stats
        via apps.clients). Mirrors Invoice.capture_issue_rate()'s own
        selection logic.
        """
        from django.utils import timezone
        return cls.objects.filter(date=timezone.now().date()).first() or cls.objects.order_by('-date').first()

    def __str__(self):
        return f'{self.date} — {len(self.rates_to_usd)} currencies'


class Payment(models.Model):
    """
    The income ledger: every amount of money received is exactly ONE row here. An
    invoice does not own money, it ALLOCATES part (or all) of a Payment to itself
    through apps.invoices.InvoicePartialPayment.payment (reverse accessor
    `invoice_allocations`). A payment can exist with no invoice at all (a freelancer
    paid through Payoneer or Wise with nothing invoiced), and one payment can be split
    across several invoices.

    The rate is frozen from the snapshot NEAREST payment_date, so a report of a past
    month does not move when today's rate moves (`rate_basis` says how close that
    snapshot was). Report maths lives in apps.payments.ledger.

    6-question framework:
    1. Mutable? Limited. A payment with any allocation can only change counterparty and
       notes; a free one can change everything (the rate is recomputed when currency or
       date change). Enforced in services.update_payment under a row lock.
    2. Soft deleted? No — hard delete plus a full-snapshot AuditLog row. A soft-deleted
       row would silently block re-importing the same transaction later and every reader
       would need `deleted_at IS NULL`. Same precedent as InvoicePartialPayment undo.
    3. Audit trail? Yes: payment_created (manual), payment_updated, payment_deleted,
       payment_linked, payment_unlinked. Payments recorded on an invoice are covered by
       the invoice events.
    4. Indexed? (user, -payment_date) — every list, summary and report filters on both.
    5. Encrypted? No. Amounts and dates are not credentials; counterparty and notes are
       short plain text the owner typed.
    6. Cascade behavior? user PROTECT (financial record: account deletion anonymizes, it
       never removes the user row). exchange_rate_snapshot SET_NULL (a pruned snapshot
       must not take a payment with it). Allocations point here with PROTECT: a deleted
       payment can never silently orphan an allocation.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='payments')
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    currency = models.CharField(max_length=3)
    payment_date = models.DateField()
    source = models.CharField(max_length=20, choices=PAYMENT_SOURCE_CHOICES, default='other')
    counterparty = models.CharField(max_length=200, blank=True)
    notes = models.CharField(max_length=300, blank=True)
    origin = models.CharField(max_length=10, choices=ORIGIN_CHOICES)

    # Anchor-currency design: value of 1 unit of `currency` in USD on (about) payment_date.
    rate_to_usd = models.DecimalField(max_digits=18, decimal_places=10, null=True, blank=True)
    rate_basis = models.CharField(max_length=10, choices=RATE_BASIS_CHOICES, default=RATE_NONE)
    exchange_rate_snapshot = models.ForeignKey(
        ExchangeRateSnapshot, null=True, blank=True, on_delete=models.SET_NULL, related_name='+',
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'payments'
        ordering = ['-payment_date', '-created_at']
        indexes = [models.Index(fields=['user', '-payment_date'], name='payments_user_date_idx')]
        constraints = [
            models.CheckConstraint(condition=models.Q(amount__gt=0), name='payments_amount_positive'),
        ]

    def __str__(self):
        return f'{self.currency} {self.amount} on {self.payment_date}'

    def save(self, *args, **kwargs):
        if self.currency == 'USD' and self.rate_to_usd != Decimal('1'):
            # Same invariant as Invoice and InvoicePartialPayment: USD -> USD is exactly 1.
            self.rate_to_usd = Decimal('1')
            update_fields = kwargs.get('update_fields')
            if update_fields is not None and 'rate_to_usd' not in update_fields:
                kwargs['update_fields'] = [*update_fields, 'rate_to_usd']
        super().save(*args, **kwargs)
