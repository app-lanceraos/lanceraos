# apps/help/management/commands/export_help_fixtures.py
"""
Writes the frontend's tracked Help test data (frontend/src/test-fixtures/help/) by driving the REAL endpoints, so Prompt 25's
page tests cannot drift from the backend (Prompt 24, Part 9). Same discipline as export_contract_fixtures:

  * refuses to run unless DEBUG is true;
  * does all its work inside ONE transaction that is rolled back at the end (it creates a throwaway user), and fails if the
    row counts differ afterwards;
  * makes a live model request impossible (core.ai's HTTP call is patched to raise) and stubs run_ai_task at apps.help.service
    with hand-written replies - the REAL parser, guard and block builder still run on them;
  * deletes the cache keys it touches before and after (it never clears the whole cache);
  * counts the stubbed model calls and fails unless they equal the number the run is built to make.
The output is byte-stable between runs: it holds slugs, sentences and the library version, never an id or a time.
"""
import json
from pathlib import Path
from unittest import mock

from django.conf import settings
from django.core.cache import cache
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.test.utils import override_settings
from rest_framework.test import APIClient

from apps.help import constants as c
from apps.help import service
from apps.help.library import BY_SLUG, LIBRARY_VERSION
from apps.help.links import LINK_TARGETS
from core.ai import AiResult
from core.models import AiCallLog, AuditLog

DEFAULT_OUT = Path('frontend/src/test-fixtures/help')
THROWAWAY_EMAIL = 'fixture-help@example.invalid'
SUPPORT = 'help@example.com'
GUIDES_TO_EXPORT = ('create-an-invoice', 'send-an-invoice', 'the-tax-page')   # steps + note + link blocks; a plain one; a Tax one
SEND_Q = 'How do I send an invoice to my client?'
OPEN_GATE_Q = 'How do I record a payment on an invoice?'
EXPECTED_MODEL_CALLS = 6      # answered, not_covered, ai_unavailable, answer_rejected, off_topic, and the soft-limit's first ask
ANSWER = ('STATUS: ANSWER\nANSWER:\nOpen the invoice from the Invoices list.\n1. Press Send.\n2. Confirm in the box.\n'
          'Your client gets the invoice by email.\nSOURCES: send-an-invoice\n===END===')
REJECTED = ('STATUS: ANSWER\nANSWER:\nSee https://example.com/help for the steps to send it to your client.\n'
            'SOURCES: send-an-invoice\n===END===')


User = get_user_model()


class _Rollback(Exception):
    """Raised on purpose at the end of the run so the transaction is never committed."""


class _Stub:
    """Stands in for run_ai_task: replies come from a queue of hand-written texts or AiResults; the REAL parse runs on a text."""

    def __init__(self):
        self.queue, self.calls = [], 0

    def __call__(self, **kwargs):
        self.calls += 1
        reply = self.queue.pop(0)
        if isinstance(reply, AiResult):
            return reply
        try:
            data = kwargs['parse'](reply)
        except (ValueError, KeyError, TypeError):
            return AiResult(ok=False, failure_reason='invalid_output', user_message='x')
        return AiResult(ok=True, data=data, model=settings.GROQ_MODEL_FAST, usage={'total_tokens': 900})


