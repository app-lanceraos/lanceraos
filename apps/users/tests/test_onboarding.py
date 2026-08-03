# apps/users/tests/test_onboarding.py
import json
from unittest.mock import patch

from django.core.cache import cache
from django.middleware.csrf import get_token
from django.test import Client, RequestFactory, TestCase
from django.urls import reverse
from django.utils import timezone

from apps.users.constants import CURRENT_TERMS_VERSION
from apps.users.models import FreelancerProfile, User
from apps.users.oauth.base import link_or_create_user
from apps.users.token_service import issue_tokens_and_session

VALID_ONBOARDING_PAYLOAD = {
    'username': 'onboardeduser',
    'profession': 'Web Developer',
    'income_source': 'full_time',
    'platform_used': 'upwork',
}


class _FakeRequest:
    META = {'HTTP_USER_AGENT': 'test', 'REMOTE_ADDR': '1.1.1.1'}


class OnboardingTestBase(TestCase):
    def setUp(self):
        cache.clear()
        self.rf = RequestFactory()

    def _csrf_token(self, client):
        dummy = self.rf.get('/')
        token = get_token(dummy)
        client.cookies['csrftoken'] = dummy.META['CSRF_COOKIE']
        return token

    def _post(self, client, path, payload):
        csrf_token = self._csrf_token(client)
        return client.post(
            path, data=json.dumps(payload), content_type='application/json', HTTP_X_CSRFTOKEN=csrf_token,
        )

    def _authenticated_client(self, user):
        """
        OAuth-only users have no password, so the normal login endpoint
        can't authenticate them — same pattern used in
        test_deletion.py's OAuth-only test: issue a session directly and
        set the access cookie.
        """
        client = Client(enforce_csrf_checks=True)
        access, _refresh_str, _session = issue_tokens_and_session(user, _FakeRequest(), remember_me=False)
        client.cookies['lanceraos_access'] = access
        return client

    def _make_oauth_user(self, email):
        user, _is_new = link_or_create_user('google', {
            'provider_uid': f'g-{email}', 'email': email,
            'first_name': 'OAuth', 'last_name': '', 'picture_url': '',
        })
        return user

    def _make_password_user(self, email):
        """
        Simulates a user who registered through the normal email/password
        flow, where RegisterSerializer.create() already recorded terms
        acceptance — this is the state onboarding should find them in.
        """
        user = User.objects.create_user(email=email, password='Sup3r$ecret1')
        user.is_email_verified = True
        user.is_active = True
        user.date_of_birth = '2000-01-01'
        user.terms_accepted_at = timezone.now()
        user.terms_version = CURRENT_TERMS_VERSION
        user.save()
        return user


class OAuthOnboardingTermsTests(OnboardingTestBase):
    def test_fresh_oauth_signup_has_no_terms_accepted_at_via_me_endpoint(self):
        """
        This is the actual contract Onboarding.jsx's needsTermsAcceptance
        check relies on (!user?.terms_accepted_at) — a fresh OAuth signup
        must see this come back null from /auth/me/, or the frontend has
        no way to know to show the checkbox.
        """
        user = self._make_oauth_user('oauthnew@example.com')
        client = self._authenticated_client(user)
        resp = client.get(reverse('users:me'))
        self.assertEqual(resp.status_code, 200)
        self.assertIsNone(resp.json()['terms_accepted_at'])

    def test_complete_onboarding_oauth_user_without_checkbox_rejected(self):
        user = self._make_oauth_user('oauthreject@example.com')
        client = self._authenticated_client(user)
        payload = dict(VALID_ONBOARDING_PAYLOAD, date_of_birth='2000-01-01')
        resp = self._post(client, reverse('users:onboarding_complete'), payload)
        self.assertEqual(resp.status_code, 400)
        self.assertIn('agreed_to_terms', resp.json())
        user.profile.refresh_from_db()
        self.assertFalse(user.profile.onboarding_completed)

    def test_complete_onboarding_oauth_user_checkbox_false_rejected(self):
        user = self._make_oauth_user('oauthfalse@example.com')
        client = self._authenticated_client(user)
        payload = dict(VALID_ONBOARDING_PAYLOAD, date_of_birth='2000-01-01', agreed_to_terms=False)
        resp = self._post(client, reverse('users:onboarding_complete'), payload)
        self.assertEqual(resp.status_code, 400)
        self.assertIn('agreed_to_terms', resp.json())

    def test_complete_onboarding_oauth_user_with_checkbox_succeeds_and_records_acceptance(self):
        user = self._make_oauth_user('oauthaccept@example.com')
        client = self._authenticated_client(user)
        payload = dict(VALID_ONBOARDING_PAYLOAD, date_of_birth='2000-01-01', agreed_to_terms=True)
        resp = self._post(client, reverse('users:onboarding_complete'), payload)
        self.assertEqual(resp.status_code, 200)

        user.refresh_from_db()
        self.assertIsNotNone(user.terms_accepted_at)
        self.assertEqual(user.terms_version, CURRENT_TERMS_VERSION)
        self.assertTrue(user.profile.onboarding_completed)


