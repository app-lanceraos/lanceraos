# apps/clients/tests/test_portal.py
"""
Step 11 — Client Portal Authentication. Covers: the ClientPortalSession
model's own lifecycle (issue, renew-on-activity, expire, revoke,
revoke-all), the magic-link entry view (valid/invalid/unknown token),
request-link rate limiting at both thresholds, the freelancer-own-session
guard function's own logic directly, and a real check that apps.clients
has zero apps.invoices imports after item 0's dependency-direction fix.
"""
import json
from datetime import timedelta
from unittest.mock import MagicMock, patch

from django.core.cache import cache
from django.middleware.csrf import get_token
from django.test import Client as DjangoTestClient
from django.test import RequestFactory, TestCase
from django.urls import reverse
from django.utils import timezone

from apps.clients.models import Client, ClientPortalSession
from apps.clients.portal import (
    get_current_session,
    is_freelancer_previewing_portal,
    issue_or_renew_session,
    resolve_session_from_request,
    revoke_all_sessions_for_client,
    revoke_session,
)
from apps.users.cookies import ACCESS_COOKIE_NAME
from apps.users.models import User

PORTAL_COOKIE_NAME = 'lanceraos_portal_session'


def make_client(user, **overrides):
    data = {'name': 'Acme Co', 'email': 'acme@example.com'}
    data.update(overrides)
    return Client.objects.create(user=user, **data)


class PortalAPITestCase(TestCase):
    """
    Same login-independent CSRF plumbing as apps/clients/tests/test_views.py's
    ClientsAPITestCase, minus the freelancer login — portal endpoints are
    AllowAny and authenticate via their own cookie, not apps.users auth.
    """
    def setUp(self):
        cache.clear()
        self.rf = RequestFactory()
        self.client = DjangoTestClient(enforce_csrf_checks=True)
        self.user = User.objects.create_user(email='freelancer@example.com', password='Sup3r$ecret1')
        self.portal_client = make_client(self.user)

    def _csrf_token(self):
        dummy = self.rf.get('/')
        token = get_token(dummy)
        self.client.cookies['csrftoken'] = dummy.META['CSRF_COOKIE']
        return token

    def _get(self, url):
        return self.client.get(url)

    def _post(self, url, data=None, with_csrf=True):
        headers = {}
        if with_csrf:
            headers['HTTP_X_CSRFTOKEN'] = self._csrf_token()
        return self.client.post(url, data=json.dumps(data or {}), content_type='application/json', **headers)

    def _enter_portal(self):
        """Real entry via the magic link — the only real way this test client acquires a portal session cookie."""
        resp = self._get(reverse('clients:portal_enter', kwargs={'token': self.portal_client.portal_token}))
        assert resp.status_code == 200, resp.content
        return resp


# ══════════════════════════════════════════════════════════════════
# ClientPortalSession — model-level lifecycle
# ══════════════════════════════════════════════════════════════════

class ClientPortalSessionModelTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(email='freelancer@example.com', password='Sup3r$ecret1')
        self.client_obj = make_client(self.user)

    def test_create_for_client_sets_expiry_60_days_out(self):
        session = ClientPortalSession.create_for_client(
            self.client_obj, 'raw-token-abc', device_name='Chrome on macOS',
            ip_address='1.2.3.4', user_agent='Mozilla/5.0',
        )
        self.assertAlmostEqual(
            (session.expires_at - session.last_used_at).total_seconds(),
            timedelta(days=60).total_seconds(), delta=5,
        )
        self.assertIsNone(session.revoked_at)

    def test_token_is_hashed_not_stored_raw(self):
        session = ClientPortalSession.create_for_client(
            self.client_obj, 'super-secret-raw-token', device_name='', ip_address=None, user_agent='',
        )
        self.assertNotEqual(session.token_hash, 'super-secret-raw-token')
        self.assertEqual(len(session.token_hash), 64)  # sha256 hex digest

    def test_get_valid_finds_a_real_live_session(self):
        ClientPortalSession.create_for_client(self.client_obj, 'tok-1', device_name='', ip_address=None, user_agent='')
        found = ClientPortalSession.get_valid('tok-1')
        self.assertIsNotNone(found)
        self.assertEqual(found.client_id, self.client_obj.pk)

    def test_get_valid_returns_none_for_unknown_token(self):
        self.assertIsNone(ClientPortalSession.get_valid('never-issued'))

    def test_get_valid_returns_none_for_expired_session(self):
        session = ClientPortalSession.create_for_client(self.client_obj, 'tok-exp', device_name='', ip_address=None, user_agent='')
        session.expires_at = timezone.now() - timedelta(seconds=1)
        session.save(update_fields=['expires_at'])
        self.assertIsNone(ClientPortalSession.get_valid('tok-exp'))

    def test_get_valid_returns_none_for_revoked_session(self):
        session = ClientPortalSession.create_for_client(self.client_obj, 'tok-rev', device_name='', ip_address=None, user_agent='')
        session.revoked_at = timezone.now()
        session.save(update_fields=['revoked_at'])
        self.assertIsNone(ClientPortalSession.get_valid('tok-rev'))


