# apps/users/tests/test_login.py
import json
from unittest.mock import patch

from django.core.cache import cache
from django.middleware.csrf import get_token
from django.test import Client, RequestFactory, TestCase
from django.urls import reverse

from apps.users.cookies import ACCESS_COOKIE_NAME, REFRESH_COOKIE_NAME
from apps.users.models import Session, TrustedDevice, User


class LoginTests(TestCase):
    def setUp(self):
        cache.clear()
        self.rf = RequestFactory()
        self.client = Client(enforce_csrf_checks=True)
        self.user = User.objects.create_user(email='ali@example.com', password='Sup3r$ecret1')
        self.user.is_email_verified = True
        self.user.is_active = True
        self.user.save()
        self.csrf_token = self._csrf_token()

    def _csrf_token(self):
        dummy = self.rf.get('/')
        token = get_token(dummy)
        self.client.cookies['csrftoken'] = dummy.META['CSRF_COOKIE']
        return token

    def _login(self, **overrides):
        payload = {'login': 'ali@example.com', 'password': 'Sup3r$ecret1'}
        payload.update(overrides)
        return self.client.post(
            reverse('users:login'), data=json.dumps(payload), content_type='application/json',
            HTTP_X_CSRFTOKEN=self.csrf_token,
        )

    def test_login_happy_path_sets_cookies_no_tokens_in_body(self):
        resp = self._login()
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertNotIn('access', body)
        self.assertNotIn('refresh', body)
        self.assertIn(ACCESS_COOKIE_NAME, resp.cookies)
        self.assertIn(REFRESH_COOKIE_NAME, resp.cookies)
        self.assertTrue(resp.cookies[ACCESS_COOKIE_NAME]['httponly'])
        self.assertEqual(Session.objects.filter(user=self.user).count(), 1)

    def test_login_wrong_password_rejected(self):
        resp = self._login(password='wrong')
        self.assertEqual(resp.status_code, 401)

    def test_login_unverified_email_blocked(self):
        self.user.is_email_verified = False
        self.user.save()
        with patch('apps.users.views.auth.send_verification_email', return_value=True):
            resp = self._login()
        self.assertEqual(resp.status_code, 403)
        self.assertTrue(resp.json()['email_not_verified'])

    @patch('apps.users.views.auth.send_account_locked_email', return_value=True)
    def test_lockout_after_five_failed_attempts(self, mock_locked_email):
        for _ in range(4):
            resp = self._login(password='wrong')
        self.assertEqual(resp.status_code, 401)
        self.user.refresh_from_db()
        self.assertFalse(self.user.is_account_locked())

        resp = self._login(password='wrong')
        self.assertEqual(resp.status_code, 423)
        self.user.refresh_from_db()
        self.assertTrue(self.user.is_account_locked())
        mock_locked_email.assert_called_once()

    def test_session_cap_evicts_oldest(self):
        for _ in range(4):
            self._login()
        self.assertEqual(Session.objects.filter(user=self.user).count(), 3)

    @patch('apps.users.views.auth.send_2fa_code_email', return_value=True)
    def test_2fa_required_returns_no_cookies(self, mock_2fa_email):
        self.user.two_fa_enabled = True
        self.user.save()
        resp = self._login()
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()['requires_2fa'])
        self.assertNotIn(ACCESS_COOKIE_NAME, resp.cookies)

    @patch('apps.users.views.auth.send_2fa_code_email', return_value=True)
    def test_2fa_verify_wrong_code_rejected(self, mock_2fa_email):
        self.user.two_fa_enabled = True
        self.user.save()
        resp = self._login()
        session_id = resp.json()['session_id']
        resp = self.client.post(reverse('users:2fa_verify'), data=json.dumps({
            'session_id': session_id, 'otp_code': '000000',
        }), content_type='application/json', HTTP_X_CSRFTOKEN=self.csrf_token)
        self.assertEqual(resp.status_code, 400)

    @patch('apps.users.views.auth.send_2fa_code_email', return_value=True)
    @patch('apps.users.views.auth.check_password', return_value=True)
    def test_2fa_verify_correct_code_with_trust_device(self, mock_check, mock_email):
        self.user.two_fa_enabled = True
        self.user.save()
        resp = self._login()
        session_id = resp.json()['session_id']
        resp = self.client.post(reverse('users:2fa_verify'), data=json.dumps({
            'session_id': session_id, 'otp_code': '123456', 'trust_device': True,
        }), content_type='application/json', HTTP_X_CSRFTOKEN=self.csrf_token)
        self.assertEqual(resp.status_code, 200)
        self.assertIn(ACCESS_COOKIE_NAME, resp.cookies)
        self.assertTrue(TrustedDevice.objects.filter(user=self.user).exists())

    def test_logout_revokes_session_and_clears_cookies(self):
        from django.middleware.csrf import get_token
        from django.test import RequestFactory
        self._login()
        rf = RequestFactory()
        dummy = rf.get('/')
        csrf_token = get_token(dummy)
        self.client.cookies['csrftoken'] = dummy.META['CSRF_COOKIE']

        resp = self.client.post(reverse('users:logout'), content_type='application/json', HTTP_X_CSRFTOKEN=csrf_token)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(Session.objects.filter(user=self.user).count(), 0)
        self.assertEqual(resp.cookies[ACCESS_COOKIE_NAME].value, '')


class RefreshTests(TestCase):
    def setUp(self):
        cache.clear()
        self.rf = RequestFactory()
        self.client = Client(enforce_csrf_checks=True)
        self.user = User.objects.create_user(email='refresh@example.com', password='Sup3r$ecret1')
        self.user.is_email_verified = True
        self.user.is_active = True
        self.user.save()
        self.csrf_token = self._csrf_token()

    def _csrf_token(self):
        dummy = self.rf.get('/')
        token = get_token(dummy)
        self.client.cookies['csrftoken'] = dummy.META['CSRF_COOKIE']
        return token

    def test_refresh_works_with_expired_access_cookie(self):
        """
        The whole point of /refresh/ is to work when the access token has
        expired — this is the scenario that would have silently broken
        in production if authentication weren't disabled on this view.
        See NO_AUTH in views/auth.py.
        """
        from datetime import timedelta
        from rest_framework_simplejwt.tokens import AccessToken

        resp = self.client.post(
            reverse('users:login'), data=json.dumps({
                'login': 'refresh@example.com', 'password': 'Sup3r$ecret1',
            }), content_type='application/json', HTTP_X_CSRFTOKEN=self.csrf_token,
        )
        refresh_cookie_value = resp.cookies[REFRESH_COOKIE_NAME].value

        expired_access = AccessToken.for_user(self.user)
        expired_access.set_exp(lifetime=timedelta(seconds=-10))
        self.client.cookies[ACCESS_COOKIE_NAME] = str(expired_access)
        self.client.cookies[REFRESH_COOKIE_NAME] = refresh_cookie_value

        resp = self.client.post(
            reverse('users:token_refresh'), content_type='application/json',
            HTTP_X_CSRFTOKEN=self.csrf_token,
        )
        self.assertEqual(resp.status_code, 200)
        self.assertNotEqual(resp.cookies[REFRESH_COOKIE_NAME].value, refresh_cookie_value)
        self.assertEqual(Session.objects.filter(user=self.user).count(), 1)

    def test_refresh_with_no_cookie_returns_401(self):
        resp = self.client.post(
            reverse('users:token_refresh'), content_type='application/json',
            HTTP_X_CSRFTOKEN=self.csrf_token,
        )
        self.assertEqual(resp.status_code, 401)