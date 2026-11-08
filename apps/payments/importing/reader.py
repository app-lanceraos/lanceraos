# apps/payments/importing/reader.py
"""
bytes -> Table. The only place that decides what a "readable file" is.

Rules (decision I10): at most 2 MiB, 2,000 data rows and 60 columns; a cell is cut at 2,000 characters;
UTF-8 (with or without a BOM) else Windows-1252; UTF-16, .xlsx (zip), PDF and anything containing a NUL
byte are refused with a sentence that says what to do instead. The delimiter is chosen by counting the
columns each candidate gives on the first lines, never by csv.Sniffer. Nothing here ever echoes a cell
into an error message.
"""
import csv
import hashlib
import io
from dataclasses import dataclass, field

from apps.payments.constants import IMPORT_MAX_BYTES, IMPORT_MAX_CELL, IMPORT_MAX_COLUMNS, IMPORT_MAX_ROWS
from apps.payments.importing.errors import ImportFileError

DELIMITERS = (('comma', ','), ('semicolon', ';'), ('tab', '\t'), ('pipe', '|'))
# How many leading lines are looked at when choosing the delimiter and the header row.
HEADER_SEARCH_LINES = 20
MAX_HEADER_ROW = 20

ZIP_MAGIC = b'PK\x03\x04'
PDF_MAGIC = b'%PDF'
UTF16_BOMS = (b'\xff\xfe', b'\xfe\xff')

# Raised by csv when a field is longer than csv.field_size_limit: twice the cell cap, so a cell between
# 2,000 and 4,000 characters is cut (below) and a longer one means the file is not a payments file.
FIELD_SIZE_LIMIT = IMPORT_MAX_CELL * 2


@dataclass(frozen=True)
class Row:
    number: int          # 1-based among the data rows (what the person sees in the preview)
    line: int            # 1-based line of the file where the row starts
    cells: tuple         # padded or trimmed to exactly len(headers)
    too_many_cells: bool  # the row had extra, non-empty cells beyond the header


@dataclass
class Table:
    headers: list
    rows: list
    delimiter: str
    encoding: str
    sha256: str
    header_signature: str
    header_line: int
    size: int = 0
    extra: dict = field(default_factory=dict)


def _refuse(code, message):
    raise ImportFileError(code, message)


def _check_bytes(raw):
    if not raw:
        _refuse('empty_file', 'The file is empty.')
    if len(raw) > IMPORT_MAX_BYTES:
        _refuse('file_too_large', 'This file is larger than 2 MB. Split it by year and import each part.')
    if raw.startswith(ZIP_MAGIC):
        _refuse('excel_file', 'That looks like an Excel file. In Excel choose File, Save as, CSV, then upload that.')
    if raw.startswith(PDF_MAGIC):
        _refuse('pdf_file', 'That is a PDF. Download the CSV version of your statement instead.')
    if raw.startswith(UTF16_BOMS):
        _refuse('utf16_file', 'Save the file as CSV (UTF-8) and upload that.')
    if b'\x00' in raw:
        _refuse('binary_file', 'That does not look like a CSV text file. Save it as CSV (UTF-8) and upload that.')


def _decode(raw):
    try:
        return raw.decode('utf-8-sig'), 'utf-8'
    except UnicodeDecodeError:
        pass
    try:
        return raw.decode('cp1252'), 'windows-1252'
    except UnicodeDecodeError:
        _refuse('bad_encoding', 'The file could not be read as text. Save it as CSV (UTF-8) and upload that.')


def _strip_sep_line(text):
    """Excel writes `sep=,` as a first line. Returns (text without it, number of lines removed)."""
    first, _newline, rest = text.partition('\n')
    if first.strip().lower().startswith('sep=') and len(first.strip()) <= 6:
        return rest, 1
    return text, 0


def _records(text, delimiter, line_base):
    """Yields (start_line, cells) for every record. csv.Error becomes a refusal."""
    csv.field_size_limit(FIELD_SIZE_LIMIT)
    reader = csv.reader(io.StringIO(text, newline=''), delimiter=delimiter, strict=False)
    previous_end = 0
    try:
        for cells in reader:
            start = previous_end + 1
            previous_end = reader.line_num
            yield line_base + start, cells
    except csv.Error:
        _refuse('bad_csv', 'The file could not be read as CSV. Save it as CSV (UTF-8) and upload that.')


