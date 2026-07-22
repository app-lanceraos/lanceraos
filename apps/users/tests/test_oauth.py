# apps/users/tests/test_oauth.py
import json
from unittest.mock import patch

from django.core.cache import cache
from django.test import Client, TestCase
from django.urls import reverse

from apps.users.models import User, UserSocialAccount
from apps.users.oauth.base import link_or_create_user
from apps.users.oauth.facebook import OAuthVerificationError as FacebookError
from apps.users.oauth.google import OAuthVerificationError as GoogleError


class LinkOrCreateUserTests(TestCase):
    """Tests the shared account-linking logic directly (no HTTP layer)."""

    def test_brand_new_identity_creates_verified_oauth_only_user(self):
        identity = {'provider_uid': 'g-1', 'email': 'new@example.com', 'first_name': 'New', 'last_name': 'Person', 'picture_url': ''}
        user, is_new = link_or_create_user('google', identity)
        self.assertTrue(is_new)
        self.assertTrue(user.is_email_verified)
        self.assertTrue(user.is_oauth_only())

    def test_repeat_login_resolves_to_same_user(self):
        identity = {'provider_uid': 'g-1', 'email': 'new@example.com', 'first_name': '', 'last_name': '', 'picture_url': ''}
        user1, _ = link_or_create_user('google', identity)
        user2, is_new = link_or_create_user('google', identity)
        self.assertEqual(user1.pk, user2.pk)
        self.assertFalse(is_new)

    def test_existing_email_password_account_auto_links(self):
        existing = User.objects.create_user(email='existing@example.com', password='Sup3r$ecret1')
        identity = {'provider_uid': 'g-2', 'email': 'existing@example.com', 'first_name': '', 'last_name': '', 'picture_url': ''}
        user, is_new = link_or_create_user('google', identity)
        self.assertEqual(user.pk, existing.pk)
        self.assertFalse(is_new)
        self.assertTrue(UserSocialAccount.objects.filter(user=existing, provider='google').exists())

    def test_both_providers_can_link_to_same_account(self):
        existing = User.objects.create_user(email='both@example.com', password='Sup3r$ecret1')
        link_or_create_user('google', {'provider_uid': 'g-3', 'email': 'both@example.com', 'first_name': '', 'last_name': '', 'picture_url': ''})
        link_or_create_user('facebook', {'provider_uid': 'f-3', 'email': 'both@example.com', 'first_name': '', 'last_name': '', 'picture_url': ''})
        self.assertEqual(UserSocialAccount.objects.filter(user=existing).count(), 2)

    def test_provider_picture_never_overwrites_existing_logo(self):
        identity = {'provider_uid': 'g-4', 'email': 'haslogo@example.com', 'first_name': '', 'last_name': '', 'picture_url': 'https://provider/pic.jpg'}
        user, _ = link_or_create_user('google', identity)
        user.profile.logo = 'user-chosen-logo.png'
        user.profile.save()
        link_or_create_user('google', identity)
        user.profile.refresh_from_db()
        self.assertEqual(user.profile.logo, 'user-chosen-logo.png')


class OAuthViewTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = Client(enforce_csrf_checks=True)

    @patch('apps.users.views.oauth.verify_google_token')
    def test_google_login_new_user(self, mock_verify):
        mock_verify.return_value = {'provider_uid': 'g-x', 'email': 'gnew@example.com', 'first_name': '', 'last_name': '', 'picture_url': ''}
        resp = self.client.post(reverse('users:google_login'), data=json.dumps({'credential': 'fake'}), content_type='application/json')
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()['is_new_user'])

    @patch('apps.users.views.oauth.verify_google_token', side_effect=GoogleError('invalid'))
    def test_google_login_verification_failure_creates_no_account(self, mock_verify):
        count_before = User.objects.count()
        resp = self.client.post(reverse('users:google_login'), data=json.dumps({'credential': 'garbage'}), content_type='application/json')
        self.assertEqual(resp.status_code, 401)
        self.assertEqual(User.objects.count(), count_before)

    def test_google_login_missing_credential(self):
        resp = self.client.post(reverse('users:google_login'), data=json.dumps({}), content_type='application/json')
        self.assertEqual(resp.status_code, 400)

    @patch('apps.users.views.oauth.verify_facebook_token')
    def test_facebook_login_links_existing_account(self, mock_verify):
        existing = User.objects.create_user(email='fbexisting@example.com', password='Sup3r$ecret1')
        existing.is_email_verified = True
        existing.is_active = True
        existing.save()
        mock_verify.return_value = {'provider_uid': 'f-x', 'email': 'fbexisting@example.com', 'first_name': '', 'last_name': '', 'picture_url': ''}
        resp = self.client.post(reverse('users:facebook_login'), data=json.dumps({'access_token': 'fake'}), content_type='application/json')
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(resp.json()['is_new_user'])

    @patch('apps.users.views.oauth.verify_google_token')
    def test_disabled_account_via_oauth_returns_403(self, mock_verify):
        disabled = User.objects.create_user(email='disabled@example.com', password='Sup3r$ecret1')
        disabled.is_email_verified = True
        disabled.is_active = False
        disabled.save()
        mock_verify.return_value = {'provider_uid': 'g-disabled', 'email': 'disabled@example.com', 'first_name': '', 'last_name': '', 'picture_url': ''}
        resp = self.client.post(reverse('users:google_login'), data=json.dumps({'credential': 'fake'}), content_type='application/json')
        self.assertEqual(resp.status_code, 403)