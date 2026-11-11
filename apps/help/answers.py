# apps/help/answers.py
"""
What happens to the model's reply (Prompt 24, Part 5): parse the delimited format, check the words (the GUARD), and turn the
text into typed blocks. The guard is the last line before anything is shown: a failed guard discards the model's text
(service.answer_question then shows the guides instead). The model's text never carries a link, a path or a number it was
not given (decisions H3 and H4). Pure apart from importing core.ai's reply-wrapper stripper; no database, no network.
"""
import re
from dataclasses import dataclass

from core.ai import strip_model_reply_wrapper

from . import constants as c
from .text import phrase_regex

_STATUS_RE = re.compile(r'^\s*STATUS\s*:\s*(ANSWER|NOT_COVERED|OFF_TOPIC)\s*$', re.IGNORECASE)
_ANSWER_RE = re.compile(r'^\s*ANSWER\s*:\s?(.*)$', re.IGNORECASE)
_SOURCES_RE = re.compile(r'^\s*SOURCES\s*:\s*(.*)$', re.IGNORECASE)
_END_RE = re.compile(r'^\s*===\s*END\s*===\s*$', re.IGNORECASE)
_STEP_RE = re.compile(r'^\s*(\d+)[.)]\s+(.*\S)\s*$')
_STEP_MARKER_RE = re.compile(r'(?m)^\s*\d+[.)]\s')

_NUMBER_RE = re.compile(r'\d+(?:[.,]\d+)*')
_WORD_RE = re.compile(r'[a-z]+')
_URL_RE = re.compile(r'https?://|www\.|[A-Za-z0-9\-]+\.(?:com|pk|io|org|net|co|app|dev|me|info|biz|edu|gov|ai)\b', re.IGNORECASE)
_EMAIL_RE = re.compile(r'\S+@\S+')
_PATH_RE = re.compile(r'(?<![\w/])/[A-Za-z]')
_ACTION_RE = re.compile(
    r"\bI(?:\s+have\s+|['\u2019]ve\s+|\s+)(?:created|deleted|sent|updated|added|changed|set|saved|removed|recorded)\b", re.IGNORECASE)
_LEAK_PHRASES = ('system prompt', 'my instructions', 'these rules', 'as an ai', 'language model', 'the guides', 'a guide', 'according to')

_BANNED_RES = tuple(phrase_regex(p) for p in c.BANNED_PHRASES)
_LEAK_RES = tuple(phrase_regex(p) for p in _LEAK_PHRASES)
_NUMBER_WORD_RES = {w: phrase_regex(w) for w in c.NUMBER_WORDS}


@dataclass(frozen=True)
class ParsedReply:
    status: str
    answer: str
    sources: tuple


def parse_reply(text, allowed_slugs):
    """
    The model's delimited reply. The first non-empty line must be exactly `STATUS: ANSWER|NOT_COVERED|OFF_TOPIC`; anything
    else raises ValueError (-> `invalid_output`). Everything after the first `===END===` is ignored. For ANSWER the text after
    the `ANSWER:` line up to `SOURCES:` is the answer and only SOURCES ids that are in `allowed_slugs` are kept (an id the
    model made up is dropped; duplicates dropped; order kept). An empty answer raises ValueError.
    """
    text = strip_model_reply_wrapper(text or '').replace('\r\n', '\n').replace('\r', '\n')
    lines = []
    for line in text.split('\n'):
        if _END_RE.match(line):
            break
        lines.append(line)
    while lines and not lines[0].strip():
        lines.pop(0)
    if not lines:
        raise ValueError('The reply is empty.')
    status_match = _STATUS_RE.match(lines[0])
    if not status_match:
        raise ValueError('The reply does not start with a STATUS line.')
    status = status_match.group(1).upper()
    if status != 'ANSWER':
        return ParsedReply(status, '', ())

    answer_lines, sources_raw, started = [], None, False
    for line in lines[1:]:
        if not started:
            match = _ANSWER_RE.match(line)
            if match:
                started = True
                if match.group(1).strip():
                    answer_lines.append(match.group(1))
            continue
        sources = _SOURCES_RE.match(line)
        if sources:
            sources_raw = sources.group(1)
            break
        answer_lines.append(line)
    if not started:
        raise ValueError('The reply has no ANSWER: line.')
    answer = re.sub(r'\n{3,}', '\n\n', '\n'.join(answer_lines).strip())
    if not answer:
        raise ValueError('The answer is empty.')
    allowed = set(allowed_slugs)
    kept = []
    for slug in re.split(r'[,\s]+', (sources_raw or '').lower()):
        if slug in allowed and slug not in kept:
            kept.append(slug)
    return ParsedReply('ANSWER', answer, tuple(kept))


def _normalise_number(token):
    token = token.replace(',', '')
    if '.' in token:
        token = token.rstrip('0').rstrip('.')
    return token


def _numbers(text):
    return {_normalise_number(t) for t in _NUMBER_RE.findall(text)}


def check_answer(answer, *, guide_text, question_text):
    """
    None when the answer passes, else the first reason from constants.GUARD_REASONS. Step markers ("1. ") at the start of a
    line are not numbers; a number or a spelled-out number must already be in the question or the guides (the step markers of
    the guides' own numbered lists do not count as numbers the guides contain).
    """
    words = answer.split()
    if len(answer) < c.ANSWER_MIN_CHARS or len(answer) > c.ANSWER_MAX_CHARS or len(words) > c.ANSWER_MAX_WORDS:
        return 'length'
    if any(ch in c.MARKUP_CHARS for ch in answer):
        return 'characters'
    if _URL_RE.search(answer) or _EMAIL_RE.search(answer) or _PATH_RE.search(answer):
        return 'link'
    body = _STEP_MARKER_RE.sub('', answer)
    guides_plain = _STEP_MARKER_RE.sub('', guide_text or '')
    allowed_numbers = _numbers(guides_plain) | _numbers(question_text or '')
    if any(n not in allowed_numbers for n in _numbers(body)):
        return 'number'
    context_words = set(_WORD_RE.findall(((guide_text or '') + ' ' + (question_text or '')).lower()))
    for word, rx in _NUMBER_WORD_RES.items():
        if rx.search(body) and word not in context_words:
            return 'number'
    if any(rx.search(answer) for rx in _BANNED_RES):
        return 'banned'
    if any(rx.search(answer) for rx in _LEAK_RES):
        return 'leak'
    if _ACTION_RE.search(answer):
        return 'action'
    return None


def to_blocks(answer):
    """
    Plain-text answer -> typed blocks. Paragraphs (split on blank lines) become `p`; consecutive lines that begin `N.` or `N)`
    become one `steps` block with the marker removed (a lone numbered line is just a paragraph). No raw model string reaches a
    client: the page renders these blocks only.
    """
    blocks, paragraph, steps = [], [], []

    def flush_paragraph():
        if paragraph:
            blocks.append({'type': 'p', 'text': ' '.join(paragraph)})
            paragraph.clear()

    def flush_steps():
        if len(steps) >= 2:
            blocks.append({'type': 'steps', 'items': list(steps)})
        elif steps:
            blocks.append({'type': 'p', 'text': steps[0]})
        steps.clear()

    for raw in (answer or '').split('\n'):
        line = raw.strip()
        if not line:
            flush_paragraph()
            flush_steps()
            continue
        step = _STEP_RE.match(line)
        if step:
            flush_paragraph()
            steps.append(' '.join(step.group(2).split()))
        else:
            flush_steps()
            paragraph.append(' '.join(line.split()))
    flush_paragraph()
    flush_steps()
    return blocks
