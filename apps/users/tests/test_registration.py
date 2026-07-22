# apps/users/tests/test_registration.py
import json
from unittest.mock import patch

from django.core.cache import cache
from django.test import Client, TestCase
from django.urls import reverse

from apps.users.models import User


class RegistrationTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = Client(enforce_csrf_checks=True)
        self.valid_payload = {
            'email': 'ali@example.com', 'username': 'aliamir',
            'password': 'Sup3r$ecret1', 'confirm_password': 'Sup3r$ecret1',
            'first_name': 'Ali', 'last_name': 'Amir', 'date_of_birth': '2000-01-01',
        }

    def _post(self, path, payload):
        return self.client.post(path, data=json.dumps(payload), content_type='application/json')

    @patch('apps.users.views.auth.send_verification_email', return_value=True)
    def test_register_happy_path_creates_unverified_user(self, mock_email):
        resp = self._post(reverse('users:register'), self.valid_payload)
        self.assertEqual(resp.status_code, 201)
        user = User.objects.get(email='ali@example.com')
        self.assertFalse(user.is_email_verified)
        mock_email.assert_called_once()

    @patch('apps.users.views.auth.send_verification_email', return_value=True)
    def test_register_under_16_rejected(self, mock_email):
        payload = dict(self.valid_payload, date_of_birth='2015-01-01')
        resp = self._post(reverse('users:register'), payload)
        self.assertEqual(resp.status_code, 400)
        self.assertIn('date_of_birth', resp.json())

    @patch('apps.users.views.auth.send_verification_email', return_value=True)
    def test_register_disposable_email_rejected(self, mock_email):
        payload = dict(self.valid_payload, email='x@mailinator.com')
        resp = self._post(reverse('users:register'), payload)
        self.assertEqual(resp.status_code, 400)
        self.assertIn('email', resp.json())

    @patch('apps.users.views.auth.send_verification_email', return_value=True)
    def test_register_reserved_username_rejected(self, mock_email):
        payload = dict(self.valid_payload, username='admin')
        resp = self._post(reverse('users:register'), payload)
        self.assertEqual(resp.status_code, 400)
        self.assertIn('username', resp.json())

    @patch('apps.users.views.auth.send_verification_email', return_value=True)
    def test_register_password_mismatch_rejected(self, mock_email):
        payload = dict(self.valid_payload, confirm_password='different')
        resp = self._post(reverse('users:register'), payload)
        self.assertEqual(resp.status_code, 400)

    @patch('apps.users.views.auth.send_verification_email', return_value=True)
    def test_register_duplicate_email_rejected(self, mock_email):
        self._post(reverse('users:register'), self.valid_payload)
        resp = self._post(reverse('users:register'), dict(self.valid_payload, username='different'))
        self.assertEqual(resp.status_code, 400)
        self.assertIn('email', resp.json())

    @patch('apps.users.views.auth.send_verification_email', return_value=True)
    def test_registration_rate_limit(self, mock_email):
        for i in range(10):
            payload = dict(self.valid_payload, email=f'user{i}@example.com', username=f'user{i}')
            self._post(reverse('users:register'), payload)
        resp = self._post(reverse('users:register'), dict(self.valid_payload, email='overlimit@example.com', username='overlimit'))
        self.assertEqual(resp.status_code, 429)

    def test_check_availability_email_taken(self):
        User.objects.create_user(email='taken@example.com', password='x')
        resp = self.client.post(reverse('users:check_availability'), data=json.dumps({
            'field': 'email', 'value': 'taken@example.com',
        }), content_type='application/json')
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(resp.json()['available'])

    def test_check_availability_username_free(self):
        resp = self.client.post(reverse('users:check_availability'), data=json.dumps({
            'field': 'username', 'value': 'brandnewname',
        }), content_type='application/json')
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()['available'])


class EmailVerificationTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = Client(enforce_csrf_checks=True)
        self.user = User.objects.create_user(email='verify@example.com', password='Sup3r$ecret1')

    @patch('apps.users.views.auth.send_welcome_email', return_value=True)
    def test_verify_email_happy_path(self, mock_welcome):
        from apps.users.tokens import email_verification_token, encode_uid
        uid = encode_uid(self.user)
        token = email_verification_token.make_token(self.user)
        resp = self.client.get(reverse('users:verify_email', kwargs={'uid': uid, 'token': token}))
        self.assertEqual(resp.status_code, 200)
        self.user.refresh_from_db()
        self.assertTrue(self.user.is_email_verified)
        self.assertTrue(self.user.is_active)
        mock_welcome.assert_called_once()

    def test_verify_email_wrong_token_rejected(self):
        from apps.users.tokens import encode_uid
        uid = encode_uid(self.user)
        resp = self.client.get(reverse('users:verify_email', kwargs={'uid': uid, 'token': 'garbage'}))
        self.assertEqual(resp.status_code, 400)

    def test_verify_email_already_verified(self):
        from apps.users.tokens import email_verification_token, encode_uid
        uid = encode_uid(self.user)
        token = email_verification_token.make_token(self.user)
        self.user.is_email_verified = True
        self.user.save()
        resp = self.client.get(reverse('users:verify_email', kwargs={'uid': uid, 'token': token}))
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()['already_verified'])