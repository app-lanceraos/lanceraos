# apps/help/service.py
"""
One question in, one honest result out (Prompt 24, Part 6). answer_question() is the ONE function that both the HTTP view and
the evaluation command call, so what is measured is what ships. Order, exactly: redact -> soft rate limit -> search -> GATE
(no match = no model call) -> AI switches -> cache -> run_ai_task (never inside a transaction) -> parse -> GUARD -> blocks.
Every outcome carries guides except off_topic; AI off, rate limited, failing or rejected is never an HTTP error (decision H5).
Nothing a person typed and nothing a model wrote is ever logged, audited or cached (decision H7): the audit row holds ids,
counts and words from our own fixed vocabularies; the cache holds the answer, never the question.
"""
import hashlib
import logging
import re
from dataclasses import dataclass, field

from django.conf import settings
from django.core.cache import cache

from core.ai import run_ai_task
from core.observability import log_event
from core.ratelimit import rate_limited

from . import answers, copy, prompts, search
from . import constants as c
from .library import BY_SLUG, LIBRARY, LIBRARY_VERSION, TOPIC_BY_SLUG
from .text import normalise, redact, strip_markup

logger = logging.getLogger(__name__)

_EMAIL_LOOKS_RIGHT = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')


@dataclass(frozen=True)
class AskResult:
    outcome: str
    reason: str = ''
    ai_reason: str = ''
    answer_blocks: object = None
    notice: str = ''
    guides: tuple = ()
    cached: bool = False
    # DEBUG / evaluation only: no serializer ever emits these.
    ai_called: bool = False
    model_status: str = ''
    guard_reason: str = ''
    sources: tuple = ()
    sent_slugs: tuple = ()
    usage: dict = field(default_factory=dict)
    model: str = ''
    fell_back: bool = False
    latency_ms: int = 0
    question_chars: int = 0
    redacted: bool = False
    had_previous: bool = False


# ── payload builders ──────────────────────────────────────────────────────────────────────────────────────────────

def guide_summary(g):
    return {'slug': g.slug, 'title': g.title, 'summary': g.summary, 'topic': g.topic}


def blocks_payload(blocks):
    """Blocks as plain JSON-able dicts (a steps block's items as a list)."""
    out = []
    for b in blocks:
        item = dict(b)
        if item.get('type') == 'steps':
            item['items'] = list(item['items'])
        out.append(item)
    return out


def answers_enabled():
    """True only when written answers are switched on: the per-feature switch AND the global AI switch (decision H21, Prompt 25).
    The one definition: `ask` checks it at its switch step and the guide index reports it, so the page and the server never disagree."""
    return bool(settings.HELP_AI_ENABLED and settings.AI_ENABLED)


def guide_index():
    """GET /api/help/guides/: topics with their guides (slug, title, summary), the six popular guides, and whether written answers are on."""
    topics = [{
        'slug': t.slug, 'title': t.title, 'blurb': t.blurb,
        'guides': [{'slug': g.slug, 'title': g.title, 'summary': g.summary} for g in LIBRARY if g.topic == t.slug],
    } for t in c.TOPICS]
    return {'library_version': LIBRARY_VERSION, 'topics': topics, 'popular': [guide_summary(g) for g in search.popular()],
            'answers_enabled': answers_enabled()}


def guide_detail(slug):
    """GET /api/help/guides/<slug>/, or None for an unknown slug. Never includes keywords, ui_labels or sources."""
    g = BY_SLUG.get(slug)
    if g is None:
        return None
    return {
        'slug': g.slug, 'title': g.title, 'topic': g.topic, 'topic_title': TOPIC_BY_SLUG[g.topic].title, 'summary': g.summary,
        'blocks': blocks_payload(g.blocks), 'related': [guide_summary(BY_SLUG[r]) for r in g.related if r in BY_SLUG],
        'checked_on': g.checked_on, 'library_version': LIBRARY_VERSION,
    }


def search_payload(query):
    """GET /api/help/search/?q= -> {query, results}: the normalised query and up to eight listable guides."""
    text = strip_markup(normalise(query))
    matches = search.find(redact(text).for_search)
    return {'query': text, 'results': [guide_summary(m.guide) for m in search.listable(matches)[:c.SEARCH_RESULT_LIMIT]]}


def support_email():
    value = (getattr(settings, 'SUPPORT_EMAIL', '') or '').strip()
    return value if _EMAIL_LOOKS_RIGHT.match(value) else ''


def ask_payload(result):
    """The JSON body of POST /api/help/ask/. Emits only the public fields of an AskResult."""
    return {
        'outcome': result.outcome, 'reason': result.reason, 'ai_reason': result.ai_reason,
        'answer': {'blocks': blocks_payload(result.answer_blocks)} if result.answer_blocks else None,
        'notice': result.notice, 'guides': [guide_summary(g) for g in result.guides], 'cached': result.cached,
        'support_email': support_email() if result.outcome != 'answered' else '',
        'library_version': LIBRARY_VERSION,
    }


# ── the cache ─────────────────────────────────────────────────────────────────────────────────────────────────────

def cache_key(for_model_question):
    """SHA-256 of the redacted question + library version + prompt version + both model ids. The question itself is not stored."""
    material = '\x1f'.join((for_model_question.casefold(), LIBRARY_VERSION, str(prompts.PROMPT_VERSION),
                            settings.GROQ_MODEL_FAST, settings.GROQ_MODEL_QUALITY))
    return c.CACHE_KEY_PREFIX + hashlib.sha256(material.encode('utf-8')).hexdigest()


def _cache_get(key):
    try:
        return cache.get(key)
    except Exception:
        logger.exception('[HELP] Cache read failed; treating it as a miss.')
        return None


