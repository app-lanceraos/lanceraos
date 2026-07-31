# core/ws_test_consumer.py
"""
TEST / REFERENCE CONSUMER ONLY — not a real product feature. Exists
purely to (a) prove CookieJWTAuthMiddleware actually works end to end,
and (b) give whoever builds the first real consumer (almost certainly
apps.invoices, for the client-portal message thread) a working pattern
to copy: how to require authentication, how to read the authenticated
user off self.scope, how to close a connection cleanly when auth is
missing. Safe to delete once a real consumer exists and this has served
its purpose — it's not wired into any actual product surface.
"""
from channels.generic.websocket import AsyncWebsocketConsumer


class AuthEchoConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        # Accept first, then close with the specific code — closing
        # before accepting means the handshake itself never completes,
        # collapsing into a generic HTTP-level rejection rather than a
        # real WS close event the client can actually read the code
        # from. Accepting first costs nothing security-wise (it grants
        # no permissions by itself) and is what makes 4001 genuinely
        # observable to a future frontend consumer.
        user = self.scope['user']
        await self.accept()
        if not user.is_authenticated:
            await self.close(code=4001)

    async def receive(self, text_data):
        user = self.scope['user']
        await self.send(f'Hello {user.email}, you said: {text_data}')
