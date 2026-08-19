# apps/invoices/tests/test_recurring.py
"""
Step 16 — Recurring invoice generation. Covers: the root-settings-read
mechanic (editing the root's interval mid-series changes what the NEXT
generation uses; editing one generated child is independent and doesn't
affect the root or future generations), design_id locked at generation
time even if the root's design later changes, auto_send true/false
paths, calendar-month interval math (not just day-count intervals),
failure handling (next_recurring_date unchanged on failure, 3-strikes
auto-pause with its own notification), and chain linkage.
"""
import copy
import json
from datetime import date, timedelta
from decimal import Decimal
from unittest.mock import MagicMock, patch

from django.core.cache import cache
from django.middleware.csrf import get_token
from django.test import Client as DjangoTestClient
from django.test import RequestFactory, TestCase
from django.urls import reverse
from django.utils import timezone

from apps.invoices.design_seeds import BUILTIN_DESIGNS
from apps.invoices.models import Invoice, InvoiceDesign, InvoiceItem
from apps.invoices.tasks import MAX_RECURRING_FAILURES, _advance_recurring_date, generate_recurring_invoices
from apps.invoices.tests.test_models import make_invoice
from apps.users.models import User
from core.models import AuditLog


def _recurring_invoice(user, **overrides):
    defaults = {
        'is_recurring': True, 'recurring_interval_days': 30, 'recurring_auto_send': False,
        'next_recurring_date': date(2026, 1, 1), 'status': 'sent', 'sent_at': '2026-01-01T00:00:00Z',
        'due_date': date(2026, 1, 15), 'issue_date': date(2026, 1, 1),
    }
    defaults.update(overrides)
    invoice = make_invoice(user, **defaults)
    InvoiceItem.objects.create(invoice=invoice, description='Retainer', quantity=Decimal('1'), unit_price=Decimal('100'))
    return invoice


class RecurringGenerationBasicsTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(email='freelancer@example.com', password='Sup3r$ecret1')

    def test_generates_a_new_draft_child_for_a_due_invoice(self):
        root = _recurring_invoice(self.user)
        result = generate_recurring_invoices()
        self.assertEqual(result['generated'], 1)

        children = Invoice.objects.filter(parent_invoice=root)
        self.assertEqual(children.count(), 1)
        child = children.first()
        self.assertEqual(child.status, 'draft')
        self.assertEqual(child.client_name, root.client_name)
        self.assertEqual(child.items.count(), 1)

    def test_not_due_invoice_is_untouched(self):
        _recurring_invoice(self.user, next_recurring_date=date.today() + timedelta(days=30))
        result = generate_recurring_invoices()
        self.assertEqual(result['generated'], 0)
        self.assertEqual(Invoice.objects.count(), 1)

    def test_paused_invoice_is_untouched(self):
        _recurring_invoice(self.user, recurring_paused=True)
        result = generate_recurring_invoices()
        self.assertEqual(result['generated'], 0)
        self.assertEqual(Invoice.objects.count(), 1)

    def test_non_recurring_invoice_is_untouched(self):
        make_invoice(self.user, is_recurring=False, next_recurring_date=date(2026, 1, 1))
        result = generate_recurring_invoices()
        self.assertEqual(result['generated'], 0)
        self.assertEqual(Invoice.objects.count(), 1)

    def test_generated_child_never_independently_retriggers(self):
        """The child gets is_recurring=False/next_recurring_date=None — running the task again must never generate a grandchild from it."""
        root = _recurring_invoice(self.user)
        generate_recurring_invoices()
        child = Invoice.objects.get(parent_invoice=root)
        self.assertFalse(child.is_recurring)
        self.assertIsNone(child.next_recurring_date)

        # Push the ROOT's own next_recurring_date far into the future
        # (real "today" during a test run is nowhere near this fixture's
        # 2026-01-01 dates, so the root itself would otherwise still be
        # "due" again and generate a second, legitimate cycle — that's
        # not what this test is checking). Then force the CHILD to look
        # like it might independently qualify, to confirm is_recurring
        # =False alone is what excludes it — belt and suspenders against
        # the query filter, not just "it never got a date."
        Invoice.objects.filter(pk=root.pk).update(next_recurring_date=date(2099, 1, 1))
        Invoice.objects.filter(pk=child.pk).update(next_recurring_date=date(2026, 1, 1))
        result = generate_recurring_invoices()
        self.assertEqual(result['generated'], 0)  # is_recurring=False still excludes the child


class RecurringChainLinkageTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(email='freelancer@example.com', password='Sup3r$ecret1')

    def test_parent_invoice_points_at_the_triggering_invoice(self):
        root = _recurring_invoice(self.user)
        generate_recurring_invoices()
        child = Invoice.objects.get(parent_invoice=root)
        self.assertEqual(child.parent_invoice_id, root.pk)

    def test_get_recurring_root_walks_back_to_the_true_root(self):
        root = _recurring_invoice(self.user)
        child = make_invoice(self.user, parent_invoice=root, client_name=root.client_name)
        grandchild = make_invoice(self.user, parent_invoice=child, client_name=root.client_name)
        self.assertEqual(grandchild.get_recurring_root().pk, root.pk)
        self.assertEqual(child.get_recurring_root().pk, root.pk)
        self.assertEqual(root.get_recurring_root().pk, root.pk)

    def test_advances_next_recurring_date_on_the_triggering_invoice_not_the_child(self):
        root = _recurring_invoice(self.user, recurring_interval_days=7)
        generate_recurring_invoices()
        root.refresh_from_db()
        self.assertEqual(root.next_recurring_date, date(2026, 1, 8))  # anchored from the OLD value, +7 days

        child = Invoice.objects.get(parent_invoice=root)
        self.assertIsNone(child.next_recurring_date)


class RecurringDueDateTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(email='freelancer@example.com', password='Sup3r$ecret1')

    @patch('apps.invoices.tasks.timezone')
    def test_due_date_recomputed_from_the_same_terms_offset_not_copied_verbatim(self, mock_tz):
        """The root's due_date (Jan 15) is 14 days after its issue_date (Jan 1) — Net 14. Generation 'today' is mocked to Mar 1: the new child's due_date must be Mar 15, not the stale Jan 15."""
        mock_tz.now.return_value = timezone.datetime(2026, 3, 1, tzinfo=timezone.get_current_timezone())
        root = _recurring_invoice(self.user, issue_date=date(2026, 1, 1), due_date=date(2026, 1, 15))
        generate_recurring_invoices()
        child = Invoice.objects.get(parent_invoice=root)
        self.assertEqual(child.due_date, date(2026, 3, 15))


class RecurringCalendarMonthTests(TestCase):
    def test_monthly_advances_by_a_real_calendar_month(self):
        self.assertEqual(_advance_recurring_date(date(2026, 1, 31), 30), date(2026, 2, 28))  # not Mar 2

    def test_every_2_months_advances_by_2_real_calendar_months(self):
        self.assertEqual(_advance_recurring_date(date(2026, 1, 31), 60), date(2026, 3, 31))

    def test_quarterly_advances_by_3_real_calendar_months(self):
        self.assertEqual(_advance_recurring_date(date(2026, 1, 31), 90), date(2026, 4, 30))

    def test_annually_advances_by_12_real_calendar_months(self):
        self.assertEqual(_advance_recurring_date(date(2026, 1, 31), 365), date(2027, 1, 31))

    def test_weekly_is_a_plain_7_day_add(self):
        self.assertEqual(_advance_recurring_date(date(2026, 1, 1), 7), date(2026, 1, 8))

    def test_fortnightly_is_a_plain_14_day_add(self):
        self.assertEqual(_advance_recurring_date(date(2026, 1, 1), 14), date(2026, 1, 15))


