# apps/users/ws_auth.py
"""
WebSocket-connection equivalent of CookieJWTAuthentication (see
authentication.py) — validates the exact same httpOnly access-token
cookie, through the exact same validation path (the pca password-change
check and the sid session-revocation check both included, since this
reuses CookieJWTAuthentication.get_user() directly rather than
reimplementing that logic a second time), so a WebSocket connection has
identical security properties to an HTTP request.

Deliberately does NOT reject a connection outright when no valid token
is present — it populates scope['user'] with either the authenticated
User or AnonymousUser, mirroring how CookieJWTAuthentication.authenticate()
returns None for HTTP and lets downstream permission classes decide.
Individual consumers are responsible for checking
self.scope['user'].is_authenticated and closing the connection
themselves if authentication is required for that consumer.
"""
from http.cookies import SimpleCookie

from channels.db import database_sync_to_async
from channels.middleware import BaseMiddleware
from django.contrib.auth.models import AnonymousUser

from .authentication import CookieJWTAuthentication
from .cookies import ACCESS_COOKIE_NAME


@database_sync_to_async
def _get_user_from_token(raw_token):
    auth = CookieJWTAuthentication()
    try:
        validated_token = auth.get_validated_token(raw_token)
        return auth.get_user(validated_token)
    except Exception:
        # Any failure here (expired, malformed, revoked, password
        # changed since issue) — treat as anonymous, don't crash the
        # connection attempt. Matches CookieJWTAuthentication's own
        # leniency for the "no cookie at all" HTTP case.
        return AnonymousUser()


class CookieJWTAuthMiddleware(BaseMiddleware):
    async def __call__(self, scope, receive, send):
        scope['user'] = await self._authenticate(scope)
        return await super().__call__(scope, receive, send)

    async def _authenticate(self, scope):
        headers = dict(scope.get('headers', []))
        raw_cookie_header = headers.get(b'cookie', b'').decode()
        cookies = SimpleCookie()
        cookies.load(raw_cookie_header)
        if ACCESS_COOKIE_NAME not in cookies:
            return AnonymousUser()
        return await _get_user_from_token(cookies[ACCESS_COOKIE_NAME].value)
