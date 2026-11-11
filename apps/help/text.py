# apps/help/text.py
"""
Text tools for a person's question (Prompt 24, Part 3): normalise, strip markup, redact. Pure: no Django, no apps.*.
What leaves the server for the model is the output of redact(strip_markup(normalise(question))) and nothing else (decision H7).
"""
import re
import unicodedata
from dataclasses import dataclass

REMOVED_WORD = '(removed)'

_WS_RE = re.compile(r'\s+')
_EMAIL_RE = re.compile(r'[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)+')
_TLDS = r'(?:com|pk|io|org|net|co|app|dev|me|info|biz|edu|gov|ai|xyz|us|uk)'
_URL_RE = re.compile(
    r'(?:https?://\S+|www\.\S+|\b[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)*\.' + _TLDS + r'\b(?:/\S*)?)', re.IGNORECASE)
# seven or more digits, with single spaces, dashes or dots allowed between them, and an optional leading plus
# (a letter and a dash right before the run - "INV-2026-0042" - means an invoice-style id, which is not removed)
_DIGIT_RUN_RE = re.compile(r'(?<![A-Za-z0-9])(?<![A-Za-z]-)\+?\d(?:[ \-.]?\d){6,}(?![A-Za-z0-9])')
# 24+ unbroken characters: letters/digits/underscore (an IBAN, a key), or with hyphens only when a digit is in it
# (sk-... keys), so an ordinary long hyphenated phrase is not mistaken for a secret.
_LONG_TOKEN_RE = re.compile(r'(?=[A-Za-z0-9_\-]*\d)[A-Za-z0-9_\-]{24,}|[A-Za-z0-9_]{24,}')


def normalise(text):
    """None / non-string -> ''. NFKC; every control character and line break becomes a space; whitespace collapsed; stripped."""
    if not isinstance(text, str):
        return ''
    text = unicodedata.normalize('NFKC', text)
    text = ''.join(' ' if unicodedata.category(ch).startswith('C') or ch in '\n\r\t  ' else ch for ch in text)
    return _WS_RE.sub(' ', text).strip()


def strip_markup(text):
    """Removes < > and backticks entirely: a question has no use for them, and without them no delimiter tag can be forged."""
    return re.sub(r'[<>`]', '', text or '')


@dataclass(frozen=True)
class Redacted:
    for_model: str
    for_search: str
    redacted: bool


def redact(text):
    """
    Replaces email addresses, web addresses, digit runs (seven or more digits), and long unbroken tokens (24+ letters/digits).
    `for_model` uses the word "(removed)"; `for_search` uses a space, so a redaction never matches a guide.
    Short numbers ("3 invoices", "2026") and invoice-style ids are untouched.
    """
    changed = False

    def apply(value, replacement):
        nonlocal changed
        for rx in (_EMAIL_RE, _URL_RE, _DIGIT_RUN_RE, _LONG_TOKEN_RE):
            value, n = rx.subn(replacement, value)
            changed = changed or n > 0
        return value

    base = text or ''
    model = _WS_RE.sub(' ', apply(base, REMOVED_WORD)).strip()
    changed_model = changed
    search = _WS_RE.sub(' ', apply(base, ' ')).strip()
    return Redacted(for_model=model.replace('<', '').replace('>', '').replace('`', ''), for_search=search,
                    redacted=changed_model)


def phrase_regex(phrase):
    """Whole-word, case-insensitive match of a word or phrase (a letter next to it on either side is not a match)."""
    return re.compile(r'(?<![A-Za-z])' + re.escape(phrase) + r'(?![A-Za-z])', re.IGNORECASE)
