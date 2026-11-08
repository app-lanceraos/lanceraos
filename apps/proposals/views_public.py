# apps/proposals/views_public.py
"""
The public, no-login client page behind a proposal's `view_token`: read it,
accept it or decline it. The token IS the credential, so:

* `@authentication_classes([])` — without it a stale freelancer cookie in the
  browser would make DRF answer 401 on a public page. Nothing here depends on
  any cookie; the one place a cookie is looked at (the owner check) never
  blocks and never raises.
* An unknown token, an over-long token and a `draft` all answer the SAME 404
  body, so nobody can tell "draft" from "does not exist".
* Every response carries `Cache-Control: no-store` (the `no_store` decorator).
* The payload is an allowlist serializer (serializers.PublicProposalSerializer),
  never a ModelSerializer.
* Rate limited per client IP with an explicit cache counter (CLAUDE.md rule 12).
  DRF's blanket AnonRateThrottle (100/hour) is switched off on these two views
  (`@throttle_classes([])`) so the documented limits here are the real ones.
* All text is plain text, displayed escaped, never HTML.
"""
import ipaddress
import logging
from functools import wraps

from django.db import transaction
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, authentication_classes, permission_classes, throttle_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from apps.users.authentication import CookieJWTAuthentication, identify_user_from_refresh_cookie
from core.events import emit
from core.observability import get_client_ip, get_user_agent

from .models import Proposal, _today
from core.ratelimit import rate_limited
from .serializers import RespondRequestSerializer, public_payload, public_state

logger = logging.getLogger(__name__)

TOKEN_MAX_LENGTH = 32  # Proposal.view_token's column width
GET_LIMIT_PER_HOUR = 120
RESPOND_LIMIT_PER_HOUR = 10

NOT_FOUND_BODY = {'error': 'Not found.'}


def no_store(view):
    """
    Adds `Cache-Control: no-store` to EVERY response of the wrapped view,
    errors and DRF's own 405 included. Applied outside @api_view; functools.wraps
    carries the csrf_exempt marker across, so the view stays exempt (it carries
    no ambient credential — see proposal_public_respond).
    """
    @wraps(view)
    def wrapper(*args, **kwargs):
        response = view(*args, **kwargs)
        response['Cache-Control'] = 'no-store'
        return response
    return wrapper


class _OwnerProbe(CookieJWTAuthentication):
    """
    Identifies a freelancer session; never authorises anything. CSRF is
    switched off here on purpose: the parent enforces CSRF inside
    authenticate(), and on the POST /respond/ path a missing CSRF token would
    raise, be swallowed by request_is_owner's try/except, and make the OWNER
    look like an ordinary client — letting them answer their own proposal.
    Reading "who is this cookie" cannot be forged into any action, so no CSRF
    check is needed to read it.
    """

    def enforce_csrf(self, request):
        return None


def request_is_owner(request, owner_user_id):
    """
    True only if the request carries a valid freelancer session whose user IS
    the proposal's owner (decision D3). A different logged-in freelancer opening
    someone else's link is an ordinary client for this purpose. Never raises: any
    failure (no cookie, expired, revoked, malformed) means "not the owner".

    The access cookie decides first. If it is absent or invalid (it lives only 15
    minutes), the refresh cookie is consulted read-only
    (identify_user_from_refresh_cookie), so the owner stays recognised for as
    long as they are signed in. A VALID access cookie that belongs to someone
    else does not fall through to the refresh cookie: the two are set together
    and name the same person, so a different user's access cookie means a
    different person is signed in.

    Either answer can only reduce what happens (the owner sees a preview, the
    view is not counted, they cannot answer); it grants no access to anything.

    apps.clients.portal.is_freelancer_previewing_portal cannot be reused: it
    returns True only when the browser holds BOTH a freelancer session AND a
    client-portal session, and a proposal link never creates a portal session,
    so it would always say False.
    """
    try:
        result = _OwnerProbe().authenticate(request)
    except Exception:
        result = None
    if result is not None:
        return str(result[0].pk) == str(owner_user_id)
    try:
        user = identify_user_from_refresh_cookie(request)
    except Exception:
        return False
    return user is not None and str(user.pk) == str(owner_user_id)


def safe_ip(request):
    """
    The client address as a validated, normalised IP string, or None.

    get_client_ip returns whatever the last X-Forwarded-For entry is, and a
    value that is not an IP makes any PostgreSQL `inet` insert fail; inside a
    transaction that poisons the whole transaction. Recording an answer must
    never fail because of a request header, so anything that is not a valid
    IP address is stored as NULL instead.
    """
    raw = get_client_ip(request)
    # A scoped IPv6 literal ("fe80::1%eth0") parses in Python but is not a client address a proxy would
    # ever append, and its stored form is not what was parsed; treat it as not-an-IP.
    if not raw or '%' in raw:
        return None
    try:
        return str(ipaddress.ip_address(raw.strip()))
    except ValueError:
        return None


def _not_found():
    return Response(NOT_FOUND_BODY, status=status.HTTP_404_NOT_FOUND)


def _too_many():
    return Response({'error': 'Too many requests. Please try again in a little while.'},
                    status=status.HTTP_429_TOO_MANY_REQUESTS)


def _limit_key(kind, request):
    return f'ratelimit_proposals_public_{kind}_{get_client_ip(request) or "unknown"}'


