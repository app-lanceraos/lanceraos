# apps/dashboard/evaluation.py
"""
Measures the production Dashboard-insights path on four INVENTED cases. Each request goes through
insights.generate_insight_texts (the same function get_insights calls, `system=True`) and each returned text through
insights.check_insight, so what is measured is exactly what ships. The facts are built with the PURE constructors in
insight_facts.py (no database, no real data).

Nothing here talks to Groq: no URL, key, header or HTTP client (the key is reached only through Django settings inside
core.ai). Output is rule results, usage and the generated text in a gitignored folder; stdout never carries a reply.
The numbers (the pass rule) are decided in AI_EVALUATION.md section 14 BEFORE any result existed.
"""
import json
import time
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path

from django.utils import timezone

from . import insight_facts as f
from .insights import check_insight, generate_insight_texts


@dataclass(frozen=True)
class EvalCase:
    id: str
    purpose: str
    facts: tuple


CASES = (
    EvalCase('c1', 'income up 18%, one dominant client, 23 days to pay (3 facts)', (
        f.make_month_vs_previous(currency='PKR', last_label='October 2026', last_total=Decimal('413000'),
                                 previous_label='September 2026', previous_total=Decimal('350000')),
        f.make_client_concentration(share_pct=64),
        f.make_days_to_pay(invoice_count=6, typical_days=23),
    )),
    EvalCase('c2', 'income down 31%, proposals 2 of 5 (2 facts)', (
        f.make_month_vs_previous(currency='PKR', last_label='October 2026', last_total=Decimal('241500'),
                                 previous_label='September 2026', previous_total=Decimal('350000')),
        f.make_proposal_acceptance(accepted=2, decided=5),
    )),
    EvalCase('c3', 'income flat, 9 days to pay, proposals 4 of 4 (3 facts)', (
        f.make_month_vs_previous(currency='PKR', last_label='October 2026', last_total=Decimal('352000'),
                                 previous_label='September 2026', previous_total=Decimal('350000')),
        f.make_days_to_pay(invoice_count=5, typical_days=9),
        f.make_proposal_acceptance(accepted=4, decided=4),
    )),
    EvalCase('c4', 'one client is 91% of income (1 fact)', (f.make_client_concentration(share_pct=91),)),
)

DEFAULT_RATE_LIMIT_WAIT = 65


def http_requests_for(request_id):
    """HTTP requests the model call(s) behind `request_id` actually made, from core.AiCallLog (sizes only)."""
    from django.db.models import Sum

    from core.models import AiCallLog
    return int(AiCallLog.objects.filter(request_id=request_id).aggregate(n=Sum('attempts'))['n'] or 0)


def _fact_rows(case, result):
    rows = []
    for number, fact in enumerate(case.facts, start=1):
        texts = result.data.get(number) if result.ok else None
        if texts is None:
            rows.append({'fact': fact.key, 'accepted': False, 'reason': 'missing' if result.ok else result.failure_reason})
            continue
        reason = check_insight(fact, *texts)
        rows.append({'fact': fact.key, 'accepted': reason is None, 'reason': reason or '',
                     'observation': texts[0], 'suggestion': texts[1]})
    return rows


