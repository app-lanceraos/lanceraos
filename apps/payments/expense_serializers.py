# apps/payments/expense_serializers.py
"""
Expenses API shapes (Prompt 14). Writes use an explicit field list (never ModelSerializer.exclude);
`user`, the rate fields and timestamps are set by the server and cannot be sent. Money serializes as
a string, exactly like PaymentSerializer.
"""
from django.utils import timezone
from rest_framework import serializers

from .constants import EARLIEST_EXPENSE_DATE, EXPENSE_CATEGORY_CHOICES
from .validators import validate_currency_code


class StrictBooleanField(serializers.BooleanField):
    """Only a real JSON true/false: DRF's own BooleanField would also accept "yes", "on", 1 and "t"."""

    def to_internal_value(self, data):
        if isinstance(data, bool):
            return data
        self.fail('invalid', input=data)


class ExpenseWriteSerializer(serializers.Serializer):
    """Create (amount, currency, expense_date and category required) and, with partial=True, update."""
    amount = serializers.DecimalField(max_digits=12, decimal_places=2)
    currency = serializers.CharField(max_length=3)
    expense_date = serializers.DateField()
    category = serializers.ChoiceField(choices=EXPENSE_CATEGORY_CHOICES)
    # Plain text, stored as typed and escaped by React on display; CharField strips surrounding
    # whitespace and refuses NUL (PostgreSQL cannot store it).
    vendor = serializers.CharField(max_length=200, required=False, allow_blank=True, default='')
    description = serializers.CharField(max_length=300, required=False, allow_blank=True, default='')
    is_deductible = StrictBooleanField(required=False, default=True)

    def validate_amount(self, value):
        if value <= 0:
            raise serializers.ValidationError('Expense amount must be greater than zero.')
        return value

    def validate_currency(self, value):
        return validate_currency_code(value)

    def validate_expense_date(self, value):
        # PKT "today": this app runs USE_TZ=False on Pakistan time, so a bare date.today() or a
        # browser's date is not the reference.
        if value > timezone.now().date():
            raise serializers.ValidationError('Expense date cannot be in the future.')
        if value < EARLIEST_EXPENSE_DATE:
            raise serializers.ValidationError(f'Expense date cannot be before {EARLIEST_EXPENSE_DATE.isoformat()}.')
        return value


class ExpenseSerializer(serializers.Serializer):
    """Read representation. No labels: the frontend maps the category value."""
    id = serializers.UUIDField()
    amount = serializers.DecimalField(max_digits=12, decimal_places=2)
    currency = serializers.CharField()
    expense_date = serializers.DateField()
    category = serializers.CharField()
    vendor = serializers.CharField()
    description = serializers.CharField()
    is_deductible = serializers.BooleanField()
    rate_basis = serializers.CharField()
    created_at = serializers.DateTimeField()
    updated_at = serializers.DateTimeField()
