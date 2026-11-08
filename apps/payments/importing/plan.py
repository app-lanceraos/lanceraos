# apps/payments/importing/plan.py
"""
build_plan: the ONE function behind both the preview and the commit (decision I2/I3). It reads the
bytes, resolves the mapping, classifies every row, adds the two duplicate statuses with set-based
queries (never a query per row) and returns a Plan. It writes nothing.

The commit rebuilds this plan from the same bytes inside its transaction and compares fingerprints, so
the person is never imported over a duplicate they did not see.
"""
import hashlib
import json
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import timedelta
from decimal import Decimal

from django.utils import timezone

from apps.payments.constants import IMPORT_MAX_ROWS, PAYMENT_SOURCE_LABELS, PROBABLE_DUPLICATE_DAYS
from apps.payments.importing import classify as c
from apps.payments.importing.errors import ImportRefused
from apps.payments.importing.mapping import header_row_of, is_wise_file, resolve_mapping
from apps.payments.importing.reader import read_table
from apps.payments.models import Payment
from apps.payments.rates import RateResolver
from apps.payments.selectors import payments_queryset
from apps.payments.serializers import PaymentSerializer

SELECTABLE_STATUSES = frozenset({c.STATUS_NEW, c.STATUS_UNSURE, c.STATUS_DUPLICATE_PROBABLE})
ALL_STATUSES = (
    c.STATUS_NEW, c.STATUS_UNSURE, c.STATUS_DUPLICATE_EXACT, c.STATUS_DUPLICATE_PROBABLE,
    c.STATUS_NOT_INCOME, c.STATUS_INVALID,
)
# One query for the whole file: a file never has more than IMPORT_MAX_ROWS ids, so the exact-duplicate
# look-up is a single query whatever the row count (a smaller chunk would add a query per 500 rows).
EXACT_QUERY_CHUNK = IMPORT_MAX_ROWS
MAX_MATCHES = 3
SAMPLE_ROWS = 5
SAMPLE_CELL = 80
PROBABLE_REASON = 'Looks like a payment you already have.'


@dataclass
class PlanRow:
    number: int
    line: int
    status: str
    reason: str
    parsed: c.ParsedRow
    match_ids: list = field(default_factory=list)   # payment ids, closest first
    matches: list = field(default_factory=list)     # serialised payments, same shape as the Payments list
    warnings: list = field(default_factory=list)

    @property
    def selectable(self):
        return self.status in SELECTABLE_STATUSES

    @property
    def selected(self):
        return self.status == c.STATUS_NEW

    def to_json(self):
        parsed = self.parsed
        return {
            'row': self.number, 'line': self.line, 'status': self.status, 'reason': self.reason,
            'selectable': self.selectable, 'selected': self.selected,
            'amount': None if parsed.amount is None else str(parsed.amount),
            'currency': parsed.currency,
            'payment_date': parsed.payment_date.isoformat() if parsed.payment_date else None,
            'counterparty': parsed.counterparty, 'notes': parsed.notes, 'external_id': parsed.external_id,
            'warnings': self.warnings, 'matches': self.matches,
        }


@dataclass
class Plan:
    table: object
    source: str
    mapping: dict
    mapping_origin: str
    needs_mapping: bool
    reasons: list
    ambiguous_roles: list
    suggested_source: str | None
    rows: list = field(default_factory=list)
    summary: dict = field(default_factory=dict)
    fingerprint: str | None = None
    warnings: list = field(default_factory=list)
    resolver: RateResolver | None = None

    def row_by_number(self):
        return {row.number: row for row in self.rows}


def _file_facts(table, file_name=''):
    return {
        'name': file_name, 'size': table.size, 'sha256': table.sha256, 'encoding': table.encoding,
        'delimiter': table.delimiter, 'rows': len(table.rows), 'header_line': table.header_line,
    }


def plan_payload(plan, file_name=''):
    """The preview response body."""
    table = plan.table
    body = {
        'file': _file_facts(table, file_name), 'source': plan.source, 'mapping': plan.mapping,
        'mapping_origin': plan.mapping_origin, 'needs_mapping': plan.needs_mapping, 'reasons': plan.reasons,
        'ambiguous_roles': plan.ambiguous_roles, 'suggested_source': plan.suggested_source,
        'headers': table.headers, 'sample_rows': [], 'rows': [], 'summary': None,
        'plan_fingerprint': None, 'warnings': plan.warnings,
    }
    if plan.needs_mapping:
        body['sample_rows'] = [
            [cell[:SAMPLE_CELL] for cell in row.cells] for row in table.rows[:SAMPLE_ROWS]
        ]
        return body
    body['rows'] = [row.to_json() for row in plan.rows]
    body['summary'] = plan.summary
    body['plan_fingerprint'] = plan.fingerprint
    return body


# ---------------------------------------------------------------------------------- duplicates

def _day_label(moment):
    return moment.strftime('%d %b %Y')


def _mark_exact_duplicates(user, source, rows):
    candidates = [row for row in rows if row.status in (c.STATUS_NEW, c.STATUS_UNSURE) and row.parsed.external_id]
    if not candidates:
        return
    seen_in_file = set()
    existing = {}
    ids = sorted({row.parsed.external_id for row in candidates})
    for start in range(0, len(ids), EXACT_QUERY_CHUNK):
        chunk = ids[start:start + EXACT_QUERY_CHUNK]
        # `user=user` is mandatory: another person's transaction ids must never matter.
        for payment_id, external_id, created_at in Payment.objects.filter(
            user=user, source=source, external_id__in=chunk,
        ).values_list('pk', 'external_id', 'created_at'):
            existing[external_id] = (payment_id, created_at)
    for row in candidates:
        external_id = row.parsed.external_id
        if external_id in seen_in_file:
            row.status, row.reason = c.STATUS_DUPLICATE_EXACT, 'This transaction appears twice in this file.'
            continue
        seen_in_file.add(external_id)
        if external_id in existing:
            payment_id, created_at = existing[external_id]
            row.status = c.STATUS_DUPLICATE_EXACT
            row.reason = f'Already imported on {_day_label(created_at)}.'
            row.match_ids = [payment_id]