def _is_blank(cells):
    return all(not cell.strip() for cell in cells)


def _non_empty_count(cells):
    return sum(1 for cell in cells if cell.strip())


def _header_candidate(records, header_row):
    """The (line, cells) record that holds the header, or None."""
    if header_row is not None:
        for line, cells in records:
            if line == header_row:
                return line, cells
            if line > header_row:
                return None
        return None
    for line, cells in records:
        if _non_empty_count(cells) >= 2:
            return line, cells
    return None


def _choose_delimiter(text, line_base, header_row):
    """Delimiter giving the most columns on the header candidate (>= 2; ties go to the comma)."""
    head = '\n'.join(text.split('\n')[:HEADER_SEARCH_LINES + (header_row or 0)])
    best_name, best_char, best_columns = None, None, 1
    for name, char in DELIMITERS:
        records = [
            (line, cells) for line, cells in _records(head, char, line_base) if not _is_blank(cells)
        ]
        candidate = _header_candidate(records, header_row)
        columns = len(candidate[1]) if candidate else 0
        if columns > best_columns:
            best_name, best_char, best_columns = name, char, columns
    if best_char is None:
        _refuse('no_columns', 'No columns were found. Check that the file is a CSV with a header row.')
    return best_name, best_char


def _clean_headers(cells):
    headers, seen = [], {}
    for position, cell in enumerate(cells, start=1):
        name = ' '.join(cell.split()) or f'Column {position}'
        key = name.lower()
        seen[key] = seen.get(key, 0) + 1
        if seen[key] > 1:
            name = f'{name} ({seen[key]})'
        headers.append(name)
    return headers


def header_signature_of(headers):
    """SHA-256 of the lower-cased header names: the same layout from the same provider gives the same signature."""
    return hashlib.sha256('\n'.join(h.lower() for h in headers).encode('utf-8')).hexdigest()


def read_table(raw: bytes, header_row=None) -> Table:
    """
    Turns an uploaded file into a Table. `header_row` is the 1-based LINE of the file that holds the
    header (1-20); None means the first line with at least two filled cells.
    """
    if header_row is not None and not (1 <= header_row <= MAX_HEADER_ROW):
        _refuse('bad_header_row', 'The header row must be a line number from 1 to 20.')
    _check_bytes(raw)
    text, encoding = _decode(raw)
    text, line_base = _strip_sep_line(text)

    delimiter_name, delimiter = _choose_delimiter(text, line_base, header_row)

    headers, header_line, rows = None, None, []
    for line, cells in _records(text, delimiter, line_base):
        if headers is None:
            if header_row is not None:
                if line < header_row:
                    continue
                if line > header_row:
                    _refuse('no_header', f'Line {header_row} is empty, so it cannot be the header row.')
            elif _non_empty_count(cells) < 2:
                continue
            if len(cells) > IMPORT_MAX_COLUMNS:
                _refuse('too_many_columns', 'This file has more than 60 columns, so it is probably not a payments statement.')
            headers, header_line = _clean_headers(cells), line
            continue
        if _is_blank(cells):
            continue
        if len(rows) >= IMPORT_MAX_ROWS:
            _refuse('too_many_rows', 'This file has more than 2,000 rows. Split it by year and import each part.')
        cells = [cell[:IMPORT_MAX_CELL] for cell in cells]
        width = len(headers)
        extra = any(cell.strip() for cell in cells[width:])
        padded = tuple((cells + [''] * width)[:width])
        rows.append(Row(number=len(rows) + 1, line=line, cells=padded, too_many_cells=extra))

    if headers is None:
        _refuse('no_header', 'No header row was found. The first line with column names should have at least two columns.')
    if not rows:
        _refuse('no_rows', 'No payments found below the header row.')

    return Table(
        headers=headers, rows=rows, delimiter=delimiter_name, encoding=encoding,
        sha256=hashlib.sha256(raw).hexdigest(), header_signature=header_signature_of(headers),
        header_line=header_line, size=len(raw),
    )
