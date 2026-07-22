# config/asgi.py
import os

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')

# Django's ASGI app must be initialized before any channel imports, so
# that all Django models and apps are ready first.
from django.core.asgi import get_asgi_application  # noqa: E402
django_asgi_app = get_asgi_application()

from channels.routing import ProtocolTypeRouter, URLRouter  # noqa: E402

# Empty for now — no module has WebSocket consumers yet (that arrives
# with apps.invoices, for the client-portal message thread and live
# notifications). When it does, that module's chat adds
# `from apps.invoices.routing import websocket_urlpatterns` here and
# passes it to URLRouter below, rather than this file being rewritten
# from scratch.
websocket_urlpatterns = []

application = ProtocolTypeRouter({
    'http': django_asgi_app,
    'websocket': URLRouter(websocket_urlpatterns),
})