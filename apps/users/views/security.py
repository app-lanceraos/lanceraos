# apps/users/views/security.py
import hashlib
import hmac
import uuid
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.contrib.auth.hashers import check_password, make_password
from django.core.cache import cache
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.db import transaction
from django.utils import timezone
from django.utils.encoding import force_bytes, force_str
from django.utils.http import urlsafe_base64_decode, urlsafe_base64_encode
from rest_framework import status
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from core.observability import get_client_ip, get_user_agent, log_event

from ..authentication import enforce_csrf_standalone
from ..cookies import REFRESH_COOKIE_NAME, set_auth_cookies
from ..emails import (
    send_2fa_disable_otp_email,
    send_2fa_disabled_email,
    send_2fa_enabled_email,
    send_email_change_step1_email,
    send_email_change_step2_email,
    send_email_changed_notification_to_old,
    send_password_changed_email,
)
from ..models import EmailChangeRequest, FreelancerProfile, Session
from ..serializers import DISPOSABLE_DOMAINS, UserSerializer, validate_password_strength
from ..token_service import issue_tokens_and_session, rotate_session
from .auth import NO_AUTH, _generate_otp, _generate_token, _mask_email, send_password_reset_link

User = get_user_model()


def _find_current_session(request, user):
    raw_refresh = request.COOKIES.get(REFRESH_COOKIE_NAME)
    if not raw_refresh:
        return None
    session = Session.get_valid(raw_refresh)
    if session and session.user_id == user.pk:
        return session
    return None


def _encode_ecr_uid(ecr) -> str:
    return urlsafe_base64_encode(force_bytes(ecr.pk))


def _decode_ecr_uid(ecr_uid):
    try:
        ecr_id = force_str(urlsafe_base64_decode(ecr_uid))
        return EmailChangeRequest.objects.select_related('user').get(pk=ecr_id)
    except (TypeError, ValueError, ValidationError, EmailChangeRequest.DoesNotExist):
        return None


# ══════════════════════════════════════════════════════════════════
# CHANGE PASSWORD
# ══════════════════════════════════════════════════════════════════

