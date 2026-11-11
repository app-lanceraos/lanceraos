# apps/contracts/services.py
"""
The Contracts business rules that more than one view uses (Prompt 22, Part 3): creating a contract from a template
(optionally from an accepted proposal), normalising text so the fingerprint is stable, the list of reasons a draft
cannot be sent yet, and numbering a contract at send.
"""
import logging
import re
import secrets
from decimal import Decimal

from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.validators import validate_email
from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.users.models import User

from . import copy as words
from .clauses import CLAUSE_LIBRARY_VERSION, TEMPLATE_LABELS, template_sections
from .constants import PLACEHOLDER_RE, SECTION_TEXT_MAX
from .models import Contract, _today

logger = logging.getLogger(__name__)

NUMBER_MAX_ATTEMPTS = 5

# Control characters other than newline. Tab goes too: a contract is prose, and a stable fingerprint needs a stable text.
_CONTROL_EXCEPT_NEWLINE = re.compile(r'[\x00-\x09\x0b-\x1f\x7f]')


# -- Text normalisation (write time) -------------------------------------------------------------------------------

def normalise_text(value):
    """Trims, turns CRLF and CR into LF, and removes control characters other than newline."""
    text = ('' if value is None else str(value)).replace('\r\n', '\n').replace('\r', '\n')
    return _CONTROL_EXCEPT_NEWLINE.sub('', text).strip()


def normalise_line(value):
    """A single-line value (a title): normalise_text, then every run of whitespace becomes one space."""
    return ' '.join(normalise_text(value).split())


def normalise_sections(sections):
    """
    Returns the sections with trimmed, single-line titles and normalised text, and an `id` on every one
    (`'s' + 8 hex characters` where missing). Raises ValueError('duplicate_id') on a repeated id.
    """
    seen = set()
    result = []
    for section in sections:
        section_id = str(section.get('id') or '').strip()
        if not section_id:
            section_id = 's' + secrets.token_hex(4)
        if section_id in seen:
            raise ValueError('duplicate_id')
        seen.add(section_id)
        result.append({
            'id': section_id,
            'title': normalise_line(section.get('title')),
            'text': normalise_text(section.get('text')),
        })
    return result


# -- Creating from a template --------------------------------------------------------------------------------------

def fill_scope(sections, scope_sections):
    """
    Replaces the FIRST [[...]] in the FIRST section with the proposal's scope sections ("Title\\ntext", joined by a
    blank line). Returns (sections, notice or None). If the result would not fit in one section the placeholder is
    left and a notice is returned instead. A proposal with no scope sections changes nothing.
    """
    parts = []
    for item in scope_sections or []:
        title = normalise_line(item.get('title'))
        text = normalise_text(item.get('text'))
        block = title if not text else (f'{title}\n{text}' if title else text)
        if block:
            parts.append(block)
    if not parts or not sections:
        return sections, None
    first = sections[0]
    match = PLACEHOLDER_RE.search(first['text'])
    if match is None:
        return sections, None
    scope_text = '\n\n'.join(parts)
    new_text = first['text'][:match.start()] + scope_text + first['text'][match.end():]
    if len(new_text) > SECTION_TEXT_MAX:
        return sections, words.SCOPE_TOO_LONG
    first['text'] = new_text
    return sections, None


def default_title(template_key):
    return f'{TEMPLATE_LABELS[template_key][0]} agreement'


def create_from_template(user, *, template_key, client=None, client_fields=None, proposal=None, invoice=None, title=''):
    """
    Creates a draft contract from one of the five templates in one transaction. Returns (contract, notices).

    `client_fields` is the dict of inline client_name / client_email / client_company values (the serializer has
    already applied the client-snapshot rule when `client` was given). An explicit client wins over inline values,
    and both win over the proposal's. The caller has already checked that `proposal` is accepted.
    """
    notices = []
    sections = template_sections(template_key)
    profile = user.profile

    fields = {'currency': profile.default_currency, 'fee_amount': Decimal('0'), 'payment_terms': ''}
    client_data = {}
    if client is not None or client_fields:
        # Anything the person typed or picked about the client wins; the proposal's client is then not used at all,
        # so a linked client and the snapshot beside it can never disagree.
        client_data = {'client': client, **(client_fields or {})}
    if proposal is not None:
        fields.update(currency=proposal.currency, fee_amount=proposal.total, payment_terms=proposal.payment_terms)
        if not client_data:
            client_data = {
                'client': proposal.client, 'client_name': proposal.client_name,
                'client_email': proposal.client_email, 'client_company': proposal.client_company,
            }
        sections, notice = fill_scope(sections, proposal.scope_sections)
        if notice:
            notices.append(notice)

    chosen_title = normalise_line(title) or (proposal.title if proposal is not None else '') or default_title(template_key)

    with transaction.atomic():
        contract = Contract.objects.create(
            user=user, title=normalise_line(chosen_title), template_key=template_key,
            template_version=CLAUSE_LIBRARY_VERSION, sections=sections, proposal=proposal, invoice=invoice,
            **fields, **client_data,
        )
    return contract, notices


# -- Sending -------------------------------------------------------------------------------------------------------

def _check(check_id, ok, fail_message, ok_message, target):
    return {'id': check_id, 'ok': ok, 'fail_message': fail_message, 'ok_message': ok_message, 'target': target}


