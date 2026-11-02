# core/ai.py
"""
The ONLY module that talks to Groq. Feature code (Proposals, Dashboard
insights, Health tips, Tax guidance, ...) calls run_ai_task() and nothing
else; it never makes raw HTTP calls and never imports `requests` for AI
(CLAUDE.md rule 4; core/tests/test_ai_boundaries.py enforces it).

Layers, bottom to top:

  call_groq()        One chat completion with a hard time budget. Returns a
                     GroqReply (content + usage + finish_reason + latency) or
                     raises AiError with a typed `reason`. Fails FAST: a 429
                     whose wait is longer than AI_MAX_RETRY_WAIT_SECONDS is
                     not slept on, because a web request or the single
                     `--pool=solo` Celery slot must never nap for minutes.
  run_ai_task()      What features call. Applies the kill switch, the plan
                     seam (can_use_ai) and the per-user hourly limit, calls
                     call_groq, checks for truncation, runs the feature's
                     own parser, writes exactly one core.AiCallLog row and
                     ALWAYS returns an AiResult — an AI-side failure never
                     raises into the caller. Every feature must therefore
                     degrade cleanly when result.ok is False.

NEVER call run_ai_task() (or call_groq) inside `transaction.atomic()` or
while holding `select_for_update()` locks. A call can take tens of seconds;
it must not hold a database transaction or a row lock (the invoice payment
endpoints hold row locks). Fetch what you need, leave the transaction, call
the model, then open a new transaction to save the result.

Design rule behind every feature prompt: AI explains, code calculates. A
model never produces a figure the user relies on; code computes the numbers
and the model only words them. Nothing here changes that.

Retry-with-backoff on 429s is ported from the earlier proof-of-concept: it
parses Groq's own "try again in Ns" text rather than guessing a fixed sleep.
"""
import json
import logging
import re
import time
from dataclasses import dataclass, field

import requests
from django.conf import settings
from django.core.cache import cache

from .models import AiCallLog

logger = logging.getLogger(__name__)

GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
GROQ_MODELS_URL = 'https://api.groq.com/openai/v1/models'
DEFAULT_MAX_RETRIES = 2

# Absolute ceiling on one call's total wall time, whatever the settings say:
# the production worker runs ONE task at a time on a 2 GiB host and users are
# a long round trip away from the Sydney server.
AI_TOTAL_BUDGET_HARD_CEILING_SECONDS = 60

# Model fallback (run_ai_task's `fallback_model`). Only these two failures can be fixed by asking a
# DIFFERENT model: `rate_limited` (this model's allowance is exhausted — the smaller model has its own
# per-model limits) and `model_unavailable` (this model id is gone or inaccessible). `truncated` and
# `invalid_output` are properties of this prompt/reply, `timeout` and `upstream_error` say nothing about
# the model — retrying those on another model would just burn the free-tier daily cap.
AI_FALLBACK_REASONS = frozenset({'rate_limited', 'model_unavailable'})
# A fallback needs room to finish: with less than this left of the total budget it is not attempted.
AI_MIN_FALLBACK_BUDGET_SECONDS = 10

# Groq's error `code` values meaning "this model id will never work":
# `model_not_found` was observed live (HTTP 404, 02 November 2026);
# `model_decommissioned` is Groq's documented code for a retired model and was
# NOT observed (no retired model id could be tried safely) — see DECISIONS.md.
_MODEL_UNAVAILABLE_CODES = frozenset({'model_not_found', 'model_decommissioned'})

# Groq's documented `error.code` for "the model produced output that failed
# the requested JSON validation" (HTTP 400). Its body carries the model's
# failed output (`failed_generation`) — user content, so it must never be
# logged. Mapped to `invalid_output`. NOT observed live: only reachable with
# `response_format`, which no feature uses yet, and no probe can force it.
_JSON_VALIDATE_FAILED_CODE = 'json_validate_failed'

# `reasoning_effort` and friends are model-specific parameters: run_ai_task
# does not default them. Features pass them explicitly (see DECISIONS.md for
# the measured effect of each level).

