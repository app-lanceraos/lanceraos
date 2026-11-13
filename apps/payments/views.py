# apps/payments/views.py
"""
The Payments API (the income ledger). Function views only, every query scoped to request.user
(a foreign or unknown id is the same 404), every response `Cache-Control: no-store`.

Linking a payment to an invoice needs both models, so it lives in apps.invoices
(views_payment_link.py), never here: apps.payments imports nothing from apps.invoices.
"""

from django.db import transaction
from django.db.models import DecimalField, ExpressionWrapper, F, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from core.observability import log_event
from core.ratelimit import rate_limited

from . import ledger, services
from .constants import ORIGIN_CHOICES, ORIGIN_MANUAL, PAYMENT_SOURCE_CHOICES
from .http import bad_request, no_store, parse_date_param, parse_paging, too_many_requests
from .models import Payment
from .selectors import payments_queryset, serialize_payment
from .serializers import PaymentSerializer, PaymentWriteSerializer
from .validators import validate_currency_code

# Reads are the generous tier.
READS_PER_HOUR = 240
# Create, update and delete are 60/hour, not the usual 30: an owner typing in a backlog of
# payments by hand must not be blocked halfway through.
WRITES_PER_HOUR = 60

SORTS = ('recent', 'oldest', 'amount_high', 'amount_low')
MATCHES = ('unmatched', 'partial', 'matched')


def _apply_filters(request, qs):
    """Returns (queryset, error message or None)."""
    params = request.query_params

    search = (params.get('search') or '').strip()
    if search:
        # Matching through the allocations joins one row per allocation; filtering through a
        # pk__in subquery keeps the main query one row per payment (no duplicates, and the
        # allocated_total annotation is not multiplied).
        qs = qs.filter(pk__in=Payment.objects.filter(user=request.user).filter(
            Q(counterparty__icontains=search)
            | Q(notes__icontains=search)
            | Q(invoice_allocations__invoice__invoice_number__icontains=search)
            | Q(invoice_allocations__invoice__client_name__icontains=search)
        ).values('pk'))

    source = params.get('source')
    if source:
        if source not in dict(PAYMENT_SOURCE_CHOICES):
            return qs, 'Unknown source.'
        qs = qs.filter(source=source)

    currency = (params.get('currency') or '').strip().upper()
    if currency:
        qs = qs.filter(currency=currency)

    origin = params.get('origin')
    if origin:
        if origin not in dict(ORIGIN_CHOICES):
            return qs, 'Unknown origin.'
        qs = qs.filter(origin=origin)

    match = params.get('match')
    if match:
        if match not in MATCHES:
            return qs, 'Unknown match filter.'
        if match == 'unmatched':
            qs = qs.filter(allocated_total=0)
        elif match == 'partial':
            qs = qs.filter(allocated_total__gt=0, allocated_total__lt=F('amount'))
        else:
            qs = qs.filter(allocated_total__gte=F('amount'))

    start, error = parse_date_param(params.get('start'))
    if error:
        return qs, error
    end, error = parse_date_param(params.get('end'))
    if error:
        return qs, error
    if start:
        qs = qs.filter(payment_date__gte=start)
    if end:
        qs = qs.filter(payment_date__lte=end)
    return qs, None


def _apply_sort(request, qs):
    sort = request.query_params.get('sort') or 'recent'
    if sort not in SORTS:
        return qs, 'Unknown sort.'
    if sort == 'recent':
        return qs.order_by('-payment_date', '-created_at'), None
    if sort == 'oldest':
        return qs.order_by('payment_date', 'created_at'), None
    # Amount sorts rank by USD value (amount x frozen rate), never the raw amount: sorting
    # 5,000 PKR above 100 USD because 5,000 > 100 would be meaningless across currencies.
    # Payments with no rate (no USD value) sort last in both directions.
    qs = qs.annotate(usd_value=ExpressionWrapper(
        F('amount') * F('rate_to_usd'), output_field=DecimalField(max_digits=40, decimal_places=12),
    ))
    direction = F('usd_value').desc(nulls_last=True) if sort == 'amount_high' else F('usd_value').asc(nulls_last=True)
    return qs.order_by(direction, '-payment_date', '-created_at'), None


def _duplicate_payload(payment):
    return {
        'id': str(payment.pk),
        'amount': str(payment.amount),
        'currency': payment.currency,
        'payment_date': payment.payment_date.isoformat(),
        'source': payment.source,
        'counterparty': payment.counterparty,
        'origin': payment.origin,
    }


