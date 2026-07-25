# apps/users/tests/test_deletion.py
import json
from unittest.mock import patch

from django.core.cache import cache
from django.middleware.csrf import get_token
from django.test import Client, RequestFactory, TestCase
from django.urls import reverse

from apps.users.models import Session, User


class DeletionFlowTests(TestCase):
    def setUp(self):
        cache.clear()
        self.rf = RequestFactory()
        self.client = Client(enforce_csrf_checks=True)
        self.user = User.objects.create_user(email='delete@example.com', password='Sup3r$ecret1')
        self.user.is_email_verified = True
        self.user.is_active = True
        self.user.save()
        dummy = self.rf.get('/')
        self.csrf_token = get_token(dummy)
        self.client.cookies['csrftoken'] = dummy.META['CSRF_COOKIE']
        self.client.post(reverse('users:login'), data=json.dumps({
            'login': 'delete@example.com', 'password': 'Sup3r$ecret1',
        }), content_type='application/json', HTTP_X_CSRFTOKEN=self.csrf_token)

    def _post(self, path, payload):
        return self.client.post(path, data=json.dumps(payload), content_type='application/json', HTTP_X_CSRFTOKEN=self.csrf_token)

    @patch('apps.users.views.deletion.send_account_deletion_otp_email', return_value=True)
    def test_initiate_wrong_password_rejected(self, mock_email):
        resp = self._post(reverse('users:deletion_initiate'), {'password': 'wrong'})
        self.assertEqual(resp.status_code, 400)

    @patch('apps.users.views.deletion.send_account_deletion_otp_email', return_value=True)
    @patch('apps.users.views.deletion.send_account_deletion_confirmed_email', return_value=True)
    @patch('apps.users.views.deletion.check_password', return_value=True)
    def test_full_deletion_flow_revokes_sessions_and_clears_cookies(self, mock_check, mock_confirmed_email, mock_otp_email):
        resp = self._post(reverse('users:deletion_initiate'), {'password': 'Sup3r$ecret1'})
        self.assertEqual(resp.status_code, 200)
        session_id = resp.json()['session_id']

        resp = self._post(reverse('users:deletion_verify_otp'), {'session_id': session_id, 'otp_code': '123456'})
        self.assertEqual(resp.status_code, 200)
        deletion_token = resp.json()['deletion_token']

        resp = self._post(reverse('users:deletion_confirm'), {'deletion_token': deletion_token})
        self.assertEqual(resp.status_code, 200)
        self.user.refresh_from_db()
        self.assertTrue(self.user.is_deleted)
        self.assertIsNotNone(self.user.deletion_scheduled_at)
        self.assertEqual(Session.objects.filter(user=self.user).count(), 0)
        self.assertEqual(resp.cookies['lanceraos_access'].value, '')

    def test_confirm_with_invalid_token_rejected(self):
        resp = self._post(reverse('users:deletion_confirm'), {'deletion_token': 'garbage'})
        self.assertEqual(resp.status_code, 400)

    def test_cancel_with_no_pending_deletion_rejected(self):
        resp = self._post(reverse('users:deletion_cancel'), {})
        self.assertEqual(resp.status_code, 400)

    @patch('apps.users.views.deletion.send_account_deletion_otp_email', return_value=True)
    @patch('apps.users.views.deletion.send_account_deletion_confirmed_email', return_value=True)
    @patch('apps.users.views.deletion.check_password', return_value=True)
    def test_login_while_pending_then_cancel_restores_account(self, mock_check, mock_confirmed, mock_otp):
        resp = self._post(reverse('users:deletion_initiate'), {'password': 'Sup3r$ecret1'})
        session_id = resp.json()['session_id']
        resp = self._post(reverse('users:deletion_verify_otp'), {'session_id': session_id, 'otp_code': '123456'})
        deletion_token = resp.json()['deletion_token']
        self._post(reverse('users:deletion_confirm'), {'deletion_token': deletion_token})

        client2 = Client(enforce_csrf_checks=True)
        dummy = self.rf.get('/')
        csrf_token2 = get_token(dummy)
        client2.cookies['csrftoken'] = dummy.META['CSRF_COOKIE']
        resp = client2.post(reverse('users:login'), data=json.dumps({
            'login': 'delete@example.com', 'password': 'Sup3r$ecret1',
        }), content_type='application/json', HTTP_X_CSRFTOKEN=csrf_token2)
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()['deletion_pending'])

        resp = client2.post(reverse('users:deletion_cancel'), content_type='application/json', HTTP_X_CSRFTOKEN=csrf_token2)
        self.assertEqual(resp.status_code, 200)
        self.user.refresh_from_db()
        self.assertFalse(self.user.is_deleted)

    @patch('apps.users.views.deletion.send_account_deletion_otp_email', return_value=True)
    def test_oauth_only_account_cannot_initiate_deletion(self, mock_email):
        from apps.users.oauth.base import link_or_create_user
        oauth_user, _ = link_or_create_user('google', {
            'provider_uid': 'g-nodel', 'email': 'oauthdel@example.com',
            'first_name': '', 'last_name': '', 'picture_url': '',
        })
        client = Client(enforce_csrf_checks=True)
        from apps.users.token_service import issue_tokens_and_session

        class FakeReq:
            META = {'HTTP_USER_AGENT': 'test', 'REMOTE_ADDR': '1.1.1.1'}

        access, refresh_str, session = issue_tokens_and_session(oauth_user, FakeReq(), remember_me=False)
        client.cookies['lanceraos_access'] = access
        dummy = self.rf.get('/')
        csrf_token = get_token(dummy)
        client.cookies['csrftoken'] = dummy.META['CSRF_COOKIE']

        resp = client.post(reverse('users:deletion_initiate'), data=json.dumps({'password': 'anything'}),
                            content_type='application/json', HTTP_X_CSRFTOKEN=csrf_token)
        self.assertEqual(resp.status_code, 400)