# apps/contracts/management/commands/export_contract_fixtures.py
"""
Writes the frontend's tracked Contracts test data (frontend/src/test-fixtures/contracts/) by driving the REAL owner and
public endpoints, so the frontend tests cannot drift from the backend (Prompt 23, Part 2).

Safety: refuses to run unless DEBUG is true; does all its work inside ONE transaction that is rolled back at the end;
sends no email (the email sender is replaced by a stub that records it was asked, and the real HTTP client is replaced
by one that fails loudly); enqueues no Celery task; touches only a throwaway user. The clock is frozen inside the
command only (it advances one second per call, so the times are ordered and the files are stable between runs).
"""
import json
import re
from datetime import datetime, timedelta
from decimal import Decimal
from pathlib import Path
from unittest import mock

from django.conf import settings
from django.core.cache import cache
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from rest_framework import serializers as drf_serializers
from rest_framework.test import APIClient

from apps.clients.models import Client
from apps.contracts import constants as limits
from apps.contracts import copy as words
from apps.contracts.models import Contract
from apps.contracts.serializers import clean_signer_name
from apps.proposals.models import MAX_AMOUNT, Proposal
from apps.users.cookies import ACCESS_COOKIE_NAME
from apps.users.models import User
from apps.users.token_service import issue_tokens_and_session

DEFAULT_OUT = Path('frontend/src/test-fixtures/contracts')
OWNER_IP = '203.0.113.9'
CLIENT_IP = '198.51.100.7'
OWNER_UA = 'FixtureOwnerBrowser/1.0'
CLIENT_UA = 'FixtureClientBrowser/1.0'
THROWAWAY_EMAIL = 'fixture-owner@example.invalid'
CLIENT_EMAIL = 'client@example.com'
FIXED_START = datetime(2026, 11, 10, 12, 0, 0)
FAKE_EMAIL_RESULT = {
    'sent': True, 'sent_via': 'resend', 'smtp_host': None, 'provider_message_id': 'msg_fixture',
    'fallback_used': False, 'error': None,
}
# What one run is built to ask of the stubs: one contract sent by email, one declined (the freelancer's notice), and two
# successful client signings, each of which asks (the mocked) `.delay` once for the signed copies. Nothing reaches a broker.
EXPECTED_STUB_CALLS = {'client_emails': 1, 'owner_emails': 1, 'signed_copy_queue_requests': 2}
UUID_RE = re.compile(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}')
IP_RE = re.compile(r'\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b')
SECRET_RE = re.compile(r'gsk_[A-Za-z0-9]|\bre_[A-Za-z0-9]{8}')


class _Rollback(Exception):
    """Raised on purpose at the end of the run so the transaction is never committed."""


class _Clock:
    """A frozen clock that advances one second per call, so every timestamp is ordered and the output is stable."""

    def __init__(self):
        self.now = FIXED_START

    def __call__(self):
        self.now += timedelta(seconds=1)
        return self.now


SIGNER_NAME_INPUTS = [
    'Ali Amir', '  Ali   Amir  ', 'A', 'AB', 'a' * 120, 'a' * 121, 'X' * 200, '12345', '1a', 'a1', '--', '',
    '   ', '\x07', 'Ali\x00Amir', 'Ali\tAmir', 'Ali\nAmir', 'Ali\r\nAmir', 'Ali\x85Amir', 'Ali Amir',
    'Ali Amir', ' Ali ', 'Ali Amir', 'A​B', '\U0001F600\U0001F600', '\U0001F600A',
    '\U0001F600' * 3 + 'b', 'علی امیر', 'علی', 'José Álvarez', 'Zoë', "O'Brien-Smith", 'Ａｌｉ',
    '\U0001D56C\U0001D56D', '\U00020BB7野家', 'á', '٣٤٥', 'ǅ', 'ª', 'Dr. Ali Amir Jr.',
    '\U0001F600' * 119 + 'ab', '\U0001F600' * 60 + 'a' * 61, 'A\ufeff', '\ufeffAB', 'Ali\u180eAmir', 'Ali\u200bAmir',
    'Ali\x0bAmir', 'Ali\x1cAmir',
]


