# apps/tax/views.py
"""
The three Tax JSON endpoints (decision T10): 240 requests/hour per user each, in separate buckets,
`Cache-Control: no-store` on every response (errors included). Function views, every query scoped to
request.user. The summary PDF lives in apps/invoices (views_tax_pdf.py) because WeasyPrint is there.
Nothing is stored; the figures are computed live.
"""
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.payments.http import bad_request, no_store, too_many_requests
from core.ratelimit import rate_limited

from . import calc, service

READS_PER_HOUR = 240


@no_store
@api_view(['GET'])
@permission_classes([IsAuthenticated])
def tax_overview(request):
    """The tax estimate for ?tax_year=2026|2027 (default: the current tax year): receipts, rate, estimate, checklist, notes."""
    if rate_limited(f'tax:overview:{request.user.pk}', READS_PER_HOUR):
        return too_many_requests()
    today = service.today()
    year, stale, error = service.parse_tax_year(request.query_params.get('tax_year'), today)
    if error:
        return bad_request(error)
    return Response(service.public_overview(service.build_overview(request.user, year, stale, today)))


@no_store
@api_view(['GET'])
@permission_classes([IsAuthenticated])
def tax_law(request):
    """The sourced facts behind the numbers: what is known, how sure we are, and where it came from."""
    if rate_limited(f'tax:law:{request.user.pk}', READS_PER_HOUR):
        return too_many_requests()
    return Response(service.build_law())


@no_store
@api_view(['POST'])
@permission_classes([IsAuthenticated])
def tax_calculator(request):
    """Normal slab tax for a non-salaried individual on a typed taxable income. Pure arithmetic: nothing is stored or logged."""
    if rate_limited(f'tax:calc:{request.user.pk}', READS_PER_HOUR):
        return too_many_requests()
    # JSON only: a form-encoded body would arrive as a QueryDict of strings, which the spec does not accept.
    body = request.data if (request.content_type or '').startswith('application/json') else None
    income, year, error = service.parse_calculator_input(body, service.today())
    if error:
        return bad_request(error)
    try:
        return Response(service.build_slab_result(income, year))
    except calc.SurchargeUnverified:
        return bad_request(service.SURCHARGE_UNVERIFIED_ERROR)