# ══════════════════════════════════════════════════════════════════
# apps/clients/portal.py — the utility functions, tested directly
# ══════════════════════════════════════════════════════════════════

class SessionUtilityFunctionTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(email='freelancer@example.com', password='Sup3r$ecret1')
        self.client_obj = make_client(self.user)
        self.rf = RequestFactory()

    def _request_with_cookie(self, cookie_value=None):
        req = self.rf.get('/')
        req.COOKIES = {PORTAL_COOKIE_NAME: cookie_value} if cookie_value else {}
        return req

    def test_issue_or_renew_session_mints_a_new_session_and_sets_a_cookie(self):
        from rest_framework.response import Response
        request = self._request_with_cookie()
        response = Response({})
        session = issue_or_renew_session(self.client_obj, request, response)

        self.assertIsNotNone(session.pk)
        self.assertEqual(session.client_id, self.client_obj.pk)
        self.assertIn(PORTAL_COOKIE_NAME, response.cookies)

    def test_issue_or_renew_session_renews_an_existing_session_for_the_same_client_rather_than_minting_a_second_one(self):
        from rest_framework.response import Response
        existing = ClientPortalSession.create_for_client(self.client_obj, 'existing-raw', device_name='', ip_address=None, user_agent='')
        old_expiry = existing.expires_at

        request = self._request_with_cookie('existing-raw')
        response = Response({})
        session = issue_or_renew_session(self.client_obj, request, response)

        self.assertEqual(session.pk, existing.pk)
        self.assertEqual(ClientPortalSession.objects.filter(client=self.client_obj).count(), 1)
        session.refresh_from_db()
        self.assertGreater(session.expires_at, old_expiry)
        # Renewal doesn't need to re-set the cookie — the raw value didn't change.
        self.assertNotIn(PORTAL_COOKIE_NAME, response.cookies)

    def test_issue_or_renew_session_mints_a_fresh_session_for_a_different_client_even_with_a_stale_cookie_present(self):
        """A cookie belonging to a DIFFERENT client must never be silently renewed/reused for this one."""
        from rest_framework.response import Response
        other_client = make_client(self.user, name='Beta Co', email='beta@example.com')
        ClientPortalSession.create_for_client(other_client, 'other-clients-token', device_name='', ip_address=None, user_agent='')

        request = self._request_with_cookie('other-clients-token')
        response = Response({})
        session = issue_or_renew_session(self.client_obj, request, response)

        self.assertEqual(session.client_id, self.client_obj.pk)
        self.assertNotEqual(session.client_id, other_client.pk)

    def test_resolve_session_from_request_extends_expires_at_on_each_call_sliding_window(self):
        ClientPortalSession.create_for_client(self.client_obj, 'sliding-tok', device_name='', ip_address=None, user_agent='')
        session_before = ClientPortalSession.get_valid('sliding-tok')
        original_expiry = session_before.expires_at

        request = self._request_with_cookie('sliding-tok')
        client = resolve_session_from_request(request)
        self.assertEqual(client.pk, self.client_obj.pk)

        session_after = ClientPortalSession.objects.get(pk=session_before.pk)
        self.assertGreaterEqual(session_after.expires_at, original_expiry)

    def test_resolve_session_from_request_returns_none_for_missing_cookie(self):
        self.assertIsNone(resolve_session_from_request(self._request_with_cookie()))

    def test_resolve_session_from_request_returns_none_for_expired_session(self):
        session = ClientPortalSession.create_for_client(self.client_obj, 'expired-tok', device_name='', ip_address=None, user_agent='')
        session.expires_at = timezone.now() - timedelta(days=1)
        session.save(update_fields=['expires_at'])
        self.assertIsNone(resolve_session_from_request(self._request_with_cookie('expired-tok')))

    def test_revoke_session_invalidates_it_immediately(self):
        session = ClientPortalSession.create_for_client(self.client_obj, 'to-revoke', device_name='', ip_address=None, user_agent='')
        revoke_session(session)
        self.assertIsNone(ClientPortalSession.get_valid('to-revoke'))
        session.refresh_from_db()
        self.assertIsNotNone(session.revoked_at)

    def test_revoke_all_sessions_for_client_revokes_every_live_session_but_not_other_clients(self):
        other_client = make_client(self.user, name='Beta Co', email='beta@example.com')
        ClientPortalSession.create_for_client(self.client_obj, 'device-a', device_name='', ip_address=None, user_agent='')
        ClientPortalSession.create_for_client(self.client_obj, 'device-b', device_name='', ip_address=None, user_agent='')
        ClientPortalSession.create_for_client(other_client, 'other-device', device_name='', ip_address=None, user_agent='')

        revoke_all_sessions_for_client(self.client_obj)

        self.assertIsNone(ClientPortalSession.get_valid('device-a'))
        self.assertIsNone(ClientPortalSession.get_valid('device-b'))
        self.assertIsNotNone(ClientPortalSession.get_valid('other-device'))  # untouched

    def test_get_current_session_does_not_renew_unlike_resolve_session_from_request(self):
        session = ClientPortalSession.create_for_client(self.client_obj, 'no-renew-tok', device_name='', ip_address=None, user_agent='')
        original_expiry = session.expires_at

        found = get_current_session(self._request_with_cookie('no-renew-tok'))
        self.assertEqual(found.pk, session.pk)

        session.refresh_from_db()
        self.assertEqual(session.expires_at, original_expiry)


