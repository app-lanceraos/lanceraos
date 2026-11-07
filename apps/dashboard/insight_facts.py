# apps/dashboard/insight_facts.py
"""
The facts behind the Dashboard insights card. CODE picks and calculates them; the model only words them.

Two layers per fact: a DB layer (queries, the minimum-sample rule) and a PURE constructor (`make_*`) that takes plain
values and returns a `Fact`. The evaluation command calls the constructors with invented numbers and production calls
them with database results, so what is measured is what ships.

Nothing here contains a name, an email, an invoice or proposal number, a title or the user's identity: a Fact's
`statement` is the ONLY thing that reaches the model, and it is fixed English plus month names, a currency code and
numbers. Amounts are rounded to whole currency units and percentages to whole numbers, so a small change in the data
does not change the text (the cache fingerprint is made of these statements).

Dependency direction (STANDARDS.md): the dashboard imports models and shared helpers; nothing imports it.
"""
import logging
import statistics
from dataclasses import dataclass
from datetime import datetime, time, timedelta
from decimal import ROUND_HALF_EVEN, Decimal

from dateutil.relativedelta import relativedelta

from apps.invoices import kpis
from apps.invoices.models import Invoice, InvoicePartialPayment
from apps.proposals.models import Proposal
from core.money import unify_amounts_to_currency

from . import services

logger = logging.getLogger(__name__)

MAX_FACTS = 3
# Fixed English month names: strftime('%B') depends on the server's locale and the model must see stable text.
MONTH_NAMES = (
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
)
# up/down needs a move of at least this many percent; anything smaller is "roughly unchanged".
FLAT_BELOW_PCT = 5
CONCENTRATION_WINDOW_MONTHS = services.TREND_MONTHS   # the same six months the income chart shows
CONCENTRATION_MIN_PAYMENTS = 4
CONCENTRATION_MIN_SHARE = Decimal('0.5')
DAYS_TO_PAY_WINDOW_DAYS = 90
DAYS_TO_PAY_MIN_INVOICES = 3
PROPOSAL_WINDOW_DAYS = 90
PROPOSAL_MIN_DECIDED = 3


@dataclass(frozen=True)
class Fact:
    key: str                     # 'month_vs_previous' | 'client_concentration' | 'days_to_pay' | 'proposal_acceptance'
    statement: str               # the sentence the model sees; every figure in it is final text
    allowed_text: tuple          # every string whose digits the guard may allow for THIS fact
    direction: str               # 'up' | 'down' | 'flat' | '' (only month_vs_previous sets it)
    fallback_observation: str    # fixed, complete, uses only figures from allowed_text
    fallback_suggestion: str     # fixed, contains no numbers at all


# ── small formatting helpers ──────────────────────────────────────────────────────────────────

def whole_units(amount):
    """An amount rounded half-even to a whole number of currency units."""
    return int(Decimal(amount).quantize(Decimal(1), rounding=ROUND_HALF_EVEN))


def money_text(currency, amount):
    return f'{currency} {whole_units(amount):,}'


def month_label(day):
    return f'{MONTH_NAMES[day.month - 1]} {day.year}'


def whole_pct(numerator, denominator):
    """round(numerator / denominator * 100), half-even, as an int."""
    return int((Decimal(numerator) / Decimal(denominator) * 100).quantize(Decimal(1), rounding=ROUND_HALF_EVEN))


def plural(count, word):
    return f'{count} {word}' if count == 1 else f'{count} {word}s'


# ══════════════════════════════════════════════════════════════════
# PURE CONSTRUCTORS (also used by the evaluation command with invented numbers)
# ══════════════════════════════════════════════════════════════════

