# apps/users/views/add_password.py
"""
Lets an OAuth-only account add a real password, unlocking email/password
login alongside their existing Google/Facebook sign-in, which in turn
unlocks 2FA (meaningless without a password to protect) and eventually
is_oauth_only() becoming False for every password-gated flow already
in this codebase, with zero changes needed to those flows themselves.

Requires an email-confirmation step rather than setting the password
directly from an already-authenticated request — if a session were
ever hijacked while logged in via OAuth (XSS, stolen cookie), setting
a password directly would hand an attacker a persistent backdoor
(password-based login) that survives the OAuth session ending. Email
confirmation means they'd also need the person's actual inbox, not
just their browser session.
"""
import hashlib

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from core.observability import log_event

from ..authentication import enforce_csrf_standalone
from ..serializers import validate_password_strength
from ..tokens import decode_uid, encode_uid
from .auth import NO_AUTH, _generate_token

User = get_user_model()


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def request_add_password(request):
    user = request.user
    if not user.is_oauth_only():
        return Response({'error': 'This account already has a password.'}, status=status.HTTP_400_BAD_REQUEST)

    key = f'add_password_req_{user.pk}'
    count = cache.get(key, 0)
    if count >= 3:
        return Response({'error': 'Too many requests. Please try again in an hour.'}, status=status.HTTP_429_TOO_MANY_REQUESTS)
    cache.set(key, count + 1, timeout=3600)

    raw_token = _generate_token()
    cache.set(f'add_password_token_{hashlib.sha256(raw_token.encode()).hexdigest()}', str(user.pk), timeout=86400)

    uid = encode_uid(user)
    # Reuses the existing generic email-sending infrastructure with a
    # purpose-specific subject/body — not send_email_change_step1_email,
    # which is worded specifically for changing an email, not adding a
    # password.
    from ..emails import send_add_password_confirmation_email
    send_add_password_confirmation_email(user, raw_token, uid)
    log_event('add_password_requested', user=user, request=request)

    return Response({'message': 'A confirmation link has been sent to your email.'})


@api_view(['GET'])
@authentication_classes(NO_AUTH)
@permission_classes([AllowAny])
def validate_add_password_token(request, uidb64, token):
    user = decode_uid(uidb64)
    if user is None:
        return Response({'valid': False, 'error': 'Invalid link.'}, status=status.HTTP_400_BAD_REQUEST)
    cache_key = f'add_password_token_{hashlib.sha256(token.encode()).hexdigest()}'
    stored_user_id = cache.get(cache_key)
    if not stored_user_id or stored_user_id != str(user.pk):
        return Response({'valid': False, 'error': 'This link has expired. Please request a new one.'}, status=status.HTTP_400_BAD_REQUEST)
    return Response({'valid': True})


@api_view(['POST'])
@authentication_classes(NO_AUTH)
@permission_classes([AllowAny])
def complete_add_password(request, uidb64, token):
    enforce_csrf_standalone(request)
    user = decode_uid(uidb64)
    if user is None:
        return Response({'error': 'Invalid link.'}, status=status.HTTP_400_BAD_REQUEST)

    cache_key = f'add_password_token_{hashlib.sha256(token.encode()).hexdigest()}'
    stored_user_id = cache.get(cache_key)
    if not stored_user_id or stored_user_id != str(user.pk):
        return Response({'error': 'This link has expired. Please request a new one.'}, status=status.HTTP_400_BAD_REQUEST)

    if not user.is_oauth_only():
        return Response({'error': 'This account already has a password.'}, status=status.HTTP_400_BAD_REQUEST)

    password = request.data.get('password', '')
    confirm_password = request.data.get('confirm_password', '')
    if password != confirm_password:
        return Response({'confirm_password': 'Passwords do not match.'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        validate_password_strength(password)
    except Exception as exc:
        detail = exc.detail if hasattr(exc, 'detail') else str(exc)
        return Response({'password': detail}, status=status.HTTP_400_BAD_REQUEST)

    user.set_password(password)
    user.password_changed_at = timezone.now()
    user.save(update_fields=['password', 'password_changed_at'])
    user.add_to_password_history(user.password)
    cache.delete(cache_key)

    log_event('add_password_completed', user=user, request=request)
    return Response({'message': 'Password added. You can now sign in with your email and password, in addition to your existing sign-in method.'})
