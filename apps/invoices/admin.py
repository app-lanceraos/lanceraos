# apps/invoices/admin.py
from django.contrib import admin

from .models import (
    Invoice, InvoiceComment, InvoiceDesign, InvoiceItem, InvoicePartialPayment,
    InvoicePreset, InvoicePresetItem, InvoiceReminder, InvoiceViewEvent, PaymentClaim,
)


class InvoiceItemInline(admin.TabularInline):
    model = InvoiceItem
    extra = 0


@admin.register(Invoice)
class InvoiceAdmin(admin.ModelAdmin):
    list_display = ['invoice_number', 'client_name', 'user', 'status', 'currency', 'total', 'amount_paid', 'due_date', 'created_at']
    list_filter = ['status', 'currency', 'is_recurring', 'reminders_enabled']
    search_fields = ['invoice_number', 'client_name', 'client_email', 'user__email']
    readonly_fields = ['view_token', 'created_at', 'updated_at']
    inlines = [InvoiceItemInline]


@admin.register(InvoicePartialPayment)
class InvoicePartialPaymentAdmin(admin.ModelAdmin):
    list_display = ['invoice', 'amount', 'currency', 'source', 'payment_date', 'recorded_at']
    list_filter = ['source', 'currency']
    search_fields = ['invoice__invoice_number']
    readonly_fields = ['recorded_at']


@admin.register(InvoiceReminder)
class InvoiceReminderAdmin(admin.ModelAdmin):
    list_display = ['invoice', 'reminder_number', 'template_used', 'sent_at', 'delivered']
    list_filter = ['template_used', 'delivered']
    search_fields = ['invoice__invoice_number']
    readonly_fields = ['sent_at']


@admin.register(InvoiceViewEvent)
class InvoiceViewEventAdmin(admin.ModelAdmin):
    list_display = ['invoice', 'viewed_at', 'source', 'ip_address']
    list_filter = ['source']
    search_fields = ['invoice__invoice_number']
    readonly_fields = ['viewed_at']


@admin.register(InvoiceComment)
class InvoiceCommentAdmin(admin.ModelAdmin):
    list_display = ['invoice', 'author_type', 'source', 'created_at']
    list_filter = ['author_type', 'source']
    search_fields = ['invoice__invoice_number', 'client_email', 'author_user__email']
    readonly_fields = ['created_at']


@admin.register(PaymentClaim)
class PaymentClaimAdmin(admin.ModelAdmin):
    list_display = ['invoice', 'client_email', 'amount_claimed', 'currency', 'status', 'submitted_at']
    list_filter = ['status', 'payment_source']
    search_fields = ['invoice__invoice_number', 'client_email']
    readonly_fields = ['submitted_at']


@admin.register(InvoiceDesign)
class InvoiceDesignAdmin(admin.ModelAdmin):
    list_display = ['name', 'user', 'base_template', 'source', 'is_default', 'updated_at']
    list_filter = ['base_template', 'source', 'is_default']
    search_fields = ['name', 'user__email']
    readonly_fields = ['created_at', 'updated_at']


class InvoicePresetItemInline(admin.TabularInline):
    model = InvoicePresetItem
    extra = 0


@admin.register(InvoicePreset)
class InvoicePresetAdmin(admin.ModelAdmin):
    list_display = ['name', 'user', 'currency', 'is_default', 'updated_at']
    list_filter = ['currency', 'is_default']
    search_fields = ['name', 'user__email']
    readonly_fields = ['created_at', 'updated_at']
    inlines = [InvoicePresetItemInline]