AI_FAILURE_REASONS = (
    'disabled',            # AI_ENABLED is False
    'not_allowed',         # can_use_ai(user) is False (the future plan gate)
    'user_rate_limited',   # this user used up their hourly allowance for the feature
    'not_configured',      # no GROQ_API_KEY
    'rate_limited',        # Groq is rate-limiting us and the wait is too long
    'timeout',             # per-attempt timeout or total time budget exceeded
    'model_unavailable',   # the configured model id is gone or not accessible
    'upstream_error',      # network error, 5xx, bad key, malformed response
    'request_too_large',   # HTTP 413: the input is too long for the model/tier
    'truncated',           # finish_reason == 'length': the reply was cut off
    'invalid_output',      # the feature's parser rejected the reply
)

# One short, safe sentence per reason. Never names a provider, never carries
# anything from an upstream body — this is what a user may be shown.
AI_USER_MESSAGES = {
    'disabled': 'AI features are switched off right now.',
    'not_allowed': 'AI features are not available for this account.',
    'user_rate_limited': "You've reached the hourly limit for this AI feature. Please try again later.",
    'not_configured': 'AI features are not set up yet.',
    'rate_limited': 'The AI service is busy right now. Please try again in a few minutes.',
    'timeout': 'The AI service took too long to respond. Please try again.',
    'model_unavailable': 'The AI service is temporarily unavailable.',
    'upstream_error': 'The AI service is temporarily unavailable. Please try again later.',
    'request_too_large': 'That input is too long for the AI. Please shorten it and try again.',
    'truncated': 'The AI reply was incomplete. Please try again.',
    'invalid_output': 'The AI reply could not be used. Please try again.',
}

_FEATURE_RE = re.compile(r'^[a-z][a-z0-9_]{2,59}$')

# Matches Groq's own wait text: "try again in 3.5s", "850ms", "2m3.5s".
_RETRY_WAIT_RE = re.compile(r'try again in\s+(?:(\d+)m)?\s*([\d.]+)\s*(ms|s)\b', re.IGNORECASE)
_RETRY_WAIT_BUFFER_SECONDS = 1.0
_RETRY_WAIT_UNPARSEABLE_SECONDS = 15.0


class AiError(RuntimeError):
    """
    A typed AI failure. `reason` is one of AI_FAILURE_REASONS, `http_status`
    the upstream status when there was one, `detail` internal text (at most
    500 chars) for the logger ONLY — never show it to a user, it may carry
    part of an upstream body. Use AI_USER_MESSAGES[reason] for user text.
    """

    def __init__(self, reason, http_status=None, detail='', attempts=0):
        self.reason = reason
        self.http_status = http_status
        self.detail = (detail or '')[:500]
        self.attempts = attempts
        super().__init__(f'{reason}: {self.detail}' if self.detail else reason)


@dataclass(frozen=True)
class GroqReply:
    """One successful chat completion. `usage` is Groq's raw dict (may be empty)."""
    content: str
    model: str
    finish_reason: str
    usage: dict
    latency_ms: int
    attempts: int
    http_status: int


@dataclass(frozen=True)
class AiResult:
    """What run_ai_task returns — always, for every AI-side outcome."""
    ok: bool
    data: object = None
    raw_text: str = ''
    failure_reason: str = ''
    user_message: str = ''
    log_id: str = ''
    latency_ms: int = 0
    usage: dict = field(default_factory=dict)
    # The model that produced the final outcome ('' when no model call was made at all, e.g. the kill
    # switch or a plan/limit refusal) and whether that was the fallback after the first model failed.
    model: str = ''
    fell_back: bool = False


# ══════════════════════════════════════════════════════════════════
# LOW LEVEL — one Groq call
# ══════════════════════════════════════════════════════════════════

def _retry_wait_seconds(resp):
    """Seconds to wait before retrying a 429: Retry-After header, else Groq's own text, else a default."""
    try:
        header = resp.headers.get('retry-after')
        if header is not None:
            return float(header) + _RETRY_WAIT_BUFFER_SECONDS
    except (AttributeError, TypeError, ValueError):
        pass
    match = _RETRY_WAIT_RE.search(resp.text or '')
    if match:
        minutes, amount, unit = match.groups()
        seconds = float(amount) / 1000.0 if unit.lower() == 'ms' else float(amount)
        seconds += 60.0 * int(minutes) if minutes else 0.0
        return seconds + _RETRY_WAIT_BUFFER_SECONDS
    return _RETRY_WAIT_UNPARSEABLE_SECONDS


