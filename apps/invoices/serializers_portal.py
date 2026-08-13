# apps/invoices/serializers_portal.py
"""
Client-facing invoice serializers — Step 12. Deliberately NOT
InvoiceListSerializer/InvoiceDetailSerializer (serializers.py) reused
verbatim: those carry freelancer-only fields (reminder_count,
last_reminder_sent_at, escalation_required/dismissed, sent_via_platform,
recurring_* internals, the raw client FK id) that have no business being
visible to the client on the other end of a portal session. A real,
separate, minimal allowlist instead — same explicit-`fields=` discipline
serializers.py's own docstring establishes.
"""
from rest_framework import serializers

from .models import Invoice
from .serializers import InvoiceItemSerializer


class PortalInvoiceListSerializer(serializers.ModelSerializer):
    """
    GET /api/invoices/portal/me/ — one row per invoice in the client's
    own list. No line items, no notes/terms — just enough to identify,
    sort, and link to the real view page. `portal_view_url` exposes the
    pre-built URL (Invoice.portal_view_url), never the raw view_token
    itself — the frontend needs a real navigation target (item 7's
    non-SPA <a href> exception), not the credential.
    """
    days_overdue = serializers.IntegerField(read_only=True)
    outstanding_amount = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    portal_view_url = serializers.CharField(read_only=True)

    class Meta:
        model = Invoice
        fields = [
            'id', 'invoice_number', 'status', 'currency',
            'total', 'amount_paid', 'outstanding_amount',
            'issue_date', 'due_date', 'days_overdue', 'portal_view_url',
        ]


class PortalInvoiceDetailSerializer(serializers.ModelSerializer):
    """GET /api/invoices/portal/<pk>/ — one invoice's full client-visible detail, including line items and the notes/terms that already render on the invoice document itself (never private freelancer data)."""
    items = InvoiceItemSerializer(many=True, read_only=True)
    days_overdue = serializers.IntegerField(read_only=True)
    outstanding_amount = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    portal_view_url = serializers.CharField(read_only=True)
    payment_page_url = serializers.CharField(read_only=True)

    class Meta:
        model = Invoice
        fields = [
            'id', 'invoice_number', 'status', 'currency',
            'client_name', 'client_email', 'client_company',
            'subtotal', 'tax_rate', 'tax_amount', 'discount_amount', 'total', 'amount_paid', 'outstanding_amount',
            'issue_date', 'due_date', 'paid_date', 'sent_at', 'days_overdue',
            'notes', 'terms',
            'items', 'portal_view_url', 'payment_page_url',
        ]
