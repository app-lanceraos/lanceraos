# apps/invoices/tests/test_consumers.py
"""
Step 13 — ClientThreadConsumer's real WebSocket auth, using Channels'
own testing utilities (channels.testing.WebsocketCommunicator), not
HTTP-layer tooling — this is the first WebSocket consumer test anywhere
in this codebase (confirmed directly: no existing WS test pattern to
follow before this). CHANNEL_LAYERS is overridden to Channels' in-memory
backend for the whole module — reliable, Redis-independent testing,
matching Channels' own documented testing convention, rather than
depending on a real Redis instance being up during CI/test runs.

Both real auth paths are exercised end to end: CookieJWTAuthMiddleware
wraps the consumer exactly as config/asgi.py wires it in production (not
the full ProtocolTypeRouter/OriginValidator stack — that would require
matching CORS_ALLOWED_ORIGINS too, unrelated to what this file tests),
and a real ClientPortalSession row backs the portal-cookie path.
"""
import json
from decimal import Decimal

from channels.testing import WebsocketCommunicator
from django.test import TestCase, TransactionTestCase, override_settings
from django.urls import reverse

from apps.clients.cookies import PORTAL_SESSION_COOKIE_NAME
from apps.clients.models import Client as ClientModel
from apps.clients.models import ClientPortalSession
from apps.invoices.comments import broadcast_comment
from apps.invoices.models import InvoiceComment, InvoiceItem
from apps.invoices.tests.test_models import make_invoice
from apps.users.cookies import ACCESS_COOKIE_NAME
from apps.users.ws_auth import CookieJWTAuthMiddleware
from apps.users.models import User


def make_client(user, **overrides):
    data = {'name': 'Acme Co', 'email': 'acme@example.com'}
    data.update(overrides)
    return ClientModel.objects.create(user=user, **data)


def make_application():
    from channels.routing import URLRouter

    from apps.invoices.routing import websocket_urlpatterns
    # URLRouter is what actually parses <str:view_token> out of the path
    # and populates scope['url_route'] — passing the bare consumer
    # directly to WebsocketCommunicator (no router) never sets that key.
    return CookieJWTAuthMiddleware(URLRouter(websocket_urlpatterns))


