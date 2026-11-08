# apps/payments/importing/mapping.py
"""
Which column of the file is what (decision I1: one engine, three doors).

A mapping is plain JSON that references columns by HEADER NAME, never by a row value. It comes from
(1) the person (`provided`), (2) the Wise preset, recognised by its exact headers, (3) the person's
last import of a file with the same headers, or (4) alias detection. Anything not certain is reported
as `needs_mapping` with machine-readable reasons instead of being guessed.

`Source` and `Target` are never auto-mapped: they are documented Payoneer column names whose meaning
we do not know.
"""
import re
from dataclasses import dataclass, field

from rest_framework import serializers

from apps.payments.importing.errors import ImportRefused
from apps.payments.importing.parsing import detect_date_order
from apps.payments.models import PaymentImportBatch
from apps.payments.validators import validate_currency_code

DATE_FORMATS = ('auto', 'ymd', 'dmy', 'mdy')
AMOUNT_MODES = ('signed', 'separate', 'all_income')

# Mapping keys that name a column of the file.
COLUMN_KEYS = (
    'date', 'amount', 'credit', 'debit', 'currency', 'counterparty', 'description', 'notes',
    'external_id', 'status',
)

ORIGIN_PROVIDED = 'provided'
ORIGIN_WISE = 'wise_preset'
ORIGIN_PREVIOUS = 'previous_import'
ORIGIN_DETECTED = 'detected'

WISE_REQUIRED_HEADERS = ('transferwise id', 'date', 'amount', 'currency', 'description')

REASON_NO_DATE = 'no_date'
REASON_NO_AMOUNT = 'no_amount'
REASON_NO_CURRENCY = 'no_currency'
REASON_AMBIGUOUS_COLUMNS = 'ambiguous_columns'
REASON_DATE_AMBIGUOUS = 'date_format_ambiguous'

# role -> header names (after normalising) that mean it.
ALIASES = {
    'date': (
        'date', 'transaction date', 'payment date', 'date received', 'created', 'created on', 'completed on',
        'value date', 'booking date',
    ),
    'amount': ('amount', 'net amount', 'amount received', 'payment amount', 'received'),
    'credit': ('credit', 'credits', 'deposit', 'money in', 'paid in'),
    'debit': ('debit', 'withdrawal', 'money out', 'paid out'),
    'currency': ('currency', 'ccy', 'currency code'),
    'description': ('description', 'details', 'narrative', 'additional description', 'transaction description'),
    'counterparty': ('payer', 'payer name', 'sender', 'sender name', 'client', 'customer', 'received from'),
    'notes': ('reference', 'payment reference', 'note', 'notes', 'memo'),
    'external_id': ('id', 'transaction id', 'reference id', 'txn id', 'payment id', 'transfer id'),
    'status': ('status', 'state'),
}


def normalise_header(name):
    """'  Payment   Reference ' / 'payment_reference' -> 'payment reference'."""
    return re.sub(r'[^a-z0-9]+', ' ', name.lower()).strip()


def empty_mapping():
    mapping = {key: None for key in COLUMN_KEYS}
    mapping.update(header_row=None, date_format='auto', amount_mode='signed', decimal_separator='.', fixed_currency=None)
    return mapping


# --------------------------------------------------------------------------------------- validation

