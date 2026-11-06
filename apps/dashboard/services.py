# apps/dashboard/services.py
"""
Everything the Dashboard shows, one function per section.

Dependency direction (STANDARDS.md): this app sits at the TOP of the tree. It may
import models and shared helpers (apps.invoices.kpis, core.*) from any other app;
no other app may import apps.dashboard, and it never imports another app's views
modules. A test (test_import_direction.py) enforces both rules.

Why no second copy of any rule: the money figures come from apps.invoices.kpis, the
same functions `invoice_summary` calls, so the Dashboard and the Invoices page cannot
disagree. The income trend is `collected_amount()` once per calendar month, so the
last bar IS the "Paid this month" figure by construction.

Every builder takes a `Context` and returns a plain dict; the view wraps each call in
its own try/except (per-section isolation), so a bug in one section cannot blank the
page. Money is a string with two decimals, in the user's display currency unless a
field says "own currency". Times are naive Pakistan time (USE_TZ=False).
"""
import logging
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from decimal import ROUND_HALF_EVEN, Decimal

from dateutil.relativedelta import relativedelta
from django.db.models import Count, Max
from django.utils import timezone

from apps.clients.models import Client
from apps.invoices import kpis
from apps.invoices.models import Invoice, InvoiceComment, InvoicePartialPayment, InvoiceViewEvent
from apps.payments.models import ExchangeRateSnapshot
from apps.proposals.models import AWAITING_RESPONSE_STATUSES, Proposal

logger = logging.getLogger(__name__)

NEEDS_ATTENTION_LIMIT = 5
UPCOMING_WINDOW_DAYS = 7
UPCOMING_LIMIT = 5
TREND_MONTHS = 6
ACTIVITY_WINDOW_DAYS = 14
ACTIVITY_PER_SOURCE = 8
ACTIVITY_LIMIT = 8
# A daily rate snapshot older than this many days is "stale" (the daily fetch has missed days).
RATES_STALE_AFTER_DAYS = 3
RATE_PAIRS = ('USD', 'EUR', 'GBP')
RATE_QUOTE = 'PKR'
CENT = Decimal('0.01')


def today():
    """Pakistan's date. One function so tests can patch it (USE_TZ=False: naive now() IS Pakistan time)."""
    return timezone.now().date()


@dataclass(frozen=True)
class Context:
    user: object
    currency: str
    snapshot: object
    today: date


def build_context(user):
    return Context(
        user=user,
        currency=user.profile.default_currency,
        snapshot=ExchangeRateSnapshot.get_current(),
        today=today(),
    )


def money(value):
    return str(Decimal(value).quantize(CENT))


def iso(value):
    return value.isoformat() if value is not None else None


# ══════════════════════════════════════════════════════════════════
# KPIs
# ══════════════════════════════════════════════════════════════════

def build_kpis(ctx):
    """
    Outstanding is everything owed TODAY (no issue-date window — the Invoices page's
    default `this_month` period would answer a different question). Refunds are not
    netted from "paid this month": a refund has no per-transaction date in the data
    model (documented gap, same as the Invoices KPI strip).
    """
    outstanding_qs = kpis.outstanding_invoices(ctx.user)
    outstanding_total, outstanding_unconverted = kpis.sum_outstanding_amount(outstanding_qs, ctx.currency, ctx.snapshot)
    overdue_qs = kpis.overdue_narrowing(outstanding_qs, ctx.today)
    overdue_total, overdue_unconverted = kpis.sum_outstanding_amount(overdue_qs, ctx.currency, ctx.snapshot)

    month_start = ctx.today.replace(day=1)
    paid_total, paid_count, paid_unconverted = kpis.collected_amount(
        ctx.user, month_start, ctx.today, ctx.currency, ctx.snapshot,
    )
    _current, previous_total, pct_change = kpis.month_over_month_collected(
        ctx.user, ctx.today, ctx.currency, ctx.snapshot,
    )
    return {
        'outstanding': {'total': money(outstanding_total), 'count': outstanding_qs.count(), 'unconverted_count': outstanding_unconverted},
        'overdue': {'total': money(overdue_total), 'count': overdue_qs.count(), 'unconverted_count': overdue_unconverted},
        'paid_this_month': {
            'total': money(paid_total), 'count': paid_count, 'unconverted_count': paid_unconverted,
            'previous_month_total': money(previous_total), 'pct_change': pct_change,
        },
        'active_clients': {'count': Client.objects.filter(user=ctx.user, is_active=True).count()},
    }