class RecurringRootSettingsTests(TestCase):
    def setUp(self):
        cache.clear()
        self.rf = RequestFactory()
        self.client = DjangoTestClient(enforce_csrf_checks=True)
        self.user = User.objects.create_user(email='freelancer@example.com', password='Sup3r$ecret1')
        self.user.is_email_verified = True
        self.user.is_active = True
        self.user.save()
        self._login()

    def _csrf_token(self):
        dummy = self.rf.get('/')
        token = get_token(dummy)
        self.client.cookies['csrftoken'] = dummy.META['CSRF_COOKIE']
        return token

    def _login(self):
        csrf_token = self._csrf_token()
        resp = self.client.post(reverse('users:login'), data=json.dumps({
            'login': self.user.email, 'password': 'Sup3r$ecret1',
        }), content_type='application/json', HTTP_X_CSRFTOKEN=csrf_token)
        assert resp.status_code == 200, resp.content

    def _put(self, url, data):
        csrf_token = self._csrf_token()
        return self.client.put(url, data=json.dumps(data), content_type='application/json', HTTP_X_CSRFTOKEN=csrf_token)

    def test_editing_roots_interval_changes_what_the_next_generation_uses(self):
        root = _recurring_invoice(self.user, recurring_interval_days=30)
        resp = self._put(reverse('invoices:invoice_detail', kwargs={'pk': root.pk}), {'recurring_interval_days': 7})
        self.assertEqual(resp.status_code, 200)
        root.refresh_from_db()
        self.assertEqual(root.recurring_interval_days, 7)

        generate_recurring_invoices()
        root.refresh_from_db()
        self.assertEqual(root.next_recurring_date, date(2026, 1, 8))  # +7, the NEW interval — not +30

    def test_editing_roots_auto_send_is_read_live_at_generation_time(self):
        root = _recurring_invoice(self.user, recurring_auto_send=False)
        self._put(reverse('invoices:invoice_detail', kwargs={'pk': root.pk}), {'recurring_auto_send': True})
        root.refresh_from_db()
        self.assertTrue(root.recurring_auto_send)

        with patch('apps.invoices.views._finalise_invoice') as mock_finalise, \
             patch('apps.invoices.views._send_invoice_now') as mock_send:
            mock_send.return_value = MagicMock(status_code=200)
            generate_recurring_invoices()
        mock_finalise.assert_called_once()
        mock_send.assert_called_once()

    def test_only_recurring_interval_days_and_recurring_auto_send_are_allowed_on_a_non_draft_root(self):
        root = _recurring_invoice(self.user)  # status='sent', not draft
        resp = self._put(reverse('invoices:invoice_detail', kwargs={'pk': root.pk}), {
            'recurring_interval_days': 7, 'notes': 'trying to sneak this in too',
        })
        self.assertEqual(resp.status_code, 403)
        root.refresh_from_db()
        self.assertEqual(root.recurring_interval_days, 30)  # unchanged — the whole request was rejected

    def test_non_root_invoice_gets_the_ordinary_is_editable_rejection(self):
        """A generated child (has a parent_invoice) is never a 'root' — no special allowance, even with only the 2 allowed fields."""
        root = _recurring_invoice(self.user)
        child = make_invoice(self.user, parent_invoice=root, status='sent', sent_at='2026-01-01T00:00:00Z', is_recurring=False)
        resp = self._put(reverse('invoices:invoice_detail', kwargs={'pk': child.pk}), {'recurring_interval_days': 7})
        self.assertEqual(resp.status_code, 403)

    def test_editing_one_generated_child_directly_is_independent_of_the_root(self):
        root = _recurring_invoice(self.user)
        generate_recurring_invoices()
        child = Invoice.objects.get(parent_invoice=root)
        self.assertEqual(child.status, 'draft')  # a fresh draft — ordinarily editable

        resp = self._put(reverse('invoices:invoice_detail', kwargs={'pk': child.pk}), {
            'notes': 'a one-off change to just this occurrence',
        })
        self.assertEqual(resp.status_code, 200, resp.content)
        child.refresh_from_db()
        self.assertEqual(child.notes, 'a one-off change to just this occurrence')

        root.refresh_from_db()
        self.assertNotEqual(root.notes, 'a one-off change to just this occurrence')  # root untouched

        # And a SECOND generation still reads the ROOT's own (unedited) content, not the edited child's.
        Invoice.objects.filter(pk=root.pk).update(next_recurring_date=date(2026, 2, 1))
        generate_recurring_invoices()
        second_child = Invoice.objects.filter(parent_invoice=root).exclude(pk=child.pk).first()
        self.assertIsNotNone(second_child)
        self.assertNotEqual(second_child.notes, 'a one-off change to just this occurrence')


class RecurringDesignLockTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(email='freelancer@example.com', password='Sup3r$ecret1')

    def test_design_copied_from_root_survives_the_roots_design_later_changing(self):
        design_a = InvoiceDesign.objects.create(
            user=self.user, name='Design A', base_template='professional',
            design_data=copy.deepcopy(BUILTIN_DESIGNS['professional']),
        )
        design_b = InvoiceDesign.objects.create(
            user=self.user, name='Design B', base_template='minimal',
            design_data=copy.deepcopy(BUILTIN_DESIGNS['minimal']),
        )
        root = _recurring_invoice(self.user, design=design_a)

        generate_recurring_invoices()
        child = Invoice.objects.get(parent_invoice=root)
        self.assertEqual(child.design_id, design_a.pk)

        # The root's own design changes AFTER that first generation —
        # the already-generated child must never retroactively change.
        root.design = design_b
        root.save(update_fields=['design'])
        child.refresh_from_db()
        self.assertEqual(child.design_id, design_a.pk)  # still locked to what it was generated with

        # A SECOND generation now locks in the NEW design.
        Invoice.objects.filter(pk=root.pk).update(next_recurring_date=date(2026, 2, 1))
        generate_recurring_invoices()
        second_child = Invoice.objects.filter(parent_invoice=root).exclude(pk=child.pk).first()
        self.assertEqual(second_child.design_id, design_b.pk)


class RecurringFailureHandlingTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(email='freelancer@example.com', password='Sup3r$ecret1')

    @patch('apps.invoices.views._duplicate_invoice_core')
    def test_next_recurring_date_unchanged_on_a_real_generation_failure(self, mock_duplicate):
        mock_duplicate.side_effect = RuntimeError('boom')
        root = _recurring_invoice(self.user)
        original_next_date = root.next_recurring_date

        result = generate_recurring_invoices()
        self.assertEqual(result['failed'], 1)
        root.refresh_from_db()
        self.assertEqual(root.next_recurring_date, original_next_date)  # unchanged — will retry next run
        self.assertEqual(root.recurring_failure_count, 1)
        self.assertFalse(root.recurring_paused)

    @patch('apps.invoices.views._duplicate_invoice_core')
    @patch('core.email.send_email')
    def test_three_consecutive_failures_auto_pauses_with_its_own_notification(self, mock_send, mock_duplicate):
        mock_send.return_value = True
        mock_duplicate.side_effect = RuntimeError('boom')
        root = _recurring_invoice(self.user)

        for i in range(MAX_RECURRING_FAILURES):
            generate_recurring_invoices()
            root.refresh_from_db()
            if i < MAX_RECURRING_FAILURES - 1:
                self.assertFalse(root.recurring_paused)

        self.assertEqual(root.recurring_failure_count, MAX_RECURRING_FAILURES)
        self.assertTrue(root.recurring_paused)

        self.assertTrue(AuditLog.objects.filter(user=self.user, event='recurring_generation_paused').exists())
        paused_calls = [c for c in mock_send.call_args_list if 'paused' in c.args[1].lower()]
        self.assertTrue(paused_calls)

    @patch('apps.invoices.views._duplicate_invoice_core')
    def test_a_downstream_auto_send_failure_does_not_count_as_a_generation_failure(self, mock_duplicate):
        """The occurrence itself WAS generated (a real child row created) — a raised exception from finalise/send must not trigger the retry/failure-count machinery, or a retry would create a duplicate occurrence."""
        root = _recurring_invoice(self.user, recurring_auto_send=True)
        real_child = make_invoice(self.user, parent_invoice=root, client_name=root.client_name)
        mock_duplicate.return_value = real_child

        with patch('apps.invoices.views._finalise_invoice', side_effect=RuntimeError('pdf render exploded')):
            result = generate_recurring_invoices()

        self.assertEqual(result['generated'], 1)
        self.assertEqual(result['failed'], 0)
        root.refresh_from_db()
        self.assertEqual(root.recurring_failure_count, 0)
        self.assertIsNotNone(root.next_recurring_date)


class RecurringNotificationTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(email='freelancer@example.com', password='Sup3r$ecret1')

    def test_generated_without_auto_send_is_in_app_only_no_email(self):
        _recurring_invoice(self.user, recurring_auto_send=False)
        with patch('core.email.send_email') as mock_send:
            generate_recurring_invoices()
        mock_send.assert_not_called()
        self.assertTrue(AuditLog.objects.filter(user=self.user, event='recurring_invoice_generated').exists())

    @patch('apps.invoices.views._duplicate_invoice_core')
    @patch('core.email.send_email')
    def test_generation_failure_emails_the_freelancer(self, mock_send, mock_duplicate):
        mock_send.return_value = True
        mock_duplicate.side_effect = RuntimeError('boom')
        root = _recurring_invoice(self.user)
        generate_recurring_invoices()

        self.assertTrue(AuditLog.objects.filter(user=self.user, event='recurring_generation_failed').exists())
        mock_send.assert_called_once()
        self.assertEqual(mock_send.call_args.args[0], self.user.email)

    def test_respects_notif_invoice_events_opt_out_for_generated(self):
        self.user.profile.notif_invoice_events = False
        self.user.profile.save(update_fields=['notif_invoice_events'])
        _recurring_invoice(self.user, recurring_auto_send=False)
        generate_recurring_invoices()
        self.assertFalse(AuditLog.objects.filter(user=self.user, event='recurring_invoice_generated').exists())


class RecurringRealAutoSendIntegrationTests(TestCase):
    """One real end-to-end pass through _finalise_invoice + _send_invoice_now (real WeasyPrint render), mocking only the true externals (Cloudinary upload, the PDF re-fetch) — proves the wiring genuinely works, not just that mocks got called."""
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(email='freelancer@example.com', password='Sup3r$ecret1')

    @patch('apps.invoices.email_service._pdf_fetch_session.get')
    @patch('cloudinary.uploader.upload')
    def test_auto_send_generates_finalises_and_sends_for_real(self, mock_upload, mock_get):
        mock_upload.return_value = {'secure_url': 'https://res.cloudinary.com/demo/raw/upload/invoice.pdf', 'public_id': 'invoice_x'}
        mock_resp = MagicMock(status_code=200, content=b'%PDF-1.4 fake')
        mock_resp.raise_for_status = MagicMock()
        mock_get.return_value = mock_resp

        root = _recurring_invoice(self.user, recurring_auto_send=True, client_email='client@example.com')
        result = generate_recurring_invoices()
        self.assertEqual(result['generated'], 1)

        child = Invoice.objects.get(parent_invoice=root)
        self.assertEqual(child.status, 'sent')
        self.assertTrue(child.sent_via_platform)
        self.assertTrue(child.pdf_url)


