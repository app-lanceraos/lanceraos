# apps/users/tests/test_models.py
from datetime import timedelta

from django.core.exceptions import ValidationError
from django.test import RequestFactory, TestCase
from django.utils import timezone

from apps.users.models import Session, TrustedDevice, User, UserSocialAccount


class UserModelTests(TestCase):
    def test_new_user_has_uuid_pk(self):
        import uuid
        user = User.objects.create_user(email='a@example.com', password='Sup3r$ecret1')
        self.assertIsInstance(user.pk, uuid.UUID)

    def test_new_user_has_password_changed_at_set(self):
        """
        Guards against the exact gap found during development: a user
        created without ever explicitly changing their password must
        still have a non-null password_changed_at, so the very first
        real password change has something to invalidate old tokens
        against.
        """
        user = User.objects.create_user(email='b@example.com', password='Sup3r$ecret1')
        self.assertIsNotNone(user.password_changed_at)

    def test_lockout_tiering(self):
        user = User.objects.create_user(email='c@example.com', password='Sup3r$ecret1')
        user.failed_login_attempts = 4
        result = user.increment_failed_attempts()
        self.assertTrue(result['locked'])
        self.assertEqual(user.get_lockout_duration(), 15)

    def test_is_oauth_only(self):
        user = User.objects.create_user(email='d@example.com')  # no password
        UserSocialAccount.objects.create(user=user, provider='google', provider_uid='g-1')
        self.assertTrue(user.is_oauth_only())

        pw_user = User.objects.create_user(email='e@example.com', password='Sup3r$ecret1')
        self.assertFalse(pw_user.is_oauth_only())

    def test_password_history_tracks_last_three(self):
        user = User.objects.create_user(email='f@example.com', password='Sup3r$ecret1')
        old_hash = user.password
        user.set_password('NewOne!234')
        user.save()
        user.add_to_password_history(old_hash)
        self.assertIn(old_hash, user.password_history)

    def test_is_password_reused_checks_current_and_history(self):
        user = User.objects.create_user(email='g@example.com', password='Sup3r$ecret1')
        self.assertTrue(user.is_password_reused('Sup3r$ecret1'))
        old_hash = user.password
        user.set_password('NewOne!234')
        user.save()
        user.add_to_password_history(old_hash)
        self.assertTrue(user.is_password_reused('Sup3r$ecret1'))
        self.assertFalse(user.is_password_reused('TotallyDifferent!9'))


class AnonymizeTests(TestCase):
    def test_anonymize_clears_pii_and_related_records(self):
        user = User.objects.create_user(email='anon@example.com', password='Sup3r$ecret1')
        profile = user.profile
        profile.set_cnic('12345-1234567-1')
        profile.save()
        Session.create_for_user(user, 'tok', 'device', '1.1.1.1', lifetime_days=30)
        TrustedDevice.create_for_user(user, 'trust-tok', 'device', '1.1.1.1')
        UserSocialAccount.objects.create(user=user, provider='google', provider_uid='g-anon')

        old_email = user.email
        user.is_deleted = True
        user.deletion_scheduled_at = timezone.now()
        user.save()
        user.anonymize()
        user.refresh_from_db()
        profile.refresh_from_db()

        self.assertNotEqual(user.email, old_email)
        self.assertTrue(user.email.startswith('deleted-'))
        self.assertIsNotNone(user.anonymized_at)
        self.assertEqual(Session.objects.filter(user=user).count(), 0)
        self.assertEqual(TrustedDevice.objects.filter(user=user).count(), 0)
        self.assertEqual(UserSocialAccount.objects.filter(user=user).count(), 0)
        self.assertEqual(profile.cnic_encrypted, '')
        self.assertIsNone(profile.cnic_hash)

    def test_two_consecutive_anonymizations_do_not_collide(self):
        """
        Regression test for a real bug found during development: setting
        *_hash to '' instead of None on anonymize would make the SECOND
        anonymization raise an IntegrityError, since two empty strings
        collide under a unique constraint (unlike two NULLs).
        """
        user1 = User.objects.create_user(email='anon1@example.com', password='Sup3r$ecret1')
        user2 = User.objects.create_user(email='anon2@example.com', password='Sup3r$ecret1')
        p1 = user1.profile
        p1.set_cnic('11111-1111111-1')
        p1.save()
        p2 = user2.profile
        p2.set_cnic('22222-2222222-2')
        p2.save()

        for user in (user1, user2):
            user.is_deleted = True
            user.deletion_scheduled_at = timezone.now()
            user.save()
            user.anonymize()  # must not raise

        p1.refresh_from_db()
        p2.refresh_from_db()
        self.assertIsNone(p1.cnic_hash)
        self.assertIsNone(p2.cnic_hash)

    def test_freed_cnic_is_reusable_after_anonymization(self):
        user = User.objects.create_user(email='reuse@example.com', password='Sup3r$ecret1')
        profile = user.profile
        profile.set_cnic('33333-3333333-3')
        profile.save()
        user.is_deleted = True
        user.deletion_scheduled_at = timezone.now()
        user.save()
        user.anonymize()

        new_user = User.objects.create_user(email='newperson@example.com', password='Sup3r$ecret1')
        new_profile = new_user.profile
        new_profile.set_cnic('33333-3333333-3')  # should not raise
        new_profile.save()


