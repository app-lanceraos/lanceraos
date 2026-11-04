# apps/proposals/evaluation/runner.py
"""
Runs the evaluation cases through the PRODUCTION generation path (services.generate_with_facts -> core.ai.run_ai_task)
and writes one result row per attempt. Nothing here talks to Groq: no URL, key, header or HTTP client; the key is
reached only through Django settings inside run_ai_task, exactly as in production.

Pacing: Groq's free tier allows ~8000 tokens per minute per model (DECISIONS.md, 02 Nov 2026), and a system=True call is
not subject to AI_RATE_LIMIT_PER_HOUR, so the runner sleeps BETWEEN calls (never before the first) and keeps a budget
ledger so a run cannot overspend the session's request cap.

Output is sizes and rule results plus the generated text, in a gitignored folder (D4): the cases are invented, but
generated text is still not something to commit. stdout never carries proposal text, raw replies, settings, headers or
keys, and an unexpected exception is recorded by class name only (its message could carry a URL).
"""
import json
import time
from pathlib import Path

from django.utils import timezone

from apps.proposals.prompts import FREELANCER_FACT_FIELDS
from apps.proposals.services import generate_with_facts

from . import checks, report

DEFAULT_RATE_LIMIT_WAIT = 65
RAW_REPLY_LIMIT = 4000


def build_facts(case):
    """Facts exactly as production builds them: iterate the allowlist, skip blanks."""
    return {f: case.facts[f] for f in FREELANCER_FACT_FIELDS if str(case.facts.get(f) or '').strip()}


def read_ledger(path):
    path = Path(path)
    if not path.exists():
        return {'total_calls': 0, 'runs': []}
    return json.loads(path.read_text(encoding='utf-8'))


def write_ledger(path, ledger):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(ledger, indent=2), encoding='utf-8')


def http_requests_for(request_id):
    """HTTP requests the model call(s) behind `request_id` actually made, from core.AiCallLog (sizes only)."""
    from django.db.models import Sum

    from core.models import AiCallLog
    total = AiCallLog.objects.filter(request_id=request_id).aggregate(n=Sum('attempts'))['n']
    return int(total or 0)


def _outcome(result):
    return {
        'ok': result.ok, 'failure_reason': result.failure_reason, 'data': result.data if result.ok else None,
        'model': result.model, 'fell_back': result.fell_back, 'usage': result.usage or {},
        'latency_ms': result.latency_ms,
    }


def _row(case, repeat, attempt, outcome, raw_text=''):
    rules = checks.evaluate(case, outcome)
    row = {
        'case': case.id, 'repeat': repeat, 'attempt': attempt, 'tone': case.tone, 'ok': outcome['ok'],
        'failure_reason': outcome['failure_reason'], 'model': outcome['model'], 'fell_back': outcome['fell_back'],
        'latency_ms': outcome['latency_ms'], 'usage': outcome['usage'], 'rules': rules,
    }
    if outcome['ok']:
        data = outcome['data']
        row.update(title=data['title'], proposal_text=data['proposal_text'], tips=data['tips'],
                   score=checks.score_block(case, data['proposal_text']))
    elif outcome['failure_reason'] == 'invalid_output' and raw_text:
        row['raw_reply'] = raw_text[:RAW_REPLY_LIMIT]
    return row


def violated_hard_rules(row):
    return [rule for rule in checks.HARD_RULES if row.get('rules', {}).get(rule, {}).get('ok') is False]


def run_evaluation(cases, *, repeats, pause_seconds, session_cap, ledger_path, out_dir, label,
                   rate_limit_wait=DEFAULT_RATE_LIMIT_WAIT, generate=generate_with_facts, sleep=time.sleep,
                   requests_for=http_requests_for, write=print, run_id=None):
    """
    Order: every case for repeat 1, then every case for repeat 2 (balanced if interrupted). A `rate_limited` result is
    waited out (`rate_limit_wait`) and retried ONCE; any other failure is recorded, not retried. A result that fell back
    to the small model is recorded but excluded from rates (report.measured_rows). Returns (run_dir, rows).
    Raises RuntimeError before any call if the planned calls would exceed the ledger cap.
    """
    ledger = read_ledger(ledger_path)
    planned = len(cases) * repeats
    if ledger['total_calls'] + planned > session_cap:
        raise RuntimeError(
            f"Refusing to start: {planned} planned + {ledger['total_calls']} already used > cap {session_cap}.")
    run_id = run_id or f"{timezone.now():%Y%m%d-%H%M%S}-{label}"
    run_dir = Path(out_dir) / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    entry = {'run_id': run_id, 'label': label, 'calls': 0}
    ledger['runs'].append(entry)

    rows = []
    made_a_call = False
    stopped = False
    with open(run_dir / 'results.jsonl', 'w', encoding='utf-8') as sink:
        for repeat in range(1, repeats + 1):
            for case in cases:
                for attempt in (1, 2):
                    if ledger['total_calls'] >= session_cap:
                        write(f'Request cap {session_cap} reached; stopping cleanly.')
                        stopped = True
                        break
                    if made_a_call and attempt == 1:
                        sleep(pause_seconds)
                    made_a_call = True
                    request_id = f'eval-{run_id}-{case.id}-{repeat}-{attempt}'
                    raw_text = ''
                    try:
                        result = generate(
                            facts=build_facts(case), job_description=case.job_description, tone=case.tone,
                            my_experience=case.my_experience, system=True, request_id=request_id)
                        outcome = _outcome(result)
                        raw_text = getattr(result, 'raw_text', '') or ''
                        row = _row(case, repeat, attempt, outcome, raw_text)
                    except Exception as exc:  # noqa: BLE001 - class name only, a message could carry a URL
                        row = {'case': case.id, 'repeat': repeat, 'attempt': attempt, 'tone': case.tone, 'ok': False,
                               'failure_reason': 'harness_error', 'harness_error': type(exc).__name__,
                               'fell_back': False, 'rules': {}, 'usage': {}, 'latency_ms': 0, 'model': ''}
                    used = max(1, requests_for(request_id)) if row.get('failure_reason') != 'harness_error' else 1
                    ledger['total_calls'] += used
                    entry['calls'] += used
                    write_ledger(ledger_path, ledger)
                    sink.write(json.dumps(row) + '\n')
                    sink.flush()
                    rows.append(row)
                    bad = violated_hard_rules(row)
                    write(f"{case.id} r{repeat}.{attempt} {'ok' if row['ok'] else row['failure_reason']:<14} "
                          f"{row['latency_ms']:>6} ms  tokens {row['usage'].get('total_tokens', '-')}"
                          f"{'  FELL BACK' if row['fell_back'] else ''}"
                          f"{'  VIOLATES ' + ','.join(bad) if bad else ''}")
                    if row['failure_reason'] == 'rate_limited' and attempt == 1:
                        write(f'Rate limited; waiting {rate_limit_wait}s before one retry.')
                        sleep(rate_limit_wait)
                        continue
                    break
                if stopped:
                    break
            if stopped:
                break

    summary = report.summarize(rows)
    (run_dir / 'summary.json').write_text(json.dumps(summary, indent=2), encoding='utf-8')
    (run_dir / 'summary.txt').write_text(report.format_text(summary), encoding='utf-8')
    return run_dir, rows
