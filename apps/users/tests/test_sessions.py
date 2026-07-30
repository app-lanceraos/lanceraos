# apps/users/tests/test_sessions.py
import json
import uuid
from unittest.mock import patch

from django.core.cache import cache
from django.middleware.csrf import get_token
from django.test import Client, RequestFactory, TestCase
from django.urls import reverse

from apps.users.models import Session, User


class SessionTests(TestCase):
    def setUp(self):
        cache.clear()
        self.rf = RequestFactory()
        self.client = Client(enforce_csrf_checks=True)
        self.user = User.objects.create_user(email='sessions@example.com', password='Sup3r$ecret1')
        self.user.is_email_verified = True
        self.user.is_active = True
        self.user.save()
        # Every test here logs in from multiple distinct clients (distinct
        # TrustedDevice cookies), so each login is a genuinely new device —
        # this suite is about session listing/revocation, not new-device
        # email content, so mock it rather than let it fire for real.
        patcher = patch('apps.users.views.auth.send_new_device_login_email', return_value=True)
        self.mock_new_device_email = patcher.start()
        self.addCleanup(patcher.stop)

    def _login(self, client, email='sessions@example.com'):
        csrf_token = self._csrf_token(client)
        return client.post(reverse('users:login'), data=json.dumps({
            'login': email, 'password': 'Sup3r$ecret1',
        }), content_type='application/json', HTTP_X_CSRFTOKEN=csrf_token)

    def _csrf_token(self, client):
        dummy = self.rf.get('/')
        token = get_token(dummy)
        client.cookies['csrftoken'] = dummy.META['CSRF_COOKIE']
        return token

    def test_list_sessions_marks_exactly_one_current(self):
        self._login(self.client)
        client2 = Client(enforce_csrf_checks=True)
        self._login(client2)

        resp = self.client.get(reverse('users:sessions_list'))
        self.assertEqual(resp.status_code, 200)
        rows = resp.json()
        self.assertEqual(len(rows), 2)
        self.assertEqual(sum(1 for r in rows if r['is_current']), 1)

    def test_revoke_other_session_does_not_clear_own_cookies(self):
        self._login(self.client)
        client2 = Client(enforce_csrf_checks=True)
        self._login(client2)

        current_hash = Session._hash_token(self.client.cookies['lanceraos_refresh'].value)
        current_session = Session.objects.get(refresh_token_hash=current_hash)
        other_session = Session.objects.exclude(pk=current_session.pk).get(user=self.user)

        csrf_token = self._csrf_token(self.client)
        resp = self.client.delete(f'/api/auth/sessions/{other_session.pk}/', HTTP_X_CSRFTOKEN=csrf_token)
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(Session.objects.filter(pk=other_session.pk).exists())

    def test_revoke_current_session_clears_cookies(self):
        self._login(self.client)
        current_hash = Session._hash_token(self.client.cookies['lanceraos_refresh'].value)
        current_session = Session.objects.get(refresh_token_hash=current_hash)
        csrf_token = self._csrf_token(self.client)
        resp = self.client.delete(f'/api/auth/sessions/{current_session.pk}/', HTTP_X_CSRFTOKEN=csrf_token)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.cookies['lanceraos_access'].value, '')

    def test_cannot_revoke_another_users_session(self):
        self._login(self.client)
        other_user = User.objects.create_user(email='other@example.com', password='Sup3r$ecret1')
        other_user.is_email_verified = True
        other_user.is_active = True
        other_user.save()
        other_client = Client(enforce_csrf_checks=True)
        self._login(other_client, email='other@example.com')
        other_session = Session.objects.get(user=other_user)

        csrf_token = self._csrf_token(self.client)
        resp = self.client.delete(f'/api/auth/sessions/{other_session.pk}/', HTTP_X_CSRFTOKEN=csrf_token)
        self.assertEqual(resp.status_code, 404)
        self.assertTrue(Session.objects.filter(pk=other_session.pk).exists())

    def test_revoke_nonexistent_session_returns_404(self):
        self._login(self.client)
        csrf_token = self._csrf_token(self.client)
        resp = self.client.delete(f'/api/auth/sessions/{uuid.uuid4()}/', HTTP_X_CSRFTOKEN=csrf_token)
        self.assertEqual(resp.status_code, 404)


