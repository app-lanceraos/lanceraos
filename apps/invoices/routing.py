# apps/invoices/routing.py
from django.urls import path

from .consumers import ClientThreadConsumer

websocket_urlpatterns = [
    # view_token, not pk — see consumers.py's own docstring and
    # DECISIONS.md for the full reasoning (this codebase's established
    # public-facing credential, matching GET .../portal/view/<view_token>/
    # and the reply+<view_token>@ email address).
    path('ws/invoices/thread/<str:view_token>/', ClientThreadConsumer.as_asgi()),
]
