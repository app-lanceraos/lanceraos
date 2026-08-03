# apps/admin_panel/views.py
import secrets
import uuid
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.contrib.auth.hashers import check_password, make_password
from django.core.cache import cache
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import ensure_csrf_cookie
from rest_framework import status
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.observability import get_client_ip, log_event

from apps.users.authentication import enforce_csrf_standalone
from apps.users.emails import send_2fa_code_email
from apps.users.serializers import UserSerializer

from .authentication import AdminCookieJWTAuthentication
from .constants import ADMIN_EMAIL_DOMAIN
from .cookies import ADMIN_REFRESH_COOKIE_NAME, clear_admin_auth_cookies, set_admin_auth_cookies
from .models import AdminSession
from .token_service import issue_admin_tokens_and_session, rotate_admin_session

User = get_user_model()
NO_AUTH = []

# Same timing-parity pattern as apps.users.views.auth — burns comparable
# Argon2 time on the "user not found" path so it can't be distinguished
# from "wrong password" via response timing.
_ADMIN_DUMMY_PASSWORD_HASH = make_password('admin-dummy-fixed-value-for-timing-parity')


def _generate_otp() -> str:
    return ''.join(str(secrets.randbelow(10)) for _ in range(6))


def _finalize_admin_login_response(user):
    return Response({'user': UserSerializer(user).data})


@method_decorator(ensure_csrf_cookie, name='dispatch')
class AdminCsrfView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        return Response({'message': 'CSRF cookie set.'})


