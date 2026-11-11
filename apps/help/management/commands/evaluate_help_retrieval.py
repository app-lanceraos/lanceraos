# apps/help/management/commands/evaluate_help_retrieval.py
"""
How well does the search find the right guide, with NO model call (it cannot spend quota)? Prints, per set, recall@1, recall@3
and how often the gate opens (and for the negatives, how often it stays closed), then the pass rules (Prompt 24's, and P1-P3 of
Prompt 25). Sets: the long-question TUNE and HELD-OUT sets, their negatives, and the SHORT-query tune and held-out sets.
  --misses        list the questions that missed in the TUNE sets only (TUNE and the short tune set, with their negatives).
  --final-misses  the ONLY flag that lists the misses of the HELD-OUT sets (HELD-OUT and the short held-out set): use it once, at the
                  end, to report - never to choose a keyword, a synonym or a constant.
  --only          print one set only (the pass rules need all of them, so they are skipped).
Exit status is non-zero when any pass rule fails.
"""
from django.core.management.base import BaseCommand, CommandError

from apps.help import constants as c
from apps.help import evaluation as ev
from apps.help.eval_cases import (
    HELD_OUT_CASES, NEGATIVE_CASES, SHORT_HELD_OUT_CASES, SHORT_HELD_OUT_NEGATIVES, SHORT_TUNE_CASES, SHORT_TUNE_NEGATIVES,
    TUNE_CASES,
)
from apps.help.library import LIBRARY_VERSION

ONLY_CHOICES = ['tune', 'held-out', 'negatives', 'short-tune', 'short-held-out', 'short-negatives']


class Command(BaseCommand):
    help = 'Retrieval evaluation of the Help search (no model). Exits non-zero if a pass rule fails.'

    def add_arguments(self, parser):
        parser.add_argument('--misses', action='store_true', help='List the questions that missed in the TUNE sets only.')
        parser.add_argument('--final-misses', action='store_true', help='List the misses of the HELD-OUT sets (report only; never tune on them).')
        parser.add_argument('--only', choices=ONLY_CHOICES, help='Print only one set (the pass rules need all of them and are skipped).')

    def handle(self, *args, **options):
        tune = ev.evaluate_positive(TUNE_CASES)
        held = ev.evaluate_positive(HELD_OUT_CASES)
        negatives = ev.evaluate_negative(NEGATIVE_CASES)
        held_negatives = ev.evaluate_negative([n for n in NEGATIVE_CASES if n['held_out']])
        short_tune = ev.evaluate_positive(SHORT_TUNE_CASES)
        short_held = ev.evaluate_positive(SHORT_HELD_OUT_CASES)
        short_tune_negatives = ev.evaluate_negative(SHORT_TUNE_NEGATIVES)
        short_held_negatives = ev.evaluate_negative(SHORT_HELD_OUT_NEGATIVES)
        out = self.stdout.write
        only = options['only']
        out(f'LIBRARY_VERSION {LIBRARY_VERSION}   thresholds: list >= {c.MIN_COVERAGE_TO_LIST}, gate >= {c.MIN_COVERAGE_FOR_AI}   '
            f'title bonus {c.TITLE_ALL_TERMS_BONUS}')
        sets = (
            ('TUNE', 'tune', tune, options['misses']),
            ('HELD-OUT', 'held-out', held, options['final_misses']),
            ('SHORT-TUNE', 'short-tune', short_tune, options['misses']),
            ('SHORT-HELD', 'short-held-out', short_held, options['final_misses']),
        )
        for name, key, result, list_misses in sets:
            if only and only != key:
                continue
            n = result['n']
            extra = f'  extra rules failing {result["extra_rules"]}' if key == 'short-tune' else ''
            out(f'{name:11} n={n:3}  recall@1 {result["recall1"]:3}/{n} ({100 * result["recall1"] / n:.0f}%)  '
                f'recall@3 {result["recall3"]:3}/{n} ({100 * result["recall3"] / n:.0f}%)  '
                f'gate open {result["gate_open"]:3}/{n} ({100 * result["gate_open"] / n:.0f}%){extra}')
            if list_misses:
                for row in result['rows']:
                    if not row['hit3'] or not row['gate_open'] or row['failed_rules']:
                        flag = ('MISS' if not row['hit3'] else '') + (' CLOSED' if not row['gate_open'] else '')
                        flag += ''.join(f' {r.upper()}' for r in row['failed_rules'])
                        out(f'   {row["id"]} [{flag.strip()}] {row["q"][:80]!r}  expected {row["expected"]}  top3 {row["top3_titles"]}  best {row["best"]}')
        if not only or only == 'negatives':
            out(f'NEGATIVES   n={negatives["n"]:3}  closed {negatives["closed"]}/{negatives["n"]}   (the 8 of Appendix B: '
                f'{held_negatives["closed"]}/{held_negatives["n"]})')
            if options['misses'] or options['final_misses']:
                held_ids = {n['id'] for n in NEGATIVE_CASES if n['held_out']}
                for row in negatives['rows']:
                    is_held = row['id'] in held_ids
                    if row['gate_open'] and ((is_held and options['final_misses']) or (not is_held and options['misses'])):
                        out(f'   {row["id"]} [OPEN] {row["q"]!r}  top {row["top"]}')
        if not only or only == 'short-negatives':
            out(f'SHORT-NEG   tune closed {short_tune_negatives["closed"]}/{short_tune_negatives["n"]}   '
                f'held-out closed {short_held_negatives["closed"]}/{short_held_negatives["n"]}')
            for result, flag in ((short_tune_negatives, options['misses']), (short_held_negatives, options['final_misses'])):
                if flag:
                    for row in result['rows']:
                        if row['gate_open']:
                            out(f'   {row["id"]} [OPEN] {row["q"]!r}  top {row["top"]}')
        if only:
            return
        out('')
        failed = []
        rules = ev.rule_results(tune, held, held_negatives) + ev.prompt25_rule_results(
            tune, held, held_negatives, short_tune, short_tune_negatives, short_held, short_held_negatives)
        for name, passed, actual, needed in rules:
            out(f'  {"PASS" if passed else "FAIL"}  {name}: {actual} (needed {needed})')
            if not passed:
                failed.append(name)
        if failed:
            raise CommandError('Pass rule not met: ' + ', '.join(failed))
        out(self.style.SUCCESS('Pass rule met.'))