class CNICUniquenessTests(TestCase):
    def test_duplicate_cnic_across_accounts_rejected(self):
        user1 = User.objects.create_user(email='u1@example.com', password='Sup3r$ecret1')
        user2 = User.objects.create_user(email='u2@example.com', password='Sup3r$ecret1')
        p1 = user1.profile
        p1.set_cnic('12345-1234567-1')
        p1.save()
        p2 = user2.profile
        with self.assertRaises(ValidationError):
            p2.set_cnic('12345-1234567-1')

    def test_dash_formatting_does_not_bypass_uniqueness(self):
        user1 = User.objects.create_user(email='u3@example.com', password='Sup3r$ecret1')
        user2 = User.objects.create_user(email='u4@example.com', password='Sup3r$ecret1')
        p1 = user1.profile
        p1.set_cnic('1234512345671')  # no dashes
        p1.save()
        p2 = user2.profile
        with self.assertRaises(ValidationError):
            p2.set_cnic('12345-1234567-1')  # same number, with dashes

    def test_malformed_cnic_rejected(self):
        user = User.objects.create_user(email='u5@example.com', password='Sup3r$ecret1')
        profile = user.profile
        with self.assertRaises(ValidationError):
            profile.set_cnic('123')

    def test_ntn_accepts_seven_or_eight_digits(self):
        user = User.objects.create_user(email='u6@example.com', password='Sup3r$ecret1')
        profile = user.profile
        profile.set_ntn('1234567')
        profile.save()
        self.assertEqual(profile.ntn, '1234567')

        profile.set_ntn('12345678')
        profile.save()
        self.assertEqual(profile.ntn, '12345678')


class TrustedDeviceModelTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(email='td@example.com', password='Sup3r$ecret1')

    def test_create_for_user_defaults_skip_2fa_false(self):
        device = TrustedDevice.create_for_user(self.user, 'raw-tok-1', 'device', '1.1.1.1')
        self.assertFalse(device.skip_2fa)

    def test_create_for_user_explicit_skip_2fa_true_respected(self):
        device = TrustedDevice.create_for_user(self.user, 'raw-tok-2', 'device', '1.1.1.1', skip_2fa=True)
        self.assertTrue(device.skip_2fa)

    def test_get_valid_returns_none_for_expired_token(self):
        device = TrustedDevice.create_for_user(self.user, 'raw-tok-3', 'device', '1.1.1.1')
        device.expires_at = timezone.now() - timedelta(days=1)
        device.save(update_fields=['expires_at'])
        self.assertIsNone(TrustedDevice.get_valid('raw-tok-3', self.user))

    def test_get_valid_returns_none_for_token_belonging_to_different_user(self):
        other_user = User.objects.create_user(email='td-other@example.com', password='Sup3r$ecret1')
        TrustedDevice.create_for_user(self.user, 'raw-tok-4', 'device', '1.1.1.1')
        self.assertIsNone(TrustedDevice.get_valid('raw-tok-4', other_user))

    def test_get_valid_returns_none_for_nonmatching_token(self):
        TrustedDevice.create_for_user(self.user, 'raw-tok-5', 'device', '1.1.1.1')
        self.assertIsNone(TrustedDevice.get_valid('completely-different-token', self.user))

    def test_get_valid_returns_matching_device(self):
        device = TrustedDevice.create_for_user(self.user, 'raw-tok-6', 'device', '1.1.1.1')
        found = TrustedDevice.get_valid('raw-tok-6', self.user)
        self.assertEqual(found.pk, device.pk)

    def test_custom_name_persists_through_save_reload(self):
        device = TrustedDevice.create_for_user(self.user, 'raw-tok-7', 'device', '1.1.1.1')
        device.custom_name = 'My MacBook'
        device.save(update_fields=['custom_name'])
        device.refresh_from_db()
        self.assertEqual(device.custom_name, 'My MacBook')

    def test_get_trusted_device_extends_sliding_window(self):
        """
        _get_trusted_device (views/auth.py) is supposed to slide the 30-day
        window forward from *last use*, not leave the original creation-time
        expiry in place — assert the actual timestamps moved, not just that
        a device was returned.
        """
        from apps.users.cookies import TRUSTED_DEVICE_COOKIE_NAME
        from apps.users.views.auth import _get_trusted_device

        device = TrustedDevice.create_for_user(self.user, 'raw-tok-8', 'device', '1.1.1.1')
        device.last_used_at = timezone.now() - timedelta(days=10)
        device.expires_at = timezone.now() + timedelta(days=20)
        device.save(update_fields=['last_used_at', 'expires_at'])
        old_last_used = device.last_used_at
        old_expires = device.expires_at

        request = RequestFactory().get('/')
        request.COOKIES = {TRUSTED_DEVICE_COOKIE_NAME: 'raw-tok-8'}
        result = _get_trusted_device(self.user, request)

        self.assertIsNotNone(result)
        device.refresh_from_db()
        self.assertGreater(device.last_used_at, old_last_used)
        self.assertGreater(device.expires_at, old_expires)