@api_view(['POST'])
@permission_classes([IsAuthenticated])
def change_password(request):
    """
    Unlike reset_password (email-link flow, which invalidates ALL
    sessions since there's no proof of which device is "yours"), an
    authenticated in-app change keeps the CURRENT device's session alive
    and only invalidates every OTHER one — the person proved who they
    are by being logged in already.
    """
    user = request.user

    key = f'password_check_{request.user.pk}'
    count = cache.get(key, 0)
    if count >= 10:
        return Response({'error': 'Too many attempts. Please try again in an hour.'}, status=status.HTTP_429_TOO_MANY_REQUESTS)
    cache.set(key, count + 1, timeout=3600)

    old_password = request.data.get('old_password', '')
    new_password = request.data.get('new_password', '')

    if not old_password or not new_password:
        return Response({'error': 'Both old and new password are required.'}, status=status.HTTP_400_BAD_REQUEST)
    if not user.check_password(old_password):
        return Response({'error': 'Current password is incorrect.'}, status=status.HTTP_400_BAD_REQUEST)
    if old_password == new_password:
        return Response({'error': 'New password must be different from your current password.'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        validate_password_strength(new_password)
    except Exception as exc:
        detail = exc.detail if hasattr(exc, 'detail') else str(exc)
        return Response({'error': detail}, status=status.HTTP_400_BAD_REQUEST)

    if user.is_password_reused(new_password):
        return Response({'error': 'You cannot reuse one of your last 3 passwords.'}, status=status.HTTP_400_BAD_REQUEST)

    old_hash = user.password
    user.set_password(new_password)
    user.password_changed_at = timezone.now()
    user.save()
    user.add_to_password_history(old_hash)

    current_session = _find_current_session(request, user)
    others = Session.objects.filter(user=user)
    if current_session:
        others = others.exclude(pk=current_session.pk)
    others.delete()

    if current_session:
        access, refresh_str = rotate_session(user, current_session, request)
        days = max(1, (current_session.expires_at - current_session.created_at).days)
    else:
        # No current session found (e.g. the refresh cookie was missing) —
        # fall back to issuing a fresh one rather than leaving this device
        # logged in on now-invalidated tokens.
        access, refresh_str, new_session = issue_tokens_and_session(user, request, remember_me=False)
        days = 30

    send_password_changed_email(user)
    log_event('password_changed', user=user, request=request)

    response = Response({'message': 'Password changed successfully.', 'user': UserSerializer(user).data})
    set_auth_cookies(response, access, refresh_str, refresh_lifetime_days=days)
    return response


# ══════════════════════════════════════════════════════════════════
# REQUEST A PASSWORD-RESET LINK WHILE LOGGED IN — for someone who is
# signed in but has forgotten their password (so change_password, which
# needs the old one, is unusable). The second entry point into the SAME
# reset mechanism forgot_password uses (auth.send_password_reset_link):
# same token generator and email, completed at the same unauthenticated
# reset_password endpoint — which, unchanged, wipes every session including
# the one that requested it. Differs from forgot_password in dispatch mode
# ON PURPOSE: this one sends synchronously and reports a real failure (see
# send_password_reset_link's docstring for why each caller differs).
# ══════════════════════════════════════════════════════════════════

@api_view(['POST'])
@permission_classes([IsAuthenticated])
def request_password_reset(request):
    """
    Emails the authenticated user a password-reset link. No request body.

    Deliberately NOT gated on the current password (that's the whole
    point). Being signed in already proves control of a live session, and
    the link itself still only goes to the account's own inbox — so a
    hijacked session gains nothing it couldn't already do, and (as with
    add-password) actually completing the reset still requires that inbox.
    Unlike forgot_password's uniform-response design, an authenticated
    caller can be told plainly why a request is ineligible.
    """
    user = request.user

    if user.is_oauth_only():
        return Response(
            {'error': 'This account has no password to reset. Add a password from Settings > Security instead.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Confirmed reachable, not theoretical: login() refuses an unverified
    # account, but oauth.link_or_create_user() links a Google/Facebook
    # sign-in to an existing email-registered account WITHOUT flipping
    # is_email_verified, so that person holds a real session on an
    # unverified address. Mailing a reset link to an address that was
    # never confirmed doesn't make sense (forgot_password sends a
    # verification link in this situation instead, never a reset link).
    if not user.is_email_verified:
        return Response(
            {
                'error': 'Your email address has not been verified yet. Verify it first, then try again.',
                'email_not_verified': True,
            },
            status=status.HTTP_403_FORBIDDEN,
        )

    # Per-user (no IP/email dual limiting — the caller is authenticated),
    # same 3/hour shape as request_disable_2fa's and request_add_password's
    # own request caps. Counted only for eligible requests, like those two.
    key = f'password_reset_self_req_{user.pk}'
    count = cache.get(key, 0)
    if count >= 3:
        return Response({'error': 'Too many requests. Please try again in an hour.'}, status=status.HTTP_429_TOO_MANY_REQUESTS)
    cache.set(key, count + 1, timeout=3600)

    # Sent inline, not queued (synchronous=True): unlike forgot_password,
    # this caller is authenticated, so there is no timing oracle to defend
    # against — and a queued send here would report success while the
    # email sat undelivered (no worker running, worker down). A failed send
    # must be an error the person sees, never a "check your email".
    if not send_password_reset_link(user, request, trigger='settings_security', synchronous=True):
        return Response(
            {'error': 'Failed to send the reset email. Please try again shortly.'},
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )

    return Response({'message': 'A link to set a new password has been sent to your email.'})


# ══════════════════════════════════════════════════════════════════
# 2FA ENABLE (password-only — turning 2FA ON is security-increasing and
# doesn't need a second factor to gate it)
# ══════════════════════════════════════════════════════════════════

@api_view(['POST'])
@permission_classes([IsAuthenticated])
def toggle_2fa(request):
    """
    Handles action='enable' only. Disabling 2FA is a security-DECREASING
    action and requires a second factor beyond the password alone — see
    request_disable_2fa/disable_2fa_confirm below, which replace what used
    to be this view's 'disable' branch (removed rather than left as a
    silent bypass of the OTP requirement).
    """
    user = request.user

    key = f'password_check_{request.user.pk}'
    count = cache.get(key, 0)
    if count >= 10:
        return Response({'error': 'Too many attempts. Please try again in an hour.'}, status=status.HTTP_429_TOO_MANY_REQUESTS)
    cache.set(key, count + 1, timeout=3600)

    action = request.data.get('action', '')
    password = request.data.get('password', '')

    if user.is_oauth_only():
        return Response(
            {'error': 'Accounts linked via Google or Facebook manage 2FA through that provider.'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if not password:
        return Response({'error': 'Password is required.'}, status=status.HTTP_400_BAD_REQUEST)
    if not user.check_password(password):
        return Response({'error': 'Incorrect password.'}, status=status.HTTP_400_BAD_REQUEST)

    if action == 'enable':
        from core.observability import normalize_user_agent
        ip = get_client_ip(request)
        ua_normalized = normalize_user_agent(get_user_agent(request))
        user.two_fa_enabled = True
        user.save(update_fields=['two_fa_enabled'])
        send_2fa_enabled_email(user, ip, ua_normalized, timezone.now())
        log_event('2fa_enabled', user=user, request=request)
        return Response({'message': '2FA enabled.', 'two_fa_enabled': True, 'user': UserSerializer(user).data})

    return Response({'error': 'Invalid action.'}, status=status.HTTP_400_BAD_REQUEST)


# ══════════════════════════════════════════════════════════════════
# 2FA DISABLE — password -> OTP -> disable (mirrors the account-deletion
# password -> OTP -> confirm pattern in views/deletion.py; turning 2FA OFF
# removes the account's own protection, so a leaked/reused/shoulder-surfed
# password alone must not be sufficient to do it)
# ══════════════════════════════════════════════════════════════════

@api_view(['POST'])
@permission_classes([IsAuthenticated])
def request_disable_2fa(request):
    """Step 1: user enters their password. Sends a 6-digit OTP to confirm disabling 2FA."""
    user = request.user

    key = f'password_check_{user.pk}'
    count = cache.get(key, 0)
    if count >= 10:
        return Response({'error': 'Too many attempts. Please try again in an hour.'}, status=status.HTTP_429_TOO_MANY_REQUESTS)
    cache.set(key, count + 1, timeout=3600)

    password = request.data.get('password', '')

    if user.is_oauth_only():
        return Response(
            {'error': 'Accounts linked via Google or Facebook manage 2FA through that provider.'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if not user.two_fa_enabled:
        return Response({'error': 'Two-factor authentication is already disabled.'}, status=status.HTTP_400_BAD_REQUEST)
    if not password:
        return Response({'error': 'Password is required.'}, status=status.HTTP_400_BAD_REQUEST)
    if not user.check_password(password):
        return Response({'error': 'Incorrect password.'}, status=status.HTTP_400_BAD_REQUEST)

    req_key = f'2fa_disable_req_{user.pk}'
    req_count = cache.get(req_key, 0)
    if req_count >= 3:
        return Response({'error': 'Too many requests. Please try again in an hour.'}, status=status.HTTP_429_TOO_MANY_REQUESTS)
    cache.set(req_key, req_count + 1, timeout=3600)

    otp = _generate_otp()
    session_id = str(uuid.uuid4())
    cache.set(f'2fa_disable_session_{session_id}', {
        'otp_hash': make_password(otp),
        'user_id': str(user.pk),
        'attempt_count': 0,
        'created_at': timezone.now().isoformat(),
    }, timeout=600)

    if not send_2fa_disable_otp_email(user, otp):
        cache.delete(f'2fa_disable_session_{session_id}')
        return Response(
            {'error': 'Failed to send verification email. Please try again shortly.'},
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )

    log_event('2fa_disable_requested', user=user, request=request)

    return Response({
        'message': 'A 6-digit verification code has been sent to your email.',
        'session_id': session_id,
        'masked_email': _mask_email(user.email),
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def disable_2fa_confirm(request):
    """Step 2: user enters the OTP. On success, performs the exact same state change toggle_2fa's old disable branch did."""
    user = request.user
    session_id = request.data.get('session_id', '').strip()
    otp_code = request.data.get('otp_code', '').strip()

    if not session_id or not otp_code:
        return Response({'error': 'Session ID and code are required.'}, status=status.HTTP_400_BAD_REQUEST)

    cache_key = f'2fa_disable_session_{session_id}'
    cached = cache.get(cache_key)
    if not cached:
        return Response({'error': 'Session expired. Please start again.'}, status=status.HTTP_400_BAD_REQUEST)

    if cached['user_id'] != str(user.pk):
        return Response({'error': 'Invalid session.'}, status=status.HTTP_400_BAD_REQUEST)

    attempt_count = cached.get('attempt_count', 0)
    if attempt_count >= 5:
        cache.delete(cache_key)
        return Response({'error': 'Too many incorrect attempts. Please start again.'}, status=status.HTTP_400_BAD_REQUEST)

    if not check_password(otp_code, cached['otp_hash']):
        cached['attempt_count'] = attempt_count + 1
        cache.set(cache_key, cached, timeout=600)
        remaining = 5 - (attempt_count + 1)
        return Response({'error': f'Incorrect code. {remaining} attempt(s) remaining.'}, status=status.HTTP_400_BAD_REQUEST)

    cache.delete(cache_key)

    if not user.two_fa_enabled:
        # Already disabled — nothing left to do (e.g. a second tab already
        # completed this flow). Report the current, correct state rather
        # than re-sending the disabled email/audit event a second time.
        return Response({'message': '2FA disabled.', 'two_fa_enabled': False, 'user': UserSerializer(user).data})

    from core.observability import normalize_user_agent
    ip = get_client_ip(request)
    ua_normalized = normalize_user_agent(get_user_agent(request))

    user.two_fa_enabled = False
    user.two_fa_code = ''
    user.two_fa_code_expiry = None
    user.save(update_fields=['two_fa_enabled', 'two_fa_code', 'two_fa_code_expiry'])
    # Only revokes the 2FA-skip privilege, NOT device recognition itself
    # — TrustedDevice rows also drive the new-device-login email now
    # (see checklist items 1-2), so wiping them entirely here would
    # cause a burst of "new device" emails for already-known devices
    # on their next login, purely because 2FA was turned off.
    user.trusted_devices.update(skip_2fa=False)
    send_2fa_disabled_email(user, ip, ua_normalized, timezone.now())
    log_event('2fa_disabled', user=user, request=request)
    return Response({'message': '2FA disabled.', 'two_fa_enabled': False, 'user': UserSerializer(user).data})


# ══════════════════════════════════════════════════════════════════
# EMAIL CHANGE — 3-step flow (current inbox -> new email + password -> new inbox)
# ══════════════════════════════════════════════════════════════════

@api_view(['POST'])
@permission_classes([IsAuthenticated])
def request_email_change(request):
    """Step 1A: sends a confirmation link to the CURRENT email — proves ownership before anything else happens."""
    user = request.user

    if user.is_oauth_only():
        return Response(
            {'error': 'Accounts linked via Google or Facebook manage email through that provider.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        allowed, days_remaining = user.profile.can_change_email()
        if not allowed:
            return Response({
                'error': f'You can only change your email once every 3 months. '
                         f'You can request again in {days_remaining} day(s).',
                'days_remaining': days_remaining,
            }, status=status.HTTP_400_BAD_REQUEST)
    except FreelancerProfile.DoesNotExist:
        pass

    key = f'email_change_req_{user.pk}'
    count = cache.get(key, 0)
    if count >= 3:
        return Response({'error': 'Too many email change requests. Please try again in an hour.'}, status=status.HTTP_429_TOO_MANY_REQUESTS)
    cache.set(key, count + 1, timeout=3600)

    EmailChangeRequest.objects.filter(
        user=user, step__in=['step1_pending', 'step1_clicked', 'step2_pending'],
    ).update(step='cancelled')

    raw_token = _generate_token()
    token_hash = hashlib.sha256(raw_token.encode()).hexdigest()

    ecr = EmailChangeRequest.objects.create(
        user=user, step1_token=token_hash, step='step1_pending',
        step1_expires_at=timezone.now() + timedelta(hours=24),
    )

    uid = _encode_ecr_uid(ecr)
    send_email_change_step1_email(user, raw_token, uid)
    log_event('email_change_requested', user=user, request=request)

    user.pending_email_expires_at = timezone.now() + timedelta(hours=24)
    user.save(update_fields=['pending_email_expires_at'])

    return Response({
        'message': 'A verification link has been sent to your current email address. '
                   'Click it to continue. It expires in 24 hours.',
    })


@api_view(['GET'])
@authentication_classes(NO_AUTH)
@permission_classes([AllowAny])
def validate_email_change_token(request, ecr_uid, token):
    """Step 1B: frontend calls this on page load to decide whether to show the form or an error."""
    ecr = _decode_ecr_uid(ecr_uid)
    if ecr is None:
        return Response({'valid': False, 'error': 'Invalid link.'}, status=status.HTTP_400_BAD_REQUEST)

    token_hash = hashlib.sha256(token.encode()).hexdigest()
    if not hmac.compare_digest(ecr.step1_token, token_hash):
        return Response({'valid': False, 'error': 'Invalid link.'}, status=status.HTTP_400_BAD_REQUEST)
    if not ecr.is_step1_valid():
        return Response(
            {'valid': False, 'error': 'This link has expired. Please request a new email change from your profile.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    return Response({'valid': True, 'current_email': _mask_email(ecr.user.email), 'ecr_uid': ecr_uid})


@api_view(['POST'])
@authentication_classes(NO_AUTH)
@permission_classes([AllowAny])
def complete_email_change_step1(request, ecr_uid, token):
    """Step 1C: user submits the new email + current password. Sends the activation link to the NEW inbox."""
    enforce_csrf_standalone(request)
    ecr = _decode_ecr_uid(ecr_uid)
    if ecr is None:
        return Response({'error': 'Invalid link.'}, status=status.HTTP_400_BAD_REQUEST)

    key = f'email_change_complete_{ecr.pk}'
    count = cache.get(key, 0)
    if count >= 10:
        return Response({'error': 'Too many attempts. Please request a new email change.'}, status=status.HTTP_429_TOO_MANY_REQUESTS)
    cache.set(key, count + 1, timeout=3600)

    token_hash = hashlib.sha256(token.encode()).hexdigest()
    if not hmac.compare_digest(ecr.step1_token, token_hash) or not ecr.is_step1_valid():
        return Response(
            {'error': 'This link has expired. Please request a new email change from your profile.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    new_email = request.data.get('new_email', '').strip().lower()
    password = request.data.get('password', '')
    user = ecr.user

    new_email_invalid = False
    if new_email:
        try:
            validate_email(new_email)
        except ValidationError:
            new_email_invalid = True

    errors = {}
    if not new_email:
        errors['new_email'] = 'New email address is required.'
    elif new_email_invalid:
        errors['new_email'] = 'Enter a valid email address.'
    elif new_email == user.email:
        errors['new_email'] = 'New email must be different from your current email.'
    elif User.objects.filter(email=new_email).exclude(pk=user.pk).exists():
        errors['new_email'] = 'An account with this email already exists.'

    domain = new_email.split('@')[-1] if new_email else ''
    if domain in DISPOSABLE_DOMAINS:
        errors['new_email'] = 'Temporary email services are not allowed.'

    if not password:
        errors['password'] = 'Your current password is required.'
    elif not user.check_password(password):
        errors['password'] = 'Incorrect password.'

    if errors:
        return Response(errors, status=status.HTTP_400_BAD_REQUEST)

    raw_step2 = _generate_token()
    hash_step2 = hashlib.sha256(raw_step2.encode()).hexdigest()

    with transaction.atomic():
        ecr.new_email = new_email
        ecr.step2_token = hash_step2
        ecr.step = 'step2_pending'
        ecr.step2_expires_at = timezone.now() + timedelta(hours=24)
        ecr.save(update_fields=['new_email', 'step2_token', 'step', 'step2_expires_at'])

        user.pending_email = new_email
        user.pending_email_expires_at = ecr.step2_expires_at
        user.save(update_fields=['pending_email', 'pending_email_expires_at'])

    uid = _encode_ecr_uid(ecr)
    send_email_change_step2_email(user, raw_step2, uid, new_email)
    log_event('email_change_step1', user=user, request=request, metadata={'new_email': _mask_email(new_email)})

    return Response({
        'message': f'An activation link has been sent to {_mask_email(new_email)}. '
                   f'Click it to complete the email change. It expires in 24 hours.',
    })


@api_view(['POST'])
@authentication_classes(NO_AUTH)
@permission_classes([AllowAny])
def activate_new_email(request, ecr_uid, token):
    """Step 2: user clicks the activation link in the NEW inbox. Finalizes the change."""
    enforce_csrf_standalone(request)
    ecr = _decode_ecr_uid(ecr_uid)
    if ecr is None:
        return Response({'error': 'Invalid link.'}, status=status.HTTP_400_BAD_REQUEST)

    token_hash = hashlib.sha256(token.encode()).hexdigest()
    if not hmac.compare_digest(ecr.step2_token, token_hash) or not ecr.is_step2_valid():
        return Response(
            {'error': 'This activation link has expired. Please start the email change process again from your profile.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    user = ecr.user
    new_email = ecr.new_email

    # Final race-condition check: someone else may have taken this email
    # in the window between step 1 completing and this activation click.
    if User.objects.filter(email=new_email).exclude(pk=user.pk).exists():
        ecr.step = 'expired'
        ecr.save(update_fields=['step'])
        user.clear_pending_email()
        return Response(
            {'error': 'This email address was taken by another account. Please start the process again.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    old_email = user.email

    with transaction.atomic():
        user.email = new_email
        user.pending_email = ''
        user.pending_email_expires_at = None
        user.save(update_fields=['email', 'pending_email', 'pending_email_expires_at'])

        try:
            user.profile.last_email_changed_at = timezone.now()
            user.profile.save(update_fields=['last_email_changed_at'])
        except FreelancerProfile.DoesNotExist:
            pass

        ecr.step = 'completed'
        ecr.completed_at = timezone.now()
        ecr.save(update_fields=['step', 'completed_at'])

    send_email_changed_notification_to_old(user, old_email, new_email)
    log_event('email_change_done', user=user, request=request, metadata={
        'old_email': _mask_email(old_email), 'new_email': _mask_email(new_email),
    })

    return Response({
        'message': f'Your email has been changed to {new_email}. Please sign in with your new email address.',
        'new_email': new_email,
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def cancel_email_change(request):
    user = request.user
    EmailChangeRequest.objects.filter(
        user=user, step__in=['step1_pending', 'step1_clicked', 'step2_pending'],
    ).update(step='cancelled')
    user.clear_pending_email()
    log_event('email_change_cancelled', user=user, request=request)
    return Response({'message': 'Email change request cancelled.'})