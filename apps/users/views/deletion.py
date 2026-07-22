# apps/users/views/deletion.py
import uuid
from datetime import timedelta

from django.contrib.auth.hashers import check_password, make_password
from django.core.cache import cache
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from core.observability import log_event

from ..cookies import clear_auth_cookies
from ..emails import send_account_deletion_confirmed_email, send_account_deletion_otp_email
from ..models import Session
from .auth import _generate_otp, _generate_token, _mask_email


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def initiate_deletion(request):
    """Step 1: user enters their password. Sends a 6-digit OTP to confirm deletion intent."""
    user = request.user
    password = request.data.get('password', '')

    if user.is_oauth_only():
        return Response(
            {'error': 'Accounts linked via Google or Facebook cannot be deleted through LanceraOS. '
                      'Please revoke access from your provider account settings.'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if not password:
        return Response({'password': 'Password is required.'}, status=status.HTTP_400_BAD_REQUEST)
    if not user.check_password(password):
        return Response({'password': 'Incorrect password.'}, status=status.HTTP_400_BAD_REQUEST)

    key = f'deletion_req_{user.pk}'
    count = cache.get(key, 0)
    if count >= 3:
        return Response({'error': 'Too many deletion requests. Please try again in an hour.'}, status=status.HTTP_429_TOO_MANY_REQUESTS)
    cache.set(key, count + 1, timeout=3600)

    otp = _generate_otp()
    session_id = str(uuid.uuid4())
    cache.set(f'deletion_session_{session_id}', {
        'otp_hash': make_password(otp),
        'user_id': str(user.pk),
        'attempt_count': 0,
        'created_at': timezone.now().isoformat(),
    }, timeout=600)

    if not send_account_deletion_otp_email(user, otp):
        cache.delete(f'deletion_session_{session_id}')
        return Response(
            {'error': 'Failed to send verification email. Please try again shortly.'},
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )

    log_event('deletion_requested', user=user, request=request)

    return Response({
        'message': 'A 6-digit verification code has been sent to your email.',
        'session_id': session_id,
        'masked_email': _mask_email(user.email),
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def verify_deletion_otp(request):
    """Step 2: user enters the OTP. On success, issues a short-lived deletion_token for the review page."""
    session_id = request.data.get('session_id', '').strip()
    otp_code = request.data.get('otp_code', '').strip()

    if not session_id or not otp_code:
        return Response({'error': 'Session ID and code are required.'}, status=status.HTTP_400_BAD_REQUEST)

    cache_key = f'deletion_session_{session_id}'
    cached = cache.get(cache_key)
    if not cached:
        return Response({'error': 'Session expired. Please start the deletion process again.'}, status=status.HTTP_400_BAD_REQUEST)

    if cached['user_id'] != str(request.user.pk):
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

    deletion_token = _generate_token()
    cache.set(f'deletion_token_{deletion_token}', {'user_id': str(request.user.pk)}, timeout=600)

    log_event('deletion_otp_verified', user=request.user, request=request)

    scheduled_date = timezone.now() + timedelta(days=30)
    return Response({
        'deletion_token': deletion_token,
        'deletion_date': scheduled_date.isoformat(),
        'message': 'OTP verified. Please review the deletion information and confirm.',
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def confirm_deletion(request):
    """
    Step 3: user clicks "Confirm — Delete My Account" on the review page.
    Schedules deletion (30-day recovery window, actioned by the daily
    anonymize task) and revokes every session immediately.

    v1's docstring for this endpoint said it "logs out immediately," but
    its actual code never touched sessions or tokens at all — that gap
    is fixed here rather than carried forward, since leaving active
    sessions running on an account that's mid-deletion doesn't match
    the stated intent, and there's no reason a browser tab open at the
    moment of confirmation should keep working afterward.
    """
    deletion_token = request.data.get('deletion_token', '').strip()
    if not deletion_token:
        return Response({'error': 'Deletion token is required.'}, status=status.HTTP_400_BAD_REQUEST)

    token_key = f'deletion_token_{deletion_token}'
    cached = cache.get(token_key)
    if not cached or cached['user_id'] != str(request.user.pk):
        return Response(
            {'error': 'Invalid or expired confirmation. Please start the deletion process again.'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    cache.delete(token_key)

    user = request.user
    now = timezone.now()
    user.is_deleted = True
    user.deleted_at = now
    user.deletion_requested_at = now
    user.deletion_scheduled_at = now + timedelta(days=30)
    user.save(update_fields=['is_deleted', 'deleted_at', 'deletion_requested_at', 'deletion_scheduled_at'])

    Session.objects.filter(user=user).delete()

    send_account_deletion_confirmed_email(user)
    log_event('deletion_confirmed', user=user, request=request)

    response = Response({
        'message': 'Your account has been scheduled for permanent deletion.',
        'deletion_scheduled_at': user.deletion_scheduled_at.isoformat(),
    })
    clear_auth_cookies(response)
    return response


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def cancel_deletion(request):
    """
    Cancels a scheduled deletion. Reachable two ways: the deletion
    banner while still logged in (rare, since confirm_deletion just
    logged the device out), or — the realistic path — a fresh login
    after deletion was confirmed, which still succeeds and surfaces
    deletion_pending info in the response (see auth.login), from which
    the frontend offers this endpoint.
    """
    user = request.user
    if not user.is_deleted:
        return Response({'error': 'No pending deletion found.'}, status=status.HTTP_400_BAD_REQUEST)

    user.is_deleted = False
    user.deleted_at = None
    user.deletion_requested_at = None
    user.deletion_scheduled_at = None
    user.save(update_fields=['is_deleted', 'deleted_at', 'deletion_requested_at', 'deletion_scheduled_at'])

    log_event('deletion_cancelled', user=user, request=request)
    return Response({'message': 'Account deletion cancelled. Welcome back!'})