# ══════════════════════════════════════════════════════════════════
# INCOME TREND
# ══════════════════════════════════════════════════════════════════

def build_income_trend(ctx):
    """
    Six calendar months ending with the current one, each collected_amount() over
    [first day, min(last day, today)]. Amounts use today's rate out of USD (the app's
    convention), so for a user who invoices in USD and displays PKR, past months move
    with today's rate — the "historical rate" decision belongs to the Payments module.
    """
    first_of_this_month = ctx.today.replace(day=1)
    months = []
    grand_total = Decimal('0')
    unconverted = 0
    for back in range(TREND_MONTHS - 1, -1, -1):
        start = first_of_this_month - relativedelta(months=back)
        last_day = start + relativedelta(months=1) - timedelta(days=1)
        total, _count, month_unconverted = kpis.collected_amount(
            ctx.user, start, min(last_day, ctx.today), ctx.currency, ctx.snapshot,
        )
        grand_total += total
        unconverted += month_unconverted
        months.append({'month': start.strftime('%Y-%m'), 'collected': money(total)})
    return {'months': months, 'total': money(grand_total), 'unconverted_count': unconverted}


# ══════════════════════════════════════════════════════════════════
# NEEDS ATTENTION
# ══════════════════════════════════════════════════════════════════

def _overdue_items(ctx):
    overdue_qs = kpis.overdue_narrowing(kpis.outstanding_invoices(ctx.user), ctx.today)
    items = [
        {
            'id': str(inv.pk), 'invoice_number': inv.invoice_number, 'client_name': inv.client_name,
            # Computed from the dashboard's own `today`, not Invoice.days_overdue, so one patched clock governs the whole payload.
            'days_overdue': (ctx.today - inv.due_date).days,
            'outstanding': money(inv.outstanding_amount), 'currency': inv.currency,
        }
        for inv in overdue_qs.order_by('due_date', 'id')[:NEEDS_ATTENTION_LIMIT]
    ]
    return {'total_count': overdue_qs.count(), 'items': items}


def _unread_message_items(ctx):
    unread = InvoiceComment.objects.filter(
        invoice__user=ctx.user, author_type='client', read_by_freelancer_at__isnull=True,
    )
    per_invoice = list(
        unread.values('invoice_id').annotate(unread_count=Count('id'), latest_at=Max('created_at'))
        .order_by('-latest_at', 'invoice_id')[:NEEDS_ATTENTION_LIMIT]
    )
    invoices = Invoice.objects.filter(user=ctx.user, pk__in=[row['invoice_id'] for row in per_invoice]).in_bulk()
    items = []
    for row in per_invoice:
        invoice = invoices.get(row['invoice_id'])
        if invoice is None:  # cannot happen (the comments were selected through the same user's invoices); defensive only
            continue
        items.append({
            'invoice_id': str(invoice.pk), 'invoice_number': invoice.invoice_number, 'client_name': invoice.client_name,
            'unread_count': row['unread_count'], 'latest_at': iso(row['latest_at']),
        })
    return {
        'total_count': unread.count(),
        'invoice_count': unread.values('invoice_id').distinct().count(),
        'items': items,
    }


def _awaiting_proposal_items(ctx):
    awaiting = Proposal.objects.filter(user=ctx.user, status__in=AWAITING_RESPONSE_STATUSES)
    items = [
        {
            'id': str(p.pk), 'proposal_number': p.proposal_number, 'title': p.title, 'client_name': p.client_name,
            'status': p.status, 'sent_at': iso(p.sent_at), 'valid_until': iso(p.valid_until), 'is_expired': p.is_expired,
        }
        for p in awaiting.order_by('sent_at', 'id')[:NEEDS_ATTENTION_LIMIT]
    ]
    return {'total_count': awaiting.count(), 'items': items}


