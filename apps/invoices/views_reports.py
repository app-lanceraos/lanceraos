# apps/invoices/views_reports.py
"""
The two money-report PDF downloads (Prompt 16): GET /api/payments/pnl/pdf/ and
GET /api/payments/income-certificate/pdf/. They live in apps.invoices (WeasyPrint and the fonts are here;
apps.payments may not import this app) and are registered at /api/payments/... in config/urls.py, exactly
like the client statement PDF (views_statement.py). The JSON siblings and all the maths are in
apps.payments (views_reports.py, report.py).

Both PDF endpoints share ONE rate-limit bucket: a render costs real CPU inside the web process.
"""
import logging
import time

from django.http import HttpResponse
from django.utils import timezone
from rest_framework import serializers
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.payments.http import bad_request, no_store, parse_range_params, too_many_requests
from apps.payments.validators import validate_currency_code
from core.observability import log_event
from core.ratelimit import rate_limited

from . import report_pdf

logger = logging.getLogger(__name__)

PDFS_PER_HOUR = 30
RENDER_FAILED = 'Could not create the PDF. Please try again.'
NO_PAYMENTS = 'You have no payments in this period, so there is nothing to put in the statement.'


def _pdf_response(pdf_bytes, filename):
    response = HttpResponse(pdf_bytes, content_type='application/pdf')
    response['Content-Disposition'] = f'attachment; filename="{filename}"'
    return response


def _parse_bool(request, name):
    """Returns (bool, error message or None). Absent is False; only 'true' and 'false' are accepted."""
    raw = request.query_params.get(name)
    if raw is None:
        return False, None
    if raw == 'true':
        return True, None
    if raw == 'false':
        return False, None
    return False, f'{name} must be true or false.'


def _parse_addressed_to(request):
    """Returns (text, error). Plain text up to 100 characters after stripping; any control character (a newline too) is refused."""
    text = (request.query_params.get('addressed_to') or '').strip()
    if len(text) > report_pdf.ADDRESSED_TO_MAX or any(ord(ch) < 32 or ord(ch) == 127 for ch in text):
        return '', 'addressed_to must be plain text of up to 100 characters.'
    return text, None


@no_store
@api_view(['GET'])
@permission_classes([IsAuthenticated])
def pnl_pdf(request):
    """Profit and Loss as a PDF for ?start=&end=&currency=. document_type 'pnl'. Writes no audit row."""
    if rate_limited(f'reports:pdf:{request.user.pk}', PDFS_PER_HOUR):
        return too_many_requests()
    start, end, error = parse_range_params(request, timezone.now().date())
    if error:
        return bad_request(error)
    currency = request.query_params.get('currency')
    if currency:
        try:
            currency = validate_currency_code(currency)
        except serializers.ValidationError as exc:
            return bad_request(str(exc.detail[0]))

    started = time.perf_counter()
    try:
        pdf_bytes = report_pdf.render_pnl_pdf(report_pdf.build_pnl_context(request.user, start, end, currency))
    except Exception:
        logger.exception('[PDF] P&L render failed for user %s', request.user.pk)
        report_pdf.log_pdf_attempt('pnl', request, started, False)
        return Response({'error': RENDER_FAILED}, status=500)
    report_pdf.log_pdf_attempt('pnl', request, started, True)
    return _pdf_response(pdf_bytes, report_pdf.attachment_filename('profit_and_loss', start, end))


@no_store
@api_view(['GET'])
@permission_classes([IsAuthenticated])
def income_statement_pdf(request):
    """
    The Statement of Income as a PDF for ?start=&end=&purpose=&addressed_to=&include_cnic=&include_ntn=.
    document_type 'certificate'. Refused when the period has no convertible payment. The CNIC and NTN are
    printed only when asked for and only when saved. Writes the audit event income_statement_generated.
    """
    if rate_limited(f'reports:pdf:{request.user.pk}', PDFS_PER_HOUR):
        return too_many_requests()
    start, end, error = parse_range_params(request, timezone.now().date())
    if error:
        return bad_request(error)

    purpose = request.query_params.get('purpose') or report_pdf.DEFAULT_PURPOSE
    if purpose not in report_pdf.PURPOSE_LINES:
        return bad_request('Unknown purpose.')
    addressed_to, error = _parse_addressed_to(request)
    if error:
        return bad_request(error)
    include_cnic, error = _parse_bool(request, 'include_cnic')
    if error:
        return bad_request(error)
    include_ntn, error = _parse_bool(request, 'include_ntn')
    if error:
        return bad_request(error)

    profile = request.user.profile
    if include_cnic and not profile.cnic_encrypted:
        return bad_request('You asked to show your CNIC, but none is saved. Add it in Settings, then Tax and PSEB.')
    if include_ntn and not profile.ntn_encrypted:
        return bad_request('You asked to show your NTN, but none is saved. Add it in Settings, then Tax and PSEB.')

    options = {'purpose': purpose, 'addressed_to': addressed_to, 'include_cnic': include_cnic, 'include_ntn': include_ntn}
    started = time.perf_counter()
    try:
        context = report_pdf.build_income_statement_context(request.user, start, end, options)
        if not context['has_payments']:
            return bad_request(NO_PAYMENTS)
        pdf_bytes = report_pdf.render_income_statement_pdf(context)
    except Exception:
        logger.exception('[PDF] Statement render failed for user %s', request.user.pk)
        report_pdf.log_pdf_attempt('certificate', request, started, False)
        return Response({'error': RENDER_FAILED}, status=500)
    report_pdf.log_pdf_attempt('certificate', request, started, True)
    # Strings and booleans only: no amount, no name, never a CNIC or NTN.
    log_event('income_statement_generated', user=request.user, request=request, metadata={
        'start': start.isoformat(), 'end': end.isoformat(), 'purpose': purpose,
        'include_cnic': include_cnic, 'include_ntn': include_ntn,
    })
    return _pdf_response(pdf_bytes, report_pdf.attachment_filename('income_statement', start, end))
