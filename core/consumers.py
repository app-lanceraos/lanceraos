# core/consumers.py
"""
The bell's real-time push. Lives in core/, not any one app, because the
whole point (see DECISIONS.md) is that a notification-worthy event from
ANY app reaches it through one shared choke point —
core.observability.log_event() calling core.notifications.
broadcast_notification() right after the AuditLog row commits — with no
per-app WebSocket wiring required, ever.

Single-identity (freelancer only), unlike apps.invoices.consumers.
ClientThreadConsumer's dual freelancer/portal auth — a client-portal
visitor has no bell of their own. Authentication comes for free from the
global CookieJWTAuthMiddleware (apps/users/ws_auth.py) already wired into
every WS route via config/asgi.py, so this consumer only needs to check
self.scope['user'].is_authenticated, the same pattern
core/ws_test_consumer.py's AuthEchoConsumer established.
"""
import json
import logging

from channels.generic.websocket import AsyncWebsocketConsumer

logger = logging.getLogger(__name__)


class NotificationConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        user = self.scope['user']

        # Accept first, then close with a specific code — closing before
        # accepting collapses into a generic HTTP-level handshake
        # rejection instead of a real WS close event the client can read
        # a code from. Same technique as AuthEchoConsumer and
        # ClientThreadConsumer. Accepting grants no permissions by itself.
        await self.accept()

        if not user.is_authenticated:
            await self.close(code=4001)
            return

        self.group_name = f'notifications_{user.id}'
        await self.channel_layer.group_add(self.group_name, self.channel_name)

    async def disconnect(self, close_code):
        if hasattr(self, 'group_name'):
            await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def receive(self, text_data):
        pass  # server -> client only — nothing is ever posted to the bell over this socket

    async def notification_message(self, event):
        """Dispatched by channel_layer.group_send({'type': 'notification.message', ...}) — core.notifications.broadcast_notification."""
        await self.send(text_data=json.dumps({
            'kind': 'notification',
            'notification': event['notification'],
            'unread_count': event['unread_count'],
        }))

    async def notification_refresh(self, event):
        """Dispatched by channel_layer.group_send({'type': 'notification.refresh', ...}) — core.notifications._push_state_refresh (multi-tab read/dismiss sync)."""
        await self.send(text_data=json.dumps({
            'kind': 'refresh',
            'unread_count': event['unread_count'],
        }))
