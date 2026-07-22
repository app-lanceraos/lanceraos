# apps/users/cookies.py
"""
Single source of truth for the JWT cookie names and their flags.
Login, refresh, logout, OAuth, and 2FA-verify views all need to set or
clear these cookies with byte-for-byte identical flags — a Domain/Path/
SameSite mismatch between the cookie that was SET and the delete_cookie()
call that later tries to clear it means the browser treats them as two
different cookies and the "cleared" one silently keeps working. Centralizing
this here means that mistake can only be made once, not five times.
"""
from django.conf import settings

ACCESS_COOKIE_NAME = 'lanceraos_access'
REFRESH_COOKIE_NAME = 'lanceraos_refresh'
# v1 sent this as a request body field / header, implying it lived in
# localStorage on the frontend — the same anti-pattern access/refresh
# tokens used to have. It's a 30-day bearer secret ("skip 2FA on this
# device"), so it gets the same httpOnly treatment.
TRUSTED_DEVICE_COOKIE_NAME = 'lanceraos_trusted_device'

# Must match SIMPLE_JWT['ACCESS_TOKEN_LIFETIME'] in settings.py.
ACCESS_TOKEN_MAX_AGE_SECONDS = 60 * 15
TRUSTED_DEVICE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30  # 30 days, matches TrustedDevice.expires_at


def _cookie_kwargs():
    return {
        'domain': getattr(settings, 'COOKIE_DOMAIN', None) or None,
        'httponly': True,
        # Defaults to "secure in production, not in local DEBUG" so cookies
        # still work over plain http://localhost during development, without
        # needing a separate env var most of the time.
        'secure': getattr(settings, 'COOKIE_SECURE', not settings.DEBUG),
        'samesite': getattr(settings, 'COOKIE_SAMESITE', 'Lax'),
        'path': '/',
    }


def set_auth_cookies(response, access_token, refresh_token, refresh_lifetime_days):
    """
    Sets both cookies on a DRF/Django Response. Call this from login,
    OAuth callback, 2FA-verify, and refresh views — anywhere new tokens
    are issued.
    """
    kwargs = _cookie_kwargs()
    response.set_cookie(
        ACCESS_COOKIE_NAME, access_token,
        max_age=ACCESS_TOKEN_MAX_AGE_SECONDS, **kwargs,
    )
    response.set_cookie(
        REFRESH_COOKIE_NAME, refresh_token,
        max_age=refresh_lifetime_days * 86400, **kwargs,
    )
    return response


def clear_auth_cookies(response):
    """Call from the logout view. Flags must match set_auth_cookies exactly."""
    kwargs = _cookie_kwargs()
    response.delete_cookie(
        ACCESS_COOKIE_NAME, domain=kwargs['domain'], path=kwargs['path'], samesite=kwargs['samesite'],
    )
    response.delete_cookie(
        REFRESH_COOKIE_NAME, domain=kwargs['domain'], path=kwargs['path'], samesite=kwargs['samesite'],
    )
    return response


def set_trusted_device_cookie(response, raw_token):
    response.set_cookie(
        TRUSTED_DEVICE_COOKIE_NAME, raw_token,
        max_age=TRUSTED_DEVICE_MAX_AGE_SECONDS, **_cookie_kwargs(),
    )
    return response


def clear_trusted_device_cookie(response):
    kwargs = _cookie_kwargs()
    response.delete_cookie(
        TRUSTED_DEVICE_COOKIE_NAME, domain=kwargs['domain'], path=kwargs['path'], samesite=kwargs['samesite'],
    )
    return response