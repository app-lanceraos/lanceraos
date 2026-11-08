# apps/proposals/views.py
"""
Proposals: list/create, detail/update/delete, the two AI-generate endpoints
(part 1) and send / withdraw / duplicate / convert-to-invoice (part 2). The
public client page is views_public.py. Function views only (@api_view),
everything scoped to the authenticated user; another user's proposal is a 404,
never a 403.

LOCK ORDER (state-changing endpoints): proposal row first, then — only in
proposal_send, for the last few milliseconds — the User row. Nothing takes them
the other way round, so the two cannot deadlock.

Error bodies always carry a flat top-level `error` string (a frontend once
could not read DRF's field-keyed errors — CLAUDE.md, Client Portal notes), and
validation failures keep DRF's field-keyed detail alongside it.
"""
import logging
from datetime import timedelta

from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.validators import validate_email
from django.db import IntegrityError, transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.clients.models import Client
from apps.invoices.models import Invoice, InvoiceItem
from apps.users.models import User
from core.email import send_client_facing_email, sender_display_name
from core.events import emit

from .emails import build_client_proposal_email
from .models import Proposal, ProposalItem, _today
from core.ratelimit import rate_limited
from .serializers import (
    ConfirmSerializer, ConvertRequestSerializer, GenerateRequestSerializer, ProposalDetailSerializer,
    ProposalListSerializer, ProposalSerializer, SendRequestSerializer, JOB_DESCRIPTION_MIN_FOR_AI, TITLE_MAX,
)
from .services import ProposalNotEditable, apply_regeneration, run_generation, save_new_proposal

logger = logging.getLogger(__name__)

MUTATIONS_PER_HOUR = 30
# The draft editor autosaves, so PUT needs headroom: 600/hour is one save every six seconds sustained,
# which no human typing reaches, and it still bounds abuse. Only PUT uses it; delete, create, duplicate,
# withdraw and convert stay at MUTATIONS_PER_HOUR.
UPDATES_PER_HOUR = 600
# A send emails a third party, so it gets a tighter limit than the other mutations.
SENDS_PER_HOUR = 10
_NUMBER_MAX_ATTEMPTS = 5
COPY_SUFFIX = ' (copy)'

# AiResult.failure_reason -> HTTP status. Anything not listed is a 503.
_AI_FAILURE_STATUS = {
    'user_rate_limited': status.HTTP_429_TOO_MANY_REQUESTS,
    'not_allowed': status.HTTP_403_FORBIDDEN,
    'request_too_large': status.HTTP_400_BAD_REQUEST,
}