def _mark_probable_duplicates(user, source, rows):
    candidates = [row for row in rows if row.status in (c.STATUS_NEW, c.STATUS_UNSURE)]
    if not candidates:
        return
    window = timedelta(days=PROBABLE_DUPLICATE_DAYS)
    dates = [row.parsed.payment_date for row in candidates]
    by_key = defaultdict(list)
    for payment_id, amount, currency, payment_date, existing_source, external_id, created_at in Payment.objects.filter(
        user=user,
        currency__in={row.parsed.currency for row in candidates},
        payment_date__gte=min(dates) - window,
        payment_date__lte=max(dates) + window,
    ).values_list('pk', 'amount', 'currency', 'payment_date', 'source', 'external_id', 'created_at'):
        by_key[(currency, amount)].append((payment_id, payment_date, existing_source, external_id, created_at))

    for row in candidates:
        parsed = row.parsed
        hits = []
        for payment_id, payment_date, existing_source, external_id, created_at in by_key.get((parsed.currency, parsed.amount), ()):
            distance = abs((payment_date - parsed.payment_date).days)
            if distance > PROBABLE_DUPLICATE_DAYS:
                continue
            provably_different = (
                existing_source == source and parsed.external_id and external_id and parsed.external_id != external_id
            )
            if provably_different:
                continue
            hits.append((distance, -created_at.timestamp(), payment_id))
        if hits:
            hits.sort()
            if row.status == c.STATUS_UNSURE:
                row.warnings.append(row.reason)
            row.status, row.reason = c.STATUS_DUPLICATE_PROBABLE, PROBABLE_REASON
            row.match_ids = [payment_id for _d, _n, payment_id in hits[:MAX_MATCHES]]


def _attach_match_details(user, rows):
    wanted = {payment_id for row in rows for payment_id in row.match_ids}
    if not wanted:
        return
    serialised = {
        item['id']: item for item in PaymentSerializer(payments_queryset(user).filter(pk__in=wanted), many=True).data
    }
    for row in rows:
        row.matches = [serialised[str(payment_id)] for payment_id in row.match_ids if str(payment_id) in serialised]


# --------------------------------------------------------------------------------------- summary

def _summary(rows):
    counts = {status: 0 for status in ALL_STATUSES}
    totals = defaultdict(lambda: Decimal('0.00'))
    selected = 0
    for row in rows:
        counts[row.status] += 1
        if row.selected:
            selected += 1
            totals[row.parsed.currency] += row.parsed.amount
    return {
        **counts, 'total': len(rows), 'to_import': selected,
        'total_to_import_by_currency': {currency: str(total) for currency, total in sorted(totals.items())},
    }


def _fingerprint(table, source, mapping, rows):
    document = {
        'file': table.sha256, 'source': source, 'mapping': mapping,
        'rows': [[row.number, row.status, [str(pid) for pid in row.match_ids]] for row in rows],
    }
    return hashlib.sha256(json.dumps(document, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


# ------------------------------------------------------------------------------------ the plan

def build_plan(user, raw, source, provided_mapping=None) -> Plan:
    """
    raw bytes + the person's choices -> Plan. `source` may be None only when the file is Wise's
    layout (the Wise source is then used). `provided_mapping` is the person's mapping as parsed JSON.
    """
    header_row = header_row_of(provided_mapping)
    table = read_table(raw, header_row)
    resolution = resolve_mapping(table, provided_mapping, user, header_row)
    wise = is_wise_file(table.headers)

    source = source or ('wise' if wise else None)
    if source not in PAYMENT_SOURCE_LABELS:
        raise ImportRefused('source_required', 'Choose where this money arrived (Wise, Payoneer, a bank...).')

    plan = Plan(
        table=table, source=source, mapping=resolution.mapping, mapping_origin=resolution.origin,
        needs_mapping=resolution.needs_mapping, reasons=resolution.reasons,
        ambiguous_roles=resolution.ambiguous_roles, suggested_source=resolution.suggested_source,
    )
    if resolution.date_order_assumed:
        plan.warnings.append({
            'code': 'date_order_assumed', 'order': resolution.date_order_assumed,
            'message': 'Dates are read day first (for example 08/11/2026 is 8 November 2026), the order Wise uses.',
        })
    if plan.needs_mapping:
        return plan

    plan.resolver = RateResolver()
    today = timezone.now().date()
    supported = plan.resolver.currencies()
    for row in table.rows:
        parsed = c.parse_row(row, table.headers, resolution.mapping, resolution.date_order, supported, today, wise)
        status, reason = c.classify_row(parsed, resolution.mapping, wise)
        plan.rows.append(PlanRow(
            number=row.number, line=row.line, status=status, reason=reason, parsed=parsed,
            warnings=list(parsed.warnings),
        ))

    _mark_exact_duplicates(user, source, plan.rows)
    _mark_probable_duplicates(user, source, plan.rows)
    _attach_match_details(user, plan.rows)
    plan.summary = _summary(plan.rows)
    plan.fingerprint = _fingerprint(table, source, resolution.mapping, plan.rows)
    return plan
