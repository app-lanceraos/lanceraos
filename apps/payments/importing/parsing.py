# apps/payments/importing/parsing.py
"""
Text -> typed values. Pure functions, no database, no clock. Money is Decimal and a date is a
datetime.date; a value that cannot be read becomes None, never a guess (decision I6).
"""
import re
import unicodedata
from datetime import date
from decimal import Decimal

CENT = Decimal('0.01')
MAX_WHOLE_DIGITS = 10

# ---------------------------------------------------------------------------------------- amounts

_SYMBOLS = '$€£'
_AMOUNT_RE = re.compile(
    r'^(?P<open>\()?\s*(?P<sign1>[+-])?\s*(?P<sym1>[' + _SYMBOLS + r'])?\s*(?P<sign2>[+-])?\s*'
    r'(?P<number>[0-9.,]+)\s*(?P<sym2>[' + _SYMBOLS + r'])?\s*(?P<close>\))?$'
)


def _parse_number(number, decimal_separator):
    """'1,234.56' -> Decimal, or None when the digits, separators or grouping are wrong."""
    thousands = ',' if decimal_separator == '.' else '.'
    if number.count(decimal_separator) > 1:
        return None
    whole, _sep, fraction = number.partition(decimal_separator)
    if _sep and not (1 <= len(fraction) <= 2 and fraction.isdigit()):
        return None
    if thousands in whole:
        if not re.fullmatch(r'\d{1,3}(?:' + re.escape(thousands) + r'\d{3})+', whole):
            return None
        whole = whole.replace(thousands, '')
    elif whole and not whole.isdigit():
        return None
    if not whole:
        if not _sep:
            return None
        whole = '0'
    if len(whole) > MAX_WHOLE_DIGITS:
        return None
    return Decimal(f'{whole}.{fraction or "0"}').quantize(CENT)


def parse_amount(text, decimal_separator='.'):
    """
    Accepts 1234.56, 1,234.56, (100.00) as negative, a leading + or -, and one $, € or £ with
    spaces (NBSP and thin spaces included) around it. With decimal_separator=',' the roles of ','
    and '.' swap. Thousands separators only in correct groups of three. Letters, other symbols,
    more than 2 decimals, more than 10 whole digits and scientific notation give None.
    """
    if text is None:
        return None
    match = _AMOUNT_RE.match(text.strip())
    if not match:
        return None
    parts = match.groupdict()
    if bool(parts['open']) != bool(parts['close']):
        return None
    if parts['sign1'] and parts['sign2']:
        return None
    if parts['sym1'] and parts['sym2']:
        return None
    sign = parts['sign1'] or parts['sign2']
    if parts['open'] and sign:
        return None
    value = _parse_number(parts['number'], decimal_separator)
    if value is None:
        return None
    return -value if (sign == '-' or parts['open']) else value


# ------------------------------------------------------------------------------------------ dates

_MONTHS = {
    name: number for number, names in enumerate([
        ('jan', 'january'), ('feb', 'february'), ('mar', 'march'), ('apr', 'april'), ('may',), ('jun', 'june'),
        ('jul', 'july'), ('aug', 'august'), ('sep', 'sept', 'september'), ('oct', 'october'),
        ('nov', 'november'), ('dec', 'december'),
    ], start=1) for name in names
}

_TIME_TAIL = re.compile(
    r'(?:[T\s]+\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?\s*(?:[AaPp][Mm])?\s*(?:Z|UTC|GMT|[+-]\d{2}:?\d{2})?)$'
)
_YMD = re.compile(r'^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$')
_NUMERIC = re.compile(r'^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$')
_DAY_MONTH_NAME = re.compile(r'^(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})$')
_MONTH_NAME_DAY = re.compile(r'^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$')


def _strip_time(text):
    """The date part as written: a trailing time is dropped with NO time-zone conversion."""
    text = ' '.join(text.split())
    return _TIME_TAIL.sub('', text).strip()


def _make_date(year, month, day):
    try:
        return date(year, month, day)
    except ValueError:
        return None


