# apps/users/views/auth.py
import secrets
import uuid
from datetime import datetime, timedelta

from django.contrib.auth import get_user_model
from django.contrib.auth.hashers import check_password, make_password
from django.core.cache import cache
from django.db import transaction
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework_simplejwt.exceptions import TokenError

from core.observability import get_client_ip, get_user_agent, log_event

from ..cookies import (
    ACCESS_COOKIE_NAME,
    REFRESH_COOKIE_NAME,
    TRUSTED_DEVICE_COOKIE_NAME,
    clear_auth_cookies,
    clear_trusted_device_cookie,
    set_auth_cookies,
    set_trusted_device_cookie,
)
from ..emails import (
    send_2fa_code_email,
    send_account_locked_email,
    send_new_device_login_email,
    send_password_changed_email,
    send_password_reset_email,
    send_verification_email,
    send_welcome_email,
)
from ..models import Session, TrustedDevice
from ..serializers import (
    DISPOSABLE_DOMAINS,
    RESERVED_USERNAMES,
    RegisterSerializer,
    UserSerializer,
    validate_password_strength,
)
from ..token_service import issue_tokens_and_session, rotate_session
from ..tokens import decode_uid, email_verification_token, encode_uid, password_reset_token

User = get_user_model()

# These public endpoints must not depend on (or be blocked by) whatever
# is currently sitting in the access-token cookie — in particular,
# refresh() exists specifically for the case where that cookie has
# EXPIRED, and DRF's default authentication step raises on an expired/
# invalid token even under AllowAny (permission classes only gate what
# happens *after* authentication succeeds or cleanly returns None).
# Disabling authentication entirely on these views means a stale cookie
# can never block them; each view validates whatever credentials it
# actually needs from scratch.
NO_AUTH = []


@api_view(['GET'])
@authentication_classes(NO_AUTH)
@permission_classes([AllowAny])
def get_csrf_token(request):
    """
    Forces Django's CsrfViewMiddleware to send the csrftoken cookie.
    The frontend calls this once, lazily, before its first
    state-changing request — see lib/api.js's ensureCsrfCookie().
    """
    from django.middleware.csrf import get_token
    get_token(request)
    return Response({'detail': 'CSRF cookie set'})


# ══════════════════════════════════════════════════════════════════
# HELPERS
# ══════════════════════════════════════════════════════════════════

def _generate_otp() -> str:
    return ''.join(str(secrets.randbelow(10)) for _ in range(6))


def _generate_token() -> str:
    return secrets.token_urlsafe(48)


def _mask_email(email: str) -> str:
    try:
        local, domain = email.split('@')
        return f'{local[:2]}{"*" * max(2, len(local) - 2)}@{domain}'
    except ValueError:
        return email


def _format_lockout_time(dt) -> str:
    return dt.strftime('%I:%M %p on %B %d, %Y').lstrip('0')


def _check_trusted_device(user, request) -> bool:
    raw_token = request.COOKIES.get(TRUSTED_DEVICE_COOKIE_NAME, '')
    if not raw_token:
        return False
    device = TrustedDevice.get_valid(raw_token, user)
    if device:
        device.last_used_at = timezone.now()
        device.save(update_fields=['last_used_at'])
        return True
    return False


def _update_last_login(user, request):
    """Updates last_login fields; emails the user if this looks like a new device."""
    from core.observability import normalize_user_agent
    ip = get_client_ip(request)
    ua = get_user_agent(request)
    ua_normalized = normalize_user_agent(ua)

    is_new_device = (
        user.last_login is not None
        and (user.last_login_ip != ip or user.last_login_device != ua_normalized)
    )
    if is_new_device:
        send_new_device_login_email(user, ip, ua, timezone.now())

    user.last_login = timezone.now()
    user.last_login_ip = ip
    user.last_login_device = ua_normalized
    user.save(update_fields=['last_login', 'last_login_ip', 'last_login_device'])


def _check_registration_rate_limit(request) -> bool:
    """True if this IP has hit the registration rate limit (10/hour)."""
    ip = get_client_ip(request)
    key = f'reg_attempts_{ip}'
    count = cache.get(key, 0)
    if count >= 10:
        return True
    cache.set(key, count + 1, timeout=3600)
    return False


