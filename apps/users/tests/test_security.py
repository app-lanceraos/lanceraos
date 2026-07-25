# apps/users/tests/test_security.py
import json
from unittest.mock import patch

from django.core.cache import cache
from django.middleware.csrf import get_token
from django.test import Client, RequestFactory, TestCase
from django.urls import reverse
from django.utils import timezone

from apps.users.models import EmailChangeRequest, Session, User


class SecurityTestBase(TestCase):
    def setUp(self):
        cache.clear()
        self.rf = RequestFactory()
        self.client = Client(enforce_csrf_checks=True)
        self.user = User.objects.create_user(email='sec@example.com', password='Sup3r$ecret1')
        self.user.is_email_verified = True
        self.user.is_active = True
        self.user.save()
        self.csrf_token = self._csrf_token()
        self.client.post(reverse('users:login'), data=json.dumps({
            'login': 'sec@example.com', 'password': 'Sup3r$ecret1',
        }), content_type='application/json', HTTP_X_CSRFTOKEN=self.csrf_token)

    def _csrf_token(self):
        dummy = self.rf.get('/')
        token = get_token(dummy)
        self.client.cookies['csrftoken'] = dummy.META['CSRF_COOKIE']
        return token

    def _post(self, path, payload):
        return self.client.post(path, data=json.dumps(payload), content_type='application/json', HTTP_X_CSRFTOKEN=self.csrf_token)


class ChangePasswordTests(SecurityTestBase):
    @patch('apps.users.views.security.send_password_changed_email', return_value=True)
    def test_change_password_wrong_old_password_rejected(self, mock_email):
        resp = self._post(reverse('users:change_password'), {'old_password': 'wrong', 'new_password': 'NewPass!456'})
        self.assertEqual(resp.status_code, 400)

    @patch('apps.users.views.security.send_password_changed_email', return_value=True)
    def test_change_password_keeps_current_device_kills_others(self, mock_email):
        other_client = Client(enforce_csrf_checks=True)
        dummy = self.rf.get('/')
        other_csrf_token = get_token(dummy)
        other_client.cookies['csrftoken'] = dummy.META['CSRF_COOKIE']
        other_client.post(reverse('users:login'), data=json.dumps({
            'login': 'sec@example.com', 'password': 'Sup3r$ecret1',
        }), content_type='application/json', HTTP_X_CSRFTOKEN=other_csrf_token)
        self.assertEqual(Session.objects.filter(user=self.user).count(), 2)

        resp = self._post(reverse('users:change_password'), {'old_password': 'Sup3r$ecret1', 'new_password': 'NewPass!456'})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(Session.objects.filter(user=self.user).count(), 1)

        resp = self.client.get(reverse('users:me'))
        self.assertEqual(resp.status_code, 200)
        resp = other_client.get(reverse('users:me'))
        self.assertEqual(resp.status_code, 401)


class Toggle2FATests(SecurityTestBase):
    @patch('apps.users.views.security.send_2fa_enabled_email', return_value=True)
    def test_enable_2fa(self, mock_email):
        resp = self._post(reverse('users:2fa_toggle'), {'action': 'enable', 'password': 'Sup3r$ecret1'})
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()['two_fa_enabled'])

    def test_enable_2fa_wrong_password_rejected(self):
        resp = self._post(reverse('users:2fa_toggle'), {'action': 'enable', 'password': 'wrong'})
        self.assertEqual(resp.status_code, 400)


class EmailChangeFlowTests(SecurityTestBase):
    @patch('apps.users.views.security.send_email_change_step1_email')
    def test_full_email_change_flow(self, mock_step1_email):
        resp = self._post(reverse('users:email_change_request'), {})
        self.assertEqual(resp.status_code, 200)
        ecr_uid = mock_step1_email.call_args[0][2]
        step1_token = mock_step1_email.call_args[0][1]

        resp = self.client.get(reverse('users:email_change_validate', kwargs={'ecr_uid': ecr_uid, 'token': step1_token}))
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()['valid'])

        with patch('apps.users.views.security.send_email_change_step2_email') as mock_step2_email:
            resp = self.client.post(
                reverse('users:email_change_complete', kwargs={'ecr_uid': ecr_uid, 'token': step1_token}),
                data=json.dumps({'new_email': 'newmail@example.com', 'password': 'Sup3r$ecret1'}),
                content_type='application/json', HTTP_X_CSRFTOKEN=self.csrf_token,
            )
            self.assertEqual(resp.status_code, 200)
            step2_uid = mock_step2_email.call_args[0][2]
            step2_token = mock_step2_email.call_args[0][1]

        with patch('apps.users.views.security.send_email_changed_notification_to_old', return_value=True):
            resp = self.client.post(
                reverse('users:email_change_activate', kwargs={'ecr_uid': step2_uid, 'token': step2_token}),
                content_type='application/json', HTTP_X_CSRFTOKEN=self.csrf_token,
            )
            self.assertEqual(resp.status_code, 200)

        self.user.refresh_from_db()
        self.assertEqual(self.user.email, 'newmail@example.com')
        ecr = EmailChangeRequest.objects.filter(user=self.user).first()
        self.assertEqual(ecr.step, 'completed')

    @patch('apps.users.views.security.send_email_change_step1_email', return_value=True)
    def test_email_change_rate_limited(self, mock_email):
        for _ in range(3):
            self._post(reverse('users:email_change_request'), {})
        resp = self._post(reverse('users:email_change_request'), {})
        self.assertEqual(resp.status_code, 429)

    def test_email_change_cooldown_after_recent_change(self):
        self.user.profile.last_email_changed_at = timezone.now()
        self.user.profile.save()
        resp = self._post(reverse('users:email_change_request'), {})
        self.assertEqual(resp.status_code, 400)
        self.assertIn('days_remaining', resp.json())

    @patch('apps.users.views.security.send_email_change_step1_email', return_value=True)
    def test_cancel_email_change_clears_pending_state(self, mock_email):
        self._post(reverse('users:email_change_request'), {})
        resp = self._post(reverse('users:email_change_cancel'), {})
        self.assertEqual(resp.status_code, 200)
        self.user.refresh_from_db()
        self.assertEqual(self.user.pending_email, '')
        self.assertFalse(
            EmailChangeRequest.objects.filter(user=self.user, step__in=['step1_pending', 'step1_clicked', 'step2_pending']).exists()
        )