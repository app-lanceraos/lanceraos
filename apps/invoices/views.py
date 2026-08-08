# apps/invoices/views.py
"""
Invoice CRUD + lifecycle endpoints — Section 7 of
INVOICES_CLIENTS_TECHNICAL_SPEC.md, minus the two rows that genuinely
belong to later steps: the real /send/ (needs core.email's send_email(),
Step 10) and /pdf/ (needs InvoiceDesign rendering, Step 7). Neither is
stubbed here — they simply don't exist yet, matching this project's
"don't build a placeholder" convention.

Rate limiting mirrors apps.clients.views' _check_moderate_rate_limit /
_too_many_requests shape exactly (same 30/hour, same cache-based check,
same return value), but is NOT imported from there — a shared cache-key
prefix across two unrelated resources would either collide on matching
action names or mislabel invoice actions as "ratelimit_clients_...".
Replicated with an "invoices"-scoped key instead; behavior is identical.
"""
import logging
from datetime import timedelta
from decimal import Decimal, InvalidOperation

from django.core.cache import cache
from django.db.models import Q, Sum
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.dateparse import parse_date
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from core.events import emit
from apps.payments.models import ExchangeRateSnapshot

from .models import (
    NON_OVERDUE_STATUSES, Invoice, InvoiceItem, InvoicePartialPayment, InvoicePreset, InvoicePresetItem,
)
from .serializers import (
    InvoiceListSerializer, InvoicePartialPaymentSerializer, InvoicePresetSerializer, InvoiceSerializer,
)

logger = logging.getLogger(__name__)

# Invoices delivered to a client and not yet fully resolved — the shared
# eligibility set for "Outstanding"/"Past-Due" dashboard KPIs and the AR
# aging report. Deliberately excludes draft/created (never delivered) as
# well as every terminal status.
ACTIVE_STATUSES = ('sent', 'viewed', 'partially_paid')

# invoice_undo_payment's "old" threshold — the spec didn't pin a number;
# this is this step's own judgment call, recorded here and in
# DECISIONS.md. Confirmation-strictness scaling by age is a Step 6 UI
# concern; this endpoint only needs the binary old/not-old gate.
UNDO_CONFIRMATION_AGE_DAYS = 7


def _check_moderate_rate_limit(action, user):
    key = f'ratelimit_invoices_{action}_{user.pk}'
    count = cache.get(key, 0)
    if count >= 30:
        return True
    cache.set(key, count + 1, timeout=3600)
    return False


def _too_many_requests(message):
    return Response({'error': message}, status=status.HTTP_429_TOO_MANY_REQUESTS)