def _owner_client(user, ip, user_agent, with_cookie=False):
    """An APIClient that looks like a browser at `ip`; `with_cookie` carries the user's real access cookie."""
    client = APIClient(REMOTE_ADDR=ip, HTTP_USER_AGENT=user_agent, HTTP_HOST='localhost')
    if with_cookie:
        from django.test import RequestFactory

        request = RequestFactory().post('/api/auth/login/', HTTP_USER_AGENT=user_agent, HTTP_HOST='localhost')
        request.META['REMOTE_ADDR'] = ip
        user.is_email_verified = True
        user.save(update_fields=['is_email_verified'])
        access_token, _refresh, _session = issue_tokens_and_session(user, request, remember_me=True)
        client.cookies[ACCESS_COOKIE_NAME] = access_token
    else:
        client.force_authenticate(user=user)
    return client


class Command(BaseCommand):
    help = 'Writes the tracked Contracts fixtures for the frontend from the real endpoints (DEBUG only; rolled back).'

    def add_arguments(self, parser):
        parser.add_argument('--out', default=str(DEFAULT_OUT), help='Directory to write (default: %(default)s).')

    # -- plumbing ---------------------------------------------------------------------------------------------------

    def handle(self, *args, **options):
        if not settings.DEBUG:
            raise CommandError('This command only runs with DEBUG=True. It creates throwaway rows (rolled back) and must not run against a live database.')
        out = Path(options['out'])
        out.mkdir(parents=True, exist_ok=True)
        self.files = {}
        self.stub_calls = {'email': 0, 'owner_email': 0}
        before = self._counts()
        self.stdout.write(f'Before: {before}')
        clock = _Clock()
        post_guard = mock.patch('core.email.requests.post', side_effect=AssertionError('the fixture run reached the real mail API'))
        stub_send = mock.patch('apps.contracts.views.send_client_facing_email', side_effect=self._fake_client_email)
        stub_notice = mock.patch('core.email.send_email', side_effect=self._fake_owner_email)
        stub_delay = mock.patch('apps.contracts.tasks.send_signed_copies.delay')
        stub_clock = mock.patch('django.utils.timezone.now', side_effect=clock)
        self._reset_limits()
        try:
            with post_guard, stub_send, stub_notice, stub_delay as delay, stub_clock, transaction.atomic():
                self._build()
                self._assert_nothing_sent(delay)
                raise _Rollback()
        except _Rollback:
            pass
        finally:
            self._reset_limits()
        after = self._counts()
        self.stdout.write(f'After:  {after}')
        if before != after:
            raise CommandError(f'Rows were left behind: before {before}, after {after}.')
        self._write(out, before, after)

    def _fake_client_email(self, *args, **kwargs):
        self.stub_calls['email'] += 1
        return dict(FAKE_EMAIL_RESULT)

    def _fake_owner_email(self, *args, **kwargs):
        self.stub_calls['owner_email'] += 1
        return True

    def _assert_nothing_sent(self, delay):
        """
        Compares the stub counters with what the run is built to produce, and fails loudly on any difference.
        `.delay` IS reached (once per successful client signing, straight after the signing commit), but it is the
        mock's: nothing reaches a broker. The expected numbers are constants so a change to the run has to update them.
        """
        self.queue_requests = delay.call_count
        actual = {'client_emails': self.stub_calls['email'], 'owner_emails': self.stub_calls['owner_email'],
                  'signed_copy_queue_requests': delay.call_count}
        if actual != EXPECTED_STUB_CALLS:
            raise CommandError(f'The stub counters {actual} differ from the expected {EXPECTED_STUB_CALLS}; the run sent or queued something it should not have, or the run changed.')

    def _counts(self):
        return {
            'contracts': Contract.objects.count(), 'proposals': Proposal.objects.count(),
            'clients': Client.objects.count(), 'users': User.objects.count(),
        }

    def _reset_limits(self):
        """Deletes exactly the rate-limit counters this run touches (the fake IPs; the throwaway user's keys)."""
        keys = []
        for ip in (OWNER_IP, CLIENT_IP):
            keys += [f'ratelimit_contracts_public_{kind}_{ip}' for kind in ('get', 'sign', 'decline', 'pdf')]
        for pk in getattr(self, 'user_ids', []):
            keys += [f'ratelimit_contracts_{action}_{pk}' for action in ('create', 'update', 'delete', 'send', 'withdraw', 'duplicate')]
            keys += [f'reports:pdf:{pk}', f'throttle_user_{pk}']
        cache.delete_many(keys)

    # -- file bookkeeping -------------------------------------------------------------------------------------------

    def add(self, name, data):
        """Stores one fixture (a JSON-able value) under `name` (without .json)."""
        self.files[name] = json.loads(json.dumps(data, default=str))

    def call(self, client, method, url, body=None, expect=None, **extra):
        response = getattr(client, method)(url, body if body is not None else {}, format='json', **extra) \
            if method in ('post', 'patch', 'put') else getattr(client, method)(url, **extra)
        if expect is not None and response.status_code != expect:
            raise CommandError(f'{method.upper()} {url} answered {response.status_code}, expected {expect}: {response.content[:300]!r}')
        try:
            data = response.json()
        except ValueError:
            data = None
        return response.status_code, data

    # -- the build --------------------------------------------------------------------------------------------------

    def _build(self):
        user = User.objects.create_user(email=THROWAWAY_EMAIL, password='Fixture-Only-1!x')
        self.user_ids = [user.pk]
        profile = user.profile
        profile.display_name = 'Sara Fixture'
        profile.business_name = 'Fixture Studio'
        profile.city = 'Lahore'
        profile.country = 'Pakistan'
        profile.default_currency = 'USD'
        profile.notif_client_messages = True
        profile.save()
        self.tokens = {}

        owner = _owner_client(user, OWNER_IP, OWNER_UA)
        owner_with_cookie = _owner_client(user, OWNER_IP, OWNER_UA, with_cookie=True)
        visitor = APIClient(REMOTE_ADDR=CLIENT_IP, HTTP_USER_AGENT=CLIENT_UA, HTTP_HOST='localhost')
        today = (FIXED_START).date()
        sign_by = (today + timedelta(days=14)).isoformat()

        client_row = Client.objects.create(user=user, name='Acme Co', email=CLIENT_EMAIL, company='Acme Holdings')
        accepted = Proposal.objects.create(
            user=user, title='React dashboard build', status='accepted', currency='USD', total=Decimal('900.00'),
            payment_terms='Half now, half on delivery', client=client_row, client_name='Acme Co',
            client_email=CLIENT_EMAIL, client_company='Acme Holdings', proposal_number='PRO-2026-0001',
            scope_sections=[{'title': 'Dashboard', 'text': 'Build the charts.'}, {'title': 'Handover', 'text': 'Docs.'}])
        not_accepted = Proposal.objects.create(
            user=user, title='Still a draft', status='draft', currency='USD', total=Decimal('100.00'),
            proposal_number='PRO-2026-0002')

        # Static data
        _, templates = self.call(owner, 'get', '/api/contracts/templates/', expect=200)
        self.add('templates', templates)
        self.add('limits', {
            'SECTION_MAX': limits.SECTION_MAX, 'SECTION_TITLE_MAX': limits.SECTION_TITLE_MAX,
            'SECTION_TEXT_MAX': limits.SECTION_TEXT_MAX, 'TOTAL_TEXT_MAX': limits.TOTAL_TEXT_MAX,
            'PAYMENT_TERMS_MAX': limits.PAYMENT_TERMS_MAX, 'NAME_MIN': limits.NAME_MIN, 'NAME_MAX': limits.NAME_MAX,
            'MESSAGE_MAX': limits.MESSAGE_MAX, 'TITLE_MAX': limits.TITLE_MAX, 'MAX_AMOUNT': str(MAX_AMOUNT),
        })

        # Empty list (before any contract exists)
        _, empty = self.call(owner, 'get', '/api/contracts/', expect=200)
        self.add('list-empty', empty)

        # Drafts
        _, draft = self.call(owner, 'post', '/api/contracts/', {'template_key': 'web_development', 'client_name': 'Acme Co'}, expect=201)
        draft.pop('notices', None)
        self.add('detail-draft', draft)
        _, from_proposal = self.call(owner, 'post', '/api/contracts/', {'template_key': 'consulting', 'proposal': str(accepted.pk)}, expect=201)
        self.add('detail-draft-from-proposal', from_proposal)

        # A sendable draft: fill every blank through the real PATCH
        def make_sendable(template_key='custom', title='Website agreement', email=CLIENT_EMAIL):
            _, created = self.call(owner, 'post', '/api/contracts/', {
                'template_key': template_key, 'title': title, 'client_name': 'Acme Co', 'client_email': email,
                'client_company': 'Acme Holdings'}, expect=201)
            filled = [
                {'id': s['id'], 'title': s['title'], 'text': re.sub(r'\[\[.*?\]\]', 'the agreed work', s['text'], flags=re.DOTALL)}
                for s in created['sections']
            ]
            _, detail = self.call(owner, 'patch', f"/api/contracts/{created['id']}/", {
                'sections': filled, 'fee_amount': '1500.00', 'currency': 'USD', 'valid_until': sign_by,
                'payment_terms': 'Half now, half on delivery'}, expect=200)
            return detail

        ready = make_sendable()
        for method in ('email', 'link'):
            _, body = self.call(owner, 'get', f"/api/contracts/{ready['id']}/send-check/?method={method}", expect=200)
            self.add(f'send-check-ready-{method}', body)

        # One failing check each (the state is set directly where the API would refuse to save it)
        failing = {
            'title': {'title': ''},
            'client_name': {'client_name': ''},
            'sections': None,
            'placeholders': None,
            'fee': {'fee_amount': Decimal('0'), 'payment_terms': ''},
            'sign_by': {'valid_until': None},
            'client_email': {'client_email': ''},
        }
        for check_id, fields in failing.items():
            sample = make_sendable()
            row = Contract.objects.get(pk=sample['id'])
            if check_id == 'sections':
                sections = [dict(s) for s in row.sections]
                sections[1]['text'] = ''
                row.sections = sections
                row.save(update_fields=['sections'])
            elif check_id == 'placeholders':
                sections = [dict(s) for s in row.sections]
                sections[0]['text'] = sections[0]['text'] + ' [[to be agreed]]'
                row.sections = sections
                row.save(update_fields=['sections'])
            else:
                for key, value in fields.items():
                    setattr(row, key, value)
                row.save(update_fields=list(fields))
            method = 'email' if check_id == 'client_email' else 'link'
            _, body = self.call(owner, 'get', f'/api/contracts/{row.pk}/send-check/?method={method}', expect=200)
            self.add(f'send-check-{check_id}', body)
            row.delete()
        warn = make_sendable()
        Contract.objects.filter(pk=warn['id']).update(fee_amount=Decimal('0'))
        _, body = self.call(owner, 'get', f"/api/contracts/{warn['id']}/send-check/?method=link", expect=200)
        self.add('send-check-warning', body)
        Contract.objects.filter(pk=warn['id']).delete()

        # Sent by link, sent by email, viewed, signed, declined, withdrawn, expired
        def send(detail, method, name='Sara Fixture'):
            return self.call(owner, 'post', f"/api/contracts/{detail['id']}/send/",
                             {'method': method, 'confirm': True, 'signer_name': name}, expect=200)[1]

        sent_link = send(ready, 'link')
        self.add('detail-sent-link', sent_link)
        sent_email = send(make_sendable(title='Logo design', template_key='design'), 'email')
        self.add('detail-sent-email', sent_email)

        viewed = send(make_sendable(title='Content retainer', template_key='content_writing'), 'link')
        self._remember(viewed)
        self.call(visitor, 'get', self._public(viewed), expect=200)
        self._reset_limits()
        _, viewed_detail = self.call(owner, 'get', f"/api/contracts/{viewed['id']}/", expect=200)
        self.add('detail-viewed', viewed_detail)

        # Public payloads of an open contract: the visitor's and the owner's own preview
        self._remember(sent_link)
        _, public_open = self.call(visitor, 'get', self._public(sent_link), expect=200)
        self.add('public-open', public_open)
        _, public_preview = self.call(owner_with_cookie, 'get', self._public(sent_link), expect=200)
        self.add('public-open-preview', public_preview)
        if not public_preview.get('preview'):
            raise CommandError('The owner preview payload did not say preview: true.')
        # the preview must not have changed the state the visitor's view set
        self._reset_limits()

        signed = send(make_sendable(title='Brand identity', template_key='design'), 'link')
        self._remember(signed)
        _, public_signed = self.call(visitor, 'post', self._public(signed, 'sign/'), {'signer_name': 'Zainab Khan', 'agree': True}, expect=200)
        self.add('public-signed', public_signed)
        _, signed_detail = self.call(owner, 'get', f"/api/contracts/{signed['id']}/", expect=200)
        self.add('detail-signed', signed_detail)

        declined = send(make_sendable(title='Consulting agreement', template_key='consulting'), 'link')
        self._remember(declined)
        _, public_declined = self.call(visitor, 'post', self._public(declined, 'decline/'),
                                       {'reason': 'The fee is more than our budget.'}, expect=200)
        self.add('public-declined', public_declined)
        _, declined_detail = self.call(owner, 'get', f"/api/contracts/{declined['id']}/", expect=200)
        self.add('detail-declined', declined_detail)

        withdrawn = send(make_sendable(title='Withdrawn agreement'), 'link')
        self._remember(withdrawn)
        _, withdrawn_detail = self.call(owner, 'post', f"/api/contracts/{withdrawn['id']}/withdraw/", {'confirm': True}, expect=200)
        self.add('detail-withdrawn', withdrawn_detail)
        _, public_withdrawn = self.call(visitor, 'get', self._public(withdrawn), expect=200)
        self.add('public-withdrawn', public_withdrawn)

        expired = send(make_sendable(title='Expired agreement'), 'link')
        self._remember(expired)
        Contract.objects.filter(pk=expired['id']).update(valid_until=today - timedelta(days=1))
        _, expired_detail = self.call(owner, 'get', f"/api/contracts/{expired['id']}/", expect=200)
        self.add('detail-expired', expired_detail)
        _, public_expired = self.call(visitor, 'get', self._public(expired), expect=200)
        self.add('public-expired', public_expired)

        # The list: every status, an expired row and a draft
        _, listing = self.call(owner, 'get', '/api/contracts/', expect=200)
        self.add('list', listing)

        self._errors(owner, visitor, owner_with_cookie, make_sendable, send, not_accepted, accepted, today)
        self._words()

    def _remember(self, detail):
        self.tokens[detail['id']] = Contract.objects.get(pk=detail['id']).view_token

    def _public(self, detail, suffix=''):
        token = self.tokens.get(detail['id']) or Contract.objects.get(pk=detail['id']).view_token
        self.tokens[detail['id']] = token
        return f'/api/contracts/public/{token}/{suffix}'

    def _errors(self, owner, visitor, owner_with_cookie, make_sendable, send, not_accepted, accepted, today):
        errors = {}
        status, body = self.call(owner, 'post', '/api/contracts/', {'template_key': 'custom', 'proposal': str(not_accepted.pk)})
        errors['create_proposal_not_accepted_409'] = {'status': status, 'body': body}

        sent = send(make_sendable(title='Locked agreement'), 'link')
        self._remember(sent)
        status, body = self.call(owner, 'patch', f"/api/contracts/{sent['id']}/", {'title': 'New title'})
        errors['patch_not_draft_403'] = {'status': status, 'body': body}
        status, body = self.call(owner, 'delete', f"/api/contracts/{sent['id']}/")
        errors['delete_not_draft_403'] = {'status': status, 'body': body}
        status, body = self.call(owner, 'post', f"/api/contracts/{sent['id']}/send/",
                                 {'method': 'link', 'confirm': True, 'signer_name': 'Sara Fixture'})
        errors['send_not_draft_409'] = {'status': status, 'body': body}
        status, body = self.call(owner, 'get', f"/api/contracts/{sent['id']}/send-check/?method=link")
        errors['send_check_not_draft_409'] = {'status': status, 'body': body}

        draft = make_sendable(title='Editable agreement')
        status, body = self.call(owner, 'patch', f"/api/contracts/{draft['id']}/", {'template_key': 'design'})
        errors['patch_template_key_400'] = {'status': status, 'body': body}
        status, body = self.call(owner, 'patch', f"/api/contracts/{draft['id']}/", {'fee_amount': 'abc', 'start_date': 'not-a-date'})
        errors['patch_field_errors_400'] = {'status': status, 'body': body}
        status, body = self.call(owner, 'patch', f"/api/contracts/{draft['id']}/", {'valid_until': (today - timedelta(days=3)).isoformat()})
        errors['patch_valid_until_past_400'] = {'status': status, 'body': body}
        too_many = [{'id': f's{index:08d}', 'title': 'T', 'text': 'x'} for index in range(limits.SECTION_MAX + 1)]
        status, body = self.call(owner, 'patch', f"/api/contracts/{draft['id']}/", {'sections': too_many})
        errors['patch_too_many_sections_400'] = {'status': status, 'body': body}
        status, body = self.call(owner, 'post', f"/api/contracts/{draft['id']}/send/",
                                 {'method': 'link', 'confirm': True, 'signer_name': ''})
        errors['send_name_400'] = {'status': status, 'body': body}
        unfinished = self.call(owner, 'post', '/api/contracts/', {'template_key': 'custom'}, expect=201)[1]
        status, body = self.call(owner, 'post', f"/api/contracts/{unfinished['id']}/send/",
                                 {'method': 'link', 'confirm': True, 'signer_name': 'Sara Fixture'})
        errors['send_problem_400'] = {'status': status, 'body': body}
        status, body = self.call(owner, 'post', f"/api/contracts/{draft['id']}/withdraw/", {'confirm': True})
        errors['withdraw_draft_409'] = {'status': status, 'body': body}

        # Public errors
        self._reset_limits()
        status, body = self.call(owner_with_cookie, 'post', self._public(sent, 'sign/'), {'signer_name': 'Sara Fixture', 'agree': True})
        errors['public_sign_owner_403'] = {'status': status, 'body': body}
        status, body = self.call(visitor, 'post', self._public(sent, 'sign/'), {'signer_name': '', 'agree': True})
        errors['public_sign_name_400'] = {'status': status, 'body': body}
        status, body = self.call(visitor, 'post', self._public(sent, 'sign/'), {'signer_name': 'Client Person', 'agree': False})
        errors['public_sign_agree_400'] = {'status': status, 'body': body}
        status, body = self.call(visitor, 'post', self._public(sent, 'decline/'), {'reason': 'x' * (limits.MESSAGE_MAX + 5)})
        errors['public_decline_too_long_400'] = {'status': status, 'body': body}
        status, body = self.call(visitor, 'get', self._public(sent, 'pdf/'))
        errors['public_pdf_not_signed_409'] = {'status': status, 'body': body}
        status, body = self.call(visitor, 'get', '/api/contracts/public/NOPE_NOT_A_REAL_TOKEN/')
        errors['public_404'] = {'status': status, 'body': body}
        self._reset_limits()
        status, body = self.call(visitor, 'post', self._public(sent, 'sign/'), {'signer_name': 'Client Person', 'agree': True})
        if status != 200:
            raise CommandError(f'The error-case contract could not be signed: {status} {body}')
        status, body = self.call(visitor, 'post', self._public(sent, 'sign/'), {'signer_name': 'Client Person', 'agree': True})
        errors['public_sign_already_answered_409'] = {'status': status, 'body': body}
        status, body = self.call(owner, 'post', f"/api/contracts/{sent['id']}/withdraw/", {'confirm': True})
        errors['withdraw_signed_409'] = {'status': status, 'body': body}

        late = send(make_sendable(title='Late agreement'), 'link')
        self._remember(late)
        Contract.objects.filter(pk=late['id']).update(valid_until=today - timedelta(days=2))
        status, body = self.call(visitor, 'post', self._public(late, 'sign/'), {'signer_name': 'Client Person', 'agree': True})
        errors['public_sign_expired_409'] = {'status': status, 'body': body}

        gone = send(make_sendable(title='Gone agreement'), 'link')
        self._remember(gone)
        self.call(owner, 'post', f"/api/contracts/{gone['id']}/withdraw/", {'confirm': True}, expect=200)
        status, body = self.call(visitor, 'post', self._public(gone, 'sign/'), {'signer_name': 'Client Person', 'agree': True})
        errors['public_sign_withdrawn_409'] = {'status': status, 'body': body}

        changed = send(make_sendable(title='Changed agreement'), 'link')
        self._remember(changed)
        row = Contract.objects.get(pk=changed['id'])
        sections = [dict(s) for s in row.sections]
        sections[0]['text'] = sections[0]['text'] + ' (changed after it was sent)'
        Contract.objects.filter(pk=row.pk).update(sections=sections)
        status, body = self.call(visitor, 'post', self._public(changed, 'sign/'), {'signer_name': 'Client Person', 'agree': True})
        errors['public_sign_integrity_409'] = {'status': status, 'body': body}
        self._reset_limits()
        self.add('errors', errors)

    def _words(self):
        names = [
            'EMAIL_RECORDED', 'PDF_FINGERPRINT_LABEL', 'PDF_FINGERPRINT_NOTE', 'PDF_SIGNING_NOTE_BOTH',
            'PDF_SIGNING_NOTE_OWNER', 'NAME_REQUIRED', 'NAME_LENGTH', 'NAME_NEEDS_LETTERS', 'AGREE_REQUIRED',
            'REASON_TOO_LONG', 'NOT_SIGNED_YET', 'TOO_MANY_ACTIONS', 'TOO_MANY_SENDS', 'TOO_MANY_REQUESTS',
            'OWN_CONTRACT', 'WITHDRAWN', 'PROPOSAL_NOT_ACCEPTED', 'ALREADY_ANSWERED', 'EXPIRED', 'INTEGRITY', 'NOT_FOUND',
        ]
        self.add('sentences', {name: getattr(words, name) for name in names})
        self.add('banned-words', {'banned': list(words.BANNED_WORDS), 'marketing': list(words.MARKETING_WORDS)})
        cases = []
        for raw in SIGNER_NAME_INPUTS:
            try:
                cases.append({'input': raw, 'ok': True, 'normalised': clean_signer_name(raw)})
            except drf_serializers.ValidationError as exc:
                cases.append({'input': raw, 'ok': False, 'message': str(exc.detail[0])})
        self.add('signer-name-cases', cases)

    # -- writing ----------------------------------------------------------------------------------------------------

    def _normalise(self, text, tokens):
        """Stable, fake identifiers: UUIDs by first appearance; secret links by a fixed-width fake of the same length."""
        mapping = {}

        def uuid_sub(match):
            value = match.group(0)
            if value not in mapping:
                mapping[value] = f'00000000-0000-4000-8000-{len(mapping) + 1:012d}'
            return mapping[value]

        for index, token in enumerate(tokens, start=1):
            text = text.replace(token, 'TOKEN_FIXTURE_' + str(index).zfill(max(len(token) - 14, 1)))
        return UUID_RE.sub(uuid_sub, text)

    def _write(self, out, before, after):
        raw = {name: json.dumps(data, indent=2, sort_keys=True, ensure_ascii=False) for name, data in self.files.items()}
        tokens = []  # in order of first appearance, so the fake names do not depend on the random real ones
        for text in raw.values():
            for token in re.findall(r'/contract/([A-Za-z0-9_-]{20,})', text):
                if token not in tokens:
                    tokens.append(token)
        for token in self.tokens.values():
            if token not in tokens:
                tokens.append(token)
        rendered = {name: self._normalise(text, tokens) + '\n' for name, text in raw.items()}
        needles = [THROWAWAY_EMAIL] + tokens
        for name, text in rendered.items():
            for needle in needles:
                if needle in text:
                    raise CommandError(f'{name}.json contains a value that must not be in a fixture: {needle[:6]}...')
            if SECRET_RE.search(text):
                raise CommandError(f'{name}.json looks like it contains a key.')
            for ip in IP_RE.findall(text):
                if ip not in (OWNER_IP, CLIENT_IP):
                    raise CommandError(f'{name}.json contains an unexpected IP address: {ip}')
            if name.startswith('public-') and (OWNER_IP in text or CLIENT_IP in text):
                raise CommandError(f'{name}.json (a public payload) shows an IP address.')
        for name, text in rendered.items():
            (out / f'{name}.json').write_text(text, encoding='utf-8')
        names = sorted(rendered)
        (out / 'index.js').write_text(_index_js(names), encoding='utf-8')
        self.stdout.write(self.style.SUCCESS(
            f'Wrote {len(rendered)} fixtures to {out} (stubbed client emails asked for: {self.stub_calls["email"]}, '
            f'freelancer notice emails asked for: {self.stub_calls["owner_email"]}; signed-copy queue requests swallowed by the mock: '
            f'{self.queue_requests}; nothing sent, nothing really queued). Rows before/after: {before} / {after}.'))


def _index_js(names):
    lines = [
        '// src/test-fixtures/contracts/index.js',
        '//',
        '// Loads every tracked Contracts fixture by file name (without .json): FIXTURES["detail-signed"].',
        '// Generated by `python manage.py export_contract_fixtures`; do not edit by hand. Always read through',
        '// clone() so one test can never change another\'s data.',
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