class Command(BaseCommand):
    help = 'Writes the tracked Help fixtures for the frontend from the real endpoints (DEBUG only; rolled back; no model request).'

    def add_arguments(self, parser):
        parser.add_argument('--out', default=str(DEFAULT_OUT), help='Directory to write (default: %(default)s).')

    def handle(self, *args, **options):
        if not settings.DEBUG:
            raise CommandError('This command only runs with DEBUG=True. It creates throwaway rows (rolled back) and must not run against a live database.')
        out = Path(options['out'])
        out.mkdir(parents=True, exist_ok=True)
        self.files = {}
        self.stub = _Stub()
        self.user_ids = []
        before = self._counts()
        self.stdout.write(f'Before: {before}')
        post_guard = mock.patch('core.ai.requests.post', side_effect=AssertionError('the fixture run reached the real model API'))
        get_guard = mock.patch('core.ai.requests.get', side_effect=AssertionError('the fixture run reached the network'))
        stub_run = mock.patch('apps.help.service.run_ai_task', self.stub)
        try:
            with post_guard, get_guard, stub_run, transaction.atomic():
                self._build()
                self._assert_counts()
                raise _Rollback()
        except _Rollback:
            pass
        finally:
            self._forget()
        after = self._counts()
        self.stdout.write(f'After:  {after}')
        if before != after:
            raise CommandError(f'Rows were left behind: before {before}, after {after}.')
        self._write(out, before, after)

    # -- plumbing ---------------------------------------------------------------------------------------------------

    def _counts(self):
        return {'users': User.objects.count(), 'audit_logs': AuditLog.objects.count(), 'ai_call_logs': AiCallLog.objects.count()}

    def _forget(self):
        """Deletes exactly the cache keys this run touches (never the whole cache)."""
        keys = []
        for pk in self.user_ids:
            keys += [f'help:ask:min:{pk}', f'help:ask:hour:{pk}', f'help:read:{pk}', f'help:search:{pk}', f'help:rate:{pk}',
                     f'ai_rate_{c.AI_FEATURE}_{pk}']
        for question in (SEND_Q, OPEN_GATE_Q):
            keys.append(service.cache_key(service.redact(service.strip_markup(service.normalise(question))).for_model))
        cache.delete_many(keys)

    def _assert_counts(self):
        if self.stub.calls != EXPECTED_MODEL_CALLS:
            raise CommandError(f'The run made {self.stub.calls} stubbed model calls, expected {EXPECTED_MODEL_CALLS}.')
        if self.stub.queue:
            raise CommandError(f'{len(self.stub.queue)} stubbed replies were never used.')

    def add(self, name, data):
        self.files[name] = json.loads(json.dumps(data))

    def call(self, client, method, url, body=None, expect=None):
        response = client.post(url, body, format='json') if method == 'post' else client.get(url)
        if expect is not None and response.status_code != expect:
            raise CommandError(f'{method.upper()} {url} answered {response.status_code}, expected {expect}: {response.content[:300]!r}')
        if response['Cache-Control'] != 'no-store':
            raise CommandError(f'{url} did not answer Cache-Control: no-store.')
        return response.status_code, response.json()

    def ask(self, client, question, previous=None, expect_outcome=None, expect_reason=None, keep_minute_counter=False):
        if not keep_minute_counter:
            cache.delete_many([f'help:ask:min:{pk}' for pk in self.user_ids])   # the soft limit would answer slow_down after a few asks
        body = {'question': question}
        if previous is not None:
            body['previous_question'] = previous
        _status, data = self.call(client, 'post', '/api/help/ask/', body, expect=200)
        if (expect_outcome and data['outcome'] != expect_outcome) or (expect_reason is not None and data['reason'] != expect_reason):
            raise CommandError(f'{question!r} gave {data["outcome"]}/{data["reason"]}, expected {expect_outcome}/{expect_reason}.')
        return data

    # -- the build --------------------------------------------------------------------------------------------------

    def _build(self):
        user = User.objects.create_user(email=THROWAWAY_EMAIL, password='Fixture-Only-1!x')
        self.user_ids = [user.pk]
        self._forget()
        client = APIClient(HTTP_HOST='localhost')
        client.force_authenticate(user=user)

        with override_settings(HELP_AI_ENABLED=True, AI_ENABLED=True, SUPPORT_EMAIL=''):
            # The default settings (written answers OFF), then the same endpoint with both switches ON (decision H21, Prompt 25).
            with override_settings(HELP_AI_ENABLED=False, AI_ENABLED=True):
                _s, index = self.call(client, 'get', '/api/help/guides/', expect=200)
            if index.get('answers_enabled') is not False:
                raise CommandError('guides-index must say answers_enabled: false under the default settings.')
            self.add('guides-index', index)
            _s, index_on = self.call(client, 'get', '/api/help/guides/', expect=200)
            if index_on.get('answers_enabled') is not True:
                raise CommandError('guides-index-answers-on must say answers_enabled: true with both switches on.')
            self.add('guides-index-answers-on', index_on)
            for slug in GUIDES_TO_EXPORT:
                _s, body = self.call(client, 'get', f'/api/help/guides/{slug}/', expect=200)
                self.add(f'guide-{slug}', body)
            _s, hit = self.call(client, 'get', '/api/help/search/?q=how%20do%20I%20send%20an%20invoice', expect=200)
            self.add('search-hit', hit)
            _s, empty = self.call(client, 'get', '/api/help/search/?q=zzzzqq%20xxxxyy', expect=200)
            self.add('search-empty', empty)

            # answered, then the same question again (a cache hit)
            self.stub.queue.append(ANSWER)
            self.add('ask-answered', self.ask(client, SEND_Q, expect_outcome='answered', expect_reason=''))
            cached = self.ask(client, SEND_Q, expect_outcome='answered')
            if not cached['cached']:
                raise CommandError('The second identical question was not served from the cache.')
            self.add('ask-answered-cached', cached)

            self.add('ask-guides-only-no-match', self.ask(client, 'what is the weather in Lahore', expect_outcome='guides_only', expect_reason='no_match'))

            self.stub.queue.append('STATUS: NOT_COVERED\n===END===')
            self.add('ask-guides-only-not-covered', self.ask(client, OPEN_GATE_Q, expect_outcome='guides_only', expect_reason='not_covered'))

            with override_settings(HELP_AI_ENABLED=False):
                self.add('ask-guides-only-ai-off', self.ask(client, SEND_Q, expect_outcome='guides_only', expect_reason='ai_off'))

            self.stub.queue.append(AiResult(ok=False, failure_reason='timeout', user_message='x'))
            self.add('ask-guides-only-ai-unavailable', self.ask(client, OPEN_GATE_Q, expect_outcome='guides_only', expect_reason='ai_unavailable'))

            self.stub.queue.append(REJECTED)
            self.add('ask-guides-only-answer-rejected', self.ask(client, 'Can I send an invoice by email to a client?', expect_outcome='guides_only', expect_reason='answer_rejected'))

            self.stub.queue.append('STATUS: OFF_TOPIC\n===END===')
            self.add('ask-off-topic', self.ask(client, OPEN_GATE_Q + ' and also tell me a joke about invoices', expect_outcome='off_topic'))

            # the soft per-minute limit: the first ask is a no-match (no model call), the second is slowed down
            with mock.patch.object(c, 'ASK_PER_MINUTE', 1):
                self.ask(client, 'what is the weather in Lahore', expect_reason='no_match')
                self.add('ask-guides-only-slow-down', self.ask(client, SEND_Q, expect_outcome='guides_only', expect_reason='slow_down', keep_minute_counter=True))
            # one more stubbed call so the count stays honest: the answered question run once with a previous question (no cache)
            self.stub.queue.append(ANSWER)
            self.ask(client, SEND_Q, previous='how do I add a client', expect_outcome='answered')

        # the support e-mail line, generated twice: set and unset
        with override_settings(HELP_AI_ENABLED=True, AI_ENABLED=True, SUPPORT_EMAIL=SUPPORT):
            self.add('ask-guides-only-no-match-support-email', self.ask(client, 'what is the weather in Lahore', expect_reason='no_match'))
        if self.files['ask-guides-only-no-match-support-email']['support_email'] != SUPPORT or self.files['ask-guides-only-no-match']['support_email'] != '':
            raise CommandError('support_email did not follow SUPPORT_EMAIL.')

        # the errors
        with override_settings(HELP_AI_ENABLED=True, AI_ENABLED=True):
            for name, body in (('ask-400-empty', {'question': ''}), ('ask-400-long', {'question': 'x' * 301})):
                status, data = self.call(client, 'post', '/api/help/ask/', body)
                self.add(name, {'status': status, 'body': data})
            with mock.patch.object(c, 'ASK_PER_HOUR', 1):
                cache.delete_many([f'help:ask:hour:{user.pk}'])
                self.call(client, 'post', '/api/help/ask/', {'question': 'what is the weather in Lahore'}, expect=200)
                status, data = self.call(client, 'post', '/api/help/ask/', {'question': 'what is the weather in Lahore'})
                self.add('ask-429', {'status': status, 'body': data})
            status, data = self.call(client, 'get', '/api/help/guides/not-a-guide/')
            self.add('guide-404', {'status': status, 'body': data})
            status, data = self.call(client, 'get', '/api/help/search/?q=a')
            self.add('search-400', {'status': status, 'body': data})
            status, data = self.call(client, 'post', '/api/help/rate/', {'helpful': 'yes', 'guides': ['send-an-invoice']})
            self.add('rate-400', {'status': status, 'body': data})
            _s, ok = self.call(client, 'post', '/api/help/rate/', {'helpful': True, 'guides': ['send-an-invoice']}, expect=200)
            self.add('rate-ok', ok)

        self.add('link-targets', list(LINK_TARGETS))
        self.add('topics', [{'slug': t.slug, 'title': t.title, 'blurb': t.blurb} for t in c.TOPICS])
        self.add('constants', {
            'QUESTION_MIN_CHARS': c.QUESTION_MIN_CHARS, 'QUESTION_MAX_CHARS': c.QUESTION_MAX_CHARS,
            'SEARCH_MIN_CHARS': c.SEARCH_MIN_CHARS, 'SEARCH_MAX_CHARS': c.SEARCH_MAX_CHARS, 'LIBRARY_VERSION': LIBRARY_VERSION,
            'POPULAR_SLUGS': list(c.POPULAR_SLUGS), 'GUIDE_COUNT': len(BY_SLUG),
            # (Prompt 26) so the page's copy scan and timeout test read the backend's own values, never a pasted copy
            'AI_TOTAL_BUDGET_SECONDS': c.AI_TOTAL_BUDGET_SECONDS, 'BANNED_PHRASES': list(c.BANNED_PHRASES),
            'STYLE_WORDS': list(c.STYLE_WORDS)})

    # -- writing ----------------------------------------------------------------------------------------------------

    def _write(self, out, before, after):
        rendered = {name: json.dumps(data, indent=2, sort_keys=True, ensure_ascii=False) + '\n' for name, data in self.files.items()}
        for name, text in rendered.items():
            for needle in (THROWAWAY_EMAIL, 'gsk_'):
                if needle in text:
                    raise CommandError(f'{name}.json contains a value that must not be in a fixture: {needle}')
        for name, text in rendered.items():
            (out / f'{name}.json').write_text(text, encoding='utf-8')
        (out / 'index.js').write_text(_index_js(sorted(rendered)), encoding='utf-8')
        (out / 'README.md').write_text(_readme(len(rendered), self.stub.calls), encoding='utf-8')
        self.stdout.write(self.style.SUCCESS(
            f'Wrote {len(rendered)} fixtures to {out} (stubbed model calls: {self.stub.calls}; real model requests: 0). '
            f'Rows before/after: {before} / {after}.'))


