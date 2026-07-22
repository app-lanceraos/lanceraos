# apps/users/tokens.py
"""
Ported from v1 with the token-generator logic unchanged — these classes
were already well-designed (each embeds the specific state that
invalidates it after use: is_email_verified for verification tokens,
the password hash for reset tokens, pending_email for email-change
tokens). What changed for v2 is only the uid encoding: v1's user PK was
an integer, v2's is a UUID, and encode_uid/decode_uid below are tested
against that explicitly rather than assumed to just work.
"""
from datetime import date

from django.conf import settings as django_settings
from django.contrib.auth.tokens import PasswordResetTokenGenerator as DjangoTokenGenerator
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.utils.encoding import force_bytes, force_str
from django.utils.http import urlsafe_base64_decode, urlsafe_base64_encode


class _TimeoutMixin:
    """
    Lets subclasses declare their own timeout_seconds instead of reading
    PASSWORD_RESET_TIMEOUT from global settings. Avoids the thread-safety
    bug where Django's check_token would otherwise temporarily mutate
    django_settings.PASSWORD_RESET_TIMEOUT to check a different-lifetime
    token type.
    """
    timeout_seconds = None  # subclasses must set this

    def _check_timeout(self, token_timestamp):
        now_ts = (date.today() - date(2001, 1, 1)).days * 86400
        try:
            return (now_ts - token_timestamp) < self.timeout_seconds
        except TypeError:
            return False


class EmailVerificationTokenGenerator(DjangoTokenGenerator):
    """
    Valid for EMAIL_VERIFICATION_TIMEOUT (24h). Invalidated immediately
    after verification because is_email_verified flips, which changes
    the hash value this token is checked against.
    """
    def _make_hash_value(self, user, timestamp):
        return (
            str(user.pk) + str(timestamp) + str(user.is_active)
            + str(user.email) + str(user.is_email_verified)
        )

    def _check_timeout(self, token_timestamp):
        timeout = getattr(django_settings, 'EMAIL_VERIFICATION_TIMEOUT', 86400)
        now_ts = (date.today() - date(2001, 1, 1)).days * 86400
        return (now_ts - token_timestamp) < timeout


class CustomPasswordResetTokenGenerator(DjangoTokenGenerator):
    """
    Valid for PASSWORD_RESET_TIMEOUT (1h, from settings). Invalidated
    after use because set_password() changes user.password, which
    changes the hash value.
    """
    def _make_hash_value(self, user, timestamp):
        return str(user.pk) + str(timestamp) + str(user.password) + str(user.email)


# Singleton instances — import and use these, never instantiate the classes directly.
email_verification_token = EmailVerificationTokenGenerator()
password_reset_token = CustomPasswordResetTokenGenerator()


# ══════════════════════════════════════════════════════════════════
# UID ENCODE/DECODE — centralizes the base64(pk) <-> User lookup that
# every verification-link view needs, so views.py doesn't repeat the
# same try/except TypeError/ValueError/DoesNotExist block five times.
# ══════════════════════════════════════════════════════════════════

def encode_uid(user) -> str:
    """user.pk (a UUID) -> urlsafe base64 string, safe to put in a URL."""
    return urlsafe_base64_encode(force_bytes(user.pk))


def decode_uid(uidb64: str):
    """
    urlsafe base64 string -> User instance, or None if the uid is
    malformed or doesn't match any user. Never raises — callers treat
    None as "invalid link" uniformly, matching how a bad token is
    already handled.
    """
    User = get_user_model()
    try:
        user_pk = force_str(urlsafe_base64_decode(uidb64))
        return User.objects.get(pk=user_pk)
    except (TypeError, ValueError, ValidationError, User.DoesNotExist):
        return None