def parse_date(text, order):
    """
    `order` is 'ymd', 'dmy' or 'mdy' and only matters for the all-numeric d/m/y shapes (a month
    written as a name, or a year-first date, is unambiguous). Returns None when unreadable.
    """
    if text is None:
        return None
    cleaned = _strip_time(text)
    if not cleaned:
        return None
    if match := _YMD.match(cleaned):
        return _make_date(int(match[1]), int(match[2]), int(match[3]))
    if match := _NUMERIC.match(cleaned):
        first, second, year = int(match[1]), int(match[2]), int(match[3])
        if order == 'dmy':
            return _make_date(year, second, first)
        if order == 'mdy':
            return _make_date(year, first, second)
        return None
    if match := _DAY_MONTH_NAME.match(cleaned):
        month = _MONTHS.get(match[2].lower())
        return _make_date(int(match[3]), month, int(match[1])) if month else None
    if match := _MONTH_NAME_DAY.match(cleaned):
        month = _MONTHS.get(match[1].lower())
        return _make_date(int(match[3]), month, int(match[2])) if month else None
    return None


def detect_date_order(values):
    """
    Which numeric order a column of dates uses: 'ymd', 'dmy', 'mdy', 'ambiguous' (every numeric date
    has both parts <= 12) or None (the column contradicts itself, or has nothing readable). Values
    that match no date shape are ignored here: the row itself will be reported as unreadable.
    """
    has_ymd = has_numeric = has_named = False
    day_first_evidence = month_first_evidence = False
    for value in values:
        cleaned = _strip_time(value or '')
        if not cleaned:
            continue
        if _YMD.match(cleaned):
            has_ymd = True
        elif match := _NUMERIC.match(cleaned):
            has_numeric = True
            first, second = int(match[1]), int(match[2])
            day_first_evidence |= first > 12
            month_first_evidence |= second > 12
        elif _DAY_MONTH_NAME.match(cleaned) or _MONTH_NAME_DAY.match(cleaned):
            has_named = True
    if has_ymd and has_numeric:
        return None
    if has_ymd:
        return 'ymd'
    if not has_numeric:
        return 'ymd' if has_named else None
    if day_first_evidence and month_first_evidence:
        return None
    if day_first_evidence:
        return 'dmy'
    if month_first_evidence:
        return 'mdy'
    return 'ambiguous'


# ------------------------------------------------------------------------------------------ text

_LAYOUT_WHITESPACE = {ord(c): ' ' for c in '\n\r\t\x0b\x0c\x85'}
_DROPPED_CATEGORIES = {'Cc', 'Cf', 'Cs'}


def clean_text(text, limit):
    """
    -> (clean text, was_cut). NFC-normalises, turns line breaks and tabs into a space, DROPS every
    other control, format (bidi override, zero-width, BOM) and surrogate character, collapses runs
    of whitespace, strips, and cuts at `limit`. The result is stored as typed otherwise: React
    escapes it on screen, so a leading = + - @ is not altered here.
    """
    text = unicodedata.normalize('NFC', text or '').translate(_LAYOUT_WHITESPACE)
    text = ''.join(ch for ch in text if unicodedata.category(ch) not in _DROPPED_CATEGORIES)
    text = ' '.join(text.split())
    if len(text) > limit:
        return text[:limit].rstrip(), True
    return text, False


_EXCEL_DAMAGED_ID = re.compile(r'^\d(?:\.\d+)?[eE]\+\d+$')
EXTERNAL_ID_LIMIT = 100


def clean_external_id(text):
    """
    -> (id, warning or None). An id Excel turned into scientific notation (1.23E+15) has lost its
    digits for good, so it is NOT used for duplicate checking.
    """
    cleaned, _cut = clean_text(text, 10_000)
    if _EXCEL_DAMAGED_ID.match(cleaned):
        return '', 'The transaction id looks damaged by Excel and was not used to check for duplicates.'
    if len(cleaned) > EXTERNAL_ID_LIMIT:
        return cleaned[:EXTERNAL_ID_LIMIT], 'The transaction id was shortened to 100 characters.'
    return cleaned, None
