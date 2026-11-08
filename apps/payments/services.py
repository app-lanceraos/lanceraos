# apps/payments/services.py
"""
Writes to the income ledger. Request-free; the CALLER owns the transaction (and, for
update_payment/delete_payment, has already locked the payment row with select_for_update).

Rules (Payments core, decisions P5/P6):
  - hard delete plus an AuditLog snapshot, never a soft delete;
  - a payment with ANY allocation can only change counterparty and notes;
  - a payment recorded on an invoice is removed only through that invoice's Undo payment.
Reads allocations only through the reverse accessor `invoice_allocations`: apps.payments
imports nothing from apps.invoices.
"""
from decimal import Decimal

from django.db.models import DecimalField, Sum
from django.db.models.functions import Coalesce

from .constants import ORIGIN_INVOICE
from .models import Payment
from .rates import rate_context

# Fields that describe the money itself. Locked while any invoice allocates from the payment.
LOCKED_WHILE_ALLOCATED = ('amount', 'currency', 'payment_date', 'source')
EDITABLE_ALWAYS = ('counterparty', 'notes')
# Free text: audit rows record THAT these changed, never what they say.
TEXT_FIELDS = ('counterparty', 'notes')

ZERO = Decimal('0.00')


class PaymentRuleError(Exception):
    """A payment rule refused the change; str(exc) is a message safe to show the user."""


def create_payment(*, user_id, amount, currency, payment_date, source='other',
                   counterparty='', notes='', origin):
    """Creates one ledger row with the rate of its own payment date frozen onto it."""
    context = rate_context(currency, payment_date)
    return Payment.objects.create(
        user_id=user_id,
        amount=amount,
        currency=currency,
        payment_date=payment_date,
        source=source,
        counterparty=counterparty,
        notes=notes,
        origin=origin,
        rate_to_usd=context.rate_to_usd,
        rate_basis=context.basis,
        exchange_rate_snapshot=context.snapshot,
    )


def allocated_amount(payment):
    """Sum of every invoice allocation drawn from this payment (a fresh query)."""
    total = payment.invoice_allocations.aggregate(
        total=Coalesce(Sum('amount'), ZERO, output_field=DecimalField(max_digits=14, decimal_places=2)),
    )['total']
    return total


def remaining_amount(payment):
    return payment.amount - allocated_amount(payment)


def update_payment(payment, data):
    """
    Applies `data` (already validated) to a payment the caller has locked. Returns the list
    of {'field', 'old', 'new'} changes actually made (empty = nothing changed, nothing saved).
    Raises PaymentRuleError when an allocated payment's locked field would change.
    """
    allocated = payment.invoice_allocations.exists()
    changes = []
    for field in (*LOCKED_WHILE_ALLOCATED, *EDITABLE_ALWAYS):
        if field not in data:
            continue
        old, new = getattr(payment, field), data[field]
        if old == new:
            continue
        if allocated and field in LOCKED_WHILE_ALLOCATED:
            raise PaymentRuleError(
                'This payment is linked to an invoice, so its amount, currency, date and source '
                'are locked. Unlink it from the invoice first.'
            )
        changes.append({'field': field, 'old': old, 'new': new})

    if not changes:
        return []

    for change in changes:
        setattr(payment, change['field'], change['new'])
    update_fields = {change['field'] for change in changes}
    if update_fields & {'currency', 'payment_date'}:
        context = rate_context(payment.currency, payment.payment_date)
        payment.rate_to_usd = context.rate_to_usd
        payment.rate_basis = context.basis
        payment.exchange_rate_snapshot = context.snapshot
        update_fields |= {'rate_to_usd', 'rate_basis', 'exchange_rate_snapshot'}
    payment.save(update_fields=[*update_fields, 'updated_at'])
    return changes


def audit_changes(changes, text_fields=TEXT_FIELDS):
    """
    The changes in the shape the AuditLog may store: free-text values are dropped. `text_fields`
    names the free-text fields of the ledger in question (payments: the default; expenses pass
    their own, see expense_services).
    """
    out = []
    for change in changes:
        if change['field'] in text_fields:
            out.append({'field': change['field']})
        else:
            out.append({'field': change['field'], 'old': str(change['old']), 'new': str(change['new'])})
    return out


def snapshot_for_audit(payment):
    """The full money snapshot a payment_deleted row keeps (no counterparty, no notes)."""
    return {
        'payment_id': str(payment.pk),
        'amount': str(payment.amount),
        'currency': payment.currency,
        'payment_date': payment.payment_date.isoformat(),
        'source': payment.source,
        'origin': payment.origin,
    }


def delete_payment(payment):
    """Hard-deletes a free manual/imported payment; the caller writes the audit row."""
    if payment.origin == ORIGIN_INVOICE:
        raise PaymentRuleError('Recorded on an invoice: use Undo payment on that invoice.')
    if payment.invoice_allocations.exists():
        raise PaymentRuleError('Unlink it from the invoice first.')
    payment.delete()


def discard_invoice_origin_payment(payment):
    """
    Called by invoice undo AFTER it deleted the allocation. Removes the ledger row only if it
    was created by the invoice itself and nothing else draws from it; a manual or imported
    payment that was merely linked survives an undo, unallocated.
    """
    if payment.origin == ORIGIN_INVOICE and not payment.invoice_allocations.exists():
        payment.delete()
        return True
    return False