@override_settings(CHANNEL_LAYERS={'default': {'BACKEND': 'channels.layers.InMemoryChannelLayer'}})
class ClientThreadConsumerAuthTests(TransactionTestCase):
    """
    TransactionTestCase, not TestCase — WebsocketCommunicator runs the
    consumer in a real separate async context that needs its own DB
    connection/transaction visibility into what this test method
    committed, the same reason Channels' own docs recommend it for
    consumer tests touching the ORM.
    """
    def setUp(self):
        self.user = User.objects.create_user(email='freelancer@example.com', password='Sup3r$ecret1')
        self.user.is_email_verified = True
        self.user.is_active = True
        self.user.save()
        self.portal_client = make_client(self.user)
        self.invoice = make_invoice(self.user, client=self.portal_client)
        InvoiceItem.objects.create(invoice=self.invoice, description='Work', quantity=Decimal('1'), unit_price=Decimal('100'))

    @staticmethod
    def _access_cookie_for_sync(user, password='Sup3r$ecret1'):
        from django.test import Client as DjangoTestClient
        from django.middleware.csrf import get_token
        from django.test import RequestFactory
        rf = RequestFactory()
        dummy = rf.get('/')
        token = get_token(dummy)
        django_client = DjangoTestClient(enforce_csrf_checks=True)
        django_client.cookies['csrftoken'] = dummy.META['CSRF_COOKIE']
        resp = django_client.post(
            reverse('users:login'), data=json.dumps({'login': user.email, 'password': password}),
            content_type='application/json', HTTP_X_CSRFTOKEN=token,
        )
        assert resp.status_code == 200, resp.content
        return django_client.cookies[ACCESS_COOKIE_NAME].value

    async def _access_cookie_for(self, user, password='Sup3r$ecret1'):
        from channels.db import database_sync_to_async
        return await database_sync_to_async(self._access_cookie_for_sync)(user, password)

    async def test_freelancer_owner_is_accepted(self):
        access_token = await self._access_cookie_for(self.user)
        communicator = WebsocketCommunicator(
            make_application(), f'/ws/invoices/thread/{self.invoice.view_token}/',
            headers=[(b'cookie', f'{ACCESS_COOKIE_NAME}={access_token}'.encode())],
        )
        connected, _ = await communicator.connect()
        self.assertTrue(connected)
        await communicator.disconnect()

    async def test_a_different_freelancer_is_rejected(self):
        from channels.db import database_sync_to_async

        def _make_other_user():
            other_user = User.objects.create_user(email='other@example.com', password='Sup3r$ecret1')
            other_user.is_email_verified = True
            other_user.is_active = True
            other_user.save()
            return other_user

        other_user = await database_sync_to_async(_make_other_user)()
        access_token = await self._access_cookie_for(other_user)
        communicator = WebsocketCommunicator(
            make_application(), f'/ws/invoices/thread/{self.invoice.view_token}/',
            headers=[(b'cookie', f'{ACCESS_COOKIE_NAME}={access_token}'.encode())],
        )
        connected, _ = await communicator.connect()
        self.assertTrue(connected)  # accept-before-close, per AuthEchoConsumer's own technique
        event = await communicator.receive_output()
        self.assertEqual(event['type'], 'websocket.close')
        self.assertEqual(event['code'], 4001)

    async def test_the_invoices_own_client_portal_session_is_accepted(self):
        session = await self._create_portal_session()
        communicator = WebsocketCommunicator(
            make_application(), f'/ws/invoices/thread/{self.invoice.view_token}/',
            headers=[(b'cookie', f'{PORTAL_SESSION_COOKIE_NAME}=portal-raw-tok'.encode())],
        )
        connected, _ = await communicator.connect()
        self.assertTrue(connected)
        await communicator.disconnect()

    async def test_a_different_clients_portal_session_is_rejected(self):
        from channels.db import database_sync_to_async
        other_client = await database_sync_to_async(make_client)(self.user, name='Beta Co', email='beta@example.com')
        await database_sync_to_async(ClientPortalSession.create_for_client)(
            other_client, 'other-client-tok', device_name='', ip_address=None, user_agent='',
        )
        communicator = WebsocketCommunicator(
            make_application(), f'/ws/invoices/thread/{self.invoice.view_token}/',
            headers=[(b'cookie', f'{PORTAL_SESSION_COOKIE_NAME}=other-client-tok'.encode())],
        )
        connected, _ = await communicator.connect()
        self.assertTrue(connected)
        event = await communicator.receive_output()
        self.assertEqual(event['type'], 'websocket.close')
        self.assertEqual(event['code'], 4001)

    async def test_no_identity_at_all_is_rejected(self):
        communicator = WebsocketCommunicator(make_application(), f'/ws/invoices/thread/{self.invoice.view_token}/')
        connected, _ = await communicator.connect()
        self.assertTrue(connected)
        event = await communicator.receive_output()
        self.assertEqual(event['type'], 'websocket.close')
        self.assertEqual(event['code'], 4001)

    async def test_unknown_view_token_is_rejected_with_a_distinct_code(self):
        communicator = WebsocketCommunicator(make_application(), '/ws/invoices/thread/this-token-does-not-exist/')
        connected, _ = await communicator.connect()
        self.assertTrue(connected)
        event = await communicator.receive_output()
        self.assertEqual(event['type'], 'websocket.close')
        self.assertEqual(event['code'], 4004)

    async def _create_portal_session(self):
        from channels.db import database_sync_to_async
        return await database_sync_to_async(ClientPortalSession.create_for_client)(
            self.portal_client, 'portal-raw-tok', device_name='', ip_address=None, user_agent='',
        )


@override_settings(CHANNEL_LAYERS={'default': {'BACKEND': 'channels.layers.InMemoryChannelLayer'}})
class ClientThreadConsumerBroadcastTests(TransactionTestCase):
    def setUp(self):
        self.user = User.objects.create_user(email='freelancer@example.com', password='Sup3r$ecret1')
        self.portal_client = make_client(self.user)
        self.invoice = make_invoice(self.user, client=self.portal_client)
        InvoiceItem.objects.create(invoice=self.invoice, description='Work', quantity=Decimal('1'), unit_price=Decimal('100'))

    async def test_a_broadcast_comment_reaches_a_connected_client(self):
        from channels.db import database_sync_to_async
        await database_sync_to_async(ClientPortalSession.create_for_client)(
            self.portal_client, 'broadcast-tok', device_name='', ip_address=None, user_agent='',
        )
        communicator = WebsocketCommunicator(
            make_application(), f'/ws/invoices/thread/{self.invoice.view_token}/',
            headers=[(b'cookie', f'{PORTAL_SESSION_COOKIE_NAME}=broadcast-tok'.encode())],
        )
        connected, _ = await communicator.connect()
        self.assertTrue(connected)

        comment = await database_sync_to_async(InvoiceComment.objects.create)(
            invoice=self.invoice, author_type='freelancer', author_user=self.user, source='app', body_text='live message',
        )
        await database_sync_to_async(broadcast_comment)(comment)

        received = await communicator.receive_from()
        payload = json.loads(received)
        self.assertEqual(payload['body_text'], 'live message')
        self.assertEqual(payload['author_type'], 'freelancer')

        await communicator.disconnect()
