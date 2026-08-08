# apps/payments/admin.py
from django.contrib import admin

from .models import ExchangeRateSnapshot


@admin.register(ExchangeRateSnapshot)
class ExchangeRateSnapshotAdmin(admin.ModelAdmin):
    list_display = ['date', 'source', 'fetched_at']
    list_filter = ['source']
    readonly_fields = ['fetched_at']
