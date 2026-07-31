# config/ws_routing.py
from django.urls import path

from core.ws_test_consumer import AuthEchoConsumer

websocket_urlpatterns = [
    path('ws/echo/', AuthEchoConsumer.as_asgi()),
    # Future modules add their own websocket routes here — e.g.:
    # from apps.invoices.consumers import ClientThreadConsumer
    # path('ws/invoices/thread/<uuid:thread_id>/', ClientThreadConsumer.as_asgi()),
]