class PasswordUserOnboardingTermsTests(OnboardingTestBase):
    def test_already_accepted_user_onboarding_does_not_require_checkbox(self):
        """
        Email/password users already accepted at registration — onboarding
        must succeed for them without agreed_to_terms in the payload at
        all, and must not overwrite their original acceptance timestamp.
        """
        user = self._make_password_user('alreadyaccepted@example.com')
        original_terms_accepted_at = user.terms_accepted_at
        client = self._authenticated_client(user)

        resp = self._post(client, reverse('users:onboarding_complete'), VALID_ONBOARDING_PAYLOAD)
        self.assertEqual(resp.status_code, 200)

        user.refresh_from_db()
        self.assertTrue(user.profile.onboarding_completed)
        self.assertEqual(user.terms_accepted_at, original_terms_accepted_at)

    def test_already_accepted_user_sees_terms_accepted_at_via_me_endpoint(self):
        user = self._make_password_user('meendpoint@example.com')
        client = self._authenticated_client(user)
        resp = client.get(reverse('users:me'))
        self.assertEqual(resp.status_code, 200)
        self.assertIsNotNone(resp.json()['terms_accepted_at'])


class OnboardingUsernameOptionalityTests(OnboardingTestBase):
    """
    Username is only ever asked for (and required) during onboarding for
    users who don't already have one they chose themselves — i.e. OAuth
    signups, whose username was auto-generated. Email/password users
    already chose theirs at registration and should never be asked again.
    """

    def test_password_user_onboarding_succeeds_without_username_in_payload(self):
        user = self._make_password_user('noplatform@example.com')
        original_username = user.username
        client = self._authenticated_client(user)

        payload = {k: v for k, v in VALID_ONBOARDING_PAYLOAD.items() if k != 'username'}
        resp = self._post(client, reverse('users:onboarding_complete'), payload)
        self.assertEqual(resp.status_code, 200)

        user.refresh_from_db()
        self.assertTrue(user.profile.onboarding_completed)
        self.assertEqual(user.username, original_username)

    def test_oauth_user_onboarding_without_username_rejected(self):
        user = self._make_oauth_user('oauthnousername@example.com')
        client = self._authenticated_client(user)

        payload = dict(VALID_ONBOARDING_PAYLOAD, date_of_birth='2000-01-01', agreed_to_terms=True)
        del payload['username']
        resp = self._post(client, reverse('users:onboarding_complete'), payload)
        self.assertEqual(resp.status_code, 400)
        self.assertIn('username', resp.json())
        user.profile.refresh_from_db()
        self.assertFalse(user.profile.onboarding_completed)

    def test_oauth_user_onboarding_with_username_succeeds_and_sets_it(self):
        user = self._make_oauth_user('oauthwithusername@example.com')
        client = self._authenticated_client(user)

        payload = dict(VALID_ONBOARDING_PAYLOAD, date_of_birth='2000-01-01', agreed_to_terms=True)
        resp = self._post(client, reverse('users:onboarding_complete'), payload)
        self.assertEqual(resp.status_code, 200)

        user.refresh_from_db()
        self.assertEqual(user.username, VALID_ONBOARDING_PAYLOAD['username'])


class WorkFieldsLockedAfterOnboardingTests(OnboardingTestBase):
    """
    profession/income_source/platform_used are collected once, during
    onboarding — same write-once pattern as onboarding_completed and the
    custom-SMTP fields on this same serializer.
    """

    def test_profile_put_attempting_profession_returns_400(self):
        user = self._make_password_user('lockedprofession@example.com')
        client = self._authenticated_client(user)
        csrf_token = self._csrf_token(client)
        resp = client.put(
            reverse('users:profile'),
            data=json.dumps({'profession': 'Something else'}),
            content_type='application/json',
            HTTP_X_CSRFTOKEN=csrf_token,
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn('profession', resp.json())