def _index_js(names):
    lines = [
        '// src/test-fixtures/help/index.js',
        '//',
        '// Loads every tracked Help fixture by file name (without .json): FIXTURES["ask-answered"].',
        '// Generated by `python manage.py export_help_fixtures`; do not edit by hand. Always read through clone().',
        "const files = import.meta.glob('./*.json', { eager: true, import: 'default' })",
        '',
        'export const FIXTURES = {}',
        'for (const [path, body] of Object.entries(files)) {',
        "  FIXTURES[path.replace('./', '').replace('.json', '')] = body",
        '}',
        'export const FIXTURE_NAMES = ' + json.dumps(names, indent=2),
        'export const clone = (value) => JSON.parse(JSON.stringify(value))',
        '',
    ]
    return '\n'.join(lines)


def _readme(count, model_calls):
    return f"""# Help test fixtures (Prompt 24; Prompt 25 added `guides-index-answers-on`)

Tracked on purpose (the `*.test.*` files are gitignored). Every `.json` file here was **generated from the real endpoints** by
`python manage.py export_help_fixtures --out frontend/src/test-fixtures/help`, not typed by hand. Do not edit them by hand;
re-run the command and review the diff. The output is byte-stable between runs (it holds slugs, sentences and the library
version, never an id or a time).

## How the command works

* It refuses to run unless `DEBUG` is true.
* It does all its work inside **one database transaction that is rolled back at the end**, with a throwaway user. It fails if the
  row counts (users, audit rows, AI call rows) differ afterwards.
* **No model request is ever made.** `core.ai.requests.post` is patched to raise. `apps.help.service.run_ai_task` is replaced by a
  stub that returns hand-written replies, and the REAL reply parser, the REAL guard and the REAL block builder run on them. The
  command counts the stubbed model calls and fails unless the number is exactly the one the run is built to make: this run made
  **{model_calls}** stubbed calls and **0** real requests.
* It deletes the cache keys it touches (the throwaway user's rate-limit counters and the two answer-cache entries) before and after.
  It never clears the whole cache.

## Files ({count} JSON files and this README, plus `index.js`)

| File | Source |
|------|--------|
| `guides-index`, `guides-index-answers-on` | `GET /api/help/guides/` with the default settings (`answers_enabled: false`), and with `HELP_AI_ENABLED` and `AI_ENABLED` both on (`true`) |
| `guide-create-an-invoice`, `guide-send-an-invoice`, `guide-the-tax-page` | `GET /api/help/guides/<slug>/` (the first has steps, a note and a link block) |
| `search-hit`, `search-empty` | `GET /api/help/search/?q=` |
| `ask-answered`, `ask-answered-cached` | `POST /api/help/ask/`: a stubbed model reply that passes the guard; then the same question served from the cache |
| `ask-guides-only-no-match`, `ask-guides-only-no-match-support-email` | the gate stays closed (no model call); the second with `SUPPORT_EMAIL` set to `{SUPPORT}` |
| `ask-guides-only-not-covered`, `ask-off-topic` | the stubbed model answers `NOT_COVERED` / `OFF_TOPIC` |
| `ask-guides-only-ai-off` | `HELP_AI_ENABLED` switched off |
| `ask-guides-only-ai-unavailable` | the stubbed AI call fails (`timeout`) |
| `ask-guides-only-answer-rejected` | a stubbed answer containing a web address, rejected by the guard |
| `ask-guides-only-slow-down` | the soft per-minute limit |
| `ask-400-empty`, `ask-400-long`, `ask-429`, `guide-404`, `search-400`, `rate-400` | the real `{{status, body}}` of the refused requests |
| `rate-ok` | `POST /api/help/rate/` |
| `link-targets`, `topics` | `apps/help/links.py`, `apps/help/constants.py` |
| `constants` | `apps/help/constants.py`: `QUESTION_MIN_CHARS`, `QUESTION_MAX_CHARS`, `SEARCH_MIN_CHARS`, `SEARCH_MAX_CHARS`, `LIBRARY_VERSION`, `POPULAR_SLUGS`, `GUIDE_COUNT`, and (Prompt 26) `AI_TOTAL_BUDGET_SECONDS`, `BANNED_PHRASES`, `STYLE_WORDS` |

The Help page's tests (`frontend/src/pages/__tests__/Help*.test.jsx`, `helpDrift.test.js`) read these files; a limit, a banned word or a sentence that the
page mirrors must change here first (re-run the command), never in a test.
"""