def _error_field(resp, name):
    """One string field (`code` / `type`) of Groq's `error` object, or '' if the body is not that shape."""
    try:
        value = resp.json().get('error', {}).get(name, '')
    except (AttributeError, ValueError, TypeError):
        return ''
    return value if isinstance(value, str) else ''


def _error_code(resp):
    return _error_field(resp, 'code')


def _safe_error_summary(resp, api_key=''):
    """
    The ONLY description of a non-200 response that may reach a log: HTTP
    status, `error.code`, `error.type` (strings only, 60 chars each) and the
    body LENGTH. Never the body text and never `error.message`: Groq's
    JSON-validation failure (400 `json_validate_failed`) echoes the model's
    failed output in the body, which for our features is a user's generated
    document. The API key is still redacted as a second layer.
    """
    code = _error_field(resp, 'code')[:60]
    err_type = _error_field(resp, 'type')[:60]
    try:
        body_len = len(resp.text or '')
    except TypeError:
        body_len = 0
    summary = f'status={resp.status_code} code={code or "-"} type={err_type or "-"} body_len={body_len}'
    return summary.replace(api_key, '[redacted]') if api_key else summary


def _setting(name, override):
    return getattr(settings, name) if override is None else override


def call_groq(messages, model, max_tokens=1500, max_retries=DEFAULT_MAX_RETRIES, *,
              timeout=None, total_budget=None, max_retry_wait=None,
              temperature=None, reasoning_effort=None, response_format=None):
    """
    One chat completion against Groq, bounded by a single monotonic deadline
    that covers every attempt and every rate-limit wait. Returns a GroqReply;
    raises AiError(reason) on any failure. Feature code should call
    run_ai_task() instead — it adds the kill switch, limits, logging and a
    never-raises result.

    `None` for timeout/total_budget/max_retry_wait means "read the setting at
    call time" (so override_settings works). Optional payload keys are only
    sent when not None. A 429 is retried only while retries remain AND the
    wait fits both max_retry_wait and the remaining budget; otherwise it
    raises rate_limited immediately instead of sleeping. A reply with
    finish_reason 'length' is returned as-is — run_ai_task decides what that
    means for the feature.
    """
    api_key = getattr(settings, 'GROQ_API_KEY', '')
    if not api_key:
        raise AiError('not_configured', detail='GROQ_API_KEY is not set.')

    timeout = _setting('AI_REQUEST_TIMEOUT_SECONDS', timeout)
    budget = min(_setting('AI_TOTAL_BUDGET_SECONDS', total_budget), AI_TOTAL_BUDGET_HARD_CEILING_SECONDS)
    max_retry_wait = _setting('AI_MAX_RETRY_WAIT_SECONDS', max_retry_wait)

    payload = {'model': model, 'messages': messages, 'max_tokens': max_tokens}
    for key, value in (('temperature', temperature), ('reasoning_effort', reasoning_effort),
                       ('response_format', response_format)):
        if value is not None:
            payload[key] = value

    started = time.monotonic()
    deadline = started + budget
    attempts = 0
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise AiError('timeout', detail=f'Time budget of {budget}s exhausted.', attempts=attempts)

        attempts += 1
        try:
            resp = requests.post(
                GROQ_URL,
                headers={'Authorization': f'Bearer {api_key}', 'Content-Type': 'application/json'},
                json=payload,
                timeout=min(timeout, remaining),
            )
        except requests.Timeout as exc:
            raise AiError('timeout', detail=f'Request timed out: {type(exc).__name__}', attempts=attempts) from exc
        except requests.RequestException as exc:
            raise AiError('upstream_error', detail=f'Request failed: {type(exc).__name__}', attempts=attempts) from exc

        if resp.status_code == 200:
            try:
                body = resp.json()
                choice = body['choices'][0]
                content = choice['message'].get('content') or ''
                usage = body.get('usage')
                return GroqReply(
                    content=content,
                    model=body.get('model') or model,
                    finish_reason=choice.get('finish_reason') or '',
                    usage=usage if isinstance(usage, dict) else {},
                    latency_ms=int((time.monotonic() - started) * 1000),
                    attempts=attempts,
                    http_status=200,
                )
            except (KeyError, IndexError, ValueError, TypeError, AttributeError) as exc:
                raise AiError('upstream_error', 200, f'Unexpected response shape: {type(exc).__name__}',
                              attempts=attempts) from exc

        error_summary = _safe_error_summary(resp, api_key)

        if resp.status_code == 429:
            wait_s = _retry_wait_seconds(resp)
            can_retry = (
                attempts <= max_retries
                and wait_s <= max_retry_wait
                and time.monotonic() + wait_s < deadline
            )
            if not can_retry:
                logger.warning('Groq rate limited, not waiting (wait %.1fs, attempt %s): %s', wait_s, attempts, error_summary)
                raise AiError('rate_limited', 429, f'Rate limited; wait of {wait_s:.1f}s not acceptable.', attempts=attempts)
            logger.warning('Groq rate limited (attempt %s/%s) — waiting %.1fs.', attempts, max_retries + 1, wait_s)
            time.sleep(wait_s)
            continue

        logger.error('Groq API error: %s', error_summary)
        code = _error_code(resp)
        if code in _MODEL_UNAVAILABLE_CODES:
            raise AiError('model_unavailable', resp.status_code, f'Model {model} is not available.', attempts=attempts)
        if resp.status_code == 413:
            raise AiError('request_too_large', 413, 'HTTP 413', attempts=attempts)
        if resp.status_code == 400 and code == _JSON_VALIDATE_FAILED_CODE:
            raise AiError('invalid_output', 400, 'HTTP 400 json_validate_failed', attempts=attempts)
        raise AiError('upstream_error', resp.status_code, f'HTTP {resp.status_code}', attempts=attempts)


