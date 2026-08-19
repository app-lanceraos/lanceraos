# apps/clients/portal.py
"""
Client Portal session mechanics — Step 11. The real, reusable API other
apps (Step 12's apps.invoices work — the Sent->Viewed transition,
InvoiceViewEvent logging, comment/claim submission) will call once those
call sites exist. Deliberately built now, ahead of those consumers,
since it needs no Invoice data at all — only Client.portal_token
(already a real field, Step 3) and the request's own cookies.

Session lookups never raise — a missing/garbage/expired cookie just
means "no session," exactly like apps.users.models.Session.get_valid /
TrustedDevice.get_valid already behave.
"""
import secrets
from datetime import timedelta

from django.utils import timezone

from core.observability import get_client_ip, get_user_agent, normalize_user_agent

from .cookies import PORTAL_SESSION_COOKIE_NAME, clear_portal_session_cookie, set_portal_session_cookie
from .models import ClientPortalSession

SESSION_LIFETIME_DAYS = ClientPortalSession.SESSION_LIFETIME_DAYS


def _get_session_from_cookie(request):
    """
    Raw lookup, no renewal — the shared primitive both
    resolve_session_from_request (which renews on success) and
    get_current_session (which callers that are about to revoke the
    session, e.g. logout, use directly without pointlessly extending a
    session they're a moment away from killing) build on.
    """
    raw_token = request.COOKIES.get(PORTAL_SESSION_COOKIE_NAME)
    if not raw_token:
        return None
    return ClientPortalSession.get_valid(raw_token)


def resolve_session_from_request(request):
    """
    Verifies the portal-session cookie against a real, non-revoked,
    non-expired ClientPortalSession, refreshes last_used_at/expires_at
    on success (the sliding-window mechanic — every authenticated portal
    request pushes the 60-day window forward), and returns the
    associated Client. Returns None on any failure (missing cookie,
    unknown/revoked/expired token).
    """
    session = _get_session_from_cookie(request)
    if session is None:
        return None

    now = timezone.now()
    session.last_used_at = now
    session.expires_at = now + timedelta(days=SESSION_LIFETIME_DAYS)
    session.save(update_fields=['last_used_at', 'expires_at'])
    return session.client


def get_current_session(request):
    """
    Same lookup as resolve_session_from_request but returns the
    ClientPortalSession row itself (not renewed) — for callers that need
    the specific session to act on (logout revokes exactly this row;
    logout-everywhere needs session.client to revoke every row for that
    client). Returns None if there's no valid current session.
    """
    return _get_session_from_cookie(request)


def issue_or_renew_session(client, request, response):
    """
    If the incoming request already carries a valid ClientPortalSession
    cookie for THIS SAME client, extends it (via resolve_session_from_request's
    own renewal) rather than minting a redundant second session for what's
    really the same browser re-visiting the same magic link. Otherwise
    mints a brand-new session — a genuinely new device, or no cookie
    presented at all — and sets its cookie on `response`. Returns the
    live ClientPortalSession row either way.

    Renewing an existing session doesn't need to re-set its cookie (the
    raw token value is unchanged — only the server-side expiry moved),
    so the cookie is only written on the mint-a-new-session path.
    """
    existing = _get_session_from_cookie(request)
    if existing is not None and existing.client_id == client.pk:
        now = timezone.now()
        existing.last_used_at = now
        existing.expires_at = now + timedelta(days=SESSION_LIFETIME_DAYS)
        existing.save(update_fields=['last_used_at', 'expires_at'])
        return existing

    raw_token = secrets.token_urlsafe(32)
    session = ClientPortalSession.create_for_client(
        client, raw_token,
        device_name=normalize_user_agent(get_user_agent(request)),
        ip_address=get_client_ip(request),
        user_agent=get_user_agent(request),
    )
    set_portal_session_cookie(response, raw_token)
    return session


def revoke_session(session):
    """Logout — revokes exactly this one session, leaving every other device's session (if any) untouched."""
    session.revoked_at = timezone.now()
    session.save(update_fields=['revoked_at'])


