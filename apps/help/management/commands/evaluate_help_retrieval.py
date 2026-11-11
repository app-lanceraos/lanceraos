# apps/help/management/commands/evaluate_help_retrieval.py
"""
Part 10a of Prompt 24: how well does the search find the right guide, with NO model call (it cannot spend quota)? Prints, per
set, recall@1, recall@3 and how often the gate opens (and for the negatives, how often it stays closed), then the pass rule.
  --misses   list every question that missed (the question, the expected slugs, the top three titles) - use it on the TUNE set;
             the held-out misses are reported but must never be used to choose a keyword or a synonym.
Exit status is non-zero when the pass rule fails.
"""
from django.core.management.base import BaseCommand, CommandError

from apps.help import evaluation as ev
from apps.help import constants as c
from apps.help.eval_cases import HELD_OUT_CASES, NEGATIVE_CASES, TUNE_CASES
from apps.help.library import LIBRARY_VERSION


class Command(BaseCommand):
    help = 'Retrieval evaluation of the Help search (no model). Exits non-zero if the pre-registered pass rule fails.'

    def add_arguments(self, parser):
        parser.add_argument('--misses', action='store_true', help='List the questions that missed.')
        parser.add_argument('--only', choices=['tune', 'held-out', 'negatives'], help='Print only one set (the pass rule needs all three).')

    def handle(self, *args, **options):
        tune = ev.evaluate_positive(TUNE_CASES)
        held = ev.evaluate_positive(HELD_OUT_CASES)
        negatives = ev.evaluate_negative(NEGATIVE_CASES)
        held_negatives = ev.evaluate_negative([n for n in NEGATIVE_CASES if n['held_out']])
        out = self.stdout.write
        out(f'LIBRARY_VERSION {LIBRARY_VERSION}   thresholds: list >= {c.MIN_COVERAGE_TO_LIST}, gate >= {c.MIN_COVERAGE_FOR_AI}')
        for name, result in (('TUNE', tune), ('HELD-OUT', held)):
            if options['only'] and options['only'] != name.lower():
                continue
            n = result['n']
            out(f'{name:9} n={n:3}  recall@1 {result["recall1"]:3}/{n} ({100 * result["recall1"] / n:.0f}%)  '
                f'recall@3 {result["recall3"]:3}/{n} ({100 * result["recall3"] / n:.0f}%)  gate open {result["gate_open"]:3}/{n} ({100 * result["gate_open"] / n:.0f}%)')
            if options['misses']:
                for row in result['rows']:
                    if not row['hit3'] or not row['gate_open']:
                        flag = ('MISS' if not row['hit3'] else '') + (' CLOSED' if not row['gate_open'] else '')
                        out(f'   {row["id"]} [{flag.strip()}] {row["q"][:80]!r}  expected {row["expected"]}  top3 {row["top3_titles"]}  best {row["best"]}')
        if not options['only'] or options['only'] == 'negatives':
            out(f'NEGATIVES n={negatives["n"]:3}  closed {negatives["closed"]}/{negatives["n"]}   (the 8 of Appendix B: {held_negatives["closed"]}/{held_negatives["n"]})')
            if options['misses']:
                for row in negatives['rows']:
                    if row['gate_open']:
                        out(f'   {row["id"]} [OPEN] {row["q"]!r}  top {row["top"]}')
        out('')
        failed = []
        for name, passed, actual, needed in ev.rule_results(tune, held, held_negatives):
            out(f'  {"PASS" if passed else "FAIL"}  {name}: {actual} (needed {needed})')
            if not passed:
                failed.append(name)
        if failed:
            raise CommandError('Pass rule not met: ' + ', '.join(failed))
        out(self.style.SUCCESS('Pass rule met.'))
