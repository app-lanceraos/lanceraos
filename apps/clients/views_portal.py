# apps/clients/views_portal.py
"""
Client Portal Authentication — Step 11. Magic-link entry via
Client.portal_token, self-serve "email me a fresh link" resend, and
logout/logout-everywhere.

Scoped to apps.clients only, per this step's own instructions:
Invoice.view_token as an alternate portal-entry credential,
GET .../portal/me/'s invoice list, and wiring the freelancer-own-session
guard (portal.is_freelancer_previewing_portal) into real view-tracking
call sites are Step 12's job — building any of that here would mean
apps.clients reaching into Invoice data, the exact dependency direction
item 0 of this step fixed (apps.invoices -> apps.clients only, never the
reverse). Endpoints below therefore live under this app's own
/api/clients/portal/... prefix rather than the spec's eventual unified
/api/portal/... surface (which needs to accept either credential type,
spanning both apps) — see DECISIONS.md.
"""
import logging

from django.conf import settings
from django.core.cache import cache
from django.middleware.csrf import get_token
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from core.email import send_client_facing_email
from core.observability import get_client_ip

from apps.users.authentication import enforce_csrf_standalone

from .cookies import clear_portal_session_cookie
from .models import Client
from .portal import get_current_session, issue_or_renew_session, revoke_all_sessions_for_client, revoke_session

logger = logging.getLogger(__name__)


def _check_portal_link_rate_limit(email, ip_address):
    """
    Two independent cache-based counters, both must pass: 5/email/hour
    and 20/IP/hour — matching this project's established
    _check_moderate_rate_limit shape (apps/clients/views.py) but with
    these specific, tighter numbers given this is a real, if modest,
    attack surface: a token+session gates access to financial documents.
    Public/unauthenticated endpoint — keyed by email/IP directly, not
    request.user (there is no authenticated user on this path at all).
    Returns True (and increments both counters) if either threshold is
    already exceeded.
    """
    email_key = f'ratelimit_portal_link_email_{email.lower()}'
    ip_key = f'ratelimit_portal_link_ip_{ip_address or "unknown"}'
    email_count = cache.get(email_key, 0)
    ip_count = cache.get(ip_key, 0)
    if email_count >= 5 or ip_count >= 20:
        return True
    cache.set(email_key, email_count + 1, timeout=3600)
    cache.set(ip_key, ip_count + 1, timeout=3600)
    return False


def _send_portal_link_email(client):
    """
    Builds and sends the magic-link email for one client, through the
    shared core.email.send_client_facing_email routing chain (item 0's
    promoted function) — the exact same custom-SMTP-vs-Resend/fallback-
    notification/observability chain apps.invoices uses, per CLAUDE.md's
    Custom Email Rules item 2 ("Client portal PIN" is explicitly one of
    the listed client-facing email categories this chain covers).

    Link target is a placeholder frontend route (no portal frontend
    exists yet, per this step's own scope) — will need revisiting the
    moment Step 12+ builds the real page, flagged rather than treated as
    final.
    """
    link_url = f'{settings.FRONTEND_URL}/portal/{client.portal_token}/'
    subject = 'Your LanceraOS client portal link'
    html_body = f"""
<p style="margin:0 0 16px;font-size:14px;color:#334155;line-height:1.7;">Hi {client.name},<br/><br/>
Here is your link to view your invoices and payment history:</p>
<p style="margin:0 0 16px;"><a href="{link_url}" style="color:#00c896;font-weight:600;">{link_url}</a></p>
<p style="margin:0;font-size:12px;color:#94a3b8;">This link doesn't expire — bookmark it for later.</p>"""
    plain = f'Hi {client.name},\n\nYour LanceraOS client portal link:\n{link_url}\n\nThis link doesn\'t expire.'

    send_client_facing_email(
        client.user, client.email, subject, html_body, plain,
        recipient_name=client.name, context_type='client_portal', context_id=str(client.pk),
    )


