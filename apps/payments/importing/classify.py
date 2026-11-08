# apps/payments/importing/classify.py
"""
What kind of row is this? (decision I4: only money received is income.)

`parse_row` reads one file row into typed values using the mapping; `classify_row` gives it one of:
  new        - looks like money received from a client
  unsure     - might be, the person must decide (never selected by default)
  not_income - money going out, a conversion, a top-up, a fee, a refund, a pending/failed transfer
  invalid    - cannot be read; never importable
The two duplicate statuses are added later by plan.py (they need the database). Nothing here touches
the database. The Wise wording below is a best guess from the documented header, NOT from a real
export, so every rule that depends on it is conservative and shows its reason to the person.
"""
import re
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal

from apps.payments.constants import EARLIEST_PAYMENT_DATE
from apps.payments.importing.mapping import normalise_header
from apps.payments.importing.parsing import clean_external_id, clean_text, parse_amount, parse_date

STATUS_NEW = 'new'
STATUS_UNSURE = 'unsure'
STATUS_NOT_INCOME = 'not_income'
STATUS_INVALID = 'invalid'
STATUS_DUPLICATE_EXACT = 'duplicate_exact'
STATUS_DUPLICATE_PROBABLE = 'duplicate_probable'

COUNTERPARTY_LIMIT = 200
NOTES_LIMIT = 300
SHORTENED_WARNING = 'Text was shortened to fit.'

COMPLETED_STATUSES = frozenset(
    'completed complete successful success paid received settled approved processed done'.split()
)
PENDING_STATUSES = frozenset(
    {'pending', 'processing', 'in progress', 'on hold', 'held', 'scheduled', 'awaiting'}
)
FAILED_STATUSES = frozenset(
    'failed cancelled canceled declined rejected returned reversed refunded expired void'.split()
)

_WISE_NOT_INCOME_PREFIXES = (
    (re.compile(r'^converted\s'), 'Currency conversion between your own balances.'),
    (re.compile(r'^(?:added money|top up|topped up)'), 'Your own money added to Wise.'),
    (re.compile(r'^(?:wise charges|fees?\b)'), 'A fee.'),
    (re.compile(r'^refund'), 'A refund.'),
)
_WISE_RECEIVED_FROM = re.compile(r'received money from\s+(.*?)(?:\s+with reference\b|$)', re.IGNORECASE)
_GENERIC_NOT_PAYMENT = re.compile(
    r'\b(?:withdraw\w*|transfer to|fees?|refund\w*|reversal|conversion|converted|top up|card)\b', re.IGNORECASE,
)


@dataclass
class ParsedRow:
    """One file row, read but not yet judged. `problem` is the first reason it cannot be read."""
    number: int
    line: int
    amount: Decimal | None = None       # signed as it will be judged: > 0 money in, < 0 money out
    currency: str = ''
    payment_date: date | None = None
    status_text: str = ''
    description: str = ''
    counterparty: str = ''
    notes: str = ''
    external_id: str = ''
    problem: str | None = None
    warnings: list = field(default_factory=list)
    wise: dict = field(default_factory=dict)  # Description / Payer Name / Exchange From / Exchange To


def _cell(row, column_index):
    return row.cells[column_index].strip() if column_index is not None else ''


def _index(headers, name):
    return headers.index(name) if name else None


def _wise_header_index(headers, wanted):
    for position, header in enumerate(headers):
        if normalise_header(header) == wanted:
            return position
    return None


