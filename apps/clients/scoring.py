# apps/clients/scoring.py
"""
Pure per-client money + reliability logic — deliberately free of any
database access and of any import from apps.invoices (CLAUDE.md: apps.clients
never imports apps.invoices; enforced by an AST test in test_portal.py).

compute_reliability_stats() takes any iterable of objects exposing
.status / .total / .amount_paid / .currency / .rate_to_usd_at_issue /
.paid_date / .due_date — real Invoice instances in production, lightweight
stand-ins in unit tests. Client.compute_payment_stats() is its one real
caller, so the client list, the analytics endpoint, the detail panel and
tag attach/detach responses all show identical numbers by construction.

Money figures (all denominated in the client's own currency, converted via
core.money — frozen rate into USD, current snapshot out of it):
  invoiced        sum of total over invoices not in INVOICED_EXCLUDED_STATUSES
                  (drafts were never invoiced; cancelled/refunded never
                  completed)
  paid            sum of amount_paid over the same set
  outstanding     sum of outstanding_amount over OUTSTANDING_STATUSES
  overdue_amount  the part of outstanding whose due_date < today
Counts (invoice_count, overdue_count) count real invoices regardless of
convertibility; an invoice that cannot be converted contributes to NO money
figure and is reported in unconverted_count instead — never guessed, never
silently dropped.

Formula for reliability, replacing v1's original bands (see DECISIONS.md for
the record of this change):
  - paid on or before its due date:  +5
  - paid 1-30 days late:             -3
  - paid 31+ days late:              -10
  - bad_debt outcome:                -20
  - cancelled/refunded invoices:     excluded entirely from scoring —
                                      not scored zero, not counted at all
  - reliability_score is the NORMALIZED AVERAGE of points across
    qualifying invoices (paid or bad_debt outcomes only), not a raw sum —
    so a client with one bad invoice out of fifty isn't scored the same
    as a client with one bad invoice out of one.
"""
from decimal import Decimal

from django.utils import timezone

from core.money import CENT, convert_amount, needs_snapshot

PAID_ON_TIME_POINTS = 5
LATE_1_TO_30_POINTS = -3
LATE_31_PLUS_POINTS = -10
BAD_DEBT_POINTS = -20

# Excluded entirely from reliability scoring — never enter the denominator
# or numerator. apps.invoices.views imports this name directly.
EXCLUDED_STATUSES = {'cancelled', 'refunded'}

# The three constants below MIRROR apps.invoices' status sets, because this
# app cannot import them (dependency direction). They are guarded by
# apps/invoices/tests/test_client_status_drift.py, which fails loudly if
# Invoice.STATUS_CHOICES, ACTIVE_STATUSES or NON_OVERDUE_STATUSES ever
# change without these following.
#
# Not counted as "invoiced": a draft was never invoiced; cancelled/refunded
# never completed.
INVOICED_EXCLUDED_STATUSES = frozenset(EXCLUDED_STATUSES | {'draft'})
# Delivered and unresolved — equals apps.invoices.views.ACTIVE_STATUSES (the
# Invoices KPI strip's Outstanding set) AND the complement of
# apps.invoices.models.NON_OVERDUE_STATUSES, so "overdue" below is exactly
# invoice_list's ?overdue=true.
OUTSTANDING_STATUSES = frozenset({'sent', 'viewed', 'partially_paid'})

# Sentinel meaning "no snapshot supplied, fetch one only if a conversion
# actually needs it" — distinct from None, which means "no snapshot exists".
LAZY = object()


def compute_reliability_stats(invoices, currency='USD', snapshot=None, today=None):
    """
    `snapshot` is an ExchangeRateSnapshot-like object, None (no snapshot
    exists — conversions that need one are reported as unconverted), or a
    zero-argument callable resolved at most once and only if some invoice
    actually needs a snapshot (Client.compute_payment_stats passes one so a
    single-currency client never pays for a snapshot query).

    Returns total_invoiced / total_paid / outstanding / overdue_amount as
    2dp Decimals in `currency`, invoice_count / overdue_count /
    unconverted_count, `currency`, and reliability_score (normalized
    average over paid/bad_debt outcomes, or None when there are none —
    deliberately not 0) plus reliability_breakdown.
    """
    today = today or timezone.now().date()
    resolved = []

    def get_snapshot():
        if not resolved:
            resolved.append(snapshot() if callable(snapshot) else snapshot)
        return resolved[0]

    counted = [inv for inv in invoices if inv.status not in INVOICED_EXCLUDED_STATUSES]

    invoiced = paid = outstanding = overdue_amount = Decimal('0')
    overdue_count = unconverted_count = 0

    breakdown = {'paid_on_time': 0, 'late_1_to_30_days': 0, 'late_31_plus_days': 0, 'bad_debt': 0}
    points_total = 0
    qualifying = 0

    for inv in counted:
        is_overdue = (
            inv.status in OUTSTANDING_STATUSES and inv.due_date is not None and inv.due_date < today
        )
        if is_overdue:
            overdue_count += 1

        snap = get_snapshot() if needs_snapshot(inv.currency, currency) else None
        total = convert_amount(inv.total, inv.currency, inv.rate_to_usd_at_issue, currency, snap)
        if total is None:
            unconverted_count += 1
        else:
            # Conversion is linear, so each figure converts independently.
            invoiced += total
            paid += convert_amount(inv.amount_paid, inv.currency, inv.rate_to_usd_at_issue, currency, snap)
            if inv.status in OUTSTANDING_STATUSES:
                owed = convert_amount(max(Decimal('0'), inv.total - inv.amount_paid), inv.currency, inv.rate_to_usd_at_issue, currency, snap)
                outstanding += owed
                if is_overdue:
                    overdue_amount += owed

        if inv.status == 'bad_debt':
            breakdown['bad_debt'] += 1
            points_total += BAD_DEBT_POINTS
            qualifying += 1
        elif inv.status == 'paid':
            qualifying += 1
            days_late = _days_late(inv)
            if days_late <= 0:
                breakdown['paid_on_time'] += 1
                points_total += PAID_ON_TIME_POINTS
            elif days_late <= 30:
                breakdown['late_1_to_30_days'] += 1
                points_total += LATE_1_TO_30_POINTS
            else:
                breakdown['late_31_plus_days'] += 1
                points_total += LATE_31_PLUS_POINTS
        # Every other status (created/sent/viewed/partially_paid) has no
        # completed outcome yet, so it doesn't count toward reliability at
        # all — not scored zero, simply excluded from the average.

    reliability_score = (points_total / qualifying) if qualifying else None

    return {
        'currency': currency,
        'total_invoiced': invoiced.quantize(CENT),
        'total_paid': paid.quantize(CENT),
        'invoice_count': len(counted),
        'outstanding': outstanding.quantize(CENT),
        'overdue_amount': overdue_amount.quantize(CENT),
        'overdue_count': overdue_count,
        'unconverted_count': unconverted_count,
        'reliability_score': reliability_score,
        'reliability_breakdown': {**breakdown, 'qualifying_invoices': qualifying},
    }


def _days_late(invoice):
    if not invoice.paid_date or not invoice.due_date:
        return 0
    return (invoice.paid_date - invoice.due_date).days
