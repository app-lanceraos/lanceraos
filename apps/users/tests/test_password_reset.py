# apps/users/tests/test_password_reset.py
import json
from unittest.mock import patch

from django.core.cache import cache
from django.middleware.csrf import get_token
from django.test import Client, RequestFactory, TestCase
from django.urls import reverse

from apps.users.models import Session, User
from apps.users.tokens import encode_uid, password_reset_token


class PasswordResetTests(TestCase):
    def setUp(self):
        cache.clear()
        self.rf = RequestFactory()
        self.client = Client(enforce_csrf_checks=True)
        self.user = User.objects.create_user(email='reset@example.com', password='OldPass!123')
        self.user.is_email_verified = True
        self.user.is_active = True
        self.user.save()
        self.csrf_token = self._csrf_token()

    def _csrf_token(self):
        dummy = self.rf.get('/')
        token = get_token(dummy)
        self.client.cookies['csrftoken'] = dummy.META['CSRF_COOKIE']
        return token

    def _post(self, path, payload):
        return self.client.post(
            path, data=json.dumps(payload), content_type='application/json',
            HTTP_X_CSRFTOKEN=self.csrf_token,
        )

    @patch('apps.users.views.auth.send_password_reset_email_task.delay')
    def test_forgot_password_sends_email_for_existing_verified_user(self, mock_delay):
        resp = self._post(reverse('users:forgot_password'), {'email': 'reset@example.com'})
        self.assertEqual(resp.status_code, 200)
        mock_delay.assert_called_once()
        args = mock_delay.call_args[0]
        self.assertEqual(args[0], str(self.user.pk))

    def test_forgot_password_nonexistent_email_still_returns_200(self):
        """Never reveals whether an email exists."""
        resp = self._post(reverse('users:forgot_password'), {'email': 'nobody@example.com'})
        self.assertEqual(resp.status_code, 200)

    @patch('apps.users.views.auth.send_password_changed_email', return_value=True)
    def test_reset_password_happy_path_invalidates_all_sessions(self, mock_email):
        Session.create_for_user(self.user, 'existing-token', 'device', '1.1.1.1', lifetime_days=30)
        self.assertEqual(Session.objects.filter(user=self.user).count(), 1)

        uid = encode_uid(self.user)
        token = password_reset_token.make_token(self.user)
        resp = self._post(reverse('users:reset_password', kwargs={'uid': uid, 'token': token}), {
            'new_password': 'BrandNewPass!99', 'confirm_password': 'BrandNewPass!99',
        })
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(Session.objects.filter(user=self.user).count(), 0)

        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password('BrandNewPass!99'))

    def test_reset_password_mismatched_confirmation_rejected(self):
        uid = encode_uid(self.user)
        token = password_reset_token.make_token(self.user)
        resp = self._post(reverse('users:reset_password', kwargs={'uid': uid, 'token': token}), {
            'new_password': 'BrandNewPass!99', 'confirm_password': 'Different!99',
        })
        self.assertEqual(resp.status_code, 400)

    def test_reset_password_reused_password_rejected(self):
        uid = encode_uid(self.user)
        token = password_reset_token.make_token(self.user)
        resp = self._post(reverse('users:reset_password', kwargs={'uid': uid, 'token': token}), {
            'new_password': 'OldPass!123', 'confirm_password': 'OldPass!123',
        })
        self.assertEqual(resp.status_code, 400)

    def test_reset_password_invalid_token_rejected(self):
        uid = encode_uid(self.user)
        resp = self._post(reverse('users:reset_password', kwargs={'uid': uid, 'token': 'garbage'}), {
            'new_password': 'BrandNewPass!99', 'confirm_password': 'BrandNewPass!99',
        })
        self.assertEqual(resp.status_code, 400)

    @patch('apps.users.views.auth.send_password_changed_email', return_value=True)
    def test_reset_password_token_cannot_be_reused(self, mock_email):
        uid = encode_uid(self.user)
        token = password_reset_token.make_token(self.user)
        self._post(reverse('users:reset_password', kwargs={'uid': uid, 'token': token}), {
            'new_password': 'BrandNewPass!99', 'confirm_password': 'BrandNewPass!99',
        })

        resp = self._post(reverse('users:reset_password', kwargs={'uid': uid, 'token': token}), {
            'new_password': 'AnotherPass!88', 'confirm_password': 'AnotherPass!88',
        })
        self.assertEqual(resp.status_code, 400)