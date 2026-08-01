# apps/admin_panel/authentication.py
"""
Mirrors apps.users.authentication.CookieJWTAuthentication's structure
and security properties exactly (same pca password-change check, same
CSRF enforcement, same "no cookie -> return None, let AllowAny/other
authenticators decide" leniency) — but is a genuinely separate class,
not a shared/parameterized one, for one critical reason: token-type
confusion. Without a distinguishing claim, a regular user's access
token and an admin access token are both just validly-signed JWTs for
the same user ID under the same signing key — nothing would stop a
stolen REGULAR access token from being replayed against admin
endpoints, or vice versa, if both were accepted by looking for the same
claims. The `admin_sid` claim (set only by admin_panel's own token
minting, checked as REQUIRED here, never optional) is what closes that
gap — its mere presence is the "this is genuinely an admin-purposed
token" signal, and its absence is treated as a full authentication
failure, not silently ignored.
"""
from rest_framework import exceptions
from rest_framework.authentication import CSRFCheck
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.exceptions import InvalidToken

from django.utils import timezone

from .constants import ADMIN_EMAIL_DOMAIN
from .cookies import ADMIN_ACCESS_COOKIE_NAME
from .models import AdminSession


def _dummy_get_response(request):
    return None


class AdminCookieJWTAuthentication(JWTAuthentication):

    def authenticate(self, request):
        raw_token = request.COOKIES.get(ADMIN_ACCESS_COOKIE_NAME)
        if raw_token is None:
            return None

        validated_token = self.get_validated_token(raw_token)
        user = self.get_user(validated_token)
        self.enforce_csrf(request)
        return user, validated_token

    def get_user(self, validated_token):
        user = super().get_user(validated_token)

        pca_claim = validated_token.get('pca')
        if pca_claim is not None and user.password_changed_at is not None:
            token_pca = int(pca_claim)
            user_pca = int(user.password_changed_at.timestamp())
            if token_pca < user_pca:
                raise InvalidToken(
                    'Token has been invalidated by a password change. '
                    'Please sign in again.'
                )

        admin_sid_claim = validated_token.get('admin_sid')
        if admin_sid_claim is None:
            raise InvalidToken('Not a valid admin session token.')

        session_exists = AdminSession.objects.filter(
            pk=admin_sid_claim, user=user, expires_at__gt=timezone.now(),
        ).exists()
        if not session_exists:
            raise InvalidToken('Admin session has been revoked. Please sign in again.')

        if not user.can_access_admin_panel:
            raise InvalidToken('Admin access has been revoked for this account.')

        if not user.email.endswith(f'@{ADMIN_EMAIL_DOMAIN}'):
            raise InvalidToken('Admin access requires a company email address.')

        return user

    def enforce_csrf(self, request):
        check = CSRFCheck(_dummy_get_response)
        check.process_request(request)
        reason = check.process_view(request, None, (), {})
        if reason:
            raise exceptions.PermissionDenied(f'CSRF Failed: {reason}')
