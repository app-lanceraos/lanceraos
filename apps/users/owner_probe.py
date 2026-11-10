# apps/users/owner_probe.py
"""
"Is the person looking at this public page its owner?" Promoted out of apps/proposals/views_public.py (Prompt 22,
Part 0) so the Proposals page and the Contracts page share ONE implementation of a security-relevant check.
Behaviour is identical to the original.
"""
from apps.users.authentication import CookieJWTAuthentication, identify_user_from_refresh_cookie


class _OwnerProbe(CookieJWTAuthentication):
    """
    Identifies a freelancer session; never authorises anything. CSRF is
    switched off here on purpose: the parent enforces CSRF inside
    authenticate(), and on the POST /respond/ path a missing CSRF token would
    raise, be swallowed by request_is_owner's try/except, and make the OWNER
    look like an ordinary client — letting them answer their own proposal.
    Reading "who is this cookie" cannot be forged into any action, so no CSRF
    check is needed to read it.
    """

    def enforce_csrf(self, request):
        return None


def request_is_owner(request, owner_user_id, identify=None):
    """
    True only if the request carries a valid freelancer session whose user IS
    the proposal's owner (decision D3). A different logged-in freelancer opening
    someone else's link is an ordinary client for this purpose. Never raises: any
    failure (no cookie, expired, revoked, malformed) means "not the owner".

    The access cookie decides first. If it is absent or invalid (it lives only 15
    minutes), the refresh cookie is consulted read-only
    (identify_user_from_refresh_cookie), so the owner stays recognised for as
    long as they are signed in. A VALID access cookie that belongs to someone
    else does not fall through to the refresh cookie: the two are set together
    and name the same person, so a different user's access cookie means a
    different person is signed in.

    Either answer can only reduce what happens (the owner sees a preview, the
    view is not counted, they cannot answer); it grants no access to anything.

    apps.clients.portal.is_freelancer_previewing_portal cannot be reused: it
    returns True only when the browser holds BOTH a freelancer session AND a
    client-portal session, and a proposal link never creates a portal session,
    so it would always say False.

    `identify` is the refresh-cookie lookup to use (default: identify_user_from_refresh_cookie). A caller may pass
    its own so that a test patching the lookup in the caller's module still intercepts it (apps.proposals does).
    """
    identify = identify or identify_user_from_refresh_cookie
    try:
        result = _OwnerProbe().authenticate(request)
    except Exception:
        result = None
    if result is not None:
        return str(result[0].pk) == str(owner_user_id)
    try:
        user = identify(request)
    except Exception:
        return False
    return user is not None and str(user.pk) == str(owner_user_id)
