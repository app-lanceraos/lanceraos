# apps/users/views/oauth.py
from django.core.cache import cache
from django.db import transaction
from rest_framework import status
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from core.observability import get_client_ip, log_event

from ..authentication import enforce_csrf_standalone
from ..oauth.base import link_or_create_user
from ..oauth.facebook import OAuthVerificationError as FacebookError
from ..oauth.facebook import verify_facebook_token
from ..oauth.google import OAuthVerificationError as GoogleError
from ..oauth.google import verify_google_token
from ..token_service import issue_tokens_and_session
from .auth import (
    NO_AUTH,
    _create_or_update_trusted_device,
    _finalize_login_response,
    _get_trusted_device,
    _update_last_login,
)

# OAuth sessions always use the standard lifetime — there's no "remember
# me" checkbox on a Google/Facebook button, unlike the email/password
# login form, so there's no user-expressed preference to honor here.
OAUTH_REFRESH_DAYS = 30


def _complete_oauth_login(provider, identity, request):
    """Shared tail end of both provider flows: link/create, issue tokens, respond."""
    with transaction.atomic():
        user, is_new_user = link_or_create_user(provider, identity)

    if not user.is_active:
        return Response(
            {'error': 'Your account has been disabled. Please contact support.'},
            status=status.HTTP_403_FORBIDDEN,
        )

    device = _get_trusted_device(user, request)
    _update_last_login(user, request, device_recognized=(device is not None))
    log_event(f'login_{provider}', user=user, request=request, metadata={'new_user': is_new_user})

    access, refresh_str, session = issue_tokens_and_session(user, request, remember_me=False, trusted_device=device)
    response = _finalize_login_response(
        user, access, refresh_str, OAUTH_REFRESH_DAYS, extra={'is_new_user': is_new_user},
    )
    _create_or_update_trusted_device(user, request, response, existing_device=device, grant_skip_2fa=False)
    return response


@api_view(['POST'])
@authentication_classes(NO_AUTH)
@permission_classes([AllowAny])
def google_login(request):
    enforce_csrf_standalone(request)

    ip = get_client_ip(request)
    key = f'oauth_login_{ip}'
    count = cache.get(key, 0)
    if count >= 20:
        return Response({'error': 'Too many login attempts. Please try again later.'}, status=status.HTTP_429_TOO_MANY_REQUESTS)
    cache.set(key, count + 1, timeout=3600)

    credential = request.data.get('credential', '').strip()
    access_token = request.data.get('access_token', '').strip()

    if not credential and not access_token:
        return Response({'error': 'Google credential is required.'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        identity = verify_google_token(credential=credential or None, access_token=access_token or None)
    except GoogleError as exc:
        log_event('login_failed', request=request, metadata={'provider': 'google', 'reason': str(exc)})
        return Response({'error': str(exc)}, status=status.HTTP_401_UNAUTHORIZED)

    return _complete_oauth_login('google', identity, request)


@api_view(['POST'])
@authentication_classes(NO_AUTH)
@permission_classes([AllowAny])
def facebook_login(request):
    enforce_csrf_standalone(request)

    ip = get_client_ip(request)
    key = f'oauth_login_{ip}'
    count = cache.get(key, 0)
    if count >= 20:
        return Response({'error': 'Too many login attempts. Please try again later.'}, status=status.HTTP_429_TOO_MANY_REQUESTS)
    cache.set(key, count + 1, timeout=3600)

    access_token = request.data.get('access_token', '').strip()

    if not access_token:
        return Response({'error': 'Facebook access token is required.'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        identity = verify_facebook_token(access_token)
    except FacebookError as exc:
        log_event('login_failed', request=request, metadata={'provider': 'facebook', 'reason': str(exc)})
        return Response({'error': str(exc)}, status=status.HTTP_401_UNAUTHORIZED)

    return _complete_oauth_login('facebook', identity, request)