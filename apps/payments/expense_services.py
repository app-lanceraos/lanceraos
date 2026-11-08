# apps/payments/expense_services.py
"""
Writes to the expense ledger (Prompt 14). Request-free; the CALLER owns the transaction (and, for
update_expense/delete_expense, has already locked the expense row with select_for_update).

An expense has no allocations, so every field is editable (decision E7). The rate is recomputed only
when `currency` or `expense_date` changes, from the snapshot nearest the NEW date. Delete is a hard
delete; the caller writes the AuditLog row from `snapshot_for_audit`, taken before the delete. Audit
rows never contain `vendor` or `description` text.
"""
from . import services
from .models import Expense
from .rates import rate_context

# Every field an update may change, in the order changes are reported.
EDITABLE_FIELDS = ('amount', 'currency', 'expense_date', 'category', 'vendor', 'description', 'is_deductible')
# Free text: audit rows record THAT these changed, never what they say.
TEXT_FIELDS = ('vendor', 'description')


def create_expense(*, user_id, amount, currency, expense_date, category, vendor='', description='', is_deductible=True):
    """Creates one ledger row with the rate of its own expense date frozen onto it."""
    context = rate_context(currency, expense_date)
    return Expense.objects.create(
        user_id=user_id,
        amount=amount,
        currency=currency,
        expense_date=expense_date,
        category=category,
        vendor=vendor,
        description=description,
        is_deductible=is_deductible,
        rate_to_usd=context.rate_to_usd,
        rate_basis=context.basis,
        exchange_rate_snapshot=context.snapshot,
    )


def update_expense(expense, data):
    """
    Applies `data` (already validated) to an expense the caller has locked. Returns the list of
    {'field', 'old', 'new'} changes actually made. An empty list means nothing was saved and
    `updated_at` is untouched.
    """
    changes = []
    for field in EDITABLE_FIELDS:
        if field not in data:
            continue
        old, new = getattr(expense, field), data[field]
        if old == new:
            continue
        changes.append({'field': field, 'old': old, 'new': new})

    if not changes:
        return []

    for change in changes:
        setattr(expense, change['field'], change['new'])
    update_fields = {change['field'] for change in changes}
    if update_fields & {'currency', 'expense_date'}:
        context = rate_context(expense.currency, expense.expense_date)
        expense.rate_to_usd = context.rate_to_usd
        expense.rate_basis = context.basis
        expense.exchange_rate_snapshot = context.snapshot
        update_fields |= {'rate_to_usd', 'rate_basis', 'exchange_rate_snapshot'}
    expense.save(update_fields=[*update_fields, 'updated_at'])
    return changes


def audit_changes(changes):
    """The changes in the shape the AuditLog may store: vendor and description values are dropped."""
    return services.audit_changes(changes, text_fields=TEXT_FIELDS)


def snapshot_for_audit(expense):
    """The full money snapshot an expense_created / expense_deleted row keeps (no vendor, no description)."""
    return {
        'expense_id': str(expense.pk),
        'amount': str(expense.amount),
        'currency': expense.currency,
        'expense_date': expense.expense_date.isoformat(),
        'category': expense.category,
        'is_deductible': expense.is_deductible,
    }


def delete_expense(expense):
    """Hard-deletes the expense; the caller writes the audit row."""
    expense.delete()
