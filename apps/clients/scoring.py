# apps/clients/scoring.py
"""
Pure reliability-scoring logic — deliberately independent of the Invoice
model, which doesn't exist yet (apps/clients is being built ahead of
apps/invoices per INVOICES_CLIENTS_TECHNICAL_SPEC.md's build order).

compute_reliability_stats() takes any iterable of objects exposing
.status / .total / .amount_paid / .paid_date / .due_date — real Invoice
instances once that model exists, or any lightweight stand-in today — so
the formula itself is written and thoroughly tested now, and
Client.payment_stats can start calling it with real invoices the moment
Invoice.client (with the related_name this module expects — see
Client._invoices_for_scoring) lands, with no change needed here.

Formula, replacing v1's original bands (see DECISIONS.md for the record
of this change):
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

PAID_ON_TIME_POINTS = 5
LATE_1_TO_30_POINTS = -3
LATE_31_PLUS_POINTS = -10
BAD_DEBT_POINTS = -20

# Excluded entirely — never enter the denominator or numerator.
EXCLUDED_STATUSES = {'cancelled', 'refunded'}


def compute_reliability_stats(invoices):
    """
    Returns:
      total_invoiced / total_paid / invoice_count — summed over every
        non-excluded invoice (cancelled/refunded invoices don't count
        toward these totals either, since they were never a real
        completed transaction).
      reliability_score — normalized average points per qualifying
        invoice (paid or bad_debt outcomes only), or None when there are
        no qualifying invoices at all — deliberately not 0, since "no
        completed invoices yet" and "a perfectly middling score" are not
        the same thing and shouldn't look identical to a caller.
      reliability_breakdown — counts per band, plus qualifying_invoices.
    """
    scoring_invoices = [inv for inv in invoices if inv.status not in EXCLUDED_STATUSES]

    total_invoiced = sum((inv.total for inv in scoring_invoices), Decimal('0'))
    total_paid = sum((inv.amount_paid for inv in scoring_invoices), Decimal('0'))

    breakdown = {'paid_on_time': 0, 'late_1_to_30_days': 0, 'late_31_plus_days': 0, 'bad_debt': 0}
    points_total = 0
    qualifying = 0

    for invoice in scoring_invoices:
        if invoice.status == 'bad_debt':
            breakdown['bad_debt'] += 1
            points_total += BAD_DEBT_POINTS
            qualifying += 1
        elif invoice.status == 'paid':
            qualifying += 1
            days_late = _days_late(invoice)
            if days_late <= 0:
                breakdown['paid_on_time'] += 1
                points_total += PAID_ON_TIME_POINTS
            elif days_late <= 30:
                breakdown['late_1_to_30_days'] += 1
                points_total += LATE_1_TO_30_POINTS
            else:
                breakdown['late_31_plus_days'] += 1
                points_total += LATE_31_PLUS_POINTS
        # Every other status (draft/created/sent/viewed/partially_paid) has
        # no completed outcome yet, so it doesn't count toward reliability
        # at all — not scored zero, simply excluded from the average.

    reliability_score = (points_total / qualifying) if qualifying else None

    return {
        'total_invoiced': total_invoiced,
        'total_paid': total_paid,
        'invoice_count': len(scoring_invoices),
        'reliability_score': reliability_score,
        'reliability_breakdown': {**breakdown, 'qualifying_invoices': qualifying},
    }


def _days_late(invoice):
    if not invoice.paid_date or not invoice.due_date:
        return 0
    return (invoice.paid_date - invoice.due_date).days
