# apps/payments/serializers.py
"""
Payments API shapes. Writes use an explicit field list (never ModelSerializer.exclude); `user`,
`origin`, the rate fields and timestamps are set by the server and cannot be sent.

The read shape needs two things the queryset provides (payments_queryset in views.py):
`allocated_total` (a Coalesce(Sum) annotation, computed in the database) and a prefetch of
`invoice_allocations__invoice`. apps.payments reads the invoice only through those attributes;
it imports nothing from apps.invoices.
"""
from decimal import Decimal

from django.utils import timezone
from rest_framework import serializers

from .constants import EARLIEST_PAYMENT_DATE, PAYMENT_SOURCE_CHOICES
from .validators import validate_currency_code


class PaymentWriteSerializer(serializers.Serializer):
    """Create (all required but counterparty/notes/source) and, with partial=True, update."""
    amount = serializers.DecimalField(max_digits=12, decimal_places=2)
    currency = serializers.CharField(max_length=3)
    payment_date = serializers.DateField()
    source = serializers.ChoiceField(choices=PAYMENT_SOURCE_CHOICES, required=False, default='other')
    # Plain text, stored as typed and escaped by React on display; CharField strips surrounding
    # whitespace and refuses NUL (PostgreSQL cannot store it).
    counterparty = serializers.CharField(max_length=200, required=False, allow_blank=True, default='')
    notes = serializers.CharField(max_length=300, required=False, allow_blank=True, default='')

    def validate_amount(self, value):
        if value <= 0:
            raise serializers.ValidationError('Payment amount must be greater than zero.')
        return value

    def validate_currency(self, value):
        return validate_currency_code(value)

    def validate_payment_date(self, value):
        # PKT "today": this app runs USE_TZ=False on Pakistan time, so a bare date.today() or a
        # browser's date is not the reference.
        if value > timezone.now().date():
            raise serializers.ValidationError('Payment date cannot be in the future.')
        if value < EARLIEST_PAYMENT_DATE:
            raise serializers.ValidationError(f'Payment date cannot be before {EARLIEST_PAYMENT_DATE.isoformat()}.')
        return value


class PaymentSerializer(serializers.Serializer):
    """Read representation (see the module docstring for the queryset it expects)."""
    id = serializers.UUIDField()
    amount = serializers.DecimalField(max_digits=12, decimal_places=2)
    currency = serializers.CharField()
    payment_date = serializers.DateField()
    source = serializers.CharField()
    counterparty = serializers.CharField()
    notes = serializers.CharField()
    origin = serializers.CharField()
    rate_basis = serializers.CharField()
    allocated_amount = serializers.SerializerMethodField()
    remaining_amount = serializers.SerializerMethodField()
    invoices = serializers.SerializerMethodField()
    created_at = serializers.DateTimeField()
    updated_at = serializers.DateTimeField()

    def get_allocated_amount(self, obj):
        return str(obj.allocated_total.quantize(Decimal('0.01')))

    def get_remaining_amount(self, obj):
        return str((obj.amount - obj.allocated_total).quantize(Decimal('0.01')))

    def get_invoices(self, obj):
        return [
            {
                'allocation_id': str(allocation.pk),
                'invoice_id': str(allocation.invoice_id),
                'invoice_number': allocation.invoice.invoice_number,
                'client_name': allocation.invoice.client_name,
                'amount': str(allocation.amount),
            }
            for allocation in obj.invoice_allocations.all()
        ]
