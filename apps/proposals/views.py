# apps/proposals/views.py
"""
Proposals, part 1: list/create, detail/update/delete and the two AI-generate
endpoints. Function views only (@api_view), everything scoped to the
authenticated user; another user's proposal is a 404, never a 403.

Error bodies always carry a flat top-level `error` string (a frontend once
could not read DRF's field-keyed errors — CLAUDE.md, Client Portal notes), and
validation failures keep DRF's field-keyed detail alongside it.
"""
import logging

from django.core.cache import cache
from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from core.events import emit

from .models import Proposal
from .serializers import (
    GenerateRequestSerializer, ProposalDetailSerializer, ProposalListSerializer, ProposalSerializer,
    JOB_DESCRIPTION_MIN_FOR_AI,
)
from .services import ProposalNotEditable, apply_regeneration, run_generation, save_new_proposal

logger = logging.getLogger(__name__)

MUTATIONS_PER_HOUR = 30

# AiResult.failure_reason -> HTTP status. Anything not listed is a 503.
_AI_FAILURE_STATUS = {
    'user_rate_limited': status.HTTP_429_TOO_MANY_REQUESTS,
    'not_allowed': status.HTTP_403_FORBIDDEN,
    'request_too_large': status.HTTP_400_BAD_REQUEST,
}


def _mutation_rate_limited(action, user):
    """
    30 mutations/hour per user per action. Atomic like core.ai's limiter
    (cache.add + cache.incr), not the get-then-set of the invoices helper: two
    concurrent requests cannot both read the same count. Fails open if the
    cache itself errors (logged) — it protects against abuse, it must not turn
    a cache outage into a Proposals outage.
    """
    key = f'ratelimit_proposals_{action}_{user.pk}'
    try:
        cache.add(key, 0, timeout=3600)
        try:
            count = cache.incr(key)
        except ValueError:
            cache.add(key, 1, timeout=3600)
            count = 1
    except Exception:
        logger.exception('[PROPOSALS] Rate-limit cache failed for action=%s; allowing the request.', action)
        return False
    return count > MUTATIONS_PER_HOUR


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


def _detail(proposal):
    return ProposalDetailSerializer(Proposal.objects.prefetch_related('items').get(pk=proposal.pk)).data


NOT_DRAFT_MESSAGE = 'This proposal can no longer be changed — only draft proposals can be edited, regenerated or deleted.'


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def proposal_list(request):
    """
    GET: the user's proposals, paginated exactly like invoice_list
    (?limit=1-200 default 50, ?offset=; {results, total, limit, offset}),
    filterable by ?status= and ?search= (title, client name, company).
    POST: manual create — any subset of fields, `title` required.
    """
    if request.method == 'POST':
        return proposal_create(request)

    qs = Proposal.objects.filter(user=request.user)
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
        'results': ProposalListSerializer(qs[offset:offset + limit], many=True).data,
        'total': total, 'limit': limit, 'offset': offset,
    })


def proposal_create(request):
    """Creates a draft by hand. Works with AI off — manual CRUD never depends on Groq."""
    if _mutation_rate_limited('create', request.user):
        return _too_many('Too many proposals created recently. Please try again later.')
    serializer = ProposalSerializer(data=request.data, context={'request': request})
    if not serializer.is_valid():
        return _validation_error(serializer.errors)
    proposal = serializer.save(user=request.user)
    emit('ProposalCreated', proposal_id=str(proposal.pk), user_id=str(request.user.pk))
    logger.info('[PROPOSALS] Created draft proposal %s for user %s.', proposal.pk, request.user.pk)
    return Response(_detail(proposal), status=status.HTTP_201_CREATED)


