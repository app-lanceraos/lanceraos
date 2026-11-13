# apps/invoices/views_payment_link.py
"""
Linking ledger Payments to invoices. These live in apps.invoices, not apps.payments, because
they need both models and apps.payments is the bottom of the dependency tree (it imports
nothing from apps.invoices). Registered in config/urls.py under the api/payments/ prefix.

Rules (Payments core, decisions P7/P9):
  - the payment's currency must equal the invoice's (no cross-currency allocation yet);
  - one payment may be split across several invoices, but the sum of its allocations never
    exceeds its amount, and one allocation never exceeds the invoice's outstanding balance;
  - lock order is ALWAYS invoice row first, then payment row. The payment is fetched with a bare
    select_for_update() and no select_related: PostgreSQL rejects FOR UPDATE on the nullable side
    of a join.
"""
import logging
import uuid
from decimal import Decimal, InvalidOperation

from django.db import transaction
from django.db.models import DecimalField, ExpressionWrapper, F, Q
from django.db.models.functions import Abs
from django.http import Http404
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import ValidationError as DRFValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.payments import services as payment_services
from apps.payments.http import bad_request, no_store, too_many_requests
from apps.payments.models import Payment
from apps.payments.selectors import serialize_payment
from core.events import emit
from core.observability import log_event
from core.ratelimit import rate_limited

from .models import Invoice, InvoicePartialPayment
from .serializers import InvoiceListSerializer, validate_payment_date_for_invoice
from .views import _get_locked_invoice

logger = logging.getLogger(__name__)

READS_PER_HOUR = 240
WRITES_PER_HOUR = 60
CANDIDATE_LIMIT = 20

# Invoices a payment can still settle: delivered or finalised, not closed.
LINKABLE_STATUSES = ('created', 'sent', 'viewed', 'partially_paid')
# The same list every sibling payment endpoint refuses.
CLOSED_STATUSES = ('cancelled', 'bad_debt', 'refunded', 'draft')

CENT = Decimal('0.01')


def _parse_uuid(raw):
    try:
        return uuid.UUID(str(raw))
    except (ValueError, AttributeError, TypeError):
        return None


def _parse_amount(raw):
    """(Decimal or None, error or None). Positive, at most 2 decimal places."""
    try:
        value = Decimal(str(raw))
    except (InvalidOperation, ValueError):
        return None, 'amount must be a number.'
    if not value.is_finite() or value <= 0:
        return None, 'amount must be greater than zero.'
    if value != value.quantize(CENT):
        return None, 'amount cannot have more than 2 decimal places.'
    return value, None


@no_store
@api_view(['GET'])
@permission_classes([IsAuthenticated])
def payment_link_candidates(request, pk):
    """
    Invoices this payment could settle: same currency, still outstanding, not closed, issued on or
    before the payment date. Ranked: an outstanding balance equal to what is left of the payment
    first, then the smallest difference, then the earliest due date. At most 20.
    """
    if rate_limited(f'payments:candidates:{request.user.pk}', READS_PER_HOUR):
        return too_many_requests()
    payment = get_object_or_404(Payment, pk=pk, user=request.user)
    remaining = payment_services.remaining_amount(payment)

    outstanding = ExpressionWrapper(F('total') - F('amount_paid'), output_field=DecimalField(max_digits=14, decimal_places=2))
    qs = (
        Invoice.objects.filter(
            user=request.user, status__in=LINKABLE_STATUSES, currency=payment.currency,
            issue_date__lte=payment.payment_date,
        )
        .annotate(outstanding=outstanding)
        .filter(outstanding__gt=0)
    )
    search = (request.query_params.get('search') or '').strip()
    if search:
        qs = qs.filter(Q(invoice_number__icontains=search) | Q(client_name__icontains=search))
    qs = qs.annotate(
        difference=Abs(ExpressionWrapper(F('outstanding') - remaining, output_field=DecimalField(max_digits=14, decimal_places=2)))
    ).order_by('difference', 'due_date', 'invoice_number')[:CANDIDATE_LIMIT]

    return Response({'results': [
        {
            'id': str(inv.pk), 'invoice_number': inv.invoice_number, 'client_name': inv.client_name,
            'status': inv.status, 'issue_date': inv.issue_date.isoformat() if inv.issue_date else None,
            'due_date': inv.due_date.isoformat() if inv.due_date else None, 'total': str(inv.total),
            'outstanding_amount': str(inv.outstanding), 'currency': inv.currency,
        }
        for inv in qs
    ]})


