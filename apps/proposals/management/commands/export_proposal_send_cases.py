# apps/proposals/management/commands/export_proposal_send_cases.py
"""
Rebuilds the frontend's send pre-flight oracle
(frontend/src/test-fixtures/proposals/send_preflight_cases.json) by running the
REAL backend rule, views._send_content_problem, over a fixed grid. The frontend's
`preflightSend` is tested against that file, so the two checklists cannot drift
apart unnoticed. Run it only when _send_content_problem changes, then review the diff.

The grid and the file format (compact JSON, no trailing newline) reproduce the
committed file byte for byte; a backend test pins that.
"""
import json
from datetime import timedelta
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand

from apps.proposals.models import Proposal, _today
from apps.proposals.views import _send_content_problem

DEFAULT_OUT = Path('frontend/src/test-fixtures/proposals/send_preflight_cases.json')

# Loop order is body (slowest) -> valid-until offset -> client email -> method (fastest).
BODIES = ['', '   \n\t ', 'x', 'Real text here.']
OFFSETS = [None, -1, 0, 1, 30]
EMAILS = ['', '   ', 'a@b.co', ' a@b.co ', 'bad', 'a@b', 'a@@b.co', 'x@y.z.w', 'no at.com']
METHODS = ['email', 'link']

# The first sentence _send_content_problem returns -> the checklist key the frontend uses.
PROBLEM_KEYS = {
    'Write or generate the proposal text before sending.': 'body',
    'Set a valid-until date before sending.': 'valid_until_missing',
    'The valid-until date has passed - choose a future date.': 'valid_until_past',
    "Add the client's email address to send by email, or choose Copy link.": 'client_email',
}


def build_cases():
    """The 360 cases, in fixture order, each with the key of the first problem the real backend reports."""
    today = _today()
    cases = []
    for body in BODIES:
        for offset in OFFSETS:
            valid_until = None if offset is None else today + timedelta(days=offset)
            for email in EMAILS:
                for method in METHODS:
                    proposal = Proposal(body=body, valid_until=valid_until, client_email=email)
                    problem = _send_content_problem(proposal, method)
                    cases.append({
                        'body': body, 'valid_until_offset_days': offset, 'client_email': email,
                        'method': method,
                        'expected_first_problem': PROBLEM_KEYS[problem] if problem else None,
                    })
    return cases


class Command(BaseCommand):
    help = 'Rebuilds the frontend send pre-flight oracle from the real _send_content_problem.'

    def add_arguments(self, parser):
        parser.add_argument('--out', default=None, help='Output path (default: the committed fixture).')

    def handle(self, *args, **options):
        out = Path(options['out']) if options['out'] else Path(settings.BASE_DIR) / DEFAULT_OUT
        out.parent.mkdir(parents=True, exist_ok=True)
        cases = build_cases()
        out.write_text(json.dumps(cases, separators=(',', ':')), encoding='utf-8')
        self.stdout.write(f'Wrote {len(cases)} cases to {out}.')
