# apps/help/management/commands/check_help_library.py
"""
Checks the Help guide library against the repository (Prompt 24, Part 2). Run before each release (DEPLOYMENT.md section 7m)
and whenever a screen's wording changes: it prints every problem, the spelled-out numbers (for human review under decision
H15), the guides per topic and LIBRARY_VERSION, and exits non-zero if there is any problem.
  --no-repo   skip the checks that need frontend/ (what the Docker image can do)
  --stale     also list guides whose source files changed in git after the guide's `checked_on` date (information only)
"""
import subprocess
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from apps.help import constants as c
from apps.help import library


class Command(BaseCommand):
    help = 'Checks the Help guides against the real routes and labels. Exits non-zero on any problem.'

    def add_arguments(self, parser):
        parser.add_argument('--no-repo', action='store_true', help='Skip the checks that need the frontend source.')
        parser.add_argument('--stale', action='store_true', help='List guides whose source files changed after checked_on.')

    def handle(self, *args, **options):
        root = Path(settings.BASE_DIR)
        found = library.problems(repo_root=None if options['no_repo'] else root)
        for problem in found:
            self.stdout.write(self.style.ERROR(problem))
        self.stdout.write('')
        self.stdout.write(f'Guides: {len(library.LIBRARY)}   LIBRARY_VERSION: {library.LIBRARY_VERSION}')
        for topic in c.TOPICS:
            self.stdout.write(f'  {topic.slug}: {sum(1 for g in library.LIBRARY if g.topic == topic.slug)}')
        words = library.number_words()
        self.stdout.write('')
        self.stdout.write(f'Spelled-out numbers in shown text ({len(words)}), for review under decision H15:')
        for slug, word, sentence in words:
            self.stdout.write(f'  {slug} [{word}]: {sentence}')
        if options['stale']:
            self.stdout.write('')
            self._stale(root)
        if found:
            raise CommandError(f'{len(found)} problem(s) found in the Help library.')
        self.stdout.write(self.style.SUCCESS('No problems found.'))

    def _stale(self, root):
        try:
            subprocess.run(['git', '--version'], capture_output=True, check=True, cwd=root)
        except (OSError, subprocess.CalledProcessError):
            self.stdout.write('git not available: cannot check which sources changed.')
            return
        self.stdout.write('Guides whose sources changed in git after checked_on:')
        any_stale = False
        for g in library.LIBRARY:
            for src in g.sources:
                out = subprocess.run(['git', 'log', '-1', '--format=%cs', '--', src], capture_output=True, text=True, cwd=root).stdout.strip()
                if out and out > g.checked_on:
                    self.stdout.write(f'  {g.slug}: {src} changed {out} (guide checked {g.checked_on})')
                    any_stale = True
        if not any_stale:
            self.stdout.write('  none')
