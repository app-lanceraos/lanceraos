# apps/dashboard/insights.py
"""
The Dashboard insights card's engine: CODE picks and calculates the facts (insight_facts.py), the model only words
them, and CODE checks the model's words before anything is shown. A text that fails a check is replaced by that
fact's own fixed sentences, so the card never shows an unchecked number and still works with AI off or failing.

  parse_insight_reply   the model's delimited reply -> {fact number: (observation, suggestion)}
  check_insight         the guard: format, per-fact number check, direction check, banned words
  generate_insight_texts the ONE place the request is built and sent (production and the evaluation both call it)
  get_insights          orchestration: facts -> cache -> model -> guard -> payload

Failure is per FACT, not per response (a rejected fact shows its fixed sentences; the others keep their AI text).
Generation is lazy, synchronous and cached in Redis only (no database model, so account deletion has nothing to
anonymize); the cache entry is valid only while the facts' fingerprint is unchanged.

The model call never runs inside a transaction; nothing here opens one.
"""
import hashlib
import logging
import re
import unicodedata

from django.conf import settings
from django.core.cache import cache
from django.utils import timezone

from core.ai import run_ai_task, strip_model_reply_wrapper

from . import insight_facts, services
from .prompts import PROMPT_VERSION, build_insight_messages

logger = logging.getLogger(__name__)

AI_FEATURE = 'dashboard_insights'
# Reasoning tokens count against max_tokens, so leave headroom: three facts' text is ~300 tokens, the reasoning of a
# 'low' effort run is a few hundred more (the evaluation reports the real usage, AI_EVALUATION.md section 14).
AI_MAX_TOKENS = 1500
AI_REASONING_EFFORT = 'low'
# Per user, per hour: the cache already makes a normal visit free, so this only caps a pathological case (two tabs
# at the same instant, or a template result retried every 15 minutes). The fingerprint check keeps it far below.
AI_RATE_LIMIT_PER_HOUR = 6
# A result with any model text is good for a day (the facts change slowly and the fingerprint invalidates it sooner
# when they do); a fixed-sentence-only result is retried after 15 minutes so a failure heals but cannot hammer the model.
CACHE_TTL_AI = 24 * 60 * 60
CACHE_TTL_FALLBACK = 15 * 60
CACHE_KEY = 'dashboard_insights:v1:{user_id}'

EMPTY_HINT = (
    'Insights appear once you have payments recorded in at least two months, '
    'or a few paid invoices and answered proposals.'
)

# ── guard constants ────────────────────────────────────────────────────────────────────────────
TEXT_MIN_CHARS = 20
TEXT_MAX_CHARS = 240
FORBIDDEN_CHARS = frozenset('*#`<>[]{}@')
_NUMBER_RE = re.compile(r'\d+(?:[.,]\d+)*')
_YEAR_RE = re.compile(r'^(?:19|20)\d{2}$')
_WORD_RE = re.compile(r"[a-z]+")
DOWN_WORDS = frozenset('down lower fell fall dropped drop decline declined decrease decreased less dipped slower'.split())
UP_WORDS = frozenset('up higher rose rise grew grown growth increase increased more gain gained jumped improved'.split())
BANNED_WORDS = frozenset((
    'tax taxes taxed fbr ntn legal legally law lawyer invest investing investment loan loans insurance guarantee '
    'guaranteed ai assistant prompt instructions '
    'double doubled triple tripled twice half halved hundred thousand million dozen'
).split())

# Numbers spelled as words ("six invoices", "a nine-day cycle") are numbers too. The live evaluation (AI_EVALUATION.md
# section 14) showed the model writing them, and a digits-only guard cannot see them. Each word is checked against the
# fact's allowed figures like a digit would be. "one" is deliberately absent: it is an ordinary pronoun/article far more
# often than a count ("one client", "one small change"). A compound such as "twenty-three" is read as 20 and 3, neither
# of which is 23, so it is rejected: conservative, and the model is told to copy digits.
NUMBER_WORDS = {
    'zero': 0, 'two': 2, 'three': 3, 'four': 4, 'five': 5, 'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
    'eleven': 11, 'twelve': 12, 'thirteen': 13, 'fourteen': 14, 'fifteen': 15, 'sixteen': 16, 'seventeen': 17,
    'eighteen': 18, 'nineteen': 19, 'twenty': 20, 'thirty': 30, 'forty': 40, 'fifty': 50, 'sixty': 60, 'seventy': 70,
    'eighty': 80, 'ninety': 90,
}

REASON_FORMAT = 'format'
REASON_NUMBER = 'number'
REASON_DIRECTION = 'direction'
REASON_BANNED = 'banned'
REASON_MISSING = 'missing'