class RecurringNextDateInitializationTests(TestCase):
    """
    Real, confirmed bug found 19 August 2026: next_recurring_date was never
    set anywhere outside this file's own test fixtures (_recurring_invoice
    hand-sets it directly) or generate_recurring_invoices' own advance step
    (which only runs once a value already exists). A recurring invoice
    created and finalised through the REAL wizard/API flow sat with
    next_recurring_date=None forever, so it could never satisfy
    next_recurring_date__lte=today and generate_recurring_invoices always
    saw 0 eligible invoices for it — confirmed live against real production
    data (4 real recurring roots, all next_recurring_date=None despite
    finalised_at set weeks ago). Reconstructs the real gap end-to-end
    through the actual finalise endpoint, not the test-only factory.
    """
    def setUp(self):
        cache.clear()
        self.rf = RequestFactory()
        self.client = DjangoTestClient(enforce_csrf_checks=True)
        self.user = User.objects.create_user(email='freelancer@example.com', password='Sup3r$ecret1')
        self.user.is_email_verified = True
        self.user.is_active = True
        self.user.save()
        self._login()

    def _csrf_token(self):
        dummy = self.rf.get('/')
        token = get_token(dummy)
        self.client.cookies['csrftoken'] = dummy.META['CSRF_COOKIE']
        return token

    def _login(self):
        csrf_token = self._csrf_token()
        resp = self.client.post(reverse('users:login'), data=json.dumps({
            'login': self.user.email, 'password': 'Sup3r$ecret1',
        }), content_type='application/json', HTTP_X_CSRFTOKEN=csrf_token)
        assert resp.status_code == 200, resp.content

    def _post(self, url, data=None):
        csrf_token = self._csrf_token()
        return self.client.post(url, data=json.dumps(data or {}), content_type='application/json', HTTP_X_CSRFTOKEN=csrf_token)

    def _draft_recurring_invoice(self, interval_days, issue_date):
        invoice = make_invoice(
            self.user, status='draft', invoice_number=None, is_recurring=True,
            recurring_interval_days=interval_days, issue_date=issue_date,
            due_date=issue_date + timedelta(days=14),
        )
        InvoiceItem.objects.create(invoice=invoice, description='Retainer', quantity=Decimal('1'), unit_price=Decimal('100'))
        return invoice

    def test_finalising_a_weekly_recurring_draft_seeds_next_recurring_date(self):
        invoice = self._draft_recurring_invoice(7, date(2026, 1, 1))
        resp = self._post(reverse('invoices:invoice_finalise', kwargs={'pk': invoice.pk}))
        self.assertEqual(resp.status_code, 200)
        invoice.refresh_from_db()
        self.assertEqual(invoice.next_recurring_date, date(2026, 1, 8))  # issue_date + 1 week, matching _advance_recurring_date

    def test_finalising_a_monthly_recurring_draft_seeds_a_calendar_accurate_date(self):
        invoice = self._draft_recurring_invoice(30, date(2026, 1, 31))
        self._post(reverse('invoices:invoice_finalise', kwargs={'pk': invoice.pk}))
        invoice.refresh_from_db()
        self.assertEqual(invoice.next_recurring_date, date(2026, 2, 28))  # real calendar month, not +30 days

    def test_finalising_a_non_recurring_draft_never_sets_next_recurring_date(self):
        invoice = make_invoice(self.user, status='draft', invoice_number=None, is_recurring=False)
        InvoiceItem.objects.create(invoice=invoice, description='Work', quantity=Decimal('1'), unit_price=Decimal('100'))
        self._post(reverse('invoices:invoice_finalise', kwargs={'pk': invoice.pk}))
        invoice.refresh_from_db()
        self.assertIsNone(invoice.next_recurring_date)

    def test_finalising_a_generated_child_never_sets_its_own_next_recurring_date(self):
        """A generated child has is_recurring reset to False by _duplicate_invoice_core before this could ever matter — belt and suspenders, matching test_generated_child_never_independently_retriggers above."""
        root = self._draft_recurring_invoice(7, date(2026, 1, 1))
        self._post(reverse('invoices:invoice_finalise', kwargs={'pk': root.pk}))
        root.refresh_from_db()

        child = make_invoice(
            self.user, status='draft', invoice_number=None, parent_invoice=root,
            is_recurring=True, recurring_interval_days=7,  # deliberately forced True, to prove the parent_invoice_id guard alone stops it
        )
        InvoiceItem.objects.create(invoice=child, description='Work', quantity=Decimal('1'), unit_price=Decimal('100'))
        self._post(reverse('invoices:invoice_finalise', kwargs={'pk': child.pk}))
        child.refresh_from_db()
        self.assertIsNone(child.next_recurring_date)

    def test_full_real_gap_reconstruction_finalise_then_generation_picks_it_up_once_due(self):
        """The exact reported scenario: a real invoice created+finalised through the real endpoint, then generate_recurring_invoices() actually finding and generating it once next_recurring_date arrives — not a fixture pre-seeded with a working value."""
        invoice = self._draft_recurring_invoice(7, date.today() - timedelta(days=7))
        self._post(reverse('invoices:invoice_finalise', kwargs={'pk': invoice.pk}))
        invoice.refresh_from_db()
        self.assertEqual(invoice.next_recurring_date, date.today())  # issue_date (7 days ago) + 1 week = today, so it's due now

        result = generate_recurring_invoices()
        self.assertEqual(result['generated'], 1)
        self.assertTrue(Invoice.objects.filter(parent_invoice=invoice).exists())
