# apps/admin_panel/views_users.py
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.db.models import Q
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from core.observability import log_event

from apps.users.models import Session
from apps.users.serializers import SessionSerializer
from apps.users.tasks import send_verification_email_task
from apps.users.tokens import email_verification_token, encode_uid

from .authentication import AdminCookieJWTAuthentication
from .constants import ADMIN_EMAIL_DOMAIN
from .models import AdminSession
from .permissions import IsSuperAdmin

User = get_user_model()


def _admin_action_rate_limited(action, actor):
    """
    Per-admin, per-action cache-based limit for consequential admin
    actions capable of fast, wide, hard-to-reverse damage if an admin
    session is ever compromised (suspend/reactivate/grant/revoke).
    Mirrors admin_login's IP-keyed pattern, keyed on the acting admin's
    user ID instead — generous enough for real usage, tight enough to
    blunt abuse of a stolen session. Returns True (and increments) if
    the request should be rejected.
    """
    rl_key = f'ratelimit_admin_{action}_{actor.pk}'
    rl_count = cache.get(rl_key, 0)
    if rl_count >= 30:
        return True
    cache.set(rl_key, rl_count + 1, timeout=3600)
    return False


def _user_summary(user):
    return {
        'id': str(user.pk),
        'email': user.email,
        'username': user.username,
        'first_name': user.first_name,
        'last_name': user.last_name,
        'is_active': user.is_active,
        'is_email_verified': user.is_email_verified,
        'two_fa_enabled': user.two_fa_enabled,
        'is_deleted': user.is_deleted,
        'deletion_scheduled_at': user.deletion_scheduled_at.isoformat() if user.deletion_scheduled_at else None,
        'onboarding_completed': getattr(getattr(user, 'profile', None), 'onboarding_completed', None),
        'linked_providers': list(user.social_accounts.values_list('provider', flat=True)),
        'date_joined': user.date_joined.isoformat() if user.date_joined else None,
        'last_login': user.last_login.isoformat() if user.last_login else None,
        'is_suspended': user.is_suspended,
        'suspended_at': user.suspended_at.isoformat() if user.suspended_at else None,
        'suspension_reason': user.suspension_reason,
        'can_access_admin_panel': user.can_access_admin_panel,
        'is_super_admin': user.is_super_admin,
    }


@api_view(['GET'])
@authentication_classes([AdminCookieJWTAuthentication])
@permission_classes([IsAuthenticated])
def search_users(request):
    query = request.query_params.get('q', '').strip()
    if not query:
        return Response({'error': 'A search query is required.'}, status=status.HTTP_400_BAD_REQUEST)

    users = User.objects.filter(
        Q(email__icontains=query) | Q(username__icontains=query)
    ).order_by('email')[:50]

    log_event('admin_user_search', actor=request.user, request=request, metadata={'query': query, 'result_count': users.count()})
    return Response({'results': [_user_summary(u) for u in users]})


@api_view(['GET'])
@authentication_classes([AdminCookieJWTAuthentication])
@permission_classes([IsAuthenticated])
def user_detail(request, user_id):
    try:
        user = User.objects.get(pk=user_id)
    except (User.DoesNotExist, ValueError):
        return Response({'error': 'User not found.'}, status=status.HTTP_404_NOT_FOUND)

    log_event('admin_user_viewed', user=user, actor=request.user, request=request)
    return Response(_user_summary(user))


@api_view(['GET'])
@authentication_classes([AdminCookieJWTAuthentication])
@permission_classes([IsAuthenticated])
def user_sessions(request, user_id):
    try:
        user = User.objects.get(pk=user_id)
    except (User.DoesNotExist, ValueError):
        return Response({'error': 'User not found.'}, status=status.HTTP_404_NOT_FOUND)

    sessions = Session.objects.filter(user=user, expires_at__gt=timezone.now()).order_by('-last_used_at')
    log_event('admin_user_sessions_viewed', user=user, actor=request.user, request=request)
    return Response(SessionSerializer(sessions, many=True, context={'current_session_id': None}).data)


@api_view(['DELETE'])
@authentication_classes([AdminCookieJWTAuthentication])
@permission_classes([IsAuthenticated])
def admin_revoke_session(request, user_id, session_id):
    try:
        user = User.objects.get(pk=user_id)
    except (User.DoesNotExist, ValueError):
        return Response({'error': 'User not found.'}, status=status.HTTP_404_NOT_FOUND)

    try:
        session = Session.objects.get(pk=session_id, user=user)
    except (Session.DoesNotExist, ValueError):
        return Response({'error': 'Session not found.'}, status=status.HTTP_404_NOT_FOUND)

    session.delete()
    log_event(
        'session_revoked', user=user, actor=request.user, request=request,
        metadata={'revoked_by': 'admin', 'session_id': str(session_id)},
    )
    return Response({'message': 'Session revoked.'})


