# apps/users/tests/test_tasks.py
from datetime import timedelta
from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone

from apps.users.models import User
from apps.users.tasks import anonymize_expired_accounts


class AnonymizeTaskEmailTests(TestCase):
    @patch('apps.users.emails.send_account_deleted_email', return_value=True)
    def test_anonymize_task_sends_deletion_email_to_original_address(self, mock_email):
        """
        The deletion-confirmation email must go to the account's ORIGINAL
        email address, not the anonymized 'deleted-<hex>@lanceraos.invalid'
        placeholder — this only works if the email is captured before
        anonymize() overwrites it. Assert the actual ordering, not just
        that an email fires.
        """
        user = User.objects.create_user(email='original@example.com', password='Sup3r$ecret1')
        user.is_deleted = True
        user.deletion_scheduled_at = timezone.now() - timedelta(days=1)
        user.save()

        anonymize_expired_accounts()

        mock_email.assert_called_once_with('original@example.com')

        user.refresh_from_db()
        self.assertTrue(user.email.startswith('deleted-'))
        self.assertNotEqual(user.email, 'original@example.com')

    @patch('apps.users.emails.send_account_deleted_email', return_value=True)
    def test_anonymize_task_skips_accounts_not_yet_due(self, mock_email):
        user = User.objects.create_user(email='notdue@example.com', password='Sup3r$ecret1')
        user.is_deleted = True
        user.deletion_scheduled_at = timezone.now() + timedelta(days=10)
        user.save()

        anonymize_expired_accounts()

        mock_email.assert_not_called()
        user.refresh_from_db()
        self.assertEqual(user.email, 'notdue@example.com')
        self.assertIsNone(user.anonymized_at)
