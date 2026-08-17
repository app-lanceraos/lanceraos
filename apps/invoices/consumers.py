# apps/invoices/consumers.py
"""
Step 13 — the client-portal comment thread's real-time delivery.

ClientThreadConsumer requires EITHER a freelancer identity (populated by
the global CookieJWTAuthMiddleware, apps/users/ws_auth.py, wired into
every WebSocket route via config/asgi.py — reused exactly here, never
reimplemented) OR a client-portal identity. The portal check is built
here, inside this one consumer, deliberately NOT as a second global ASGI
middleware — a ClientPortalSession identity is scoped to exactly this
one consumer, unlike freelancer auth, which every future WS route will
want for free the same way this one already gets it.

apps.clients.portal.resolve_session_from_request only ever reads
`request.COOKIES` (confirmed directly by reading that function) — never
anything else — so it's reused directly via a minimal duck-typed shim
(_CookieOnlyRequest) rather than reimplementing its cookie-lookup +
sliding-window-renewal logic a second time. Wrapped in
database_sync_to_async, the same pattern
apps/users/ws_auth.py's own _get_user_from_token already establishes for
a WS-context DB lookup.

Route uses the invoice's view_token, not its pk (see
config/ws_routing.py and DECISIONS.md for the full reasoning) — this
codebase's established public-facing credential (GET .../portal/view/
<view_token>/, the reply+<view_token>@ email address) for exactly this
"an unauthenticated-by-JWT client needs to reference this invoice"
situation. The consumer still performs its own real authorization check
regardless of which identifier were used — this is about consistency
with the rest of the module's public-facing surface, not the sole
security boundary.

A one-time client's invoice (invoice.client_id is null) has no
ClientPortalSession possible at all — per Step 12's "no portal, no
session" rule, there is structurally no way for that client to
authenticate into this consumer. Only the freelancer side can ever
connect to a one-time-client invoice's thread; this is a real,
inherent limitation, not an oversight (see DECISIONS.md).
"""
import logging
from http.cookies import SimpleCookie

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncWebsocketConsumer

from apps.clients.portal import resolve_session_from_request

from .models import Invoice

logger = logging.getLogger(__name__)


class _CookieOnlyRequest:
    """Minimal duck-typed shim — resolve_session_from_request only ever reads request.COOKIES."""
    def __init__(self, cookies):
        self.COOKIES = cookies


def _cookies_from_scope(scope):
    headers = dict(scope.get('headers', []))
    raw_cookie_header = headers.get(b'cookie', b'').decode()
    parsed = SimpleCookie()
    parsed.load(raw_cookie_header)
    return {key: morsel.value for key, morsel in parsed.items()}


@database_sync_to_async
def _get_invoice_by_view_token(view_token):
    return Invoice.objects.filter(view_token=view_token).select_related('user', 'client').first()


@database_sync_to_async
def _resolve_portal_client(scope):
    cookies = _cookies_from_scope(scope)
    return resolve_session_from_request(_CookieOnlyRequest(cookies))


class ClientThreadConsumer(AsyncWebsocketConsumer):
    """
    Server -> client delivery only (mirrors v1-reference's
    NotificationConsumer.receive(): posting a comment always happens
    through the real HTTP endpoints — invoice_comments, views.py;
    portal_invoice_comments, views_portal.py — or the email-reply
    webhook, never over this socket directly). Those three real write
    paths call apps.invoices.comments.broadcast_comment() after saving,
    which reaches every connection in this invoice's group via the
    'comment.message' -> comment_message dispatch below.
    """

    async def connect(self):
        view_token = self.scope['url_route']['kwargs']['view_token']
        invoice = await _get_invoice_by_view_token(view_token)

        # Accept first, then close with a specific code — same technique
        # core/ws_test_consumer.py's AuthEchoConsumer established: closing
        # before accepting collapses into a generic HTTP-level handshake
        # rejection, not a real WS close event the client can read a code
        # from. Accepting first grants no permissions by itself.
        await self.accept()

        if invoice is None:
            await self.close(code=4004)  # unknown thread
            return

        if not await self._authorized(invoice):
            await self.close(code=4001)  # unauthorized
            return

        self.group_name = f'invoice_thread_{view_token}'
        await self.channel_layer.group_add(self.group_name, self.channel_name)

    async def disconnect(self, close_code):
        if hasattr(self, 'group_name'):
            await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def receive(self, text_data):
        pass  # server -> client only, see class docstring

    async def comment_message(self, event):
        """Dispatched by channel_layer.group_send({'type': 'comment.message', ...}) — apps.invoices.comments.broadcast_comment."""
        import json
        await self.send(text_data=json.dumps(event['comment']))

    async def read_state_update(self, event):
        """
        Item 3 of the 16 August 2026 second verification pass. Dispatched
        by channel_layer.group_send({'type': 'read_state.update', ...}) —
        apps.invoices.comments.broadcast_read_state. A distinct payload
        shape from comment_message above (an `event` key, no `author_type`/
        `body_text`/etc.) so the frontend can tell a read-state update
        apart from a new comment without needing a version bump to the
        existing, tested comment broadcast wire format.
        """
        import json
        await self.send(text_data=json.dumps({
            'event': 'read_state', 'field': event['field'], 'ids': event['ids'], 'at': event['at'],
        }))

    async def _authorized(self, invoice):
        user = self.scope.get('user')
        if user is not None and getattr(user, 'is_authenticated', False) and invoice.user_id == user.pk:
            return True

        client = await _resolve_portal_client(self.scope)
        if client is not None and invoice.client_id == client.pk:
            return True

        return False
