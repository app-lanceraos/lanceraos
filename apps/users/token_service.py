# apps/users/token_service.py
"""
Single place that issues a JWT access/refresh pair AND creates or
rotates the corresponding Session row. Used by login, 2FA-verify,
OAuth callbacks, and the refresh endpoint — anywhere a user ends up
with a working session — so "embed the pca claim, enforce the 3-session
cap, hash the refresh token into a Session row" exists exactly once
rather than once per call site.
"""
from datetime import timedelta

from rest_framework_simplejwt.tokens import RefreshToken

from core.observability import get_client_ip, get_user_agent, normalize_user_agent

from .models import Session

DEFAULT_REFRESH_DAYS = 30
REMEMBER_ME_REFRESH_DAYS = 90


def _build_refresh_token(user, days):
    refresh = RefreshToken.for_user(user)
    refresh.set_exp(lifetime=timedelta(days=days))
    # password_changed_at is guaranteed non-null from account creation
    # (see UserManager._create_user) — every token gets a pca claim, no
    # "if truthy" special case that could leave a token claim-less.
    refresh['pca'] = int(user.password_changed_at.timestamp())
    return refresh


def issue_tokens_and_session(user, request, remember_me=False):
    """
    Creates a brand-new session — used for login, 2FA-verify, and OAuth,
    i.e. anywhere a genuinely new device/session is starting. Enforces
    the 3-session cap (evicts the least-recently-used session if full).
    Returns (access_token_str, refresh_token_str, session).
    """
    days = REMEMBER_ME_REFRESH_DAYS if remember_me else DEFAULT_REFRESH_DAYS
    refresh = _build_refresh_token(user, days)
    refresh_str = str(refresh)

    session = Session.create_for_user(
        user=user,
        raw_token=refresh_str,
        device_name=normalize_user_agent(get_user_agent(request)),
        ip_address=get_client_ip(request),
        lifetime_days=days,
    )

    # The session doesn't exist yet when the refresh token is built above
    # (Session.create_for_user needs the refresh string already computed,
    # to hash it) — so the session ID can only be embedded on the access
    # token, built fresh here after the session row exists. This is what
    # CookieJWTAuthentication.get_user() checks to make revoking a
    # session (deleting its row) take effect immediately, not only once
    # the refresh token is next used.
    access = refresh.access_token
    access['sid'] = str(session.pk)
    return str(access), refresh_str, session

def rotate_session(user, session, request):
    """
    Used by the refresh endpoint — rotates the SAME session row (new
    refresh hash, new expiry) rather than creating a new one, which
    would otherwise make "3 sessions" actually mean "3 refreshes since
    login." Preserves the session's original remember-me duration by
    re-deriving it from (expires_at - created_at) rather than adding a
    dedicated remember_me column to Session — DATABASE.md's Session spec
    is already finalized with exactly the fields agreed on, and this
    achieves the same result without revising that spec.
    """
    original_days = max(1, (session.expires_at - session.created_at).days)
    refresh = _build_refresh_token(user, original_days)
    refresh_str = str(refresh)

    session.rotate(refresh_str, lifetime_days=original_days)
    session.ip_address = get_client_ip(request) or session.ip_address
    session.save(update_fields=['ip_address'])

    access = refresh.access_token
    access['sid'] = str(session.pk)
    return str(access), refresh_str