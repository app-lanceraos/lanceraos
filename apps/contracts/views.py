# apps/contracts/views.py
"""
Contracts, owner side (Prompt 22, Part 4): templates, list/create, detail/update/delete, send, withdraw, duplicate.
The public client page is views_public.py; the two PDF downloads live in apps.invoices (WeasyPrint is there) and are
registered in config/urls.py. Function views only (@api_view), everything scoped to the authenticated user; another
user's contract is a 404, never a 403.

Every response carries `Cache-Control: no-store` (errors and DRF's own 401/405 included): `@no_store` is applied
OUTSIDE `@api_view`.

LOCK ORDER (state-changing endpoints): contract row first, then - only in contract_send, for the last few
milliseconds - the User row. Nothing takes them the other way round, so the two cannot deadlock.

Error bodies always carry a flat top-level `error` string; validation failures keep DRF's field-keyed detail
alongside it.
"""
import logging

from django.db import transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from core.email import send_client_facing_email, sender_display_name
from core.events import emit
from core.observability import get_user_agent
from core.public_http import no_store, safe_ip
from core.ratelimit import rate_limited

from . import copy as words
from .clauses import CLAUSE_LIBRARY_VERSION, template_summaries
from .constants import MUTATIONS_PER_HOUR, SENDS_PER_HOUR, TITLE_MAX
from .emails import build_client_contract_email
from .integrity import compute_hash, parties_snapshot
from .models import Contract
from .serializers import (
    ConfirmSerializer, ContractCreateSerializer, ContractDetailSerializer, ContractListSerializer,
    ContractUpdateSerializer, SendRequestSerializer,
)
from .services import assign_number_and_mark_sent, create_from_template, normalise_line, send_problem

logger = logging.getLogger(__name__)

COPY_SUFFIX = ' (copy)'


def _mutation_rate_limited(action, user, limit=MUTATIONS_PER_HOUR):
    """`limit` mutations/hour per user per action; see core.ratelimit.rate_limited."""
    return rate_limited(f'ratelimit_contracts_{action}_{user.pk}', limit)


def _error(message, http_status, **extra):
    return Response({'error': message, **extra}, status=http_status)


def _too_many(message):
    return _error(message, status.HTTP_429_TOO_MANY_REQUESTS)


def _validation_error(errors):
    """DRF's field-keyed errors, plus a flat `error` string with the first message."""
    def first_message(value):
        if isinstance(value, dict):
            return first_message(next(iter(value.values()), ''))
        if isinstance(value, (list, tuple)):
            return first_message(value[0]) if value else ''
        return str(value)

    body = dict(errors)
    body['error'] = first_message(errors) or 'Invalid input.'
    return Response(body, status=status.HTTP_400_BAD_REQUEST)


def _detail(contract):
    return ContractDetailSerializer(Contract.objects.select_related('proposal', 'invoice').get(pk=contract.pk)).data


def _not_draft_change_message(contract):
    return words.NOT_DRAFT_CHANGE.format(word=contract.status)


def _not_draft_send_message(contract):
    if contract.status in ('sent', 'viewed'):
        return words.ALREADY_SENT
    return words.ALREADY_STATE.format(word=contract.status)


# -- Templates -----------------------------------------------------------------------------------------------------

@no_store
@api_view(['GET'])
@permission_classes([IsAuthenticated])
def contract_templates(request):
    """The five templates (key, label, description, section titles) and the clause library version. Static data."""
    return Response({'templates': template_summaries(), 'version': CLAUSE_LIBRARY_VERSION})


# -- List / create -------------------------------------------------------------------------------------------------

@no_store
@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def contract_list(request):
    """
    GET: the user's contracts, paginated exactly like proposal_list (?limit=1-200 default 50, ?offset=;
    {results, total, limit, offset}), filterable by ?status= and ?search= (title, client name, company).
    POST: create a draft from one of the five templates.
    """
    if request.method == 'POST':
        return contract_create(request)

    qs = Contract.objects.filter(user=request.user)
    status_param = request.query_params.get('status')
    if status_param:
        qs = qs.filter(status=status_param)
    search = request.query_params.get('search', '').strip()
    if search:
        qs = qs.filter(Q(title__icontains=search) | Q(client_name__icontains=search) | Q(client_company__icontains=search))
    qs = qs.order_by('-created_at')

    try:
        limit = min(max(int(request.query_params.get('limit', 50)), 1), 200)
    except ValueError:
        limit = 50
    try:
        offset = max(int(request.query_params.get('offset', 0)), 0)
    except ValueError:
        offset = 0

    total = qs.count()
    return Response({
        'results': ContractListSerializer(qs[offset:offset + limit], many=True).data,
        'total': total, 'limit': limit, 'offset': offset,
    })


