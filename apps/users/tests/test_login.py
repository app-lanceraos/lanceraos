# apps/users/tests/test_login.py
import json
import threading
from unittest.mock import patch

from django.core.cache import cache
from django.db import connection
from django.middleware.csrf import get_token
from django.test import Client, RequestFactory, TestCase, TransactionTestCase
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


class DeviceRecognitionLoginTests(TestCase):
    """
    Covers the new-device email / TrustedDevice-recognition logic shared by
    login and verify_2fa (see _get_trusted_device, _update_last_login,
    _create_or_update_trusted_device in views/auth.py).
    """

    def setUp(self):
        cache.clear()
        self.rf = RequestFactory()
        self.client = Client(enforce_csrf_checks=True)
        self.user = User.objects.create_user(email='device@example.com', password='Sup3r$ecret1')
        self.user.is_email_verified = True
        self.user.is_active = True
        self.user.save()
        self.csrf_token = self._csrf_token(self.client)

    def _csrf_token(self, client):
        dummy = self.rf.get('/')
        token = get_token(dummy)
        client.cookies['csrftoken'] = dummy.META['CSRF_COOKIE']
        return token

    def _login(self, client, csrf_token, **overrides):
        payload = {'login': 'device@example.com', 'password': 'Sup3r$ecret1'}
        payload.update(overrides)
        return client.post(
            reverse('users:login'), data=json.dumps(payload), content_type='application/json',
            HTTP_X_CSRFTOKEN=csrf_token,
        )

    @patch('apps.users.views.auth.send_new_device_login_email')
    def test_first_ever_login_does_not_send_new_device_email(self, mock_email):
        """
        Regression test: a brand-new user's very first login must not be
        treated as a "new device" — user.last_login is None at that point,
        which is exactly the case _update_last_login is supposed to skip.
        """
        self.assertIsNone(self.user.last_login)
        resp = self._login(self.client, self.csrf_token)
        self.assertEqual(resp.status_code, 200)
        mock_email.assert_not_called()

    @patch('apps.users.views.auth.send_new_device_login_email', return_value=True)
    def test_second_login_from_new_client_triggers_email_and_creates_trusted_device(self, mock_email):
        self._login(self.client, self.csrf_token)  # first-ever login, no email
        mock_email.assert_not_called()

        client2 = Client(enforce_csrf_checks=True)
        csrf2 = self._csrf_token(client2)
        resp = self._login(client2, csrf2)
        self.assertEqual(resp.status_code, 200)
        mock_email.assert_called_once()

        devices = TrustedDevice.objects.filter(user=self.user)
        self.assertEqual(devices.count(), 2)
        newest = devices.order_by('-created_at').first()
        self.assertFalse(newest.skip_2fa)

    @patch('apps.users.views.auth.send_new_device_login_email', return_value=True)
    def test_recognized_device_does_not_retrigger_new_device_email(self, mock_email):
        self._login(self.client, self.csrf_token)  # first-ever login, no email
        mock_email.assert_not_called()

        resp = self._login(self.client, self.csrf_token)  # same client -> device recognized
        self.assertEqual(resp.status_code, 200)
        mock_email.assert_not_called()

    def test_2fa_required_when_no_skip_device(self):
        self.user.two_fa_enabled = True
        self.user.save()
        with patch('apps.users.views.auth.send_2fa_code_email', return_value=True):
            resp = self._login(self.client, self.csrf_token)
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()['requires_2fa'])

    @patch('apps.users.views.auth.send_2fa_code_email', return_value=True)
    @patch('apps.users.views.auth.check_password', return_value=True)
    def test_2fa_skipped_when_device_has_skip_2fa_true(self, mock_check, mock_2fa_email):
        self.user.two_fa_enabled = True
        self.user.save()
        resp = self._login(self.client, self.csrf_token)
        session_id = resp.json()['session_id']
        resp = self.client.post(reverse('users:2fa_verify'), data=json.dumps({
            'session_id': session_id, 'otp_code': '123456', 'trust_device': True,
        }), content_type='application/json', HTTP_X_CSRFTOKEN=self.csrf_token)
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(TrustedDevice.objects.filter(user=self.user, skip_2fa=True).exists())

        resp = self._login(self.client, self.csrf_token)
        self.assertEqual(resp.status_code, 200)
        self.assertNotIn('requires_2fa', resp.json())

    @patch('apps.users.views.auth.send_2fa_code_email', return_value=True)
    @patch('apps.users.views.auth.check_password', return_value=True)
    def test_verify_2fa_trust_device_upgrades_existing_device_not_duplicate(self, mock_check, mock_2fa_email):
        self._login(self.client, self.csrf_token)  # creates a recognized, skip_2fa=False device
        self.assertEqual(TrustedDevice.objects.filter(user=self.user).count(), 1)
        existing_id = TrustedDevice.objects.get(user=self.user).pk

        self.user.two_fa_enabled = True
        self.user.save()
        resp = self._login(self.client, self.csrf_token)
        session_id = resp.json()['session_id']
        resp = self.client.post(reverse('users:2fa_verify'), data=json.dumps({
            'session_id': session_id, 'otp_code': '123456', 'trust_device': True,
        }), content_type='application/json', HTTP_X_CSRFTOKEN=self.csrf_token)
        self.assertEqual(resp.status_code, 200)

        devices = TrustedDevice.objects.filter(user=self.user)
        self.assertEqual(devices.count(), 1)
        self.assertEqual(devices.first().pk, existing_id)
        self.assertTrue(devices.first().skip_2fa)


