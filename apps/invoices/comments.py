# apps/invoices/comments.py
"""
Shared InvoiceComment creation helpers — used by the freelancer endpoint
(views.py's invoice_comments), the portal endpoint (views_portal.py's
portal_invoice_comments), and the inbound email-reply webhook
(views_email.py), so attachment validation and the WebSocket broadcast
happen in exactly one place, not three.
"""
import logging
import os

from django.utils import timezone
from PIL import Image as PILImage
from PIL import UnidentifiedImageError
from rest_framework import status
from rest_framework.response import Response

from apps.users.views.profile import ALLOWED_LOGO_EXTENSIONS, MAX_LOGO_SIZE_BYTES

logger = logging.getLogger(__name__)

# Item 9 of the verification pass — comment attachments now also accept
# PDFs, not images only (a client reporting a payment often has a bank
# receipt/statement as a PDF, not a photo). `.pdf` is deliberately its
# own allowlist, never merged into ALLOWED_LOGO_EXTENSIONS — a logo
# upload has no PDF use case at all, and this keeps that constant's own
# meaning (image formats a logo could realistically be) unchanged for
# its real callers.
ALLOWED_ATTACHMENT_EXTENSIONS = ALLOWED_LOGO_EXTENSIONS | {'.pdf'}


def upload_comment_attachment(file):
    """
    Returns a secure_url string on success, or a Response (400/502) on
    failure — callers must check `isinstance(result, Response)` before
    treating it as a URL. Same content-validation discipline as
    apps/users/views/profile.py's upload_logo (extension allowlist, size
    cap, real content-verified — not just a trusted extension) — not a
    separate approach invented for this one upload path.
    InvoiceComment.attachment_url is a single URLField (confirmed
    directly against the model — no attachment-count field, no M2M),
    so one attachment per comment is the real shape, not an assumption.

    Real, per-type SERVER-SIDE content validation, not extension-trust
    alone: an image is opened+verified via Pillow (same as upload_logo);
    a `.pdf`-extensioned file is opened via PyMuPDF (already a real
    project dependency — apps/invoices/pdf_generator.py's own PDF
    pipeline doesn't use it, but apps/invoices/tests/test_pdf_pipeline.py
    already does, for PDF-content assertions) — a file that merely has a
    `.pdf` name but isn't a real, openable PDF is rejected with the same
    clear error either category would get.
    """
    extension = os.path.splitext(file.name)[1].lower()
    if extension not in ALLOWED_ATTACHMENT_EXTENSIONS:
        return Response(
            {'error': f'Unsupported file type. Allowed: {", ".join(sorted(ALLOWED_ATTACHMENT_EXTENSIONS))}'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if file.size > MAX_LOGO_SIZE_BYTES:
        return Response({'error': 'File too large. Maximum size is 5MB.'}, status=status.HTTP_400_BAD_REQUEST)

    if extension == '.pdf':
        import fitz  # PyMuPDF — lazy import, matches this app's other lazy-import conventions
        try:
            doc = fitz.open(stream=file.read(), filetype='pdf')
            if doc.page_count < 1:
                raise ValueError('empty PDF')
            doc.close()
        except Exception:
            return Response({'error': "That doesn't look like a valid PDF file."}, status=status.HTTP_400_BAD_REQUEST)
        file.seek(0)
        resource_type = 'raw'
    else:
        try:
            PILImage.open(file).verify()
        except (UnidentifiedImageError, OSError):
            return Response({'error': "That doesn't look like a valid image file."}, status=status.HTTP_400_BAD_REQUEST)
        file.seek(0)
        resource_type = 'image'

    import cloudinary.uploader  # lazy import — same convention as every other Cloudinary call site in this app

    try:
        result = cloudinary.uploader.upload(file, folder='lanceraos/comment_attachments', resource_type=resource_type)
    except Exception:
        logger.exception('[INVOICES] Comment attachment upload failed.')
        return Response({'error': 'Upload failed. Please try again.'}, status=status.HTTP_502_BAD_GATEWAY)
    return result.get('secure_url', '')


def broadcast_comment(comment):
    """
    Real-time delivery to the invoice's thread group. No pre-existing
    NotificationConsumer/group_send precedent was found anywhere in this
    codebase to mirror (confirmed directly — only the design spec
    mentions one, never built; see DECISIONS.md) — this follows
    Channels' own standard type-dispatch convention instead (a
    'comment.message' event type dispatches to the consumer's
    async def comment_message(self, event) handler), the same technique
    v1-reference's NotificationConsumer used for an unrelated purpose.

    Never raises — a broadcast failure (channel layer down, no Redis)
    must not roll back or error out the HTTP/webhook response that
    already durably saved this comment to the database.
    """
    from asgiref.sync import async_to_sync
    from channels.layers import get_channel_layer

    from .serializers_comments import InvoiceCommentSerializer

    channel_layer = get_channel_layer()
    if channel_layer is None:
        return

    group_name = f'invoice_thread_{comment.invoice.view_token}'
    try:
        # DRF's own .data is already the JSON-ready representation
        # (Decimal/UUID/datetime already stringified by each field's
        # to_representation) — dict(...) just drops the OrderedDict
        # wrapper, nothing more needed before handing this to the
        # channel layer's own msgpack encoding.
        async_to_sync(channel_layer.group_send)(group_name, {
            'type': 'comment.message',
            'comment': dict(InvoiceCommentSerializer(comment).data),
        })
    except Exception:
        logger.exception('[INVOICES] Failed to broadcast comment_id=%s to WS group.', comment.pk)


def broadcast_read_state(invoice, field, comment_ids):
    """
    Item 3 of the 16 August 2026 second verification pass — real,
    confirmed gap: ClientThreadConsumer already broadcasts new comments
    (broadcast_comment, above), but read-state changes (the mark-read-on-
    view mechanism invoice_comments/portal_invoice_comments' own GET
    handlers already had) never reached the OTHER party's live connection
    at all — their seen/sent indicator only ever updated on a manual
    refetch. This is the read-state equivalent of broadcast_comment,
    same shared-group/never-raises contract, deliberately a SEPARATE
    'read_state.update' WS message type rather than reusing
    'comment.message' — the frontend needs to tell the two apart (a new
    comment gets appended to the thread; a read-state update only flips
    an existing message's seen/sent indicator) and a comment payload has
    no `event` key at all, so CommentThread.jsx discriminates on that
    field's presence without needing to touch the existing, tested
    broadcast_comment wire format.

    `field` is 'read_by_client_at' or 'read_by_freelancer_at' — whichever
    side's read timestamp just got set. `comment_ids` are the exact rows
    that were actually updated (never re-derived from a fresh query here,
    so this can't race against a second read happening between the
    caller's own UPDATE and this broadcast). No-ops immediately for an
    empty list — a GET that marked nothing new as read has nothing to
    tell anyone about.
    """
    if not comment_ids:
        return

    from asgiref.sync import async_to_sync
    from channels.layers import get_channel_layer

    channel_layer = get_channel_layer()
    if channel_layer is None:
        return

    group_name = f'invoice_thread_{invoice.view_token}'
    try:
        async_to_sync(channel_layer.group_send)(group_name, {
            'type': 'read_state.update',
            'field': field,
            'ids': [str(pk) for pk in comment_ids],
            'at': timezone.now().isoformat(),
        })
    except Exception:
        logger.exception('[INVOICES] Failed to broadcast read-state update for invoice_id=%s to WS group.', invoice.pk)