def contract_create(request):
    """
    Creates a draft. Body: {template_key, client?, client_name?, client_email?, client_company?, proposal?, invoice?,
    title?}. A proposal must be accepted (409 otherwise). The response is the detail plus `notices`.
    """
    if _mutation_rate_limited('create', request.user):
        return _too_many(words.TOO_MANY_ACTIONS)
    serializer = ContractCreateSerializer(data=request.data, context={'request': request})
    if not serializer.is_valid():
        return _validation_error(serializer.errors)
    data = serializer.validated_data
    proposal = data.get('proposal')
    if proposal is not None and proposal.status != 'accepted':
        return _error(words.PROPOSAL_NOT_ACCEPTED, status.HTTP_409_CONFLICT, reason='proposal_not_accepted')

    client_fields = {}
    for key in ('client_name', 'client_email', 'client_company'):
        if key in data:
            client_fields[key] = normalise_line(data[key]) if key != 'client_email' else data[key].strip()
    contract, notices = create_from_template(
        request.user, template_key=data['template_key'], client=data.get('client'), client_fields=client_fields,
        proposal=proposal, invoice=data.get('invoice'), title=data.get('title', ''),
    )
    emit('ContractCreated', contract_id=str(contract.pk), user_id=str(request.user.pk),
         template_key=contract.template_key)
    logger.info('[CONTRACTS] Created draft contract %s (%s) for user %s.', contract.pk, contract.template_key, request.user.pk)
    return Response({**_detail(contract), 'notices': notices}, status=status.HTTP_201_CREATED)


# -- Detail / update / delete --------------------------------------------------------------------------------------

@no_store
@api_view(['GET', 'PATCH', 'DELETE'])
@permission_classes([IsAuthenticated])
def contract_detail(request, pk):
    """
    GET: full detail, including `signature_record` once the contract is signed or declined.
    PATCH: draft only (403 otherwise), partial update; returns the fresh detail.
    DELETE: draft only (403 otherwise) - a sent or answered contract is a record.
    PATCH and DELETE re-check the status under select_for_update() inside one transaction, so a send racing an edit
    has exactly one winner.
    """
    if request.method == 'GET':
        return Response(_detail(get_object_or_404(Contract, pk=pk, user=request.user)))

    deleted_id = None
    with transaction.atomic():
        contract = get_object_or_404(Contract.objects.select_for_update(), pk=pk, user=request.user)
        if not contract.is_editable:
            return _error(_not_draft_change_message(contract), status.HTTP_403_FORBIDDEN)

        if request.method == 'DELETE':
            if _mutation_rate_limited('delete', request.user):
                return _too_many(words.TOO_MANY_ACTIONS)
            deleted_id = str(contract.pk)
            contract.delete()
        else:
            if _mutation_rate_limited('update', request.user):
                return _too_many(words.TOO_MANY_ACTIONS)
            serializer = ContractUpdateSerializer(contract, data=request.data, partial=True, context={'request': request})
            if not serializer.is_valid():
                return _validation_error(serializer.errors)
            serializer.save()

    if deleted_id is not None:
        emit('ContractDeleted', contract_id=deleted_id, user_id=str(request.user.pk))
        logger.info('[CONTRACTS] Deleted draft contract %s.', deleted_id)
        return Response(status=status.HTTP_204_NO_CONTENT)
    logger.info('[CONTRACTS] Updated contract %s.', contract.pk)
    return Response(_detail(contract))


# -- Send ----------------------------------------------------------------------------------------------------------

@no_store
@api_view(['POST'])
@permission_classes([IsAuthenticated])
def contract_send(request, pk):
    """
    draft -> sent, by email ("method": "email") or as a link only ("link"). Body: {"method", "confirm": true,
    "signer_name"}. 10 sends/hour per user. The freelancer signs here by typing their full name (decision K3).

    The row lock is HELD WHILE THE EMAIL IS SENT (the Proposals D1 decision): sending first and locking later would
    let a double click email the client twice. Status changes ONLY if the email succeeded: on any failure the
    contract stays `draft`, consumes no number, and the response says so. The parties and the fingerprint are
    computed BEFORE the email from the row the client will be asked to sign; the number is assigned after the email,
    in the same transaction, and is not part of the fingerprint or the email.

    Known limit: if the database write after a successful email fails, the client has the email while the contract is
    still a draft, and a retry emails them again. The window is one UPDATE under a lock; an outbox would be out of
    proportion (the same trade-off as Proposals).
    """
    serializer = SendRequestSerializer(data=request.data)
    if not serializer.is_valid():
        return _validation_error(serializer.errors)
    if not serializer.validated_data['confirm']:
        return _error(words.CONFIRM_SEND, status.HTTP_400_BAD_REQUEST)
    method = serializer.validated_data['method']
    signer_name = serializer.validated_data['signer_name']
    if _mutation_rate_limited('send', request.user, SENDS_PER_HOUR):
        return _too_many(words.TOO_MANY_SENDS)

    user = request.user
    sent_via = 'link'
    fallback_used = False
    with transaction.atomic():
        contract = get_object_or_404(Contract.objects.select_for_update(of=('self',)), pk=pk, user=user)
        if contract.status != 'draft':
            return _error(_not_draft_send_message(contract), status.HTTP_409_CONFLICT, reason='not_draft')
        problem = send_problem(contract, method)
        if problem:
            return _error(problem, status.HTTP_400_BAD_REQUEST)

        contract.user = user  # the snapshot reads the profile; no second query for the same row
        parties = parties_snapshot(contract)
        content_hash = compute_hash(contract, parties)

        if method == 'email':
            subject, html_body, text_body = build_client_contract_email(
                contract, sender_display_name(user, getattr(user, 'profile', None)))
            result = send_client_facing_email(
                user, contract.client_email.strip(), subject, html_body, text_body,
                reply_to=user.email, recipient_name=contract.client_name,
                context_type='contract', context_id=str(contract.pk),
                request_id=getattr(request, 'request_id', None),
            )
            if not result['sent']:
                detail = str(result.get('error') or 'unknown error')[:200]
                return _error(words.EMAIL_FAILED.format(detail=detail), status.HTTP_502_BAD_GATEWAY)
            sent_via = result['sent_via']
            fallback_used = bool(result['fallback_used'])

        assign_number_and_mark_sent(
            contract, user, method,
            {'name': signer_name, 'ip': safe_ip(request), 'user_agent': get_user_agent(request)},
            parties, content_hash,
        )

    emit('ContractSent', contract_id=str(contract.pk), user_id=str(user.pk), method=method, sent_via=sent_via,
         fallback_used=fallback_used, contract_number=contract.contract_number, content_hash=content_hash,
         ip=contract.owner_signed_ip, user_agent=contract.owner_signed_user_agent)
    logger.info('[CONTRACTS] Sent contract %s (%s) for user %s via %s.',
                contract.pk, contract.contract_number, user.pk, sent_via)
    return Response(_detail(contract))


