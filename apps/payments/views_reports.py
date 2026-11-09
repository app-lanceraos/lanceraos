# apps/payments/views_reports.py
"""
The JSON side of the money reports (Prompt 16): the Profit and Loss and the Statement of Income preview.
Function views, every query scoped to request.user, every response `Cache-Control: no-store`. The
maths is in apps.payments.report; the two PDF downloads live in apps.invoices (views_reports.py there)
because WeasyPrint and the font files are there and this app may not import apps.invoices.
"""
from django.utils import timezone
from rest_framework import serializers
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from core.ratelimit import rate_limited

from . import report
from .http import bad_request, no_store, parse_range_params, too_many_requests
from .validators import validate_currency_code

READS_PER_HOUR = 240


@no_store
@api_view(['GET'])
@permission_classes([IsAuthenticated])
def pnl_report(request):
    """
    Profit and Loss for ?start=&end= (default: 1 January of this year to today) in ?currency= (default:
    the profile currency). Cash basis: money received minus money spent, by date. No tax figure.
    """
    if rate_limited(f'reports:pnl:{request.user.pk}', READS_PER_HOUR):
        return too_many_requests()
    today = timezone.now().date()
    start, end, error = parse_range_params(request, today)
    if error:
        return bad_request(error)
    currency = request.query_params.get('currency')
    if currency:
        try:
            currency = validate_currency_code(currency)
        except serializers.ValidationError as exc:
            return bad_request(str(exc.detail[0]))
    return Response(report.pnl(request.user, start, end, currency))


@no_store
@api_view(['GET'])
@permission_classes([IsAuthenticated])
def income_certificate_report(request):
    """
    The Statement of Income preview for ?start=&end=: what was received, in USD and the PKR equivalent,
    month by month. The same numbers the PDF prints; an empty period answers with zeros.
    """
    if rate_limited(f'reports:certificate:{request.user.pk}', READS_PER_HOUR):
        return too_many_requests()
    today = timezone.now().date()
    start, end, error = parse_range_params(request, today)
    if error:
        return bad_request(error)
    return Response(report.income_statement(request.user, start, end))
