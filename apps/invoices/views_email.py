# apps/invoices/views_email.py
"""
Inbound email-reply webhook — Step 13. POST /api/invoices/email/incoming/
is the landing point for the real Cloudflare Email Routing -> Worker ->
webhook chain apps/invoices/email_service.py's get_reply_to_address has
been producing outbound addresses for since Step 10
(reply+<view_token>@lanceraos.com) — this closes that gap for the first
time. No prior scaffolding existed for this endpoint: confirmed directly
before writing any code — no views_email.py, no CLOUDFLARE_WEBHOOK_SECRET
anywhere in settings.py/.env.example, no partial webhook route in
urls.py. Step 10/12 both explicitly deferred this and flagged it as
unbuilt, per their own docstrings.

Payload contract — this step's own reasonable design, since there is no
existing Cloudflare Worker config to match against: the shape virtually
every inbound-email-webhook provider (Postmark, SendGrid, Mailgun inbound
parse, etc.) already uses, so a real Cloudflare Email Worker forwarding
here needs only a thin translation layer, not a bespoke contract:
  {"from": "sender@example.com", "to": "reply+<token>@lanceraos.com",
   "subject": "...", "text": "plain body", "html": "<p>...</p>"}

Authenticated via a shared secret header (X-Webhook-Secret) matched
against the new CLOUDFLARE_WEBHOOK_SECRET setting — the standard approach
for this class of provider-to-backend webhook, and the one this step adds
since nothing pre-existing was there to reuse (confirmed directly).

Public-facing, fully untrusted input beyond the shared secret — every
validation failure below is a real, specific 400/403/404, logged
clearly, never a silent drop:
  - missing/wrong shared secret -> 403, before parsing anything else
  - recipient doesn't parse as reply+<token>@lanceraos.com -> 400
  - token doesn't match any real invoice -> 404
  - sender is neither the invoice's own client_email nor its freelancer's
    own email (a stranger somehow triggering this endpoint) -> 403
  - empty body -> 400
"""
import logging
import re

from django.conf import settings
from django.utils.html import strip_tags
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from core.events import emit

from .comments import broadcast_comment
from .models import Invoice, InvoiceComment

logger = logging.getLogger(__name__)

REPLY_ADDRESS_RE = re.compile(r'^reply\+([A-Za-z0-9_-]+)@lanceraos\.com$', re.IGNORECASE)


def _extract_view_token(to_address):
    match = REPLY_ADDRESS_RE.match((to_address or '').strip())
    return match.group(1) if match else None


@api_view(['POST'])
@permission_classes([AllowAny])
def email_incoming_webhook(request):
    provided_secret = request.headers.get('X-Webhook-Secret', '')
    expected_secret = getattr(settings, 'CLOUDFLARE_WEBHOOK_SECRET', '')
    if not expected_secret or provided_secret != expected_secret:
        logger.warning('[INVOICES] email_incoming_webhook: missing or invalid shared secret.')
        return Response({'error': 'Invalid webhook secret.'}, status=status.HTTP_403_FORBIDDEN)

    to_address = request.data.get('to', '')
    from_address = (request.data.get('from', '') or '').strip().lower()
    text_body = (request.data.get('text', '') or '').strip()
    html_body = request.data.get('html', '') or ''

    view_token = _extract_view_token(to_address)
    if not view_token:
        logger.warning('[INVOICES] email_incoming_webhook: recipient %r does not match reply+<token>@lanceraos.com.', to_address)
        return Response({'error': 'Recipient address is not a valid reply address.'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        invoice = Invoice.objects.select_related('user').get(view_token=view_token)
    except Invoice.DoesNotExist:
        logger.warning('[INVOICES] email_incoming_webhook: no invoice matches view_token from recipient %r.', to_address)
        return Response({'error': 'No matching invoice for this reply address.'}, status=status.HTTP_404_NOT_FOUND)

    invoice_client_email = (invoice.client_email or '').strip().lower()
    freelancer_email = (invoice.user.email or '').strip().lower()

    if from_address and from_address == invoice_client_email:
        author_type = 'client'
    elif from_address and from_address == freelancer_email:
        author_type = 'freelancer'
    else:
        logger.warning(
            '[INVOICES] email_incoming_webhook: sender %r is neither invoice %s\'s client (%r) nor its freelancer (%r) — rejected.',
            from_address, invoice.invoice_number, invoice_client_email, freelancer_email,
        )
        return Response({'error': 'Sender is not a party to this invoice thread.'}, status=status.HTTP_403_FORBIDDEN)

    body_text = text_body or strip_tags(html_body).strip()
    if not body_text and not html_body.strip():
        return Response({'error': 'Empty message body.'}, status=status.HTTP_400_BAD_REQUEST)

    comment_kwargs = {
        'invoice': invoice, 'author_type': author_type, 'source': 'email_reply',
        'body_text': body_text, 'body_html': html_body,
    }
    if author_type == 'freelancer':
        comment_kwargs['author_user'] = invoice.user
    else:
        comment_kwargs['client_name'] = invoice.client_name
        comment_kwargs['client_email'] = invoice.client_email

    comment = InvoiceComment.objects.create(**comment_kwargs)
    broadcast_comment(comment)
    emit('CommentPosted', invoice_id=str(invoice.pk), user_id=str(invoice.user_id), comment_id=str(comment.pk), author_type=author_type)
    logger.info('[INVOICES] Email-reply comment posted by %s on invoice %s.', author_type, invoice.invoice_number)
    return Response({'id': str(comment.pk)}, status=status.HTTP_201_CREATED)
