# apps/admin_panel/permissions.py
from rest_framework.permissions import BasePermission


class IsSuperAdmin(BasePermission):
    """
    Gates the two most consequential admin actions — granting and
    revoking someone else's admin access — behind a stricter check than
    the regular AdminCookieJWTAuthentication + IsAuthenticated combo
    every other admin endpoint uses. A regular admin authenticates fine
    but is rejected here specifically.
    """
    def has_permission(self, request, view):
        if request.user and request.user.is_authenticated and request.user.is_super_admin:
            return True
        if request.user and request.user.is_authenticated:
            from core.observability import log_event
            log_event(
                'admin_permission_denied', actor=request.user, request=request,
                metadata={'required_permission': 'super_admin', 'path': request.path, 'method': request.method},
            )
        return False
