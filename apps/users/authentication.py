# apps/users/authentication.py
"""
Reads the JWT access token from an httpOnly cookie instead of the
Authorization header. v1 used the header + localStorage; v2 moves to
cookies per CLAUDE.md rule 6, specifically so an XSS payload can't read
the token off the page the way it could with localStorage.

Two behaviors are combined in this one class, deliberately:

1. Password-change invalidation (ported from v1's PasswordAwareJWTAuthentication,
   unchanged in behavior): a token embeds the user's password_changed_at
   timestamp as a 'pca' claim at issue time; if the user's current
   password_changed_at is newer than the claim, the token is rejected.
   This is what makes "change password" log out every other device
   instantly without needing a token blacklist.

2. CSRF enforcement: moving auth into a cookie means the browser attaches
   it automatically on every request, which is exactly the CSRF attack
   surface CLAUDE.md rule 14 requires defending against. This is only
   necessary because DRF's APIView marks itself csrf_exempt by default —
   Django's CsrfViewMiddleware never gets a chance to check these requests
   otherwise. This reuses DRF's own CSRFCheck (the same mechanism
   SessionAuthentication.enforce_csrf uses internally), not a
   reimplementation of the double-submit-cookie comparison.
"""
from rest_framework import exceptions
from rest_framework.authentication import CSRFCheck
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.exceptions import InvalidToken

from django.utils import timezone
from .cookies import ACCESS_COOKIE_NAME
from .models import Session


def _dummy_get_response(request):
    return None


class CookieJWTAuthentication(JWTAuthentication):

    def authenticate(self, request):
        raw_token = request.COOKIES.get(ACCESS_COOKIE_NAME)
        if raw_token is None:
            return None  # No cookie -> let other authenticators / AllowAny handle it.

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

        # Makes session revocation (deleting a Session row from the
        # Sessions page) take effect immediately, rather than only once
        # this device's access token naturally expires and it tries to
        # refresh. sid_claim is None for tokens issued before this change
        # existed — those are left alone rather than force-logged-out,
        # and simply pick up a real sid claim the next time they refresh.
        sid_claim = validated_token.get('sid')
        if sid_claim is not None:
            session_exists = Session.objects.filter(
                pk=sid_claim, user=user, expires_at__gt=timezone.now(),
            ).exists()
            if not session_exists:
                raise InvalidToken(
                    'Session has been revoked. Please sign in again.'
                )
        return user

    def enforce_csrf(self, request):
        """
        CSRFCheck.process_view internally no-ops for safe methods
        (GET/HEAD/OPTIONS/TRACE) — callers don't need to gate on
        request.method themselves, that's handled here already.
        """
        check = CSRFCheck(_dummy_get_response)
        check.process_request(request)  # populates request.META['CSRF_COOKIE']
        reason = check.process_view(request, None, (), {})
        if reason:
            raise exceptions.PermissionDenied(f'CSRF Failed: {reason}')