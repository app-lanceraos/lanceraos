# apps/invoices/tests/test_escalation_formal_notice.py
"""
Step 17 — Escalation dismiss + Formal Notice. Covers: the escalation
flag is set correctly at the real threshold (day-30/reminder_number=4,
already built in Step 10's send_invoice_reminders — confirmed directly
before writing this file, not assumed), dismiss-escalation (idempotent),
Formal Notice's manual-only gating (unreachable before escalation/
bad_debt), the disable-setting enforced server-side (not just hidden in
the UI), and formal_notice_sent_at surfacing a prior send without
blocking a deliberate second one.
"""
from datetime import date, timedelta
from decimal import Decimal
from unittest.mock import patch

from django.urls import reverse
from django.utils import timezone

from apps.invoices.models import Invoice, InvoiceItem, InvoiceReminder
from apps.invoices.tests.test_views import InvoicesAPITestCase
from core.models import AuditLog


def _overdue_invoice(user, **overrides):
    defaults = {
        'status': 'sent', 'sent_via_platform': True, 'reminders_enabled': True,
        'sent_at': timezone.now() - timedelta(days=40), 'due_date': date.today() - timedelta(days=35),
        'client_email': 'client@example.com',
    }
    defaults.update(overrides)
    invoice = Invoice.objects.create(user=user, invoice_number=Invoice.generate_invoice_number(user), **defaults)
    InvoiceItem.objects.create(invoice=invoice, description='Work', quantity=Decimal('1'), unit_price=Decimal('100'))
    return invoice


class EscalationThresholdTests(InvoicesAPITestCase):
    """Confirms the ALREADY-BUILT mechanism (Step 10's send_invoice_reminders) sets escalation_required at day 30 — this step adds the handler/dismiss action on top, not the flag-setting itself."""

    @patch('apps.invoices.tasks.send_invoice_related_email')
    def test_escalation_required_set_at_the_4th_reminder_not_before(self, mock_send):
        from apps.invoices.tasks import send_invoice_reminders
        mock_send.return_value = {'sent': True, 'sent_via': 'resend', 'smtp_host': None, 'provider_message_id': 'x', 'fallback_used': False, 'error': None}

        invoice = _overdue_invoice(self.user, sent_at=timezone.now() - timedelta(days=31), due_date=date.today() - timedelta(days=31))
        InvoiceReminder.objects.create(invoice=invoice, reminder_number=1, template_used='reminder_1', days_overdue_at_send=29)
        InvoiceReminder.objects.create(invoice=invoice, reminder_number=2, template_used='reminder_2', days_overdue_at_send=29)
        InvoiceReminder.objects.create(invoice=invoice, reminder_number=3, template_used='reminder_3', days_overdue_at_send=29)

        send_invoice_reminders()
        invoice.refresh_from_db()
        self.assertTrue(invoice.escalation_required)
        reminder = InvoiceReminder.objects.get(invoice=invoice, reminder_number=4)
        self.assertIsNotNone(reminder.sent_at)

    @patch('apps.invoices.tasks.send_invoice_related_email')
    def test_escalation_not_set_before_the_4th_reminder(self, mock_send):
        from apps.invoices.tasks import send_invoice_reminders
        mock_send.return_value = {'sent': True, 'sent_via': 'resend', 'smtp_host': None, 'provider_message_id': 'x', 'fallback_used': False, 'error': None}
        invoice = _overdue_invoice(self.user, sent_at=timezone.now() - timedelta(days=8), due_date=date.today() - timedelta(days=7))
        send_invoice_reminders()
        invoice.refresh_from_db()
        self.assertFalse(invoice.escalation_required)

    @patch('apps.invoices.tasks.send_invoice_related_email')
    def test_escalation_required_writes_a_bell_entry_and_emails_the_freelancer(self, mock_send):
        mock_send.return_value = {'sent': True, 'sent_via': 'resend', 'smtp_host': None, 'provider_message_id': 'x', 'fallback_used': False, 'error': None}
        from apps.invoices.tasks import send_invoice_reminders
        invoice = _overdue_invoice(self.user, sent_at=timezone.now() - timedelta(days=31), due_date=date.today() - timedelta(days=31))
        InvoiceReminder.objects.create(invoice=invoice, reminder_number=1, template_used='reminder_1', days_overdue_at_send=29)
        InvoiceReminder.objects.create(invoice=invoice, reminder_number=2, template_used='reminder_2', days_overdue_at_send=29)
        InvoiceReminder.objects.create(invoice=invoice, reminder_number=3, template_used='reminder_3', days_overdue_at_send=29)

        with patch('core.email.send_email') as mock_freelancer_email:
            mock_freelancer_email.return_value = True
            send_invoice_reminders()

        self.assertTrue(AuditLog.objects.filter(user=self.user, event='invoice_escalation_required').exists())
        mock_freelancer_email.assert_called_once()
        self.assertEqual(mock_freelancer_email.call_args.args[0], self.user.email)

    @patch('apps.invoices.tasks.send_invoice_related_email')
    def test_escalation_appears_in_the_timeline_using_the_4th_reminders_own_timestamp(self, mock_send):
        mock_send.return_value = {'sent': True, 'sent_via': 'resend', 'smtp_host': None, 'provider_message_id': 'x', 'fallback_used': False, 'error': None}
        from apps.invoices.tasks import send_invoice_reminders
        invoice = _overdue_invoice(self.user, sent_at=timezone.now() - timedelta(days=31), due_date=date.today() - timedelta(days=31))
        InvoiceReminder.objects.create(invoice=invoice, reminder_number=1, template_used='reminder_1', days_overdue_at_send=29)
        InvoiceReminder.objects.create(invoice=invoice, reminder_number=2, template_used='reminder_2', days_overdue_at_send=29)
        InvoiceReminder.objects.create(invoice=invoice, reminder_number=3, template_used='reminder_3', days_overdue_at_send=29)
        with patch('core.email.send_email'):
            send_invoice_reminders()

        resp = self._get(reverse('invoices:invoice_timeline', kwargs={'pk': invoice.pk}))
        self.assertEqual(resp.status_code, 200)
        escalation_entries = [e for e in resp.json()['results'] if e['type'] == 'escalation']
        self.assertEqual(len(escalation_entries), 1)
        self.assertFalse(escalation_entries[0]['dismissed'])


