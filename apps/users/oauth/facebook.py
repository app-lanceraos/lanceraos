# apps/users/oauth/facebook.py
"""
Verifies a Facebook access token via the Graph API's debug_token
endpoint (confirms the token was issued for THIS app, using an
app-access-token built from FACEBOOK_APP_ID + FACEBOOK_APP_SECRET),
then fetches the profile via /me. Returns the same normalized identity
dict shape as oauth.google.verify_google_token, so oauth/base.py's
linking logic is provider-agnostic.

FACEBOOK_APP_ID / FACEBOOK_APP_SECRET are not yet in .env (added when
the Meta developer app is created) — verify_facebook_token() raises a
clean OAuthVerificationError rather than an ImproperlyConfigured/KeyError
if called before those are set, so the endpoint fails predictably
instead of 500ing.
"""
from django.conf import settings

GRAPH_API_VERSION = 'v19.0'


class OAuthVerificationError(Exception):
    """Raised when a Facebook access token fails verification."""


def verify_facebook_token(access_token):
    if not access_token:
        raise OAuthVerificationError('No Facebook access token provided.')

    _debug_token(access_token)  # raises if invalid, expired, or issued for a different app
    profile = _fetch_profile(access_token)

    provider_uid = profile.get('id', '')
    email = (profile.get('email') or '').lower().strip()

    if not provider_uid:
        raise OAuthVerificationError('Could not extract account information from Facebook.')
    if not email:
        # Facebook accounts created via phone number can genuinely have no
        # email. The account-linking logic in oauth/base.py matches by
        # email, so without one there's no safe way to auto-link or
        # dedupe — this must be a real, visible error, not silently
        # defaulted to some placeholder address.
        raise OAuthVerificationError(
            'Your Facebook account does not have a verified email address. '
            'Please sign up with email/password or Google instead.'
        )

    name = profile.get('name', '')
    first_name, _, last_name = name.partition(' ')

    return {
        'provider_uid': provider_uid,
        'email': email,
        'first_name': first_name,
        'last_name': last_name,
        'picture_url': profile.get('picture', {}).get('data', {}).get('url', ''),
    }


def _app_access_token():
    app_id = getattr(settings, 'FACEBOOK_APP_ID', '')
    app_secret = getattr(settings, 'FACEBOOK_APP_SECRET', '')
    if not app_id or not app_secret:
        raise OAuthVerificationError('Facebook login is not configured on this server.')
    return f'{app_id}|{app_secret}'


def _debug_token(access_token):
    import requests as http_requests

    try:
        resp = http_requests.get(
            f'https://graph.facebook.com/{GRAPH_API_VERSION}/debug_token',
            params={'input_token': access_token, 'access_token': _app_access_token()},
            timeout=10,
        )
    except http_requests.RequestException as exc:
        raise OAuthVerificationError(f'Could not reach Facebook: {exc}') from exc

    if resp.status_code != 200:
        raise OAuthVerificationError(f'Facebook token-debug endpoint returned {resp.status_code}.')

    payload = resp.json().get('data', {})
    if not payload.get('is_valid'):
        raise OAuthVerificationError('Invalid or expired Facebook token.')

    expected_app_id = getattr(settings, 'FACEBOOK_APP_ID', '')
    if str(payload.get('app_id')) != str(expected_app_id):
        raise OAuthVerificationError('Facebook token was not issued for this application.')


def _fetch_profile(access_token):
    import requests as http_requests

    try:
        resp = http_requests.get(
            f'https://graph.facebook.com/{GRAPH_API_VERSION}/me',
            params={'fields': 'id,email,name,picture', 'access_token': access_token},
            timeout=10,
        )
    except http_requests.RequestException as exc:
        raise OAuthVerificationError(f'Could not reach Facebook: {exc}') from exc

    if resp.status_code != 200:
        raise OAuthVerificationError(f'Facebook profile endpoint returned {resp.status_code}.')
    return resp.json()