def parse_row(row, headers, mapping, order, supported_currencies, today, is_wise) -> ParsedRow:
    """Reads a Row into typed values. Never raises for bad data: it sets `problem`."""
    parsed = ParsedRow(number=row.number, line=row.line)
    col = {key: _index(headers, mapping[key]) for key in (
        'date', 'amount', 'credit', 'debit', 'currency', 'counterparty', 'description', 'notes', 'external_id', 'status',
    )}
    separator = mapping['decimal_separator']

    description, cut_description = clean_text(_cell(row, col['description']), 1000)
    parsed.description = description
    parsed.status_text = clean_text(_cell(row, col['status']), 200)[0]

    counterparty, cut_cp = clean_text(_cell(row, col['counterparty']), COUNTERPARTY_LIMIT)
    if not counterparty and is_wise:
        found = _WISE_RECEIVED_FROM.search(description)
        counterparty, cut_cp = clean_text(found.group(1) if found else '', COUNTERPARTY_LIMIT)
    notes_source = _cell(row, col['notes']) if mapping['notes'] else _cell(row, col['description'])
    notes, cut_notes = clean_text(notes_source, NOTES_LIMIT)
    parsed.counterparty, parsed.notes = counterparty, notes
    if cut_cp or cut_notes:
        parsed.warnings.append(SHORTENED_WARNING)

    external_id, id_warning = clean_external_id(_cell(row, col['external_id']))
    parsed.external_id = external_id
    if id_warning:
        parsed.warnings.append(id_warning)

    if is_wise:
        parsed.wise = {
            key: clean_text(_cell(row, _wise_header_index(headers, wanted)), 1000)[0]
            for key, wanted in (('description', 'description'), ('payer', 'payer name'),
                                ('exchange_from', 'exchange from'), ('exchange_to', 'exchange to'))
        }

    if row.too_many_cells:
        parsed.problem = 'The row has more cells than the header.'
        return parsed

    problem = _read_amount(parsed, row, col, mapping, separator)
    if problem:
        parsed.problem = problem
        return parsed

    parsed.payment_date = parse_date(_cell(row, col['date']), order)
    if parsed.payment_date is None:
        parsed.problem = 'The date could not be read.'
        return parsed
    if parsed.payment_date > today:
        parsed.problem = 'The date is in the future.'
        return parsed
    if parsed.payment_date < EARLIEST_PAYMENT_DATE:
        parsed.problem = f'The date is before {EARLIEST_PAYMENT_DATE.year}.'
        return parsed

    code = (mapping['fixed_currency'] or _cell(row, col['currency'])).strip().upper()
    parsed.currency = code
    if not code:
        parsed.problem = 'The currency is missing.'
    elif code not in supported_currencies:
        parsed.problem = f'The currency {clean_text(code, 10)[0]} is not supported.'
    return parsed


def _read_amount(parsed, row, col, mapping, separator):
    """Sets parsed.amount (signed). Returns a problem sentence or None."""
    if mapping['amount_mode'] == 'separate':
        credit_text, debit_text = _cell(row, col['credit']), _cell(row, col['debit'])
        credit = parse_amount(credit_text, separator) if credit_text else Decimal('0.00')
        debit = parse_amount(debit_text, separator) if debit_text else Decimal('0.00')
        if credit is None or debit is None:
            return 'The amount could not be read.'
        if credit != 0 and debit != 0:
            return 'Both money in and money out are filled.'
        if credit < 0:
            return 'Amount must be greater than zero.'
        if credit > 0:
            parsed.amount = credit
        elif debit != 0:
            parsed.amount = -abs(debit)
        else:
            return 'There is no amount.'
        return None
    text = _cell(row, col['amount'])
    if not text:
        return 'There is no amount.'
    amount = parse_amount(text, separator)
    if amount is None:
        return 'The amount could not be read.'
    parsed.amount = amount
    return None


def classify_row(parsed, mapping, is_wise):
    """-> (status, reason). Order matters: unreadable, direction, status column, Wise, generic."""
    if parsed.problem:
        return STATUS_INVALID, parsed.problem

    amount = parsed.amount
    if mapping['amount_mode'] == 'all_income':
        if amount <= 0:
            return STATUS_INVALID, 'Amount must be greater than zero.'
    elif amount < 0:
        return STATUS_NOT_INCOME, 'Money going out.'
    elif amount == 0:
        return STATUS_NOT_INCOME, 'Zero amount.'

    state = parsed.status_text.strip().lower()
    if state:
        if state in PENDING_STATUSES:
            return STATUS_NOT_INCOME, f'Not completed yet ({clean_text(state, 40)[0]}). Import it once it completes.'
        if state in FAILED_STATUSES:
            return STATUS_NOT_INCOME, f'Cancelled or failed ({clean_text(state, 40)[0]}).'
        if state not in COMPLETED_STATUSES:
            return STATUS_UNSURE, f'The status "{clean_text(parsed.status_text, 40)[0]}" is not one I recognise.'

    if is_wise:
        return _classify_wise(parsed)

    if _GENERIC_NOT_PAYMENT.search(parsed.description):
        return STATUS_UNSURE, 'Looks like a withdrawal, fee or refund. Check it is a client payment.'
    return STATUS_NEW, ''


def _classify_wise(parsed):
    description = parsed.wise.get('description', '').lower()
    for pattern, reason in _WISE_NOT_INCOME_PREFIXES:
        if pattern.match(description):
            return STATUS_NOT_INCOME, reason
    if parsed.wise.get('payer') or description.startswith('received'):
        return STATUS_NEW, ''
    if parsed.wise.get('exchange_from') and parsed.wise.get('exchange_to'):
        return STATUS_UNSURE, 'Converted from another currency. Check it is a client payment.'
    return STATUS_UNSURE, 'Not sure this is a payment from a client.'