def _cache_set(key, value):
    try:
        cache.set(key, value, c.CACHE_TTL_SECONDS)
    except Exception:
        logger.exception('[HELP] Cache write failed; the answer is simply not cached.')


# ── the one function ──────────────────────────────────────────────────────────────────────────────────────────────

def _guides_only(reason, notice, guides, **extra):
    return AskResult(outcome='guides_only', reason=reason, notice=notice, guides=tuple(guides), **extra)


def answer_question(question, previous_question='', *, user=None, request_id=None, use_cache=True):
    """See the module docstring. `user=None` means a system call (the evaluation): no limits, no audit row, no cache write."""
    q = redact(strip_markup(normalise(question)))
    prev = redact(strip_markup(normalise(previous_question)))
    meta = dict(question_chars=len(normalise(question)), redacted=q.redacted or prev.redacted, had_previous=bool(prev.for_model))

    result = _decide(q, prev, user, request_id, use_cache, meta)
    if user is not None:
        _audit(user, result)
    return result


def _decide(q, prev, user, request_id, use_cache, meta):
    matches = search.find(q.for_search, prev.for_search)
    closest = [m.guide for m in search.listable(matches)[:c.GUIDES_ONLY_LIMIT]]

    if user is not None and rate_limited(f'help:ask:min:{user.pk}', c.ASK_PER_MINUTE, timeout=60):
        return _guides_only('slow_down', copy.SLOW_DOWN, closest or search.popular(), **meta)

    if not search.gate(matches):
        return _guides_only('no_match', copy.NO_MATCH, closest or search.popular(), **meta)

    if not answers_enabled():
        return _guides_only('ai_off', copy.AI_OFF, closest, **meta)

    key = cache_key(q.for_model)
    if use_cache and not prev.for_model:
        hit = _cache_get(key)
        if isinstance(hit, dict) and hit.get('blocks'):
            slugs = [s for s in hit.get('slugs', []) if s in BY_SLUG]
            if slugs:
                return AskResult(outcome='answered', answer_blocks=hit['blocks'], guides=tuple(BY_SLUG[s] for s in slugs),
                                 cached=True, sources=tuple(slugs), **meta)

    chosen = prompts.select_for_prompt(search.listable(matches))
    allowed = {g.slug for g in chosen}
    ai = run_ai_task(
        feature=c.AI_FEATURE, messages=prompts.build_messages(q.for_model, prev.for_model, chosen),
        model=settings.GROQ_MODEL_FAST, fallback_model=settings.GROQ_MODEL_QUALITY, max_tokens=c.AI_MAX_TOKENS,
        reasoning_effort=c.AI_REASONING_EFFORT, total_budget=c.AI_TOTAL_BUDGET_SECONDS, rate_limit_per_hour=c.AI_PER_HOUR,
        parse=lambda text: answers.parse_reply(text, allowed), user=user, system=(user is None), request_id=request_id)
    telemetry = dict(ai_called=True, usage=dict(ai.usage or {}), model=ai.model, fell_back=ai.fell_back,
                     latency_ms=ai.latency_ms, sent_slugs=tuple(g.slug for g in chosen), **meta)

    if not ai.ok:
        return _guides_only('ai_unavailable', copy.ai_unavailable_notice(ai.failure_reason), closest,
                            ai_reason=ai.failure_reason, **telemetry)
    parsed = ai.data
    if parsed.status == 'NOT_COVERED':
        return _guides_only('not_covered', copy.NOT_COVERED, closest, model_status='NOT_COVERED', **telemetry)
    if parsed.status == 'OFF_TOPIC':
        return AskResult(outcome='off_topic', reason='', notice=copy.OFF_TOPIC, guides=(), model_status='OFF_TOPIC', **telemetry)

    guide_text = '\n\n'.join(prompts.render_guide_for_model(g) for g in chosen)
    guard = answers.check_answer(parsed.answer, guide_text=guide_text, question_text=f'{q.for_model} {prev.for_model}')
    if guard:
        return _guides_only('answer_rejected', copy.ANSWER_REJECTED, closest or chosen, model_status='ANSWER',
                            guard_reason=guard, sources=parsed.sources, **telemetry)
    blocks = answers.to_blocks(parsed.answer)
    cited = [BY_SLUG[s] for s in parsed.sources if s in BY_SLUG]
    shown = cited or chosen
    if user is not None and not prev.for_model:
        _cache_set(key, {'blocks': blocks, 'slugs': [g.slug for g in shown]})
    return AskResult(outcome='answered', answer_blocks=blocks, guides=tuple(shown), model_status='ANSWER',
                     sources=parsed.sources, **telemetry)


def _audit(user, result):
    """The help_question audit row: our own vocabularies, counts and booleans. Never any text a person typed. Never raises."""
    try:
        log_event('help_question', user=user, metadata={
            'outcome': result.outcome, 'reason': result.reason, 'ai_reason': result.ai_reason, 'ai_called': result.ai_called,
            'cached': result.cached, 'model': result.model, 'fell_back': result.fell_back,
            'guide_slugs': [g.slug for g in result.guides], 'question_chars': result.question_chars,
            'redacted': result.redacted, 'had_previous': result.had_previous, 'guard_reason': result.guard_reason,
            'library_version': LIBRARY_VERSION, 'prompt_version': prompts.PROMPT_VERSION,
        })
    except Exception:
        logger.exception('[HELP] Could not write the help_question audit row.')


def record_rating(user, helpful, slugs):
    """The help_answer_rated audit row: a boolean and guide slugs, nothing else. Never raises into the request."""
    try:
        log_event('help_answer_rated', user=user, metadata={
            'helpful': bool(helpful), 'guide_slugs': list(slugs), 'library_version': LIBRARY_VERSION})
    except Exception:
        logger.exception('[HELP] Could not write the help_answer_rated audit row.')