def _mutation_rate_limited(action, user, limit=MUTATIONS_PER_HOUR):
    """`limit` mutations/hour per user per action (MUTATIONS_PER_HOUR unless a caller passes its own); see ratelimit.rate_limited."""
    return rate_limited(f'ratelimit_proposals_{action}_{user.pk}', limit)


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
    Autosave-friendly: 600/hour per user (UPDATES_PER_HOUR), not the 30/hour
    every other mutation gets.
    DELETE: draft only (403 otherwise) — a sent or answered proposal is a record.
    PUT and DELETE re-check the status under select_for_update() inside one
    transaction (see below).
    """
    if request.method == 'GET':
        return Response(_detail(get_object_or_404(Proposal, pk=pk, user=request.user)))

    # PUT / DELETE: the row is locked for the whole check-then-write. Reading it,
    # checking `draft`, and writing later with no lock would let part 2's send
    # flip the status a millisecond before an edit lands on a now-sent proposal.
    # select_for_update() is scoped to request.user, so another user's id is
    # still a 404; the lock waits for a concurrent writer, then re-reads fresh.
    deleted_id = None
    with transaction.atomic():
        proposal = get_object_or_404(Proposal.objects.select_for_update(), pk=pk, user=request.user)
        if not proposal.is_editable:
            return _error(NOT_DRAFT_MESSAGE, status.HTTP_403_FORBIDDEN)

        if request.method == 'DELETE':
            if _mutation_rate_limited('delete', request.user):
                return _too_many('Too many delete actions. Please try again later.')
            deleted_id = str(proposal.pk)
            proposal.delete()
        else:
            if _mutation_rate_limited('update', request.user, UPDATES_PER_HOUR):
                return _too_many('Too many updates. Please try again later.')
            serializer = ProposalSerializer(proposal, data=request.data, partial=True, context={'request': request})
            if not serializer.is_valid():
                return _validation_error(serializer.errors)
            serializer.save()

    if deleted_id is not None:
        emit('ProposalDeleted', proposal_id=deleted_id, user_id=str(request.user.pk))
        logger.info('[PROPOSALS] Deleted draft proposal %s.', deleted_id)
        return Response(status=status.HTTP_204_NO_CONTENT)
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
        request.user, result.data, model=result.model, job_description=data['job_description'], tone=tone,
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
            request.user, proposal.pk, result.data, model=result.model, job_description=job_description, tone=tone,
            my_experience=my_experience, title=data.get('title', ''),
        )
    except ProposalNotEditable:
        return _error(NOT_DRAFT_MESSAGE, status.HTTP_403_FORBIDDEN)
    return Response(_detail(proposal))


# ══════════════════════════════════════════════════════════════════
# PART 2 — send / withdraw / duplicate / convert to invoice
# ══════════════════════════════════════════════════════════════════

_STATE_WORDS = {
    'sent': 'sent', 'viewed': 'sent', 'accepted': 'accepted', 'declined': 'declined', 'withdrawn': 'withdrawn',
}


def _not_draft_message(proposal):
    word = _STATE_WORDS.get(proposal.status, proposal.status)
    if word == 'sent':
        return 'This proposal has already been sent.'
    return f'This proposal has already been {word}.'


def _send_content_problem(proposal, method):
    """The first reason this draft cannot be sent as `method`, as a user-facing sentence, or None."""
    if not proposal.body.strip():
        return 'Write or generate the proposal text before sending.'
    if proposal.valid_until is None:
        return 'Set a valid-until date before sending.'
    if proposal.valid_until < _today():
        return 'The valid-until date has passed - choose a future date.'
    if method == 'email':
        email = (proposal.client_email or '').strip()
        try:
            validate_email(email)
        except DjangoValidationError:
            return "Add the client's email address to send by email, or choose Copy link."
    return None


def _assign_number_and_mark_sent(proposal, user, method):
    """
    Numbers the proposal and moves it draft -> sent in one UPDATE, under the
    User-row lock the per-user counter needs (Proposal.generate_proposal_number's
    docstring; the same fix _finalise_invoice documents at length). Called only
    AFTER the email succeeded (decision D2), so that lock is held for a few
    milliseconds instead of the whole email call. Each attempt runs in its own
    savepoint; the retry on IntegrityError is defence in depth — the lock is the
    real mechanism. The proposal row is already locked by the caller, so the lock
    order is always proposal row -> user row.
    """
    for attempt in range(1, _NUMBER_MAX_ATTEMPTS + 1):
        try:
            with transaction.atomic():
                User.objects.select_for_update().get(pk=user.pk)
                proposal.proposal_number = Proposal.generate_proposal_number(user)
                proposal.status = 'sent'
                proposal.sent_via = method
                proposal.sent_at = timezone.now()
                proposal.save(update_fields=['proposal_number', 'status', 'sent_via', 'sent_at', 'updated_at'])
            return
        except IntegrityError:
            if attempt == _NUMBER_MAX_ATTEMPTS:
                logger.error(
                    '[PROPOSALS] Could not assign a unique proposal number for user %s after %s attempts.',
                    user.pk, _NUMBER_MAX_ATTEMPTS,
                )
                raise
            logger.warning(
                '[PROPOSALS] proposal_number collision on %s for user %s — retrying (attempt %s/%s).',
                proposal.proposal_number, user.pk, attempt, _NUMBER_MAX_ATTEMPTS,
            )


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def proposal_send(request, pk):
    """
    draft -> sent, by email ("method": "email") or as a link only ("link").
    Body: {"method": "email"|"link", "confirm": true}. 10 sends/hour per user.

    The row lock is HELD WHILE THE EMAIL IS SENT (decision D1): sending first
    and locking later would let a double click email the client twice. The cost
    — one database connection held for the length of the email call, about 25 s
    in the worst case (custom SMTP 15 s timeout, then the Resend fallback 10 s)
    — only blocks that one proposal's own edits. Status changes ONLY if the
    email succeeded: on any failure the proposal stays `draft`, consumes no
    proposal number, and the response says so. The number is assigned after the
    email, in the same transaction (D2), and is not in the email.

    Known limit: if the database write after a successful email fails, the
    client has the email while the proposal is still a draft, and a retry
    emails them again. The window is one UPDATE under a lock; an outbox would be
    out of proportion (DECISIONS.md, 02 November 2026).
    """
    serializer = SendRequestSerializer(data=request.data)
    if not serializer.is_valid():
        return _validation_error(serializer.errors)
    if not serializer.validated_data['confirm']:
        return _error('Confirm that you want to send this proposal.', status.HTTP_400_BAD_REQUEST)
    method = serializer.validated_data['method']
    if _mutation_rate_limited('send', request.user, SENDS_PER_HOUR):
        return _too_many('You have sent a lot of proposals recently. Please try again later.')

    user = request.user
    sent_via = 'link'
    fallback_used = False
    with transaction.atomic():
        proposal = get_object_or_404(Proposal.objects.select_for_update(), pk=pk, user=user)
        if proposal.status != 'draft':
            return _error(_not_draft_message(proposal), status.HTTP_409_CONFLICT, reason='not_draft')
        problem = _send_content_problem(proposal, method)
        if problem:
            return _error(problem, status.HTTP_400_BAD_REQUEST)

        if method == 'email':
            subject, html_body, text_body = build_client_proposal_email(
                proposal, sender_display_name(user, getattr(user, 'profile', None)))
            result = send_client_facing_email(
                user, proposal.client_email.strip(), subject, html_body, text_body,
                reply_to=user.email, recipient_name=proposal.client_name,
                context_type='proposal', context_id=str(proposal.pk),
                request_id=getattr(request, 'request_id', None),
            )
            if not result['sent']:
                detail = str(result.get('error') or 'unknown error')[:200]
                return _error(
                    f'Could not send this proposal by email: {detail}. It is still a draft.',
                    status.HTTP_502_BAD_GATEWAY,
                )
            sent_via = result['sent_via']
            fallback_used = bool(result['fallback_used'])

        _assign_number_and_mark_sent(proposal, user, method)

    emit('ProposalSent', proposal_id=str(proposal.pk), user_id=str(user.pk), method=method,
         sent_via=sent_via, fallback_used=fallback_used, proposal_number=proposal.proposal_number)
    logger.info('[PROPOSALS] Sent proposal %s (%s) for user %s via %s.',
                proposal.pk, proposal.proposal_number, user.pk, sent_via)
    return Response(_detail(proposal))


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def proposal_withdraw(request, pk):
    """
    sent/viewed -> withdrawn (even if it has expired). Body: {"confirm": true}.
    Row lock + status re-check in one transaction, so a withdraw racing the
    client's answer has exactly one winner. The client is NOT emailed (D5); the
    public page shows the new state.
    """
    serializer = ConfirmSerializer(data=request.data)
    if not serializer.is_valid():
        return _validation_error(serializer.errors)
    if not serializer.validated_data['confirm']:
        return _error('Confirm that you want to withdraw this proposal.', status.HTTP_400_BAD_REQUEST)
    if _mutation_rate_limited('withdraw', request.user):
        return _too_many('Too many actions. Please try again later.')

    with transaction.atomic():
        proposal = get_object_or_404(Proposal.objects.select_for_update(), pk=pk, user=request.user)
        if proposal.status == 'draft':
            return _error('Drafts are deleted, not withdrawn.', status.HTTP_409_CONFLICT, reason='not_sent')
        if proposal.status not in ('sent', 'viewed'):
            return _error(
                f'This proposal has already been {proposal.status}, so it cannot be withdrawn.',
                status.HTTP_409_CONFLICT, reason='not_withdrawable',
            )
        proposal.status = 'withdrawn'
        proposal.withdrawn_at = timezone.now()
        proposal.save(update_fields=['status', 'withdrawn_at', 'updated_at'])

    emit('ProposalWithdrawn', proposal_id=str(proposal.pk), user_id=str(request.user.pk),
         proposal_number=proposal.proposal_number)
    logger.info('[PROPOSALS] Withdrew proposal %s.', proposal.pk)
    return Response(_detail(proposal))


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def proposal_duplicate(request, pk):
    """
    A new DRAFT copy of a proposal in any status, so a withdrawn or declined one
    is not a dead end. Copies the content, pricing and AI provenance; does NOT
    copy valid_until (an old date is a trap — the freelancer must pick a new
    one), the status, view_token (a fresh one is generated), the number, any
    timestamp, the client's answer or converted_invoice. The source row is
    locked so a concurrent edit cannot give a half-old, half-new copy.
    """
    if _mutation_rate_limited('duplicate', request.user):
        return _too_many('Too many actions. Please try again later.')

    with transaction.atomic():
        original = get_object_or_404(Proposal.objects.select_for_update(), pk=pk, user=request.user)
        title = original.title[:TITLE_MAX - len(COPY_SUFFIX)] + COPY_SUFFIX
        copy = Proposal.objects.create(
            user=request.user, client=original.client, client_name=original.client_name,
            client_email=original.client_email, client_company=original.client_company,
            title=title, tone=original.tone, job_description=original.job_description,
            my_experience=original.my_experience, body=original.body, ai_tips=original.ai_tips,
            ai_generated_at=original.ai_generated_at, ai_model=original.ai_model, currency=original.currency,
            scope_sections=original.scope_sections, payment_terms=original.payment_terms,
            tax_rate=original.tax_rate, discount_amount=original.discount_amount,
        )
        for item in original.items.all():
            ProposalItem.objects.create(
                proposal=copy, description=item.description, quantity=item.quantity,
                unit_price=item.unit_price, sort_order=item.sort_order,
            )
        copy.recalculate_totals()
        copy.save(update_fields=['subtotal', 'tax_amount', 'total', 'updated_at'])

    emit('ProposalCreated', proposal_id=str(copy.pk), user_id=str(request.user.pk), duplicated_from=str(original.pk))
    logger.info('[PROPOSALS] Duplicated proposal %s into draft %s.', original.pk, copy.pk)
    return Response(_detail(copy), status=status.HTTP_201_CREATED)


def _resolve_conversion_client(proposal, user, save_client):
    """
    Returns (client_or_None, client_created, error_message_or_None).

    * a saved client on the proposal -> that client, `save_client` ignored;
    * no client and save_client -> an existing client with the same email
      (case-insensitive; even an archived one — it is neither restored nor
      edited) or a new one;
    * otherwise None: a one-time client, nothing added to the CRM.
    """
    if proposal.client_id is not None:
        return proposal.client, False, None
    if not save_client:
        return None, False, None
    name = (proposal.client_name or '').strip()
    email = (proposal.client_email or '').strip()
    if not name or not email:
        return None, False, "Add the client's name and email address before saving them as a client."
    existing = Client.objects.filter(user=user, email__iexact=email).first()
    if existing is not None:
        return existing, False, None
    client = Client.objects.create(
        user=user, name=name, email=email, company=(proposal.client_company or '').strip(),
        default_currency=proposal.currency, default_payment_terms=user.profile.default_payment_terms,
    )
    return client, True, None


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def proposal_convert_to_invoice(request, pk):
    """
    accepted -> a DRAFT invoice (never sent or numbered; the number comes at
    finalise, as for every draft). Body: {"save_client": false}. Idempotent
    (D7): a second call returns 200 with the same invoice (`created: false`);
    the first returns 201. Rows are created with the models directly, the way
    _duplicate_invoice_core does — no apps.invoices view or serializer is
    called. The invoice carries the proposal's items, currency, tax and
    discount (so the totals are identical), its payment terms as `terms`, and one
    short note naming the proposal; none of the proposal's body text.

    Known limit: creating a Client here has the same check-then-create race as
    ClientSerializer.validate_email (there is no database uniqueness on
    user+email); a constraint belongs to apps.clients, not here.
    """
    serializer = ConvertRequestSerializer(data=request.data)
    if not serializer.is_valid():
        return _validation_error(serializer.errors)
    save_client = serializer.validated_data['save_client']
    if _mutation_rate_limited('convert', request.user):
        return _too_many('Too many actions. Please try again later.')

    user = request.user
    profile = user.profile
    with transaction.atomic():
        proposal = get_object_or_404(Proposal.objects.select_for_update(), pk=pk, user=user)
        if proposal.status != 'accepted':
            return _error('Only an accepted proposal can be turned into an invoice.',
                          status.HTTP_409_CONFLICT, reason='not_accepted')
        if proposal.converted_invoice_id is not None:
            client_id = Invoice.objects.filter(pk=proposal.converted_invoice_id).values_list('client_id', flat=True).first()
            return Response({
                'invoice_id': str(proposal.converted_invoice_id), 'created': False,
                'client_id': str(client_id) if client_id else None, 'client_created': False,
            })

        items = list(proposal.items.all())
        if not items:
            return _error('This proposal has no priced items - add items before creating an invoice.',
                          status.HTTP_400_BAD_REQUEST)

        client, client_created, client_error = _resolve_conversion_client(proposal, user, save_client)
        if client_error:
            return _error(client_error, status.HTTP_400_BAD_REQUEST)

        if client is not None:
            client_fields = {
                'client': client, 'client_name': client.name, 'client_email': client.email,
                'client_company': client.company, 'client_address': client.address, 'client_phone': client.phone,
                'is_one_time_client': False,
            }
            terms_days = client.default_payment_terms
        else:
            client_fields = {
                'client': None, 'client_name': proposal.client_name, 'client_email': proposal.client_email,
                'client_company': proposal.client_company, 'is_one_time_client': True,
            }
            terms_days = profile.default_payment_terms

        today = _today()
        number = proposal.proposal_number or ''
        note = f'Per accepted proposal {number}: {proposal.title}' if number else f'Per accepted proposal: {proposal.title}'
        invoice = Invoice.objects.create(
            user=user, currency=proposal.currency, tax_rate=proposal.tax_rate,
            discount_amount=proposal.discount_amount, issue_date=today, due_date=today + timedelta(days=terms_days),
            terms=proposal.payment_terms, notes=note, base_template=profile.invoice_template, **client_fields,
        )
        for item in items:
            InvoiceItem.objects.create(
                invoice=invoice, description=item.description, quantity=item.quantity,
                unit_price=item.unit_price, sort_order=item.sort_order,
            )
        invoice.recalculate_totals()
        invoice.save(update_fields=['subtotal', 'tax_amount', 'total', 'updated_at'])

        proposal.converted_invoice = invoice
        update_fields = ['converted_invoice', 'updated_at']
        if client is not None and proposal.client_id != client.pk:
            proposal.client = client
            update_fields.append('client')
        proposal.save(update_fields=update_fields)

    if client_created:
        emit('ClientCreated', client_id=str(client.pk), user_id=str(user.pk))
    emit('ProposalConverted', proposal_id=str(proposal.pk), user_id=str(user.pk),
         invoice_id=str(invoice.pk), client_created=client_created)
    emit('InvoiceCreated', invoice_id=str(invoice.pk), user_id=str(user.pk), converted_from_proposal=str(proposal.pk))
    logger.info('[PROPOSALS] Converted proposal %s into draft invoice %s.', proposal.pk, invoice.pk)
    return Response({
        'invoice_id': str(invoice.pk), 'created': True,
        'client_id': str(client.pk) if client is not None else None, 'client_created': client_created,
    }, status=status.HTTP_201_CREATED)
