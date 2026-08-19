# apps/invoices/tests/test_concurrency.py
"""
Real-concurrency regression tests for LANCERAOS_CLIENTS_INVOICES_PRODUCTION_AUDIT.md
(19 August 2026) findings INV-003/DB-002 (overpayment race), INV-004
(invoice-number generation race), and INV-009/FE-001 (Undo Payment
reachable on a terminal-status invoice).

These fire GENUINE concurrent requests via real Python threads, each
using its own PostgreSQL connection (Django opens one per thread
automatically), against a real running Django test-client dispatch —
not sequential calls dressed up to look concurrent. This is why the
suite uses TransactionTestCase, not TestCase: TestCase wraps each test
in one outer transaction that other threads' connections can never see
uncommitted writes from (and select_for_update()'s blocking behavior
requires two REAL, separate transactions on separate connections to
observe at all) — TransactionTestCase commits for real, exactly like
the live audit's own reproduction did.

All three race-condition-shaped findings (INV-003/DB-002 and INV-004)
are proven both by (a) their originally-buggy shape now correctly
serializing instead of corrupting, and (b) running with MORE concurrent
attempts than the audit's own minimum reproduction (3 for payments, 4-5
for finalise), per the assigned fix task's explicit request for real
confidence rather than just clearing the bar.

The INV-009 cases (undo-on-terminal-status) are not concurrency-shaped —
they're a missing status guard, reproduced with ordinary sequential
requests, exactly like the audit's own live reproduction was.
"""
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from decimal import Decimal
from unittest.mock import patch

from django.core.cache import cache
from django.middleware.csrf import get_token
from django.test import Client as DjangoTestClient
from django.test import RequestFactory, TransactionTestCase
from django.urls import reverse
from django.utils import timezone

from apps.invoices.models import Invoice, InvoiceItem, InvoicePartialPayment
from apps.invoices.tests.test_models import make_invoice
from apps.users.models import User
from apps.users.token_service import issue_tokens_and_session
from apps.users.cookies import ACCESS_COOKIE_NAME


class ConcurrencyTestCase(TransactionTestCase):
    """
    Shared setup: one real user, one real minted session/access token
    (via apps.users.token_service — the same real code path login uses,
    not a shortcut), and a helper that hands out fresh, independently-
    authenticated django.test.Client instances sharing that ONE token.

    Deliberately mints exactly one session rather than logging in once
    per thread: apps.users.models.Session caps concurrent sessions at 3
    per account (a real, load-bearing security feature, not something
    this test should trip or work around) — a real request, from any
    number of simultaneous browser tabs/devices, always presents
    whatever single access-token cookie that browser/device already
    holds, so sharing one real token across concurrent threads is what
    actually models "the same logged-in user, several requests at once,"
    not several different logins racing each other.

    CSRF checks are left off (django.test.Client's default) — this
    suite's job is testing the locking/status-guard, not CSRF, and the
    existing InvoicesAPITestCase already exercises CSRF elsewhere.
    """

    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(email='concurrency@example.com', password='Sup3r$ecret1')
        self.user.is_email_verified = True
        self.user.is_active = True
        self.user.save()

        rf = RequestFactory()
        req = rf.post('/api/auth/login/', HTTP_USER_AGENT='ConcurrencyTest/1.0')
        req.META['REMOTE_ADDR'] = '127.0.0.1'
        access_token, _refresh_token, _session = issue_tokens_and_session(self.user, req, remember_me=True)
        self.access_token = access_token

    def _authed_client(self):
        client = DjangoTestClient()
        client.cookies[ACCESS_COOKIE_NAME] = self.access_token
        return client

    def _post_json(self, client, url, data=None):
        return client.post(url, data=json.dumps(data or {}), content_type='application/json')

    def _put_json(self, client, url, data=None):
        return client.put(url, data=json.dumps(data or {}), content_type='application/json')

    def _delete_json(self, client, url, data=None):
        kwargs = {}
        if data is not None:
            kwargs['data'] = json.dumps(data)
            kwargs['content_type'] = 'application/json'
        return client.delete(url, **kwargs)

    def _invoice(self, **overrides):
        return make_invoice(self.user, **overrides)


# ══════════════════════════════════════════════════════════════════
# INV-003 / DB-002 — concurrent payment recording must never overpay
# ══════════════════════════════════════════════════════════════════

