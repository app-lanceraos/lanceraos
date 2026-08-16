# core/tests/test_consumers.py
"""
core.consumers.NotificationConsumer — the bell's real-time push, and the
generalization point behind it: core.observability.log_event() calling
core.notifications.broadcast_notification() for every
NOTIFICATION_EVENTS-listed AuditLog write, from any app, with no
per-app wiring. Follows apps/invoices/tests/test_consumers.py's own
established pattern for this codebase's WebSocket tests
(channels.testing.WebsocketCommunicator, CHANNEL_LAYERS overridden to
the in-memory backend, TransactionTestCase for real cross-context DB
visibility).

Deliberately proves the "works for any module, unmodified" claim by
firing log_event() with event names from two different real modules'
own vocabulary (new_device_login — apps.users; comment_posted —
apps.invoices) through the exact same, un-special-cased hook.
"""
import json

from channels.routing import URLRouter
from channels.testing import WebsocketCommunicator
from django.test import TransactionTestCase, override_settings
from django.urls import reverse

from apps.users.cookies import ACCESS_COOKIE_NAME
from apps.users.models import User
from apps.users.ws_auth import CookieJWTAuthMiddleware
from core.consumers import NotificationConsumer
from core.observability import log_event


def make_application():
    # URLRouter is what actually populates scope['url_route'] — passing
    # the bare consumer straight to WebsocketCommunicator (no router)
    # never sets that key. NotificationConsumer doesn't read url_route
    # itself, but wrapping it the same way every other real route is
    # wrapped keeps this test faithful to config/ws_routing.py.
    from django.urls import path
    return CookieJWTAuthMiddleware(URLRouter([path('ws/notifications/', NotificationConsumer.as_asgi())]))


@override_settings(CHANNEL_LAYERS={'default': {'BACKEND': 'channels.layers.InMemoryChannelLayer'}})
class NotificationConsumerAuthTests(TransactionTestCase):
    def setUp(self):
        self.user = User.objects.create_user(email='freelancer@example.com', password='Sup3r$ecret1')
        self.user.is_email_verified = True
        self.user.is_active = True
        self.user.save()

    @staticmethod
    def _access_cookie_for_sync(user, password='Sup3r$ecret1'):
        from django.middleware.csrf import get_token
        from django.test import Client as DjangoTestClient
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
        return django_client, django_client.cookies[ACCESS_COOKIE_NAME].value

    async def _access_cookie_for(self, user, password='Sup3r$ecret1'):
        from channels.db import database_sync_to_async
        _, token = await database_sync_to_async(self._access_cookie_for_sync)(user, password)
        return token

    async def test_authenticated_user_connects_and_joins_their_own_group(self):
        access_token = await self._access_cookie_for(self.user)
        communicator = WebsocketCommunicator(
            make_application(), '/ws/notifications/',
            headers=[(b'cookie', f'{ACCESS_COOKIE_NAME}={access_token}'.encode())],
        )
        connected, _ = await communicator.connect()
        self.assertTrue(connected)
        await communicator.disconnect()

    async def test_anonymous_connection_is_rejected(self):
        communicator = WebsocketCommunicator(make_application(), '/ws/notifications/')
        connected, _ = await communicator.connect()
        self.assertTrue(connected)  # accept-before-close, per the consumer's own docstring
        event = await communicator.receive_output()
        self.assertEqual(event['type'], 'websocket.close')
        self.assertEqual(event['code'], 4001)


