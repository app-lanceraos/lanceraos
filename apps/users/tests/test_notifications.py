# apps/users/tests/test_notifications.py
import json
from unittest.mock import patch

from django.core.cache import cache
from django.middleware.csrf import get_token
from django.test import Client, RequestFactory, TestCase
from django.urls import reverse

from apps.users.models import User
from core.models import AuditLog, NotificationRead
from core.notifications import NOTIFICATION_EVENTS


class NotificationTests(TestCase):
    def setUp(self):
        cache.clear()
        self.rf = RequestFactory()
        self.client = Client(enforce_csrf_checks=True)
        self.user = User.objects.create_user(email='notif@example.com', password='Sup3r$ecret1')
        self.user.is_email_verified = True
        self.user.is_active = True
        self.user.save()
        # This user's very first login (self.client) never triggers the
        # new-device email/log (last_login is None) — see
        # DeviceRecognitionLoginTests in test_login.py for that regression.
        # Mocked here purely as setup noise, not the subject under test.
        patcher = patch('apps.users.views.auth.send_new_device_login_email', return_value=True)
        self.mock_new_device_email = patcher.start()
        self.addCleanup(patcher.stop)
        self._login(self.client)

    def _login(self, client, email='notif@example.com'):
        csrf_token = self._csrf_token(client)
        return client.post(reverse('users:login'), data=json.dumps({
            'login': email, 'password': 'Sup3r$ecret1',
        }), content_type='application/json', HTTP_X_CSRFTOKEN=csrf_token)

    def _csrf_token(self, client):
        dummy = self.rf.get('/')
        token = get_token(dummy)
        client.cookies['csrftoken'] = dummy.META['CSRF_COOKIE']
        return token

    def _post(self, path, payload):
        csrf_token = self._csrf_token(self.client)
        return self.client.post(
            path, data=json.dumps(payload), content_type='application/json', HTTP_X_CSRFTOKEN=csrf_token,
        )

    def test_list_notifications_only_allowlisted_events_for_requesting_user(self):
        other_user = User.objects.create_user(email='other-notif@example.com', password='Sup3r$ecret1')
        AuditLog.objects.create(user=self.user, event='password_changed')
        AuditLog.objects.create(user=self.user, event='login_success')  # not in the allowlist
        AuditLog.objects.create(user=other_user, event='password_changed')  # different user

        resp = self.client.get(reverse('notifications_list'))
        self.assertEqual(resp.status_code, 200)
        events = [n['type'] for n in resp.json()['notifications']]
        self.assertEqual(events, ['password_changed'])

    def test_every_event_type_has_non_null_action_url(self):
        for event in NOTIFICATION_EVENTS:
            AuditLog.objects.create(user=self.user, event=event)

        resp = self.client.get(reverse('notifications_list'))
        self.assertEqual(resp.status_code, 200)
        data = resp.json()['notifications']
        self.assertEqual(len(data), len(NOTIFICATION_EVENTS))
        for notification in data:
            self.assertIsNotNone(notification['action_url'])

    def test_is_read_reflects_notification_read_row(self):
        log = AuditLog.objects.create(user=self.user, event='password_changed')

        resp = self.client.get(reverse('notifications_list'))
        self.assertFalse(resp.json()['notifications'][0]['is_read'])

        NotificationRead.objects.create(user=self.user, audit_log=log)
        resp = self.client.get(reverse('notifications_list'))
        self.assertTrue(resp.json()['notifications'][0]['is_read'])

    def test_dismiss_removes_from_list_but_audit_log_survives_unchanged(self):
        """
        The single most important test in this suite: dismissing a
        notification must only hide it from the bell — the underlying
        AuditLog row (an immutable, append-only audit trail) must remain
        completely untouched. This is what makes it safe for
        dismiss_notifications to call itself "delete" at all.
        """
        log = AuditLog.objects.create(
            user=self.user, event='password_changed', ip_address='9.9.9.9', metadata={'foo': 'bar'},
        )
        original_created_at = log.created_at
        original_metadata = dict(log.metadata)
        original_ip = log.ip_address

        resp = self._post(reverse('notifications_dismiss'), {'ids': [str(log.id)]})
        self.assertEqual(resp.status_code, 200)

        resp = self.client.get(reverse('notifications_list'))
        ids = [n['id'] for n in resp.json()['notifications']]
        self.assertNotIn(str(log.id), ids)

        # The AuditLog row itself must still exist, completely unchanged.
        self.assertTrue(AuditLog.objects.filter(pk=log.id).exists())
        log.refresh_from_db()
        self.assertEqual(log.event, 'password_changed')
        self.assertEqual(log.ip_address, original_ip)
        self.assertEqual(log.created_at, original_created_at)
        self.assertEqual(log.metadata, original_metadata)

    def test_bulk_mark_read_only_affects_given_ids(self):
        log1 = AuditLog.objects.create(user=self.user, event='password_changed')
        log2 = AuditLog.objects.create(user=self.user, event='2fa_enabled')
        log3 = AuditLog.objects.create(user=self.user, event='2fa_disabled')

        resp = self._post(reverse('notifications_mark_read'), {'ids': [str(log1.id), str(log2.id)]})
        self.assertEqual(resp.status_code, 200)

        resp = self.client.get(reverse('notifications_list'))
        by_id = {n['id']: n['is_read'] for n in resp.json()['notifications']}
        self.assertTrue(by_id[str(log1.id)])
        self.assertTrue(by_id[str(log2.id)])
        self.assertFalse(by_id[str(log3.id)])

    def test_mark_all_notifications_read_zeroes_unread_count(self):
        for event in ['password_changed', '2fa_enabled', '2fa_disabled']:
            AuditLog.objects.create(user=self.user, event=event)

        resp = self.client.get(reverse('notifications_list'))
        self.assertGreater(resp.json()['unread_count'], 0)

        resp = self._post(reverse('notifications_read_all'), {})
        self.assertEqual(resp.status_code, 200)

        resp = self.client.get(reverse('notifications_list'))
        self.assertEqual(resp.json()['unread_count'], 0)

    def test_new_device_login_writes_audit_log_row(self):
        """
        Regression test for a real gap found and closed: a genuinely new
        device login must write a 'new_device_login' AuditLog row (which
        is what the bell actually reads from), not just send an email.
        """
        self.assertFalse(AuditLog.objects.filter(user=self.user, event='new_device_login').exists())

        client2 = Client(enforce_csrf_checks=True)
        self._login(client2)

        self.assertTrue(AuditLog.objects.filter(user=self.user, event='new_device_login').exists())