def send_checks(contract, method):
    """
    The ordered list of checks a draft must pass before it can be sent as `method` ('email' or 'link'). Each is
    {id, ok, fail_message, ok_message, target}; `target` names the field (or `section:<id>`) a person should go to.
    This is the ONE implementation of the send rules: send_problem() is the first failing check's sentence, and the
    send-check endpoint serves the list as it is, so the checklist and the real send can never disagree.
    The fee is compared as a Decimal, never a float.
    """
    sections = contract.sections or []

    def first_section(predicate):
        for section in sections:
            if predicate(section):
                return section
        return None

    empty = first_section(lambda s: not (s.get('title') or '').strip() or not (s.get('text') or '').strip())
    blank = first_section(
        lambda s: bool(PLACEHOLDER_RE.search(s.get('title') or '')) or bool(PLACEHOLDER_RE.search(s.get('text') or '')))
    fee_missing = Decimal(contract.fee_amount) == Decimal('0') and not (contract.payment_terms or '').strip()
    if contract.valid_until is None:
        sign_by_fail, sign_by_ok = words.SEND_NO_SIGN_BY, False
    elif contract.valid_until < _today():
        sign_by_fail, sign_by_ok = words.SEND_SIGN_BY_PASSED, False
    else:
        sign_by_fail, sign_by_ok = words.SEND_NO_SIGN_BY, True

    if not sections:
        sections_target = 'sections'
    elif empty is not None:
        sections_target = f"section:{empty.get('id')}"
    else:
        sections_target = 'sections'

    checks = [
        _check('title', bool((contract.title or '').strip()), words.SEND_NO_TITLE, words.CHECK_OK_TITLE, 'title'),
        _check('client_name', bool((contract.client_name or '').strip()), words.SEND_NO_CLIENT_NAME,
               words.CHECK_OK_CLIENT_NAME, 'client_name'),
        _check('sections', bool(sections) and empty is None, words.SEND_EMPTY_SECTION, words.CHECK_OK_SECTIONS,
               sections_target),
        _check('placeholders', blank is None,
               words.SEND_PLACEHOLDER.format(title=(blank.get('title') or '') if blank else ''),
               words.CHECK_OK_PLACEHOLDERS, f"section:{blank.get('id')}" if blank else 'sections'),
        _check('fee', not fee_missing, words.SEND_NO_FEE, words.CHECK_OK_FEE, 'fee_amount'),
        _check('sign_by', sign_by_ok, sign_by_fail, words.CHECK_OK_SIGN_BY, 'valid_until'),
    ]
    if method == 'email':
        try:
            validate_email((contract.client_email or '').strip())
            email_ok = True
        except DjangoValidationError:
            email_ok = False
        checks.append(_check('client_email', email_ok, words.SEND_NO_CLIENT_EMAIL, words.CHECK_OK_CLIENT_EMAIL,
                             'client_email'))
    return checks


def send_warnings(contract):
    """Advisory sentences that never block a send: [{id, message}]."""
    warnings = []
    if Decimal(contract.fee_amount) == Decimal('0') and (contract.payment_terms or '').strip():
        warnings.append({'id': 'fee_zero', 'message': words.WARN_FEE_ZERO})
    return warnings


def send_problem(contract, method):
    """The FIRST reason (in send_checks' order) a draft cannot be sent as `method`, as a sentence a person can act on, or None."""
    for check in send_checks(contract, method):
        if not check['ok']:
            return check['fail_message']
    return None


def assign_number_and_mark_sent(contract, user, method, owner_signature, parties, content_hash):
    """
    Numbers the contract and moves it draft -> sent in ONE UPDATE, under the User-row lock the per-user counter
    needs (Contract.generate_contract_number's docstring; the same fix apps.proposals documents at length). Called
    only AFTER the email succeeded, so that lock is held for a few milliseconds instead of the whole email call.
    Each attempt runs in its own savepoint; the retry on IntegrityError is defence in depth - the lock is the real
    mechanism. The contract row is already locked by the caller, so the lock order is always contract row -> user row.

    `owner_signature`: {'name', 'ip', 'user_agent'} - the freelancer's typed signature (decision K3), stored in the
    same UPDATE as the status change.
    """
    for attempt in range(1, NUMBER_MAX_ATTEMPTS + 1):
        try:
            with transaction.atomic():
                User.objects.select_for_update().get(pk=user.pk)
                now = timezone.now()
                contract.contract_number = Contract.generate_contract_number(user)
                contract.status = 'sent'
                contract.sent_via = method
                contract.sent_at = now
                contract.parties = parties
                contract.content_hash = content_hash
                contract.owner_signed_name = owner_signature['name']
                contract.owner_signed_at = now
                contract.owner_signed_ip = owner_signature['ip']
                contract.owner_signed_user_agent = owner_signature['user_agent']
                contract.save(update_fields=[
                    'contract_number', 'status', 'sent_via', 'sent_at', 'parties', 'content_hash',
                    'owner_signed_name', 'owner_signed_at', 'owner_signed_ip', 'owner_signed_user_agent', 'updated_at',
                ])
            return
        except IntegrityError:
            if attempt == NUMBER_MAX_ATTEMPTS:
                logger.error(
                    '[CONTRACTS] Could not assign a unique contract number for user %s after %s attempts.',
                    user.pk, NUMBER_MAX_ATTEMPTS,
                )
                raise
            logger.warning(
                '[CONTRACTS] contract_number collision on %s for user %s - retrying (attempt %s/%s).',
                contract.contract_number, user.pk, attempt, NUMBER_MAX_ATTEMPTS,
            )
