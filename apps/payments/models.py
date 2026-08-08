# apps/payments/models.py
"""
Minimal foundational slice of Module 3 (Payments + Expenses + P&L) —
just enough to give Module 2 (Invoices/Clients) a real currency-conversion
anchor to build against. Everything else in Module 3's scope (income
tracking, expense tracking, P&L reporting) is a separate, later build.
"""
import uuid

from django.db import models


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

    def __str__(self):
        return f'{self.date} — {len(self.rates_to_usd)} currencies'
