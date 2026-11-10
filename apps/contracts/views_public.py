# apps/contracts/views_public.py
"""
The public, no-login client page behind a contract's `view_token`: read it, sign it or decline it. Copied in
structure and in every defensive detail from apps/proposals/views_public.py. The token IS the credential, so:

* `@authentication_classes([])` - without it a stale freelancer cookie in the browser would make DRF answer 401 on a
  public page. Nothing here depends on any cookie; the one place a cookie is looked at (the owner check) never blocks
  and never raises.
* An unknown token, an over-long token and a `draft` all answer the SAME 404 body, so nobody can tell "draft" from
  "does not exist".
* Every response carries `Cache-Control: no-store` (the `no_store` decorator).
* The payload is an allowlist (serializers.public_payload), never a ModelSerializer.
* Rate limited per client IP with an explicit cache counter (CLAUDE.md rule 12). DRF's blanket AnonRateThrottle is
  switched off on these views (`@throttle_classes([])`) so the documented limits here are the real ones.
* All text is plain text, displayed escaped, never HTML.

The honest limit of this credential (decision K1): anyone who holds the link can sign. No page, email or PDF here
claims that the signer's identity was checked; they say what is RECORDED.
"""
import logging

from django.db import transaction
from django.utils import timezone
from rest_framework import serializers as drf_serializers
from rest_framework import status
from rest_framework.decorators import api_view, authentication_classes, permission_classes, throttle_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from apps.users.owner_probe import request_is_owner
from core.events import emit
from core.observability import get_client_ip, get_user_agent
from core.public_http import no_store, safe_ip
from core.ratelimit import rate_limited

from . import copy as words
from .constants import (
    DECLINE_LIMIT_PER_HOUR, GET_LIMIT_PER_HOUR, MESSAGE_MAX, SIGN_LIMIT_PER_HOUR, TOKEN_MAX_LENGTH,
)
from .integrity import verify_integrity
from .models import Contract, _today
from .serializers import DeclineRequestSerializer, SignRequestSerializer, clean_signer_name, public_payload
from .services import normalise_text
from .tasks import send_signed_copies

logger = logging.getLogger(__name__)

NOT_FOUND_BODY = {'error': words.NOT_FOUND}


def _not_found():
    return Response(NOT_FOUND_BODY, status=status.HTTP_404_NOT_FOUND)


def _too_many():
    return Response({'error': words.TOO_MANY_REQUESTS}, status=status.HTTP_429_TOO_MANY_REQUESTS)


def _limit_key(kind, request):
    return f'ratelimit_contracts_public_{kind}_{get_client_ip(request) or "unknown"}'


def _bad_request(message, **extra):
    return Response({'error': message, **extra}, status=status.HTTP_400_BAD_REQUEST)


def _conflict(message, reason):
    return Response({'error': message, 'reason': reason}, status=status.HTTP_409_CONFLICT)


@no_store
@api_view(['GET'])
@authentication_classes([])
@permission_classes([AllowAny])
@throttle_classes([])
def contract_public(request, view_token):
    """
    The client's view of a contract. A withdrawn one shows only that fact.

    The FIRST non-owner view of a `sent` contract flips it to `viewed` with ONE conditional UPDATE
    (`WHERE status='sent'`): race-free without a lock, so 8 simultaneous first views produce exactly one viewed_at
    and - because only the request whose UPDATE changed a row emits - exactly one audit row. A later view, or a view
    of an answered contract, changes nothing. Only a timestamp is stored; the viewer's IP and browser are not (K2).

    The owner opening their own link sees the same page with `preview: true` and nothing changes in the database.
    """
    if rate_limited(_limit_key('get', request), GET_LIMIT_PER_HOUR):
        return _too_many()
    if len(view_token) > TOKEN_MAX_LENGTH:
        return _not_found()
    contract = Contract.objects.select_related('user__profile').filter(view_token=view_token).first()
    if contract is None or contract.status == 'draft':
        return _not_found()

    is_owner = request_is_owner(request, contract.user_id)
    if not is_owner and contract.status == 'sent':
        now = timezone.now()
        changed = Contract.objects.filter(pk=contract.pk, status='sent').update(
            status='viewed', viewed_at=now, updated_at=now)
        if changed:
            emit('ContractViewed', contract_id=str(contract.pk), user_id=str(contract.user_id),
                 contract_number=contract.contract_number)
    return Response(public_payload(contract, preview=is_owner))