def build_needs_attention(ctx):
    return {
        'overdue_invoices': _overdue_items(ctx),
        'unread_messages': _unread_message_items(ctx),
        'proposals_awaiting': _awaiting_proposal_items(ctx),
    }


# ══════════════════════════════════════════════════════════════════
# UPCOMING RECURRING
# ══════════════════════════════════════════════════════════════════

def build_upcoming_recurring(ctx):
    """
    Mirrors generate_recurring_invoices' selection (is_recurring, not paused) for the next 7 days,
    both ends inclusive. `amount` is the series invoice's total in its own currency.
    """
    qs = Invoice.objects.filter(
        user=ctx.user, is_recurring=True, recurring_paused=False,
        next_recurring_date__gte=ctx.today,
        next_recurring_date__lte=ctx.today + timedelta(days=UPCOMING_WINDOW_DAYS),
    )
    items = [
        {
            'invoice_id': str(inv.pk), 'invoice_number': inv.invoice_number, 'client_name': inv.client_name,
            'next_date': iso(inv.next_recurring_date), 'amount': money(inv.total), 'currency': inv.currency,
            'auto_send': inv.recurring_auto_send,
        }
        for inv in qs.order_by('next_recurring_date', 'id')[:UPCOMING_LIMIT]
    ]
    return {'total_count': qs.count(), 'items': items}


# ══════════════════════════════════════════════════════════════════
# RECENT ACTIVITY
# ══════════════════════════════════════════════════════════════════

def _activity(kind, at, ref_key, ref_id, number, client_name, **extra):
    entry = {'kind': kind, 'at': iso(at), ref_key: str(ref_id), 'number': number or '', 'client_name': client_name or ''}
    entry.update(extra)
    return entry


def _invoice_activity(ctx, cutoff):
    user = ctx.user
    entries = []

    for inv in Invoice.objects.filter(user=user, sent_at__gte=cutoff).order_by('-sent_at', 'id')[:ACTIVITY_PER_SOURCE]:
        entries.append(_activity('invoice_sent', inv.sent_at, 'invoice_id', inv.pk, inv.invoice_number, inv.client_name,
                                 amount=money(inv.total), currency=inv.currency))

    # One entry per invoice: its latest view, not a row per page load.
    views = list(
        InvoiceViewEvent.objects.filter(invoice__user=user, viewed_at__gte=cutoff).values('invoice_id')
        .annotate(at=Max('viewed_at')).order_by('-at', 'invoice_id')[:ACTIVITY_PER_SOURCE]
    )
    # Same shape for client messages: one entry per invoice, its latest client comment.
    messages = list(
        InvoiceComment.objects.filter(invoice__user=user, author_type='client', created_at__gte=cutoff).values('invoice_id')
        .annotate(at=Max('created_at')).order_by('-at', 'invoice_id')[:ACTIVITY_PER_SOURCE]
    )
    invoices = Invoice.objects.filter(
        user=user, pk__in={row['invoice_id'] for row in views} | {row['invoice_id'] for row in messages},
    ).in_bulk()
    for kind, rows in (('invoice_viewed', views), ('client_message', messages)):
        for row in rows:
            inv = invoices.get(row['invoice_id'])
            if inv is not None:
                entries.append(_activity(kind, row['at'], 'invoice_id', inv.pk, inv.invoice_number, inv.client_name))

    # InvoicePartialPayment keeps only a calendar `payment_date` (which the freelancer can backdate); the moment the
    # payment was RECORDED is `recorded_at`, which is what "activity" means here.
    payments = (
        InvoicePartialPayment.objects.filter(invoice__user=user, recorded_at__gte=cutoff)
        .select_related('invoice').order_by('-recorded_at', 'id')[:ACTIVITY_PER_SOURCE]
    )
    for payment in payments:
        entries.append(_activity('payment_received', payment.recorded_at, 'invoice_id', payment.invoice_id,
                                 payment.invoice.invoice_number, payment.invoice.client_name,
                                 amount=money(payment.amount), currency=payment.currency))
    return entries