@api_view(['POST'])
@authentication_classes([AdminCookieJWTAuthentication])
@permission_classes([IsAuthenticated])
def suspend_user(request, user_id):
    if _admin_action_rate_limited('suspend', request.user):
        return Response(
            {'error': 'Too many suspension actions from this admin account. Please try again later.'},
            status=status.HTTP_429_TOO_MANY_REQUESTS,
        )

    try:
        user = User.objects.get(pk=user_id)
    except (User.DoesNotExist, ValueError):
        return Response({'error': 'User not found.'}, status=status.HTTP_404_NOT_FOUND)

    reason = request.data.get('reason', '').strip()
    if not reason:
        return Response({'error': 'A reason is required to suspend an account.'}, status=status.HTTP_400_BAD_REQUEST)

    if user.pk == request.user.pk:
        return Response({'error': 'You cannot suspend your own account.'}, status=status.HTTP_400_BAD_REQUEST)

    if user.can_access_admin_panel and not request.user.is_super_admin:
        return Response(
            {'error': 'Only a super-admin can suspend another admin account.'},
            status=status.HTTP_403_FORBIDDEN,
        )

    if user.is_suspended:
        return Response({'error': 'This account is already suspended.'}, status=status.HTTP_400_BAD_REQUEST)

    user.is_suspended = True
    user.suspended_at = timezone.now()
    user.suspension_reason = reason
    user.save(update_fields=['is_suspended', 'suspended_at', 'suspension_reason'])

    # Belt and braces: the auth-layer check above already stops this
    # user's very next request, but deleting every live session here
    # too means there's genuinely nothing left for them to be
    # "logged in" with at all, not just a check that would catch them
    # on their next action.
    Session.objects.filter(user=user).delete()

    log_event(
        'user_suspended', user=user, actor=request.user, request=request,
        metadata={'reason': reason},
    )
    return Response(_user_summary(user))


@api_view(['POST'])
@authentication_classes([AdminCookieJWTAuthentication])
@permission_classes([IsAuthenticated])
def reactivate_user(request, user_id):
    if _admin_action_rate_limited('reactivate', request.user):
        return Response(
            {'error': 'Too many reactivation actions from this admin account. Please try again later.'},
            status=status.HTTP_429_TOO_MANY_REQUESTS,
        )

    try:
        user = User.objects.get(pk=user_id)
    except (User.DoesNotExist, ValueError):
        return Response({'error': 'User not found.'}, status=status.HTTP_404_NOT_FOUND)

    if not user.is_suspended:
        return Response({'error': 'This account is not currently suspended.'}, status=status.HTTP_400_BAD_REQUEST)

    previous_reason = user.suspension_reason
    user.is_suspended = False
    user.suspended_at = None
    user.suspension_reason = ''
    user.save(update_fields=['is_suspended', 'suspended_at', 'suspension_reason'])

    log_event(
        'user_reactivated', user=user, actor=request.user, request=request,
        metadata={'previous_suspension_reason': previous_reason},
    )
    return Response(_user_summary(user))


@api_view(['POST'])
@authentication_classes([AdminCookieJWTAuthentication])
@permission_classes([IsSuperAdmin])
def grant_admin_access(request, user_id):
    if _admin_action_rate_limited('grant', request.user):
        return Response(
            {'error': 'Too many admin-access-grant actions from this admin account. Please try again later.'},
            status=status.HTTP_429_TOO_MANY_REQUESTS,
        )

    try:
        user = User.objects.get(pk=user_id)
    except (User.DoesNotExist, ValueError):
        return Response({'error': 'User not found.'}, status=status.HTTP_404_NOT_FOUND)

    if not user.email.endswith(f'@{ADMIN_EMAIL_DOMAIN}'):
        return Response(
            {'error': f'Admin access can only be granted to a @{ADMIN_EMAIL_DOMAIN} email address.'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if user.can_access_admin_panel:
        return Response({'error': 'This account already has admin access.'}, status=status.HTTP_400_BAD_REQUEST)

    user.can_access_admin_panel = True
    user.save(update_fields=['can_access_admin_panel'])
    log_event('admin_access_granted', user=user, actor=request.user, request=request)
    return Response(_user_summary(user))


@api_view(['POST'])
@authentication_classes([AdminCookieJWTAuthentication])
@permission_classes([IsSuperAdmin])
def revoke_admin_access(request, user_id):
    if _admin_action_rate_limited('revoke', request.user):
        return Response(
            {'error': 'Too many admin-access-revoke actions from this admin account. Please try again later.'},
            status=status.HTTP_429_TOO_MANY_REQUESTS,
        )

    try:
        user = User.objects.get(pk=user_id)
    except (User.DoesNotExist, ValueError):
        return Response({'error': 'User not found.'}, status=status.HTTP_404_NOT_FOUND)

    if user.pk == request.user.pk:
        return Response({'error': 'You cannot revoke your own admin access.'}, status=status.HTTP_400_BAD_REQUEST)
    if not user.can_access_admin_panel:
        return Response({'error': 'This account does not currently have admin access.'}, status=status.HTTP_400_BAD_REQUEST)

    user.can_access_admin_panel = False
    user.save(update_fields=['can_access_admin_panel'])

    # Revoking access should end any admin session they currently hold
    # immediately, not just block their next admin login.
    AdminSession.objects.filter(user=user).delete()

    log_event('admin_access_revoked', user=user, actor=request.user, request=request)
    return Response(_user_summary(user))


@api_view(['POST'])
@authentication_classes([AdminCookieJWTAuthentication])
@permission_classes([IsAuthenticated])
def admin_resend_verification(request, user_id):
    try:
        user = User.objects.get(pk=user_id)
    except (User.DoesNotExist, ValueError):
        return Response({'error': 'User not found.'}, status=status.HTTP_404_NOT_FOUND)

    if user.is_email_verified:
        return Response({'error': 'This account is already verified.'}, status=status.HTTP_400_BAD_REQUEST)

    uid = encode_uid(user)
    token = email_verification_token.make_token(user)
    send_verification_email_task.delay(str(user.pk), token, uid)

    log_event('admin_resend_verification', user=user, actor=request.user, request=request)
    return Response({'message': 'Verification email sent.'})
