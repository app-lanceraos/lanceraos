# apps/users/tests/test_password_reset.py
import json
from unittest.mock import patch

from django.core.cache import cache
from django.test import Client, TestCase
from django.urls import reverse

from apps.users.models import Session, User
from apps.users.tokens import encode_uid, password_reset_token


class PasswordResetTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = Client(enforce_csrf_checks=True)
        self.user = User.objects.create_user(email='reset@example.com', password='OldPass!123')
        self.user.is_email_verified = True
        self.user.is_active = True
        self.user.save()

    @patch('apps.users.views.auth.send_password_reset_email', return_value=True)
    def test_forgot_password_sends_email_for_existing_verified_user(self, mock_email):
        resp = self.client.post(reverse('users:forgot_password'), data=json.dumps({
            'email': 'reset@example.com',
        }), content_type='application/json')
        self.assertEqual(resp.status_code, 200)
        mock_email.assert_called_once()

    def test_forgot_password_nonexistent_email_still_returns_200(self):
        """Never reveals whether an email exists."""
        resp = self.client.post(reverse('users:forgot_password'), data=json.dumps({
            'email': 'nobody@example.com',
        }), content_type='application/json')
        self.assertEqual(resp.status_code, 200)

    @patch('apps.users.views.auth.send_password_changed_email', return_value=True)
    def test_reset_password_happy_path_invalidates_all_sessions(self, mock_email):
        Session.create_for_user(self.user, 'existing-token', 'device', '1.1.1.1', lifetime_days=30)
        self.assertEqual(Session.objects.filter(user=self.user).count(), 1)

        uid = encode_uid(self.user)
        token = password_reset_token.make_token(self.user)
        resp = self.client.post(reverse('users:reset_password', kwargs={'uid': uid, 'token': token}), data=json.dumps({
            'new_password': 'BrandNewPass!99', 'confirm_password': 'BrandNewPass!99',
        }), content_type='application/json')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(Session.objects.filter(user=self.user).count(), 0)

        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password('BrandNewPass!99'))

    def test_reset_password_mismatched_confirmation_rejected(self):
        uid = encode_uid(self.user)
        token = password_reset_token.make_token(self.user)
        resp = self.client.post(reverse('users:reset_password', kwargs={'uid': uid, 'token': token}), data=json.dumps({
            'new_password': 'BrandNewPass!99', 'confirm_password': 'Different!99',
        }), content_type='application/json')
        self.assertEqual(resp.status_code, 400)

    def test_reset_password_reused_password_rejected(self):
        uid = encode_uid(self.user)
        token = password_reset_token.make_token(self.user)
        resp = self.client.post(reverse('users:reset_password', kwargs={'uid': uid, 'token': token}), data=json.dumps({
            'new_password': 'OldPass!123', 'confirm_password': 'OldPass!123',
        }), content_type='application/json')
        self.assertEqual(resp.status_code, 400)

    def test_reset_password_invalid_token_rejected(self):
        uid = encode_uid(self.user)
        resp = self.client.post(reverse('users:reset_password', kwargs={'uid': uid, 'token': 'garbage'}), data=json.dumps({
            'new_password': 'BrandNewPass!99', 'confirm_password': 'BrandNewPass!99',
        }), content_type='application/json')
        self.assertEqual(resp.status_code, 400)

    @patch('apps.users.views.auth.send_password_changed_email', return_value=True)
    def test_reset_password_token_cannot_be_reused(self, mock_email):
        uid = encode_uid(self.user)
        token = password_reset_token.make_token(self.user)
        self.client.post(reverse('users:reset_password', kwargs={'uid': uid, 'token': token}), data=json.dumps({
            'new_password': 'BrandNewPass!99', 'confirm_password': 'BrandNewPass!99',
        }), content_type='application/json')

        resp = self.client.post(reverse('users:reset_password', kwargs={'uid': uid, 'token': token}), data=json.dumps({
            'new_password': 'AnotherPass!88', 'confirm_password': 'AnotherPass!88',
        }), content_type='application/json')
        self.assertEqual(resp.status_code, 400)