class ImportMappingSerializer(serializers.Serializer):
    """
    Validates a mapping against the file's real headers (pass them as context['headers']): every named
    column must exist, exactly one of currency / fixed_currency, and the amount columns that the
    chosen amount_mode needs.
    """
    header_row = serializers.IntegerField(required=False, allow_null=True, min_value=1, max_value=20, default=None)
    date_format = serializers.ChoiceField(choices=DATE_FORMATS, required=False, default='auto')
    amount_mode = serializers.ChoiceField(choices=AMOUNT_MODES, required=False, default='signed')
    decimal_separator = serializers.ChoiceField(choices=('.', ','), required=False, default='.')
    fixed_currency = serializers.CharField(required=False, allow_null=True, allow_blank=True, default=None, max_length=3)
    date = serializers.CharField(required=False, allow_null=True, allow_blank=True, default=None)
    amount = serializers.CharField(required=False, allow_null=True, allow_blank=True, default=None)
    credit = serializers.CharField(required=False, allow_null=True, allow_blank=True, default=None)
    debit = serializers.CharField(required=False, allow_null=True, allow_blank=True, default=None)
    currency = serializers.CharField(required=False, allow_null=True, allow_blank=True, default=None)
    counterparty = serializers.CharField(required=False, allow_null=True, allow_blank=True, default=None)
    description = serializers.CharField(required=False, allow_null=True, allow_blank=True, default=None)
    notes = serializers.CharField(required=False, allow_null=True, allow_blank=True, default=None)
    external_id = serializers.CharField(required=False, allow_null=True, allow_blank=True, default=None)
    status = serializers.CharField(required=False, allow_null=True, allow_blank=True, default=None)

    def validate(self, attrs):
        headers = set(self.context['headers'])
        for key in COLUMN_KEYS:
            attrs[key] = (attrs.get(key) or '').strip() or None
            if attrs[key] is not None and attrs[key] not in headers:
                raise serializers.ValidationError({key: 'That column is not in the file.'})
        fixed = (attrs.get('fixed_currency') or '').strip() or None
        if bool(attrs['currency']) == bool(fixed):
            raise serializers.ValidationError('Choose either a currency column or one fixed currency, not both or neither.')
        attrs['fixed_currency'] = validate_currency_code(fixed) if fixed else None
        if not attrs['date']:
            raise serializers.ValidationError({'date': 'Choose the date column.'})
        if attrs['amount_mode'] == 'separate':
            if not attrs['credit']:
                raise serializers.ValidationError({'credit': 'Choose the money-in column.'})
        elif not attrs['amount']:
            raise serializers.ValidationError({'amount': 'Choose the amount column.'})
        return attrs


def _first_error(detail):
    if isinstance(detail, dict):
        for value in detail.values():
            return _first_error(value)
    if isinstance(detail, (list, tuple)):
        return _first_error(detail[0]) if detail else 'The mapping is not valid.'
    return str(detail)


def validate_mapping(data, headers):
    """-> the normalised mapping dict, or ImportRefused('bad_mapping') with one plain sentence."""
    if not isinstance(data, dict):
        raise ImportRefused('bad_mapping', 'The column mapping must be an object.')
    serializer = ImportMappingSerializer(data=data, context={'headers': headers})
    try:
        valid = serializer.is_valid()
    except Exception:  # noqa: BLE001 - a validator must never turn into a 500 on odd input
        valid = False
    if not valid:
        raise ImportRefused('bad_mapping', _first_error(serializer.errors))
    return dict(serializer.validated_data)


def header_row_of(provided):
    """The header_row the person asked for (validated), or None. Needed BEFORE the file is read."""
    if not isinstance(provided, dict):
        return None
    value = provided.get('header_row')
    if value in (None, ''):
        return None
    if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= 20:
        raise ImportRefused('bad_mapping', 'The header row must be a line number from 1 to 20.')
    return value


# ------------------------------------------------------------------------------------- resolution

@dataclass
class Resolution:
    mapping: dict
    origin: str
    reasons: list = field(default_factory=list)
    ambiguous_roles: list = field(default_factory=list)
    suggested_source: str | None = None
    date_order: str | None = None
    date_order_assumed: str | None = None

    @property
    def needs_mapping(self):
        return bool(self.reasons)


def is_wise_file(headers):
    """True when the headers are Wise's statement layout (case-insensitive)."""
    normalised = {normalise_header(h) for h in headers}
    return all(required in normalised for required in WISE_REQUIRED_HEADERS)


def _find(headers, wanted):
    """The real header whose normalised form equals `wanted` (case-insensitive), or None."""
    for header in headers:
        if normalise_header(header) == wanted:
            return header
    return None


def wise_preset_mapping(headers, header_row):
    mapping = empty_mapping()
    mapping.update(
        header_row=header_row, date=_find(headers, 'date'), amount=_find(headers, 'amount'),
        currency=_find(headers, 'currency'), description=_find(headers, 'description'),
        external_id=_find(headers, 'transferwise id'), counterparty=_find(headers, 'payer name'),
        notes=_find(headers, 'payment reference'), date_format='auto', amount_mode='signed',
    )
    return mapping


