# config/ws_routing.py
from django.urls import path

from core.consumers import NotificationConsumer
from core.ws_test_consumer import AuthEchoConsumer
from apps.invoices.routing import websocket_urlpatterns as invoices_websocket_urlpatterns

websocket_urlpatterns = [
    path('ws/echo/', AuthEchoConsumer.as_asgi()),
    path('ws/notifications/', NotificationConsumer.as_asgi()),
    *invoices_websocket_urlpatterns,
]