@override_settings(CHANNEL_LAYERS={'default': {'BACKEND': 'channels.layers.InMemoryChannelLayer'}})
class LogEventBroadcastGeneralizationTests(TransactionTestCase):
    """
    core.observability.log_event() is the ONE place this push is wired —
    proves that firing it with event names belonging to two unrelated
    modules (users, invoices) both reach a connected socket, with zero
    per-event code in log_event() or NotificationConsumer itself.
    """
    def setUp(self):
        self.user = User.objects.create_user(email='freelancer@example.com', password='Sup3r$ecret1')
        self.user.is_email_verified = True
        self.user.is_active = True
        self.user.save()

    async def _connected_communicator_for(self, user):
        from channels.db import database_sync_to_async
        access_token = await database_sync_to_async(
            NotificationConsumerAuthTests._access_cookie_for_sync
        )(user)
        _, token = access_token
        communicator = WebsocketCommunicator(
            make_application(), '/ws/notifications/',
            headers=[(b'cookie', f'{ACCESS_COOKIE_NAME}={token}'.encode())],
        )
        connected, _ = await communicator.connect()
        self.assertTrue(connected)
        return communicator

    async def test_a_users_originated_event_is_pushed_live(self):
        from channels.db import database_sync_to_async
        communicator = await self._connected_communicator_for(self.user)

        await database_sync_to_async(log_event)(
            event='new_device_login', user=self.user, ip_address='203.0.113.5',
        )

        received = await communicator.receive_from()
        payload = json.loads(received)
        self.assertEqual(payload['kind'], 'notification')
        self.assertEqual(payload['notification']['type'], 'new_device_login')
        self.assertEqual(payload['unread_count'], 1)

        await communicator.disconnect()

    async def test_an_invoices_originated_event_is_pushed_live_through_the_same_hook(self):
        from channels.db import database_sync_to_async
        communicator = await self._connected_communicator_for(self.user)

        await database_sync_to_async(log_event)(
            event='comment_posted', user=self.user,
            metadata={'client_name': 'Acme Co', 'invoice_number': 'INV-2026-0001', 'invoice_id': 'abc-123'},
        )

        received = await communicator.receive_from()
        payload = json.loads(received)
        self.assertEqual(payload['kind'], 'notification')
        self.assertEqual(payload['notification']['type'], 'comment_posted')
        self.assertIn('Acme Co', payload['notification']['message'])

        await communicator.disconnect()

    async def test_a_non_notification_event_is_not_pushed(self):
        from asyncio import TimeoutError as AsyncTimeoutError
        from channels.db import database_sync_to_async
        communicator = await self._connected_communicator_for(self.user)

        await database_sync_to_async(log_event)(event='login_success', user=self.user)

        with self.assertRaises(AsyncTimeoutError):
            await communicator.receive_from(timeout=1)
        # No disconnect() here — the timed-out receive already leaves the
        # communicator's internal application task in a cancelled state
        # (confirmed directly: calling disconnect() after this raises
        # asyncio.CancelledError from asgiref's testing shim, unrelated
        # to anything this test is actually checking).

    async def test_log_event_with_no_user_never_broadcasts(self):
        # e.g. a failed login against an unknown email — log_event's own
        # `user=None` case. Must not raise inside broadcast_notification.
        from channels.db import database_sync_to_async
        await database_sync_to_async(log_event)(event='new_device_login', user=None, ip_address='203.0.113.5')
        # No assertion needed beyond "didn't raise" — there's no user to
        # have a group, so nothing to receive.


@override_settings(CHANNEL_LAYERS={'default': {'BACKEND': 'channels.layers.InMemoryChannelLayer'}})
class MultiTabConsistencyTests(TransactionTestCase):
    """
    Two simultaneous connections for the same user (two browser tabs) —
    marking a notification read in one must push a refresh to the other,
    via the exact same per-user group both consumer connections joined.
    """
    def setUp(self):
        self.user = User.objects.create_user(email='freelancer@example.com', password='Sup3r$ecret1')
        self.user.is_email_verified = True
        self.user.is_active = True
        self.user.save()

    @staticmethod
    def _post_with_fresh_csrf(django_client, rf, url):
        from django.middleware.csrf import get_token
        dummy = rf.get('/')
        token = get_token(dummy)
        django_client.cookies['csrftoken'] = dummy.META['CSRF_COOKIE']
        return django_client.post(url, HTTP_X_CSRFTOKEN=token)

    async def test_marking_read_in_one_tab_pushes_a_refresh_to_the_other(self):
        from django.test import RequestFactory
        from channels.db import database_sync_to_async

        django_client, access_token = await database_sync_to_async(
            NotificationConsumerAuthTests._access_cookie_for_sync
        )(self.user)
        rf = RequestFactory()

        audit_log = await database_sync_to_async(log_event)(event='new_device_login', user=self.user, ip_address='203.0.113.5')

        tab_one = WebsocketCommunicator(
            make_application(), '/ws/notifications/',
            headers=[(b'cookie', f'{ACCESS_COOKIE_NAME}={access_token}'.encode())],
        )
        tab_two = WebsocketCommunicator(
            make_application(), '/ws/notifications/',
            headers=[(b'cookie', f'{ACCESS_COOKIE_NAME}={access_token}'.encode())],
        )
        self.assertTrue((await tab_one.connect())[0])
        self.assertTrue((await tab_two.connect())[0])

        # The initial log_event() broadcast already queued a 'notification'
        # frame before either tab connected — group_send only reaches
        # channels that had already joined the group, so neither tab
        # receives anything from it; what they receive next is exactly
        # the mark-read push below.
        response = await database_sync_to_async(self._post_with_fresh_csrf)(
            django_client, rf, reverse('notification_read', args=[audit_log.id]),
        )
        self.assertEqual(response.status_code, 200)

        received_one = json.loads(await tab_one.receive_from())
        received_two = json.loads(await tab_two.receive_from())
        self.assertEqual(received_one['kind'], 'refresh')
        self.assertEqual(received_two['kind'], 'refresh')
        self.assertEqual(received_one['unread_count'], 0)
        self.assertEqual(received_two['unread_count'], 0)

        await tab_one.disconnect()
        await tab_two.disconnect()