def _detect_aliases(headers):
    """-> (role -> header or None, ambiguous roles). A role is ambiguous when two headers fit it or
    one of its headers also fits another role."""
    roles_of = {header: [role for role, names in ALIASES.items() if normalise_header(header) in names] for header in headers}
    chosen, ambiguous = {}, []
    for role in ALIASES:
        matches = [header for header in headers if role in roles_of[header]]
        crossed = any(len(roles_of[header]) > 1 for header in matches)
        if len(matches) == 1 and not crossed:
            chosen[role] = matches[0]
        else:
            chosen[role] = None
            if matches:
                ambiguous.append(role)
    return chosen, ambiguous


def _previous_mapping(user, table, header_row):
    """The newest earlier batch of THIS user with the same header signature, re-validated against
    the current headers (column names may differ in case only). None when unusable."""
    batch = (
        PaymentImportBatch.objects.filter(user=user, header_signature=table.header_signature)
        .order_by('-created_at').first()
    )
    if batch is None or not isinstance(batch.mapping, dict):
        return None
    by_lower = {h.lower(): h for h in table.headers}
    remapped = dict(batch.mapping)
    for key in COLUMN_KEYS:
        name = remapped.get(key)
        if name:
            remapped[key] = by_lower.get(name.lower(), name)
    remapped['header_row'] = header_row
    try:
        return validate_mapping(remapped, table.headers)
    except ImportRefused:
        return None


def _missing_reasons(mapping):
    reasons = []
    if not mapping['date']:
        reasons.append(REASON_NO_DATE)
    if not (mapping['amount'] or mapping['credit']):
        reasons.append(REASON_NO_AMOUNT)
    if not (mapping['currency'] or mapping['fixed_currency']):
        reasons.append(REASON_NO_CURRENCY)
    return reasons


def _resolve_date_order(table, mapping, assume_dmy):
    """-> (order to parse with, reason or None, assumed order or None). Writes an assumed order into
    the mapping so that confirming with the returned mapping needs no second guess."""
    fmt = mapping['date_format']
    if fmt != 'auto':
        return fmt, None, None
    if not mapping['date']:
        return 'ymd', None, None
    column = table.headers.index(mapping['date'])
    detected = detect_date_order(row.cells[column] for row in table.rows)
    if detected == 'ambiguous':
        if assume_dmy:
            mapping['date_format'] = 'dmy'
            return 'dmy', None, 'dmy'
        return None, REASON_DATE_AMBIGUOUS, None
    # None = the column contradicts itself: parse as year-first only, every other row is `invalid`.
    return detected or 'ymd', None, None


def resolve_mapping(table, provided, user, header_row=None) -> Resolution:
    """
    Picks the mapping for this file in the documented order. `provided` is the person's own mapping
    (unvalidated JSON) or None.
    """
    wise = is_wise_file(table.headers)
    ambiguous_roles = []

    if provided is not None:
        mapping, origin = validate_mapping({**provided, 'header_row': header_row}, table.headers), ORIGIN_PROVIDED
    elif wise:
        mapping, origin = wise_preset_mapping(table.headers, header_row), ORIGIN_WISE
    elif (previous := _previous_mapping(user, table, header_row)) is not None:
        mapping, origin = previous, ORIGIN_PREVIOUS
    else:
        chosen, ambiguous_roles = _detect_aliases(table.headers)
        mapping = empty_mapping()
        mapping.update(chosen)
        mapping['header_row'] = header_row
        mapping['amount_mode'] = 'separate' if (chosen['credit'] and not chosen['amount']) else 'signed'
        origin = ORIGIN_DETECTED

    reasons = _missing_reasons(mapping)
    if ambiguous_roles:
        reasons.append(REASON_AMBIGUOUS_COLUMNS)
    order, date_reason, assumed = _resolve_date_order(table, mapping, assume_dmy=wise)
    if date_reason and REASON_DATE_AMBIGUOUS not in reasons:
        reasons.append(date_reason)

    return Resolution(
        mapping=mapping, origin=origin, reasons=reasons, ambiguous_roles=ambiguous_roles,
        suggested_source='wise' if wise else None, date_order=order, date_order_assumed=assumed,
    )