def _finalize_login_response(user, access, refresh_str, days, extra=None):
    """
    Builds the login/2FA-verify response body and attaches cookies.
    Never includes the raw access/refresh strings in the JSON body —
    they only ever travel as httpOnly cookies.
    """
    data = {'user': UserSerializer(user).data}
    if user.is_deleted and user.deletion_scheduled_at:
        data['deletion_pending'] = True
        data['deletion_requested_at'] = (
            user.deletion_requested_at.isoformat() if user.deletion_requested_at else None
        )
        data['deletion_scheduled_at'] = user.deletion_scheduled_at.isoformat()
    if extra:
        data.update(extra)

    response = Response(data)
    set_auth_cookies(response, access, refresh_str, refresh_lifetime_days=days)
    return response


# ══════════════════════════════════════════════════════════════════
# REGISTRATION
# ══════════════════════════════════════════════════════════════════

@api_view(['POST'])
@authentication_classes(NO_AUTH)
@permission_classes([AllowAny])
def register(request):
    """Creates an account and sends a verification email. Does not log the user in."""
    if _check_registration_rate_limit(request):
        log_event('registration_failed', request=request, metadata={'reason': 'rate_limited'})
        return Response(
            {'error': 'Too many registration attempts. Please try again in an hour.'},
            status=status.HTTP_429_TOO_MANY_REQUESTS,
        )

    serializer = RegisterSerializer(data=request.data)
    if not serializer.is_valid():
        log_event('registration_failed', request=request, metadata={
            'email': request.data.get('email', ''),
            'errors': serializer.errors,
        })
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    try:
        with transaction.atomic():
            user = serializer.save()
        uid = encode_uid(user)
        token = email_verification_token.make_token(user)
        send_verification_email(user, token, uid)
        log_event('registered', user=user, request=request)
    except Exception:
        log_event('registration_failed', request=request, metadata={
            'email': request.data.get('email', ''), 'reason': 'unexpected_error',
        })
        return Response(
            {'error': 'Registration failed. Please try again.'},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    return Response({
        'message': 'Account created. Please check your email to verify your account.',
        'email': user.email,
    }, status=status.HTTP_201_CREATED)


@api_view(['POST'])
@authentication_classes(NO_AUTH)
@permission_classes([AllowAny])
def check_availability(request):
    """Live email/username availability check used during the registration wizard."""
    ip = get_client_ip(request)
    key = f'avail_check_{ip}'
    count = cache.get(key, 0)
    if count >= 60:
        return Response({'error': 'Too many requests.'}, status=status.HTTP_429_TOO_MANY_REQUESTS)
    cache.set(key, count + 1, timeout=60)

    field = request.data.get('field', '').strip().lower()
    value = request.data.get('value', '').strip().lower()
    if field not in ('email', 'username'):
        return Response({'error': 'Field must be email or username.'}, status=status.HTTP_400_BAD_REQUEST)
    if not value:
        return Response({'error': 'Value is required.'}, status=status.HTTP_400_BAD_REQUEST)

    if field == 'email':
        import re
        if not re.match(r'^\S+@\S+\.\S+$', value):
            return Response({'field': 'email', 'available': None, 'error': 'Invalid email format'})
        domain = value.split('@')[-1]
        if domain in DISPOSABLE_DOMAINS:
            return Response({'field': 'email', 'available': False, 'error': 'Temporary email services are not allowed.'})
        return Response({'field': 'email', 'available': not User.objects.filter(email=value).exists()})

    import re
    if not re.match(r'^[a-zA-Z0-9_]{3,30}$', value):
        return Response({'field': 'username', 'available': None, 'error': 'Invalid username format'})
    if value in RESERVED_USERNAMES:
        return Response({'field': 'username', 'available': False})
    return Response({'field': 'username', 'available': not User.objects.filter(username=value).exists()})


# ══════════════════════════════════════════════════════════════════
# LOGIN
# ══════════════════════════════════════════════════════════════════

@api_view(['POST'])
@authentication_classes(NO_AUTH)
@permission_classes([AllowAny])
def login(request):
    ip = get_client_ip(request)
    ua = get_user_agent(request)
    login_input = request.data.get('login', '').strip().lower()
    password = request.data.get('password', '')
    remember_me = bool(request.data.get('remember_me', False))

    if not login_input or not password:
        return Response({'error': 'Email/username and password are required.'}, status=status.HTTP_400_BAD_REQUEST)

    rl_key = f'ratelimit_login_{ip}'
    rl_count = cache.get(rl_key, 0)
    if rl_count >= 20:
        return Response(
            {'error': 'Too many login attempts from this location. Please try again later.'},
            status=status.HTTP_429_TOO_MANY_REQUESTS,
        )
    cache.set(rl_key, rl_count + 1, timeout=3600)

    try:
        user = User.objects.get(email=login_input) if '@' in login_input else User.objects.get(username=login_input)
    except User.DoesNotExist:
        log_event('login_failed', request=request, metadata={'reason': 'user_not_found'})
        return Response(
            {'error': 'Invalid credentials. Please check your email or username and password.'},
            status=status.HTTP_401_UNAUTHORIZED,
        )

    if not user.is_active:
        return Response({'error': 'Your account has been disabled. Please contact support.'}, status=status.HTTP_403_FORBIDDEN)

    if not user.is_email_verified:
        uid = encode_uid(user)
        token = email_verification_token.make_token(user)
        send_verification_email(user, token, uid)
        return Response({
            'error': 'Your email address is not verified. We have sent a new verification link to your inbox.',
            'email_not_verified': True,
            'email': user.email,
        }, status=status.HTTP_403_FORBIDDEN)

    if user.is_account_locked():
        unlock_str = _format_lockout_time(user.account_locked_until)
        log_event('login_locked', user=user, request=request)
        return Response({
            'error': f'Your account is locked until {unlock_str}. Reset your password to unlock it immediately.',
            'locked': True,
            'locked_until': user.account_locked_until.isoformat(),
        }, status=423)

    if not user.check_password(password):
        result = user.increment_failed_attempts()
        log_event('login_failed', user=user, request=request, metadata={'attempts': user.failed_login_attempts})
        if result['should_send_lockout_email']:
            send_account_locked_email(user, user.get_lockout_duration())
            log_event('account_locked', user=user, request=request)
        if result['locked']:
            unlock_str = _format_lockout_time(user.account_locked_until)
            return Response({
                'error': f'Your account is locked until {unlock_str}. Reset your password to unlock it immediately.',
                'locked': True,
                'locked_until': user.account_locked_until.isoformat(),
            }, status=423)
        if result['attempts_remaining'] <= 2:
            return Response({
                'error': f'Warning: {result["attempts_remaining"]} attempt(s) remaining before lockout.',
                'warning': True,
                'attempts_remaining': result['attempts_remaining'],
            }, status=status.HTTP_401_UNAUTHORIZED)
        return Response(
            {'error': 'Invalid credentials. Please check your email or username and password.'},
            status=status.HTTP_401_UNAUTHORIZED,
        )

    user.reset_failed_login()

    # ── 2FA ─────────────────────────────────────────────────────
    if user.two_fa_enabled and not _check_trusted_device(user, request):
        otp = _generate_otp()
        session_id = str(uuid.uuid4())
        expiry = timezone.now() + timedelta(minutes=10)
        cache.set(f'2fa_session_{session_id}', {
            'otp_hash': make_password(otp),
            'expiry': expiry.isoformat(),
            'user_id': str(user.pk),
            'attempt_count': 0,
            'remember_me': remember_me,
            'last_sent': timezone.now().isoformat(),
        }, timeout=700)

        if not send_2fa_code_email(user, otp):
            cache.delete(f'2fa_session_{session_id}')
            return Response(
                {'error': 'Failed to send verification code. Please try again.'},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        log_event('login_2fa_required', user=user, request=request)
        return Response({
            'requires_2fa': True,
            'session_id': session_id,
            'masked_email': _mask_email(user.email),
            'message': 'A verification code has been sent to your email.',
        })

    # ── Issue tokens ────────────────────────────────────────────
    _update_last_login(user, request)
    log_event('login_success', user=user, request=request)
    access, refresh_str, session = issue_tokens_and_session(user, request, remember_me=remember_me)
    days = 90 if remember_me else 30
    return _finalize_login_response(user, access, refresh_str, days)


# ══════════════════════════════════════════════════════════════════
# LOGOUT
# ══════════════════════════════════════════════════════════════════

@api_view(['POST'])
@permission_classes([IsAuthenticated])
def logout(request):
    """Revokes the current session (deletes its Session row) and clears cookies."""
    raw_refresh = request.COOKIES.get(REFRESH_COOKIE_NAME)
    if raw_refresh:
        session = Session.get_valid(raw_refresh)
        if session:
            session.delete()

    log_event('logout', user=request.user, request=request)
    response = Response({'message': 'Logged out successfully.'})
    clear_auth_cookies(response)
    return response


# ══════════════════════════════════════════════════════════════════
# REFRESH
# ══════════════════════════════════════════════════════════════════

@api_view(['POST'])
@authentication_classes(NO_AUTH)
@permission_classes([AllowAny])
def refresh(request):
    """
    Rotates the access/refresh pair using the refresh cookie. Must work
    even when the access-token cookie has expired (that's the whole
    point) — see the NO_AUTH note at the top of this file for why
    authentication is disabled on this view specifically.
    """
    raw_refresh = request.COOKIES.get(REFRESH_COOKIE_NAME)
    if not raw_refresh:
        response = Response({'error': 'No refresh token found.'}, status=status.HTTP_401_UNAUTHORIZED)
        clear_auth_cookies(response)
        return response

    session = Session.get_valid(raw_refresh)
    if not session:
        response = Response({'error': 'Session expired or revoked. Please sign in again.'}, status=status.HTTP_401_UNAUTHORIZED)
        clear_auth_cookies(response)
        return response

    try:
        from rest_framework_simplejwt.tokens import RefreshToken
        validated = RefreshToken(raw_refresh)
    except TokenError:
        session.delete()
        response = Response({'error': 'Invalid refresh token. Please sign in again.'}, status=status.HTTP_401_UNAUTHORIZED)
        clear_auth_cookies(response)
        return response

    try:
        user = User.objects.get(pk=validated['user_id'])
    except User.DoesNotExist:
        session.delete()
        response = Response({'error': 'Account no longer exists.'}, status=status.HTTP_401_UNAUTHORIZED)
        clear_auth_cookies(response)
        return response

    if not user.is_active:
        session.delete()
        response = Response({'error': 'Your account has been disabled.'}, status=status.HTTP_403_FORBIDDEN)
        clear_auth_cookies(response)
        return response

    # pca check — same invalidation rule as CookieJWTAuthentication, applied
    # here too since this path never goes through that authentication class.
    pca_claim = validated.get('pca')
    if pca_claim is not None and user.password_changed_at is not None:
        if int(pca_claim) < int(user.password_changed_at.timestamp()):
            session.delete()
            response = Response(
                {'error': 'Session invalidated by a password change. Please sign in again.'},
                status=status.HTTP_401_UNAUTHORIZED,
            )
            clear_auth_cookies(response)
            return response

    access, new_refresh_str = rotate_session(user, session, request)
    days = max(1, (session.expires_at - session.created_at).days)
    response = Response({'message': 'Token refreshed.'})
    set_auth_cookies(response, access, new_refresh_str, refresh_lifetime_days=days)
    return response


# ══════════════════════════════════════════════════════════════════
# 2FA VERIFY / RESEND
# ══════════════════════════════════════════════════════════════════

@api_view(['POST'])
@authentication_classes(NO_AUTH)
@permission_classes([AllowAny])
def verify_2fa(request):
    session_id = request.data.get('session_id', '').strip()
    otp_code = request.data.get('otp_code', '').strip()
    trust_device = bool(request.data.get('trust_device', False))

    if not session_id or not otp_code:
        return Response({'error': 'Session ID and verification code are required.'}, status=status.HTTP_400_BAD_REQUEST)

    cache_key = f'2fa_session_{session_id}'
    cached = cache.get(cache_key)
    if not cached:
        return Response({'error': 'Your verification session has expired. Please log in again.'}, status=status.HTTP_400_BAD_REQUEST)

    attempt_count = cached.get('attempt_count', 0)
    if attempt_count >= 5:
        cache.delete(cache_key)
        return Response({'error': 'Too many incorrect attempts. Please log in again.'}, status=status.HTTP_400_BAD_REQUEST)

    expiry = datetime.fromisoformat(cached['expiry'])
    if timezone.now() > expiry:
        cache.delete(cache_key)
        return Response({'error': 'Your verification code has expired. Please log in again.'}, status=status.HTTP_400_BAD_REQUEST)

    if not check_password(otp_code, cached['otp_hash']):
        cached['attempt_count'] = attempt_count + 1
        cache.set(cache_key, cached, timeout=700)
        remaining = 5 - (attempt_count + 1)
        return Response({'error': f'Incorrect code. {remaining} attempt(s) remaining.'}, status=status.HTTP_400_BAD_REQUEST)

    cache.delete(cache_key)

    try:
        user = User.objects.get(pk=cached['user_id'])
    except User.DoesNotExist:
        return Response({'error': 'Account not found. Please log in again.'}, status=status.HTTP_400_BAD_REQUEST)

    remember_me = cached.get('remember_me', False)
    _update_last_login(user, request)
    log_event('2fa_verified', user=user, request=request)

    access, refresh_str, session = issue_tokens_and_session(user, request, remember_me=remember_me)
    days = 90 if remember_me else 30

    extra = {}
    response = _finalize_login_response(user, access, refresh_str, days, extra=extra)

    if trust_device:
        raw_token = _generate_token()
        from core.observability import normalize_user_agent
        TrustedDevice.create_for_user(
            user=user, raw_token=raw_token,
            device_name=normalize_user_agent(get_user_agent(request)),
            ip_address=get_client_ip(request),
        )
        set_trusted_device_cookie(response, raw_token)
        log_event('trusted_device_added', user=user, request=request)

    return response


@api_view(['POST'])
@authentication_classes(NO_AUTH)
@permission_classes([AllowAny])
def resend_2fa(request):
    session_id = request.data.get('session_id', '').strip()
    if not session_id:
        return Response({'error': 'Session ID is required.'}, status=status.HTTP_400_BAD_REQUEST)

    cache_key = f'2fa_session_{session_id}'
    cached = cache.get(cache_key)
    if not cached:
        return Response({'error': 'Your verification session has expired. Please log in again.'}, status=status.HTTP_400_BAD_REQUEST)

    last_sent = cached.get('last_sent')
    if last_sent:
        ls_dt = datetime.fromisoformat(last_sent)
        elapsed = (timezone.now() - ls_dt).total_seconds()
        if elapsed < 60:
            wait = int(60 - elapsed)
            return Response(
                {'error': f'Please wait {wait} second(s) before requesting a new code.'},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

    try:
        user = User.objects.get(pk=cached['user_id'])
    except User.DoesNotExist:
        return Response({'error': 'Account not found. Please log in again.'}, status=status.HTTP_400_BAD_REQUEST)

    otp = _generate_otp()
    expiry = timezone.now() + timedelta(minutes=10)
    cached.update({
        'otp_hash': make_password(otp),
        'expiry': expiry.isoformat(),
        'attempt_count': 0,
        'last_sent': timezone.now().isoformat(),
    })
    cache.set(cache_key, cached, timeout=700)

    if not send_2fa_code_email(user, otp):
        return Response({'error': 'Failed to send verification code. Please try again.'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

    return Response({'message': 'A new code has been sent to your email.'})


# ══════════════════════════════════════════════════════════════════
# EMAIL VERIFICATION
# ══════════════════════════════════════════════════════════════════

@api_view(['GET'])
@authentication_classes(NO_AUTH)
@permission_classes([AllowAny])
def verify_email(request, uid, token):
    user = decode_uid(uid)
    if user is None:
        return Response({'error': 'Invalid verification link.'}, status=status.HTTP_400_BAD_REQUEST)

    if user.is_email_verified:
        return Response({'message': 'Email already verified.', 'already_verified': True})

    if not email_verification_token.check_token(user, token):
        return Response({'error': 'Verification link has expired. Please request a new one.'}, status=status.HTTP_400_BAD_REQUEST)

    user.is_email_verified = True
    user.is_active = True
    user.save(update_fields=['is_email_verified', 'is_active'])
    send_welcome_email(user)
    log_event('email_verified', user=user, request=request)
    return Response({'message': 'Email verified successfully. You can now sign in.'})


@api_view(['POST'])
@authentication_classes(NO_AUTH)
@permission_classes([AllowAny])
def resend_verification(request):
    email = request.data.get('email', '').strip().lower()
    if not email:
        return Response({'error': 'Email is required.'}, status=status.HTTP_400_BAD_REQUEST)

    key = f'resend_verify_{email}'
    count = cache.get(key, 0)
    if count >= 3:
        return Response({'error': 'Too many resend requests. Please try again in an hour.'}, status=status.HTTP_429_TOO_MANY_REQUESTS)
    cache.set(key, count + 1, timeout=3600)

    try:
        user = User.objects.get(email=email)
        if not user.is_email_verified:
            uid = encode_uid(user)
            token = email_verification_token.make_token(user)
            send_verification_email(user, token, uid)
            log_event('resend_verification', user=user, request=request)
    except User.DoesNotExist:
        pass  # Never reveal whether an email exists.

    return Response({'message': 'If this email exists and is unverified, a new link has been sent.'})


# ══════════════════════════════════════════════════════════════════
# PASSWORD RESET
# ══════════════════════════════════════════════════════════════════

@api_view(['POST'])
@authentication_classes(NO_AUTH)
@permission_classes([AllowAny])
def forgot_password(request):
    email = request.data.get('email', '').strip().lower()
    if not email:
        return Response({'error': 'Email is required.'}, status=status.HTTP_400_BAD_REQUEST)

    ip = get_client_ip(request)
    key = f'forgot_pw_{ip}'
    count = cache.get(key, 0)
    if count >= 5:
        return Response({'error': 'Too many requests. Please try again later.'}, status=status.HTTP_429_TOO_MANY_REQUESTS)
    cache.set(key, count + 1, timeout=3600)

    try:
        user = User.objects.get(email=email)
        if user.is_oauth_only():
            pass  # Don't reveal this — send nothing, stay on the generic response.
        elif not user.is_email_verified:
            uid = encode_uid(user)
            token = email_verification_token.make_token(user)
            send_verification_email(user, token, uid)
        else:
            uid = encode_uid(user)
            token = password_reset_token.make_token(user)
            send_password_reset_email(user, token, uid)
            log_event('password_reset_request', user=user, request=request)
    except User.DoesNotExist:
        pass  # Always 200 — never reveal whether an email exists.

    return Response({'message': 'If an account with this email exists, you will receive an email shortly.'})


@api_view(['POST'])
@authentication_classes(NO_AUTH)
@permission_classes([AllowAny])
def reset_password(request, uid, token):
    new_password = request.data.get('new_password', '')
    confirm_password = request.data.get('confirm_password', '')

    if not new_password or not confirm_password:
        return Response({'error': 'Both password fields are required.'}, status=status.HTTP_400_BAD_REQUEST)
    if new_password != confirm_password:
        return Response({'error': 'Passwords do not match.'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        validate_password_strength(new_password)
    except Exception as exc:
        detail = exc.detail if hasattr(exc, 'detail') else str(exc)
        return Response({'error': detail}, status=status.HTTP_400_BAD_REQUEST)

    user = decode_uid(uid)
    if user is None:
        return Response({'error': 'Invalid reset link.'}, status=status.HTTP_400_BAD_REQUEST)

    if not password_reset_token.check_token(user, token):
        return Response(
            {'error': 'This reset link has expired or already been used. Please request a new one.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if user.is_password_reused(new_password):
        return Response({'error': 'You cannot reuse one of your last 3 passwords.'}, status=status.HTTP_400_BAD_REQUEST)

    old_hash = user.password
    user.set_password(new_password)
    user.account_locked_until = None
    user.failed_login_attempts = 0
    user.password_changed_at = timezone.now()
    user.save()
    user.add_to_password_history(old_hash)

    # Password reset via email link invalidates every existing session —
    # unlike an in-app change_password (security.py, later), the person
    # resetting isn't proven to be on a device they're already signed
    # into, so there's no "current device" to keep alive.
    Session.objects.filter(user=user).delete()

    send_password_changed_email(user)
    log_event('password_reset_done', user=user, request=request)

    return Response({'message': 'Password reset successfully. You can now sign in with your new password.'})