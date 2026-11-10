# apps/invoices/views_tax_pdf.py
"""
The Tax Summary PDF download (Prompt 20): GET /api/tax/summary/pdf/. It lives in apps.invoices (WeasyPrint and the
fonts are here; apps.tax may not import this app) and is registered at /api/tax/... in config/urls.py, BEFORE the
apps.tax include, exactly like the report PDFs. It shares the report PDFs' rate-limit bucket: a render costs real CPU.
"""
import logging
import time

from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.payments.http import bad_request, no_store, too_many_requests
from apps.tax import service
from core.observability import log_event
from core.ratelimit import rate_limited

from . import report_pdf, tax_pdf
from .views_reports import PDFS_PER_HOUR, RENDER_FAILED, _parse_bool, _pdf_response

logger = logging.getLogger(__name__)

NO_PAYMENTS = 'You have no payments in this tax year, so there is nothing to put in the summary.'
NO_NTN = 'You asked to show your NTN, but none is saved. Add it in Settings, then Tax and PSEB.'


@no_store
@api_view(['GET'])
@permission_classes([IsAuthenticated])
def tax_summary_pdf(request):
    """
    The Tax Summary (estimate) as a PDF for ?tax_year=&include_ntn=. document_type 'tax_summary'. Refused when the
    tax year has no payment at all. The NTN is printed only when asked for and only when saved. Writes the audit
    event tax_summary_generated (the tax year and one boolean; never an amount, a name or an NTN).
    """
    if rate_limited(f'reports:pdf:{request.user.pk}', PDFS_PER_HOUR):
        return too_many_requests()
    tax_year, stale_law, error = service.parse_tax_year(request.query_params.get('tax_year'), service.today())
    if error:
        return bad_request(error)
    include_ntn, error = _parse_bool(request, 'include_ntn')
    if error:
        return bad_request(error)
    if include_ntn and not request.user.profile.ntn_encrypted:
        return bad_request(NO_NTN)

    started = time.perf_counter()
    try:
        context = tax_pdf.build_tax_summary_context(request.user, tax_year, include_ntn, stale_law)
        if not context['has_payments']:
            return bad_request(NO_PAYMENTS)
        pdf_bytes = tax_pdf.render_tax_summary_pdf(context)
    except Exception:
        logger.exception('[PDF] Tax summary render failed for user %s', request.user.pk)
        report_pdf.log_pdf_attempt('tax_summary', request, started, False)
        return Response({'error': RENDER_FAILED}, status=500)
    report_pdf.log_pdf_attempt('tax_summary', request, started, True)
    log_event('tax_summary_generated', user=request.user, request=request, metadata={
        'tax_year': tax_year, 'include_ntn': include_ntn,
    })
    return _pdf_response(pdf_bytes, tax_pdf.attachment_filename(tax_year))
