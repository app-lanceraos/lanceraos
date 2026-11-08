# apps/payments/constants.py
"""
The one place the income ledger's shared vocabulary is defined, so Payment and
apps.invoices.InvoicePartialPayment cannot drift apart.

PayPal is deliberately absent from the sources: PayPal does not support receiving
money in Pakistan.
"""
from datetime import date

# Where the money arrived. Same seven values, order and labels the invoice payment
# form has always offered.
PAYMENT_SOURCE_CHOICES = [
    ('payoneer', 'Payoneer'), ('wise', 'Wise'),
    ('jazzcash', 'JazzCash'), ('easypaisa', 'Easypaisa'),
    ('bank', 'Bank Transfer'), ('cash', 'Cash'), ('other', 'Other'),
]
PAYMENT_SOURCE_LABELS = dict(PAYMENT_SOURCE_CHOICES)

# How the row came to exist. 'invoice' = recorded on an invoice (the ledger row is
# created for the user automatically); 'manual' = typed on the Payments page;
# 'import' = created by the payment import engine (apps/payments/importing/).
ORIGIN_MANUAL = 'manual'
ORIGIN_INVOICE = 'invoice'
ORIGIN_IMPORT = 'import'
ORIGIN_CHOICES = [
    (ORIGIN_MANUAL, 'Manual'), (ORIGIN_INVOICE, 'Recorded on an invoice'), (ORIGIN_IMPORT, 'Imported'),
]

# How trustworthy a payment's frozen exchange rate is, by the distance between the
# payment date and the snapshot the rate came from.
RATE_EXACT = 'exact'
RATE_NEARBY = 'nearby'
RATE_ESTIMATED = 'estimated'
RATE_NONE = 'none'
RATE_BASIS_CHOICES = [
    (RATE_EXACT, 'Rate of that day'), (RATE_NEARBY, 'Rate within 7 days'),
    (RATE_ESTIMATED, 'Nearest available rate'), (RATE_NONE, 'No rate available'),
]
NEARBY_MAX_DAYS = 7

# No payment can predate this; it catches a mistyped year without blocking real history.
EARLIEST_PAYMENT_DATE = date(2010, 1, 1)

# Payment import engine (Prompt 12). Limits are enforced before any parsing work is done.
IMPORT_MAX_BYTES = 2 * 1024 * 1024
IMPORT_MAX_ROWS = 2000
IMPORT_MAX_COLUMNS = 60
IMPORT_MAX_CELL = 2000

# Two payments with the same currency and exact amount dated within this many days (either way,
# inclusive) are "possibly the same money". Shared by the manual-entry duplicate notice and the import.
PROBABLE_DUPLICATE_DAYS = 3
