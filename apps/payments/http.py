# apps/payments/http.py
"""Small HTTP helpers shared by the Payments views and the invoice-side link views."""
import functools

from rest_framework import status
from rest_framework.response import Response


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
