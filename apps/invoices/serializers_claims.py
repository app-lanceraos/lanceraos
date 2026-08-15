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
        if value <= 0:
            raise serializers.ValidationError('Claimed amount must be greater than zero.')
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