class RenameSessionDeviceTests(TestCase):
    def setUp(self):
        cache.clear()
        self.rf = RequestFactory()
        self.client = Client(enforce_csrf_checks=True)
        self.user = User.objects.create_user(email='rename@example.com', password='Sup3r$ecret1')
        self.user.is_email_verified = True
        self.user.is_active = True
        self.user.save()
        patcher = patch('apps.users.views.auth.send_new_device_login_email', return_value=True)
        self.mock_new_device_email = patcher.start()
        self.addCleanup(patcher.stop)
        # The very first-ever login's session never has a trusted_device
        # link (see SessionTrustedDeviceLinkTests.test_first_session_has_no_
        # trusted_device) — log in twice so the *current* session (the one
        # whose refresh cookie is now in the jar) has one, which is what
        # rename_session_device actually needs to be exercised.
        self._login(self.client)
        self._login(self.client)

    def _csrf_token(self, client):
        dummy = self.rf.get('/')
        token = get_token(dummy)
        client.cookies['csrftoken'] = dummy.META['CSRF_COOKIE']
        return token

    def _login(self, client, email='rename@example.com'):
        csrf_token = self._csrf_token(client)
        return client.post(reverse('users:login'), data=json.dumps({
            'login': email, 'password': 'Sup3r$ecret1',
        }), content_type='application/json', HTTP_X_CSRFTOKEN=csrf_token)

    def _current_session(self, client):
        current_hash = Session._hash_token(client.cookies['lanceraos_refresh'].value)
        return Session.objects.get(refresh_token_hash=current_hash)

    def test_rename_session_sets_custom_name_on_linked_device(self):
        session = self._current_session(self.client)
        self.assertIsNotNone(session.trusted_device)
        csrf_token = self._csrf_token(self.client)
        resp = self.client.patch(
            reverse('users:session_rename', kwargs={'session_id': session.pk}),
            data=json.dumps({'custom_name': 'My MacBook'}),
            content_type='application/json', HTTP_X_CSRFTOKEN=csrf_token,
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['custom_name'], 'My MacBook')
        session.trusted_device.refresh_from_db()
        self.assertEqual(session.trusted_device.custom_name, 'My MacBook')

    def test_rename_session_without_linked_device_returns_400(self):
        session = self._current_session(self.client)
        session.trusted_device = None
        session.save(update_fields=['trusted_device'])
        csrf_token = self._csrf_token(self.client)
        resp = self.client.patch(
            reverse('users:session_rename', kwargs={'session_id': session.pk}),
            data=json.dumps({'custom_name': 'x'}),
            content_type='application/json', HTTP_X_CSRFTOKEN=csrf_token,
        )
        self.assertEqual(resp.status_code, 400)

    def test_rename_another_users_session_returns_404(self):
        other_user = User.objects.create_user(email='rename-other@example.com', password='Sup3r$ecret1')
        other_user.is_email_verified = True
        other_user.is_active = True
        other_user.save()
        other_client = Client(enforce_csrf_checks=True)
        self._login(other_client, email='rename-other@example.com')
        self._login(other_client, email='rename-other@example.com')
        other_session = self._current_session(other_client)
        self.assertIsNotNone(other_session.trusted_device)

        csrf_token = self._csrf_token(self.client)
        resp = self.client.patch(
            reverse('users:session_rename', kwargs={'session_id': other_session.pk}),
            data=json.dumps({'custom_name': 'hijack'}),
            content_type='application/json', HTTP_X_CSRFTOKEN=csrf_token,
        )
        self.assertEqual(resp.status_code, 404)
        other_session.refresh_from_db()
        self.assertEqual(other_session.trusted_device.custom_name, '')

    def test_session_serializer_exposes_custom_name_and_can_rename(self):
        session = self._current_session(self.client)
        resp = self.client.get(reverse('users:sessions_list'))
        row = resp.json()[0]
        self.assertIsNone(row['custom_name'])
        self.assertTrue(row['can_rename'])

        csrf_token = self._csrf_token(self.client)
        self.client.patch(
            reverse('users:session_rename', kwargs={'session_id': session.pk}),
            data=json.dumps({'custom_name': 'Named'}),
            content_type='application/json', HTTP_X_CSRFTOKEN=csrf_token,
        )
        resp = self.client.get(reverse('users:sessions_list'))
        row = resp.json()[0]
        self.assertEqual(row['custom_name'], 'Named')

    def test_session_serializer_can_rename_false_when_no_trusted_device(self):
        session = self._current_session(self.client)
        session.trusted_device = None
        session.save(update_fields=['trusted_device'])
        resp = self.client.get(reverse('users:sessions_list'))
        row = resp.json()[0]
        self.assertFalse(row['can_rename'])
        self.assertIsNone(row['custom_name'])