@no_store
@api_view(['POST'])
@permission_classes([IsAuthenticated])
def payment_link_invoice(request, pk):
    """
    POST {invoice_id, amount?}: allocate (part of) this payment to an invoice. `amount` defaults
    to the smaller of what is left of the payment and the invoice's outstanding balance. Creates
    the allocation, recomputes the invoice's status, and emits InvoicePaid/InvoicePartiallyPaid
    after the commit exactly like invoice_add_payment.
    """
    if rate_limited(f'payments:link:{request.user.pk}', WRITES_PER_HOUR):
        return too_many_requests()

    invoice_id = _parse_uuid(request.data.get('invoice_id'))
    if invoice_id is None:
        return bad_request('invoice_id is required.')
    amount = None
    if request.data.get('amount') not in (None, ''):
        amount, error = _parse_amount(request.data.get('amount'))
        if error:
            return bad_request(error)

    with transaction.atomic():
        invoice = _get_locked_invoice(invoice_id, request.user)
        payment = get_object_or_404(Payment.objects.select_for_update(), pk=pk, user=request.user)

        if invoice.status in CLOSED_STATUSES:
            return bad_request(f'Cannot link a payment to a {invoice.status} invoice.')
        if invoice.currency != payment.currency:
            return bad_request(
                f'This payment is in {payment.currency} and the invoice is in {invoice.currency}. '
                'Linking across currencies is not supported yet.'
            )
        remaining = payment_services.remaining_amount(payment)
        if remaining <= 0:
            return bad_request('This payment is already fully linked to invoices.')
        outstanding = invoice.outstanding_amount
        if outstanding <= 0:
            return bad_request('This invoice has no outstanding balance.')
        if amount is None:
            amount = min(remaining, outstanding)
        if amount > remaining:
            return bad_request(f'Amount cannot exceed what is left of this payment ({remaining} {payment.currency}).')
        if amount > outstanding:
            return bad_request(f'Amount cannot exceed the invoice\'s outstanding balance of {outstanding} {invoice.currency}.')
        try:
            validate_payment_date_for_invoice(payment.payment_date, invoice)
        except DRFValidationError as exc:
            return bad_request(str(exc.detail[0]))

        allocation = InvoicePartialPayment.objects.create(
            invoice=invoice, payment=payment, amount=amount, currency=payment.currency,
            source=payment.source, payment_date=payment.payment_date, notes='Linked from Payments.',
        )
        invoice.update_paid_status()
        invoice.refresh_from_db()

    event_name = 'InvoicePaid' if invoice.status == 'paid' else 'InvoicePartiallyPaid'
    emit(event_name, invoice_id=str(invoice.pk), user_id=str(request.user.pk), amount=str(amount))
    log_event(
        'payment_linked', user=request.user, request=request,
        metadata={'payment_id': str(payment.pk), 'invoice_id': str(invoice.pk), 'allocation_id': str(allocation.pk), 'amount': str(amount)},
    )
    logger.info('[PAYMENTS] Linked %s %s from a payment to invoice %s.', amount, payment.currency, invoice.invoice_number)
    return Response(
        {'payment': serialize_payment(payment.pk, request.user), 'invoice': InvoiceListSerializer(invoice).data},
        status=status.HTTP_201_CREATED,
    )


@no_store
@api_view(['DELETE'])
@permission_classes([IsAuthenticated])
def payment_unlink_invoice(request, pk, allocation_id):
    """
    DELETE {confirm: true}: remove ONE allocation of this payment (any, not only the latest) and
    recompute that invoice's status. A payment recorded on an invoice (origin 'invoice') is never
    unlinked here: it leaves the ledger with its invoice's Undo payment.
    """
    if rate_limited(f'payments:unlink:{request.user.pk}', WRITES_PER_HOUR):
        return too_many_requests()

    # The allocation tells us which invoice to lock first; it is re-fetched inside the lock below.
    invoice_id = (
        InvoicePartialPayment.objects
        .filter(pk=allocation_id, payment_id=pk, invoice__user=request.user, payment__user=request.user)
        .values_list('invoice_id', flat=True).first()
    )
    if invoice_id is None:
        raise Http404  # unknown allocation, someone else's payment or invoice: one and the same 404

    if request.data.get('confirm') is not True:
        return bad_request('confirm: true is required to unlink this payment.')

    with transaction.atomic():
        invoice = _get_locked_invoice(invoice_id, request.user)
        payment = get_object_or_404(Payment.objects.select_for_update(), pk=pk, user=request.user)
        allocation = get_object_or_404(InvoicePartialPayment, pk=allocation_id, payment=payment, invoice=invoice)

        if payment.origin == 'invoice':
            return bad_request('Remove it with Undo payment on the invoice.')
        if invoice.status in CLOSED_STATUSES:
            return bad_request(f'Cannot unlink a payment from a {invoice.status} invoice.')

        amount = allocation.amount
        allocation.delete()
        invoice.update_paid_status()
        invoice.refresh_from_db()

    log_event(
        'payment_unlinked', user=request.user, request=request,
        metadata={'payment_id': str(payment.pk), 'invoice_id': str(invoice.pk), 'allocation_id': str(allocation_id), 'amount': str(amount)},
    )
    logger.info('[PAYMENTS] Unlinked a payment from invoice %s.', invoice.invoice_number)
    return Response({'payment': serialize_payment(payment.pk, request.user), 'invoice': InvoiceListSerializer(invoice).data})