# ══════════════════════════════════════════════════════════════════
# PARSER
# ══════════════════════════════════════════════════════════════════

_HEADER_RE = re.compile(r'^\s*\[F(\d+)\]\s*$', re.IGNORECASE)
_END_RE = re.compile(r'^\s*===\s*END\s*===\s*$', re.IGNORECASE)
_FIELD_RE = re.compile(r'^\s*(OBSERVATION|SUGGESTION)\s*:\s*(.*)$', re.IGNORECASE)


def parse_insight_reply(text, expected_ids):
    """
    {fact number: (observation, suggestion)} from the delimited reply (prompts.REPLY_FORMAT). Header lines are exactly
    `[F<digits>]`; a block runs to the next header or the END line; OBSERVATION:/SUGGESTION: are matched at the start of a
    line, case-insensitively, and a continuation line is appended with a space. Text before the first header is
    ignored; an id listed twice is invalid (dropped, a marker echoed twice is how Proposals treats it too); ids not
    expected are ignored; a block missing either field is dropped. Raises ValueError (-> `invalid_output`) when no
    valid block remains.
    """
    expected = set(expected_ids)
    text = strip_model_reply_wrapper(text or '').replace('\r\n', '\n').replace('\r', '\n')
    blocks = []          # [(id, [lines])]
    current = None
    for line in text.split('\n'):
        header = _HEADER_RE.match(line)
        if header:
            current = (int(header.group(1)), [])
            blocks.append(current)
        elif _END_RE.match(line):
            break           # everything after the first END line is ignored (as in the Proposals parser)
        elif current is not None:
            current[1].append(line)

    counts = {}
    for fact_id, _lines in blocks:
        counts[fact_id] = counts.get(fact_id, 0) + 1
    parsed = {}
    for fact_id, lines in blocks:
        if counts[fact_id] != 1 or fact_id not in expected:
            continue
        fields, field = {}, None
        for line in lines:
            match = _FIELD_RE.match(line)
            if match:
                field = match.group(1).upper()
                fields[field] = match.group(2).strip()
            elif field and line.strip():
                fields[field] = f'{fields[field]} {line.strip()}'.strip()
        observation, suggestion = fields.get('OBSERVATION', ''), fields.get('SUGGESTION', '')
        if observation and suggestion:
            parsed[fact_id] = (' '.join(observation.split()), ' '.join(suggestion.split()))
    if not parsed:
        raise ValueError('No valid insight block in the reply.')
    return parsed


# ══════════════════════════════════════════════════════════════════
# GUARD
# ══════════════════════════════════════════════════════════════════

def _normalise_number(token):
    """'412,000' -> '412000'; '18.0' -> '18'; '18.50' -> '18.5'."""
    token = token.replace(',', '')
    if '.' in token:
        token = token.rstrip('0').rstrip('.')
    return token


def number_tokens(text):
    return [_normalise_number(t) for t in _NUMBER_RE.findall(text)]


def allowed_numbers(fact):
    return {_normalise_number(t) for chunk in fact.allowed_text for t in _NUMBER_RE.findall(chunk)}


def _words(text):
    return set(_WORD_RE.findall(text.lower()))


def _format_problem(text):
    if not TEXT_MIN_CHARS <= len(text) <= TEXT_MAX_CHARS:
        return True
    lowered = text.lower()
    if 'http' in lowered or 'www' in lowered:
        return True
    for char in text:
        if char in FORBIDDEN_CHARS or unicodedata.category(char) in ('Cc', 'So', 'Sk'):
            return True
    return False


def check_insight(fact, observation, suggestion):
    """
    None when the AI text for `fact` is acceptable, else a short reason constant. Numbers are checked against THIS
    fact's own allowed figures (not the union of all facts), and the observation must contain at least one of them
    (a bare year such as 2026 does not count as a figure). Numbers spelled as words are checked the same way. Digit checking alone misses flipped meaning ("down 18%"
    written as "up 18%") and multiplier words ("doubled"), hence the direction and banned-word checks.
    """
    if _format_problem(observation) or _format_problem(suggestion):
        return REASON_FORMAT
    allowed = allowed_numbers(fact)
    observation_raw = _NUMBER_RE.findall(observation)
    used = number_tokens(observation) + number_tokens(suggestion)
    if any(token not in allowed for token in used):
        return REASON_NUMBER
    spelled = [NUMBER_WORDS[w] for w in _WORD_RE.findall((observation + ' ' + suggestion).lower()) if w in NUMBER_WORDS]
    if any(str(value) not in allowed for value in spelled):
        return REASON_NUMBER
    if not any(_normalise_number(raw) in allowed for raw in observation_raw if not _YEAR_RE.match(raw)):
        return REASON_NUMBER
    observation_words = _words(observation)
    if fact.direction == 'up' and observation_words & DOWN_WORDS:
        return REASON_DIRECTION
    if fact.direction == 'down' and observation_words & UP_WORDS:
        return REASON_DIRECTION
    if (_words(observation) | _words(suggestion)) & BANNED_WORDS:
        return REASON_BANNED
    return None


