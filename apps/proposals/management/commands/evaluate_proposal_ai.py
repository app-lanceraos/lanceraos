# apps/proposals/management/commands/evaluate_proposal_ai.py
"""
Measures whether the production proposal-generation path obeys its own hard rules on 12 invented job posts
(apps/proposals/evaluation). A DRY RUN unless given --yes: without it nothing is sent and nothing is spent. A live
run spends Groq requests from a shared free-tier allowance, so it is a development tool, never a deploy step.
Never prints settings, headers, keys, proposal text or raw replies.
"""
import json
import math
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from apps.proposals.evaluation import checks, report, runner
from apps.proposals.evaluation.cases import CASES

DEFAULT_OUT_DIR = 'eval_runs'
DEFAULT_SESSION_CAP = 96   # 100 minus the 2 calls of check_ai_models and 2 spare


class Command(BaseCommand):
    help = 'Evaluates the Proposals AI on 12 invented cases (dry run unless --yes).'

    def add_arguments(self, parser):
        parser.add_argument('--yes', action='store_true', help='Actually call the model. Without it: a dry run.')
        parser.add_argument('--repeats', type=int, default=2)
        parser.add_argument('--cases', default='', help='Comma-separated case ids, e.g. c01,c05.')
        parser.add_argument('--pause', type=int, default=30, help='Seconds between model calls.')
        parser.add_argument('--label', default='run')
        parser.add_argument('--out-dir', default=DEFAULT_OUT_DIR)
        parser.add_argument('--session-cap', type=int, default=DEFAULT_SESSION_CAP)
        parser.add_argument('--list', action='store_true', help='Print the cases and exit.')
        parser.add_argument('--rescore', default='', help='Re-run the checks over an existing results.jsonl, offline.')

    def handle(self, *args, **options):
        if options['list']:
            for case in CASES:
                self.stdout.write(f'{case.id}  {case.tone:<12} {case.purpose}')
            return
        if options['rescore']:
            return self.rescore(Path(options['rescore']))

        wanted = [c.strip() for c in options['cases'].split(',') if c.strip()]
        known = {c.id: c for c in CASES}
        unknown = [c for c in wanted if c not in known]
        if unknown:
            raise CommandError(f"Unknown case id(s): {', '.join(unknown)}")
        cases = [known[c] for c in wanted] if wanted else list(CASES)
        repeats, pause = options['repeats'], options['pause']
        out_dir = Path(options['out_dir'])
        ledger_path = out_dir / 'ledger.json'
        ledger = runner.read_ledger(ledger_path)
        planned = len(cases) * repeats
        minutes = math.ceil(max(0, planned - 1) * pause / 60)

        self.stdout.write(
            f"Plan: {len(cases)} case(s) x {repeats} repeat(s) = {planned} model call(s), pause {pause}s "
            f"(about {minutes} min of pausing). Ledger: {ledger['total_calls']} request(s) used of "
            f"{options['session_cap']}.")
        if not options['yes']:
            self.stdout.write('Dry run. Nothing was sent. Re-run with --yes.')
            return
        try:
            run_dir, rows = runner.run_evaluation(
                cases, repeats=repeats, pause_seconds=pause, session_cap=options['session_cap'],
                ledger_path=ledger_path, out_dir=out_dir, label=options['label'], write=self.stdout.write)
        except RuntimeError as exc:
            raise CommandError(str(exc))
        self.stdout.write(f'Results written to {run_dir}.')
        self.stdout.write((run_dir / 'summary.txt').read_text(encoding='utf-8'))

    def rescore(self, path):
        """Offline: re-evaluate the rules over stored rows (after a checker fix); makes no model call."""
        if not path.exists():
            raise CommandError('results file not found.')
        from apps.proposals.evaluation.cases import CASES as ALL
        known = {c.id: c for c in ALL}
        rows = []
        for line in path.read_text(encoding='utf-8').splitlines():
            row = json.loads(line)
            case = known[row['case']]
            if row.get('ok'):
                outcome = {'ok': True, 'failure_reason': '', 'data': {
                    'title': row['title'], 'proposal_text': row['proposal_text'], 'tips': row['tips']}}
                row['rules'] = checks.evaluate(case, outcome)
                row['score'] = checks.score_block(case, row['proposal_text'])
            rows.append(row)
        summary = report.summarize(rows)
        target = path.parent / 'rescored'
        target.mkdir(exist_ok=True)
        (target / 'results.jsonl').write_text('\n'.join(json.dumps(r) for r in rows) + '\n', encoding='utf-8')
        (target / 'summary.json').write_text(json.dumps(summary, indent=2), encoding='utf-8')
        (target / 'summary.txt').write_text(report.format_text(summary), encoding='utf-8')
        self.stdout.write(f'Rescored {len(rows)} row(s); no model call made. Written to {target}.')
        self.stdout.write(report.format_text(summary))