@api_view(['GET'])
@permission_classes([AllowAny])
def portal_enter(request, token):
    """
    Magic-link entry via Client.portal_token — a persistent, non-expiring
    credential (generated once, Client.save()) that IS the "view all my
    invoices with this freelancer" access grant, not a session itself.
    A valid token mints/renews a real ClientPortalSession
    (issue_or_renew_session) and returns the client's own identity —
    NOT an invoice list (that's GET .../portal/me/, Step 12, which needs
    real Invoice data this app deliberately doesn't reach into).

    Unknown/invalid token -> a real 404, not a redirect or a 200 with an
    error body — this is public-facing and unauthenticated by design, so
    the response must not leak whether a near-miss token almost matched.

    Also primes the CSRF cookie (get_token) — the one real GET every
    portal session starts from, so the CSRF cookie needed for the
    logout/logout-everywhere POSTs below is already present by the time
    a real portal frontend (Step 12+) would need to call them.
    """
    try:
        client = Client.objects.get(portal_token=token)
    except Client.DoesNotExist:
        return Response({'error': 'This link is invalid or has expired.'}, status=status.HTTP_404_NOT_FOUND)

    get_token(request)
    response = Response({
        'client': {
            'id': str(client.pk), 'name': client.name, 'email': client.email, 'company': client.company,
        },
    })
    issue_or_renew_session(client, request, response)
    return response


@api_view(['POST'])
@permission_classes([AllowAny])
def portal_request_link(request):
    """
    Self-serve "email me a fresh link" — per the spec, there's no
    separate token to mint: the credential is the persistent
    portal_token itself, so this is genuinely just "resend the email
    containing the link you already have a right to." Looks up EVERY
    Client with the given email, across any freelancer (a client may
    work with several LanceraOS users), and sends each one their own
    existing link.

    Always returns the same generic success response regardless of
    whether the email matched any real client — this must not become an
    oracle for "is this email a LanceraOS client," matching this
    project's other enumeration-safe flows (e.g. forgot-password). Not
    tied to any cookie/session, so no CSRF concern here (the same
    reasoning /api/auth/forgot-password/ already relies on).
    """
    email = (request.data.get('email') or '').strip()
    generic_response = Response({'message': 'If that email matches a client account, a link has been sent.'})

    if not email:
        return generic_response

    ip_address = get_client_ip(request)
    if _check_portal_link_rate_limit(email, ip_address):
        return Response({'error': 'Too many requests. Please try again later.'}, status=status.HTTP_429_TOO_MANY_REQUESTS)

    clients = Client.objects.filter(email__iexact=email)
    for client in clients:
        _send_portal_link_email(client)

    logger.info('[CLIENTS PORTAL] request-link processed for email=%s (%d match(es)).', email, len(clients))
    return generic_response


@api_view(['POST'])
@permission_classes([AllowAny])
def portal_logout(request):
    """Revokes exactly the current session (this device/browser only) — requires a valid current portal session, not an open endpoint."""
    enforce_csrf_standalone(request)

    session = get_current_session(request)
    if session is None:
        return Response({'error': 'No active portal session.'}, status=status.HTTP_401_UNAUTHORIZED)

    revoke_session(session)
    response = Response({'message': 'Logged out.'})
    clear_portal_session_cookie(response)
    return response


@api_view(['POST'])
@permission_classes([AllowAny])
def portal_logout_everywhere(request):
    """Revokes every live session for this client, across every device — requires a valid current portal session, not an open endpoint."""
    enforce_csrf_standalone(request)

    session = get_current_session(request)
    if session is None:
        return Response({'error': 'No active portal session.'}, status=status.HTTP_401_UNAUTHORIZED)

    revoke_all_sessions_for_client(session.client)
    response = Response({'message': 'Logged out on all devices.'})
    clear_portal_session_cookie(response)
    return response