class DismissEscalationTests(InvoicesAPITestCase):
    def test_requires_a_real_escalation(self):
        invoice = self._invoice(status='sent', sent_at='2026-01-01T00:00:00Z')
        resp = self._post(reverse('invoices:invoice_dismiss_escalation', kwargs={'pk': invoice.pk}))
        self.assertEqual(resp.status_code, 400)

    def test_dismisses_a_real_escalation(self):
        invoice = self._invoice(status='sent', sent_at='2026-01-01T00:00:00Z', escalation_required=True)
        resp = self._post(reverse('invoices:invoice_dismiss_escalation', kwargs={'pk': invoice.pk}))
        self.assertEqual(resp.status_code, 200)
        invoice.refresh_from_db()
        self.assertTrue(invoice.escalation_dismissed)
        self.assertTrue(invoice.escalation_required)  # the historical fact stays true — only the prompt is dismissed

    def test_idempotent_double_dismiss(self):
        invoice = self._invoice(status='sent', sent_at='2026-01-01T00:00:00Z', escalation_required=True)
        first = self._post(reverse('invoices:invoice_dismiss_escalation', kwargs={'pk': invoice.pk}))
        second = self._post(reverse('invoices:invoice_dismiss_escalation', kwargs={'pk': invoice.pk}))
        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)

    def test_never_reachable_for_another_freelancers_invoice(self):
        from apps.users.models import User
        other_user = User.objects.create_user(email='other@example.com', password='Sup3r$ecret1')
        their_invoice = Invoice.objects.create(
            user=other_user, invoice_number=Invoice.generate_invoice_number(other_user),
            client_name='X', client_email='x@example.com', status='sent',
            sent_at='2026-01-01T00:00:00Z', escalation_required=True, due_date=date(2026, 1, 31),
        )
        resp = self._post(reverse('invoices:invoice_dismiss_escalation', kwargs={'pk': their_invoice.pk}))
        self.assertEqual(resp.status_code, 404)