def run_evaluation(cases, *, repeats, pause_seconds, session_cap, out_dir, label, generate=generate_insight_texts,
                   sleep=time.sleep, requests_for=http_requests_for, write=print, run_id=None):
    """
    Order: every case for repeat 1, then every case for repeat 2. A failure is recorded, never retried (the budget is
    small and a retry would hide the failure being measured). Raises RuntimeError before any call when the plan
    exceeds `session_cap`; stops cleanly if the cap is reached mid-run (a fallback call counts as a second request).
    """
    planned = len(cases) * repeats
    if planned > session_cap:
        raise RuntimeError(f'Refusing to start: {planned} planned request(s) > cap {session_cap}.')
    run_id = run_id or f'{timezone.now():%Y%m%d-%H%M%S}-{label}'
    run_dir = Path(out_dir) / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    rows, used, made_a_call = [], 0, False
    with open(run_dir / 'results.jsonl', 'w', encoding='utf-8') as sink:
        for repeat in range(1, repeats + 1):
            for case in cases:
                if used >= session_cap:
                    write(f'Request cap {session_cap} reached; stopping cleanly.')
                    break
                if made_a_call:
                    sleep(pause_seconds)
                made_a_call = True
                request_id = f'eval-{run_id}-{case.id}-{repeat}'
                try:
                    result = generate(list(case.facts), system=True, request_id=request_id)
                    row = {
                        'case': case.id, 'repeat': repeat, 'ok': result.ok, 'failure_reason': result.failure_reason,
                        'model': result.model, 'fell_back': result.fell_back, 'latency_ms': result.latency_ms,
                        'usage': result.usage or {}, 'facts': _fact_rows(case, result),
                    }
                    if not result.ok and result.failure_reason == 'invalid_output':
                        row['raw_reply'] = (result.raw_text or '')[:4000]
                    used += max(1, requests_for(request_id))
                except Exception as exc:  # noqa: BLE001 - class name only, a message could carry a URL
                    row = {'case': case.id, 'repeat': repeat, 'ok': False, 'failure_reason': 'harness_error',
                           'harness_error': type(exc).__name__, 'model': '', 'fell_back': False, 'latency_ms': 0,
                           'usage': {}, 'facts': []}
                    used += 1
                sink.write(json.dumps(row) + '\n')
                sink.flush()
                rows.append(row)
                accepted = sum(1 for r in row['facts'] if r['accepted'])
                write(f"{case.id} r{repeat} {'ok' if row['ok'] else row['failure_reason']:<14} {row['latency_ms']:>6} ms  "
                      f"tokens {row['usage'].get('total_tokens', '-')}  facts {accepted}/{len(case.facts)} accepted"
                      f"{'  FELL BACK' if row['fell_back'] else ''}")
    summary = summarize(rows)
    (run_dir / 'summary.json').write_text(json.dumps(summary, indent=2), encoding='utf-8')
    (run_dir / 'summary.txt').write_text(format_text(summary), encoding='utf-8')
    return run_dir, rows, used


def summarize(rows):
    """The numbers the pre-registered rule (a)-(c) is read from. A result that fell back to the other model is excluded from the rates."""
    measured = [r for r in rows if not r['fell_back'] and r['failure_reason'] != 'harness_error']
    ok_rows = [r for r in measured if r['ok']]
    facts = [fr for r in ok_rows for fr in r['facts']]
    accepted = sum(1 for fr in facts if fr['accepted'])
    reasons = {}
    for fr in facts:
        if not fr['accepted']:
            reasons[fr['reason']] = reasons.get(fr['reason'], 0) + 1
    totals = [r['usage'].get('total_tokens') for r in ok_rows if r['usage'].get('total_tokens') is not None]
    completions = [r['usage'].get('completion_tokens') for r in ok_rows if r['usage'].get('completion_tokens') is not None]
    failures = {}
    for r in measured:
        if not r['ok']:
            failures[r['failure_reason']] = failures.get(r['failure_reason'], 0) + 1
    return {
        'requests': len(rows), 'measured': len(measured), 'fell_back': sum(1 for r in rows if r['fell_back']),
        'ok': len(ok_rows), 'failures': failures,
        'facts_total': len(facts), 'facts_accepted': accepted,
        'accepted_pct': round(100 * accepted / len(facts), 1) if facts else None,
        'rejected_reasons': reasons,
        'avg_total_tokens': round(sum(totals) / len(totals)) if totals else None,
        'max_total_tokens': max(totals) if totals else None,
        'avg_completion_tokens': round(sum(completions) / len(completions)) if completions else None,
        'avg_latency_ms': round(sum(r['latency_ms'] for r in ok_rows) / len(ok_rows)) if ok_rows else None,
        # Pre-registered rule, parts (a)-(c); part (d) is a human read of the accepted texts.
        'rule_a_no_truncated': failures.get('truncated', 0) == 0,
        'rule_b_no_other_failure': all(reason == 'rate_limited' for reason in failures),
        'rule_c_accepted_at_least_90pct': bool(facts) and accepted / len(facts) >= 0.9,
    }


def format_text(summary):
    lines = [f'{key}: {value}' for key, value in summary.items()]
    return '\n'.join(lines) + '\n'
