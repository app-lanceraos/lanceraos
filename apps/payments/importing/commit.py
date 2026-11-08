# apps/payments/importing/commit.py
"""
Creating and undoing an import (decisions I3, I7, I8).

commit_plan runs in ONE transaction, serialised per user by a row lock on the user (precedent:
Session.create_for_user, invoice number generation), rebuilds the plan from the uploaded bytes and
trusts nothing the client says about rows: a different fingerprint is a 409, and only rows the
rebuilt plan calls selectable can be included. It writes no audit row (the view does, after the
transaction has committed, like every other payments view).
"""
import re
from decimal import Decimal

from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.payments.constants import ORIGIN_IMPORT
from apps.payments.importing import classify as c
from apps.payments.importing.errors import ImportConflict, ImportNotFound, ImportRefused
from apps.payments.importing.plan import build_plan
from apps.payments.models import Payment, PaymentImportBatch

BULK_BATCH_SIZE = 500
MAX_REPORTED_ROWS = 5
FILE_NAME_LIMIT = 255
_CONTROL_CHARS = re.compile(r'[\x00-\x1f\x7f-\x9f​-‏‪-‮⁦-⁩﻿]')


def safe_file_name(name):
    """Basename only, control and bidi characters removed, at most 255 characters."""
    base = re.split(r'[\\/]', name or '')[-1]
    return _CONTROL_CHARS.sub('', base).strip()[:FILE_NAME_LIMIT] or 'import.csv'


def _validated_include_rows(include_rows, plan):
    """The set of row numbers to import, or ImportRefused naming up to 5 offending rows."""
    if (
        not isinstance(include_rows, list) or not include_rows
        or any(isinstance(n, bool) or not isinstance(n, int) for n in include_rows)
        or len(set(include_rows)) != len(include_rows)
    ):
        raise ImportRefused('bad_selection', 'Choose at least one row to import.')
    by_number = plan.row_by_number()
    problems = []
    for number in include_rows:
        row = by_number.get(number)
        if row is None:
            problems.append(f'Row {number} does not exist in this file.')
        elif not row.selectable:
            problems.append(f'Row {number} cannot be imported: {row.reason}')
    if problems:
        raise ImportRefused('rows_not_importable', ' '.join(problems[:MAX_REPORTED_ROWS]))
    return set(include_rows)


def _counts(plan, included):
    counts = {'imported': 0, 'skipped_duplicate': 0, 'skipped_not_income': 0, 'skipped_invalid': 0, 'skipped_unselected': 0}
    for row in plan.rows:
        if row.number in included:
            counts['imported'] += 1
        elif row.status in (c.STATUS_DUPLICATE_EXACT, c.STATUS_DUPLICATE_PROBABLE):
            counts['skipped_duplicate'] += 1
        elif row.status == c.STATUS_NOT_INCOME:
            counts['skipped_not_income'] += 1
        elif row.status == c.STATUS_INVALID:
            counts['skipped_invalid'] += 1
        else:
            counts['skipped_unselected'] += 1
    return counts


def _build_payment(user, plan, row, batch):
    parsed = row.parsed
    context = plan.resolver.resolve(parsed.currency, parsed.payment_date)
    return Payment(
        user=user, amount=parsed.amount, currency=parsed.currency, payment_date=parsed.payment_date,
        source=plan.source, counterparty=parsed.counterparty, notes=parsed.notes, origin=ORIGIN_IMPORT,
        external_id=parsed.external_id, import_batch=batch,
        # bulk_create skips Payment.save(), which is what forces USD to exactly 1 everywhere else.
        rate_to_usd=Decimal('1') if parsed.currency == 'USD' else context.rate_to_usd,
        rate_basis=context.basis, exchange_rate_snapshot=context.snapshot,
    )


def commit_plan(user, raw, file_name, source, provided_mapping, plan_fingerprint, include_rows):
    """Creates the batch and the chosen payments. Returns the PaymentImportBatch."""
    try:
        with transaction.atomic():
            type(user).objects.select_for_update().get(pk=user.pk)
            plan = build_plan(user, raw, source, provided_mapping)
            if plan.needs_mapping:
                raise ImportRefused('needs_mapping', 'The columns of this file still need to be matched before it can be imported.')
            if not plan_fingerprint or plan.fingerprint != plan_fingerprint:
                raise ImportConflict(
                    'plan_changed',
                    'Your payments changed since the preview. Preview the file again to see what will be imported.',
                )
            included = _validated_include_rows(include_rows, plan)
            counts = _counts(plan, included)

            batch = PaymentImportBatch.objects.create(
                user=user, source=plan.source, file_name=safe_file_name(file_name), file_sha256=plan.table.sha256,
                header_signature=plan.table.header_signature, mapping=plan.mapping, rows_total=len(plan.rows), **counts,
            )
            payments = [_build_payment(user, plan, row, batch) for row in plan.rows if row.number in included]
            Payment.objects.bulk_create(payments, batch_size=BULK_BATCH_SIZE)
    except IntegrityError:
        raise ImportConflict(
            'already_imported',
            'Some of these transactions were imported a moment ago. Preview the file again to see what is left.',
        ) from None
    return batch


def undo_batch(user, batch_id):
    """
    Deletes the import's payments that nothing is linked to; keeps (and reports) the ones already
    linked to an invoice. Another person's batch is a plain not-found. -> {'removed', 'kept'}.
    """
    with transaction.atomic():
        type(user).objects.select_for_update().get(pk=user.pk)
        try:
            batch = PaymentImportBatch.objects.select_for_update().get(pk=batch_id, user=user)
        except PaymentImportBatch.DoesNotExist:
            raise ImportNotFound('not_found', 'That import was not found.') from None
        payments = Payment.objects.filter(import_batch=batch, origin=ORIGIN_IMPORT, user=user)
        total = payments.count()
        if total == 0:
            raise ImportRefused('nothing_to_undo', 'Nothing from this import is left to undo.')
        free = payments.filter(invoice_allocations__isnull=True)
        removed = free.count()
        free.delete()
        if batch.undone_at is None:
            batch.undone_at = timezone.now()
            batch.save(update_fields=['undone_at'])
    return {'removed': removed, 'kept': total - removed}