def _proposal_activity(ctx, cutoff):
    user = ctx.user
    entries = []
    sources = (
        ('proposal_sent', Proposal.objects.filter(user=user, sent_at__gte=cutoff), 'sent_at'),
        ('proposal_viewed', Proposal.objects.filter(user=user, viewed_at__gte=cutoff), 'viewed_at'),
        ('proposal_accepted', Proposal.objects.filter(user=user, status='accepted', responded_at__gte=cutoff), 'responded_at'),
        ('proposal_declined', Proposal.objects.filter(user=user, status='declined', responded_at__gte=cutoff), 'responded_at'),
    )
    for kind, qs, field in sources:
        for proposal in qs.order_by(f'-{field}', 'id')[:ACTIVITY_PER_SOURCE]:
            entries.append(_activity(kind, getattr(proposal, field), 'proposal_id', proposal.pk,
                                     proposal.proposal_number, proposal.client_name))
    return entries


def build_recent_activity(ctx):
    """
    Built from the domain tables, not core.AuditLog (audit rows are forensic: no numbers or names, and nothing
    is audited for "a client viewed your invoice"). Last 14 days; each source contributes at most its 8 newest
    rows; merge, newest first (ties: kind, then id), keep 8. The frontend writes the sentence and escapes it.
    """
    cutoff = datetime.combine(ctx.today - timedelta(days=ACTIVITY_WINDOW_DAYS), time.min)
    entries = _invoice_activity(ctx, cutoff) + _proposal_activity(ctx, cutoff)
    # Two stable passes: (kind, id) ascending first, then time descending (a stable sort keeps the first pass's order for ties).
    entries.sort(key=lambda e: (e['kind'], e.get('invoice_id') or e.get('proposal_id')))
    entries.sort(key=lambda e: e['at'], reverse=True)
    return {'items': entries[:ACTIVITY_LIMIT]}


# ══════════════════════════════════════════════════════════════════
# EXCHANGE RATES
# ══════════════════════════════════════════════════════════════════

def _usd_value(rates, code):
    """Value of one unit of `code` in USD from a snapshot's rates_to_usd, or None when missing/zero."""
    if code == 'USD':
        return Decimal(1)
    raw = rates.get(code)
    if raw is None:
        return None
    value = Decimal(str(raw))
    return value if value > 0 else None


def build_exchange_rates(ctx):
    """
    One unit of USD/EUR/GBP in PKR from the daily snapshot: rates_to_usd[X] is the USD value of one X, so
    X -> PKR = rates[X] / rates[PKR]. A pair whose currency or PKR is missing or zero is left out. This is a
    DAILY snapshot, not a live feed.
    """
    snapshot = ctx.snapshot
    if snapshot is None:
        return {'date': None, 'stale': False, 'pairs': []}
    rates = snapshot.rates_to_usd or {}
    quote = _usd_value(rates, RATE_QUOTE)
    pairs = []
    if quote is not None:
        for code in RATE_PAIRS:
            base = _usd_value(rates, code)
            if base is None:
                continue
            pairs.append({'from': code, 'to': RATE_QUOTE, 'rate': str((base / quote).quantize(CENT, rounding=ROUND_HALF_EVEN))})
    return {
        'date': snapshot.date.isoformat(),
        'stale': (ctx.today - snapshot.date).days > RATES_STALE_AFTER_DAYS,
        'pairs': pairs,
    }


# Section name -> builder, in response order. The view iterates this, so a new section is one line here.
SECTION_BUILDERS = (
    ('kpis', build_kpis),
    ('income_trend', build_income_trend),
    ('needs_attention', build_needs_attention),
    ('upcoming_recurring', build_upcoming_recurring),
    ('recent_activity', build_recent_activity),
    ('exchange_rates', build_exchange_rates),
)