# ══════════════════════════════════════════════════════════════════
# The freelancer-own-session ("Preview mode") guard — direct, standalone
# ══════════════════════════════════════════════════════════════════

class FreelancerPreviewGuardTests(TestCase):
    """
    Wired into 5 real call sites in apps.invoices.views_portal — tested
    directly here against the function's own logic (both cookies
    present, only the freelancer's, only the portal's, neither, and —
    audit fix, finding PORTAL-001 — same-owner vs. different-owner).
    """
    def setUp(self):
        self.user = User.objects.create_user(email='freelancer@example.com', password='Sup3r$ecret1')
        self.user.is_email_verified = True
        self.user.is_active = True
        self.user.save()
        self.other_user = User.objects.create_user(email='other-freelancer@example.com', password='Sup3r$ecret1')
        self.other_user.is_email_verified = True
        self.other_user.is_active = True
        self.other_user.save()
        self.client_obj = make_client(self.user)
        self.rf = RequestFactory()

    def _real_freelancer_access_cookie(self, user=None):
        """A real, valid JWT access token for the given user (self.user by default), minted via the real login endpoint — not a synthetic string."""
        user = user or self.user
        django_client = DjangoTestClient(enforce_csrf_checks=True)
        dummy = self.rf.get('/')
        token = get_token(dummy)
        django_client.cookies['csrftoken'] = dummy.META['CSRF_COOKIE']
        resp = django_client.post(
            reverse('users:login'), data=json.dumps({'login': user.email, 'password': 'Sup3r$ecret1'}),
            content_type='application/json', HTTP_X_CSRFTOKEN=token,
        )
        assert resp.status_code == 200, resp.content
        return django_client.cookies[ACCESS_COOKIE_NAME].value

    def _real_portal_session_cookie(self):
        session = ClientPortalSession.create_for_client(self.client_obj, 'preview-portal-tok', device_name='', ip_address=None, user_agent='')
        return 'preview-portal-tok'

    def test_neither_cookie_present_is_not_flagged(self):
        request = self.rf.get('/')
        request.COOKIES = {}
        self.assertFalse(is_freelancer_previewing_portal(request, owner_user_id=self.user.pk))

    def test_only_freelancer_session_present_is_not_flagged(self):
        access_token = self._real_freelancer_access_cookie()
        request = self.rf.get('/')
        request.COOKIES = {ACCESS_COOKIE_NAME: access_token}
        self.assertFalse(is_freelancer_previewing_portal(request, owner_user_id=self.user.pk))

    def test_only_portal_session_present_is_not_flagged(self):
        raw_token = self._real_portal_session_cookie()
        request = self.rf.get('/')
        request.COOKIES = {PORTAL_COOKIE_NAME: raw_token}
        self.assertFalse(is_freelancer_previewing_portal(request, owner_user_id=self.user.pk))

    def test_both_cookies_present_and_freelancer_owns_the_client_is_flagged(self):
        access_token = self._real_freelancer_access_cookie()
        raw_token = self._real_portal_session_cookie()
        request = self.rf.get('/')
        request.COOKIES = {ACCESS_COOKIE_NAME: access_token, PORTAL_COOKIE_NAME: raw_token}
        self.assertTrue(is_freelancer_previewing_portal(request, owner_user_id=self.user.pk))

    def test_both_cookies_present_but_different_owner_is_not_flagged(self):
        """
        Audit fix (LANCERAOS_CLIENTS_INVOICES_PRODUCTION_AUDIT.md, finding
        PORTAL-001) — the actual live-reproduced scenario: self.other_user
        is a real, distinct freelancer with a valid JWT session of their
        own, who ALSO happens to be carrying a valid portal-session cookie
        for self.user's client (self.client_obj) — e.g. a forwarded link,
        another browser tab, or genuinely being someone else's client.
        This must NOT be treated as self.user previewing their own
        client's portal — it's two unrelated people's sessions coexisting
        in one browser, and the portal session's real actions must still
        behave as a genuine client action.
        """
        access_token = self._real_freelancer_access_cookie(user=self.other_user)
        raw_token = self._real_portal_session_cookie()  # a session for self.client_obj, owned by self.user
        request = self.rf.get('/')
        request.COOKIES = {ACCESS_COOKIE_NAME: access_token, PORTAL_COOKIE_NAME: raw_token}
        # Checked against the REAL owner (self.user, self.client_obj's
        # owner) — self.other_user is authenticated but owns nothing here.
        self.assertFalse(is_freelancer_previewing_portal(request, owner_user_id=self.user.pk))
        # The SAME request pair correctly IS flagged when checked against
        # the freelancer who's actually logged in — proves this isn't
        # simply "always False now," only false for the mismatched owner.
        self.assertTrue(is_freelancer_previewing_portal(request, owner_user_id=self.other_user.pk))

    def test_garbage_freelancer_cookie_alongside_a_real_portal_session_is_not_flagged(self):
        """An invalid/expired/malformed JWT must never raise — just means 'no freelancer session'."""
        raw_token = self._real_portal_session_cookie()
        request = self.rf.get('/')
        request.COOKIES = {ACCESS_COOKIE_NAME: 'not-a-real-jwt-at-all', PORTAL_COOKIE_NAME: raw_token}
        self.assertFalse(is_freelancer_previewing_portal(request, owner_user_id=self.user.pk))


