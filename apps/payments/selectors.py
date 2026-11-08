# apps/payments/selectors.py
"""Read-side query helpers for Payments, shared by the Payments views and the invoice-side link views."""
from decimal import Decimal

from django.db.models import DecimalField, Sum, Value
from django.db.models.functions import Coalesce

from .models import Payment
from .serializers import PaymentSerializer


def payments_queryset(user):
    """
    The user's payments with `allocated_total` computed in the database and the allocations
    (and their invoices) prefetched — what PaymentSerializer reads. Three queries however many
    payments there are.
    """
    return (
        Payment.objects.filter(user=user)
        .annotate(
            allocated_total=Coalesce(
                Sum('invoice_allocations__amount'), Value(Decimal('0.00')),
                output_field=DecimalField(max_digits=14, decimal_places=2),
            )
        )
        .prefetch_related('invoice_allocations__invoice')
    )


def serialize_payment(payment_id, user):
    """One payment in the read shape, re-read from the database (so annotations are fresh)."""
    return PaymentSerializer(payments_queryset(user).get(pk=payment_id)).data
