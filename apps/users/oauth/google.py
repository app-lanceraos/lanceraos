# apps/users/oauth/google.py
"""
Verifies a Google-issued credential (ID token, from Google Identity
Services / the One Tap or button flow) or an access token (from a code/
implicit flow), returning a normalized identity dict. Both paths return
the same shape so oauth/base.py's linking logic never needs to know
which one was used.
"""
from django.conf import settings


class OAuthVerificationError(Exception):
    """Raised when a Google credential/access token fails verification."""


def verify_google_token(credential=None, access_token=None):
    if not credential and not access_token:
        raise OAuthVerificationError('No Google credential or access token provided.')

    decoded = _verify_id_token(credential) if credential else _verify_access_token(access_token)

    email = (decoded.get('email') or '').lower().strip()
    provider_uid = decoded.get('sub') or decoded.get('id') or ''

    if not email or not provider_uid:
        raise OAuthVerificationError('Could not extract account information from Google.')

    return {
        'provider_uid': provider_uid,
        'email': email,
        'first_name': decoded.get('given_name', ''),
        'last_name': decoded.get('family_name', ''),
        'picture_url': decoded.get('picture', ''),
    }


def _verify_id_token(credential):
    """
    Verified locally by google-auth against Google's public signing keys
    and checked against GOOGLE_CLIENT_ID as the expected audience — no
    network round-trip to LanceraOS's own server needed beyond fetching
    Google's public keys (which google-auth caches).
    """
    from google.auth.transport import requests as google_requests
    from google.oauth2 import id_token

    client_id = getattr(settings, 'GOOGLE_CLIENT_ID', '')
    if not client_id:
        raise OAuthVerificationError('Google login is not configured on this server.')

    try:
        return id_token.verify_oauth2_token(credential, google_requests.Request(), client_id)
    except ValueError as exc:
        raise OAuthVerificationError(f'Invalid Google credential: {exc}') from exc


def _verify_access_token(access_token):
    import requests as http_requests

    try:
        resp = http_requests.get(
            'https://www.googleapis.com/oauth2/v3/userinfo',
            headers={'Authorization': f'Bearer {access_token}'},
            timeout=10,
        )
    except http_requests.RequestException as exc:
        raise OAuthVerificationError(f'Could not reach Google: {exc}') from exc

    if resp.status_code != 200:
        raise OAuthVerificationError(f'Google userinfo endpoint returned {resp.status_code}.')
    return resp.json()