@api_view(['GET', 'PUT', 'DELETE'])
@permission_classes([IsAuthenticated])
def proposal_detail(request, pk):
    """
    GET: full detail incl. items, word_count and the code-computed `quality`.
    PUT: draft only (403 otherwise), partial update; returns the fresh detail.
    DELETE: draft only (403 otherwise) — a sent or answered proposal is a record.
    """
    proposal = get_object_or_404(Proposal, pk=pk, user=request.user)

    if request.method == 'GET':
        return Response(_detail(proposal))

    if not proposal.is_editable:
        return _error(NOT_DRAFT_MESSAGE, status.HTTP_403_FORBIDDEN)

    if request.method == 'DELETE':
        if _mutation_rate_limited('delete', request.user):
            return _too_many('Too many delete actions. Please try again later.')
        proposal_id = str(proposal.pk)
        proposal.delete()
        emit('ProposalDeleted', proposal_id=proposal_id, user_id=str(request.user.pk))
        logger.info('[PROPOSALS] Deleted draft proposal %s.', proposal_id)
        return Response(status=status.HTTP_204_NO_CONTENT)

    if _mutation_rate_limited('update', request.user):
        return _too_many('Too many updates. Please try again later.')
    serializer = ProposalSerializer(proposal, data=request.data, partial=True, context={'request': request})
    if not serializer.is_valid():
        return _validation_error(serializer.errors)
    serializer.save()
    logger.info('[PROPOSALS] Updated proposal %s.', proposal.pk)
    return Response(_detail(proposal))


def _ai_failure_response(result):
    """Nothing from the upstream body ever reaches the client: only our own user_message and reason id."""
    return _error(
        result.user_message,
        _AI_FAILURE_STATUS.get(result.failure_reason, status.HTTP_503_SERVICE_UNAVAILABLE),
        reason=result.failure_reason,
    )


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def proposal_generate_ai_create(request):
    """
    Generates a NEW draft from a pasted job post (the spec lists only the {id}
    form; this one exists because there is no id before the first generation
    and a failed generation must not leave an empty draft behind). Synchronous:
    the model is called first, outside any transaction; the proposal is saved
    in one atomic block, and only then returned (201). On any AI failure
    nothing is created.
    """
    serializer = GenerateRequestSerializer(data=request.data, context={'request': request}, include_client=True)
    if not serializer.is_valid():
        return _validation_error(serializer.errors)
    data = serializer.validated_data
    if 'job_description' not in data:
        return _validation_error({'job_description': ['This field is required.']})

    tone = data.get('tone', 'professional')
    my_experience = data.get('my_experience', '')
    result = run_generation(
        request.user, job_description=data['job_description'], tone=tone, my_experience=my_experience,
        request_id=getattr(request, 'request_id', None),
    )
    if not result.ok:
        return _ai_failure_response(result)

    proposal = save_new_proposal(
        request.user, result.data, job_description=data['job_description'], tone=tone,
        my_experience=my_experience, title=data.get('title', ''), client=data.get('client'),
    )
    return Response(_detail(proposal), status=status.HTTP_201_CREATED)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def proposal_generate_ai(request, pk):
    """
    Regenerates the text of an existing draft (200). Draft only (403
    otherwise). A draft whose body is already non-empty needs
    "confirm_overwrite": true (409 otherwise) because a regeneration replaces
    text the user may have edited. job_description / tone / my_experience fall
    back to the stored values when omitted.
    """
    proposal = get_object_or_404(Proposal, pk=pk, user=request.user)
    if not proposal.is_editable:
        return _error(NOT_DRAFT_MESSAGE, status.HTTP_403_FORBIDDEN)

    serializer = GenerateRequestSerializer(data=request.data, context={'request': request})
    if not serializer.is_valid():
        return _validation_error(serializer.errors)
    data = serializer.validated_data

    job_description = data.get('job_description', proposal.job_description)
    if len(job_description.strip()) < JOB_DESCRIPTION_MIN_FOR_AI:
        return _validation_error({'job_description': [
            f'Paste the job post (at least {JOB_DESCRIPTION_MIN_FOR_AI} characters) to generate a proposal.']})
    if proposal.body.strip() and not data['confirm_overwrite']:
        return _error(
            'This proposal already has text. Regenerating replaces it — send "confirm_overwrite": true to continue.',
            status.HTTP_409_CONFLICT, reason='confirm_overwrite_required',
        )

    tone = data.get('tone', proposal.tone)
    my_experience = data.get('my_experience', proposal.my_experience)
    result = run_generation(
        request.user, job_description=job_description, tone=tone, my_experience=my_experience,
        request_id=getattr(request, 'request_id', None),
    )
    if not result.ok:
        return _ai_failure_response(result)

    try:
        proposal = apply_regeneration(
            request.user, proposal.pk, result.data, job_description=job_description, tone=tone,
            my_experience=my_experience, title=data.get('title', ''),
        )
    except ProposalNotEditable:
        return _error(NOT_DRAFT_MESSAGE, status.HTTP_403_FORBIDDEN)
    return Response(_detail(proposal))