# ══════════════════════════════════════════════════════════════════
# Magic-link entry — GET /api/clients/portal/<token>/
# ══════════════════════════════════════════════════════════════════

class PortalEntryViewTests(PortalAPITestCase):
    def test_valid_token_returns_client_identity_and_sets_session_cookie(self):
        resp = self._enter_portal()
        body = resp.json()
        self.assertEqual(body['client']['id'], str(self.portal_client.pk))
        self.assertEqual(body['client']['name'], self.portal_client.name)
        self.assertEqual(body['client']['email'], self.portal_client.email)
        self.assertIn(PORTAL_COOKIE_NAME, resp.cookies)
        self.assertTrue(resp.cookies[PORTAL_COOKIE_NAME]['httponly'])

    def test_valid_token_creates_a_real_session_row(self):
        self.assertEqual(ClientPortalSession.objects.filter(client=self.portal_client).count(), 0)
        self._enter_portal()
        self.assertEqual(ClientPortalSession.objects.filter(client=self.portal_client).count(), 1)

    def test_unknown_token_returns_404_not_a_redirect(self):
        resp = self._get(reverse('clients:portal_enter', kwargs={'token': 'this-token-was-never-issued'}))
        self.assertEqual(resp.status_code, 404)

    def test_unknown_token_error_does_not_leak_whether_it_almost_matched(self):
        resp = self._get(reverse('clients:portal_enter', kwargs={'token': self.portal_client.portal_token[:-1]}))
        self.assertEqual(resp.status_code, 404)
        self.assertNotIn(self.portal_client.name, resp.content.decode())

    def test_revisiting_the_same_link_renews_rather_than_duplicating_the_session(self):
        self._enter_portal()
        self._enter_portal()
        self.assertEqual(ClientPortalSession.objects.filter(client=self.portal_client).count(), 1)


