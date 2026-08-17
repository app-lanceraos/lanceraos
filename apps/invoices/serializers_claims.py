# apps/invoices/serializers_claims.py
"""
PaymentClaim serializers — Step 14. Same explicit-`fields=` allowlist
discipline as serializers_comments.py.

PortalClaimCreateSerializer: client-submitted fields only — no `status`,
`reviewed_at`, `review_note`, `client_email`/`client_name` (those are
server-derived, never client-writable, matching CommentCreateSerializer's
identical precedent for author_type/client_name/client_email there).

PaymentClaimSerializer: freelancer-facing read representation — every
real field, since this is the freelancer's own review surface.
"""
from rest_framework import serializers

from apps.clients.serializers import validate_currency_code

from .models import PaymentClaim


class PortalClaimCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = PaymentClaim
        fields = ['payment_source', 'amount_claimed', 'currency', 'payment_date', 'client_note']

    def validate_currency(self, value):
        return validate_currency_code(value)

    def validate_amount_claimed(self, value):
        """
        FIXED (item 5 of the 16 August 2026 second verification pass —
        real, confirmed gap): a client could submit a claim for MORE than
        the invoice's real outstanding_amount, which then just sat there
        as a "pending" claim until the freelancer eventually tried to
        confirm it — invoice_claim_confirm's own InvoicePartialPaymentSerializer
        would reject it there (that confirm-time protection already
        existed and is unchanged), but by then the client had already
        gotten a false "submitted!" success. Now rejected immediately at
        submission, with the same real-balance-check pattern
        InvoicePartialPaymentSerializer.validate_amount (serializers.py)
        already established for the freelancer's own manual-payment entry
        — not a second, independently-invented cap.

        `invoice` only present in context when the caller supplies it
        (portal_invoice_claims, views_portal.py) — never raises on a
        missing context key, matching that same precedent's own
        defensive `if invoice is not None` guard.
        """
        if value <= 0:
            raise serializers.ValidationError('Claimed amount must be greater than zero.')
        invoice = self.context.get('invoice')
        if invoice is not None and value > invoice.outstanding_amount:
            raise serializers.ValidationError(
                f'Claimed amount cannot exceed the outstanding balance of {invoice.outstanding_amount} {invoice.currency}.'
            )
        return value


class PaymentClaimSerializer(serializers.ModelSerializer):
    class Meta:
        model = PaymentClaim
        fields = [
            'id', 'client_name', 'client_email', 'amount_claimed', 'currency',
            'payment_source', 'payment_date', 'client_note', 'status',
            'submitted_at', 'reviewed_at', 'review_note',
        ]
        read_only_fields = fields
