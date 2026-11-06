# apps/invoices/kpis.py
"""
The invoice money KPIs — Outstanding, Overdue, Collected and the month-over-month
Collected delta — as pure functions of (user, window, target currency, snapshot).

Why this module exists: these rules used to live inline in `invoice_summary` (and
two private helpers in views.py). The Dashboard needs the very same numbers, and a
second copy of an invoice rule is how two screens end up disagreeing about what
"outstanding" means. `invoice_summary` and `apps.dashboard` both call these; nothing
here knows about requests, DRF or Response.

Conventions (unchanged from the code they were moved from): money is converted with
the invoice's FROZEN `rate_to_usd_at_issue` into USD and today's snapshot out of USD
(core.money); an amount that cannot honestly be converted is counted in
`unconverted_count`, never guessed and never silently dropped.
"""
from datetime import timedelta
from decimal import Decimal

from dateutil.relativedelta import relativedelta

from core.money import unify_amounts_to_currency

from .models import Invoice, InvoicePartialPayment

# Invoices delivered to a client and not yet fully resolved — the shared
# eligibility set for "Outstanding"/"Past-Due" KPIs.
# Deliberately excludes draft/created (never delivered) as well as every
# terminal status.
ACTIVE_STATUSES = ('sent', 'viewed', 'partially_paid')


def kpi_period_window(period, today):
    """
    (start, end) inclusive-inclusive date bounds for invoice_summary's KPI
    period selector, or (None, None) for 'all_time' (no window at all).
    Outstanding/Overdue scope to issue_date within this window; Collected
    scopes to payment_date within it instead — same window shape, two
    different date fields, per DECISIONS.md's issue-date-vs-payment-date
    definition for this feature.
    """
    if period == 'this_month':
        return today.replace(day=1), today
    if period == 'last_6_months':
        return today - relativedelta(months=6), today
    if period == 'this_year':
        return today.replace(month=1, day=1), today
    return None, None  # all_time


def outstanding_invoices(user, start=None, end=None):
    """
    The user's ACTIVE_STATUSES invoices (draft/created and every terminal
    status can never be in that set), optionally restricted to those ISSUED in
    [start, end].

    The window is the trap the Dashboard exists to avoid: the Invoices page's
    default `period=this_month` scopes Outstanding to invoices issued this month,
    which is a different question from "what is owed to me today". The Dashboard
    passes no window; the Invoices page keeps passing its own.
    """
    qs = Invoice.objects.filter(user=user, status__in=ACTIVE_STATUSES)
    if start is not None:
        qs = qs.filter(issue_date__gte=start, issue_date__lte=end)
    return qs


def overdue_narrowing(outstanding_qs, today):
    """
    `outstanding_qs` narrowed to invoices whose due date is strictly before `today`
    (due today is NOT overdue) — equivalent to Invoice.days_overdue > 0 for this
    status set, since none of ACTIVE_STATUSES overlaps NON_OVERDUE_STATUSES.
    """
    return outstanding_qs.filter(due_date__lt=today)


def sum_outstanding_amount(invoices, target_currency, snapshot):
    """
    Sum of each invoice's REMAINING balance (outstanding_amount = total - amount_paid,
    never the original total) converted into `target_currency`.
    Returns (total quantized to cents, unconverted_count).
    """
    return unify_amounts_to_currency(
        ((inv.outstanding_amount, inv.currency, inv.rate_to_usd_at_issue) for inv in invoices),
        target_currency, snapshot,
    )


def collected_amount(user, start, end, target_currency, snapshot):
    """
    Real payment-date-scoped 'money that actually arrived' — sums
    InvoicePartialPayment rows (never Invoice.amount_paid, a cumulative
    field with no per-payment date) whose payment_date falls in [start,
    end]. Every real payment-recording call site (add-payment, mark-paid,
    claim-confirm) creates one of these rows, so this is a real,
    complete ledger, not an approximation. Returns (total, count,
    unconverted_count) — count is the number of DISTINCT invoices with a
    qualifying payment in-window, matching the KPI card's existing
    "N invoices" sub-label wording.

    Deliberately does NOT net out refunds here — a refund has no
    per-transaction date in this data model (Invoice.refunded_amount is
    cumulative, not a dated ledger row), so there is no window to scope a
    refund into. This is a real, flagged gap (see DECISIONS.md): a
    period-scoped Collected figure can overstate money actually kept if
    a refund landed in the same window. All Time avoids this entirely by
    using the older, exact amount_paid-minus-refunded_amount calculation
    instead of this helper — see all_time_collected_amount.
    """
    qs = InvoicePartialPayment.objects.filter(invoice__user=user)
    if start is not None:
        qs = qs.filter(payment_date__gte=start, payment_date__lte=end)
    total, unconverted = unify_amounts_to_currency(
        ((p.amount, p.currency, p.rate_to_usd) for p in qs), target_currency, snapshot,
    )
    count = qs.values('invoice_id').distinct().count()
    return total, count, unconverted


def all_time_collected_amount(user, target_currency, snapshot):
    """
    The exact pre-existing "Collected, all time" calculation, unchanged —
    amount_paid is a cumulative field, so all-time is the one case where it is
    still the right source (and the only case with a real refund netting, since
    refunded_amount is itself a cumulative, undated field with no period to scope
    it into). Sums across every invoice except draft/created: cancelled and
    bad_debt invoices' amount_paid still counts — money already received is not
    erased by a later status change. Returns (total, count, unconverted_count).
    """
    paid_qs = Invoice.objects.filter(user=user).exclude(status__in=('draft', 'created')).filter(amount_paid__gt=0)
    total, unconverted = unify_amounts_to_currency(
        ((inv.amount_paid - inv.refunded_amount, inv.currency, inv.rate_to_usd_at_issue) for inv in paid_qs),
        target_currency, snapshot,
    )
    return total, paid_qs.count(), unconverted


def month_over_month_collected(user, today, target_currency, snapshot):
    """
    This calendar month's Collected vs last calendar month's, via collected_amount —
    independent of whatever KPI period was requested. Returns
    (current_total, previous_total, pct_change); pct_change is None when the
    previous month collected nothing (a percentage of zero is meaningless).
    """
    this_month_start = today.replace(day=1)
    last_month_end = this_month_start - timedelta(days=1)
    last_month_start = last_month_end.replace(day=1)
    current_total, _current_count, _current_unconverted = collected_amount(
        user, this_month_start, today, target_currency, snapshot,
    )
    previous_total, _previous_count, _previous_unconverted = collected_amount(
        user, last_month_start, last_month_end, target_currency, snapshot,
    )
    pct_change = None
    if previous_total > 0:
        pct_change = float((current_total - previous_total) / previous_total * 100)
    return current_total, previous_total, pct_change