# ══════════════════════════════════════════════════════════════════
# Request-fresh-link — POST /api/clients/portal/request-link/
# ══════════════════════════════════════════════════════════════════

class RequestLinkViewTests(PortalAPITestCase):
    @patch('apps.clients.views_portal.send_client_facing_email')
    def test_matching_email_sends_the_existing_link(self, mock_send):
        mock_send.return_value = {'sent': True, 'sent_via': 'resend', 'smtp_host': None, 'provider_message_id': 'x', 'fallback_used': False, 'error': None}
        resp = self._post(reverse('clients:portal_request_link'), {'email': self.portal_client.email}, with_csrf=False)
        self.assertEqual(resp.status_code, 200)
        mock_send.assert_called_once()
        call_kwargs = mock_send.call_args
        self.assertEqual(call_kwargs.args[1], self.portal_client.email)  # `to` positional arg

    @patch('apps.clients.views_portal.send_client_facing_email')
    def test_non_matching_email_returns_the_same_generic_response_and_sends_nothing(self, mock_send):
        resp = self._post(reverse('clients:portal_request_link'), {'email': 'nobody@example.com'}, with_csrf=False)
        self.assertEqual(resp.status_code, 200)
        mock_send.assert_not_called()

    @patch('apps.clients.views_portal.send_client_facing_email')
    def test_email_matching_multiple_freelancers_clients_sends_to_each(self, mock_send):
        mock_send.return_value = {'sent': True, 'sent_via': 'resend', 'smtp_host': None, 'provider_message_id': 'x', 'fallback_used': False, 'error': None}
        other_user = User.objects.create_user(email='other-freelancer@example.com', password='Sup3r$ecret1')
        make_client(other_user, name='Shared Client', email=self.portal_client.email)

        self._post(reverse('clients:portal_request_link'), {'email': self.portal_client.email}, with_csrf=False)
        self.assertEqual(mock_send.call_count, 2)

    def test_missing_email_still_returns_the_generic_response(self):
        resp = self._post(reverse('clients:portal_request_link'), {}, with_csrf=False)
        self.assertEqual(resp.status_code, 200)


class RequestLinkRateLimitTests(PortalAPITestCase):
    @patch('apps.clients.views_portal.send_client_facing_email')
    def test_sixth_request_for_the_same_email_within_an_hour_is_rejected(self, mock_send):
        mock_send.return_value = {'sent': True, 'sent_via': 'resend', 'smtp_host': None, 'provider_message_id': 'x', 'fallback_used': False, 'error': None}
        for _ in range(5):
            resp = self._post(reverse('clients:portal_request_link'), {'email': 'repeat@example.com'}, with_csrf=False)
            self.assertEqual(resp.status_code, 200)

        resp = self._post(reverse('clients:portal_request_link'), {'email': 'repeat@example.com'}, with_csrf=False)
        self.assertEqual(resp.status_code, 429)

    @patch('apps.clients.views_portal.send_client_facing_email')
    def test_21st_request_from_the_same_ip_across_different_emails_is_rejected(self, mock_send):
        mock_send.return_value = {'sent': True, 'sent_via': 'resend', 'smtp_host': None, 'provider_message_id': 'x', 'fallback_used': False, 'error': None}
        for i in range(20):
            resp = self._post(reverse('clients:portal_request_link'), {'email': f'person{i}@example.com'}, with_csrf=False)
            self.assertEqual(resp.status_code, 200)

        resp = self._post(reverse('clients:portal_request_link'), {'email': 'person21@example.com'}, with_csrf=False)
        self.assertEqual(resp.status_code, 429)

    @patch('apps.clients.views_portal.send_client_facing_email')
    def test_different_emails_each_get_their_own_5_per_hour_budget(self, mock_send):
        """The per-email limit must not be shared across different addresses — only the per-IP counter is shared."""
        mock_send.return_value = {'sent': True, 'sent_via': 'resend', 'smtp_host': None, 'provider_message_id': 'x', 'fallback_used': False, 'error': None}
        for _ in range(5):
            self._post(reverse('clients:portal_request_link'), {'email': 'personA@example.com'}, with_csrf=False)
        resp = self._post(reverse('clients:portal_request_link'), {'email': 'personB@example.com'}, with_csrf=False)
        self.assertEqual(resp.status_code, 200)  # personB's own budget is untouched by personA's requests


