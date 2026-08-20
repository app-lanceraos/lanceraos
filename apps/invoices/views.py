# apps/invoices/views.py
"""
Invoice CRUD + lifecycle endpoints — Section 7 of
INVOICES_CLIENTS_TECHNICAL_SPEC.md. GET .../pdf/ (Step 7b, apps/invoices/
pdf_generator.py) is built now, and so is the real /send/ (Step 10,
apps/invoices/email_service.py) — invoice_send, below, is the first real
consumer of the custom-SMTP-vs-Resend routing chain core/email.py's own
docstring left for "the modules that actually need it".

Rate limiting mirrors apps.clients.views' _check_moderate_rate_limit /
_too_many_requests shape exactly (same 30/hour, same cache-based check,
same return value), but is NOT imported from there — a shared cache-key
prefix across two unrelated resources would either collide on matching
action names or mislabel invoice actions as "ratelimit_clients_...".
Replicated with an "invoices"-scoped key instead; behavior is identical.
"""
import base64
import io
import logging
import os
from datetime import timedelta
from decimal import Decimal, InvalidOperation

from dateutil.relativedelta import relativedelta
from PIL import Image as PILImage
from PIL import UnidentifiedImageError
from django.core.cache import cache
from django.db import IntegrityError, transaction
from django.db.models import Count, Max, Q, Sum
from django.db.models.functions import TruncMonth
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.dateparse import parse_date
from django.views.decorators.clickjacking import xframe_options_exempt
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import ValidationError as DRFValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from core.events import emit
from core.money import Money
from apps.clients.models import Client
from apps.clients.scoring import EXCLUDED_STATUSES as CLIENT_SCORING_EXCLUDED_STATUSES
from apps.clients.serializers import validate_currency_code
from apps.payments.models import ExchangeRateSnapshot
from apps.users.models import FreelancerProfile, User
from apps.users.views.profile import ALLOWED_LOGO_EXTENSIONS, MAX_LOGO_SIZE_BYTES

from .ai_design import seed_design_data_from_image
from .comments import broadcast_comment, broadcast_read_state, upload_comment_attachment
from .design_preview import render_builtin_template_preview_html, render_design_preview_html
from .design_seeds import BUILTIN_DESIGNS, get_builtin_design_data
from .email_service import (
    build_formal_notice_email, build_invoice_send_email, fetch_invoice_pdf_bytes, send_invoice_related_email,
)
from .models import (
    NON_OVERDUE_STATUSES, Invoice, InvoiceComment, InvoiceDesign, InvoiceItem, InvoicePartialPayment,
    InvoicePreset, InvoicePresetItem, InvoiceReminder, PaymentClaim,
)
from .pdf_generator import TEMPLATE_MAP, render_invoice_pdf
from .tasks import REMINDER_SCHEDULE, _advance_recurring_date, _send_reminder, render_and_store_invoice_pdf
from .serializers import (
    DueDateOnlySerializer, InvoiceDesignSerializer, InvoiceListSerializer, InvoicePartialPaymentSerializer,
    InvoicePresetSerializer, InvoiceSerializer, RecurringSeriesSettingsSerializer,
)
from .serializers_claims import PaymentClaimSerializer
from .serializers_comments import CommentCreateSerializer, InvoiceCommentSerializer
from .signature_tool import remove_signature_background

# Reference images for AI design seeding — a narrower set than logo uploads
# (screenshots/photos of an existing design, not decorative image formats):
# no .gif/.bmp/.tiff, same SVG exclusion reasoning as ALLOWED_LOGO_EXTENSIONS
# (stored-XSS risk) even though this image is never persisted anyway.
ALLOWED_REFERENCE_IMAGE_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.webp'}
MAX_REFERENCE_IMAGE_SIZE_BYTES = 8 * 1024 * 1024  # 8MB

logger = logging.getLogger(__name__)

# Invoices delivered to a client and not yet fully resolved — the shared
# eligibility set for "Outstanding"/"Past-Due" dashboard KPIs.
# Deliberately excludes draft/created (never delivered) as well as every
# terminal status.
ACTIVE_STATUSES = ('sent', 'viewed', 'partially_paid')

# invoice_summary's KPI period selector (List/Table restructure pass —
# see DECISIONS.md). 'all_time' is the only period with no window at
# all; every other value bounds the window at `today` on the upper end
# (issue_date/payment_date are never in the future in real data, but the
# upper bound keeps the definition exact rather than implicit).
KPI_PERIOD_CHOICES = ('this_month', 'last_6_months', 'this_year', 'all_time')

# invoice_undo_payment's "old" threshold — the spec didn't pin a number;
# this is this step's own judgment call, recorded here and in
# DECISIONS.md. Confirmation-strictness scaling by age is a Step 6 UI
# concern; this endpoint only needs the binary old/not-old gate.
UNDO_CONFIRMATION_AGE_DAYS = 7

# _finalise_invoice's own bound on invoice_number collision retries (see
# its docstring, finding INV-004) — generous relative to how rare an
# actual collision is (it requires two concurrent finalise calls for the
# SAME user landing within the same commit window), never expected to be
# exhausted in real traffic.
_FINALISE_NUMBER_MAX_ATTEMPTS = 5


def _check_moderate_rate_limit(action, user):
    key = f'ratelimit_invoices_{action}_{user.pk}'
    count = cache.get(key, 0)
    if count >= 30:
        return True
    cache.set(key, count + 1, timeout=3600)
    return False


def _too_many_requests(message):
    return Response({'error': message}, status=status.HTTP_429_TOO_MANY_REQUESTS)


def _get_locked_invoice(pk, user):
    """
    Fetches an invoice row with SELECT ... FOR UPDATE, for every view that
    mutates amount_paid/status based on a check against the invoice's
    current data. MUST be called from inside a transaction.atomic() block
    (select_for_update() raises TransactionManagementError otherwise) —
    every call site below wraps its whole read-check-write sequence in
    one, so the lock is held for the sequence's full duration and released
    only on commit.

    Audit fix (LANCERAOS_CLIENTS_INVOICES_PRODUCTION_AUDIT.md, 19 August
    2026, findings INV-003/DB-002/INV-009): before this, every payment-
    recording and status-mutating view read the invoice with a plain,
    unlocked get_object_or_404, validated a request against that snapshot,
    then wrote — with no lock and no re-validation against fresher data.
    Live-reproduced: 3 concurrent $700 payments against a real $1000
    invoice all passed their own (independent, stale) validation and all
    committed, leaving amount_paid=$2100 on a $1000 total (see invoice
    c6559f99-48b1-45e8-a562-76ab950f6500 / INV-2026-0031, left in the
    database as historical evidence). A second, concurrent request now
    blocks on the row lock until the first transaction commits, then
    re-fetches genuinely current data (this function is called again,
    fresh, at the start of the now-unblocked request) — so every
    invariant checked afterward (outstanding_amount, status) is checked
    against real, post-first-request state, not a stale pre-lock read.

    Shared by every one of the 6 endpoints the audit named for this fix
    (invoice_add_payment, invoice_mark_paid, invoice_claim_confirm,
    invoice_cancel, invoice_refund, invoice_mark_bad_debt) rather than 6
    independently-written locking blocks, per the audit's own explicit
    request for one consistent pattern.
    """
    return get_object_or_404(Invoice.objects.select_for_update(), pk=pk, user=user)


def _lookup_rate_to_usd(currency):
    """
    Real, server-side anchor-currency lookup for a payment recorded right
    now — mirrors Invoice.capture_issue_rate()'s own snapshot-selection
    logic (today's snapshot, falling back to the most recent one) rather
    than duplicating a second, subtly different version of it. Used to
    actually populate InvoicePartialPayment.rate_to_usd, a real, found
    gap: that field's own help_text has always claimed "captured at
    record time," but no call site anywhere in this app ever set it
    (confirmed directly, not assumed, before writing this) — every real
    payment recorded before this fix has rate_to_usd=NULL. Returns None
    only when truly unavailable (no snapshot exists yet, or this specific
    currency is missing from the snapshot's own rates_to_usd) — never
    raises, since a missing rate must not block recording the payment
    itself.
    """
    if currency == 'USD':
        return Decimal('1')
    snapshot = (
        ExchangeRateSnapshot.objects.filter(date=timezone.now().date()).first()
        or ExchangeRateSnapshot.objects.order_by('-date').first()
    )
    if snapshot is None:
        return None
    rate = snapshot.rates_to_usd.get(currency)
    return Decimal(str(rate)) if rate is not None else None


def _get_latest_snapshot():
    """Shared 'today's snapshot, falling back to the most recent one' lookup — same selection logic as _lookup_rate_to_usd/Invoice.capture_issue_rate, factored out so invoice_summary and invoice_analytics don't each duplicate it."""
    return (
        ExchangeRateSnapshot.objects.filter(date=timezone.now().date()).first()
        or ExchangeRateSnapshot.objects.order_by('-date').first()
    )


def _unify_amounts_to_currency(rows, target_currency, snapshot):
    """
    Real anchor-currency unification across mixed-currency invoices —
    the single shared implementation invoice_summary (KPI cards) AND
    invoice_analytics's _build_currency_breakdown both call, instead of
    each reimplementing the same "sum raw Decimals across whatever
    currencies happen to be present" bug independently (the real,
    confirmed KPI-card bug this helper exists to fix — see DECISIONS.md).

    `rows` is an iterable of (amount, currency, rate_to_usd_at_issue)
    tuples — callers decide what they're summing (outstanding, total,
    amount_paid, ...), this only handles the conversion + honest-gap
    bookkeeping. A row whose currency already equals target_currency
    converts trivially with no rate needed at all — even with no
    snapshot/rate captured, matching Money.to_usd()'s own "USD converts
    to itself" carve-out generalized to an arbitrary target. A row with a
    genuinely different currency and no frozen rate_to_usd_at_issue (or a
    target_currency missing from `snapshot`) is skipped and counted in
    `unconverted_count` — never guessed, never silently included
    unconverted (see DECISIONS.md).
    """
    unified_total = Decimal('0')
    unconverted_count = 0
    for amount, currency, rate_to_usd_at_issue in rows:
        if currency == target_currency:
            unified_total += amount
            continue
        # snapshot is only actually needed for the USD->target leg
        # (Money.to_currency short-circuits that lookup entirely when
        # target_currency == 'USD') — requiring it unconditionally would
        # wrongly mark every row unconverted on a fresh install with no
        # ExchangeRateSnapshot row yet, even for the common "everything
        # defaults to USD" case.
        if rate_to_usd_at_issue is None or (snapshot is None and target_currency != 'USD'):
            unconverted_count += 1
            continue
        try:
            unified_total += Money(amount, currency, rate_to_usd_at_issue).to_currency(target_currency, snapshot)
        except ValueError:
            unconverted_count += 1
    return unified_total.quantize(Decimal('0.01')), unconverted_count


def _parse_date_param(raw, default=None):
    """Returns (date_or_None, error_response_or_None)."""
    if not raw:
        return default, None
    parsed = parse_date(raw)
    if parsed is None:
        return None, Response({'error': 'Invalid date — use YYYY-MM-DD.'}, status=status.HTTP_400_BAD_REQUEST)
    return parsed, None


def _kpi_period_window(period, today):
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


