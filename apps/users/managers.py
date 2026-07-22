# apps/users/managers.py
from django.contrib.auth.base_user import BaseUserManager


class UserManager(BaseUserManager):
    """
    Custom manager for the email-first User model.

    Username is not required at signup time from the caller's perspective —
    if omitted, one is auto-derived from the email's local part with a
    numeric suffix appended on collision. This mirrors v1's behaviour,
    which registration actually never relies on (RegisterSerializer always
    supplies a user-chosen username), but OAuth signup does rely on this,
    since Google/Facebook don't provide a LanceraOS username at all.
    """
    use_in_migrations = True

    def _generate_unique_username(self, email):
        base = email.split('@')[0][:28].lower()
        base = ''.join(ch for ch in base if ch.isalnum() or ch == '_') or 'user'
        username = base
        suffix = 1
        while self.model.objects.filter(username=username).exists():
            username = f'{base}{suffix}'
            suffix += 1
        return username

    def _create_user(self, email, password, username=None, **extra_fields):
        if not email:
            raise ValueError('Users must have an email address.')
        email = self.normalize_email(email)
        if not username:
            username = self._generate_unique_username(email)

        user = self.model(email=email, username=username, **extra_fields)
        if password:
            user.set_password(password)
        else:
            user.set_unusable_password()

        # Every user gets a non-null password_changed_at from the moment
        # they exist — never left None until their first change. A token
        # issuer that only embeds the 'pca' claim "if truthy" would
        # otherwise produce claim-less tokens for brand-new accounts,
        # and those tokens would silently survive that account's very
        # first password change (nothing to compare the claim against).
        # Setting a baseline here closes that gap at the source rather
        # than requiring every future token-issuing code path to
        # remember a null-handling special case.
        from django.utils import timezone
        user.password_changed_at = timezone.now()

        user.save(using=self._db)
        return user

    def create_user(self, email=None, password=None, username=None, **extra_fields):
        extra_fields.setdefault('is_staff', False)
        extra_fields.setdefault('is_superuser', False)
        return self._create_user(email, password, username=username, **extra_fields)

    def create_superuser(self, email=None, password=None, username=None, **extra_fields):
        extra_fields.setdefault('is_staff', True)
        extra_fields.setdefault('is_superuser', True)
        extra_fields.setdefault('is_email_verified', True)
        extra_fields.setdefault('is_active', True)

        if extra_fields.get('is_staff') is not True:
            raise ValueError('Superuser must have is_staff=True.')
        if extra_fields.get('is_superuser') is not True:
            raise ValueError('Superuser must have is_superuser=True.')
        if not password:
            raise ValueError('Superuser must have a password.')

        return self._create_user(email, password, username=username, **extra_fields)