class ConcurrentOverpaymentRaceTests(ConcurrencyTestCase):
    def _fire_concurrent_payments(self, invoice, amount, count):
        """
        Fires `count` genuinely concurrent POST /payments/ requests, each
        for `amount`, against the same invoice, each on its own thread
        (own DB connection, own django.test.Client). Returns the list of
        (status_code, response_json) results in whatever order they
        actually completed.
        """
        url = reverse('invoices:invoice_add_payment', kwargs={'pk': invoice.pk})

        def _one_request():
            client = self._authed_client()
            resp = self._post_json(client, url, {
                'amount': str(amount), 'currency': 'USD', 'source': 'bank',
                'payment_date': str(date.today()),
            })
            return resp.status_code, resp.json()

        with ThreadPoolExecutor(max_workers=count) as pool:
            futures = [pool.submit(_one_request) for _ in range(count)]
            return [f.result() for f in futures]

    def test_audit_exact_scenario_more_concurrent_attempts_than_originally_reproduced(self):
        """
        The audit's own live reproduction: 3 concurrent $700 requests
        against a real $1000 invoice ALL succeeded, producing
        amount_paid=$2100 on invoice c6559f99-48b1-45e8-a562-76ab950f6500
        / INV-2026-0031 (left in the database as historical evidence —
        see the audit report and DECISIONS.md). Run here with 6 concurrent
        attempts (double the original) for stronger confidence than just
        clearing the original 3-request bar.

        Only the FIRST to actually commit can ever be valid ($700 <=
        $1000 outstanding); every other concurrent attempt must see a
        real, current $300 outstanding once it's finally unblocked by the
        lock, and be rejected. Exactly one success, never more.
        """
        for trial in range(3):
            with self.subTest(trial=trial):
                invoice = self._invoice(
                    status='sent', sent_at=timezone.now(), total=Decimal('1000.00'), amount_paid=Decimal('0'),
                )
                results = self._fire_concurrent_payments(invoice, Decimal('700.00'), count=6)

                successes = [r for r in results if r[0] == 201]
                failures = [r for r in results if r[0] == 400]
                self.assertEqual(len(successes), 1, f'expected exactly 1 success, got {len(successes)}: {results}')
                self.assertEqual(len(failures), 5)
                for _, body in failures:
                    # A real, specific error citing the actual remaining
                    # balance — not a generic rejection — confirming the
                    # loser saw genuinely fresh (locked, re-fetched) data,
                    # not a second write of the same stale pre-lock amount.
                    self.assertIn('300', str(body))

                invoice.refresh_from_db()
                self.assertEqual(invoice.amount_paid, Decimal('700.00'))
                self.assertLessEqual(invoice.amount_paid, invoice.total)
                self.assertEqual(InvoicePartialPayment.objects.filter(invoice=invoice).count(), 1)

    def test_multiple_legitimate_concurrent_payments_all_serialize_correctly(self):
        """
        A stronger test than "only one request can ever win": 5 concurrent
        $300 requests against a $1000 invoice, where exactly 3 CAN
        legitimately fit ($900 total) and the other 2 cannot. This proves
        the lock correctly serializes multiple successful writes in turn
        (each seeing the previous one's committed effect), not just that
        it happens to block everything after the first.
        """
        invoice = self._invoice(status='sent', sent_at=timezone.now(), total=Decimal('1000.00'), amount_paid=Decimal('0'))
        results = self._fire_concurrent_payments(invoice, Decimal('300.00'), count=5)

        successes = [r for r in results if r[0] == 201]
        failures = [r for r in results if r[0] == 400]
        self.assertEqual(len(successes), 3, f'expected exactly 3 of 5 to fit, got {len(successes)}: {results}')
        self.assertEqual(len(failures), 2)

        invoice.refresh_from_db()
        self.assertEqual(invoice.amount_paid, Decimal('900.00'))
        self.assertLessEqual(invoice.amount_paid, invoice.total)
        self.assertEqual(InvoicePartialPayment.objects.filter(invoice=invoice).count(), 3)

    def test_concurrent_mark_paid_calls_never_double_pay(self):
        """
        invoice_mark_paid pre-fills exactly the outstanding balance, so a
        second concurrent call — once correctly unblocked by the lock and
        re-reading real, post-first-call data — must see outstanding=0
        and be rejected, never create a second payment.
        """
        invoice = self._invoice(status='sent', sent_at=timezone.now(), total=Decimal('500.00'), amount_paid=Decimal('0'))
        url = reverse('invoices:invoice_mark_paid', kwargs={'pk': invoice.pk})

        def _one_request():
            client = self._authed_client()
            return self._post_json(client, url, {'source': 'bank'}).status_code

        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(lambda _: _one_request(), range(4)))

        self.assertEqual(results.count(200), 1)
        self.assertEqual(results.count(400), 3)
        invoice.refresh_from_db()
        self.assertEqual(invoice.amount_paid, Decimal('500.00'))
        self.assertEqual(InvoicePartialPayment.objects.filter(invoice=invoice).count(), 1)