# ══════════════════════════════════════════════════════════════════
# THE ONE REQUEST
# ══════════════════════════════════════════════════════════════════

def generate_insight_texts(facts, *, user=None, system=False, request_id=None):
    """
    The one place the request is built and sent. get_insights (production) and the evaluation command
    (`system=True`, invented facts) both call THIS, so what is measured is exactly what users get. `system` is forwarded
    only when true, so production's call to run_ai_task is unchanged.

    FAST first: Proposals spends the 120B model's daily allowance and the two models' allowances are separate;
    QUALITY is the fallback only when FAST is rate-limited or gone (core.ai AI_FALLBACK_REASONS).
    """
    expected_ids = range(1, len(facts) + 1)
    extra = {'system': True} if system else {}
    return run_ai_task(
        feature=AI_FEATURE, user=user, model=settings.GROQ_MODEL_FAST, fallback_model=settings.GROQ_MODEL_QUALITY,
        messages=build_insight_messages(facts), max_tokens=AI_MAX_TOKENS, reasoning_effort=AI_REASONING_EFFORT,
        parse=lambda text: parse_insight_reply(text, expected_ids), rate_limit_per_hour=AI_RATE_LIMIT_PER_HOUR,
        request_id=request_id, **extra,
    )


# ══════════════════════════════════════════════════════════════════
# ORCHESTRATION
# ══════════════════════════════════════════════════════════════════

def fingerprint(facts, currency):
    """sha256 of the prompt version, the currency and every fact's key:statement — the cache is valid only while this is unchanged."""
    material = '\n'.join([f'v{PROMPT_VERSION}', currency, *[f'{fact.key}:{fact.statement}' for fact in facts]])
    return hashlib.sha256(material.encode('utf-8')).hexdigest()


def _item(fact, observation, suggestion, source):
    return {'fact': fact.key, 'observation': observation, 'suggestion': suggestion, 'source': source}


def _template_items(facts):
    return [_item(fact, fact.fallback_observation, fact.fallback_suggestion, 'template') for fact in facts]


def _payload(items, currency):
    sources = {item['source'] for item in items}
    source = 'ai' if sources == {'ai'} else 'template' if sources == {'template'} else 'mixed'
    return {
        'status': 'ready', 'source': source, 'currency': currency,
        'generated_at': timezone.now().isoformat(), 'insights': items,
    }


def get_insights(user, *, request_id=None):
    """
    The payload for GET /api/dashboard/insights/. Facts are computed on every request (about eight cheap queries) because
    the fingerprint needs them; the model is called only when the fingerprint changed (or the cached entry expired), AI
    is switched on, and there is at least one fact. Never raises for an AI-side failure.
    """
    ctx = services.build_context(user)
    facts = insight_facts.compute_facts(ctx)
    if not facts:
        return {'status': 'empty', 'source': None, 'currency': ctx.currency, 'insights': [], 'empty_hint': EMPTY_HINT}

    key = CACHE_KEY.format(user_id=user.pk)
    fp = fingerprint(facts, ctx.currency)
    cached = cache.get(key)
    if cached and cached.get('fingerprint') == fp:
        return cached['payload']

    if not settings.AI_ENABLED or not settings.DASHBOARD_INSIGHTS_AI_ENABLED:
        # Free to recompute, so nothing is cached and no AiCallLog row is written.
        return _payload(_template_items(facts), ctx.currency)

    result = generate_insight_texts(facts, user=user, request_id=request_id)
    items, rejections = [], {}
    for number, fact in enumerate(facts, start=1):
        texts = result.data.get(number) if result.ok else None
        reason = REASON_MISSING if texts is None else check_insight(fact, *texts)
        if texts is not None and reason is None:
            items.append(_item(fact, texts[0], texts[1], 'ai'))
        else:
            items.append(_item(fact, fact.fallback_observation, fact.fallback_suggestion, 'template'))
            rejections[fact.key] = reason if result.ok else result.failure_reason
    payload = _payload(items, ctx.currency)
    # Keys and reasons only: never the prompt, the model's text or any figure.
    logger.info('[DASHBOARD] Insights for user %s: source=%s facts=%s fell_back_to_fixed=%s', user.pk, payload['source'],
                [fact.key for fact in facts], rejections)
    cache.set(key, {'fingerprint': fp, 'payload': payload},
              CACHE_TTL_FALLBACK if payload['source'] == 'template' else CACHE_TTL_AI)
    return payload
