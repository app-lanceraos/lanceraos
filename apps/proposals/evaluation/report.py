# apps/proposals/evaluation/report.py
"""Turns a list of result rows (runner.py's results.jsonl lines) into numbers, text and markdown."""
import math
import statistics
from collections import Counter

from .checks import HARD_RULES, SOFT_RULES


def _percentile(values, pct):
    if not values:
        return None
    ordered = sorted(values)
    index = max(0, math.ceil(pct / 100 * len(ordered)) - 1)
    return ordered[index]


def measured_rows(results):
    """Rows that measured the production model's text: a reply came back and it was not the fallback model's."""
    return [r for r in results if not r.get('harness_error') and not r.get('fell_back')]


def summarize(results):
    """Per-rule violation counts, failures, fallbacks, score, latency and tokens for one run."""
    measured = measured_rows(results)
    rules = {}
    for rule in HARD_RULES + SOFT_RULES:
        evaluated = [r for r in measured if r.get('rules', {}).get(rule, {}).get('ok') is not None]
        violations = [r for r in evaluated if r['rules'][rule]['ok'] is False]
        rules[rule] = {
            'evaluated': len(evaluated), 'violations': len(violations),
            'rate': (len(violations) / len(evaluated)) if evaluated else None,
            'cases': sorted({r['case'] for r in violations}),
        }
    per_case = {}
    for r in measured:
        bad = [rule for rule in HARD_RULES if r.get('rules', {}).get(rule, {}).get('ok') is False]
        if bad:
            per_case.setdefault(r['case'], []).extend(bad)
    failures = Counter(r.get('failure_reason') or 'harness_error' for r in results if not r.get('ok'))
    fell_back = [f"{r['case']}#{r['repeat']}" for r in results if r.get('fell_back')]
    scores = [r['score']['score'] for r in measured if r.get('score')]
    check_ids = sorted({cid for r in measured if r.get('score') for cid in r['score']['checks']})
    check_pass = {}
    for cid in check_ids:
        rows = [r['score']['checks'][cid] for r in measured if r.get('score') and cid in r['score']['checks']
                and r['score']['checks'][cid]['possible'] > 0]
        check_pass[cid] = {
            'evaluated': len(rows),
            'full': sum(1 for c in rows if c['points'] == c['possible']),
            'mean_points': (sum(c['points'] for c in rows) / len(rows)) if rows else None,
            'possible': rows[0]['possible'] if rows else None,
        }
    latencies = [r['latency_ms'] for r in measured if r.get('latency_ms')]
    tokens = [r['usage'].get('total_tokens') for r in measured if r.get('usage', {}).get('total_tokens')]
    return {
        'attempts': len(results), 'measured': len(measured), 'ok': sum(1 for r in results if r.get('ok')),
        'rules': rules, 'per_case_hard_violations': per_case, 'failures': dict(failures), 'fell_back': fell_back,
        'score': {
            'mean': statistics.mean(scores) if scores else None,
            'median': statistics.median(scores) if scores else None,
            'min': min(scores) if scores else None, 'max': max(scores) if scores else None,
            'checks': check_pass,
        },
        'latency_ms': {'p50': _percentile(latencies, 50), 'p95': _percentile(latencies, 95)},
        'tokens': {'mean': statistics.mean(tokens) if tokens else None, 'max': max(tokens) if tokens else None},
    }


def _pct(rate):
    return '-' if rate is None else f'{rate * 100:.0f}%'


def format_text(summary):
    lines = [f"attempts {summary['attempts']}  ok {summary['ok']}  measured (production model, no fallback) {summary['measured']}"]
    lines.append('HARD RULES (rule: violations / evaluated)')
    for rule in HARD_RULES:
        r = summary['rules'][rule]
        lines.append(f"  {rule:<24} {r['violations']:>2} / {r['evaluated']:<3} {_pct(r['rate'])}  {','.join(r['cases'])}")
    lines.append('SOFT RULES')
    for rule in SOFT_RULES:
        r = summary['rules'][rule]
        lines.append(f"  {rule:<24} {r['violations']:>2} / {r['evaluated']:<3} {_pct(r['rate'])}")
    lines.append('HARD VIOLATIONS BY CASE')
    if summary['per_case_hard_violations']:
        for case, rules in sorted(summary['per_case_hard_violations'].items()):
            lines.append(f"  {case}: {', '.join(rules)}")
    else:
        lines.append('  none')
    lines.append(f"FAILURES {summary['failures'] or 'none'}   FELL BACK {summary['fell_back'] or 'none'}")
    s = summary['score']
    if s['mean'] is not None:
        lines.append(f"SCORE mean {s['mean']:.2f} median {s['median']} range {s['min']}-{s['max']}")
        for cid, c in s['checks'].items():
            lines.append(f"  {cid:<12} full marks {c['full']} / {c['evaluated']}  mean {c['mean_points']:.2f} of {c['possible']}")
    lat, tok = summary['latency_ms'], summary['tokens']
    lines.append(f"LATENCY ms p50 {lat['p50']} p95 {lat['p95']}   TOKENS mean {tok['mean']} max {tok['max']}")
    return '\n'.join(lines)


def format_markdown(summary):
    """Hard- and soft-rule tables, ready to paste into AI_EVALUATION.md."""
    out = ['| Rule | Evaluated | Violations | Rate |', '|---|---|---|---|']
    for rule in HARD_RULES + SOFT_RULES:
        r = summary['rules'][rule]
        out.append(f"| {rule} | {r['evaluated']} | {r['violations']} | {_pct(r['rate'])} |")
    return '\n'.join(out)