@no_store
@api_view(['POST'])
@authentication_classes([])
@permission_classes([AllowAny])
@throttle_classes([])
def contract_public_sign(request, view_token):
    """
    The client signs by typing their full name. Body: {"signer_name": "...", "agree": true}.

    Validated BEFORE any lock (400). Then, under select_for_update on the contract row (no select_related:
    PostgreSQL refuses FOR UPDATE on the nullable side of an outer join), in this order: 404 (unknown/draft) -> 403
    owner -> 409 withdrawn -> 409 already answered -> 409 expired -> 409 integrity -> apply. Exactly one of any
    number of simultaneous signatures wins; the rest see 409.

    The integrity step recomputes the fingerprint from the stored row: if the text no longer matches what was frozen
    at send, signing is refused (and logged with ids only).

    The client's validated IP and browser string are stored with the signature (evidence of who signed) and nowhere
    on a plain view. After the transaction the signed copies are queued for a worker; a down broker is logged and
    never fails the signing.

    No CSRF enforcement and no cookie dependence, deliberately: the request carries no ambient credential
    (authentication is off and the token in the URL is the secret), so a cross-site forgery would have to already
    know the token and gains nothing a direct request would not. Signing is POST-only on purpose: a mail scanner
    that opens the link with GET can mark it viewed but can never sign.
    """
    if rate_limited(_limit_key('sign', request), SIGN_LIMIT_PER_HOUR):
        return _too_many()
    if len(view_token) > TOKEN_MAX_LENGTH:
        return _not_found()
    serializer = SignRequestSerializer(data=request.data)
    if not serializer.is_valid():
        return _bad_request('Invalid input.', **serializer.errors)
    try:
        signer_name = clean_signer_name(serializer.validated_data['signer_name'])
    except drf_serializers.ValidationError as exc:
        return _bad_request(str(exc.detail[0]))
    if serializer.validated_data['agree'] is not True:
        return _bad_request(words.AGREE_REQUIRED)
    ip = safe_ip(request)
    user_agent = get_user_agent(request)

    with transaction.atomic():
        contract = Contract.objects.select_for_update(of=('self',)).filter(view_token=view_token).first()
        if contract is None or contract.status == 'draft':
            return _not_found()
        if request_is_owner(request, contract.user_id):
            return Response({'error': words.OWN_CONTRACT, 'reason': 'owner'}, status=status.HTTP_403_FORBIDDEN)
        if contract.status == 'withdrawn':
            return _conflict(words.WITHDRAWN, 'withdrawn')
        if contract.status in ('signed', 'declined'):
            return _conflict(words.ALREADY_ANSWERED, 'already_answered')
        if contract.valid_until is not None and contract.valid_until < _today():
            return _conflict(words.EXPIRED, 'expired')
        if not verify_integrity(contract):
            logger.error('[CONTRACTS] Integrity check failed at signing: contract=%s user=%s', contract.pk, contract.user_id)
            return _conflict(words.INTEGRITY, 'integrity')

        now = timezone.now()
        contract.status = 'signed'
        contract.signed_name = signer_name
        contract.responded_at = now
        contract.response_ip = ip
        contract.response_user_agent = user_agent
        contract.signed_hash = contract.content_hash
        update_fields = ['status', 'signed_name', 'responded_at', 'response_ip', 'response_user_agent',
                         'signed_hash', 'updated_at']
        if contract.viewed_at is None:
            contract.viewed_at = now  # signing proves they saw it
            update_fields.append('viewed_at')
        contract.save(update_fields=update_fields)

    emit('ContractSigned', contract_id=str(contract.pk), user_id=str(contract.user_id),
         contract_number=contract.contract_number, content_hash=contract.content_hash, ip=ip, user_agent=user_agent)
    logger.info('[CONTRACTS] Contract %s signed by the client.', contract.pk)
    try:
        send_signed_copies.delay(str(contract.pk))
    except Exception:
        logger.exception('[CONTRACTS] Could not queue the signed copies for contract %s.', contract.pk)

    fresh = Contract.objects.select_related('user__profile').get(pk=contract.pk)
    return Response(public_payload(fresh, preview=False))


@no_store
@api_view(['POST'])
@authentication_classes([])
@permission_classes([AllowAny])
@throttle_classes([])
def contract_public_decline(request, view_token):
    """
    The client declines. Body: {"reason": "<optional, at most 1000 characters>"}. The same lock and the same ordering
    as signing, without the integrity step: declining records no agreement to the text. Exactly one of any number
    of simultaneous answers (sign or decline) wins. Stores the client's reason, validated IP and browser string.
    """
    if rate_limited(_limit_key('decline', request), DECLINE_LIMIT_PER_HOUR):
        return _too_many()
    if len(view_token) > TOKEN_MAX_LENGTH:
        return _not_found()
    serializer = DeclineRequestSerializer(data=request.data)
    if not serializer.is_valid():
        return _bad_request('Invalid input.', **serializer.errors)
    reason = normalise_text(serializer.validated_data['reason'])
    if len(reason) > MESSAGE_MAX:
        return _bad_request(words.REASON_TOO_LONG.format(n=len(reason) - MESSAGE_MAX))
    ip = safe_ip(request)
    user_agent = get_user_agent(request)

    with transaction.atomic():
        contract = Contract.objects.select_for_update(of=('self',)).filter(view_token=view_token).first()
        if contract is None or contract.status == 'draft':
            return _not_found()
        if request_is_owner(request, contract.user_id):
            return Response({'error': "You can't decline your own contract.", 'reason': 'owner'},
                            status=status.HTTP_403_FORBIDDEN)
        if contract.status == 'withdrawn':
            return _conflict(words.WITHDRAWN, 'withdrawn')
        if contract.status in ('signed', 'declined'):
            return _conflict(words.ALREADY_ANSWERED, 'already_answered')
        if contract.valid_until is not None and contract.valid_until < _today():
            return _conflict(words.EXPIRED, 'expired')

        now = timezone.now()
        contract.status = 'declined'
        contract.response_message = reason
        contract.responded_at = now
        contract.response_ip = ip
        contract.response_user_agent = user_agent
        update_fields = ['status', 'response_message', 'responded_at', 'response_ip', 'response_user_agent', 'updated_at']
        if contract.viewed_at is None:
            contract.viewed_at = now
            update_fields.append('viewed_at')
        contract.save(update_fields=update_fields)

    emit('ContractDeclined', contract_id=str(contract.pk), user_id=str(contract.user_id),
         contract_number=contract.contract_number, reason_length=len(reason), ip=ip, user_agent=user_agent)
    logger.info('[CONTRACTS] Contract %s declined by the client.', contract.pk)

    fresh = Contract.objects.select_related('user__profile').get(pk=contract.pk)
    return Response(public_payload(fresh, preview=False))
