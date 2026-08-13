# apps/invoices/views_portal.py
"""
Client Portal — invoice content, Step 12. Lives in apps.invoices (not
apps.clients) per INVOICES_CLIENTS_TECHNICAL_SPEC.md Section 2's
one-directional dependency rule: "Portal content — viewing invoices,
posting/reading comments, submitting payment claims — imports the
client-identity/session utility from apps.clients." Every import below
crosses that direction only (apps.invoices -> apps.clients), never the
reverse — confirmed the same way Step 11 confirmed apps.clients had zero
apps.invoices imports; see this step's own tests.

Two real portal-entry semantics, both landing on portal_invoice_view_html:
  - A SAVED client's invoice (invoice.client_id set): visiting it mints/
    renews a full ClientPortalSession for that client (via
    apps.clients.portal.issue_or_renew_session) — one click on any
    invoice link grants access to that client's entire portal (list +
    every other invoice), matching Step 11's Client.portal_token link as
    a second real entry point into the exact same session mechanism.
  - A ONE-TIME client's invoice (invoice.client_id is null,
    is_one_time_client=True): renders the identical page, but creates NO
    ClientPortalSession — there's no Client row to attach one to. Access
    is scoped to this exact invoice only, via its own view_token.

The actual invoice HTML is never a second, hand-built reimplementation
of the PDF layout — render_invoice_portal_html (pdf_generator.py) reuses
the exact same Django template _select_template_name already picks for
the PDF, just with browser-fetchable font URLs instead of WeasyPrint's
file:// ones. Preview-as-Client (invoice_preview_as_client, below) calls
that same renderer too — one shared renderer, three total consumers
(PDF, portal view, freelancer preview).
"""
import logging

from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from core.events import emit
from core.observability import get_client_ip, get_user_agent

from apps.clients.portal import is_freelancer_previewing_portal, issue_or_renew_session, resolve_session_from_request

from .models import Invoice, InvoiceViewEvent
from .pdf_generator import render_invoice_portal_html
from .serializers_portal import PortalInvoiceDetailSerializer, PortalInvoiceListSerializer

logger = logging.getLogger(__name__)


def _record_invoice_view_if_appropriate(invoice, request):
    """
    The one real "a client viewed this invoice" side effect, called
    exactly once (from portal_invoice_view_html) — never from
    invoice_preview_as_client below, which is a structurally separate,
    freelancer-only endpoint with no view-tracking code path to guard in
    the first place.

    ONE shared guard check gates BOTH real side effects together (the
    Sent->Viewed status transition and the InvoiceViewEvent write) —
    not two separate calls to is_freelancer_previewing_portal that could
    drift out of sync. Per the spec: a freelancer who clicked their own
    client's magic link without logging out of their own LanceraOS
    account first must never have that count as a real client view.
    """
    if is_freelancer_previewing_portal(request):
        return

    InvoiceViewEvent.objects.create(
        invoice=invoice, source='platform_view',
        ip_address=get_client_ip(request), user_agent=get_user_agent(request)[:300],
    )

    if invoice.status == 'sent':
        invoice.status = 'viewed'
        invoice.save(update_fields=['status'])

    emit('InvoiceViewed', invoice_id=str(invoice.pk), user_id=str(invoice.user_id))


@api_view(['GET'])
@permission_classes([AllowAny])
def portal_invoice_list(request):
    """
    The client's own invoice list — portal-session-authenticated via
    apps.clients.portal.resolve_session_from_request, NOT apps.users
    auth (there is no freelancer login involved on this side at all).
    401, not empty-list, when no valid session is present — a client
    with no session shouldn't see "you have zero invoices," they should
    see "you're not logged in."
    """
    client = resolve_session_from_request(request)
    if client is None:
        return Response({'error': 'No active portal session.'}, status=status.HTTP_401_UNAUTHORIZED)

    invoices = Invoice.objects.filter(client=client).order_by('-issue_date', '-created_at')
    return Response(PortalInvoiceListSerializer(invoices, many=True).data)


@api_view(['GET'])
@permission_classes([AllowAny])
def portal_invoice_detail(request, pk):
    """
    A single invoice's client-visible detail — scoped to invoices
    belonging to the resolved Client only. A real 404, not 403, for any
    invoice belonging to someone else (a different client of this same
    freelancer, or a different freelancer entirely) — this must not
    confirm to an unauthorized viewer that a given invoice id even
    exists, the same reasoning portal_invoice_view_html's own unknown-
    token handling already follows.
    """
    client = resolve_session_from_request(request)
    if client is None:
        return Response({'error': 'No active portal session.'}, status=status.HTTP_401_UNAUTHORIZED)

    invoice = get_object_or_404(Invoice, pk=pk, client=client)
    return Response(PortalInvoiceDetailSerializer(invoice).data)


@api_view(['GET'])
@permission_classes([AllowAny])
def portal_invoice_view_html(request, view_token):
    """
    The real rendered HTML page (Content-Type text/html, not JSON) —
    matching invoice_pdf's existing live-render pattern but serving HTML
    via render_invoice_portal_html + the same template selection logic
    the PDF path uses. Public/unauthenticated by design (view_token
    itself is the credential, same trust model as
    GET /api/invoices/public/<token>/ elsewhere in this app) — a real
    404 for an unknown token, not a redirect or an empty page, so an
    invalid link doesn't look like "this invoice was deleted" or leak
    which tokens almost matched.
    """
    invoice = get_object_or_404(Invoice, view_token=view_token)

    html = render_invoice_portal_html(invoice)
    response = HttpResponse(html, content_type='text/html')

    if invoice.client_id:
        issue_or_renew_session(invoice.client, request, response)
    # else: a one-time client's invoice — no Client row to attach a
    # session to. Access stays scoped to this exact invoice's own
    # view_token, per the spec's "no portal, no session" rule.

    _record_invoice_view_if_appropriate(invoice, request)

    return response


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def invoice_preview_as_client(request, pk):
    """
    Preview-as-Client — freelancer-facing, reachable from
    InvoiceDetailPanel, NOT the public portal. Renders the exact same
    HTML render_invoice_portal_html produces for a real client (the same
    shared renderer portal_invoice_view_html uses), inside an
    authenticated-app context — the frontend wraps this in an iframe with
    its own persistent "You're previewing as [client]" banner (pure React
    chrome, never part of the shared template itself, so the two render
    paths' actual markup never diverges).

    Deliberately does NOT call apps.clients.portal.issue_or_renew_session
    (confirmed directly: not imported anywhere in this module) — this is
    the freelancer's own authenticated request, never a real portal
    entry, and must never mint a real ClientPortalSession. Also never
    calls _record_invoice_view_if_appropriate — a freelancer previewing
    their own invoice is not a client view to track, and this endpoint
    has no view-tracking code path to guard in the first place.

    Requires a real client — a one-time-client invoice has no portal
    identity to preview as (there's no Client, no portal_token, nothing
    a real client would ever visit for this invoice beyond its own
    view_token page, which already renders identically either way).
    """
    invoice = get_object_or_404(Invoice, pk=pk, user=request.user)
    if not invoice.client_id:
        return Response(
            {'error': 'This invoice has no client to preview as — it was created for a one-time client.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    html = render_invoice_portal_html(invoice)
    return HttpResponse(html, content_type='text/html')