# ══════════════════════════════════════════════════════════════════
# INV-004 — concurrent finalise must never crash and never collide
# ══════════════════════════════════════════════════════════════════

class ConcurrentInvoiceNumberingTests(ConcurrencyTestCase):
    @patch('apps.invoices.tasks.render_and_store_invoice_pdf.delay')
    def test_audit_exact_scenario_more_concurrent_drafts_than_originally_reproduced(self, mock_pdf_delay):
        """
        The audit's own live reproduction: several of the same user's
        fresh drafts finalised concurrently produced a raw, unhandled
        Django debug-mode 500 (IntegrityError: duplicate key value
        violates unique constraint... Key (user_id, invoice_number)=
        (..., INV-2026-0029) already exists.) for roughly half the
        requests. Run here with 8 concurrent drafts (well above the
        original 4-5) for stronger confidence.
        """
        for trial in range(2):
            with self.subTest(trial=trial):
                invoices = []
                for i in range(8):
                    invoice = self._invoice(status='draft', invoice_number=None, total=Decimal('10.00'))
                    InvoiceItem.objects.create(
                        invoice=invoice, description=f'Race item {trial}-{i}', quantity=Decimal('1'), unit_price=Decimal('10.00'),
                    )
                    invoices.append(invoice)

                def _finalise(invoice):
                    client = self._authed_client()
                    url = reverse('invoices:invoice_finalise', kwargs={'pk': invoice.pk})
                    resp = self._post_json(client, url)
                    return resp.status_code, resp

                with ThreadPoolExecutor(max_workers=8) as pool:
                    results = list(pool.map(_finalise, invoices))

                statuses = [r[0] for r in results]
                # The whole point of the fix: never a raw 500 reaching the client.
                self.assertNotIn(500, statuses, f'a concurrent finalise crashed with a 500: {results}')
                self.assertTrue(all(s == 200 for s in statuses), f'expected every finalise to succeed: {statuses}')

                numbers = []
                for invoice in invoices:
                    invoice.refresh_from_db()
                    self.assertEqual(invoice.status, 'created')
                    self.assertIsNotNone(invoice.invoice_number)
                    self.assertTrue(invoice.invoice_number.startswith('INV-'))
                    numbers.append(invoice.invoice_number)

                self.assertEqual(len(numbers), len(set(numbers)), f'duplicate invoice numbers assigned: {numbers}')


# ══════════════════════════════════════════════════════════════════
# INV-009 / FE-001 — Undo Payment must be rejected on every terminal status
# ══════════════════════════════════════════════════════════════════