# -- Withdraw / duplicate ------------------------------------------------------------------------------------------

@no_store
@api_view(['POST'])
@permission_classes([IsAuthenticated])
def contract_withdraw(request, pk):
    """
    sent/viewed -> withdrawn (even if it has expired). Body: {"confirm": true}. Row lock + status re-check in one
    transaction, so a withdraw racing the client's signature has exactly one winner. The client is NOT emailed; the
    public page shows the new state. A signed contract is final and cannot be withdrawn.
    """
    serializer = ConfirmSerializer(data=request.data)
    if not serializer.is_valid():
        return _validation_error(serializer.errors)
    if not serializer.validated_data['confirm']:
        return _error(words.CONFIRM_WITHDRAW, status.HTTP_400_BAD_REQUEST)
    if _mutation_rate_limited('withdraw', request.user):
        return _too_many(words.TOO_MANY_ACTIONS)

    with transaction.atomic():
        contract = get_object_or_404(Contract.objects.select_for_update(of=('self',)), pk=pk, user=request.user)
        if contract.status == 'draft':
            return _error(words.DRAFTS_ARE_DELETED, status.HTTP_409_CONFLICT, reason='not_sent')
        if contract.status not in ('sent', 'viewed'):
            return _error(words.NOT_WITHDRAWABLE.format(status=contract.status), status.HTTP_409_CONFLICT,
                          reason='not_withdrawable')
        contract.status = 'withdrawn'
        contract.withdrawn_at = timezone.now()
        contract.save(update_fields=['status', 'withdrawn_at', 'updated_at'])

    emit('ContractWithdrawn', contract_id=str(contract.pk), user_id=str(request.user.pk),
         contract_number=contract.contract_number)
    logger.info('[CONTRACTS] Withdrew contract %s.', contract.pk)
    return Response(_detail(contract))


@no_store
@api_view(['POST'])
@permission_classes([IsAuthenticated])
def contract_duplicate(request, pk):
    """
    A new DRAFT copy of a contract in any status, so a withdrawn or declined one is not a dead end. Copies the
    template, sections, key terms, client and links; does NOT copy valid_until (an old sign-by date is a trap - the
    freelancer must pick a new one), the status, view_token (a fresh one is generated), the number, the fingerprint,
    the frozen parties, any signature or any timestamp. The source row is locked so a concurrent edit cannot give a
    half-old, half-new copy.
    """
    if _mutation_rate_limited('duplicate', request.user):
        return _too_many(words.TOO_MANY_ACTIONS)

    with transaction.atomic():
        original = get_object_or_404(Contract.objects.select_for_update(of=('self',)), pk=pk, user=request.user)
        title = original.title[:TITLE_MAX - len(COPY_SUFFIX)] + COPY_SUFFIX
        copy = Contract.objects.create(
            user=request.user, client_id=original.client_id, client_name=original.client_name,
            client_email=original.client_email, client_company=original.client_company,
            proposal_id=original.proposal_id, invoice_id=original.invoice_id, title=title,
            template_key=original.template_key,
            template_version=original.template_version, sections=[dict(s) for s in original.sections],
            currency=original.currency, fee_amount=original.fee_amount, payment_terms=original.payment_terms,
            start_date=original.start_date, end_date=original.end_date,
        )

    emit('ContractCreated', contract_id=str(copy.pk), user_id=str(request.user.pk),
         template_key=copy.template_key, duplicated_from=str(original.pk))
    logger.info('[CONTRACTS] Duplicated contract %s into draft %s.', original.pk, copy.pk)
    return Response(_detail(copy), status=status.HTTP_201_CREATED)
