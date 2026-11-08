# apps/payments/admin.py
from django.contrib import admin

from .models import ExchangeRateSnapshot, Payment


@admin.register(ExchangeRateSnapshot)
class ExchangeRateSnapshotAdmin(admin.ModelAdmin):
    list_display = ['date', 'source', 'fetched_at']
    list_filter = ['source']
    readonly_fields = ['fetched_at']


@admin.register(Payment)
class PaymentAdmin(admin.ModelAdmin):
    """
    Fully read-only. Ledger rows are changed only through the Payments API and the invoice
    payment paths, which hold the locks and write the audit trail; an admin-site edit would
    bypass both.
    """
    list_display = ['id', 'user', 'amount', 'currency', 'payment_date', 'source', 'origin', 'rate_basis']
    list_filter = ['origin', 'source', 'currency', 'rate_basis']
    search_fields = ['id', 'counterparty']

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
