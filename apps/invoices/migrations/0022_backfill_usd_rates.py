# apps/invoices/migrations/0022_backfill_usd_rates.py
"""
Data migration — fills a missing rate_to_usd for USD amounts with exactly 1.

A USD amount's rate into USD is 1 by definition, so this is lossless and
honest: it records a fact, it does not estimate anything.

  - Invoice.rate_to_usd_at_issue: every NON-DRAFT USD invoice where it is
    NULL. (Drafts legitimately have no captured rate — it is captured at
    finalise.) In the dev DB these were 29 rows created straight through the
    ORM by seed scripts that bypassed _finalise_invoice; no app path creates
    them. See DECISIONS.md, 02 October 2026.
  - InvoicePartialPayment.rate_to_usd: every USD payment where it is NULL
    (recorded before views._lookup_rate_to_usd existed).

Deliberately NOT touched: non-USD rows with a NULL rate. No honest frozen
rate exists for them and inventing one would corrupt the figures; they stay
"unconverted" (core.money.convert_amount returns None for them) by design.

Idempotent (a second run finds nothing to update) and uses queryset
.update(), so it never touches updated_at or fires any save() logic. The
reverse is an explicit no-op: after the fact a backfilled 1 is
indistinguishable from a real captured 1, and un-setting them would only
re-create the defect.
"""
import logging
from decimal import Decimal

from django.db import migrations

logger = logging.getLogger(__name__)


def backfill_usd_rates(apps, schema_editor):
    """Returns the counts so a test can assert on them directly."""
    Invoice = apps.get_model('invoices', 'Invoice')
    InvoicePartialPayment = apps.get_model('invoices', 'InvoicePartialPayment')

    invoices = Invoice.objects.filter(currency='USD', rate_to_usd_at_issue__isnull=True).exclude(status='draft')
    payments = InvoicePartialPayment.objects.filter(currency='USD', rate_to_usd__isnull=True)
    counts = {
        'invoices_before': invoices.count(),
        'payments_before': payments.count(),
        'non_usd_invoices_left_null': Invoice.objects.exclude(currency='USD').exclude(status='draft').filter(rate_to_usd_at_issue__isnull=True).count(),
        'non_usd_payments_left_null': InvoicePartialPayment.objects.exclude(currency='USD').filter(rate_to_usd__isnull=True).count(),
    }
    counts['invoices_updated'] = invoices.update(rate_to_usd_at_issue=Decimal('1'))
    counts['payments_updated'] = payments.update(rate_to_usd=Decimal('1'))
    counts['invoices_after'] = Invoice.objects.filter(currency='USD', rate_to_usd_at_issue__isnull=True).exclude(status='draft').count()
    counts['payments_after'] = InvoicePartialPayment.objects.filter(currency='USD', rate_to_usd__isnull=True).count()
    logger.info('[0022 backfill_usd_rates] %s', counts)
    return counts


class Migration(migrations.Migration):

    dependencies = [
        ('invoices', '0021_alter_invoice_base_template'),
    ]

    operations = [
        migrations.RunPython(backfill_usd_rates, migrations.RunPython.noop),
    ]