def make_month_vs_previous(*, currency, last_label, last_total, previous_label, previous_total):
    """Last full month vs the month before it. `previous_total` must be > 0 (the DB layer enforces it)."""
    pct = whole_pct(Decimal(last_total) - Decimal(previous_total), previous_total)
    if pct >= FLAT_BELOW_PCT:
        direction, change = 'up', f'up {pct}%'
    elif pct <= -FLAT_BELOW_PCT:
        direction, change = 'down', f'down {abs(pct)}%'
    else:
        direction, change = 'flat', f'roughly unchanged, under {FLAT_BELOW_PCT}%'
    last, previous = money_text(currency, last_total), money_text(currency, previous_total)
    statement = (
        f'Last month ({last_label}) you collected {last}. '
        f'The month before ({previous_label}) it was {previous}. Change: {change}.'
    )
    if direction == 'up':
        observation = f'Last month you collected {last}, up {pct}% on the month before ({previous}).'
        suggestion = 'Look at which clients or projects brought in the extra money and see whether you can repeat it.'
    elif direction == 'down':
        observation = f'Last month you collected {last}, down {abs(pct)}% from the month before ({previous}).'
        suggestion = 'Check whether payments are running late or fewer invoices went out, and follow up on anything still unpaid.'
    else:
        observation = f'Last month you collected {last}, roughly the same as the month before ({previous}).'
        suggestion = 'Steady income is a good base, so look for one small way to bring in new work or raise a rate.'
    return Fact('month_vs_previous', statement, (statement, observation), direction, observation, suggestion)


def make_client_concentration(*, share_pct, window_months=CONCENTRATION_WINDOW_MONTHS):
    statement = (
        f'Over the last {window_months} months, your largest client accounts for {share_pct}% '
        f'of the money you collected.'
    )
    observation = (
        f'Your largest client accounts for {share_pct}% of the money you collected '
        f'over the last {window_months} months.'
    )
    suggestion = 'Relying on one client is risky, so think about reaching out to past or new clients to spread your income.'
    return Fact('client_concentration', statement, (statement, observation), '', observation, suggestion)


def make_days_to_pay(*, invoice_count, typical_days, window_days=DAYS_TO_PAY_WINDOW_DAYS):
    statement = (
        f'In the last {window_days} days, {invoice_count} of your invoices were paid in full. '
        f'The typical time from issue date to payment was {plural(typical_days, "day")}.'
    )
    observation = (
        f'Your invoices paid in the last {window_days} days were typically paid '
        f'{plural(typical_days, "day")} after the issue date ({invoice_count} invoices).'
    )
    suggestion = 'A clear due date, shorter payment terms and a friendly reminder shortly before it can help you get paid sooner.'
    return Fact('days_to_pay', statement, (statement, observation), '', observation, suggestion)


def make_proposal_acceptance(*, accepted, decided, window_days=PROPOSAL_WINDOW_DAYS):
    rate = whole_pct(accepted, decided)
    statement = (
        f'In the last {window_days} days, {accepted} of the {decided} proposals that got an answer '
        f'were accepted ({rate}%).'
    )
    observation = f'Of the {decided} proposals answered in the last {window_days} days, {accepted} were accepted ({rate}%).'
    suggestion = 'Look at which proposals were accepted and what they had in common, then reuse that approach in the next one.'
    return Fact('proposal_acceptance', statement, (statement, observation), '', observation, suggestion)


# ══════════════════════════════════════════════════════════════════
# DB LAYER (queries + the minimum-sample rule). Each returns a Fact or None.
# ══════════════════════════════════════════════════════════════════

def month_vs_previous(ctx):
    """
    Last full calendar month vs the month before it (January wraps to the previous year), each via
    kpis.collected_amount — the function behind the income chart's bars, so the figures match them. Skipped, never
    guessed, when any payment could not be converted (a total that silently leaves payments out would be wrong) or
    when the previous month collected nothing (a percentage of zero is meaningless). Last month = 0 is allowed.
    """
    first_of_this_month = ctx.today.replace(day=1)
    last_start = first_of_this_month - relativedelta(months=1)
    previous_start = first_of_this_month - relativedelta(months=2)
    last_total, _count, last_unconverted = kpis.collected_amount(
        ctx.user, last_start, first_of_this_month - timedelta(days=1), ctx.currency, ctx.snapshot)
    previous_total, _count, previous_unconverted = kpis.collected_amount(
        ctx.user, previous_start, last_start - timedelta(days=1), ctx.currency, ctx.snapshot)
    if last_unconverted or previous_unconverted or previous_total <= 0:
        return None
    return make_month_vs_previous(
        currency=ctx.currency, last_label=month_label(last_start), last_total=last_total,
        previous_label=month_label(previous_start), previous_total=previous_total)