def list_groq_models():
    """
    The ids Groq currently lists for this key (GET /openai/v1/models, verified
    live 02 November 2026: an OpenAI-style {"object": "list", "data": [...]}).
    Not an AI completion, so it does not break the "all AI goes through
    call_groq" rule; it exists so check_ai_models can tell "model removed from
    the catalog" from "model temporarily failing". Raises AiError on failure.
    """
    api_key = getattr(settings, 'GROQ_API_KEY', '')
    if not api_key:
        raise AiError('not_configured', detail='GROQ_API_KEY is not set.')
    try:
        resp = requests.get(
            GROQ_MODELS_URL,
            headers={'Authorization': f'Bearer {api_key}'},
            timeout=settings.AI_REQUEST_TIMEOUT_SECONDS,
        )
    except requests.Timeout as exc:
        raise AiError('timeout', detail='Model list timed out.') from exc
    except requests.RequestException as exc:
        raise AiError('upstream_error', detail=f'Model list failed: {type(exc).__name__}') from exc
    if resp.status_code != 200:
        logger.error('Groq model list error: %s', _safe_error_summary(resp, api_key))
        raise AiError('upstream_error', resp.status_code, f'Model list HTTP {resp.status_code}')
    try:
        return sorted(item['id'] for item in resp.json()['data'])
    except (KeyError, TypeError, ValueError) as exc:
        raise AiError('upstream_error', 200, 'Model list had an unexpected shape.') from exc


# ══════════════════════════════════════════════════════════════════
# PARSING HELPERS
# ══════════════════════════════════════════════════════════════════

def strip_model_reply_wrapper(text):
    """
    Real model replies frequently come wrapped in a <think>...</think>
    reasoning block and/or a ```json fence — ported directly from the POC's
    strip_fences(), which exists specifically because raw replies failed
    json.loads() without it.
    """
    text = text.strip()
    text = re.sub(r'^<think>.*?</think>\s*', '', text, flags=re.IGNORECASE | re.DOTALL)
    text = re.sub(r'^```(json|html)?\s*', '', text, flags=re.IGNORECASE)
    text = re.sub(r'```\s*$', '', text)
    return text.strip()


