# apps/admin_panel/cookies.py
"""
Deliberately distinct cookie NAMES from apps.users.cookies, not just a
separate mechanism — both sets of cookies will technically travel to
api.lanceraos.com (they share the parent domain, since the admin
frontend genuinely needs to call the same backend the regular app
does), so name collision, not domain scoping, is what actually keeps
these from ever being confused with or overwriting a regular user's
session cookies.
"""
from django.conf import settings

ADMIN_ACCESS_COOKIE_NAME = 'lanceraos_admin_access'
ADMIN_REFRESH_COOKIE_NAME = 'lanceraos_admin_refresh'

ADMIN_ACCESS_TOKEN_MAX_AGE_SECONDS = 60 * 15


def _admin_cookie_kwargs():
    return {
        'domain': getattr(settings, 'COOKIE_DOMAIN', None) or None,
        'httponly': True,
        'secure': getattr(settings, 'COOKIE_SECURE', not settings.DEBUG),
        'samesite': getattr(settings, 'COOKIE_SAMESITE', 'Lax'),
        'path': '/',
    }


def set_admin_auth_cookies(response, access_token, refresh_token, refresh_lifetime_days):
    kwargs = _admin_cookie_kwargs()
    response.set_cookie(
        ADMIN_ACCESS_COOKIE_NAME, access_token,
        max_age=ADMIN_ACCESS_TOKEN_MAX_AGE_SECONDS, **kwargs,
    )
    response.set_cookie(
        ADMIN_REFRESH_COOKIE_NAME, refresh_token,
        max_age=refresh_lifetime_days * 86400, **kwargs,
    )
    return response


def clear_admin_auth_cookies(response):
    """Flags must match set_admin_auth_cookies exactly, or the browser treats a
    clear as a different cookie and the 'cleared' one silently keeps working."""
    kwargs = _admin_cookie_kwargs()
    response.delete_cookie(
        ADMIN_ACCESS_COOKIE_NAME, domain=kwargs['domain'], path=kwargs['path'], samesite=kwargs['samesite'],
    )
    response.delete_cookie(
        ADMIN_REFRESH_COOKIE_NAME, domain=kwargs['domain'], path=kwargs['path'], samesite=kwargs['samesite'],
    )
    return response
