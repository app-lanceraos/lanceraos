# config/asgi.py
import os

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')

# Django's ASGI app must be initialized before any channel imports, so
# that all Django models and apps are ready first.
from django.core.asgi import get_asgi_application  # noqa: E402
django_asgi_app = get_asgi_application()

from channels.routing import ProtocolTypeRouter, URLRouter  # noqa: E402
from channels.security.websocket import OriginValidator  # noqa: E402
from django.conf import settings  # noqa: E402

from apps.users.ws_auth import CookieJWTAuthMiddleware  # noqa: E402
from config.ws_routing import websocket_urlpatterns  # noqa: E402

application = ProtocolTypeRouter({
    'http': django_asgi_app,
    # OriginValidator reuses the same CORS_ALLOWED_ORIGINS already
    # configured for HTTP — a single source of truth for "which
    # frontend origins are trusted" rather than a second setting to
    # keep in sync. This is the WebSocket equivalent of CORS: without
    # it, a malicious site could open a connection using a logged-in
    # user's browser (cookies are attached automatically), since
    # WebSocket handshakes aren't subject to CSRF the same way a POST
    # request is.
    'websocket': OriginValidator(
        CookieJWTAuthMiddleware(URLRouter(websocket_urlpatterns)),
        settings.CORS_ALLOWED_ORIGINS,
    ),
})