def _collected_amount(user, start, end, target_currency, snapshot):
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
    instead of this helper — see invoice_summary.
    """
    qs = InvoicePartialPayment.objects.filter(invoice__user=user)
    if start is not None:
        qs = qs.filter(payment_date__gte=start, payment_date__lte=end)
    total, unconverted = _unify_amounts_to_currency(
        ((p.amount, p.currency, p.rate_to_usd) for p in qs), target_currency, snapshot,
    )
    count = qs.values('invoice_id').distinct().count()
    return total, count, unconverted


# ══════════════════════════════════════════════════════════════════
# INVOICE LIST / CREATE
# ══════════════════════════════════════════════════════════════════

@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def invoice_list(request):
    """
    GET: filterable/searchable/sortable invoice list for the authenticated
    user. POST: delegates to invoice_create — same one-URL-one-callable
    reasoning as apps.clients.views.client_list.
    """
    if request.method == 'POST':
        return invoice_create(request)

    qs = Invoice.objects.filter(user=request.user)

    status_param = request.query_params.get('status')
    if status_param:
        qs = qs.filter(status=status_param)

    if request.query_params.get('overdue') == 'true':
        # days_overdue is a computed property, not a DB column — this
        # mirrors its exact logic (NON_OVERDUE_STATUSES + due_date) at
        # the query level instead of instantiating every row in Python.
        qs = qs.exclude(status__in=NON_OVERDUE_STATUSES).filter(due_date__lt=timezone.now().date())

    client_id = request.query_params.get('client')
    if client_id:
        qs = qs.filter(client_id=client_id)

    # Real WHERE-clause filter (item 5 of the List/Table restructure) —
    # never a display-only conversion. Composes with every other filter
    # above/below since it's just another qs.filter() in the same chain.
    currency_param = request.query_params.get('currency')
    if currency_param:
        qs = qs.filter(currency=currency_param.upper())

    search = request.query_params.get('search', '').strip()
    if search:
        qs = qs.filter(
            Q(invoice_number__icontains=search) | Q(client_name__icontains=search) | Q(client_email__icontains=search)
        )

    sort_map = {'recent': '-created_at', 'due_date': 'due_date', 'total': '-total', 'client_name': 'client_name'}
    qs = qs.order_by(sort_map.get(request.query_params.get('sort', 'recent'), '-created_at'))

    try:
        limit = min(max(int(request.query_params.get('limit', 50)), 1), 200)
    except ValueError:
        limit = 50
    try:
        offset = max(int(request.query_params.get('offset', 0)), 0)
    except ValueError:
        offset = 0

    total = qs.count()
    page = qs[offset:offset + limit]

    return Response({
        'results': InvoiceListSerializer(page, many=True).data,
        'total': total, 'limit': limit, 'offset': offset,
    })


def invoice_create(request):
    """
    Creates a new draft invoice. invoice_number is deliberately left
    unassigned (None) — see Invoice.invoice_number's field comment;
    invoice_finalise() is what assigns the real number.

    `design` is deliberately NOT one of InvoiceSerializer's own fields (a
    client can't just pass an arbitrary design id in the request body —
    only the system's own default-design lookup may assign it), so it's
    set here as an extra serializer.save() kwarg, the same pattern already
    used for `user` on the line below. This is the real, previously-
    missing connection between "a user marked a design as their default"
    (InvoiceDesign.is_default, set via .../set-default/) and any actual
    invoice — before this fix, is_default was write-only: nothing, ever,
    anywhere, read it back. Assigned at CREATE time (not finalise) so a
    draft's live PDF preview and its eventual finalised/frozen PDF always
    agree — never a design that visibly changes out from under the user
    the moment they click Finalise. See DECISIONS.md's 19 August 2026
    "design assignment gap" entry for the full investigation (a real,
    live-browser-verified SEV1 report) this closes.
    """
    if _check_moderate_rate_limit('create', request.user):
        return _too_many_requests('Too many invoices created recently. Please try again later.')

    serializer = InvoiceSerializer(data=request.data, context={'request': request})
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    default_design = InvoiceDesign.objects.filter(user=request.user, is_default=True).first()
    invoice = serializer.save(user=request.user, design=default_design)
    emit('InvoiceCreated', invoice_id=str(invoice.pk), user_id=str(request.user.pk))
    logger.info('[INVOICES] Created draft invoice %s for user %s.', invoice.pk, request.user.pk)
    return Response(InvoiceListSerializer(invoice).data, status=status.HTTP_201_CREATED)


# ══════════════════════════════════════════════════════════════════
# INVOICE DETAIL / DELETE
# ══════════════════════════════════════════════════════════════════

@api_view(['GET', 'PUT', 'DELETE'])
@permission_classes([IsAuthenticated])
def invoice_detail(request, pk):
    """
    GET always allowed. PUT only when is_editable (status == 'draft') —
    rejected with a clear 403, never a silent no-op. DELETE only for
    draft/created (per the spec) — enforced here, not just
    frontend-trusted. All three methods share this one path per the
    spec's endpoint table (GET/PUT/DELETE all on /api/invoices/<pk>/,
    not a separate /delete/ sub-path).

    Step 16's one narrow exception: a recurring ROOT invoice
    (is_recurring, no parent_invoice) past its own draft status may still
    have exactly its recurring_interval_days/recurring_auto_send fields
    changed here — "edit the whole series going forward" — via
    RecurringSeriesSettingsSerializer, never the general InvoiceSerializer.

    Bug-hardening round's own narrow exception, same shape: a non-draft,
    non-terminal invoice (created/sent/viewed/partially_paid — i.e. still
    has a real due date that matters) may still have exactly its
    due_date changed here — InvoiceDetailPanel's "Change Due Date"
    More-menu action — via DueDateOnlySerializer. A terminal invoice
    (paid/cancelled/refunded/bad_debt) is excluded — nothing left to
    reschedule once resolved.

    A non-root invoice touching anything outside these two narrow
    allowances, or a terminal-status invoice, still hits the ordinary
    is_editable rejection below.
    """
    invoice = get_object_or_404(Invoice, pk=pk, user=request.user)

    if request.method == 'GET':
        return Response(InvoiceListSerializer(invoice).data)

    if request.method == 'DELETE':
        if _check_moderate_rate_limit('delete', request.user):
            return _too_many_requests('Too many delete actions. Please try again later.')
        if invoice.status not in ('draft', 'created'):
            return Response({'error': 'Only draft or created invoices can be deleted.'}, status=status.HTTP_403_FORBIDDEN)
        invoice_id = invoice.pk
        invoice.delete()
        logger.info('[INVOICES] Deleted invoice %s.', invoice_id)
        return Response(status=status.HTTP_204_NO_CONTENT)

    if not invoice.is_editable:
        is_recurring_root = invoice.is_recurring and invoice.parent_invoice_id is None
        allowed_series_fields = {'recurring_interval_days', 'recurring_auto_send'}
        submitted_fields = set(request.data.keys())
        if is_recurring_root and submitted_fields and submitted_fields.issubset(allowed_series_fields):
            if _check_moderate_rate_limit('update', request.user):
                return _too_many_requests('Too many updates. Please try again later.')
            serializer = RecurringSeriesSettingsSerializer(invoice, data=request.data, partial=True)
            if not serializer.is_valid():
                return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
            serializer.save()
            logger.info('[INVOICES] Updated recurring series settings on root invoice %s.', invoice.pk)
            return Response(InvoiceListSerializer(invoice).data)

        due_date_only_eligible = invoice.status in ('created',) + ACTIVE_STATUSES
        if due_date_only_eligible and submitted_fields and submitted_fields.issubset({'due_date'}):
            if _check_moderate_rate_limit('update', request.user):
                return _too_many_requests('Too many updates. Please try again later.')
            serializer = DueDateOnlySerializer(invoice, data=request.data, partial=True)
            if not serializer.is_valid():
                return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
            serializer.save()
            logger.info('[INVOICES] Due date changed to %s for invoice %s.', invoice.due_date, invoice.invoice_number)
            return Response(InvoiceListSerializer(invoice).data)

        return Response(
            {'error': 'This invoice can no longer be edited — only draft invoices can be changed.'},
            status=status.HTTP_403_FORBIDDEN,
        )

    if _check_moderate_rate_limit('update', request.user):
        return _too_many_requests('Too many updates. Please try again later.')

    serializer = InvoiceSerializer(invoice, data=request.data, context={'request': request})
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    serializer.save()
    logger.info('[INVOICES] Updated invoice %s.', invoice.pk)
    return Response(InvoiceListSerializer(invoice).data)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def invoice_pdf(request, pk):
    """
    Live-vs-stored boundary: only `draft` still live-renders (nothing
    frozen yet, nothing to break — this is also what backs the wizard's
    "Preview PDF" action before finalising), served inline (no
    Content-Disposition — a preview, not a download). `created` used to
    live-render here too (grouped with `draft`), which was real,
    pointless work: `is_editable` already only allows edits at
    status='draft', so a `created` invoice can never change again, and
    invoice_finalise freezes its PDF the moment it leaves draft — see
    _finalise_invoice.

    REWORKED (Cloudinary-ACL-401 follow-up — see DECISIONS.md): a
    `created`-or-beyond invoice used to get a bare 302 redirect straight
    to the stored Cloudinary secure_url. That surfaced this account's
    real, confirmed raw/PDF-delivery ACL restriction (see
    upload_pdf_bytes's own docstring) DIRECTLY to the browser as a
    Cloudinary 401 error page the moment the redirect resolved — this
    endpoint's own backend credentials can always reach the asset even
    when a raw unauthenticated browser GET against the same URL can't, so
    proxying the actual bytes through here (reusing
    fetch_invoice_pdf_bytes — the exact same self-heal chain
    invoice_send/the reminder task already rely on, not a second,
    parallel fetch implementation) makes this endpoint correct regardless
    of whether that Cloudinary Console setting ever changes. This is the
    ONLY consumer of this route that reaches a non-draft invoice — "View
    Invoice" is a structurally separate endpoint (portal_invoice_view_html,
    HTML not PDF) that never touches this view at all — so
    Content-Disposition is unconditionally `attachment` here, matching
    the "Download Invoice" button's own name; no inline/query-param case
    exists to route between.
    """
    invoice = get_object_or_404(Invoice, pk=pk, user=request.user)

    if invoice.status == 'draft':
        pdf_bytes = render_invoice_pdf(invoice)
        return HttpResponse(pdf_bytes, content_type='application/pdf')

    pdf_bytes = fetch_invoice_pdf_bytes(invoice)
    if pdf_bytes is None:
        logger.error('[INVOICES] Invoice %s (status=%s): every PDF fetch/render path failed — cannot serve a download.', invoice.invoice_number, invoice.status)
        return Response({'error': "Could not prepare this invoice's PDF right now. Please try again shortly."}, status=status.HTTP_502_BAD_GATEWAY)

    response = HttpResponse(pdf_bytes, content_type='application/pdf')
    response['Content-Disposition'] = f'attachment; filename="{invoice.invoice_number or "invoice"}.pdf"'
    return response


# ══════════════════════════════════════════════════════════════════
# LIFECYCLE ACTIONS
# ══════════════════════════════════════════════════════════════════

def _missing_due_date_error():
    """
    Shared error payload for the due_date-required-to-finalise check
    (item 6 of the verification pass) — due_date is still nullable at the
    model/serializer level (autosave on an incomplete draft must stay
    permissive, matching client_name/client_email's own established
    precedent), so this is enforced here instead, at the one real
    "leaving draft" gate, alongside the existing at-least-one-line-item
    check every finalise-shaped endpoint already duplicates.
    """
    return Response({'error': 'Add a due date before finalising.'}, status=status.HTTP_400_BAD_REQUEST)


def _finalise_invoice(invoice, force_reminders_off=True):
    """
    The real "leave draft" event — draft -> created, invoice_number
    assignment, exchange-rate lock, finalised_at timestamp, and the
    one-time PDF render+store (moved here from invoice_mark_sent in this
    pass — see DECISIONS.md). Shared by invoice_finalise (the explicit
    button), invoice_mark_sent (which calls this first if the invoice is
    still a draft when the user clicks "Mark as Sent" directly, skipping
    the separate Finalise click), AND invoice_finalise_and_send (the
    combined action).

    is_editable only permits edits at status='draft' (Invoice.is_editable) —
    a created invoice is already fully immutable, so this render+store is
    the ONE point where freezing the PDF is both correct and sufficient;
    invoice_pdf's own live-vs-stored boundary already treats anything past
    draft/created as frozen, and re-rendering on every later GET for an
    invoice that can never change again was pointless work.

    force_reminders_off: True (default) for the standalone Finalise button
    — finalising alone never turns reminders on, since per
    Invoice.sent_via_platform's own field help_text reminders are
    structurally inert until an invoice is actually sent, so forcing the
    stored value off here avoids a misleading "on" value nothing can act
    on yet. The combined Finalise & Send action passes False instead —
    that flow immediately proceeds to a real send in the same request, so
    whatever reminders_enabled the invoice already holds (the create-flow
    wizard's own toggle choice) is a real, actionable value the moment
    finalise completes, and forcing it off first would just require
    /send/ to inspect a stale, pre-overridden value instead of the user's
    actual current choice. See DECISIONS.md's Finalise & Send entry.

    Caller is responsible for the surrounding rate limit / not-found /
    status checks — this assumes the caller already confirmed
    invoice.status == 'draft'.

    PERFORMANCE (item 15 of the verification pass — real, profiled fix,
    not a guess): the render+store used to happen SYNCHRONOUSLY here,
    inside the HTTP request — a real, measured ~1-1.5s WeasyPrint render
    locally (and profiled at ~6s against the real dev Cloudinary account
    per email_service.fetch_invoice_pdf_bytes' own docstring) plus the
    Cloudinary upload itself, both blocking the response before this
    function could even return. Now fires apps.invoices.tasks.
    render_and_store_invoice_pdf as a background Celery task instead —
    the status transition (draft->created, invoice_number, exchange
    rate, finalised_at) commits and this function returns immediately,
    with the PDF landing moments later. This is safe, not just fast:
    fetch_invoice_pdf_bytes/invoice_pdf's own self-heal chain already
    treats a blank pdf_url as "render live instead" rather than an
    error, so a PDF request that arrives before the background task
    finishes still gets a correct PDF, just via a live render instead of
    the frozen artifact — see both call sites' own docstrings.

    Audit fix (LANCERAOS_CLIENTS_INVOICES_PRODUCTION_AUDIT.md, 19 August
    2026, finding INV-004): Invoice.generate_invoice_number()'s own
    docstring has always documented, unfixed, that two concurrent calls
    for the same user in the same year can read the same "last" number
    before either saves — the unique_together(user, invoice_number)
    constraint prevented a silently duplicated number, but turned the
    race into a raw, unhandled IntegrityError 500 reaching a real client.
    Live-reproduced: 4 concurrent finalise calls for 4 of the same user's
    fresh drafts produced 2 successes and 2 Django debug-mode 500s
    ("duplicate key value violates unique constraint... Key (user_id,
    invoice_number)=(..., INV-2026-0029) already exists.").

    Fixed with approach (a) from the audit's own fix list —
    select_for_update() on a real per-user locking point — not the
    bounded-retry approach (b) this function tried first: under real
    concurrency-test load (8 simultaneous finalise calls, no lock, just
    retry), independent uncoordinated retries could still collide with
    each other repeatedly — a real "thundering herd" against the same
    unlocked counter read, exhausting even a 5-attempt retry budget in
    testing. Locking the User row for the duration of generation+save
    (identical pattern to apps.users.models.Session.create_for_user's own
    3-session-cap race fix — "locks the user row for the duration so
    concurrent [operations] can't both read the same under-cap count and
    race past" — the same class of per-user-counter race, same fix)
    fully serializes number assignment per user instead of leaving it to
    chance: only one finalise for this user can be inside the
    generate+save critical section at a time, so every retry (kept below,
    now genuinely defense-in-depth rather than the primary mechanism)
    sees truly current data on its very first attempt.
    """
    invoice.recalculate_totals()
    invoice.capture_issue_rate()
    invoice.status = 'created'
    invoice.finalised_at = timezone.now()
    if force_reminders_off:
        invoice.reminders_enabled = False

    # Defensive fallback for a draft created before invoice_create started
    # assigning the user's default design (see that view's own docstring) —
    # every draft in the database as of this fix predates it, so without
    # this, all of them would stay design_id=None forever even after the
    # user has since marked a real design as default. Only applies when
    # nothing has assigned one already (never overrides a real choice).
    if invoice.design_id is None:
        invoice.design = InvoiceDesign.objects.filter(user=invoice.user, is_default=True).first()

    # A recurring root's next_recurring_date was never being set anywhere
    # (Step 16 only ever advances it once a value already exists) — every
    # recurring invoice created through the real wizard/creation flow sat
    # with next_recurring_date=None forever, so generate_recurring_invoices'
    # own next_recurring_date__lte=today filter could never match it. This
    # is the real "leaving draft" event and the earliest point an
    # is_recurring invoice is actually live, so it's the right place to
    # seed the first occurrence — anchored from issue_date via the same
    # _advance_recurring_date helper the generation task itself uses, so a
    # weekly series created and finalised today generates its first real
    # occurrence one week from today, not today itself.
    if (
        invoice.is_recurring
        and invoice.parent_invoice_id is None
        and invoice.recurring_interval_days
        and invoice.next_recurring_date is None
    ):
        invoice.next_recurring_date = _advance_recurring_date(invoice.issue_date, invoice.recurring_interval_days)

    if invoice.invoice_number:
        # Already assigned (e.g. a duplicate that kept its source number,
        # or a re-entrant call) — no number race is possible here, a
        # plain save is correct and unchanged from before this fix.
        invoice.save()
    else:
        for attempt in range(1, _FINALISE_NUMBER_MAX_ATTEMPTS + 1):
            try:
                with transaction.atomic():
                    # Locks the SAME user row Session.create_for_user()
                    # locks for its own per-user-counter race — serializes
                    # every concurrent finalise for this one user so only
                    # one is ever generating+saving a number at a time.
                    User.objects.select_for_update().get(pk=invoice.user_id)
                    invoice.invoice_number = Invoice.generate_invoice_number(invoice.user)
                    invoice.save()
                break
            except IntegrityError:
                if attempt == _FINALISE_NUMBER_MAX_ATTEMPTS:
                    logger.error(
                        '[INVOICES] Could not assign a unique invoice number for user %s after %s attempts.',
                        invoice.user_id, _FINALISE_NUMBER_MAX_ATTEMPTS,
                    )
                    raise
                logger.warning(
                    '[INVOICES] invoice_number collision on %s for user %s — retrying (attempt %s/%s).',
                    invoice.invoice_number, invoice.user_id, attempt, _FINALISE_NUMBER_MAX_ATTEMPTS,
                )

    render_and_store_invoice_pdf.delay(str(invoice.pk))


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def invoice_finalise(request, pk):
    """
    draft -> created. Assigns invoice_number if not already assigned; locks
    the exchange rate via the latest ExchangeRateSnapshot; freezes the PDF
    (see _finalise_invoice — moved here from invoice_mark_sent this pass,
    since a created invoice is already fully immutable and that's the
    real "leaving draft" event, not "leaving created").

    Validation actually enforced today: status must be draft, and at least
    one line item must exist. It does NOT check client_name/client_email —
    a real mismatch against the intuitive expectation that finalising
    requires "a client or one-time-client info", surfaced while relaxing
    InvoiceSerializer's client_name/client_email to allow_blank for
    autosave (Step 6 rework). Not tightened here at the backend level —
    the frontend's own wizard rework (this pass) is what actually closes
    that gap now, by making Finalise/Mark-as-Sent unreachable in the UI
    before a real client + item exist; see DECISIONS.md.
    """
    if _check_moderate_rate_limit('finalise', request.user):
        return _too_many_requests('Too many finalise actions. Please try again later.')

    invoice = get_object_or_404(Invoice, pk=pk, user=request.user)
    if invoice.status != 'draft':
        return Response({'error': 'Only draft invoices can be finalised.'}, status=status.HTTP_400_BAD_REQUEST)
    if not invoice.items.exists():
        return Response({'error': 'Add at least one line item before finalising.'}, status=status.HTTP_400_BAD_REQUEST)
    if not invoice.due_date:
        return _missing_due_date_error()

    _finalise_invoice(invoice)

    emit('InvoiceFinalised', invoice_id=str(invoice.pk), user_id=str(request.user.pk))
    logger.info('[INVOICES] Finalised invoice %s.', invoice.invoice_number)
    return Response(InvoiceListSerializer(invoice).data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def invoice_mark_sent(request, pk):
    """
    Manual dropdown-flip path only — the freelancer telling the system
    "I already sent this myself" (email, WhatsApp, in person), NOT a real
    platform send (that's /send/, Step 10, excluded from this step).
    Requires an explicit confirm:true plus a send_reminders bool, per the
    decisions doc's persistent-banner/reminders-toggle design — flipping
    this without confirmation could silently start the reminder-
    escalation clock for an invoice the platform never actually sent.

    Deliberately does NOT set sent_via_platform. Confirmed directly
    against two independent sources: Invoice.sent_via_platform's own
    field help_text ("Set only by the real /send/ action... Gates
    reminders only") and the spec's endpoint table, which lists /send/
    and /mark-sent/ as two distinct rows with different descriptions.
    Setting it here would be exactly the "conflating manual flip with a
    real send" mistake this step's own instructions warned against.

    Callable directly from 'draft' (the frontend offers Finalise and Mark
    as Sent as parallel choices, not a strict sequence — a user can click
    Mark as Sent without ever clicking Finalise first) — when that
    happens, this finalises the invoice first (_finalise_invoice, the one
    real place the PDF gets frozen) before also transitioning to 'sent',
    so "leaving draft via mark-sent" gets exactly the same one-time
    render+store as "leaving draft via finalise" — never twice, never
    zero times. If the invoice is already 'created' (finalised earlier,
    separately), that PDF is already frozen and this does not re-render.
    """
    if not request.data.get('confirm'):
        return Response({'error': 'confirm: true is required to mark this invoice as sent.'}, status=status.HTTP_400_BAD_REQUEST)

    if _check_moderate_rate_limit('mark_sent', request.user):
        return _too_many_requests('Too many actions. Please try again later.')

    invoice = get_object_or_404(Invoice, pk=pk, user=request.user)
    if invoice.status not in ('draft', 'created'):
        return Response({'error': 'Only draft or created invoices can be marked sent.'}, status=status.HTTP_400_BAD_REQUEST)

    if invoice.status == 'draft':
        if not invoice.items.exists():
            return Response({'error': 'Add at least one line item before marking this invoice as sent.'}, status=status.HTTP_400_BAD_REQUEST)
        if not invoice.due_date:
            return _missing_due_date_error()
        _finalise_invoice(invoice)

    invoice.reminders_enabled = bool(request.data.get('send_reminders', True))
    invoice.status = 'sent'
    invoice.sent_at = timezone.now()
    # update_fields, not a bare save() — item 15's background PDF task may
    # write pdf_url/pdf_public_id/pdf_generated_at to the DB row between
    # _finalise_invoice() firing it and this save; a full save() here
    # would overwrite those columns back to whatever stale (usually
    # blank) value this in-memory `invoice` object still holds, silently
    # losing the background write.
    invoice.save(update_fields=['reminders_enabled', 'status', 'sent_at'])

    emit('InvoiceSent', invoice_id=str(invoice.pk), user_id=str(request.user.pk), via='manual')
    logger.info('[INVOICES] Marked invoice %s as sent (manual).', invoice.invoice_number)
    return Response(InvoiceListSerializer(invoice).data)


def _send_invoice_now(invoice, request):
    """
    The actual delivery + state-commit logic shared by invoice_send (an
    already-created invoice) and invoice_finalise_and_send (finalise then
    immediately send in the same request). Callers have already checked
    confirm/rate-limit and that invoice.status == 'created'.

    Atomicity: status/sent_via_platform/sent_at are only ever written
    AFTER send_invoice_related_email reports result['sent'] is True — the
    invoice is left exactly as it was (still 'created', not 'sent') on
    any failure, so a client never sees an invoice marked sent that it
    never actually received. Verified directly against this function's
    own control flow, not assumed: every return path before the
    `invoice.status = 'sent'` line ends in `return Response(...)`, so
    there is no way to reach that line without result['sent'] being True.

    Error responses are built from send_invoice_related_email's own
    result dict, not a generic string — result['error'] carries Resend's
    (or the final fallback's) real failure detail, and result['fallback_used']
    tells the caller whether custom SMTP was even attempted first.

    reminders_enabled is deliberately left untouched here — whatever
    value the invoice already holds (either _finalise_invoice's forced-
    False, a later manual flip via invoice_toggle_reminders, or the
    caller's own force_reminders_off=False pass-through for the combined
    Finalise & Send action) is respected as-is. There is a dedicated
    toggle for this already; /send/ doesn't need its own special-case
    logic for a value the user can already set directly.

    Deliberately does NOT bail out early on a blank invoice.pdf_url
    (item 15 of the verification pass — _finalise_invoice now fires its
    render+store as a background task, so pdf_url is routinely still
    blank the moment Finalise & Send calls straight into this function):
    fetch_invoice_pdf_bytes' own self-heal chain treats a blank pdf_url
    exactly like a failed fetch and renders live instead, so this only
    fails for a genuine total failure — every path, including that live
    render, exhausted.
    """
    pdf_bytes = fetch_invoice_pdf_bytes(invoice)
    if pdf_bytes is None:
        return Response(
            {'error': 'Could not retrieve or regenerate this invoice\'s PDF. The invoice has not been sent — please try again.'},
            status=status.HTTP_502_BAD_GATEWAY,
        )

    subject, html_body, plain_body = build_invoice_send_email(invoice)
    result = send_invoice_related_email(
        invoice, subject, html_body, plain_body,
        pdf_bytes=pdf_bytes, request_id=getattr(request, 'request_id', None),
    )
    if not result['sent']:
        detail = result['error'] or 'the email provider rejected the request'
        prefix = 'Your custom SMTP server and the LanceraOS fallback both failed to send this invoice' if result['fallback_used'] \
            else 'LanceraOS could not send this invoice'
        return Response(
            {'error': f'{prefix}: {detail}. The invoice has not been sent — it is still Finalised, not Sent.'},
            status=status.HTTP_502_BAD_GATEWAY,
        )

    invoice.status = 'sent'
    invoice.sent_via_platform = True
    invoice.sent_at = timezone.now()
    # update_fields, same reasoning as invoice_mark_sent's own save above —
    # the background PDF task (fired by an earlier _finalise_invoice call,
    # for the combined Finalise & Send path) may write pdf_url/
    # pdf_public_id/pdf_generated_at concurrently with this request.
    invoice.save(update_fields=['status', 'sent_via_platform', 'sent_at'])

    emit('InvoiceSent', invoice_id=str(invoice.pk), user_id=str(request.user.pk), via='platform')
    logger.info(
        '[INVOICES] Sent invoice %s to %s via %s%s.',
        invoice.invoice_number, invoice.client_email, result['sent_via'],
        ' (fallback from custom SMTP)' if result['fallback_used'] else '',
    )
    return Response(InvoiceListSerializer(invoice).data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def invoice_send(request, pk):
    """
    The REAL send — actually delivers the invoice email to the client,
    distinct from invoice_mark_sent's manual self-report flip (that
    endpoint is unmodified by this addition; the two are parallel,
    legitimate actions per the decisions doc, not a sequence).

    Only from status='created' — a finalised, not-yet-sent invoice. The
    PDF is already frozen by _finalise_invoice at that point (see its own
    docstring on the freeze-point move); this endpoint never re-renders
    or re-stores it on the happy path — fetch_invoice_pdf_bytes's own
    self-heal chain is what may re-upload/re-render, only on failure.

    Sets sent_via_platform=True — the one thing invoice_mark_sent never
    does (confirmed against that field's own help_text: "Set only by the
    real /send/ action... Gates reminders only") — this is what actually
    makes apps/invoices/tasks.py's reminder task eligible to fire for
    this invoice for the first time.

    Requires an explicit confirm:true, mirroring invoice_mark_sent's own
    safety pattern — this is the one action in the whole lifecycle that
    actually emails a third party, so a stray double-click must not be
    able to trigger it silently.

    Actual delivery + state-commit logic lives in _send_invoice_now,
    shared with invoice_finalise_and_send below.
    """
    if not request.data.get('confirm'):
        return Response({'error': 'confirm: true is required to send this invoice.'}, status=status.HTTP_400_BAD_REQUEST)

    if _check_moderate_rate_limit('send', request.user):
        return _too_many_requests('Too many send actions. Please try again later.')

    invoice = get_object_or_404(Invoice, pk=pk, user=request.user)
    if invoice.status != 'created':
        return Response({'error': 'Only finalised, not-yet-sent invoices can be sent.'}, status=status.HTTP_400_BAD_REQUEST)

    return _send_invoice_now(invoice, request)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def invoice_finalise_and_send(request, pk):
    """
    The combined "Finalise & Send" wizard action — draft -> created ->
    sent in one request, one confirm. Exists because the standalone
    Finalise button (invoice_finalise) always forces reminders_enabled
    to False (see _finalise_invoice's own docstring on why that's correct
    for THAT path: reminders are inert before a real send exists at all)
    — but here a real send is about to happen in the very same request,
    so that force-off would just make /send/ act on a stale value instead
    of whatever the user's wizard toggle currently shows. Passing
    force_reminders_off=False to _finalise_invoice is what fixes this:
    reminders_enabled is left exactly as the invoice already holds it
    (the create-flow wizard's own saved choice) straight through to the
    send below. See DECISIONS.md for the full reasoning and the
    alternative (a near-duplicate finalise function) that was rejected.

    Same confirm:true + rate-limit + item-existence checks as the
    standalone finalise, since this covers the same draft->created
    transition; a second confirm for the send half is deliberately NOT
    required — this is presented as one combined action with one
    confirmation step, per the task's own framing.
    """
    if not request.data.get('confirm'):
        return Response({'error': 'confirm: true is required to finalise and send this invoice.'}, status=status.HTTP_400_BAD_REQUEST)

    if _check_moderate_rate_limit('finalise', request.user):
        return _too_many_requests('Too many finalise actions. Please try again later.')

    invoice = get_object_or_404(Invoice, pk=pk, user=request.user)
    if invoice.status != 'draft':
        return Response({'error': 'Only draft invoices can be finalised and sent.'}, status=status.HTTP_400_BAD_REQUEST)
    if not invoice.items.exists():
        return Response({'error': 'Add at least one line item before finalising.'}, status=status.HTTP_400_BAD_REQUEST)
    if not invoice.due_date:
        return _missing_due_date_error()

    _finalise_invoice(invoice, force_reminders_off=False)
    emit('InvoiceFinalised', invoice_id=str(invoice.pk), user_id=str(request.user.pk))
    logger.info('[INVOICES] Finalised invoice %s (combined finalise-and-send).', invoice.invoice_number)

    return _send_invoice_now(invoice, request)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def invoice_mark_paid(request, pk):
    """
    Pre-fills the full outstanding balance as a real InvoicePartialPayment
    row (the same structured entry flow invoice_add_payment uses), then
    delegates to update_paid_status() — never a bare status edit, so
    payment history stays accurate and undo-able like any other payment.

    Audit fix (finding INV-003/DB-002): the whole read-check-write
    sequence now runs under a locked invoice row (_get_locked_invoice) —
    see that helper's docstring for the live-reproduced overpayment this
    closes.
    """
    if _check_moderate_rate_limit('mark_paid', request.user):
        return _too_many_requests('Too many actions. Please try again later.')

    with transaction.atomic():
        invoice = _get_locked_invoice(pk, request.user)
        if invoice.status in ('cancelled', 'bad_debt', 'refunded', 'draft'):
            return Response({'error': f'Cannot mark a {invoice.status} invoice as paid.'}, status=status.HTTP_400_BAD_REQUEST)

        outstanding = invoice.outstanding_amount
        if outstanding <= Decimal('0'):
            return Response({'error': 'This invoice has no outstanding balance.'}, status=status.HTTP_400_BAD_REQUEST)

        payload = {
            'amount': str(outstanding),
            'currency': invoice.currency,
            'source': request.data.get('source', 'other'),
            'payment_date': request.data.get('payment_date') or timezone.now().date().isoformat(),
            'notes': request.data.get('notes', ''),
        }
        serializer = InvoicePartialPaymentSerializer(data=payload, context={'request': request, 'invoice': invoice})
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        serializer.save(invoice=invoice, rate_to_usd=_lookup_rate_to_usd(invoice.currency))

        invoice.update_paid_status()
        invoice.refresh_from_db()

    emit('InvoicePaid', invoice_id=str(invoice.pk), user_id=str(request.user.pk))
    logger.info('[INVOICES] Marked invoice %s as paid.', invoice.invoice_number)
    return Response(InvoiceListSerializer(invoice).data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def invoice_add_payment(request, pk):
    """
    Records a partial payment and recomputes status via update_paid_status().

    Audit fix (finding INV-003/DB-002 — the audit's primary CRITICAL
    finding): the whole read-check-write sequence now runs under a locked
    invoice row (_get_locked_invoice). Before this fix, 3 concurrent $700
    requests against a real $1000 invoice each independently validated
    against the SAME stale $1000 outstanding_amount and all 3 committed —
    amount_paid ended up at $2100 with no error anywhere (see invoice
    c6559f99-48b1-45e8-a562-76ab950f6500 / INV-2026-0031, left in the
    database as historical evidence). Locking the row means a second
    concurrent request now blocks until the first commits, then validates
    against the invoice's real, post-first-payment outstanding_amount —
    so a second $700 request against the same $1000 invoice is correctly
    rejected once the first has already been recorded, regardless of how
    many requests arrive at once.
    """
    if _check_moderate_rate_limit('add_payment', request.user):
        return _too_many_requests('Too many actions. Please try again later.')

    with transaction.atomic():
        invoice = _get_locked_invoice(pk, request.user)
        if invoice.status in ('cancelled', 'bad_debt', 'refunded', 'draft'):
            return Response({'error': f'Cannot record a payment on a {invoice.status} invoice.'}, status=status.HTTP_400_BAD_REQUEST)

        serializer = InvoicePartialPaymentSerializer(data=request.data, context={'request': request, 'invoice': invoice})
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        # 'currency' is omitted from validated_data entirely (not defaulted
        # to 'USD') when the request doesn't supply it — DRF only injects a
        # serializer-field default when one is explicitly declared, which
        # this field isn't (it relies on the MODEL's own default=). Falls
        # back to the same 'USD' the model itself would use on save().
        payment_currency = serializer.validated_data.get('currency', 'USD')
        payment = serializer.save(invoice=invoice, rate_to_usd=_lookup_rate_to_usd(payment_currency))
        invoice.update_paid_status()
        invoice.refresh_from_db()

    event_name = 'InvoicePaid' if invoice.status == 'paid' else 'InvoicePartiallyPaid'
    emit(event_name, invoice_id=str(invoice.pk), user_id=str(request.user.pk), amount=str(payment.amount))
    logger.info('[INVOICES] Recorded a %s %s payment on invoice %s.', payment.amount, payment.currency, invoice.invoice_number)
    return Response(InvoiceListSerializer(invoice).data, status=status.HTTP_201_CREATED)


@api_view(['DELETE'])
@permission_classes([IsAuthenticated])
def invoice_undo_payment(request, pk):
    """
    Removes exactly the most recently RECORDED InvoicePartialPayment (by
    recorded_at, not payment_date — undo reverses the last action taken,
    not whichever payment has the latest backdated payment_date), then
    recomputes via update_paid_status().

    >7 days is this endpoint's own judgment call for "old" (see
    UNDO_CONFIRMATION_AGE_DAYS and DECISIONS.md — the spec didn't pin a
    number). An old entry requires confirmed_old: true in the body, else
    400 with requires_confirmation so the frontend knows to re-prompt.
    Confirmation-strictness scaling by age is Step 6's concern, not this
    endpoint's.

    Audit fix (LANCERAOS_CLIENTS_INVOICES_PRODUCTION_AUDIT.md, 19 August
    2026, finding INV-009/FE-001): this endpoint used to have NO status
    guard at all — unlike invoice_add_payment/invoice_mark_paid, which
    both correctly reject cancelled/bad_debt/refunded/draft.
    update_paid_status()'s own status-preservation branches protect the
    `status` FIELD on those three terminal statuses, but always
    unconditionally recompute amount_paid from a fresh SUM() over
    whatever payment rows remain — so undo on a refunded invoice deleted
    a real payment row and reset amount_paid to $0 while leaving
    status='refunded' and refunded_amount untouched, live-reproduced on
    invoice 76472345-cdb5-4800-a2f0-6cc8ba1547e8 / INV-2026-0025 (left in
    the database as historical evidence: status=refunded, amount_paid=0,
    refunded_amount=300, outstanding_amount=900 — an invoice that is
    simultaneously "refunded" and "owes its full balance again"). The
    guard below matches invoice_add_payment/invoice_mark_paid's own list
    exactly, closing the identical gap for cancelled/bad_debt too, not
    just the refunded case the audit's live reproduction happened to hit.
    Also now runs under a locked invoice row (_get_locked_invoice), so a
    concurrent undo can't race a concurrent add-payment/mark-paid on the
    same invoice either.
    """
    if _check_moderate_rate_limit('undo_payment', request.user):
        return _too_many_requests('Too many actions. Please try again later.')

    with transaction.atomic():
        invoice = _get_locked_invoice(pk, request.user)
        if invoice.status in ('cancelled', 'bad_debt', 'refunded', 'draft'):
            return Response(
                {'error': f'Cannot undo a payment on a {invoice.status} invoice.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        last_payment = invoice.partial_payments.order_by('-recorded_at').first()
        if last_payment is None:
            return Response({'error': 'This invoice has no payments to undo.'}, status=status.HTTP_400_BAD_REQUEST)

        age = timezone.now() - last_payment.recorded_at
        if age > timedelta(days=UNDO_CONFIRMATION_AGE_DAYS) and not request.data.get('confirmed_old'):
            return Response(
                {
                    'error': f'This payment was recorded more than {UNDO_CONFIRMATION_AGE_DAYS} days ago. '
                             'Confirm to undo it anyway.',
                    'requires_confirmation': True,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        last_payment.delete()
        invoice.update_paid_status()
        invoice.refresh_from_db()

    logger.info('[INVOICES] Undid the most recent payment on invoice %s.', invoice.invoice_number)
    return Response(InvoiceListSerializer(invoice).data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def invoice_cancel(request, pk):
    """
    status=cancelled. Only permitted from sent/viewed/partially_paid
    ("Sent-or-beyond" per the spec's deletion/editing scope table) — not
    draft/created (delete instead) and not paid (refund instead, a
    materially different real-world action). Existing
    InvoicePartialPayment rows are preserved untouched, per the dashboard
    rules — a cancelled invoice's payment history isn't erased, just
    excluded from active totals going forward.

    Audit fix (finding INV-003/DB-002): locked (_get_locked_invoice) so
    this can't lost-update against a concurrent payment reaching 'paid'
    (or another concurrent cancel/refund/bad-debt) on the same invoice —
    the status check below now reads genuinely current data, not a
    snapshot taken before some other request's write.
    """
    if _check_moderate_rate_limit('cancel', request.user):
        return _too_many_requests('Too many actions. Please try again later.')

    with transaction.atomic():
        invoice = _get_locked_invoice(pk, request.user)
        if invoice.status not in ACTIVE_STATUSES:
            return Response(
                {'error': 'Only sent, viewed, or partially paid invoices can be cancelled.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        invoice.status = 'cancelled'
        invoice.save(update_fields=['status', 'updated_at'])

    emit('InvoiceCancelled', invoice_id=str(invoice.pk), user_id=str(request.user.pk))
    logger.info('[INVOICES] Cancelled invoice %s.', invoice.invoice_number)
    return Response(InvoiceListSerializer(invoice).data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def invoice_refund(request, pk):
    """
    amount required, supports partial (an amount up to, not necessarily
    equal to, amount_paid), sets status=refunded and persists the amount
    to refunded_amount (added in the Step 5 review — this field didn't
    exist when this view was first written, so the amount previously had
    nowhere to go except an emitted event's payload).

    Refund is a one-shot, terminal transition, deliberately — once
    status is 'refunded', a second refund call on the same invoice is
    rejected with a clear, explicit message rather than silently falling
    through to the generic "only paid/partially_paid" rejection (which
    would technically also catch it, but without saying why). The
    alternative — accumulating multiple partial refunds while the
    invoice stays paid/partially_paid, only becoming 'refunded' once the
    accumulated amount reaches amount_paid — is a materially bigger
    feature than what was actually asked for (a single call that sets
    status=refunded) and wasn't requested here either; rejecting repeats
    matches how invoice_cancel/invoice_mark_bad_debt already behave (also
    one-shot terminal transitions with no "call again" concept). See
    DECISIONS.md.

    Audit fix (finding INV-003/DB-002): locked (_get_locked_invoice) —
    the one-shot "already refunded" guard and the amount<=amount_paid
    check both now read genuinely current, post-any-concurrent-write
    data, not a pre-lock snapshot.
    """
    if _check_moderate_rate_limit('refund', request.user):
        return _too_many_requests('Too many actions. Please try again later.')

    with transaction.atomic():
        invoice = _get_locked_invoice(pk, request.user)
        if invoice.status == 'refunded':
            return Response({'error': 'This invoice has already been refunded.'}, status=status.HTTP_400_BAD_REQUEST)
        if invoice.status not in ('paid', 'partially_paid'):
            return Response({'error': 'Only paid or partially paid invoices can be refunded.'}, status=status.HTTP_400_BAD_REQUEST)

        amount_raw = request.data.get('amount')
        if amount_raw is None:
            return Response({'error': 'amount is required.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            amount = Decimal(str(amount_raw))
        except InvalidOperation:
            return Response({'error': 'amount must be a valid number.'}, status=status.HTTP_400_BAD_REQUEST)
        if amount <= Decimal('0') or amount > invoice.amount_paid:
            return Response(
                {'error': f'amount must be greater than 0 and no more than the amount already paid ({invoice.amount_paid}).'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        invoice.status = 'refunded'
        invoice.refunded_amount = amount
        invoice.save(update_fields=['status', 'refunded_amount', 'updated_at'])

    emit('InvoiceRefunded', invoice_id=str(invoice.pk), user_id=str(request.user.pk), amount=str(amount))
    logger.info('[INVOICES] Refunded %s on invoice %s.', amount, invoice.invoice_number)
    return Response(InvoiceListSerializer(invoice).data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def invoice_mark_bad_debt(request, pk):
    """
    Manual only, per Step 4's confirmed decision. Same eligibility as
    invoice_cancel.

    Audit fix (finding INV-003/DB-002): locked (_get_locked_invoice), same
    reasoning as invoice_cancel above.
    """
    if _check_moderate_rate_limit('bad_debt', request.user):
        return _too_many_requests('Too many actions. Please try again later.')

    with transaction.atomic():
        invoice = _get_locked_invoice(pk, request.user)
        if invoice.status not in ACTIVE_STATUSES:
            return Response(
                {'error': 'Only sent, viewed, or partially paid invoices can be marked bad debt.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        invoice.status = 'bad_debt'
        invoice.save(update_fields=['status', 'updated_at'])

    emit('InvoiceMarkedBadDebt', invoice_id=str(invoice.pk), user_id=str(request.user.pk))
    logger.info('[INVOICES] Marked invoice %s as bad debt.', invoice.invoice_number)
    return Response(InvoiceListSerializer(invoice).data)


def _duplicate_invoice_core(original, **overrides):
    """
    The shared duplication mechanism — extracted this pass (Step 16) so
    generate_recurring_invoices (tasks.py) can reuse the exact same
    content-copy logic invoice_duplicate has always used, rather than a
    second, parallel implementation. `overrides` lets a caller override
    or add any field on top of the copied defaults (Step 16 passes
    parent_invoice/design/issue_date/due_date/is_recurring=False/etc.;
    invoice_duplicate itself passes none, preserving its exact
    pre-existing behavior).

    Resets pdf_url/pdf_generated_at/view_token/invoice_number/
    sent_via_platform/status per Step 4's model docstring — a duplicate
    (plain or series-generated) hasn't been sent yet in its own right.
    NOT copied — explicitly reset: status (defaults to 'draft'),
    invoice_number (defaults to None), view_token (fresh, via save()),
    pdf_url/pdf_generated_at/finalised_at (blank/None), sent_via_platform
    (False), amount_paid (0), client_acknowledged/_at (False/None).
    """
    defaults = dict(
        user=original.user,
        client=original.client,
        client_name=original.client_name, client_email=original.client_email,
        client_company=original.client_company, client_address=original.client_address,
        client_phone=original.client_phone,
        currency=original.currency,
        subtotal=original.subtotal, tax_rate=original.tax_rate, tax_amount=original.tax_amount,
        discount_amount=original.discount_amount, total=original.total,
        due_date=original.due_date,
        notes=original.notes, terms=original.terms,
        reminders_enabled=original.reminders_enabled,
        late_fee_enabled=original.late_fee_enabled, late_fee_rate=original.late_fee_rate,
        is_recurring=original.is_recurring, recurring_interval_days=original.recurring_interval_days,
        recurring_auto_send=original.recurring_auto_send,
        is_one_time_client=original.is_one_time_client,
        design=original.design,
    )
    defaults.update(overrides)

    new_invoice = Invoice.objects.create(**defaults)
    for item in original.items.all():
        InvoiceItem.objects.create(
            invoice=new_invoice, description=item.description,
            quantity=item.quantity, unit_price=item.unit_price, sort_order=item.sort_order,
        )
    return new_invoice


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def invoice_duplicate(request, pk):
    """New draft copy. Resets pdf_url/pdf_generated_at/view_token/invoice_number/sent_via_platform/status per Step 4's model docstring — a duplicate hasn't been sent yet in its own right."""
    if _check_moderate_rate_limit('duplicate', request.user):
        return _too_many_requests('Too many actions. Please try again later.')

    original = get_object_or_404(Invoice, pk=pk, user=request.user)
    new_invoice = _duplicate_invoice_core(original)

    emit('InvoiceCreated', invoice_id=str(new_invoice.pk), user_id=str(request.user.pk), duplicated_from=str(original.pk))
    logger.info('[INVOICES] Duplicated invoice %s into new draft %s.', original.invoice_number, new_invoice.pk)
    return Response(InvoiceListSerializer(new_invoice).data, status=status.HTTP_201_CREATED)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def invoice_toggle_reminders(request, pk):
    if _check_moderate_rate_limit('toggle_reminders', request.user):
        return _too_many_requests('Too many actions. Please try again later.')

    invoice = get_object_or_404(Invoice, pk=pk, user=request.user)
    invoice.reminders_enabled = not invoice.reminders_enabled
    invoice.save(update_fields=['reminders_enabled', 'updated_at'])
    logger.info('[INVOICES] Reminders %s for invoice %s.', 'enabled' if invoice.reminders_enabled else 'disabled', invoice.invoice_number)
    return Response(InvoiceListSerializer(invoice).data)


# _REMINDER_TEMPLATE_BY_NUMBER: reminder_number -> template key, derived
# from tasks.REMINDER_SCHEDULE's own (min_days, reminder_number,
# template_key) tuples rather than a second, hand-copied mapping.
_REMINDER_TEMPLATE_BY_NUMBER = {number: template for _, number, template in REMINDER_SCHEDULE}


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def invoice_send_reminder(request, pk):
    """
    On-demand manual reminder sending (bug-hardening round — InvoiceDetail
    Panel's "Send Reminder N" footer action for an overdue, still-active
    invoice). Reuses apps.invoices.tasks._send_reminder — the exact same
    function the scheduled day-3/7/14/30 task (send_invoice_reminders)
    calls — so both paths write the identical InvoiceReminder record
    type; there is no manual-vs-automatic distinction anywhere in the
    data model, and the scheduled task's own "already sent" check
    correctly sees a manually-sent number and never double-sends it.

    Targets the NEXT ungenerated reminder number — 1 if none sent yet, 2
    if 1 has been sent, etc. — derived from the real max InvoiceReminder.
    reminder_number already recorded for this invoice (not from
    Invoice.reminder_count; both stay in sync since reminders are always
    sent in strictly ascending order on both paths, but the real row
    count is the authoritative source). Rejects once all 4 have been
    sent — nothing left to send.

    Deliberately does NOT require reminders_enabled or sent_via_platform
    — those gate the AUTOMATIC schedule only (see their own field
    help_text), not a freelancer's own deliberate manual action, the
    same relationship invoice_mark_sent/invoice_send already have to
    each other. Scoped to ACTIVE_STATUSES (sent/viewed/partially_paid)
    and genuinely overdue (days_overdue > 0) — mirrors exactly when the
    frontend footer button itself is shown, so it's never reachable
    somewhere it would just 400.
    """
    if _check_moderate_rate_limit('send_reminder', request.user):
        return _too_many_requests('Too many actions. Please try again later.')

    invoice = get_object_or_404(Invoice, pk=pk, user=request.user)
    if invoice.status not in ACTIVE_STATUSES:
        return Response(
            {'error': 'Reminders can only be sent for sent, viewed, or partially paid invoices.'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if invoice.days_overdue <= 0:
        return Response({'error': 'This invoice is not overdue yet.'}, status=status.HTTP_400_BAD_REQUEST)

    last_sent = InvoiceReminder.objects.filter(invoice=invoice).aggregate(Max('reminder_number'))['reminder_number__max'] or 0
    next_number = last_sent + 1
    if next_number > 4:
        return Response({'error': 'All 4 reminders have already been sent for this invoice.'}, status=status.HTTP_400_BAD_REQUEST)

    _send_reminder(invoice, next_number, _REMINDER_TEMPLATE_BY_NUMBER[next_number])
    invoice.refresh_from_db()

    logger.info('[INVOICES] Reminder %s sent manually for %s.', next_number, invoice.invoice_number)
    return Response(InvoiceListSerializer(invoice).data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def invoice_resend(request, pk):
    """
    Re-sends the invoice's CURRENT stored PDF via email again (bug-
    hardening round — InvoiceDetailPanel's "Resend Invoice" More-menu
    action) — a real, distinct action from the one-time /send/ (invoice_
    send, only reachable from status='created', which transitions the
    invoice forward). This never touches invoice.status/sent_via_platform/
    sent_at at all — callable repeatedly, unlike the one-time send —
    reusing the exact same pdf-fetch + email-build + send chain
    _send_invoice_now uses (fetch_invoice_pdf_bytes, build_invoice_send_
    email, send_invoice_related_email) rather than a second, parallel
    implementation of "email this invoice."

    Scoped to sent/viewed/partially_paid (ACTIVE_STATUSES) — nothing
    useful to resend once resolved (paid/cancelled/refunded/bad_debt).
    The spec didn't pin this exact boundary; this is this step's own
    scoping call, recorded in DECISIONS.md.
    """
    if not request.data.get('confirm'):
        return Response({'error': 'confirm: true is required to resend this invoice.'}, status=status.HTTP_400_BAD_REQUEST)

    if _check_moderate_rate_limit('resend', request.user):
        return _too_many_requests('Too many actions. Please try again later.')

    invoice = get_object_or_404(Invoice, pk=pk, user=request.user)
    if invoice.status not in ACTIVE_STATUSES:
        return Response(
            {'error': 'Only sent, viewed, or partially paid invoices can be resent.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    pdf_bytes = fetch_invoice_pdf_bytes(invoice)
    if pdf_bytes is None:
        return Response(
            {'error': "Could not retrieve or regenerate this invoice's PDF. It has not been resent — please try again."},
            status=status.HTTP_502_BAD_GATEWAY,
        )

    subject, html_body, plain_body = build_invoice_send_email(invoice)
    result = send_invoice_related_email(
        invoice, subject, html_body, plain_body,
        pdf_bytes=pdf_bytes, request_id=getattr(request, 'request_id', None),
    )
    if not result['sent']:
        detail = result['error'] or 'the email provider rejected the request'
        return Response({'error': f'Could not resend this invoice: {detail}.'}, status=status.HTTP_502_BAD_GATEWAY)

    emit('InvoiceResent', invoice_id=str(invoice.pk), user_id=str(request.user.pk))
    logger.info(
        '[INVOICES] Resent invoice %s to %s via %s%s.',
        invoice.invoice_number, invoice.client_email, result['sent_via'],
        ' (fallback from custom SMTP)' if result['fallback_used'] else '',
    )
    return Response(InvoiceListSerializer(invoice).data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def invoice_pause_recurring(request, pk):
    """Not explicitly in the spec's endpoint list, which only names pause-recurring — invoice_resume_recurring added alongside it since pause implies a way back; documented in DECISIONS.md."""
    if _check_moderate_rate_limit('pause_recurring', request.user):
        return _too_many_requests('Too many actions. Please try again later.')

    invoice = get_object_or_404(Invoice, pk=pk, user=request.user)
    if not invoice.is_recurring:
        return Response({'error': 'This invoice is not a recurring invoice.'}, status=status.HTTP_400_BAD_REQUEST)

    invoice.recurring_paused = True
    invoice.save(update_fields=['recurring_paused', 'updated_at'])
    return Response(InvoiceListSerializer(invoice).data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def invoice_resume_recurring(request, pk):
    if _check_moderate_rate_limit('resume_recurring', request.user):
        return _too_many_requests('Too many actions. Please try again later.')

    invoice = get_object_or_404(Invoice, pk=pk, user=request.user)
    if not invoice.is_recurring:
        return Response({'error': 'This invoice is not a recurring invoice.'}, status=status.HTTP_400_BAD_REQUEST)

    invoice.recurring_paused = False
    invoice.save(update_fields=['recurring_paused', 'updated_at'])
    return Response(InvoiceListSerializer(invoice).data)


# ══════════════════════════════════════════════════════════════════
# ESCALATION + FORMAL NOTICE — Step 17
# ══════════════════════════════════════════════════════════════════

@api_view(['POST'])
@permission_classes([IsAuthenticated])
def invoice_dismiss_escalation(request, pk):
    """
    Clears escalation_required's prompt without the freelancer taking
    further action — sets escalation_dismissed=True, leaves
    escalation_required itself untouched (it's the historical record of
    "this invoice did cross the day-30 threshold at some point"; only
    the UI PROMPT is dismissed, not that fact). Idempotent — dismissing
    an already-dismissed escalation just returns the current state, no
    error, same "a client clicking twice shouldn't see a failure"
    reasoning Step 15's acknowledge endpoint uses.
    """
    if _check_moderate_rate_limit('dismiss_escalation', request.user):
        return _too_many_requests('Too many actions. Please try again later.')

    invoice = get_object_or_404(Invoice, pk=pk, user=request.user)
    if not invoice.escalation_required:
        return Response({'error': 'This invoice has no escalation to dismiss.'}, status=status.HTTP_400_BAD_REQUEST)

    if not invoice.escalation_dismissed:
        invoice.escalation_dismissed = True
        invoice.save(update_fields=['escalation_dismissed', 'updated_at'])
        logger.info('[INVOICES] Escalation dismissed for invoice %s.', invoice.invoice_number)
    return Response(InvoiceListSerializer(invoice).data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def invoice_send_formal_notice(request, pk):
    """
    Manual-only, never automatic — the freelancer's own deliberate
    action, gated behind the SAME severity threshold the escalation
    prompt itself uses (escalation_required, regardless of whether it
    was later dismissed — dismissing the PROMPT doesn't mean the
    invoice stopped being severely overdue) OR status='bad_debt'.
    Requires confirm:true given the seriousness, matching every other
    action in this app that has real, hard-to-undo real-world
    consequences (send/mark-sent/refund).

    Requires FreelancerProfile.formal_notice_enabled — a real, enforced
    server-side check, not just a UI hide, per the decisions doc's
    "every email type must be mutable" rule. formal_notice_sent_at is
    set on success but never blocks a second, deliberate send — it only
    surfaces, in the response, that one already went out (the frontend
    uses this to show a warning before the freelancer confirms again,
    not to prevent the action).
    """
    if not request.data.get('confirm'):
        return Response({'error': 'confirm: true is required to send a formal notice.'}, status=status.HTTP_400_BAD_REQUEST)

    if _check_moderate_rate_limit('send_formal_notice', request.user):
        return _too_many_requests('Too many actions. Please try again later.')

    invoice = get_object_or_404(Invoice, pk=pk, user=request.user)

    try:
        formal_notice_enabled = invoice.user.profile.formal_notice_enabled
    except Exception:
        formal_notice_enabled = True
    if not formal_notice_enabled:
        return Response(
            {'error': 'Formal Notice is disabled in your Settings. Enable it under Invoicing Defaults to use this.'},
            status=status.HTTP_403_FORBIDDEN,
        )

    if not (invoice.escalation_required or invoice.status == 'bad_debt'):
        return Response(
            {'error': 'A formal notice can only be sent once an invoice has escalated (severely overdue) or is marked bad debt.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    subject, html_body, plain_body = build_formal_notice_email(invoice)
    result = send_invoice_related_email(invoice, subject, html_body, plain_body)
    if not result['sent']:
        detail = result['error'] or 'the email provider rejected the request'
        return Response({'error': f'Could not send the formal notice: {detail}.'}, status=status.HTTP_502_BAD_GATEWAY)

    invoice.formal_notice_sent_at = timezone.now()
    invoice.save(update_fields=['formal_notice_sent_at', 'updated_at'])

    emit('FormalNoticeSent', invoice_id=str(invoice.pk), user_id=str(request.user.pk))
    logger.info('[INVOICES] Formal notice sent for invoice %s.', invoice.invoice_number)
    return Response(InvoiceListSerializer(invoice).data)


# ══════════════════════════════════════════════════════════════════
# TIMELINE
# ══════════════════════════════════════════════════════════════════

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def invoice_timeline(request, pk):
    """
    Unified activity feed. Previously only surfaced InvoiceViewEvent/
    InvoiceReminder/InvoicePartialPayment rows — real lifecycle moments
    (created/finalised/sent) were invisible even though the invoice itself
    already carries the real timestamps for them (created_at/
    finalised_at/sent_at). No dedicated status-change-history model exists
    (individual transitions beyond these three aren't itemized — only
    inferable from current status), but these three needed no new model
    at all, just reading fields that were already there. Comments
    (Step 13) and claims (Step 14) will extend this feed additively —
    same response shape, new `type` values — once those models have real
    rows; zero change needed here when that happens.
    """
    invoice = get_object_or_404(Invoice, pk=pk, user=request.user)

    entries = [{'type': 'created', 'timestamp': invoice.created_at.isoformat()}]
    if invoice.finalised_at:
        entries.append({'type': 'finalised', 'timestamp': invoice.finalised_at.isoformat(), 'invoice_number': invoice.invoice_number})
    if invoice.sent_at:
        entries.append({
            'type': 'sent', 'timestamp': invoice.sent_at.isoformat(),
            'via': 'platform' if invoice.sent_via_platform else 'manual',
        })
    for event in invoice.view_events.all():
        entries.append({
            'type': 'view', 'timestamp': event.viewed_at.isoformat(),
            'source': event.source, 'ip_address': event.ip_address,
        })
    for reminder in invoice.reminders.all():
        entries.append({
            'type': 'reminder', 'timestamp': reminder.sent_at.isoformat(),
            'reminder_number': reminder.reminder_number, 'template_used': reminder.template_used,
            'delivered': reminder.delivered,
        })
    for payment in invoice.partial_payments.all():
        entries.append({
            'type': 'payment', 'timestamp': payment.recorded_at.isoformat(),
            'amount': str(payment.amount), 'currency': payment.currency, 'source': payment.source,
        })
    for comment in invoice.comments.all():
        entries.append({
            'type': 'comment', 'timestamp': comment.created_at.isoformat(),
            'author_type': comment.author_type, 'source': comment.source,
        })
    for claim in invoice.payment_claims.all():
        entries.append({
            'type': 'claim', 'timestamp': claim.submitted_at.isoformat(),
            'status': claim.status, 'amount': str(claim.amount_claimed), 'currency': claim.currency,
        })
    if invoice.client_acknowledged_at:
        entries.append({'type': 'acknowledged', 'timestamp': invoice.client_acknowledged_at.isoformat()})
    if invoice.escalation_required:
        # No dedicated timestamp field exists for escalation itself (see
        # DECISIONS.md — a new column was deliberately not added since
        # this moment is already fully reconstructable): escalation is
        # set at the exact same instant the day-30 (reminder_number=4)
        # InvoiceReminder row is created, so that row's own sent_at IS
        # the real escalation timestamp. Omitted entirely if that
        # reminder row is somehow missing (defensive — should not happen
        # given both are written together in the same task run).
        escalation_reminder = invoice.reminders.filter(reminder_number=4).first()
        if escalation_reminder:
            entries.append({
                'type': 'escalation', 'timestamp': escalation_reminder.sent_at.isoformat(),
                'dismissed': invoice.escalation_dismissed,
            })
    if invoice.formal_notice_sent_at:
        entries.append({'type': 'formal_notice', 'timestamp': invoice.formal_notice_sent_at.isoformat()})

    entries.sort(key=lambda e: e['timestamp'])
    return Response({'results': entries})


# ══════════════════════════════════════════════════════════════════
# COMMENTS — Step 13. Freelancer side (portal side: views_portal.py)
# ══════════════════════════════════════════════════════════════════

@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def invoice_comments(request, pk):
    """
    The freelancer's own side of the unified two-way thread
    (apps/invoices/views_portal.py's portal_invoice_comments is the
    client's side of the exact same InvoiceComment rows).

    GET marks every currently-unread, CLIENT-authored comment as read
    (read_by_freelancer_at) as a side effect of fetching the list — no
    separate mark-read endpoint, since reading the list genuinely can
    double as the read action (checked directly against
    InvoiceComment's own field shape before deciding, per this step's
    own instruction). Never touches read_by_freelancer_at on the
    freelancer's OWN comments — that field only has meaning for
    comments they didn't write themselves.

    POST creates a real, permanent InvoiceComment (author_type='freelancer',
    author_user=request.user, source='app') and broadcasts it to the
    invoice's WebSocket thread group. No edit/delete endpoint exists
    anywhere for this model, by design — comments are immutable, per
    InvoiceComment's own docstring ("no editing or deleting comments,
    ever... consistent with the platform's whole trust/audit posture").
    """
    invoice = get_object_or_404(Invoice, pk=pk, user=request.user)

    if request.method == 'GET':
        # ids captured BEFORE the update, not re-derived afterward — so
        # broadcast_read_state (item 3 of the 16 August 2026 second
        # verification pass) reports exactly the rows this request
        # actually just marked read, never a stale/racy re-query.
        newly_read_ids = list(InvoiceComment.objects.filter(
            invoice=invoice, author_type='client', read_by_freelancer_at__isnull=True,
        ).values_list('id', flat=True))
        if newly_read_ids:
            InvoiceComment.objects.filter(id__in=newly_read_ids).update(read_by_freelancer_at=timezone.now())
            broadcast_read_state(invoice, 'read_by_freelancer_at', newly_read_ids)
        comments = invoice.comments.all()
        return Response(InvoiceCommentSerializer(comments, many=True).data)

    if _check_moderate_rate_limit('post_comment', request.user):
        return _too_many_requests('Too many comments posted. Please try again later.')

    attachment_url = ''
    file = request.FILES.get('attachment')
    if file:
        result = upload_comment_attachment(file)
        if isinstance(result, Response):
            return result
        attachment_url = result

    serializer = CommentCreateSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    comment = serializer.save(
        invoice=invoice, author_type='freelancer', author_user=request.user,
        source='app', attachment_url=attachment_url,
    )
    broadcast_comment(comment)
    emit('CommentPosted', invoice_id=str(invoice.pk), user_id=str(request.user.pk), comment_id=str(comment.pk), author_type='freelancer')
    logger.info('[INVOICES] Comment posted by freelancer on invoice %s.', invoice.invoice_number)
    return Response(InvoiceCommentSerializer(comment).data, status=status.HTTP_201_CREATED)


# ══════════════════════════════════════════════════════════════════
# PAYMENT CLAIMS — Step 14. Freelancer side (portal submission side:
# views_portal.py's portal_invoice_claims).
# ══════════════════════════════════════════════════════════════════

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def invoice_claims(request, pk):
    """List every PaymentClaim submitted against this invoice, newest first (PaymentClaim.Meta.ordering)."""
    invoice = get_object_or_404(Invoice, pk=pk, user=request.user)
    return Response(PaymentClaimSerializer(invoice.payment_claims.all(), many=True).data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def invoice_claim_confirm(request, pk, claim_id):
    """
    Confirms a pending claim: creates a real InvoicePartialPayment for
    amount_claimed (the SAME InvoicePartialPaymentSerializer +
    update_paid_status() path invoice_add_payment/invoice_mark_paid
    already use — not a second, parallel payment-recording
    implementation) and marks the claim confirmed. If amount_claimed no
    longer fits the invoice's current outstanding balance (e.g. another
    payment was recorded in the meantime), the same serializer validation
    invoice_add_payment relies on rejects it here too, with the same
    real error message — a freelancer confirming a stale claim gets a
    real 400, not a silently wrong payment record.

    Requires confirm:true, matching this module's established pattern
    for every action that touches amount_paid (mark_paid, add_payment).

    Audit fix (finding INV-003/DB-002): the invoice row is now locked
    (_get_locked_invoice) for the same reason as invoice_add_payment —
    this endpoint reuses that exact payment-recording path, so it
    inherited the identical overpayment-race exposure. The claim row is
    ALSO locked here (select_for_update, scoped to this same atomic
    block) — a claim has no independent "invoice" concept that the shared
    helper covers, but re-checking claim.status == 'pending' against a
    locked row closes the sibling race the audit named as "same code
    path, not separately live-verified": two concurrent confirms for the
    SAME claim_id could otherwise both read status='pending' before
    either wrote, and both create a real InvoicePartialPayment for one
    claim.
    """
    if _check_moderate_rate_limit('claim_confirm', request.user):
        return _too_many_requests('Too many actions. Please try again later.')

    if not request.data.get('confirm'):
        return Response({'error': 'confirm: true is required to confirm this claim.'}, status=status.HTTP_400_BAD_REQUEST)

    with transaction.atomic():
        invoice = _get_locked_invoice(pk, request.user)
        claim = get_object_or_404(PaymentClaim.objects.select_for_update(), pk=claim_id, invoice=invoice)
        if claim.status != 'pending':
            return Response({'error': f'This claim has already been {claim.status}.'}, status=status.HTTP_400_BAD_REQUEST)

        payload = {
            'amount': str(claim.amount_claimed),
            'currency': claim.currency,
            'source': claim.payment_source,
            'payment_date': claim.payment_date.isoformat(),
            'notes': f'Confirmed from client payment claim (submitted {claim.submitted_at.date().isoformat()}).',
        }
        serializer = InvoicePartialPaymentSerializer(data=payload, context={'request': request, 'invoice': invoice})
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        serializer.save(invoice=invoice, rate_to_usd=_lookup_rate_to_usd(claim.currency))

        invoice.update_paid_status()
        invoice.refresh_from_db()

        claim.status = 'confirmed'
        claim.reviewed_at = timezone.now()
        claim.review_note = request.data.get('review_note', '')
        claim.save(update_fields=['status', 'reviewed_at', 'review_note'])

    emit('PaymentClaimConfirmed', invoice_id=str(invoice.pk), user_id=str(request.user.pk), claim_id=str(claim.pk))
    logger.info('[INVOICES] Payment claim %s confirmed on invoice %s.', claim.pk, invoice.invoice_number)
    return Response({'invoice': InvoiceListSerializer(invoice).data, 'claim': PaymentClaimSerializer(claim).data})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def invoice_claim_reject(request, pk, claim_id):
    """
    Rejects a pending claim with zero financial effect — no
    InvoicePartialPayment is ever created. Requires a real reason
    (review_note), so a rejected claim carries a record of why, not just
    a bare status flip. Requires confirm:true, same as confirm above.
    """
    if _check_moderate_rate_limit('claim_reject', request.user):
        return _too_many_requests('Too many actions. Please try again later.')

    if not request.data.get('confirm'):
        return Response({'error': 'confirm: true is required to reject this claim.'}, status=status.HTTP_400_BAD_REQUEST)

    review_note = (request.data.get('review_note') or '').strip()
    if not review_note:
        return Response({'error': 'A reason is required to reject a claim.'}, status=status.HTTP_400_BAD_REQUEST)

    invoice = get_object_or_404(Invoice, pk=pk, user=request.user)
    claim = get_object_or_404(PaymentClaim, pk=claim_id, invoice=invoice)
    if claim.status != 'pending':
        return Response({'error': f'This claim has already been {claim.status}.'}, status=status.HTTP_400_BAD_REQUEST)

    claim.status = 'rejected'
    claim.reviewed_at = timezone.now()
    claim.review_note = review_note
    claim.save(update_fields=['status', 'reviewed_at', 'review_note'])

    logger.info('[INVOICES] Payment claim %s rejected on invoice %s.', claim.pk, invoice.invoice_number)
    return Response(PaymentClaimSerializer(claim).data)


# ══════════════════════════════════════════════════════════════════
# DASHBOARD KPIs / AGING REPORT / EXCHANGE RATE
# ══════════════════════════════════════════════════════════════════

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def invoice_summary(request):
    """
    Dashboard KPIs: Outstanding / Total Paid / Past-Due Amount.

    REVERSAL (confirmed directly with the founder — see DECISIONS.md):
    Outstanding and Past-Due no longer gate on sent_via_platform at all.
    The earlier Section-6 rule gated both on sent_via_platform=True,
    which meant every KPI read a flat $0 for the overwhelming majority of
    real invoices — anything mark-as-sent'd manually, which is most of
    them, since /send/ (the only thing that ever sets sent_via_platform)
    is one of two parallel "this went out" actions, not the only one.
    sent_via_platform's only two legitimate remaining uses anywhere in
    this app, after this reversal: the status='created' "hasn't been
    sent through LanceraOS" banner, and the timeline's "sent by you" vs
    "sent by LanceraOS" distinction (views.py's own invoice_timeline,
    'via': 'platform' if sent_via_platform else 'manual') — both
    confirmed by a full-module grep, not assumed.

      - Outstanding: sum(total - amount_paid) over invoices with status
        in ACTIVE_STATUSES (sent/viewed/partially_paid), regardless of
        sent_via_platform. Structurally excludes draft/created (never
        delivered by any means) and every terminal status (resolved).
      - Total Paid: unchanged — sum(amount_paid) across ALL invoices
        except draft/created, MINUS sum(refunded_amount) across the same
        set. Cancelled and bad_debt invoices' amount_paid still counts —
        money already received isn't erased by a later status change.
      - Past-Due Amount: the exact same new scope as Outstanding, further
        filtered to due_date in the past — equivalent to
        Invoice.days_overdue > 0 for this specific status set, since none
        of ACTIVE_STATUSES overlap with NON_OVERDUE_STATUSES. This also
        fixes the real, separately-reported bug of a partially-paid,
        overdue invoice going missing from Past-Due — it was never
        excluded by partially_paid status (already in ACTIVE_STATUSES),
        only by the now-removed sent_via_platform gate, and the amount
        counted was always the REMAINING outstanding_amount (total -
        amount_paid), never the invoice's full original total.
      - Draft/Created: excluded from every figure above, unconditionally
        — enforced once, up front, via the shared `qs` queryset every
        figure below is derived from, rather than repeated per-figure.

    Real multi-currency bug fix (also confirmed, previously reported as
    raw Decimal totals summed across mixed currencies — e.g. $64 + Rs.100
    showing as "164"): every figure is now unified into the freelancer's
    own FreelancerProfile.default_currency via _unify_amounts_to_currency
    (core.money.Money + each invoice's own historically-frozen
    rate_to_usd_at_issue), the exact same shared utility
    invoice_analytics's currency breakdown uses — not a second,
    independent implementation. `currency` is returned alongside every
    figure so the frontend can label it correctly; `unconverted_count`
    surfaces (never silently drops) any invoice this couldn't convert.

    List/Table restructure pass — two real additions, both scoped ONLY to
    these 3 KPI cards (never the invoice list below, which has its own
    independent currency filter and no period concept at all — see
    DECISIONS.md):

      - ?period=this_month|last_6_months|this_year|all_time (default
        this_month). Outstanding/Past-Due (displayed as "Overdue" on the
        frontend — label-only rename, this JSON key is unchanged) scope
        to invoice.issue_date within the window: a balance AS IT STANDS
        TODAY, among invoices issued in that window. Collected
        (`total_paid`) scopes to InvoicePartialPayment.payment_date
        instead — money that actually ARRIVED in that window, regardless
        of which period the underlying invoice was issued in. See
        _kpi_period_window/_collected_amount for the exact bounds and
        the real, flagged all_time-vs-windowed refund-netting gap.
      - ?currency=XXX — overrides FreelancerProfile.default_currency for
        this call only (never writes it back); validated the same way
        Client.default_currency already is, via
        apps.clients.serializers.validate_currency_code.

    `total_paid.delta` is a real, separate, ALWAYS-computed month-over-
    month comparison (this calendar month's Collected vs last calendar
    month's, via the same _collected_amount helper) — independent of
    whatever `period` was actually requested. The frontend only renders
    it when period=this_month (the one case where "vs last month" reads
    as coherent next to the displayed figure); it's still computed and
    returned unconditionally rather than gated server-side, since that's
    a display decision, not a data one.
    """
    period = request.query_params.get('period', 'this_month')
    if period not in KPI_PERIOD_CHOICES:
        return Response(
            {'error': f'period must be one of {", ".join(KPI_PERIOD_CHOICES)}.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    currency_param = request.query_params.get('currency')
    if currency_param:
        try:
            target_currency = validate_currency_code(currency_param)
        except DRFValidationError as e:
            return Response({'error': str(e.detail[0]) if isinstance(e.detail, list) else str(e)}, status=status.HTTP_400_BAD_REQUEST)
    else:
        target_currency = request.user.profile.default_currency

    snapshot = _get_latest_snapshot()
    today = timezone.now().date()
    start, end = _kpi_period_window(period, today)

    qs = Invoice.objects.filter(user=request.user).exclude(status__in=('draft', 'created'))

    outstanding_qs = qs.filter(status__in=ACTIVE_STATUSES)
    if start is not None:
        outstanding_qs = outstanding_qs.filter(issue_date__gte=start, issue_date__lte=end)
    outstanding_total, outstanding_unconverted = _unify_amounts_to_currency(
        ((inv.outstanding_amount, inv.currency, inv.rate_to_usd_at_issue) for inv in outstanding_qs),
        target_currency, snapshot,
    )

    past_due_qs = outstanding_qs.filter(due_date__lt=today)
    past_due_total, past_due_unconverted = _unify_amounts_to_currency(
        ((inv.outstanding_amount, inv.currency, inv.rate_to_usd_at_issue) for inv in past_due_qs),
        target_currency, snapshot,
    )

    if period == 'all_time':
        # Exact pre-existing calculation, unchanged — amount_paid is a
        # cumulative field, so "all time" is the one case where it's
        # still the right source (and the only case with a real refund
        # netting, since refunded_amount is itself a cumulative,
        # undated field with no period to scope it into).
        paid_qs = qs.filter(amount_paid__gt=0)
        collected_total, collected_unconverted = _unify_amounts_to_currency(
            ((inv.amount_paid - inv.refunded_amount, inv.currency, inv.rate_to_usd_at_issue) for inv in paid_qs),
            target_currency, snapshot,
        )
        collected_count = paid_qs.count()
    else:
        collected_total, collected_count, collected_unconverted = _collected_amount(
            request.user, start, end, target_currency, snapshot,
        )

    # Delta — always this-calendar-month vs last-calendar-month, via
    # _collected_amount, independent of `period` (see docstring above).
    this_month_start = today.replace(day=1)
    last_month_end = this_month_start - timedelta(days=1)
    last_month_start = last_month_end.replace(day=1)
    current_month_total, _current_count, _current_unconverted = _collected_amount(
        request.user, this_month_start, today, target_currency, snapshot,
    )
    previous_month_total, _previous_count, _previous_unconverted = _collected_amount(
        request.user, last_month_start, last_month_end, target_currency, snapshot,
    )
    pct_change = None
    if previous_month_total > 0:
        pct_change = float((current_month_total - previous_month_total) / previous_month_total * 100)

    return Response({
        'currency': target_currency,
        'period': period,
        'outstanding': {'count': outstanding_qs.count(), 'total': str(outstanding_total), 'unconverted_count': outstanding_unconverted},
        'total_paid': {
            'count': collected_count, 'total': str(collected_total), 'unconverted_count': collected_unconverted,
            'delta': {
                'current': str(current_month_total), 'previous': str(previous_month_total),
                'amount_change': str(current_month_total - previous_month_total), 'pct_change': pct_change,
            },
        },
        'past_due': {'count': past_due_qs.count(), 'total': str(past_due_total), 'unconverted_count': past_due_unconverted},
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def invoice_currencies(request):
    """
    Distinct currencies actually present across the user's invoices — real
    query, populates the invoice LIST's currency filter dropdown (item 5
    of the List/Table restructure). Deliberately distinct from the KPI
    cards' own currency selector (item 3), which offers a fixed
    supported-currency list rather than "whatever's already in use" —
    two different controls for two different purposes, per DECISIONS.md.
    """
    currencies = list(
        Invoice.objects.filter(user=request.user).order_by('currency').values_list('currency', flat=True).distinct()
    )
    return Response({'currencies': currencies})


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def exchange_rate_lookup(request):
    """Latest ExchangeRateSnapshot, or a specific date via ?date=YYYY-MM-DD."""
    date_param = request.query_params.get('date')
    parsed_date, error_response = _parse_date_param(date_param)
    if error_response is not None:
        return error_response

    if parsed_date is not None:
        snapshot = ExchangeRateSnapshot.objects.filter(date=parsed_date).first()
        if snapshot is None:
            return Response(
                {'error': f'No exchange rate snapshot found for {parsed_date.isoformat()}.'},
                status=status.HTTP_404_NOT_FOUND,
            )
    else:
        snapshot = ExchangeRateSnapshot.objects.order_by('-date').first()
        if snapshot is None:
            return Response({'error': 'No exchange rate snapshots exist yet.'}, status=status.HTTP_404_NOT_FOUND)

    return Response({
        'date': snapshot.date.isoformat(),
        'rates_to_usd': snapshot.rates_to_usd,
        'source': snapshot.source,
        'fetched_at': snapshot.fetched_at.isoformat(),
    })


# ══════════════════════════════════════════════════════════════════
# ANALYTICS — Step 18. Distinct from invoice_summary's simple KPI strip
# (real grouping queries, an ORM aggregation for ranking, and a genuine
# currency-unified total — see invoice_analytics' own docstring).
# ══════════════════════════════════════════════════════════════════

def _build_monthly_trend(user, months):
    """
    Real grouping, not a client-side reduction of the full invoice list:
    two separate queries (invoiced vs collected), each fetching only the
    raw fields needed to convert per-row via core.money.Money, then
    bucketed by month in Python — a pure-SQL Sum() can't do the currency
    conversion itself, since rate_to_usd(_at_issue) varies per row.

    "Invoiced": every non-draft invoice (finalised_at is set the moment
    an invoice leaves draft), bucketed by finalised_at's own month,
    converted via each invoice's own FROZEN rate_to_usd_at_issue —
    matching this app's anchor-currency design elsewhere (capture_issue_rate,
    client_currency_conversion): a past month's invoiced total should
    reflect what the rate genuinely was back then, not today's rate.
    Excludes apps.clients.scoring.EXCLUDED_STATUSES ('cancelled',
    'refunded') — reused directly, not redefined, matching Client.payment_stats'
    own "not real business" definition.

    "Collected": every InvoicePartialPayment, bucketed by its own
    payment_date, converted via ITS OWN frozen rate_to_usd (now real —
    see DECISIONS.md for the found-and-fixed gap this relies on).
    Deliberately NOT filtered by the invoice's current status — matches
    invoice_summary's own established rule ("money already received
    isn't erased by a later status change"). Refunds aren't netted out
    month-by-month: refunded_amount is a single field on Invoice, not a
    dated event in this data model, so there's no honest month to
    attribute a refund to — see DECISIONS.md.

    A row with no captured conversion rate is skipped, never guessed —
    an invoice/payment predating this step's rate_to_usd fix, or issued
    before any ExchangeRateSnapshot existed.
    """
    today = timezone.now().date()
    window_start = today.replace(day=1) - relativedelta(months=months - 1)

    buckets = {}
    cursor = window_start
    for _ in range(months):
        key = cursor.strftime('%Y-%m')
        buckets[key] = {'invoiced': Decimal('0'), 'collected': Decimal('0')}
        cursor += relativedelta(months=1)

    invoiced_qs = (
        Invoice.objects.filter(user=user, finalised_at__date__gte=window_start)
        .exclude(status='draft').exclude(status__in=CLIENT_SCORING_EXCLUDED_STATUSES)
        .values('finalised_at', 'total', 'currency', 'rate_to_usd_at_issue')
    )
    for row in invoiced_qs:
        key = row['finalised_at'].strftime('%Y-%m')
        if key not in buckets or row['rate_to_usd_at_issue'] is None:
            continue
        buckets[key]['invoiced'] += Money(row['total'], row['currency'], row['rate_to_usd_at_issue']).to_usd()

    collected_qs = (
        InvoicePartialPayment.objects.filter(invoice__user=user, payment_date__gte=window_start)
        .values('payment_date', 'amount', 'currency', 'rate_to_usd')
    )
    for row in collected_qs:
        key = row['payment_date'].strftime('%Y-%m')
        if key not in buckets or row['rate_to_usd'] is None:
            continue
        buckets[key]['collected'] += Money(row['amount'], row['currency'], row['rate_to_usd']).to_usd()

    return [
        {
            'month': key,
            'invoiced': str(val['invoiced'].quantize(Decimal('0.01'))),
            'collected': str(val['collected'].quantize(Decimal('0.01'))),
        }
        for key, val in sorted(buckets.items())
    ]


def _build_top_clients(user, limit=5):
    """
    Ranked by total amount_paid converted to USD (core.money.Money) —
    genuinely currency-aware, unlike Client.payment_stats' own
    total_paid/total_invoiced (a raw, unconverted sum across whatever
    currencies that client's invoices happen to use — fine for a
    single-client reliability view where currency usually doesn't vary,
    not safe to reuse here where ranking ACROSS clients in mixed
    currencies is the entire point). reliability_score/breakdown IS
    reused directly from Client.payment_stats for each of the top N
    only (never reimplemented) — a real, non-trivial tiered-points
    formula with no reason to exist twice, and cheap here since it's
    only called for a handful of clients, not the whole client list.
    """
    invoices = (
        Invoice.objects.filter(user=user, client__isnull=False)
        .exclude(status='draft').exclude(status__in=CLIENT_SCORING_EXCLUDED_STATUSES)
        .select_related('client')
    )
    totals = {}
    for inv in invoices:
        if inv.rate_to_usd_at_issue is None or inv.amount_paid == 0:
            continue
        usd_paid = Money(inv.amount_paid, inv.currency, inv.rate_to_usd_at_issue).to_usd()
        entry = totals.setdefault(inv.client_id, {'client': inv.client, 'total_paid_usd': Decimal('0')})
        entry['total_paid_usd'] += usd_paid

    ranked = sorted(totals.values(), key=lambda e: e['total_paid_usd'], reverse=True)[:limit]
    results = []
    for entry in ranked:
        client = entry['client']
        stats = client.payment_stats
        results.append({
            'client_id': str(client.pk),
            'name': client.name,
            'total_paid_usd': str(entry['total_paid_usd'].quantize(Decimal('0.01'))),
            'reliability_score': stats['reliability_score'],
        })
    return results


def _build_currency_breakdown(user):
    """
    Per-currency silos (count + native total) AND one real unified total
    in the freelancer's OWN FreelancerProfile.default_currency (Step 18
    originally hardcoded this to USD — a real, confirmed gap: changing
    the setting in Settings had no effect on this figure — fixed here via
    the same _unify_amounts_to_currency utility invoice_summary's KPI
    cards use, not a second, independent conversion). unconverted_count
    is a real, honest signal: invoices excluded from unified_total
    because they have no frozen rate_to_usd_at_issue (never finalised via
    the real flow, or issued before any ExchangeRateSnapshot existed) —
    surfaced rather than silently dropped.
    """
    target_currency = user.profile.default_currency
    snapshot = _get_latest_snapshot()

    invoices = (
        Invoice.objects.filter(user=user)
        .exclude(status='draft').exclude(status__in=CLIENT_SCORING_EXCLUDED_STATUSES)
    )
    by_currency = {
        row['currency']: {'count': row['count'], 'total': str(row['total'])}
        for row in invoices.values('currency').annotate(count=Count('id'), total=Sum('total'))
    }

    unified_total, unconverted_count = _unify_amounts_to_currency(
        ((inv.total, inv.currency, inv.rate_to_usd_at_issue) for inv in invoices.only('total', 'currency', 'rate_to_usd_at_issue')),
        target_currency, snapshot,
    )

    return {
        'by_currency': by_currency,
        'currency': target_currency,
        'unified_total': str(unified_total),
        'unconverted_count': unconverted_count,
    }


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def invoice_analytics(request):
    """
    Cross-invoice analytics dashboard — Step 18. Genuinely distinct from
    invoice_summary above (a simple KPI strip): month-over-month
    invoiced/collected trends via real grouping queries, top clients by
    revenue via a real ORM-driven ranking (reusing Client.payment_stats
    only for the reliability-score half, per that helper's own
    docstring), and a currency breakdown with one real anchor-currency-
    unified USD total via core.money.Money — that value object's first
    real consumer anywhere in this codebase (built in Foundations,
    never actually used until now — see DECISIONS.md).

    ?months=<int>, default 6, clamped to [1, 24] — matches apps.health's
    own ?months= query param convention (GET /api/health/score/?months=12)
    for a trend window, rather than inventing a new parameter shape.

    Deliberately does NOT include the cross-invoice "unread comments
    overview" (flagged in the original planning as its own future
    addition, not part of this build) or anything resembling v1's Cash
    Flow Forecast/Currency Diversification sections (excluded back at
    Step 6, not reconsidered here).
    """
    months_param = request.query_params.get('months', '6')
    try:
        months = int(months_param)
    except ValueError:
        return Response({'error': 'months must be a real integer.'}, status=status.HTTP_400_BAD_REQUEST)
    months = max(1, min(months, 24))

    return Response({
        'monthly_trend': _build_monthly_trend(request.user, months),
        'top_clients': _build_top_clients(request.user),
        'currency_breakdown': _build_currency_breakdown(request.user),
    })


# ══════════════════════════════════════════════════════════════════
# PRESETS
# ══════════════════════════════════════════════════════════════════

@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def preset_list(request):
    if request.method == 'POST':
        return preset_create(request)

    presets = InvoicePreset.objects.filter(user=request.user)
    return Response(InvoicePresetSerializer(presets, many=True, context={'request': request}).data)


def preset_create(request):
    if _check_moderate_rate_limit('preset_create', request.user):
        return _too_many_requests('Too many presets created recently. Please try again later.')

    serializer = InvoicePresetSerializer(data=request.data, context={'request': request})
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    preset = serializer.save(user=request.user)
    logger.info('[INVOICES] Created preset %s for user %s.', preset.pk, request.user.pk)
    return Response(InvoicePresetSerializer(preset, context={'request': request}).data, status=status.HTTP_201_CREATED)


@api_view(['GET', 'PUT', 'DELETE'])
@permission_classes([IsAuthenticated])
def preset_detail(request, pk):
    preset = get_object_or_404(InvoicePreset, pk=pk, user=request.user)

    if request.method == 'GET':
        return Response(InvoicePresetSerializer(preset, context={'request': request}).data)

    if request.method == 'DELETE':
        if _check_moderate_rate_limit('preset_delete', request.user):
            return _too_many_requests('Too many actions. Please try again later.')
        preset.delete()
        logger.info('[INVOICES] Deleted preset %s.', pk)
        return Response(status=status.HTTP_204_NO_CONTENT)

    if _check_moderate_rate_limit('preset_update', request.user):
        return _too_many_requests('Too many updates. Please try again later.')

    serializer = InvoicePresetSerializer(preset, data=request.data, context={'request': request})
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    serializer.save()
    logger.info('[INVOICES] Updated preset %s.', preset.pk)
    return Response(InvoicePresetSerializer(preset, context={'request': request}).data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def preset_set_default(request, pk):
    if _check_moderate_rate_limit('preset_set_default', request.user):
        return _too_many_requests('Too many actions. Please try again later.')

    preset = get_object_or_404(InvoicePreset, pk=pk, user=request.user)
    preset.is_default = True
    preset.save()  # InvoicePreset.save()'s own override unsets every other default for this user
    logger.info('[INVOICES] Set preset %s as default for user %s.', preset.pk, request.user.pk)
    return Response(InvoicePresetSerializer(preset, context={'request': request}).data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def preset_create_invoice(request, pk):
    """Instantiates a new draft Invoice from a preset's saved defaults."""
    if _check_moderate_rate_limit('preset_create_invoice', request.user):
        return _too_many_requests('Too many actions. Please try again later.')

    preset = get_object_or_404(InvoicePreset, pk=pk, user=request.user)

    invoice = Invoice.objects.create(
        user=request.user,
        client=preset.client if preset.include_client else None,
        client_name=preset.client_name, client_email=preset.client_email, client_company=preset.client_company,
        currency=preset.currency, tax_rate=preset.tax_rate, discount_amount=preset.discount_amount,
        due_date=timezone.now().date() + timedelta(days=preset.payment_terms),
        notes=preset.notes, terms=preset.terms,
        late_fee_enabled=preset.late_fee_enabled, late_fee_rate=preset.late_fee_rate,
    )
    for item in preset.items.all():
        InvoiceItem.objects.create(
            invoice=invoice, description=item.description, quantity=item.quantity,
            unit_price=item.unit_price, sort_order=item.sort_order,
        )
    invoice.recalculate_totals()
    invoice.save(update_fields=['subtotal', 'tax_amount', 'total'])

    emit('InvoiceCreated', invoice_id=str(invoice.pk), user_id=str(request.user.pk), from_preset=str(preset.pk))
    logger.info('[INVOICES] Created invoice %s from preset %s.', invoice.pk, preset.pk)
    return Response(InvoiceListSerializer(invoice).data, status=status.HTTP_201_CREATED)


# ══════════════════════════════════════════════════════════════════
# DESIGNS — Step 8. The design_data JSON contract (apps/invoices/
# design_schema.py) and real, tested CRUD against it. The canvas UI
# consuming these endpoints is Step 8b, not built here.
# ══════════════════════════════════════════════════════════════════

@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def design_list(request):
    if request.method == 'POST':
        return design_create(request)

    designs = InvoiceDesign.objects.filter(user=request.user)
    return Response(InvoiceDesignSerializer(designs, many=True).data)


def design_create(request):
    if _check_moderate_rate_limit('design_create', request.user):
        return _too_many_requests('Too many designs created recently. Please try again later.')

    serializer = InvoiceDesignSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    design = serializer.save(user=request.user)
    logger.info('[INVOICES] Created design %s for user %s.', design.pk, request.user.pk)
    return Response(InvoiceDesignSerializer(design).data, status=status.HTTP_201_CREATED)


@api_view(['GET', 'PUT', 'DELETE'])
@permission_classes([IsAuthenticated])
def design_detail(request, pk):
    design = get_object_or_404(InvoiceDesign, pk=pk, user=request.user)

    if request.method == 'GET':
        return Response(InvoiceDesignSerializer(design).data)

    if request.method == 'DELETE':
        if _check_moderate_rate_limit('design_delete', request.user):
            return _too_many_requests('Too many actions. Please try again later.')
        design.delete()
        logger.info('[INVOICES] Deleted design %s.', pk)
        return Response(status=status.HTTP_204_NO_CONTENT)

    if _check_moderate_rate_limit('design_update', request.user):
        return _too_many_requests('Too many updates. Please try again later.')

    serializer = InvoiceDesignSerializer(design, data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    serializer.save()
    logger.info('[INVOICES] Updated design %s.', design.pk)
    return Response(InvoiceDesignSerializer(design).data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def design_set_default(request, pk):
    if _check_moderate_rate_limit('design_set_default', request.user):
        return _too_many_requests('Too many actions. Please try again later.')

    design = get_object_or_404(InvoiceDesign, pk=pk, user=request.user)
    design.is_default = True
    design.save()  # InvoiceDesign.save()'s own override unsets every other default for this user
    logger.info('[INVOICES] Set design %s as default for user %s.', design.pk, request.user.pk)
    return Response(InvoiceDesignSerializer(design).data)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
@xframe_options_exempt
def design_builtin_preview(request):
    """
    Path 1's own gallery card preview (SEV1 follow-up, 20 August 2026,
    item 1) — a real, non-WeasyPrint HTML render of one of the 3 static
    templates, real sample data, the requesting user's own real logo/
    profile, and the requested color_variant. `?base_template=`
    (required) + `?color_variant=` (optional, blank/unrecognized falls
    back to that template's own 'default' — see resolve_design_colors)
    are query params, not JSON body, since DesignGallery.jsx embeds this
    directly as an <iframe src="...">, not an XHR call — the browser's
    own navigation carries the same-site auth cookie automatically (see
    DECISIONS.md), no fetch/blob plumbing needed.

    @xframe_options_exempt — same real, necessary exemption
    invoice_preview_as_client already needed (see that view's own
    docstring/DECISIONS.md): Django's clickjacking protection blocks
    ANY page from being framed by default, in DEBUG and production
    alike, and this view's entire purpose is to be framed.
    IsAuthenticated still fully gates who can reach it at all.
    """
    base_template = request.query_params.get('base_template')
    if base_template not in TEMPLATE_MAP:
        return Response({'base_template': f'Must be one of {sorted(TEMPLATE_MAP)}.'}, status=status.HTTP_400_BAD_REQUEST)
    color_variant = request.query_params.get('color_variant', '') or ''

    html = render_builtin_template_preview_html(request.user, base_template, color_variant)
    return HttpResponse(html, content_type='text/html')


@api_view(['GET'])
@permission_classes([IsAuthenticated])
@xframe_options_exempt
def design_preview(request, pk):
    """
    'Your designs' own gallery card preview — same real-render principle
    as design_builtin_preview above, but for an already-saved,
    real-owned InvoiceDesign (real sample data, but the design's ACTUAL
    design_data, routed through the exact same render_html_for_design
    branch a real invoice with this design assigned would use — a
    custom/edited design's card genuinely reflects the dynamic renderer,
    not just base_template+color).
    """
    design = get_object_or_404(InvoiceDesign, pk=pk, user=request.user)
    html = render_design_preview_html(request.user, design)
    return HttpResponse(html, content_type='text/html')


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def design_duplicate(request):
    """
    Path 1 (ready-made templates) — the spec's own language is that
    picking a built-in + color variant "converts into this same
    structure under the hood." That conversion needs a starting point;
    duplicating one of the 3 built templates' design_data
    (apps/invoices/design_seeds.py) into a new, real, editable
    InvoiceDesign row for the requesting user is that starting point.

    Deliberately scoped to only this one case — instantiating a builtin
    seed by `base_template` name, not an existing InvoiceDesign row (no
    `pk` in this URL at all). Nothing in the spec asks for general
    "duplicate any existing design" — an InvoiceDesign is already
    PUT-editable in place — so that's left unbuilt; see DECISIONS.md.
    """
    if _check_moderate_rate_limit('design_duplicate', request.user):
        return _too_many_requests('Too many actions. Please try again later.')

    base_template = request.data.get('base_template')
    if base_template not in BUILTIN_DESIGNS:
        return Response(
            {'base_template': f'Must be one of {sorted(BUILTIN_DESIGNS)}.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    color_variant = request.data.get('color_variant', '') or ''
    name = request.data.get('name') or f'{base_template.title()} (copy)'

    design = _instantiate_design_from_builtin(request.user, base_template, color_variant, name)
    logger.info(
        '[INVOICES] Duplicated builtin design %s (%s) as %s for user %s.',
        base_template, color_variant or 'default', design.pk, request.user.pk,
    )
    return Response(InvoiceDesignSerializer(design).data, status=status.HTTP_201_CREATED)


def _instantiate_design_from_builtin(user, base_template, color_variant='', name=None, design_data=None, source='builtin'):
    """
    The one real "create an InvoiceDesign row from a builtin seed" code
    path — used by both design_duplicate (Path 1, above) and
    design_ai_seed (Path 3, below) rather than each growing its own.
    `design_data` defaults to the unmodified seed; Path 3 passes its own
    AI-adjusted payload instead. Defined after design_duplicate since
    Python resolves the name at call time, not definition time — either
    order works, this keeps the two Path 1 pieces textually adjacent.
    """
    return InvoiceDesign.objects.create(
        user=user,
        name=name or f'{base_template.title()} (copy)',
        base_template=base_template,
        source=source,
        color_variant=color_variant,
        design_data=design_data if design_data is not None else get_builtin_design_data(base_template),
    )


# ══════════════════════════════════════════════════════════════════
# AI-SEEDED DESIGN — Step 9, Path 3. apps/invoices/ai_design.py owns the
# classify + adjust pipeline; this view owns rate limiting, upload
# handling, and turning any pipeline failure into a clear response that
# still leaves the user a path to Path 1/Path 2 (they're never navigated
# away from the gallery those live on — see DesignGallery.jsx).
# ══════════════════════════════════════════════════════════════════

# Separate, tighter limit than _check_moderate_rate_limit's 30/hour — this
# is a real external Groq API call with real token cost per attempt, not a
# free CRUD operation, per the task's own explicit instruction.
AI_SEED_RATE_LIMIT = 5


def _check_ai_seed_rate_limit(user):
    key = f'ratelimit_invoices_design_ai_seed_{user.pk}'
    count = cache.get(key, 0)
    if count >= AI_SEED_RATE_LIMIT:
        return True
    cache.set(key, count + 1, timeout=3600)
    return False


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def design_ai_seed(request):
    if _check_ai_seed_rate_limit(request.user):
        return _too_many_requests(
            f'AI design seeding is limited to {AI_SEED_RATE_LIMIT} attempts per hour. Please try again later, '
            'or pick a ready-made template / start a blank design instead.'
        )

    image = request.FILES.get('image')
    if not image:
        return Response({'error': 'No reference image provided.'}, status=status.HTTP_400_BAD_REQUEST)

    extension = os.path.splitext(image.name)[1].lower()
    if extension not in ALLOWED_REFERENCE_IMAGE_EXTENSIONS:
        return Response(
            {'error': f'Unsupported file type. Allowed: {", ".join(sorted(ALLOWED_REFERENCE_IMAGE_EXTENSIONS))}'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if image.size > MAX_REFERENCE_IMAGE_SIZE_BYTES:
        return Response({'error': 'File too large. Maximum size is 8MB.'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        PILImage.open(image).verify()
    except (UnidentifiedImageError, OSError):
        return Response({'error': "That doesn't look like a valid image file."}, status=status.HTTP_400_BAD_REQUEST)
    image.seek(0)

    # The reference image is read into memory for the one Groq call and
    # never written to Cloudinary/disk anywhere in this view or in
    # ai_design.py — per the spec's real liability/copyright reasoning
    # (reference images are often someone else's licensed template design).
    # `image` (the Django UploadedFile) goes out of scope when this request
    # finishes; nothing here holds a reference to it beyond that.
    raw_bytes = image.read()

    try:
        base_template, design_data = seed_design_data_from_image(raw_bytes)
    except ValueError as exc:
        logger.warning('[INVOICES] AI design seeding failed for user %s: %s', request.user.pk, exc)
        return Response({'error': str(exc)}, status=status.HTTP_502_BAD_GATEWAY)

    design = _instantiate_design_from_builtin(
        request.user, base_template, color_variant='ai_extracted',
        name=f'{base_template.title()} (AI-seeded)', design_data=design_data, source='ai_seeded',
    )
    logger.info('[INVOICES] AI-seeded design %s (%s) for user %s.', design.pk, base_template, request.user.pk)
    return Response(InvoiceDesignSerializer(design).data, status=status.HTTP_201_CREATED)


# ══════════════════════════════════════════════════════════════════
# SIGNATURE TOOL — Step 9. Classical image processing (Pillow luminance
# thresholding, apps/invoices/signature_tool.py), not AI — a single stored
# signature per user (FreelancerProfile.signature_url/signature_public_id,
# Step 7b's fields), reused across every design/invoice, same as the logo.
#
# Preview-then-commit via a `commit` flag on the SAME endpoint, rather than
# a separate confirm endpoint with server-side staged state: background
# removal is a cheap, deterministic, non-AI operation (same input bytes
# always produce the same output), so re-running it on the confirm call
# costs nothing meaningful — no reason to hold anything in a cache/session
# between the preview and the commit just to avoid a second, near-instant
# Pillow pass.
# ══════════════════════════════════════════════════════════════════

def _check_signature_rate_limit(user):
    key = f'signature_upload_{user.pk}'
    count = cache.get(key, 0)
    if count >= 10:
        return True
    cache.set(key, count + 1, timeout=3600)
    return False


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def signature_upload(request):
    """
    POST with `image` (multipart file) — returns a cleaned, transparent-
    background PNG preview as a data URI, and does NOT touch Cloudinary or
    FreelancerProfile yet.
    POST again with the same `image` plus `commit=true` — re-runs the same
    processing for real, uploads it, and saves it as the user's one
    signature (replacing any previous one, per Step 7b's single-field
    lifecycle — destroys the old Cloudinary asset first, same pattern as
    upload_logo).
    """
    if _check_signature_rate_limit(request.user):
        return Response({'error': 'Too many uploads. Please try again in an hour.'}, status=status.HTTP_429_TOO_MANY_REQUESTS)

    file = request.FILES.get('image')
    if not file:
        return Response({'error': 'No file provided.'}, status=status.HTTP_400_BAD_REQUEST)

    extension = os.path.splitext(file.name)[1].lower()
    if extension not in ALLOWED_LOGO_EXTENSIONS:
        return Response(
            {'error': f'Unsupported file type. Allowed: {", ".join(sorted(ALLOWED_LOGO_EXTENSIONS))}'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if file.size > MAX_LOGO_SIZE_BYTES:
        return Response({'error': 'File too large. Maximum size is 5MB.'}, status=status.HTTP_400_BAD_REQUEST)

    # Same content-validation discipline as upload_logo — extension alone
    # doesn't confirm the file's actual content.
    try:
        PILImage.open(file).verify()
    except (UnidentifiedImageError, OSError):
        return Response({'error': "That doesn't look like a valid image file."}, status=status.HTTP_400_BAD_REQUEST)
    file.seek(0)

    raw_bytes = file.read()
    try:
        cleaned_png_bytes = remove_signature_background(raw_bytes)
    except Exception:
        logger.exception('[INVOICES] Signature background removal failed for user %s.', request.user.pk)
        return Response({'error': 'Could not process that image. Please try a different photo.'}, status=status.HTTP_400_BAD_REQUEST)

    commit = str(request.data.get('commit', '')).lower() in ('true', '1', 'yes')
    if not commit:
        preview_data_uri = f'data:image/png;base64,{base64.b64encode(cleaned_png_bytes).decode("ascii")}'
        return Response({'preview_data_uri': preview_data_uri})

    try:
        prof = request.user.profile
    except FreelancerProfile.DoesNotExist:
        return Response({'error': 'Profile not found.'}, status=status.HTTP_404_NOT_FOUND)

    import cloudinary.uploader

    if prof.signature_public_id:
        try:
            cloudinary.uploader.destroy(prof.signature_public_id)
        except Exception:
            pass  # best-effort cleanup — a failed destroy must never block the new upload

    try:
        result = cloudinary.uploader.upload(
            io.BytesIO(cleaned_png_bytes), folder='lanceraos/signatures', resource_type='image', format='png',
        )
    except Exception:
        logger.exception('[INVOICES] Cloudinary signature upload failed for user_id=%s', request.user.pk)
        return Response({'error': 'Upload failed. Please try again.'}, status=status.HTTP_502_BAD_GATEWAY)

    prof.signature_url = result.get('secure_url', '')
    prof.signature_public_id = result.get('public_id', '')
    prof.save(update_fields=['signature_url', 'signature_public_id'])

    logger.info('[INVOICES] Signature saved for user %s.', request.user.pk)
    return Response({'signature_url': prof.signature_url})
