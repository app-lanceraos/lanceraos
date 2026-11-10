# core/public_http.py
"""
Small HTTP helpers shared by every no-login public page (the Proposals client page and the Contracts client page).
Promoted out of apps/proposals/views_public.py (Prompt 22, Part 0) so a second public page does not carry a second
copy of security code. Behaviour is identical to the originals.
"""
import ipaddress
from functools import wraps

from core.observability import get_client_ip


def no_store(view):
    """
    Adds `Cache-Control: no-store` to EVERY response of the wrapped view,
    errors and DRF's own 405 included. Applied outside @api_view; functools.wraps
    carries the csrf_exempt marker across, so the view stays exempt (it carries
    no ambient credential — see proposal_public_respond).
    """
    @wraps(view)
    def wrapper(*args, **kwargs):
        response = view(*args, **kwargs)
        response['Cache-Control'] = 'no-store'
        return response
    return wrapper


def safe_ip(request):
    """
    The client address as a validated, normalised IP string, or None.

    get_client_ip returns whatever the last X-Forwarded-For entry is, and a
    value that is not an IP makes any PostgreSQL `inet` insert fail; inside a
    transaction that poisons the whole transaction. Recording an answer must
    never fail because of a request header, so anything that is not a valid
    IP address is stored as NULL instead.
    """
    raw = get_client_ip(request)
    # A scoped IPv6 literal ("fe80::1%eth0") parses in Python but is not a client address a proxy would
    # ever append, and its stored form is not what was parsed; treat it as not-an-IP.
    if not raw or '%' in raw:
        return None
    try:
        return str(ipaddress.ip_address(raw.strip()))
    except ValueError:
        return None
