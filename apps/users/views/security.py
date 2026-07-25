# apps/users/views/security.py
import hashlib
import hmac
from datetime import timedelta

from django.contrib.auth import get_user_model
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

from core.observability import log_event

from ..authentication import enforce_csrf_standalone
from ..cookies import REFRESH_COOKIE_NAME, set_auth_cookies
from ..emails import (
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
from .auth import NO_AUTH, _generate_token, _mask_email

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
# 2FA ENABLE / DISABLE
# ══════════════════════════════════════════════════════════════════

@api_view(['POST'])
@permission_classes([IsAuthenticated])
def toggle_2fa(request):
    user = request.user
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
        user.two_fa_enabled = True
        user.save(update_fields=['two_fa_enabled'])
        send_2fa_enabled_email(user)
        log_event('2fa_enabled', user=user, request=request)
        return Response({'message': '2FA enabled.', 'two_fa_enabled': True, 'user': UserSerializer(user).data})

    if action == 'disable':
        user.two_fa_enabled = False
        user.two_fa_code = ''
        user.two_fa_code_expiry = None
        user.save(update_fields=['two_fa_enabled', 'two_fa_code', 'two_fa_code_expiry'])
        user.trusted_devices.all().delete()
        send_2fa_disabled_email(user)
        log_event('2fa_disabled', user=user, request=request)
        return Response({'message': '2FA disabled.', 'two_fa_enabled': False, 'user': UserSerializer(user).data})

    return Response({'error': 'Invalid action.'}, status=status.HTTP_400_BAD_REQUEST)


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