def _loads_tolerant(text):
    """
    json.loads, retried with strict=False only when the strict parse fails.
    strict=False accepts raw control characters (a literal newline or tab)
    inside a string value — a common slip when a model writes multi-line text
    into a JSON string, and unambiguous to repair. Everything else (unescaped
    quotes, trailing commas, truncation) is still an error.
    """
    try:
        return json.loads(text)
    except ValueError:
        return json.loads(text, strict=False)


def parse_json_object(text):
    """
    Parses a model reply into a dict: strips a <think> block / code fence,
    then json.loads; if that is not valid JSON, tries the slice from the
    first '{' to the last '}' (models sometimes wrap the object in prose).
    Raw newlines/tabs inside string values are tolerated (see _loads_tolerant).
    Raises ValueError unless the result is a JSON object — an array or a
    scalar is rejected, never "repaired". Field-level validation is the
    feature's job, layered on top of this.
    """
    cleaned = strip_model_reply_wrapper(text or '')
    try:
        value = _loads_tolerant(cleaned)
    except ValueError:
        start, end = cleaned.find('{'), cleaned.rfind('}')
        if cleaned.startswith('[') or start == -1 or end <= start:
            raise ValueError('Reply is not a JSON object.') from None
        value = _loads_tolerant(cleaned[start:end + 1])
    if not isinstance(value, dict):
        raise ValueError('Reply is JSON but not an object.')
    return value


# ══════════════════════════════════════════════════════════════════
# THE FEATURE-FACING ENTRY POINT
# ══════════════════════════════════════════════════════════════════

def can_use_ai(user):
    """
    True only for an authenticated, active user. This is the SINGLE seam where
    the Subscriptions module adds its Free/Pro check later; no plan logic
    exists yet, deliberately.
    """
    return bool(getattr(user, 'is_authenticated', False) and getattr(user, 'is_active', False))


def _user_over_limit(user, feature, limit):
    """
    Counts this attempt and reports whether the user is past their hourly
    allowance for the feature. The count is taken BEFORE the call, so failed
    calls count too (they burn the shared free-tier quota just the same).
    Atomic: cache.add creates the window once, cache.incr is one Redis INCR —
    unlike the get-then-set pattern of apps.invoices' _check_moderate_rate_limit,
    two concurrent calls can never both read the same count. A fixed one-hour
    window from the first call, not a sliding one. If the cache itself fails
    this fails OPEN (logged): the limiter protects a quota, it must not turn a
    cache outage into an AI outage — Groq's own 429 fast-fail still applies.
    """
    key = f'ai_rate_{feature}_{user.pk}'
    try:
        cache.add(key, 0, timeout=3600)
        try:
            count = cache.incr(key)
        except ValueError:  # the window expired between add and incr
            cache.add(key, 1, timeout=3600)
            count = 1
    except Exception:
        logger.exception('AI rate-limit cache failed for feature=%s; allowing the call.', feature)
        return False
    return count > limit


def _message_chars(messages):
    """Total characters of text in the prompt (image parts and the like are not counted)."""
    total = 0
    for message in messages:
        content = message.get('content') if isinstance(message, dict) else None
        if isinstance(content, str):
            total += len(content)
        elif isinstance(content, list):
            total += sum(len(part.get('text', '')) for part in content
                         if isinstance(part, dict) and isinstance(part.get('text'), str))
    return total


def _token_count(usage, key):
    value = usage.get(key) if isinstance(usage, dict) else None
    return value if isinstance(value, int) and value >= 0 else None


