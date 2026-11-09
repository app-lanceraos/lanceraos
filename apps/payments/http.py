# apps/payments/http.py
"""
Small HTTP helpers shared by the Payments views, the Expenses views and the invoice-side link views.
The date and paging parsers and the 400 builder were promoted here from views.py (Prompt 14) so the
expense views do not copy them.
"""
import functools

from django.utils.dateparse import parse_date
from rest_framework import status
from rest_framework.response import Response

from . import report

DEFAULT_LIMIT = 20
MAX_LIMIT = 100


def no_store(view):
    """
    Adds `Cache-Control: no-store` to EVERY response of the wrapped view, DRF's own 400/401/405
    included. Apply it OUTSIDE @api_view: money data must never sit in a shared cache or the
    browser's back/forward cache.
    """
    @functools.wraps(view)
    def wrapper(request, *args, **kwargs):
        response = view(request, *args, **kwargs)
        response['Cache-Control'] = 'no-store'
        return response
    return wrapper


def too_many_requests():
    return Response({'error': 'Too many requests. Please try again later.'}, status=status.HTTP_429_TOO_MANY_REQUESTS)


def bad_request(message):
    """A 400 in the project's `{"error": "..."}` shape."""
    return Response({'error': message}, status=status.HTTP_400_BAD_REQUEST)


def parse_date_param(raw):
    """Returns (date or None, error message or None); an empty value is (None, None)."""
    if not raw:
        return None, None
    try:
        parsed = parse_date(raw)  # None for a wrong shape, ValueError for a well-shaped impossible date (2026-13-45)
    except ValueError:
        parsed = None
    if parsed is None:
        return None, 'Invalid date, use YYYY-MM-DD.'
    return parsed, None


def parse_paging(request):
    """Returns (limit, offset, error message or None); limit is clamped to 1..MAX_LIMIT, offset to >= 0."""
    try:
        limit = int(request.query_params.get('limit', DEFAULT_LIMIT))
        offset = int(request.query_params.get('offset', 0))
    except (TypeError, ValueError):
        return None, None, 'limit and offset must be whole numbers.'
    return max(1, min(limit, MAX_LIMIT)), max(0, offset), None


def parse_range_params(request, today):
    """
    Returns (start, end, error message or None) for a report endpoint. Both dates are optional: an omitted
    `start` is 1 January of the current year and an omitted `end` is today (report.default_range). A
    malformed date and any period report.validate_range refuses are the error.
    """
    default_start, default_end = report.default_range(today)
    start, error = parse_date_param(request.query_params.get('start'))
    if error:
        return None, None, error
    end, error = parse_date_param(request.query_params.get('end'))
    if error:
        return None, None, error
    start, end = start or default_start, end or default_end
    error = report.validate_range(start, end, today)
    if error:
        return None, None, error
    return start, end, None
