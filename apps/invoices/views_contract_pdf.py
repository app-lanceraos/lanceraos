# apps/invoices/views_contract_pdf.py
"""
The two Contract PDF downloads (Prompt 22, decision K11): GET /api/contracts/<id>/pdf/ (the owner, any status) and
GET /api/contracts/public/<token>/pdf/ (the client, only once signed). They live in apps.invoices (WeasyPrint and the
fonts are here) and are registered in config/urls.py BEFORE the apps.contracts include, exactly like the tax summary.

The owner PDF shares the report PDFs' rate-limit bucket (`reports:pdf:{user}`, 30/hour): a render costs real CPU.
The public PDF is limited per IP. Neither writes IP addresses or browser strings anywhere; PDFs are rendered on demand
and never stored.
"""
import logging
import time

from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.decorators import api_view, authentication_classes, permission_classes, throttle_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from apps.contracts import copy as words
from apps.contracts.constants import PUBLIC_PDF_LIMIT_PER_HOUR, TOKEN_MAX_LENGTH
from apps.contracts.models import Contract
from core.observability import get_client_ip
from core.public_http import no_store
from core.ratelimit import rate_limited

from . import contract_pdf, report_pdf
from .views_reports import PDFS_PER_HOUR, _pdf_response

logger = logging.getLogger(__name__)


def _render_response(request, contract):
    """Renders `contract` and answers with the PDF, or a 500 in the project's error shape. Logs the one [PDF] line."""
    started = time.perf_counter()
    try:
        pdf_bytes = contract_pdf.render_contract_pdf(contract_pdf.build_contract_context(contract))
    except Exception:
        logger.exception('[PDF] Contract render failed for contract %s', contract.pk)
        report_pdf.log_pdf_attempt('contract', request, started, False)
        return Response({'error': words.RENDER_FAILED}, status=500)
    report_pdf.log_pdf_attempt('contract', request, started, True)
    return _pdf_response(pdf_bytes, contract_pdf.attachment_filename(contract))


@no_store
@api_view(['GET'])
@permission_classes([IsAuthenticated])
def contract_pdf_owner(request, pk):
    """The owner's PDF of one of their contracts, in any status (a draft is printed as a draft). document_type 'contract'."""
    if rate_limited(f'reports:pdf:{request.user.pk}', PDFS_PER_HOUR):
        return Response({'error': 'Too many requests. Please try again later.'}, status=status.HTTP_429_TOO_MANY_REQUESTS)
    contract = get_object_or_404(Contract.objects.select_related('user__profile'), pk=pk, user=request.user)
    return _render_response(request, contract)


@no_store
@api_view(['GET'])
@authentication_classes([])
@permission_classes([AllowAny])
@throttle_classes([])
def contract_pdf_public(request, view_token):
    """
    The signed copy for the client. 404 for an unknown, over-long or draft token (the same body as the public page);
    409 `not_signed` for any contract that is not signed yet. 20 per hour per IP.
    """
    if rate_limited(f'ratelimit_contracts_public_pdf_{get_client_ip(request) or "unknown"}', PUBLIC_PDF_LIMIT_PER_HOUR):
        return Response({'error': words.TOO_MANY_REQUESTS}, status=status.HTTP_429_TOO_MANY_REQUESTS)
    if len(view_token) > TOKEN_MAX_LENGTH:
        return Response({'error': words.NOT_FOUND}, status=status.HTTP_404_NOT_FOUND)
    contract = Contract.objects.select_related('user__profile').filter(view_token=view_token).first()
    if contract is None or contract.status == 'draft':
        return Response({'error': words.NOT_FOUND}, status=status.HTTP_404_NOT_FOUND)
    if contract.status != 'signed':
        return Response({'error': words.NOT_SIGNED_YET, 'reason': 'not_signed'}, status=status.HTTP_409_CONFLICT)
    return _render_response(request, contract)
