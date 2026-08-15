# apps/invoices/views_statement.py
"""
Client Statement PDF — Step 19. Lives in apps.invoices (needs
Invoice/InvoicePartialPayment data + the shared WeasyPrint pipeline),
registered at a clients-prefixed URL directly in config/urls.py — the
same "a view that doesn't cleanly belong to one app's own urls.py gets
wired at the root" precedent core/notifications.py's own endpoints
already established (list_notifications et al., config/urls.py). Confirmed
directly: INVOICES_CLIENTS_TECHNICAL_SPEC.md Section 7 lists this exact
path (GET /api/clients/<uuid:pk>/statement/pdf/) under apps/clients/'s own
endpoint group, but the one-directional apps.invoices -> apps.clients
dependency rule means apps.clients itself can never import from
apps.invoices — this satisfies the spec's URL shape without violating
that rule, the same way apps.invoices already imports apps.clients.models.Client
elsewhere (Step 18's analytics) but never the reverse.

Freelancer-facing only — confirmed directly, not assumed: the spec names
no client-portal-facing equivalent anywhere (INVOICES_CLIENTS_TECHNICAL_SPEC.md
Section 7's portal endpoint group has no statement route at all, and
Section 15 #6 — the note that says "content/layout design happens here"
— doesn't exist as a real section in this document either, the same kind
of stale cross-reference DATABASE.md's own invoice_designs entry already
flagged for "Section 9/10"). CLAUDE.md's own module status text only
ever describes this as a freelancer action. Flagged here rather than
silently deciding either way — a future step could add a portal-facing
version if that's ever genuinely needed.

Live-rendered on every request — no frozen-artifact concept here, unlike
a sent invoice's PDF (which freezes at finalise). A statement reflects
whatever the requested date range's current data says; regenerating on
each call is correct, not a gap to fix.
"""
import logging
from datetime import timedelta

from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.dateparse import parse_date
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.clients.models import Client

from .pdf_generator import render_client_statement_pdf

logger = logging.getLogger(__name__)

# A real, bounded default when start/end aren't supplied — never "all
# time" (the task's own explicit instruction). One trailing year is a
# reasonable, common statement-period default; both params can still be
# passed explicitly to cover any other real range.
DEFAULT_STATEMENT_WINDOW_DAYS = 365


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def client_statement_pdf(request, pk):
    """
    ?start=&end=, both optional, YYYY-MM-DD — defaults to the trailing
    DEFAULT_STATEMENT_WINDOW_DAYS ending today when omitted, never an
    unbounded "everything" query. A malformed date, or start after end,
    is a real 400, not a silently-corrected range.
    """
    client = get_object_or_404(Client, pk=pk, user=request.user)

    start_param = request.query_params.get('start')
    end_param = request.query_params.get('end')

    today = timezone.now().date()
    end_date = parse_date(end_param) if end_param else today
    if end_param and end_date is None:
        return Response({'error': 'end must be a real date in YYYY-MM-DD format.'}, status=status.HTTP_400_BAD_REQUEST)

    start_date = parse_date(start_param) if start_param else (end_date - timedelta(days=DEFAULT_STATEMENT_WINDOW_DAYS))
    if start_param and start_date is None:
        return Response({'error': 'start must be a real date in YYYY-MM-DD format.'}, status=status.HTTP_400_BAD_REQUEST)

    if start_date > end_date:
        return Response({'error': 'start must be on or before end.'}, status=status.HTTP_400_BAD_REQUEST)

    pdf_bytes = render_client_statement_pdf(client, start_date, end_date)
    response = HttpResponse(pdf_bytes, content_type='application/pdf')
    safe_name = ''.join(c if c.isalnum() else '_' for c in client.name) or 'client'
    filename = f'statement_{safe_name}_{start_date.isoformat()}_{end_date.isoformat()}.pdf'
    response['Content-Disposition'] = f'attachment; filename="{filename}"'
    logger.info('[INVOICES] Client statement PDF generated for client %s (%s to %s).', client.pk, start_date, end_date)
    return response
