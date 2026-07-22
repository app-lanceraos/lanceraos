# apps/users/tests/test_sessions.py
import json
import uuid

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

    def _login(self, client, email='sessions@example.com'):
        return client.post(reverse('users:login'), data=json.dumps({
            'login': email, 'password': 'Sup3r$ecret1',
        }), content_type='application/json')

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