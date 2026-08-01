# apps/admin_panel/views_deletion.py
from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from core.observability import log_event

from .authentication import AdminCookieJWTAuthentication

User = get_user_model()


@api_view(['GET'])
@authentication_classes([AdminCookieJWTAuthentication])
@permission_classes([IsAuthenticated])
def deletion_queue(request):
    """
    Accounts currently inside their 30-day recovery window — scheduled
    for deletion but not yet anonymized. Ordered soonest-first, since
    that's the most support-relevant ordering (least time left to help
    someone who wants to reconsider).
    """
    queue = User.objects.filter(
        is_deleted=True, anonymized_at__isnull=True,
    ).order_by('deletion_scheduled_at')

    return Response({
        'results': [{
            'id': str(u.pk),
            'email': u.email,
            'username': u.username,
            'deletion_requested_at': u.deletion_requested_at.isoformat() if u.deletion_requested_at else None,
            'deletion_scheduled_at': u.deletion_scheduled_at.isoformat() if u.deletion_scheduled_at else None,
        } for u in queue],
        'total': queue.count(),
    })


@api_view(['POST'])
@authentication_classes([AdminCookieJWTAuthentication])
@permission_classes([IsAuthenticated])
def admin_restore_account(request, user_id):
    """
    Admin-assisted equivalent of the user's own cancel_deletion — same
    reset, but logged as a distinct event (admin_deletion_restored, not
    deletion_cancelled) so the audit trail correctly shows this was
    admin-initiated, not a self-service action, with actor recorded.
    """
    try:
        user = User.objects.get(pk=user_id)
    except (User.DoesNotExist, ValueError):
        return Response({'error': 'User not found.'}, status=status.HTTP_404_NOT_FOUND)

    if not user.is_deleted:
        return Response({'error': 'This account does not have a pending deletion.'}, status=status.HTTP_400_BAD_REQUEST)
    if user.anonymized_at is not None:
        return Response({'error': 'This account has already been anonymized and cannot be restored.'}, status=status.HTTP_400_BAD_REQUEST)

    user.is_deleted = False
    user.deleted_at = None
    user.deletion_requested_at = None
    user.deletion_scheduled_at = None
    user.save(update_fields=['is_deleted', 'deleted_at', 'deletion_requested_at', 'deletion_scheduled_at'])

    log_event('admin_deletion_restored', user=user, actor=request.user, request=request)
    return Response({'message': 'Account restored.'})