class FormalNoticeGatingTests(InvoicesAPITestCase):
    def test_requires_confirm(self):
        invoice = self._invoice(status='sent', sent_at='2026-01-01T00:00:00Z', escalation_required=True, client_email='client@example.com')
        resp = self._post(reverse('invoices:invoice_send_formal_notice', kwargs={'pk': invoice.pk}))
        self.assertEqual(resp.status_code, 400)

    def test_unreachable_without_escalation_or_bad_debt(self):
        invoice = self._invoice(status='sent', sent_at='2026-01-01T00:00:00Z', client_email='client@example.com')
        resp = self._post(reverse('invoices:invoice_send_formal_notice', kwargs={'pk': invoice.pk}), {'confirm': True})
        self.assertEqual(resp.status_code, 400)

    def test_reachable_once_escalation_required(self):
        invoice = self._invoice(status='sent', sent_at='2026-01-01T00:00:00Z', escalation_required=True, client_email='client@example.com')
        resp = self._post(reverse('invoices:invoice_send_formal_notice', kwargs={'pk': invoice.pk}), {'confirm': True})
        self.assertEqual(resp.status_code, 200)

    def test_reachable_once_escalation_required_even_if_dismissed(self):
        """Dismissing the PROMPT doesn't mean the invoice stopped being severely overdue."""
        invoice = self._invoice(
            status='sent', sent_at='2026-01-01T00:00:00Z', escalation_required=True, escalation_dismissed=True,
            client_email='client@example.com',
        )
        resp = self._post(reverse('invoices:invoice_send_formal_notice', kwargs={'pk': invoice.pk}), {'confirm': True})
        self.assertEqual(resp.status_code, 200)

    def test_reachable_for_bad_debt_even_without_escalation(self):
        invoice = self._invoice(status='bad_debt', sent_at='2026-01-01T00:00:00Z', client_email='client@example.com')
        resp = self._post(reverse('invoices:invoice_send_formal_notice', kwargs={'pk': invoice.pk}), {'confirm': True})
        self.assertEqual(resp.status_code, 200)

    def test_sets_formal_notice_sent_at(self):
        invoice = self._invoice(status='sent', sent_at='2026-01-01T00:00:00Z', escalation_required=True, client_email='client@example.com')
        resp = self._post(reverse('invoices:invoice_send_formal_notice', kwargs={'pk': invoice.pk}), {'confirm': True})
        self.assertEqual(resp.status_code, 200)
        invoice.refresh_from_db()
        self.assertIsNotNone(invoice.formal_notice_sent_at)

    def test_a_second_deliberate_send_is_not_blocked_only_surfaced(self):
        invoice = self._invoice(status='sent', sent_at='2026-01-01T00:00:00Z', escalation_required=True, client_email='client@example.com')
        first = self._post(reverse('invoices:invoice_send_formal_notice', kwargs={'pk': invoice.pk}), {'confirm': True})
        self.assertEqual(first.status_code, 200)
        first_timestamp = first.json()['formal_notice_sent_at']

        second = self._post(reverse('invoices:invoice_send_formal_notice', kwargs={'pk': invoice.pk}), {'confirm': True})
        self.assertEqual(second.status_code, 200)  # not blocked
        self.assertNotEqual(second.json()['formal_notice_sent_at'], first_timestamp)  # genuinely re-sent, real new timestamp

    def test_never_reachable_for_another_freelancers_invoice(self):
        from apps.users.models import User
        other_user = User.objects.create_user(email='other@example.com', password='Sup3r$ecret1')
        their_invoice = Invoice.objects.create(
            user=other_user, invoice_number=Invoice.generate_invoice_number(other_user),
            client_name='X', client_email='x@example.com', status='bad_debt',
            sent_at='2026-01-01T00:00:00Z', due_date=date(2026, 1, 31),
        )
        resp = self._post(reverse('invoices:invoice_send_formal_notice', kwargs={'pk': their_invoice.pk}), {'confirm': True})
        self.assertEqual(resp.status_code, 404)


class FormalNoticeDisableSettingTests(InvoicesAPITestCase):
    def test_disabled_server_side_rejects_even_with_confirm(self):
        self.user.profile.formal_notice_enabled = False
        self.user.profile.save(update_fields=['formal_notice_enabled'])
        invoice = self._invoice(status='sent', sent_at='2026-01-01T00:00:00Z', escalation_required=True, client_email='client@example.com')
        resp = self._post(reverse('invoices:invoice_send_formal_notice', kwargs={'pk': invoice.pk}), {'confirm': True})
        self.assertEqual(resp.status_code, 403)
        invoice.refresh_from_db()
        self.assertIsNone(invoice.formal_notice_sent_at)

    def test_enabled_by_default(self):
        self.assertTrue(self.user.profile.formal_notice_enabled)

    def test_toggle_is_writable_via_the_profile_endpoint(self):
        resp = self.client.put(
            reverse('users:profile'), data='{"formal_notice_enabled": false}', content_type='application/json',
            HTTP_X_CSRFTOKEN=self._csrf_token(),
        )
        self.assertEqual(resp.status_code, 200)
        self.user.profile.refresh_from_db()
        self.assertFalse(self.user.profile.formal_notice_enabled)


class FormalNoticeAuditTests(InvoicesAPITestCase):
    def test_writes_an_audit_log_entry_but_no_bell_notification(self):
        """Self-triggered by the freelancer — same exclusion InvoiceSent/CommentPosted already establish."""
        invoice = self._invoice(status='sent', sent_at='2026-01-01T00:00:00Z', escalation_required=True, client_email='client@example.com')
        self._post(reverse('invoices:invoice_send_formal_notice', kwargs={'pk': invoice.pk}), {'confirm': True})

        self.assertTrue(AuditLog.objects.filter(user=self.user, event='formal_notice_sent').exists())
        from core.notifications import NOTIFICATION_EVENTS
        self.assertNotIn('formal_notice_sent', NOTIFICATION_EVENTS)

    def test_rate_limited(self):
        from django.core.cache import cache
        invoice = self._invoice(status='sent', sent_at='2026-01-01T00:00:00Z', escalation_required=True, client_email='client@example.com')
        for _ in range(30):
            self._post(reverse('invoices:invoice_send_formal_notice', kwargs={'pk': invoice.pk}), {'confirm': True})
        resp = self._post(reverse('invoices:invoice_send_formal_notice', kwargs={'pk': invoice.pk}), {'confirm': True})
        self.assertEqual(resp.status_code, 429)
