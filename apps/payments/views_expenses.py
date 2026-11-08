# apps/payments/views_expenses.py
"""
The Expenses API (the money-out ledger, Prompt 14). Function views only, every query scoped to
request.user (a foreign or unknown id is the same 404), every response `Cache-Control: no-store`.
The shape mirrors views.py (the Payments API), on the same http.py helpers.
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

from . import expense_ledger, expense_services
from .constants import EXPENSE_CATEGORY_LABELS
from .expense_serializers import ExpenseSerializer, ExpenseWriteSerializer
from .http import bad_request, no_store, parse_date_param, parse_paging, too_many_requests
from .models import Expense
from .validators import validate_currency_code

# Reads are the generous tier.
READS_PER_HOUR = 240
# Create, update and delete are 60/hour, not the usual 30: an owner typing in a backlog of
# expenses by hand must not be blocked halfway through.
WRITES_PER_HOUR = 60

SORTS = ('recent', 'oldest', 'amount_high', 'amount_low')


def _apply_filters(request, qs):
    """Returns (queryset, error message or None)."""
    params = request.query_params

    search = (params.get('search') or '').strip()
    if search:
        qs = qs.filter(Q(vendor__icontains=search) | Q(description__icontains=search))

    category = params.get('category')
    if category:
        if category not in EXPENSE_CATEGORY_LABELS:
            return qs, 'Unknown category.'
        qs = qs.filter(category=category)

    currency = (params.get('currency') or '').strip().upper()
    if currency:
        qs = qs.filter(currency=currency)

    deductible = params.get('deductible')
    if deductible:
        if deductible not in ('true', 'false'):
            return qs, 'Unknown deductible filter.'
        qs = qs.filter(is_deductible=(deductible == 'true'))

    start, error = parse_date_param(params.get('start'))
    if error:
        return qs, error
    end, error = parse_date_param(params.get('end'))
    if error:
        return qs, error
    if start:
        qs = qs.filter(expense_date__gte=start)
    if end:
        qs = qs.filter(expense_date__lte=end)
    return qs, None


def _apply_sort(request, qs):
    sort = request.query_params.get('sort') or 'recent'
    if sort not in SORTS:
        return qs, 'Unknown sort.'
    if sort == 'recent':
        return qs.order_by('-expense_date', '-created_at'), None
    if sort == 'oldest':
        return qs.order_by('expense_date', 'created_at'), None
    # Amount sorts rank by USD value (amount x frozen rate), never the raw amount: sorting
    # 5,000 PKR above 100 USD because 5,000 > 100 would be meaningless across currencies.
    # Expenses with no rate (no USD value) sort last in both directions.
    qs = qs.annotate(usd_value=ExpressionWrapper(
        F('amount') * F('rate_to_usd'), output_field=DecimalField(max_digits=40, decimal_places=12),
    ))
    direction = F('usd_value').desc(nulls_last=True) if sort == 'amount_high' else F('usd_value').asc(nulls_last=True)
    return qs.order_by(direction, '-expense_date', '-created_at'), None


def _duplicate_payload(expense):
    return {
        'id': str(expense.pk),
        'amount': str(expense.amount),
        'currency': expense.currency,
        'expense_date': expense.expense_date.isoformat(),
        'category': expense.category,
        'vendor': expense.vendor,
    }


@no_store
@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def expense_list(request):
    """
    GET: the user's expenses (filters: search, category, currency, deductible, start, end; sort:
    recent/oldest/amount_high/amount_low; limit/offset). POST: create; returns the expense and
    `possible_duplicates` — same currency, amount and category within 3 days — a notice, never a block.
    """
    if request.method == 'GET':
        if rate_limited(f'expenses:list:{request.user.pk}', READS_PER_HOUR):
            return too_many_requests()
        limit, offset, error = parse_paging(request)
        if error:
            return bad_request(error)
        qs, error = _apply_filters(request, Expense.objects.filter(user=request.user))
        if error:
            return bad_request(error)
        qs, error = _apply_sort(request, qs)
        if error:
            return bad_request(error)
        total = qs.count()
        page = qs[offset:offset + limit]
        return Response({'results': ExpenseSerializer(page, many=True).data, 'total': total, 'limit': limit, 'offset': offset})

    if rate_limited(f'expenses:create:{request.user.pk}', WRITES_PER_HOUR):
        return too_many_requests()
    serializer = ExpenseWriteSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    data = serializer.validated_data

    with transaction.atomic():
        expense = expense_services.create_expense(
            user_id=request.user.pk, amount=data['amount'], currency=data['currency'],
            expense_date=data['expense_date'], category=data['category'], vendor=data['vendor'],
            description=data['description'], is_deductible=data['is_deductible'],
        )
    log_event('expense_created', user=request.user, request=request, metadata=expense_services.snapshot_for_audit(expense))

    duplicates = expense_ledger.find_possible_duplicates(
        request.user, expense.amount, expense.currency, expense.expense_date, expense.category, exclude_id=expense.pk,
    )
    return Response(
        {'expense': ExpenseSerializer(expense).data, 'possible_duplicates': [_duplicate_payload(d) for d in duplicates]},
        status=status.HTTP_201_CREATED,
    )


@no_store
@api_view(['GET', 'PUT', 'DELETE'])
@permission_classes([IsAuthenticated])
def expense_detail(request, pk):
    """GET one expense. PUT: partial update (every field is editable). DELETE: 204."""
    if request.method == 'GET':
        if rate_limited(f'expenses:detail:{request.user.pk}', READS_PER_HOUR):
            return too_many_requests()
        expense = get_object_or_404(Expense, pk=pk, user=request.user)
        return Response(ExpenseSerializer(expense).data)

    if rate_limited(f'expenses:{request.method.lower()}:{request.user.pk}', WRITES_PER_HOUR):
        return too_many_requests()

    if request.method == 'PUT':
        with transaction.atomic():
            expense = get_object_or_404(Expense.objects.select_for_update(), pk=pk, user=request.user)
            serializer = ExpenseWriteSerializer(data=request.data, partial=True)
            if not serializer.is_valid():
                return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
            changes = expense_services.update_expense(expense, serializer.validated_data)
        if changes:
            log_event(
                'expense_updated', user=request.user, request=request,
                metadata={'expense_id': str(pk), 'changes': expense_services.audit_changes(changes)},
            )
        return Response(ExpenseSerializer(expense).data)

    with transaction.atomic():
        expense = get_object_or_404(Expense.objects.select_for_update(), pk=pk, user=request.user)
        audit = expense_services.snapshot_for_audit(expense)
        expense_services.delete_expense(expense)
    log_event('expense_deleted', user=request.user, request=request, metadata=audit)
    return Response(status=status.HTTP_204_NO_CONTENT)


@no_store
@api_view(['GET'])
@permission_classes([IsAuthenticated])
def expense_summary(request):
    """
    Headline expense numbers (this month / last month / this year / all time with the deductible part,
    by category, the last 12 months) converted into the user's default currency, or `?currency=` when
    given. See apps.payments.expense_ledger.summary_for_user for the exact rules.
    """
    if rate_limited(f'expenses:summary:{request.user.pk}', READS_PER_HOUR):
        return too_many_requests()
    currency = request.query_params.get('currency')
    if currency:
        try:
            currency = validate_currency_code(currency)
        except serializers.ValidationError as exc:
            return bad_request(str(exc.detail[0]))
    return Response(expense_ledger.summary_for_user(request.user, timezone.now().date(), currency))


@no_store
@api_view(['GET'])
@permission_classes([IsAuthenticated])
def expense_currencies(request):
    """Distinct currencies present in the user's own expenses, ordered by code — the Expenses list's currency filter."""
    if rate_limited(f'expenses:currencies:{request.user.pk}', READS_PER_HOUR):
        return too_many_requests()
    currencies = list(
        Expense.objects.filter(user=request.user).order_by('currency').values_list('currency', flat=True).distinct()
    )
    return Response({'currencies': currencies})
