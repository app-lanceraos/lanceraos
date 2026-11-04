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
from .cookies import ACCESS_COOKIE_NAME, REFRESH_COOKIE_NAME
from .models import Session, User


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

        # A suspension must take effect on this user's very next request,
        # not just block future logins — an already-open tab with a
        # still-valid access token would otherwise keep working until it
        # naturally expired.
        if user.is_suspended:
            raise InvalidToken(
                'This account has been suspended. Please contact support.'
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


def enforce_csrf_standalone(request):
    """
    Same check as CookieJWTAuthentication.enforce_csrf, but callable on its
    own — for @authentication_classes(NO_AUTH) views (login, register,
    refresh, etc.), where CookieJWTAuthentication.authenticate() never runs
    (there's no JWT cookie to authenticate yet), so its enforce_csrf() never
    fires either. Without this, those endpoints are protected only by
    SameSite=Lax rather than an explicit token check, unlike every other
    state-changing endpoint in the app.
    """
    check = CSRFCheck(_dummy_get_response)
    check.process_request(request)
    reason = check.process_view(request, None, (), {})
    if reason:
        raise exceptions.PermissionDenied(f'CSRF Failed: {reason}')


def identify_user_from_refresh_cookie(request):
    """
    Returns the User the request's refresh cookie belongs to, or None. A strictly
    read-only observer: it never rotates, extends, deletes or writes anything, never
    sets or clears a cookie, and never authenticates the request.

    Why it exists: the public proposal page must know whether the person looking is
    the proposal's owner, but the access cookie lives 15 minutes while the refresh
    cookie lives 30-90 days, and that page deliberately never calls /auth/ (so
    nothing renews the access cookie while the owner reads their own proposal).
    Without this, an owner opening their own link after 15 minutes was treated as
    a client and counted as a view.

    The answer can only ever REDUCE what happens (the owner sees a preview, the view
    is not counted, they cannot answer); it grants nothing. A cookie that passes
    here already passes auth.refresh(), which grants a whole session.

    auth.refresh() stays the single authority on refresh-cookie validity and is
    deliberately NOT refactored to share this code: it interleaves deletes and
    rotation with its checks and is the login core. A parity test
    (apps/users/tests/test_refresh_cookie_identity.py) guards drift instead.

    Two checks are intentionally stricter than refresh(), so the answer matches
    what refresh() followed by an authenticated request would end up giving:
    a suspended user is refused (refresh() rotates for them, but the new access
    cookie would be rejected by CookieJWTAuthentication.get_user), and the
    session row must belong to the same user as the token (refresh() takes the
    user from the token alone; the two can only differ if the database was
    tampered with).
    """
    raw = request.COOKIES.get(REFRESH_COOKIE_NAME)
    if not raw:
        return None
    session = Session.get_valid(raw)
    if session is None:
        return None
    try:
        from rest_framework_simplejwt.exceptions import TokenError
        from rest_framework_simplejwt.tokens import RefreshToken
        validated = RefreshToken(raw)
        user = User.objects.get(pk=validated['user_id'])
    except (TokenError, User.DoesNotExist, KeyError, ValueError, TypeError):
        return None
    if not user.is_active or user.is_suspended:
        return None
    pca_claim = validated.get('pca')
    if pca_claim is not None and user.password_changed_at is not None:
        if int(pca_claim) < int(user.password_changed_at.timestamp()):
            return None
    if str(session.user_id) != str(user.pk):
        return None
    return user