def _parse_date_param(raw, default=None):
    """Returns (date_or_None, error_response_or_None)."""
    if not raw:
        return default, None
    parsed = parse_date(raw)
    if parsed is None:
        return None, Response({'error': 'Invalid date — use YYYY-MM-DD.'}, status=status.HTTP_400_BAD_REQUEST)
    return parsed, None


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
    """
    if _check_moderate_rate_limit('create', request.user):
        return _too_many_requests('Too many invoices created recently. Please try again later.')

    serializer = InvoiceSerializer(data=request.data, context={'request': request})
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    invoice = serializer.save(user=request.user)
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


# ══════════════════════════════════════════════════════════════════
# LIFECYCLE ACTIONS
# ══════════════════════════════════════════════════════════════════

@api_view(['POST'])
@permission_classes([IsAuthenticated])
def invoice_finalise(request, pk):
    """draft -> created. Assigns invoice_number if not already assigned; locks the exchange rate via the latest ExchangeRateSnapshot."""
    if _check_moderate_rate_limit('finalise', request.user):
        return _too_many_requests('Too many finalise actions. Please try again later.')

    invoice = get_object_or_404(Invoice, pk=pk, user=request.user)
    if invoice.status != 'draft':
        return Response({'error': 'Only draft invoices can be finalised.'}, status=status.HTTP_400_BAD_REQUEST)
    if not invoice.items.exists():
        return Response({'error': 'Add at least one line item before finalising.'}, status=status.HTTP_400_BAD_REQUEST)

    invoice.recalculate_totals()
    if not invoice.invoice_number:
        invoice.invoice_number = Invoice.generate_invoice_number(request.user)
    invoice.capture_issue_rate()
    invoice.status = 'created'
    invoice.save()

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
    """
    if not request.data.get('confirm'):
        return Response({'error': 'confirm: true is required to mark this invoice as sent.'}, status=status.HTTP_400_BAD_REQUEST)

    if _check_moderate_rate_limit('mark_sent', request.user):
        return _too_many_requests('Too many actions. Please try again later.')

    invoice = get_object_or_404(Invoice, pk=pk, user=request.user)
    if invoice.status not in ('draft', 'created'):
        return Response({'error': 'Only draft or created invoices can be marked sent.'}, status=status.HTTP_400_BAD_REQUEST)

    if not invoice.invoice_number:
        invoice.invoice_number = Invoice.generate_invoice_number(request.user)
    if not invoice.exchange_rate_snapshot:
        invoice.capture_issue_rate()

    invoice.reminders_enabled = bool(request.data.get('send_reminders', True))
    invoice.status = 'sent'
    invoice.sent_at = timezone.now()
    invoice.save()

    emit('InvoiceSent', invoice_id=str(invoice.pk), user_id=str(request.user.pk), via='manual')
    logger.info('[INVOICES] Marked invoice %s as sent (manual).', invoice.invoice_number)
    return Response(InvoiceListSerializer(invoice).data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def invoice_mark_paid(request, pk):
    """
    Pre-fills the full outstanding balance as a real InvoicePartialPayment
    row (the same structured entry flow invoice_add_payment uses), then
    delegates to update_paid_status() — never a bare status edit, so
    payment history stays accurate and undo-able like any other payment.
    """
    if _check_moderate_rate_limit('mark_paid', request.user):
        return _too_many_requests('Too many actions. Please try again later.')

    invoice = get_object_or_404(Invoice, pk=pk, user=request.user)
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
    serializer = InvoicePartialPaymentSerializer(data=payload, context={'request': request})
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    serializer.save(invoice=invoice)

    invoice.update_paid_status()
    invoice.refresh_from_db()

    emit('InvoicePaid', invoice_id=str(invoice.pk), user_id=str(request.user.pk))
    logger.info('[INVOICES] Marked invoice %s as paid.', invoice.invoice_number)
    return Response(InvoiceListSerializer(invoice).data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def invoice_add_payment(request, pk):
    """Records a partial payment and recomputes status via update_paid_status()."""
    if _check_moderate_rate_limit('add_payment', request.user):
        return _too_many_requests('Too many actions. Please try again later.')

    invoice = get_object_or_404(Invoice, pk=pk, user=request.user)
    if invoice.status in ('cancelled', 'bad_debt', 'refunded', 'draft'):
        return Response({'error': f'Cannot record a payment on a {invoice.status} invoice.'}, status=status.HTTP_400_BAD_REQUEST)

    serializer = InvoicePartialPaymentSerializer(data=request.data, context={'request': request})
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    payment = serializer.save(invoice=invoice)
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
    """
    if _check_moderate_rate_limit('undo_payment', request.user):
        return _too_many_requests('Too many actions. Please try again later.')

    invoice = get_object_or_404(Invoice, pk=pk, user=request.user)
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
    """
    if _check_moderate_rate_limit('cancel', request.user):
        return _too_many_requests('Too many actions. Please try again later.')

    invoice = get_object_or_404(Invoice, pk=pk, user=request.user)
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
    """
    if _check_moderate_rate_limit('refund', request.user):
        return _too_many_requests('Too many actions. Please try again later.')

    invoice = get_object_or_404(Invoice, pk=pk, user=request.user)
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
    """Manual only, per Step 4's confirmed decision. Same eligibility as invoice_cancel."""
    if _check_moderate_rate_limit('bad_debt', request.user):
        return _too_many_requests('Too many actions. Please try again later.')

    invoice = get_object_or_404(Invoice, pk=pk, user=request.user)
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


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def invoice_duplicate(request, pk):
    """New draft copy. Resets pdf_url/pdf_generated_at/view_token/invoice_number/sent_via_platform/status per Step 4's model docstring — a duplicate hasn't been sent yet in its own right."""
    if _check_moderate_rate_limit('duplicate', request.user):
        return _too_many_requests('Too many actions. Please try again later.')

    original = get_object_or_404(Invoice, pk=pk, user=request.user)

    new_invoice = Invoice.objects.create(
        user=request.user,
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
        # NOT copied — explicitly reset: status (defaults to 'draft'),
        # invoice_number (defaults to None), view_token (fresh, via
        # save()), pdf_url/pdf_generated_at (blank/None), sent_via_platform
        # (False), amount_paid (0).
    )
    for item in original.items.all():
        InvoiceItem.objects.create(
            invoice=new_invoice, description=item.description,
            quantity=item.quantity, unit_price=item.unit_price, sort_order=item.sort_order,
        )

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
# TIMELINE
# ══════════════════════════════════════════════════════════════════

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def invoice_timeline(request, pk):
    """
    Unified activity feed, built with what genuinely exists today:
    InvoiceViewEvent, InvoiceReminder, and InvoicePartialPayment rows.
    No status-change-history model exists yet, so individual status
    transitions aren't itemized as their own entries (only inferable
    from current status + these events). Comments (Step 13) and claims
    (Step 14) will extend this feed additively — same response shape,
    new `type` values — once those models have real rows; zero change
    needed here when that happens.
    """
    invoice = get_object_or_404(Invoice, pk=pk, user=request.user)

    entries = []
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

    entries.sort(key=lambda e: e['timestamp'])
    return Response({'results': entries})


# ══════════════════════════════════════════════════════════════════
# DASHBOARD KPIs / AGING REPORT / EXCHANGE RATE
# ══════════════════════════════════════════════════════════════════

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def invoice_summary(request):
    """
    Dashboard KPIs: Outstanding / Total Paid / Past-Due Amount.

    Rewritten against the real rules from the original decisions
    document's Section 6, supplied explicitly after the first version of
    this endpoint had to guess (that version was built unconditional,
    not sent_via_platform-gated, since INVOICES_CLIENTS_TECHNICAL_SPEC.md's
    own Section 6 turned out to be "Notification entries," not dashboard
    rules — a documentation cross-reference bug on record in DECISIONS.md,
    not a code bug). The rules, verbatim in spirit, each covered by its
    own dedicated test:

      - Outstanding: sum(total - amount_paid) over invoices where
        sent_via_platform=True AND status in ACTIVE_STATUSES
        (sent/viewed/partially_paid). Structurally excludes draft/created.
        In practice this is currently always zero — no code path sets
        sent_via_platform=True yet, since only the real /send/ action
        does (Step 10, not built) — genuinely zero, not faked, the same
        honest-placeholder pattern used elsewhere in this project.
      - Total Paid: sum(amount_paid) across ALL invoices except
        draft/created, regardless of sent_via_platform, MINUS
        sum(refunded_amount) across the same set. Cancelled and bad_debt
        invoices' amount_paid still counts — money already received
        isn't erased by a later status change.
      - Past-Due Amount: the exact same filter as Outstanding
        (sent_via_platform=True AND status in ACTIVE_STATUSES), further
        filtered to due_date in the past — equivalent to
        Invoice.days_overdue > 0 for this specific status set, since none
        of ACTIVE_STATUSES overlap with NON_OVERDUE_STATUSES.
      - Draft/Created: excluded from every figure above, unconditionally
        — enforced once, up front, via the shared `qs` queryset every
        figure below is derived from, rather than repeated per-figure.

    See invoice_aging_report's own docstring for why that endpoint
    deliberately does NOT share the sent_via_platform restriction with
    Outstanding above, despite both filtering on ACTIVE_STATUSES — two
    intentionally different rules, not drift between them.
    """
    qs = Invoice.objects.filter(user=request.user).exclude(status__in=('draft', 'created'))
    today = timezone.now().date()

    outstanding_qs = qs.filter(sent_via_platform=True, status__in=ACTIVE_STATUSES)
    outstanding_total = sum((inv.outstanding_amount for inv in outstanding_qs), Decimal('0'))

    total_paid = qs.aggregate(s=Sum('amount_paid'))['s'] or Decimal('0')
    total_refunded = qs.aggregate(s=Sum('refunded_amount'))['s'] or Decimal('0')
    net_total_paid = total_paid - total_refunded

    past_due_qs = outstanding_qs.filter(due_date__lt=today)
    past_due_total = sum((inv.outstanding_amount for inv in past_due_qs), Decimal('0'))

    return Response({
        'outstanding': {'count': outstanding_qs.count(), 'total': str(outstanding_total)},
        'total_paid': {'count': qs.filter(amount_paid__gt=0).count(), 'total': str(net_total_paid)},
        'past_due': {'count': past_due_qs.count(), 'total': str(past_due_total)},
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def invoice_aging_report(request):
    """
    AR aging — Current / 1-30 / 31-60 / 61-90 / 90+ days past due.

    Implements the "broader version" the spec explicitly said it was
    leaning toward (decisions doc Section 13 #3 — not independently
    re-decided here): everything the freelancer believes is unpaid,
    regardless of sent_via_platform, not restricted to platform-sent
    invoices only.

    Deliberately does NOT filter on sent_via_platform, even though
    invoice_summary's Outstanding figure (also built on ACTIVE_STATUSES)
    now does, per the real Section 6 rules supplied in the Step 5
    review. Checked directly, not assumed: these are two intentionally
    different rules for two different purposes — the aging report shows
    the freelancer everything they believe is unpaid (the confirmed
    "broader version" leaning); the dashboard's Outstanding KPI counts
    only real, platform-verified money. The shared ACTIVE_STATUSES
    constant is the actual single source of truth between the two;
    the sent_via_platform filter is where they're meant to diverge, not
    a duplication that drifted out of sync.
    """
    qs = Invoice.objects.filter(user=request.user, status__in=ACTIVE_STATUSES)

    buckets = {
        'current': {'count': 0, 'total': Decimal('0')},
        '1_30': {'count': 0, 'total': Decimal('0')},
        '31_60': {'count': 0, 'total': Decimal('0')},
        '61_90': {'count': 0, 'total': Decimal('0')},
        'over_90': {'count': 0, 'total': Decimal('0')},
    }

    for invoice in qs:
        days = invoice.days_overdue
        if days <= 0:
            key = 'current'
        elif days <= 30:
            key = '1_30'
        elif days <= 60:
            key = '31_60'
        elif days <= 90:
            key = '61_90'
        else:
            key = 'over_90'
        buckets[key]['count'] += 1
        buckets[key]['total'] += invoice.outstanding_amount

    return Response({key: {'count': val['count'], 'total': str(val['total'])} for key, val in buckets.items()})


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