@no_store
@api_view(['GET'])
@authentication_classes([])
@permission_classes([AllowAny])
@throttle_classes([])
def proposal_public(request, view_token):
    """
    The client's view of a proposal. A withdrawn one shows only that fact.

    The FIRST non-owner view of a `sent` proposal flips it to `viewed` with ONE
    conditional UPDATE (`WHERE status='sent'`): race-free without a lock, so 8
    simultaneous first views produce exactly one viewed_at and — because only
    the request whose UPDATE changed a row emits — exactly one audit row. A
    later view, or a view of an answered proposal, changes nothing. Only a
    timestamp is stored; the viewer's IP and browser are not (D6).

    The owner opening their own link sees the same page with `preview: true`
    and nothing changes in the database (D3).
    """
    if rate_limited(_limit_key('get', request), GET_LIMIT_PER_HOUR):
        return _too_many()
    if len(view_token) > TOKEN_MAX_LENGTH:
        return _not_found()
    proposal = (
        Proposal.objects.select_related('user__profile').prefetch_related('items')
        .filter(view_token=view_token).first()
    )
    if proposal is None or proposal.status == 'draft':
        return _not_found()

    is_owner = request_is_owner(request, proposal.user_id)
    if not is_owner and proposal.status == 'sent':
        now = timezone.now()
        changed = Proposal.objects.filter(pk=proposal.pk, status='sent').update(
            status='viewed', viewed_at=now, updated_at=now)
        if changed:
            emit('ProposalViewed', proposal_id=str(proposal.pk), user_id=str(proposal.user_id),
                 proposal_number=proposal.proposal_number)
    return Response(public_payload(proposal, preview=is_owner))


@no_store
@api_view(['POST'])
@authentication_classes([])
@permission_classes([AllowAny])
@throttle_classes([])
def proposal_public_respond(request, view_token):
    """
    The client accepts or declines. Body: {"decision": "accept"|"decline",
    "message": "<optional, at most 1000 characters>"}.

    Validated BEFORE any lock (400). Then, under select_for_update on the
    proposal row (no select_related: PostgreSQL refuses FOR UPDATE on the
    nullable side of an outer join), in this order: 404 (unknown/draft) ->
    403 owner -> 409 withdrawn -> 409 already answered -> 409 expired -> apply.
    Exactly one of any number of simultaneous answers wins; the rest see 409.

    The client's validated IP and browser string are stored with the answer
    (evidence of who accepted) and nowhere on a plain view (D6).

    No CSRF enforcement, deliberately: the request carries no ambient
    credential (authentication is off and the token in the URL is the secret),
    so a cross-site forgery would have to already know the token and gains
    nothing a direct request would not.
    """
    if rate_limited(_limit_key('respond', request), RESPOND_LIMIT_PER_HOUR):
        return _too_many()
    if len(view_token) > TOKEN_MAX_LENGTH:
        return _not_found()
    serializer = RespondRequestSerializer(data=request.data)
    if not serializer.is_valid():
        first = next(iter(serializer.errors.values()))
        message = first[0] if isinstance(first, list) and first else 'Invalid input.'
        return Response({**serializer.errors, 'error': str(message)}, status=status.HTTP_400_BAD_REQUEST)
    decision = serializer.validated_data['decision']
    message = serializer.validated_data['message'].strip()
    ip = safe_ip(request)
    user_agent = get_user_agent(request)

    with transaction.atomic():
        proposal = Proposal.objects.select_for_update(of=('self',)).filter(view_token=view_token).first()
        if proposal is None or proposal.status == 'draft':
            return _not_found()
        if request_is_owner(request, proposal.user_id):
            return Response({"error": "You can't answer your own proposal.", 'reason': 'owner'},
                            status=status.HTTP_403_FORBIDDEN)
        if proposal.status == 'withdrawn':
            return Response({'error': 'This proposal has been withdrawn.', 'reason': 'withdrawn'},
                            status=status.HTTP_409_CONFLICT)
        if proposal.status in ('accepted', 'declined'):
            return Response({'error': 'This proposal has already been answered.', 'reason': 'already_answered'},
                            status=status.HTTP_409_CONFLICT)
        if proposal.valid_until is not None and proposal.valid_until < _today():
            return Response({'error': 'This proposal has expired.', 'reason': 'expired'},
                            status=status.HTTP_409_CONFLICT)

        now = timezone.now()
        proposal.status = 'accepted' if decision == 'accept' else 'declined'
        proposal.responded_at = now
        proposal.response_message = message
        proposal.response_ip = ip
        proposal.response_user_agent = user_agent
        update_fields = ['status', 'responded_at', 'response_message', 'response_ip',
                         'response_user_agent', 'updated_at']
        if proposal.viewed_at is None:
            proposal.viewed_at = now  # answering proves they saw it
            update_fields.append('viewed_at')
        proposal.save(update_fields=update_fields)

    emit('ProposalAnswered', proposal_id=str(proposal.pk), user_id=str(proposal.user_id), decision=decision,
         message_length=len(message), ip=ip, user_agent=user_agent, proposal_number=proposal.proposal_number)
    logger.info('[PROPOSALS] Proposal %s %s by the client.', proposal.pk, proposal.status)

    fresh = (
        Proposal.objects.select_related('user__profile').prefetch_related('items').get(pk=proposal.pk)
    )
    return Response(public_payload(fresh, preview=False))