def _write_log(*, user, feature, model, ok, failure_reason, latency_ms, attempts, http_status,
               finish_reason, usage, input_chars, output_chars, request_id):
    """Writes the one AiCallLog row. Never raises (same pattern as core.observability.log_event)."""
    try:
        row = AiCallLog.objects.create(
            user=user, feature=feature, model=(model or '')[:100], ok=ok, failure_reason=failure_reason,
            latency_ms=latency_ms, attempts=attempts, http_status=http_status,
            finish_reason=(finish_reason or '')[:20],
            prompt_tokens=_token_count(usage, 'prompt_tokens'),
            completion_tokens=_token_count(usage, 'completion_tokens'),
            total_tokens=_token_count(usage, 'total_tokens'),
            input_chars=input_chars, output_chars=output_chars, request_id=(request_id or '')[:36],
        )
    except Exception:
        logger.exception('Failed to write AiCallLog for feature=%s model=%s', feature, model)
        return ''
    return str(row.id)


@dataclass(frozen=True)
class _Attempt:
    """One model call and everything run_ai_task needs from it (its AiCallLog row is already written)."""
    ok: bool
    data: object
    raw_text: str
    reason: str
    latency_ms: int
    usage: dict
    log_id: str


def _attempt_model(*, feature, user, messages, model, max_tokens, parse, request_id, total_budget, call_options):
    """
    ONE model call plus its post-processing (truncation check, empty reply, the feature's parser) and
    its AiCallLog row. Never raises for an AI-side failure. run_ai_task runs this once, or twice when it
    falls back to a second model, so both attempts are judged and logged by exactly the same rules.
    """
    started = time.monotonic()
    reply = None
    data = None
    reason = ''
    http_status = None
    attempts = 0
    try:
        reply = call_groq(messages, model, max_tokens, total_budget=total_budget, **call_options)
    except AiError as exc:
        reason, http_status, attempts = exc.reason, exc.http_status, exc.attempts
        logger.warning('AI call failed feature=%s model=%s reason=%s: %s', feature, model, exc.reason, exc.detail)
    else:
        http_status, attempts = reply.http_status, reply.attempts
        if reply.finish_reason == 'length':
            reason = 'truncated'
        elif not reply.content.strip():
            reason = 'invalid_output'
        elif parse is None:
            data = reply.content
        else:
            try:
                data = parse(reply.content)
            except (ValueError, KeyError, TypeError) as exc:
                reason = 'invalid_output'
                logger.warning('AI reply rejected by parser feature=%s: %s', feature, type(exc).__name__)
            except Exception:
                # A bug in the feature's own parser must not become a 500
                # or a missing log row — features degrade on AI failure.
                reason = 'invalid_output'
                logger.exception('Parser for AI feature=%s raised unexpectedly.', feature)

    ok = not reason
    latency_ms = reply.latency_ms if reply else int((time.monotonic() - started) * 1000)
    usage = reply.usage if reply else {}
    raw_text = reply.content if reply else ''
    log_id = _write_log(
        user=user, feature=feature, model=model, ok=ok, failure_reason=reason, latency_ms=latency_ms,
        attempts=attempts, http_status=http_status, finish_reason=reply.finish_reason if reply else '',
        usage=usage, input_chars=_message_chars(messages), output_chars=len(raw_text), request_id=request_id,
    )
    return _Attempt(ok=ok, data=data if ok else None, raw_text=raw_text if ok else '', reason=reason,
                    latency_ms=latency_ms, usage=usage, log_id=log_id)


