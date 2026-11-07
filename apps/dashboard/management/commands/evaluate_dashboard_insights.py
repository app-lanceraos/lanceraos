# apps/dashboard/management/commands/evaluate_dashboard_insights.py
"""
Measures whether the production Dashboard-insights path obeys its own checks on four invented cases
(apps/dashboard/evaluation.py). A DRY RUN unless given --yes: without it nothing is sent and nothing is spent. A live run
spends Groq requests from a shared free-tier allowance, so it is a development tool, never a deploy step. Never prints
settings, headers, keys or model text.
"""
import math
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.test import override_settings

from apps.dashboard import evaluation

DEFAULT_OUT_DIR = 'eval_runs'
DEFAULT_SESSION_CAP = 16


class Command(BaseCommand):
    help = 'Evaluates the Dashboard insights AI on 4 invented cases (dry run unless --yes).'

    def add_arguments(self, parser):
        parser.add_argument('--yes', action='store_true', help='Actually call the model. Without it: a dry run.')
        parser.add_argument('--model', choices=('fast', 'quality'), default='fast')
        parser.add_argument('--repeats', type=int, default=2)
        parser.add_argument('--cases', default='', help='Comma-separated case ids, e.g. c1,c4.')
        parser.add_argument('--pause', type=int, default=20, help='Seconds between model calls.')
        parser.add_argument('--label', default='')
        parser.add_argument('--out-dir', default=DEFAULT_OUT_DIR)
        parser.add_argument('--session-cap', type=int, default=DEFAULT_SESSION_CAP,
                            help='Hard ceiling on model requests in this invocation.')
        parser.add_argument('--list', action='store_true', help='Print the cases and exit.')

    def handle(self, *args, **options):
        if options['list']:
            for case in evaluation.CASES:
                self.stdout.write(f'{case.id}  {case.purpose}')
            return
        wanted = [c.strip() for c in options['cases'].split(',') if c.strip()]
        known = {c.id: c for c in evaluation.CASES}
        unknown = [c for c in wanted if c not in known]
        if unknown:
            raise CommandError(f"Unknown case id(s): {', '.join(unknown)}")
        cases = [known[c] for c in wanted] if wanted else list(evaluation.CASES)
        repeats, pause, cap = options['repeats'], options['pause'], options['session_cap']
        planned = len(cases) * repeats
        minutes = math.ceil(max(0, planned - 1) * pause / 60)
        self.stdout.write(
            f"Plan: model={options['model']}, {len(cases)} case(s) x {repeats} repeat(s) = {planned} request(s), "
            f"pause {pause}s (about {minutes} min of pausing), session cap {cap}.")
        if not options['yes']:
            self.stdout.write('Dry run. Nothing was sent. Re-run with --yes.')
            return
        label = options['label'] or options['model']
        # `quality` measures the 120B model as the PRIMARY: FAST's slot temporarily holds the QUALITY id (the
        # production fallback then equals the primary, so a rate limit is reported, not papered over).
        overrides = {'GROQ_MODEL_FAST': settings.GROQ_MODEL_QUALITY} if options['model'] == 'quality' else {}
        try:
            with override_settings(**overrides):
                run_dir, rows, used = evaluation.run_evaluation(
                    cases, repeats=repeats, pause_seconds=pause, session_cap=cap,
                    out_dir=Path(options['out_dir']), label=label, write=self.stdout.write)
        except RuntimeError as exc:
            raise CommandError(str(exc))
        self.stdout.write(f'{used} model request(s) used. Results written to {run_dir}.')
        self.stdout.write((run_dir / 'summary.txt').read_text(encoding='utf-8'))