def client_concentration(ctx):
    """
    One client's share of the money collected over the income chart's six-month window. Payments are grouped by client
    in Python and converted per group. Qualifies with >= 4 payments, nothing unconverted, a positive total, a largest
    group that is a real saved client (one-time clients have no client id, they count in the total but can never be
    "the largest client") and a share of at least 50%.
    """
    window_start = ctx.today.replace(day=1) - relativedelta(months=CONCENTRATION_WINDOW_MONTHS - 1)
    rows = list(
        InvoicePartialPayment.objects.filter(
            invoice__user=ctx.user, payment_date__gte=window_start, payment_date__lte=ctx.today,
        ).values_list('amount', 'currency', 'rate_to_usd', 'invoice__client_id')
    )
    if len(rows) < CONCENTRATION_MIN_PAYMENTS:
        return None
    groups = {}
    for amount, currency, rate, client_id in rows:
        groups.setdefault(client_id, []).append((amount, currency, rate))
    totals = {}
    for client_id, group_rows in groups.items():
        total, unconverted = unify_amounts_to_currency(group_rows, ctx.currency, ctx.snapshot)
        if unconverted:
            return None
        totals[client_id] = total
    grand_total = sum(totals.values(), Decimal('0'))
    if grand_total <= 0:
        return None
    # Deterministic on ties: highest total, then the client id as text (None sorts as '').
    top_id = max(totals, key=lambda cid: (totals[cid], str(cid) if cid is not None else ''))
    if top_id is None or totals[top_id] / grand_total < CONCENTRATION_MIN_SHARE:
        return None
    return make_client_concentration(share_pct=whole_pct(totals[top_id], grand_total))


def days_to_pay(ctx):
    """The MEDIAN issue-to-paid time of invoices paid in the last 90 days (a mean would be dragged by one very late one); needs >= 3."""
    since = ctx.today - timedelta(days=DAYS_TO_PAY_WINDOW_DAYS)
    rows = list(
        Invoice.objects.filter(
            user=ctx.user, status='paid', paid_date__isnull=False, paid_date__gte=since, paid_date__lte=ctx.today,
        ).values_list('issue_date', 'paid_date')
    )
    if len(rows) < DAYS_TO_PAY_MIN_INVOICES:
        return None
    typical = round(statistics.median(max(0, (paid - issued).days) for issued, paid in rows))
    return make_days_to_pay(invoice_count=len(rows), typical_days=int(typical))


def proposal_acceptance(ctx):
    """Accepted / answered proposals over the last 90 days (by the time the client answered); needs >= 3 answered."""
    since = datetime.combine(ctx.today - timedelta(days=PROPOSAL_WINDOW_DAYS), time.min)
    answered = Proposal.objects.filter(user=ctx.user, status__in=('accepted', 'declined'), responded_at__gte=since)
    decided = answered.count()
    if decided < PROPOSAL_MIN_DECIDED:
        return None
    return make_proposal_acceptance(accepted=answered.filter(status='accepted').count(), decided=decided)


# Priority order. If all four qualify the last is dropped by the cap (a recorded known limit).
FACT_BUILDERS = (month_vs_previous, client_concentration, days_to_pay, proposal_acceptance)


def compute_facts(ctx):
    """Up to three facts in priority order. A builder that raises is logged and skipped; the others still return."""
    facts = []
    for builder in FACT_BUILDERS:
        if len(facts) >= MAX_FACTS:
            break
        try:
            fact = builder(ctx)
        except Exception:
            logger.exception('[DASHBOARD] Insight fact %s failed for user %s; skipping it.', builder.__name__, ctx.user.pk)
            continue
        if fact is not None:
            facts.append(fact)
    return facts
