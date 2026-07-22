# apps/users/oauth/base.py
"""
Shared account-linking logic for every OAuth provider. Collision
handling is identical regardless of which provider verified the
identity — only how that identity dict got produced differs (see
oauth/google.py and oauth/facebook.py). Keeping this in one place is
the point: writing it twice would mean the "8 collision scenarios" this
is meant to handle correctly could silently drift apart between the
two providers over time.
"""
from django.db import transaction

from apps.users.models import User, UserSocialAccount


def link_or_create_user(provider, identity):
    """
    identity: {'provider_uid', 'email', 'first_name', 'last_name', 'picture_url'}
    — the normalized shape both verify_google_token() and
    verify_facebook_token() return, so this function never needs to
    know which provider it's handling.

    Returns (user, is_new_user).

    Collision handling, in priority order:
      1. This exact (provider, provider_uid) is already linked -> use that user.
      2. No social link yet, but a User already exists with this email ->
         link this provider to the existing account. Never creates a
         duplicate account for an email that's already registered.
      3. Neither exists -> create a brand-new user. Unusable password
         (OAuth-only until they set one from Profile settings),
         is_email_verified=True (the provider already verified it, no
         need to make them verify it again with LanceraOS).
    """
    provider_uid = identity['provider_uid']
    email = identity['email']
    is_new_user = False

    with transaction.atomic():
        try:
            social = UserSocialAccount.objects.select_related('user').get(
                provider=provider, provider_uid=provider_uid,
            )
            user = social.user
        except UserSocialAccount.DoesNotExist:
            try:
                user = User.objects.get(email=email)
                UserSocialAccount.objects.create(user=user, provider=provider, provider_uid=provider_uid)
            except User.DoesNotExist:
                user = User.objects.create_user(
                    email=email,
                    first_name=identity.get('first_name', ''),
                    last_name=identity.get('last_name', ''),
                    is_email_verified=True,
                )
                UserSocialAccount.objects.create(user=user, provider=provider, provider_uid=provider_uid)
                is_new_user = True

        # Set the provider's profile picture only if the user has no logo
        # of their own yet — never overwrite something they chose themselves.
        picture_url = identity.get('picture_url')
        if picture_url:
            try:
                profile = user.profile
                if not profile.logo:
                    profile.logo = picture_url
                    profile.save(update_fields=['logo'])
            except Exception:
                # The post_save signal guarantees a profile exists, but a
                # picture-URL write failing must never block a login.
                pass

    return user, is_new_user