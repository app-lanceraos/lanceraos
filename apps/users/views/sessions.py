# apps/users/views/sessions.py
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from core.observability import log_event

from ..cookies import REFRESH_COOKIE_NAME, clear_auth_cookies
from ..models import Session
from ..serializers import SessionSerializer


def _current_session_id(request):
    raw_refresh = request.COOKIES.get(REFRESH_COOKIE_NAME)
    if not raw_refresh:
        return None
    session = Session.get_valid(raw_refresh)
    return session.pk if session else None


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def list_sessions(request):
    """Every live session for the current user, most-recently-used first."""
    sessions = Session.objects.filter(
        user=request.user, expires_at__gt=timezone.now(),
    ).order_by('-last_used_at')
    current_id = _current_session_id(request)
    data = SessionSerializer(sessions, many=True, context={'current_session_id': current_id}).data
    return Response(data)


@api_view(['DELETE'])
@permission_classes([IsAuthenticated])
def revoke_session(request, session_id):
    """
    Revokes a session by id. Scoped to request.user in the lookup itself —
    a session belonging to someone else returns 404, not 403, so the
    endpoint never confirms or denies whether a given session id exists
    for another account.
    """
    try:
        session = Session.objects.get(pk=session_id, user=request.user)
    except (Session.DoesNotExist, ValueError, TypeError):
        return Response({'error': 'Session not found.'}, status=status.HTTP_404_NOT_FOUND)

    was_current = _current_session_id(request) == session.pk
    session.delete()
    log_event(
        'session_revoked', user=request.user, request=request,
        metadata={'session_id': str(session_id), 'was_current': was_current},
    )

    response = Response({'message': 'Session revoked.'})
    if was_current:
        # Revoking your own current session is equivalent to logging out
        # of it — clear the cookies so the frontend doesn't keep sending
        # a refresh token that no longer resolves to anything.
        clear_auth_cookies(response)
    return response