# ══════════════════════════════════════════════════════════════════
# Logout / logout-everywhere
# ══════════════════════════════════════════════════════════════════

class LogoutViewTests(PortalAPITestCase):
    def test_logout_requires_a_valid_current_session(self):
        resp = self._post(reverse('clients:portal_logout'), {})
        self.assertEqual(resp.status_code, 401)

    def test_logout_revokes_the_current_session_and_clears_the_cookie(self):
        self._enter_portal()
        session = ClientPortalSession.objects.get(client=self.portal_client)

        resp = self._post(reverse('clients:portal_logout'), {})
        self.assertEqual(resp.status_code, 200)

        session.refresh_from_db()
        self.assertIsNotNone(session.revoked_at)
        self.assertEqual(resp.cookies[PORTAL_COOKIE_NAME].value, '')

    def test_logout_after_already_logged_out_returns_401_not_a_silent_success(self):
        self._enter_portal()
        self._post(reverse('clients:portal_logout'), {})
        resp = self._post(reverse('clients:portal_logout'), {})
        self.assertEqual(resp.status_code, 401)

    def test_logout_everywhere_requires_a_valid_current_session(self):
        resp = self._post(reverse('clients:portal_logout_everywhere'), {})
        self.assertEqual(resp.status_code, 401)

    def test_logout_everywhere_revokes_every_session_for_this_client(self):
        self._enter_portal()
        ClientPortalSession.create_for_client(self.portal_client, 'another-device-tok', device_name='', ip_address=None, user_agent='')
        self.assertEqual(ClientPortalSession.objects.filter(client=self.portal_client, revoked_at__isnull=True).count(), 2)

        resp = self._post(reverse('clients:portal_logout_everywhere'), {})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(ClientPortalSession.objects.filter(client=self.portal_client, revoked_at__isnull=True).count(), 0)

    def test_logout_without_a_csrf_token_is_rejected(self):
        self._enter_portal()
        resp = self._post(reverse('clients:portal_logout'), {}, with_csrf=False)
        self.assertEqual(resp.status_code, 403)


# ══════════════════════════════════════════════════════════════════
# Dependency-direction fix (item 0) — confirmed directly, not assumed
# ══════════════════════════════════════════════════════════════════

class DependencyDirectionTests(TestCase):
    def test_apps_clients_has_zero_apps_invoices_imports(self):
        """
        The whole reason core.email.send_client_facing_email exists:
        apps.clients must never import anything from apps.invoices
        (the one-directional apps.invoices -> apps.clients rule,
        INVOICES_CLIENTS_TECHNICAL_SPEC.md Section 2). Checked directly
        against every real .py file in this app, not assumed from having
        written it carefully — a real import line, not just the string
        'invoices' appearing in a comment (apps/clients/models.py and
        views.py both mention apps.invoices in prose, which must NOT
        trip this check).
        """
        import ast
        import pathlib

        app_dir = pathlib.Path(__file__).resolve().parent.parent
        violations = []
        for path in app_dir.rglob('*.py'):
            if '__pycache__' in path.parts or '/tests/' in str(path):
                continue
            tree = ast.parse(path.read_text(), filename=str(path))
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    for alias in node.names:
                        if alias.name.startswith('apps.invoices'):
                            violations.append((str(path), alias.name))
                elif isinstance(node, ast.ImportFrom):
                    if node.module and node.module.startswith('apps.invoices'):
                        violations.append((str(path), node.module))

        self.assertEqual(violations, [], f'apps.clients imports from apps.invoices: {violations}')

    def test_send_client_facing_email_is_importable_from_core_with_no_apps_invoices_involved(self):
        """Direct proof the promoted function lives in core/, not apps/invoices/."""
        from core.email import send_client_facing_email
        self.assertTrue(callable(send_client_facing_email))