def revoke_all_sessions_for_client(client):
    """Logout everywhere — revokes every currently-live session for this client in one bulk update."""
    ClientPortalSession.objects.filter(client=client, revoked_at__isnull=True).update(revoked_at=timezone.now())


def clear_session_cookie(response):
    """Re-exported for views_portal.py's convenience — logout/logout-everywhere always clear the cookie regardless of what revoke_session(_for_client) did server-side."""
    return clear_portal_session_cookie(response)


def is_freelancer_previewing_portal(request, owner_user_id):
    """
    Detects the "Preview mode" safety-net scenario per
    INVOICES_CLIENTS_TECHNICAL_SPEC.md: the SAME browser carries both a
    valid apps.users session (the freelancer signed into their own
    LanceraOS account) AND a valid client-portal session, at the same
    time — e.g. the freelancer clicked their own client's magic link to
    see what the portal looks like, without logging out of their own
    account first.

    Wired into 5 real call sites in apps.invoices.views_portal (the
    Sent->Viewed transition + InvoiceViewEvent logging, comment
    read-marking, comment posting, claim submission, acknowledgment).

    `owner_user_id` (required — audit fix, see below) is the id of the
    user who actually owns whatever's being acted on (in practice,
    always `invoice.user_id` at every real call site — apps.invoices
    never has a bare Client-level action that doesn't ultimately resolve
    to one specific invoice). Deliberately a plain id, not an Invoice/
    Client object: apps.clients must never import apps.invoices (the
    established one-directional dependency this whole module already
    enforces — apps.invoices imports FROM apps.clients.portal, never the
    reverse), and the function only ever needs this one piece of data to
    do its job.

    Audit fix (LANCERAOS_CLIENTS_INVOICES_PRODUCTION_AUDIT.md, 19 August
    2026, finding PORTAL-001): this function used to take only `request`
    and return True whenever BOTH a valid freelancer session AND a valid
    portal session were present — with no check on WHO the freelancer was
    relative to WHO the portal session's client actually belongs to. That
    meant a freelancer logged into their own LanceraOS account who ALSO
    happened to be carrying a live portal-session cookie for a
    completely UNRELATED client (their own multi-tab browsing, a
    forwarded link, or genuinely being someone else's client themselves)
    had every real portal action on that unrelated invoice incorrectly
    suppressed (view-tracking skipped) or rejected (comment/claim/
    acknowledge 403'd) — a real, live-reachable browser-state combination,
    not a contrived edge case. Fixed by requiring the caller to supply
    the actual owner being acted on, and only returning True when the
    authenticated freelancer IS that owner.

    Reuses apps.users.authentication.CookieJWTAuthentication directly
    (the real, already-audited JWT-cookie validation apps.users itself
    uses) rather than re-implementing JWT validation here — a second,
    subtly-different validator would be a real security-bug risk for no
    benefit. Any failure to validate (no cookie, expired, revoked,
    malformed) is treated as "no freelancer session" — this function
    never raises, matching every other session-resolution helper in this
    codebase.

    Returns True only when a valid freelancer session AND a valid portal
    session are BOTH present on the same request AND that freelancer is
    the real owner of `owner_user_id`. Any one of those three missing —
    no freelancer session (an ordinary client using their own portal), no
    portal session (a freelancer just using their own app), or a
    freelancer/portal-session pairing that belongs to two DIFFERENT
    people — must never be flagged.
    """
    from apps.users.authentication import CookieJWTAuthentication

    freelancer_user = None
    try:
        result = CookieJWTAuthentication().authenticate(request)
        if result is not None:
            freelancer_user = result[0]
    except Exception:
        freelancer_user = None

    if freelancer_user is None:
        return False

    has_portal_session = _get_session_from_cookie(request) is not None
    if not has_portal_session:
        return False

    return str(freelancer_user.pk) == str(owner_user_id)
