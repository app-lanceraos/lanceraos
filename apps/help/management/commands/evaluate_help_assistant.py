# apps/help/management/commands/evaluate_help_assistant.py
"""
Part 10b of Prompt 24: the live AI evaluation of the production Help path (service.answer_question, use_cache=False) on the 27
cases of eval_cases.LIVE_CASES, judged by the pre-registered rules E1-E8 (AI_EVALUATION.md section 15).

A DRY RUN unless given --yes: without it nothing is sent and nothing is spent. A live run spends Groq requests from a shared
free-tier allowance, so it is a development tool, never a deploy step. It stops at --session-cap model requests. It never prints
settings, headers, keys or model text: stdout carries outcomes, reasons, token counts and ids only. The answered texts for the E7
manual read are written to the run folder (eval_runs/, gitignored).
"""
import math
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.test import override_settings

from apps.help import evaluation
from apps.help.eval_cases import LIVE_CASES

DEFAULT_OUT_DIR = 'eval_runs'
DEFAULT_SESSION_CAP = 40


class Command(BaseCommand):
    help = 'Live evaluation of the Help assistant on the 27 pre-registered cases (dry run unless --yes).'

    def add_arguments(self, parser):
        parser.add_argument('--yes', action='store_true', help='Actually call the model. Without it: a dry run.')
        parser.add_argument('--model', choices=('fast', 'quality'), default='fast')
        parser.add_argument('--cases', default='', help='Comma-separated case ids, e.g. a01,n01,i01.')
        parser.add_argument('--pause', type=int, default=20, help='Seconds between model calls (default 20).')
        parser.add_argument('--label', default='')
        parser.add_argument('--out-dir', default=DEFAULT_OUT_DIR)
        parser.add_argument('--session-cap', type=int, default=DEFAULT_SESSION_CAP, help='Hard ceiling on model requests in this invocation.')
        parser.add_argument('--list', action='store_true', help='Print the cases and exit.')

    def handle(self, *args, **options):
        if options['list']:
            for case in LIVE_CASES:
                self.stdout.write(f'{case["id"]}  {case["kind"]:<12} {case["q"][:70]}')
            return
        wanted = [x.strip() for x in options['cases'].split(',') if x.strip()]
        known = {x['id']: x for x in LIVE_CASES}
        unknown = [x for x in wanted if x not in known]
        if unknown:
            raise CommandError(f"Unknown case id(s): {', '.join(unknown)}")
        cases = [known[x] for x in wanted] if wanted else list(LIVE_CASES)
        pause, cap = options['pause'], options['session_cap']
        minutes = math.ceil(max(0, len(cases) - 1) * pause / 60)
        self.stdout.write(f"Plan: model={options['model']}, {len(cases)} case(s), at most {len(cases)} request(s) "
                          f"(a closed gate sends none), pause {pause}s (about {minutes} min), session cap {cap}, "
                          f"HELP_AI_ENABLED forced on for this run.")
        if not options['yes']:
            self.stdout.write('Dry run. Nothing was sent. Re-run with --yes.')
            return
        label = options['label'] or options['model']
        overrides = {'HELP_AI_ENABLED': True, 'AI_ENABLED': True}
        if options['model'] == 'quality':
            # Measures the larger model as the PRIMARY: FAST's slot temporarily holds the QUALITY id.
            overrides['GROQ_MODEL_FAST'] = settings.GROQ_MODEL_QUALITY
        try:
            with override_settings(**overrides):
                run_dir, rows, used = evaluation.run_live(
                    cases, pause_seconds=pause, session_cap=cap, out_dir=Path(options['out_dir']), label=label, write=self.stdout.write)
        except RuntimeError as exc:
            raise CommandError(str(exc))
        self.stdout.write(f'{used} model request(s) used. Results written to {run_dir}.')
        self.stdout.write((run_dir / 'summary.txt').read_text(encoding='utf-8'))