@api_view(['POST'])
@authentication_classes(NO_AUTH)
@permission_classes([AllowAny])
def admin_login(request):
    """
    Step 1: email + password. Always requires 2FA — never issues tokens
    directly from this endpoint, only sends a code and returns a pending
    session_id, mirroring the regular login flow's exact shape.
    """
    enforce_csrf_standalone(request)
    ip = get_client_ip(request)
    rl_key = f'ratelimit_admin_login_{ip}'
    rl_count = cache.get(rl_key, 0)
    if rl_count >= 10:  # tighter than regular login's 20/hr — higher-privilege surface
        return Response(
            {'error': 'Too many login attempts from this location. Please try again later.'},
            status=status.HTTP_429_TOO_MANY_REQUESTS,
        )
    cache.set(rl_key, rl_count + 1, timeout=3600)

    email = request.data.get('email', '').strip().lower()
    password = request.data.get('password', '')
    if not email or not password:
        return Response({'error': 'Email and password are required.'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        user = User.objects.get(email=email)
    except User.DoesNotExist:
        check_password('irrelevant-value', _ADMIN_DUMMY_PASSWORD_HASH)
        log_event('admin_login_failed', request=request, metadata={'reason': 'user_not_found'})
        return Response({'error': 'Invalid credentials.'}, status=status.HTTP_401_UNAUTHORIZED)

    if not user.is_active:
        return Response({'error': 'This account is disabled.'}, status=status.HTTP_403_FORBIDDEN)

    if user.is_account_locked():
        return Response({'error': 'This account is temporarily locked. Try again later, or reset your password from the main app.'}, status=423)

    # Same generic message for "wrong password" and "not an admin
    # account" — a distinct message would let someone probe which
    # accounts have admin access, independent of the correct password.
    #
    # Deliberately does NOT call increment_failed_attempts() — that
    # counter is shared with the main app's regular login. Writing to
    # it here would mean a stranger who merely knows an admin's email
    # (no password needed) could deliberately fail admin login
    # repeatedly and lock that person out of their entire regular
    # account too, and vice versa. Admin login's real brute-force
    # defense is its own, separate, tighter IP rate limit above — an
    # existing lock (from either surface) is still correctly respected
    # by the is_account_locked() check above, this only stops NEW
    # admin-login failures from contributing to it.
    if (
        not user.check_password(password)
        or not user.can_access_admin_panel
        or not user.email.endswith(f'@{ADMIN_EMAIL_DOMAIN}')
    ):
        log_event('admin_login_failed', user=user, request=request)
        return Response({'error': 'Invalid credentials.'}, status=status.HTTP_401_UNAUTHORIZED)

    if not user.two_fa_enabled:
        return Response({
            'error': 'Two-factor authentication must be enabled before you can access the admin panel. Enable it from your account Settings in the main app, then try again.',
        }, status=status.HTTP_403_FORBIDDEN)

    user.reset_failed_login()

    otp = _generate_otp()
    session_id = str(uuid.uuid4())
    cache.set(f'admin_2fa_session_{session_id}', {
        'otp_hash': make_password(otp),
        'expiry': (timezone.now() + timedelta(minutes=10)).isoformat(),
        'user_id': str(user.pk),
        'attempt_count': 0,
    }, timeout=700)

    if not send_2fa_code_email(user, otp):
        cache.delete(f'admin_2fa_session_{session_id}')
        return Response({'error': 'Failed to send verification code. Please try again.'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

    log_event('admin_login_2fa_required', user=user, request=request)
    return Response({
        'requires_2fa': True,
        'session_id': session_id,
        'message': 'A verification code has been sent to your email.',
    })


@api_view(['POST'])
@authentication_classes(NO_AUTH)
@permission_classes([AllowAny])
def admin_verify_2fa(request):
    enforce_csrf_standalone(request)
    session_id = request.data.get('session_id', '').strip()
    code = request.data.get('code', '').strip()
    if not session_id or not code:
        return Response({'error': 'Session ID and code are required.'}, status=status.HTTP_400_BAD_REQUEST)

    cache_key = f'admin_2fa_session_{session_id}'
    cached = cache.get(cache_key)
    if not cached:
        return Response({'error': 'This verification session has expired. Please sign in again.'}, status=status.HTTP_400_BAD_REQUEST)

    if timezone.now() > timezone.datetime.fromisoformat(cached['expiry']):
        cache.delete(cache_key)
        return Response({'error': 'This code has expired. Please sign in again.'}, status=status.HTTP_400_BAD_REQUEST)

    if not check_password(code, cached['otp_hash']):
        cached['attempt_count'] += 1
        if cached['attempt_count'] >= 5:
            cache.delete(cache_key)
            return Response({'error': 'Too many incorrect attempts. Please sign in again.'}, status=status.HTTP_400_BAD_REQUEST)
        cache.set(cache_key, cached, timeout=700)
        return Response({'error': 'Incorrect code.'}, status=status.HTTP_400_BAD_REQUEST)

    cache.delete(cache_key)
    try:
        user = User.objects.get(pk=cached['user_id'])
    except User.DoesNotExist:
        return Response({'error': 'Account not found.'}, status=status.HTTP_404_NOT_FOUND)

    if not user.can_access_admin_panel:
        return Response({'error': 'Admin access has been revoked for this account.'}, status=status.HTTP_403_FORBIDDEN)

    access, refresh_str, admin_session = issue_admin_tokens_and_session(user, request)
    log_event('admin_login_success', user=user, request=request)
    response = _finalize_admin_login_response(user)
    set_admin_auth_cookies(response, access, refresh_str, refresh_lifetime_days=1)
    return response


@api_view(['POST'])
@authentication_classes([AdminCookieJWTAuthentication])
@permission_classes([IsAuthenticated])
def admin_logout(request):
    raw_refresh = request.COOKIES.get(ADMIN_REFRESH_COOKIE_NAME)
    if raw_refresh:
        admin_session = AdminSession.get_valid(raw_refresh)
        if admin_session:
            admin_session.delete()
    log_event('admin_logout', user=request.user, request=request)
    response = Response({'message': 'Logged out.'})
    clear_admin_auth_cookies(response)
    return response


@api_view(['POST'])
@authentication_classes(NO_AUTH)
@permission_classes([AllowAny])
def admin_refresh(request):
    enforce_csrf_standalone(request)
    raw_refresh = request.COOKIES.get(ADMIN_REFRESH_COOKIE_NAME)
    if not raw_refresh:
        return Response({'error': 'No refresh token.'}, status=status.HTTP_401_UNAUTHORIZED)

    admin_session = AdminSession.get_valid(raw_refresh)
    if not admin_session:
        return Response({'error': 'Session expired or invalid.'}, status=status.HTTP_401_UNAUTHORIZED)

    user = admin_session.user
    if not user.can_access_admin_panel:
        admin_session.delete()
        return Response({'error': 'Admin access has been revoked.'}, status=status.HTTP_403_FORBIDDEN)

    access, refresh_str = rotate_admin_session(user, admin_session, request)
    response = Response({'message': 'Refreshed.'})
    set_admin_auth_cookies(response, access, refresh_str, refresh_lifetime_days=1)
    return response


@api_view(['GET'])
@authentication_classes([AdminCookieJWTAuthentication])
@permission_classes([IsAuthenticated])
def admin_me(request):
    """Mirrors apps.users' /me/ — lets the future admin frontend check
    'am I currently logged in' the same way the main app does."""
    return Response(UserSerializer(request.user).data)
