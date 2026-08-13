# apps/clients/cookies.py
"""
Deliberately distinct cookie NAME from apps.users.cookies and
apps.admin_panel.cookies, not just a separate mechanism — all three sets
of cookies technically travel to api.lanceraos.com, so name collision,
not domain scoping, is what actually keeps a client's portal session
from ever being confused with a freelancer's own login or an admin's
session. Mirrors both existing cookies.py files' exact flag shape.
"""
from django.conf import settings

PORTAL_SESSION_COOKIE_NAME = 'lanceraos_portal_session'
PORTAL_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 60  # 60 days, matches ClientPortalSession.SESSION_LIFETIME_DAYS


def _portal_cookie_kwargs():
    return {
        'domain': getattr(settings, 'COOKIE_DOMAIN', None) or None,
        'httponly': True,
        'secure': getattr(settings, 'COOKIE_SECURE', not settings.DEBUG),
        'samesite': getattr(settings, 'COOKIE_SAMESITE', 'Lax'),
        'path': '/',
    }


def set_portal_session_cookie(response, raw_token):
    response.set_cookie(
        PORTAL_SESSION_COOKIE_NAME, raw_token,
        max_age=PORTAL_SESSION_MAX_AGE_SECONDS, **_portal_cookie_kwargs(),
    )
    return response


def clear_portal_session_cookie(response):
    """Flags must match set_portal_session_cookie exactly, or the browser treats a clear as a different cookie and the 'cleared' one silently keeps working."""
    kwargs = _portal_cookie_kwargs()
    response.delete_cookie(
        PORTAL_SESSION_COOKIE_NAME, domain=kwargs['domain'], path=kwargs['path'], samesite=kwargs['samesite'],
    )
    return response