def run_ai_task(*, feature, messages, model, max_tokens, user=None, system=False, parse=None,
                request_id=None, rate_limit_per_hour=None, timeout=None, total_budget=None,
                temperature=None, reasoning_effort=None, response_format=None, fallback_model=None):
    """
    The one function feature code calls. Always returns an AiResult; an
    AI-side failure NEVER raises (only a programmer error — a bad `feature`,
    or not exactly one of `user` / `system=True` — raises ValueError). Every
    non-programmer-error path writes one core.AiCallLog row PER MODEL CALL
    ATTEMPTED (a call refused before any model is contacted — kill switch,
    plan gate, user limit — writes one row with attempts=0); rows hold sizes
    only, never content.

    Order: kill switch -> can_use_ai(user) -> per-user hourly limit (all three
    checked ONCE, before the first attempt) -> call_groq -> truncation check
    (finish_reason 'length' is `truncated`: a cut-off reply is useless) -> the
    optional `parse` callable (ValueError/KeyError/TypeError, or any other
    exception from it, becomes `invalid_output`) -> an empty reply is
    `invalid_output` too.

    `fallback_model` (optional): if the first model fails with `rate_limited` or
    `model_unavailable` (AI_FALLBACK_REASONS — the only failures a different
    model can fix) and fallback_model differs from `model` and at least
    AI_MIN_FALLBACK_BUDGET_SECONDS of the total budget remain, the same request
    is made once to the fallback model, with the REMAINING budget as its
    total_budget, so the whole call stays inside AI_TOTAL_BUDGET_SECONDS. The
    fallback does not count against the user's hourly allowance a second time.
    The parser runs on whichever reply is used and a parse failure never
    triggers a fallback. If both fail, the result carries the SECOND attempt's
    reason. AiResult.model is the model that produced the final outcome and
    AiResult.fell_back says it was the fallback; with a fallback, latency_ms is
    the whole call's wall time (each log row keeps its own attempt's latency).

    `parse` receives the raw reply text and returns the feature's data;
    without it, AiResult.data is the raw text. Pass `response_format` /
    `reasoning_effort` explicitly when the model supports them — they are
    not defaulted here (see DECISIONS.md for the measured guidance: reasoning
    tokens count against max_tokens, so leave headroom, and avoid 'high').
    The same options are sent to the fallback model.

    Never call this inside transaction.atomic() or under select_for_update().
    """
    if not isinstance(feature, str) or not _FEATURE_RE.match(feature):
        raise ValueError(f'feature must match {_FEATURE_RE.pattern!r}, got {feature!r}.')
    if (user is None) == (system is not True):
        raise ValueError('Pass exactly one of user=<User> or system=True.')

    started = time.monotonic()
    refusal = ''
    if not settings.AI_ENABLED:
        refusal = 'disabled'
    elif user is not None and not can_use_ai(user):
        refusal = 'not_allowed'
    elif user is not None and _user_over_limit(
            user, feature, settings.AI_RATE_LIMIT_PER_HOUR if rate_limit_per_hour is None else rate_limit_per_hour):
        refusal = 'user_rate_limited'
    if refusal:
        log_id = _write_log(
            user=user, feature=feature, model=model, ok=False, failure_reason=refusal,
            latency_ms=int((time.monotonic() - started) * 1000), attempts=0, http_status=None,
            finish_reason='', usage={}, input_chars=_message_chars(messages), output_chars=0, request_id=request_id,
        )
        return AiResult(
            ok=False, failure_reason=refusal, user_message=AI_USER_MESSAGES[refusal], log_id=log_id,
            latency_ms=int((time.monotonic() - started) * 1000),
        )

    budget = min(_setting('AI_TOTAL_BUDGET_SECONDS', total_budget), AI_TOTAL_BUDGET_HARD_CEILING_SECONDS)
    call_options = {'timeout': timeout, 'temperature': temperature, 'reasoning_effort': reasoning_effort,
                    'response_format': response_format}
    common = dict(feature=feature, user=user, messages=messages, max_tokens=max_tokens, parse=parse,
                  request_id=request_id, call_options=call_options)

    used_model, fell_back = model, False
    attempt = _attempt_model(model=model, total_budget=budget, **common)
    if (not attempt.ok and attempt.reason in AI_FALLBACK_REASONS
            and fallback_model and fallback_model != model):
        remaining = budget - (time.monotonic() - started)
        if remaining >= AI_MIN_FALLBACK_BUDGET_SECONDS:
            logger.warning('AI feature=%s falling back from %s to %s after %s.', feature, model, fallback_model, attempt.reason)
            attempt = _attempt_model(model=fallback_model, total_budget=remaining, **common)
            used_model, fell_back = fallback_model, True

    return AiResult(
        ok=attempt.ok, data=attempt.data, raw_text=attempt.raw_text, failure_reason=attempt.reason,
        user_message='' if attempt.ok else AI_USER_MESSAGES[attempt.reason], log_id=attempt.log_id,
        latency_ms=int((time.monotonic() - started) * 1000) if fell_back else attempt.latency_ms,
        usage=attempt.usage, model=used_model, fell_back=fell_back,
    )
