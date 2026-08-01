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
        return bool(request.user and request.user.is_authenticated and request.user.is_super_admin)
