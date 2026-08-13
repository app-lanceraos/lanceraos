# apps/invoices/serializers_comments.py
"""
InvoiceComment serializers — Step 13. Explicit `fields=` allowlist only,
matching serializers.py's own established discipline.

One real write serializer (CommentCreateSerializer): `fields = ['body_text']`
only — author_type/author_user/client_name/client_email/source/
attachment_url/created_at/read_by_*_at are NEVER client-settable through
it, regardless of which endpoint uses it. Both real write paths
(invoice_comments in views.py, the freelancer's own post; portal_invoice_comments
in views_portal.py, a client's portal post) call serializer.save(...) with
those fields supplied as server-derived keyword arguments instead —
DRF's ModelSerializer.save(**kwargs) accepts extra fields not in `fields`
without them ever being writable FROM the request body. Attachment
upload/validation happens in the view before this serializer ever runs
(same Cloudinary content-validation discipline as apps/users/views/
profile.py's upload_logo — see that view's own docstring), not inside
this serializer, matching signature_upload's identical precedent
elsewhere in this app.
"""
from rest_framework import serializers

from core.email import sender_display_name

from .models import InvoiceComment


class CommentCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = InvoiceComment
        fields = ['body_text']

    def validate_body_text(self, value):
        if not value.strip():
            raise serializers.ValidationError('Comment cannot be empty.')
        return value


class InvoiceCommentSerializer(serializers.ModelSerializer):
    """
    Read representation — both the freelancer-side and portal-side
    comment lists use this exact same serializer (the thread looks
    identical from both sides, by design). `author_name` reuses
    core.email.sender_display_name for a freelancer-authored comment
    (business_name -> display_name -> full name -> username) rather than
    re-deriving that precedence a second time.
    """
    author_name = serializers.SerializerMethodField()

    class Meta:
        model = InvoiceComment
        fields = [
            'id', 'author_type', 'author_name', 'client_email', 'source',
            'body_text', 'body_html', 'attachment_url', 'created_at',
            'read_by_freelancer_at', 'read_by_client_at',
        ]

    def get_author_name(self, obj):
        if obj.author_type == 'freelancer':
            if obj.author_user:
                return sender_display_name(obj.author_user, getattr(obj.author_user, 'profile', None))
            return 'LanceraOS user'  # author_user anonymized (account deleted) — comment survives, per SET_NULL
        return obj.client_name or 'Client'