class UndoPaymentTerminalStatusGuardTests(ConcurrencyTestCase):
    """
    Not concurrency-shaped — a missing status guard, reproduced with an
    ordinary sequential request, exactly like the audit's own live
    reproduction. Covers all three terminal statuses the audit named
    (cancelled/bad_debt explicitly flagged as "same code path, not
    separately live-verified" in the original audit — closed here for
    real, not left as an inference from the refunded case alone).
    """

    def test_audit_exact_refunded_scenario_is_now_rejected_and_leaves_state_untouched(self):
        """
        Reconstructs the audit's exact live-reproduced corruption on a
        FRESH fixture (the original corrupted row,
        76472345-cdb5-4800-a2f0-6cc8ba1547e8 / INV-2026-0025, stays
        untouched in the database as historical evidence — this is a new,
        separate invoice built to the same shape: paid in full, then
        partially refunded).
        """
        invoice = self._invoice(status='paid', total=Decimal('900.00'), amount_paid=Decimal('900.00'))
        InvoicePartialPayment.objects.create(invoice=invoice, amount=Decimal('900.00'), payment_date=date.today())
        invoice.status = 'refunded'
        invoice.refunded_amount = Decimal('300.00')
        invoice.save(update_fields=['status', 'refunded_amount'])

        client = self._authed_client()
        url = reverse('invoices:invoice_undo_payment', kwargs={'pk': invoice.pk})
        resp = self._delete_json(client, url)

        self.assertEqual(resp.status_code, 400)
        self.assertIn('refunded', resp.json().get('error', '').lower())

        invoice.refresh_from_db()
        self.assertEqual(invoice.status, 'refunded')
        self.assertEqual(invoice.amount_paid, Decimal('900.00'), 'amount_paid must be completely untouched by the rejected request')
        self.assertEqual(invoice.refunded_amount, Decimal('300.00'))
        self.assertEqual(InvoicePartialPayment.objects.filter(invoice=invoice).count(), 1)

    def test_undo_rejected_on_cancelled_invoice(self):
        invoice = self._invoice(status='partially_paid', total=Decimal('100.00'), amount_paid=Decimal('40.00'))
        InvoicePartialPayment.objects.create(invoice=invoice, amount=Decimal('40.00'), payment_date=date.today())
        invoice.status = 'cancelled'
        invoice.save(update_fields=['status'])

        client = self._authed_client()
        resp = self._delete_json(client, reverse('invoices:invoice_undo_payment', kwargs={'pk': invoice.pk}))

        self.assertEqual(resp.status_code, 400)
        self.assertIn('cancelled', resp.json().get('error', '').lower())
        invoice.refresh_from_db()
        self.assertEqual(invoice.amount_paid, Decimal('40.00'))
        self.assertEqual(InvoicePartialPayment.objects.filter(invoice=invoice).count(), 1)

    def test_undo_rejected_on_bad_debt_invoice(self):
        invoice = self._invoice(status='partially_paid', total=Decimal('100.00'), amount_paid=Decimal('40.00'))
        InvoicePartialPayment.objects.create(invoice=invoice, amount=Decimal('40.00'), payment_date=date.today())
        invoice.status = 'bad_debt'
        invoice.save(update_fields=['status'])

        client = self._authed_client()
        resp = self._delete_json(client, reverse('invoices:invoice_undo_payment', kwargs={'pk': invoice.pk}))

        self.assertEqual(resp.status_code, 400)
        self.assertIn('bad_debt', resp.json().get('error', '').lower())
        invoice.refresh_from_db()
        self.assertEqual(invoice.amount_paid, Decimal('40.00'))
        self.assertEqual(InvoicePartialPayment.objects.filter(invoice=invoice).count(), 1)

    def test_undo_still_works_normally_on_a_non_terminal_status(self):
        """Regression guard: the new status check must not block the legitimate case."""
        invoice = self._invoice(status='created', total=Decimal('100.00'))
        InvoicePartialPayment.objects.create(invoice=invoice, amount=Decimal('40.00'), payment_date=date.today())
        invoice.update_paid_status()

        client = self._authed_client()
        resp = self._delete_json(client, reverse('invoices:invoice_undo_payment', kwargs={'pk': invoice.pk}))
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(InvoicePartialPayment.objects.filter(invoice=invoice).count(), 0)


# ══════════════════════════════════════════════════════════════════
# INV-001 — view-layer regression for the stale-total fix (the model-
# layer regression tests live in test_models.py's RecalculateTotalsTests)
# ══════════════════════════════════════════════════════════════════

class ClearAllItemsViaApiZeroesTotalsTests(ConcurrencyTestCase):
    def test_put_with_empty_items_zeroes_subtotal_and_total_via_the_real_api(self):
        """
        The exact live-reproduced path: a real draft invoice with 2 items
        ($900 subtotal, $945 total with 5% tax), PUT via the real API with
        items: [] — the audit found subtotal/total still read $900/$945
        afterward despite 0 items. Must now read 0.00/0.00.
        """
        invoice = self._invoice(status='draft', invoice_number=None, tax_rate=Decimal('5.00'), discount_amount=Decimal('0'))
        InvoiceItem.objects.create(invoice=invoice, description='Homepage', quantity=Decimal('10'), unit_price=Decimal('50.00'), sort_order=1)
        InvoiceItem.objects.create(invoice=invoice, description='Checkout', quantity=Decimal('5'), unit_price=Decimal('80.00'), sort_order=2)
        invoice.recalculate_totals()
        invoice.save()
        self.assertEqual(invoice.subtotal, Decimal('900.00'))
        self.assertEqual(invoice.total, Decimal('945.00'))

        client = self._authed_client()
        url = reverse('invoices:invoice_detail', kwargs={'pk': invoice.pk})
        resp = self._put_json(client, url, {'items': []})

        self.assertEqual(resp.status_code, 200, resp.content)
        body = resp.json()
        self.assertEqual(body['items'], [])
        self.assertEqual(Decimal(body['subtotal']), Decimal('0.00'))
        self.assertEqual(Decimal(body['tax_amount']), Decimal('0.00'))
        self.assertEqual(Decimal(body['total']), Decimal('0.00'))

        invoice.refresh_from_db()
        self.assertEqual(invoice.subtotal, Decimal('0.00'))
        self.assertEqual(invoice.total, Decimal('0.00'))
