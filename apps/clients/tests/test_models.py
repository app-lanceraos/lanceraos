# apps/clients/tests/test_models.py
"""
apps.invoices doesn't exist yet, so the reliability-score formula in
apps.clients.scoring is written to operate on any object exposing
.status/.total/.amount_paid/.paid_date/.due_date, and is tested here
directly against lightweight SimpleNamespace stand-ins rather than
against a real Invoice model — see DECISIONS.md for the reasoning
behind choosing this over a test-only fake Django model or deferring
these tests until Invoice exists.
"""
from datetime import date, timedelta
from decimal import Decimal
from types import SimpleNamespace

from django.test import SimpleTestCase, TestCase

from apps.clients.models import Client, ClientNote, ClientTag
from apps.clients.scoring import compute_reliability_stats
from apps.users.models import User

DUE = date(2026, 1, 31)


def make_invoice(status, total='100', amount_paid=None, due_date=DUE, paid_date=None):
    total = Decimal(total)
    if amount_paid is None:
        amount_paid = total if status == 'paid' else Decimal('0')
    else:
        amount_paid = Decimal(amount_paid)
    return SimpleNamespace(status=status, total=total, amount_paid=amount_paid, due_date=due_date, paid_date=paid_date)


class ScoringFormulaTests(SimpleTestCase):
    def test_empty_invoice_list_gives_none_score_not_zero(self):
        """
        No qualifying invoices at all must report reliability_score=None,
        not 0 — "no completed invoices yet" and "a perfectly middling
        score" are genuinely different things.
        """
        stats = compute_reliability_stats([])
        self.assertIsNone(stats['reliability_score'])
        self.assertEqual(stats['reliability_breakdown']['qualifying_invoices'], 0)
        self.assertEqual(stats['total_invoiced'], Decimal('0'))

    def test_paid_on_or_before_due_date_scores_plus_five(self):
        invoice = make_invoice('paid', paid_date=DUE)
        stats = compute_reliability_stats([invoice])
        self.assertEqual(stats['reliability_score'], 5)
        self.assertEqual(stats['reliability_breakdown']['paid_on_time'], 1)

    def test_paid_one_to_thirty_days_late_scores_minus_three(self):
        invoice = make_invoice('paid', paid_date=DUE + timedelta(days=15))
        stats = compute_reliability_stats([invoice])
        self.assertEqual(stats['reliability_score'], -3)
        self.assertEqual(stats['reliability_breakdown']['late_1_to_30_days'], 1)

    def test_paid_exactly_thirty_days_late_is_still_the_minus_three_band(self):
        invoice = make_invoice('paid', paid_date=DUE + timedelta(days=30))
        stats = compute_reliability_stats([invoice])
        self.assertEqual(stats['reliability_score'], -3)

    def test_paid_thirty_one_plus_days_late_scores_minus_ten(self):
        invoice = make_invoice('paid', paid_date=DUE + timedelta(days=31))
        stats = compute_reliability_stats([invoice])
        self.assertEqual(stats['reliability_score'], -10)
        self.assertEqual(stats['reliability_breakdown']['late_31_plus_days'], 1)

    def test_bad_debt_scores_minus_twenty(self):
        invoice = make_invoice('bad_debt', amount_paid='0')
        stats = compute_reliability_stats([invoice])
        self.assertEqual(stats['reliability_score'], -20)
        self.assertEqual(stats['reliability_breakdown']['bad_debt'], 1)

    def test_cancelled_and_refunded_are_excluded_entirely_not_zero_scored(self):
        """
        A client with one on-time payment and five huge cancelled/refunded
        invoices must score based on the ONE real qualifying invoice only
        — cancelled/refunded invoices must not dilute the average, appear
        in totals, or appear in qualifying_invoices at all.
        """
        invoices = [make_invoice('paid', paid_date=DUE)] + [
            make_invoice('cancelled', total='9999') for _ in range(3)
        ] + [make_invoice('refunded', total='9999') for _ in range(2)]

        stats = compute_reliability_stats(invoices)

        self.assertEqual(stats['reliability_score'], 5)
        self.assertEqual(stats['reliability_breakdown']['qualifying_invoices'], 1)
        self.assertEqual(stats['invoice_count'], 1)
        self.assertEqual(stats['total_invoiced'], Decimal('100'))

    def test_score_is_normalized_average_not_raw_sum(self):
        """
        9 on-time paid invoices (+5 each = 45) + 1 bad_debt (-20) sums to
        25 across 10 qualifying invoices. A raw-sum implementation would
        report 25; the normalized average must report 2.5.
        """
        invoices = [make_invoice('paid', paid_date=DUE) for _ in range(9)]
        invoices.append(make_invoice('bad_debt', amount_paid='0'))

        stats = compute_reliability_stats(invoices)

        self.assertEqual(stats['reliability_breakdown']['qualifying_invoices'], 10)
        self.assertNotEqual(stats['reliability_score'], 25)  # the raw sum
        self.assertEqual(stats['reliability_score'], Decimal('2.5'))

    def test_non_terminal_statuses_do_not_count_toward_reliability(self):
        """
        draft/created/sent/viewed/partially_paid have no completed
        outcome yet — they contribute to totals (they're not excluded the
        way cancelled/refunded are) but must not be qualifying invoices.
        """
        invoices = [
            make_invoice('sent', amount_paid='0'),
            make_invoice('partially_paid', amount_paid='40'),
            make_invoice('paid', paid_date=DUE),
        ]
        stats = compute_reliability_stats(invoices)
        self.assertEqual(stats['reliability_breakdown']['qualifying_invoices'], 1)
        self.assertEqual(stats['reliability_score'], 5)
        self.assertEqual(stats['invoice_count'], 3)


class ClientModelTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(email='freelancer@example.com', password='Sup3r$ecret1')

    def test_portal_token_auto_generated_on_first_save(self):
        client = Client.objects.create(user=self.user, name='Acme Co', email='acme@example.com')
        self.assertTrue(client.portal_token)
        self.assertGreaterEqual(len(client.portal_token), 16)

    def test_portal_token_is_unique_across_clients(self):
        client1 = Client.objects.create(user=self.user, name='Acme Co', email='acme@example.com')
        client2 = Client.objects.create(user=self.user, name='Beta Co', email='beta@example.com')
        self.assertNotEqual(client1.portal_token, client2.portal_token)

    def test_explicit_portal_token_is_not_overwritten(self):
        client = Client(user=self.user, name='Acme Co', email='acme@example.com', portal_token='my-fixed-token-123')
        client.save()
        self.assertEqual(client.portal_token, 'my-fixed-token-123')

    def test_payment_stats_is_safe_before_apps_invoices_exists(self):
        """
        No Invoice model / reverse relation exists yet, so payment_stats
        must degrade to the empty-list shape rather than raising
        AttributeError — this is what actually makes client_analytics
        callable today.
        """
        client = Client.objects.create(user=self.user, name='Acme Co', email='acme@example.com')
        stats = client.payment_stats
        self.assertIsNone(stats['reliability_score'])
        self.assertEqual(stats['invoice_count'], 0)

    def test_client_str(self):
        client = Client.objects.create(user=self.user, name='Acme Co', email='acme@example.com')
        self.assertEqual(str(client), 'Acme Co (acme@example.com)')

    def test_client_note_str(self):
        client = Client.objects.create(user=self.user, name='Acme Co', email='acme@example.com')
        note = ClientNote.objects.create(client=client, author=self.user, content='Called about the invoice.')
        self.assertIn('Acme Co', str(note))

    def test_client_tag_str(self):
        tag = ClientTag.objects.create(user=self.user, name='VIP', color='#3B82F6')
        self.assertEqual(str(tag), 'VIP')


class ClientTagUniquenessTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(email='freelancer2@example.com', password='Sup3r$ecret1')

    def test_duplicate_tag_name_for_same_user_violates_db_constraint(self):
        """
        The serializer already rejects this at the API layer (see
        test_serializers.py), but the DB-level unique_together must be
        real too, not just a serializer-level courtesy check.
        """
        from django.db import IntegrityError, transaction

        ClientTag.objects.create(user=self.user, name='VIP', color='#3B82F6')
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                ClientTag.objects.create(user=self.user, name='VIP', color='#FF0000')

    def test_same_tag_name_allowed_for_different_users(self):
        other_user = User.objects.create_user(email='other@example.com', password='Sup3r$ecret1')
        ClientTag.objects.create(user=self.user, name='VIP', color='#3B82F6')
        # Should not raise — uniqueness is scoped per-user, not global.
        ClientTag.objects.create(user=other_user, name='VIP', color='#FF0000')