@no_store
@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def payment_list(request):
    """
    GET: the user's payments (filters: search, source, currency, origin, match, start, end;
    sort: recent/oldest/amount_high/amount_low; limit/offset). POST: manual entry
    (origin='manual'); returns the payment and `possible_duplicates` — same currency and amount
    within 3 days — so one typed twice, or typed and also recorded on an invoice, is noticed.
    """
    if request.method == 'GET':
        if rate_limited(f'payments:list:{request.user.pk}', READS_PER_HOUR):
            return too_many_requests()
        limit, offset, error = parse_paging(request)
        if error:
            return bad_request(error)
        qs, error = _apply_filters(request, payments_queryset(request.user))
        if error:
            return bad_request(error)
        qs, error = _apply_sort(request, qs)
        if error:
            return bad_request(error)
        total = qs.count()
        page = qs[offset:offset + limit]
        return Response({'results': PaymentSerializer(page, many=True).data, 'total': total, 'limit': limit, 'offset': offset})

    if rate_limited(f'payments:create:{request.user.pk}', WRITES_PER_HOUR):
        return too_many_requests()
    serializer = PaymentWriteSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    data = serializer.validated_data

    with transaction.atomic():
        payment = services.create_payment(
            user_id=request.user.pk, amount=data['amount'], currency=data['currency'],
            payment_date=data['payment_date'], source=data['source'],
            counterparty=data['counterparty'], notes=data['notes'], origin=ORIGIN_MANUAL,
        )
    log_event('payment_created', user=request.user, request=request, metadata=services.snapshot_for_audit(payment))

    duplicates = ledger.find_possible_duplicates(
        request.user, payment.amount, payment.currency, payment.payment_date, exclude_id=payment.pk,
    )
    return Response(
        {'payment': serialize_payment(payment.pk, request.user), 'possible_duplicates': [_duplicate_payload(d) for d in duplicates]},
        status=status.HTTP_201_CREATED,
    )


@no_store
@api_view(['GET', 'PUT', 'DELETE'])
@permission_classes([IsAuthenticated])
def payment_detail(request, pk):
    """
    GET one payment with its allocations. PUT: partial update (a payment with any allocation can
    only change counterparty and notes). DELETE: 204 for a free manual/imported payment.
    """
    if request.method == 'GET':
        if rate_limited(f'payments:detail:{request.user.pk}', READS_PER_HOUR):
            return too_many_requests()
        get_object_or_404(Payment, pk=pk, user=request.user)
        return Response(serialize_payment(pk, request.user))

    if rate_limited(f'payments:{request.method.lower()}:{request.user.pk}', WRITES_PER_HOUR):
        return too_many_requests()

    if request.method == 'PUT':
        with transaction.atomic():
            # The allocation check and the edit must see the same state: link-invoice locks the
            # payment row too, so the two cannot interleave (lock order: invoice, then payment).
            payment = get_object_or_404(Payment.objects.select_for_update(), pk=pk, user=request.user)
            serializer = PaymentWriteSerializer(data=request.data, partial=True)
            if not serializer.is_valid():
                return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
            try:
                changes = services.update_payment(payment, serializer.validated_data)
            except services.PaymentRuleError as exc:
                return bad_request(str(exc))
        if changes:
            log_event(
                'payment_updated', user=request.user, request=request,
                metadata={'payment_id': str(pk), 'changes': services.audit_changes(changes)},
            )
        return Response(serialize_payment(pk, request.user))

    with transaction.atomic():
        payment = get_object_or_404(Payment.objects.select_for_update(), pk=pk, user=request.user)
        audit = services.snapshot_for_audit(payment)
        try:
            services.delete_payment(payment)
        except services.PaymentRuleError as exc:
            return bad_request(str(exc))
    log_event('payment_deleted', user=request.user, request=request, metadata=audit)
    return Response(status=status.HTTP_204_NO_CONTENT)


@no_store
@api_view(['GET'])
@permission_classes([IsAuthenticated])
def payment_summary(request):
    """
    Headline income numbers (this month / last month / this year / all time, by source, the last
    12 months) converted into the user's default currency, or `?currency=` when given. See
    apps.payments.ledger.summary_for_user for the exact rules.
    """
    if rate_limited(f'payments:summary:{request.user.pk}', READS_PER_HOUR):
        return too_many_requests()
    currency = request.query_params.get('currency')
    if currency:
        try:
            currency = validate_currency_code(currency)
        except serializers.ValidationError as exc:
            return bad_request(str(exc.detail[0]))
    return Response(ledger.summary_for_user(request.user, timezone.now().date(), currency))


@no_store
@api_view(['GET'])
@permission_classes([IsAuthenticated])
def payment_currencies(request):
    """
    Distinct currencies present in the user's own payments, ordered by code — the options of the
    Payments list's currency filter (the same idea as invoice_currencies and client_currencies).
    """
    if rate_limited(f'payments:currencies:{request.user.pk}', READS_PER_HOUR):
        return too_many_requests()
    currencies = list(
        Payment.objects.filter(user=request.user).order_by('currency').values_list('currency', flat=True).distinct()
    )
    return Response({'currencies': currencies})