class SessionTrustedDeviceLinkTests(TestCase):
    def setUp(self):
        cache.clear()
        self.rf = RequestFactory()
        self.client = Client(enforce_csrf_checks=True)
        self.user = User.objects.create_user(email='link@example.com', password='Sup3r$ecret1')
        self.user.is_email_verified = True
        self.user.is_active = True
        self.user.save()
        self.csrf_token = self._csrf_token()
        patcher = patch('apps.users.views.auth.send_new_device_login_email', return_value=True)
        self.mock_new_device_email = patcher.start()
        self.addCleanup(patcher.stop)

    def _csrf_token(self):
        dummy = self.rf.get('/')
        token = get_token(dummy)
        self.client.cookies['csrftoken'] = dummy.META['CSRF_COOKIE']
        return token

    def _login(self):
        return self.client.post(reverse('users:login'), data=json.dumps({
            'login': 'link@example.com', 'password': 'Sup3r$ecret1',
        }), content_type='application/json', HTTP_X_CSRFTOKEN=self.csrf_token)

    def test_first_session_has_no_trusted_device(self):
        """
        Documented, expected behavior: the device isn't recognized yet at
        the moment the very first session is created, so trusted_device is
        null on it. This must not silently start being treated as a bug.
        """
        self._login()
        session = Session.objects.get(user=self.user)
        self.assertIsNone(session.trusted_device)

    def test_second_login_same_client_links_trusted_device_to_new_session(self):
        self._login()
        self._login()
        sessions = list(Session.objects.filter(user=self.user).order_by('created_at'))
        self.assertEqual(len(sessions), 2)
        self.assertIsNone(sessions[0].trusted_device)
        self.assertIsNotNone(sessions[1].trusted_device)

    def test_session_cap_eviction_preserves_trusted_device_linkage(self):
        for _ in range(4):
            self._login()
        sessions = list(Session.objects.filter(user=self.user).order_by('created_at'))
        self.assertEqual(len(sessions), 3)
        device_ids = {s.trusted_device_id for s in sessions}
        self.assertEqual(len(device_ids), 1)
        self.assertIsNotNone(next(iter(device_ids)))


class ConcurrentLoginTests(TransactionTestCase):
    """
    Permanent version of a regression previously demonstrated with a
    temporary threaded test: Session.create_for_user's select_for_update
    locking must prevent concurrent logins from racing past
    MAX_SESSIONS_PER_USER.
    """

    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(email='concurrent@example.com', password='Sup3r$ecret1')
        self.user.is_email_verified = True
        self.user.is_active = True
        self.user.save()

    @patch('apps.users.views.auth.send_new_device_login_email', return_value=True)
    def test_ten_simultaneous_logins_produce_exactly_three_sessions(self, mock_email):
        errors = []

        def do_login():
            try:
                client = Client(enforce_csrf_checks=True)
                rf = RequestFactory()
                dummy = rf.get('/')
                token = get_token(dummy)
                client.cookies['csrftoken'] = dummy.META['CSRF_COOKIE']
                resp = client.post(reverse('users:login'), data=json.dumps({
                    'login': 'concurrent@example.com', 'password': 'Sup3r$ecret1',
                }), content_type='application/json', HTTP_X_CSRFTOKEN=token)
                if resp.status_code != 200:
                    errors.append(resp.status_code)
            except Exception as exc:
                errors.append(exc)
            finally:
                connection.close()

        threads = [threading.Thread(target=do_login) for _ in range(10)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        self.assertEqual(errors, [])
        self.assertEqual(Session.objects.filter(user=self.user).count(), 3)