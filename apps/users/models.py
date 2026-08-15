# apps/users/models.py
import hashlib
import uuid
from datetime import timedelta

from django.conf import settings
from django.contrib.auth.models import AbstractUser
from django.core.exceptions import ValidationError
from django.db import models, transaction
from django.utils import timezone

from core.encryption import (
    blind_index,
    decrypt_field,
    encrypt_field,
    validate_cnic,
    validate_ntn,
    validate_pseb,
)

from .managers import UserManager


# ══════════════════════════════════════════════════════════════════
# USER
# ══════════════════════════════════════════════════════════════════

class User(AbstractUser):
    """
    Email-first user. UUID primary key per CLAUDE.md rule 13 (prevents
    account enumeration on a financial application) — this means the
    'id' field below intentionally overrides AbstractUser's default
    auto-incrementing integer pk.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    objects = UserManager()

    email = models.EmailField(unique=True)
    is_email_verified = models.BooleanField(default=False)
    date_of_birth = models.DateField(null=True, blank=True)

    # ── Terms of Service / Privacy Policy acceptance ─────────────
    # Recorded server-side at whichever point actually satisfies it —
    # registration for email/password signups, onboarding for OAuth
    # signups (which skip the registration wizard entirely). Existing
    # users are never retroactively required to re-accept a version bump;
    # terms_version just records which version this particular user agreed
    # to, in case it's ever disputed.
    terms_accepted_at = models.DateTimeField(null=True, blank=True)
    terms_version = models.CharField(max_length=20, blank=True)

    # ── 2FA ──────────────────────────────────────────────────────
    two_fa_enabled = models.BooleanField(default=False)
    two_fa_code = models.CharField(max_length=6, blank=True)
    two_fa_code_expiry = models.DateTimeField(null=True, blank=True)

    # ── Login security ───────────────────────────────────────────
    failed_login_attempts = models.IntegerField(default=0)
    account_locked_until = models.DateTimeField(null=True, blank=True)
    last_login_ip = models.GenericIPAddressField(null=True, blank=True)
    last_login_device = models.CharField(max_length=300, blank=True)

    # ── Email change — pending_email holds the new address while
    # the two-step (current-inbox + new-inbox) confirmation is pending ──
    pending_email = models.EmailField(blank=True)
    pending_email_expires_at = models.DateTimeField(null=True, blank=True)

    # ── Password history (last 3 hashed passwords, most recent first) ──
    password_history = models.JSONField(default=list, blank=True)

    # Used to invalidate JWTs issued before the most recent password change.
    # See apps/users/authentication.py — PasswordAwareJWTAuthentication.
    password_changed_at = models.DateTimeField(null=True, blank=True)

    # ── Soft delete / deletion scheduling ─────────────────────────
    # Deletion never hard-deletes the row — see anonymize() below.
    # Financial records (invoices, payments, etc.) hold a PROTECT FK to
    # User, so the row must continue to exist even after the person is
    # long gone; anonymize() strips PII in place instead.
    is_deleted = models.BooleanField(default=False)
    deleted_at = models.DateTimeField(null=True, blank=True)
    deletion_requested_at = models.DateTimeField(null=True, blank=True)
    deletion_scheduled_at = models.DateTimeField(null=True, blank=True)
    anonymized_at = models.DateTimeField(null=True, blank=True)

    # ── Admin panel access ─────────────────────────────────────────
    # Deliberately separate from Django's own is_staff/is_superuser,
    # which stay reserved for the raw Django /admin/ interface. This
    # flag gates the real, purpose-built admin panel at
    # admin.lanceraos.com — someone could have one without the other.
    can_access_admin_panel = models.BooleanField(default=False)

    # Only a super-admin may grant/revoke can_access_admin_panel for
    # someone else — a regular admin can do everything else (search,
    # suspend, view the audit log) but not manage who else has access.
    is_super_admin = models.BooleanField(default=False)

    # ── Admin-initiated suspension — distinct from is_active (used by
    # permanent anonymization) and is_deleted (self-service deletion) ──
    is_suspended = models.BooleanField(default=False)
    suspended_at = models.DateTimeField(null=True, blank=True)
    suspension_reason = models.TextField(blank=True)

    USERNAME_FIELD = 'email'
    REQUIRED_FIELDS = ['username']

    class Meta:
        db_table = 'users'
        indexes = [
            models.Index(fields=['email']),
            models.Index(fields=['username']),
            models.Index(fields=['is_email_verified']),
            models.Index(fields=['is_deleted']),
            models.Index(fields=['deletion_scheduled_at']),
        ]

    def __str__(self):
        return self.email

    # ── Login security helpers ────────────────────────────────────

    def is_account_locked(self):
        return bool(
            self.account_locked_until and timezone.now() < self.account_locked_until
        )

    def get_lockout_duration(self):
        """
        Tiered lockout, minutes:
          1-4   attempts -> no lock
          5-10  -> 15
          11-15 -> 60
          16+   -> 1440 (24h)
        """
        n = self.failed_login_attempts
        if n <= 4:
            return 0
        if n <= 10:
            return 15
        if n <= 15:
            return 60
        return 1440

    def increment_failed_attempts(self):
        self.failed_login_attempts += 1
        duration = self.get_lockout_duration()
        locked = duration > 0
        just_locked = False

        if locked:
            new_lockout = timezone.now() + timedelta(minutes=duration)
            if self.account_locked_until != new_lockout:
                just_locked = True
            self.account_locked_until = new_lockout
        else:
            self.account_locked_until = None

        self.save(update_fields=['failed_login_attempts', 'account_locked_until'])

        n = self.failed_login_attempts
        if n < 5:
            remaining = 5 - n
        elif n < 11:
            remaining = 11 - n
        elif n < 16:
            remaining = 16 - n
        else:
            remaining = 0

        return {
            'locked': locked,
            'lockout_until': self.account_locked_until,
            'attempts_remaining': remaining,
            'should_send_lockout_email': just_locked,
        }

    def reset_failed_login(self):
        self.failed_login_attempts = 0
        self.account_locked_until = None
        self.save(update_fields=['failed_login_attempts', 'account_locked_until'])

    def add_to_password_history(self, hashed_password):
        history = self.password_history or []
        history.insert(0, hashed_password)
        self.password_history = history[:3]
        self.save(update_fields=['password_history'])

    def is_password_reused(self, raw_password):
        """
        True if raw_password matches the current password OR any of the
        last 3 historical ones. Shared by reset_password (views/auth.py)
        and change_password (views/security.py) so this comparison exists
        in exactly one place.
        """
        from django.contrib.auth.hashers import check_password
        if check_password(raw_password, self.password):
            return True
        return any(check_password(raw_password, old_hash) for old_hash in (self.password_history or []))

    def is_oauth_only(self):
        """
        True if the user has at least one linked social account (Google or
        Facebook) and no usable password — i.e. they've never set one, so
        password-based flows (change password, 2FA-via-password-confirm)
        don't apply to them.
        """
        from django.contrib.auth.hashers import is_password_usable
        return self.social_accounts.exists() and not is_password_usable(self.password)

    def has_pending_email_change(self):
        return bool(
            self.pending_email
            and self.pending_email_expires_at
            and timezone.now() < self.pending_email_expires_at
        )

    def clear_pending_email(self):
        self.pending_email = ''
        self.pending_email_expires_at = None
        self.save(update_fields=['pending_email', 'pending_email_expires_at'])

    # ── Deletion / anonymization ───────────────────────────────────

    def anonymize(self):
        """
        Called by the daily Celery task once deletion_scheduled_at has
        passed. Strips PII in place rather than deleting the row, so that
        financial records with a PROTECT FK to this user remain valid.

        Also clears the CNIC/NTN/PSEB blind-index hashes on the profile
        so those numbers become available again for a future registration
        (a deleted person's tax ID shouldn't permanently lock the value,
        including for that same person re-registering later).
        """
        anon_id = uuid.uuid4().hex[:12]

        self.email = f'deleted-{anon_id}@lanceraos.invalid'
        self.username = f'deleted_{anon_id}'
        self.first_name = ''
        self.last_name = ''
        self.date_of_birth = None
        self.set_unusable_password()
        self.password_history = []
        self.last_login_ip = None
        self.last_login_device = ''
        self.pending_email = ''
        self.pending_email_expires_at = None
        self.two_fa_enabled = False
        self.two_fa_code = ''
        self.two_fa_code_expiry = None
        self.is_active = False
        self.anonymized_at = timezone.now()
        self.save()

        # Pure auth artifacts — no independent value once the identity is gone.
        self.sessions.all().delete()
        self.trusted_devices.all().delete()
        self.social_accounts.all().delete()

        try:
            profile = self.profile
        except FreelancerProfile.DoesNotExist:
            return

        profile.display_name = 'Deleted User'
        profile.phone = ''
        profile.logo = ''
        profile.logo_public_id = ''
        profile.business_name = ''
        profile.address_line1 = ''
        profile.address_line2 = ''
        profile.city = ''
        profile.bank_name = ''
        profile.bank_account_number = ''
        profile.jazzcash_number = ''
        profile.easypaisa_number = ''
        profile.payoneer_email = ''
        profile.wise_profile_id = ''
        profile.wise_access_token = ''
        profile.wise_refresh_token = ''
        # NULL, not '' — the *_hash columns are unique=True, and unlike NULL
        # (which never collides with another NULL under a unique constraint),
        # two anonymized profiles both holding '' would collide with each
        # other the second time this runs.
        profile.cnic_encrypted = ''
        profile.cnic_hash = None
        profile.ntn_encrypted = ''
        profile.ntn_hash = None
        profile.pseb_encrypted = ''
        profile.pseb_hash = None
        profile.custom_smtp_enabled = False
        profile.custom_smtp_host = ''
        profile.custom_smtp_username = ''
        profile.custom_smtp_password = ''
        profile.custom_smtp_from_name = ''
        profile.custom_smtp_verified = False
        profile.custom_smtp_verified_at = None
        profile.profession = ''
        profile.income_source = ''
        profile.platform_used = ''
        profile.save()


# ══════════════════════════════════════════════════════════════════
# FREELANCER PROFILE
# ══════════════════════════════════════════════════════════════════

class FreelancerProfile(models.Model):
    CURRENCY_CHOICES = [('USD', 'USD'), ('EUR', 'EUR'), ('GBP', 'GBP'), ('PKR', 'PKR')]
    LANGUAGE_CHOICES = [('en', 'English'), ('ur', 'Urdu')]
    SEND_METHOD_CHOICES = [
        ('email', 'Email only'),
        ('whatsapp', 'WhatsApp (manual share)'),
        ('both', 'Email + WhatsApp'),
    ]

    INCOME_SOURCE_CHOICES = [
        ('full_time', 'Full-time freelancer'),
        ('part_time', 'Part-time, alongside a job'),
        ('side_income', 'Occasional side income'),
        ('student', 'Student'),
    ]
    PLATFORM_CHOICES = [
        ('upwork', 'Upwork'),
        ('fiverr', 'Fiverr'),
        ('direct', 'Direct clients'),
        ('other', 'Other'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='profile',
    )

    display_name = models.CharField(max_length=120)
    phone = models.CharField(max_length=20, blank=True)

    # ── CNIC / NTN / PSEB — Fernet-encrypted value + HMAC blind index ──
    # No plaintext of any of these three is ever stored. The *_hash
    # columns carry a unique constraint deliberately: unlike a tax ID
    # that merely gates a benefit, these identify a real person, and an
    # account claiming someone else's CNIC/NTN/PSEB could mean LanceraOS
    # generates an official document under the wrong identity. Set via
    # the set_cnic()/set_ntn()/set_pseb() methods below, never assigned
    # to directly — that's what enforces validation + uniqueness.
    cnic_encrypted = models.TextField(blank=True)
    cnic_hash = models.CharField(max_length=64, blank=True, unique=True, null=True)
    ntn_encrypted = models.TextField(blank=True)
    ntn_hash = models.CharField(max_length=64, blank=True, unique=True, null=True)
    pseb_registered = models.BooleanField(default=False)
    pseb_encrypted = models.TextField(blank=True)
    pseb_hash = models.CharField(max_length=64, blank=True, unique=True, null=True)

    logo = models.CharField(max_length=500, blank=True)
    logo_public_id = models.CharField(max_length=200, blank=True)
    # Same field type/pattern as logo/logo_public_id above, verified and
    # mirrored exactly (not URLField, despite that being the intuitive
    # guess — logo itself is a plain CharField) — a Cloudinary secure_url
    # + the public_id needed to destroy() it on replacement, same lifecycle
    # cloudinary.uploader already implements for logo uploads
    # (apps/users/views/profile.py's upload_logo). Storage only, for the
    # invoice-PDF templates (apps.invoices, Step 7b) to read — the actual
    # upload/background-removal tool is Step 9, not built here.
    signature_url = models.CharField(max_length=500, blank=True)
    signature_public_id = models.CharField(max_length=200, blank=True)
    business_name = models.CharField(max_length=200, blank=True)
    address_line1 = models.CharField(max_length=200, blank=True)
    address_line2 = models.CharField(max_length=200, blank=True)
    city = models.CharField(max_length=100, blank=True)
    country = models.CharField(max_length=100, default='Pakistan')
    default_currency = models.CharField(max_length=3, choices=CURRENCY_CHOICES, default='USD')
    default_payment_terms = models.PositiveIntegerField(default=30)

    bank_name = models.CharField(max_length=100, blank=True)
    bank_account_number = models.CharField(max_length=50, blank=True)
    jazzcash_number = models.CharField(max_length=20, blank=True)
    easypaisa_number = models.CharField(max_length=20, blank=True)
    payoneer_email = models.EmailField(blank=True)
    wise_profile_id = models.CharField(max_length=100, blank=True)
    wise_access_token = models.TextField(blank=True)
    wise_refresh_token = models.TextField(blank=True)

    onboarding_completed = models.BooleanField(default=False)
    profession = models.CharField(max_length=100, blank=True)
    income_source = models.CharField(max_length=20, choices=INCOME_SOURCE_CHOICES, blank=True)
    platform_used = models.CharField(max_length=20, choices=PLATFORM_CHOICES, blank=True)
    language = models.CharField(max_length=5, choices=LANGUAGE_CHOICES, default='en')
    timezone = models.CharField(max_length=50, default='Asia/Karachi')

    # Email change audit — 90-day cooldown measured from this timestamp.
    last_email_changed_at = models.DateTimeField(null=True, blank=True)

    # ── Custom SMTP (Pro feature) ──────────────────────────────────
    custom_smtp_enabled = models.BooleanField(default=False)
    custom_smtp_host = models.CharField(max_length=200, blank=True, help_text='e.g. smtp.gmail.com')
    custom_smtp_port = models.IntegerField(default=587)
    custom_smtp_username = models.EmailField(blank=True)
    custom_smtp_password = models.TextField(blank=True, help_text='Fernet-encrypted. Never returned in API responses.')
    custom_smtp_use_tls = models.BooleanField(default=True)
    custom_smtp_use_ssl = models.BooleanField(default=False)
    custom_smtp_from_name = models.CharField(max_length=200, blank=True)
    custom_smtp_verified = models.BooleanField(default=False)
    custom_smtp_verified_at = models.DateTimeField(null=True, blank=True)

    # ── Notification preferences (per-category toggles) ────────────
    notif_invoice_events = models.BooleanField(default=True)
    notif_client_messages = models.BooleanField(default=True)
    notif_payments = models.BooleanField(default=True)
    # Security alerts cannot be disabled — deliberately no field here;
    # enforcing "cannot be disabled" is easiest by never exposing a toggle.

    # ── Client onboarding ───────────────────────────────────────────
    client_onboarding_enabled = models.BooleanField(default=True)
    client_onboarding_message = models.TextField(
        blank=True,
        help_text='Custom welcome message for first invoices. Leave blank for the default template.',
    )

    default_send_method = models.CharField(max_length=10, choices=SEND_METHOD_CHOICES, default='email')

    # ── Formal Notice (apps.invoices Step 17) ───────────────────────
    # Per the decisions doc's "every email type must be mutable" rule —
    # a real, user-facing kill switch for the Formal Notice feature,
    # checked both before the action is offered in the UI AND enforced
    # server-side in invoice_send_formal_notice (never just hidden
    # client-side). Defaults True — an opt-out toggle for a real,
    # deliberately manual-only feature, not an opt-in one.
    formal_notice_enabled = models.BooleanField(default=True)

    # ── SRO 586 / tax profile ───────────────────────────────────────
    income_type = models.CharField(
        max_length=50, blank=True, default='it_services',
        help_text='Primary type of freelance work (for SRO 586 eligibility).',
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'freelancer_profiles'

    def __str__(self):
        return f'{self.display_name} ({self.user.email})'

    # ── Email change cooldown ───────────────────────────────────────

    def can_change_email(self):
        """Returns (allowed: bool, days_remaining: int)."""
        if not self.last_email_changed_at:
            return True, 0
        cooldown = timedelta(days=90)
        elapsed = timezone.now() - self.last_email_changed_at
        if elapsed >= cooldown:
            return True, 0
        return False, (cooldown - elapsed).days + 1

    @property
    def completion_percentage(self):
        fields = [
            self.display_name, self.phone, self.business_name,
            self.address_line1, self.city, self.user.date_of_birth,
            self.bank_name or self.jazzcash_number or self.easypaisa_number or self.payoneer_email,
            self.ntn_encrypted, self.logo,
        ]
        filled = sum(1 for f in fields if f)
        return round((filled / len(fields)) * 100)

    # ── CNIC / NTN / PSEB — validated, encrypted, uniqueness-checked ──

    def _set_identity_field(self, prefix, raw_value, validator):
        """
        Shared logic for set_cnic/set_ntn/set_pseb: normalize + validate,
        check uniqueness against every OTHER profile's hash, then encrypt.
        Raises ValidationError on invalid format or a value already
        claimed by another account. Does not save() — callers save
        explicitly, matching the rest of this model's convention.
        """
        encrypted_field = f'{prefix}_encrypted'
        hash_field = f'{prefix}_hash'

        if not raw_value:
            setattr(self, encrypted_field, '')
            setattr(self, hash_field, None)
            return

        normalized = validator(raw_value)  # raises ValidationError if malformed
        digest = blind_index(normalized)

        clash = FreelancerProfile.objects.filter(**{hash_field: digest})
        if self.pk:
            clash = clash.exclude(pk=self.pk)
        if clash.exists():
            raise ValidationError(
                f'This {prefix.upper()} is already registered to another account.'
            )

        setattr(self, encrypted_field, encrypt_field(normalized))
        setattr(self, hash_field, digest)

    def set_cnic(self, raw_value):
        self._set_identity_field('cnic', raw_value, validate_cnic)

    def set_ntn(self, raw_value):
        self._set_identity_field('ntn', raw_value, validate_ntn)

    def set_pseb(self, raw_value):
        self._set_identity_field('pseb', raw_value, validate_pseb)

    @property
    def cnic(self):
        return decrypt_field(self.cnic_encrypted) if self.cnic_encrypted else ''

    @property
    def ntn(self):
        return decrypt_field(self.ntn_encrypted) if self.ntn_encrypted else ''

    @property
    def pseb(self):
        return decrypt_field(self.pseb_encrypted) if self.pseb_encrypted else ''


# ══════════════════════════════════════════════════════════════════
# SESSION — one row per active refresh token / device
# ══════════════════════════════════════════════════════════════════

class Session(models.Model):
    """
    Backs the "3 concurrent sessions max" rule and the /sessions/ UI.
    Stores only a SHA-256 hash of the refresh token, never the token
    itself — the token already carries its own entropy from JWT signing,
    so (unlike CNIC/NTN/PSEB) no HMAC secret is needed here, plain
    SHA-256 is sufficient since there's nothing to protect against a
    dictionary attack (a JWT refresh token isn't guessable/low-entropy
    the way a tax ID is).

    Refreshing rotates the token and updates this SAME row (new hash,
    new last_used_at) rather than creating a new row — otherwise "3
    sessions" would silently mean "3 refreshes since login," not 3
    actual devices.
    """
    MAX_SESSIONS_PER_USER = 3

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='sessions',
    )
    refresh_token_hash = models.CharField(max_length=64, unique=True)
    device_name = models.CharField(max_length=300, blank=True)
    trusted_device = models.ForeignKey(
        'TrustedDevice', null=True, blank=True, on_delete=models.SET_NULL, related_name='sessions',
        help_text='The recognized device this session belongs to, when one exists — lets a '
                   'custom nickname persist across future logins from the same device, rather '
                   'than needing to be re-set every time a new session is created. Null for '
                   'sessions created before this link existed.',
    )
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    last_used_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()

    class Meta:
        db_table = 'sessions'
        indexes = [
            models.Index(fields=['user', 'last_used_at']),
            models.Index(fields=['refresh_token_hash']),
            models.Index(fields=['expires_at']),
        ]

    def __str__(self):
        return f'{self.user.email} — {self.device_name[:40]}'

    @staticmethod
    def _hash_token(raw_token):
        return hashlib.sha256(raw_token.encode()).hexdigest()

    @classmethod
    def get_valid(cls, raw_token):
        """Looks up a live (non-expired) session by raw refresh token."""
        return cls.objects.filter(
            refresh_token_hash=cls._hash_token(raw_token),
            expires_at__gt=timezone.now(),
        ).first()

    @classmethod
    def create_for_user(cls, user, raw_token, device_name, ip_address, lifetime_days, trusted_device=None):
        """
        Enforces MAX_SESSIONS_PER_USER by evicting the least-recently-used
        session before creating the new one, then creates it. Locks the
        user row for the duration so concurrent logins can't both read the
        same under-cap count and race past MAX_SESSIONS_PER_USER.
        """
        with transaction.atomic():
            type(user).objects.select_for_update().get(pk=user.pk)
            active = cls.objects.select_for_update().filter(user=user, expires_at__gt=timezone.now())
            if active.count() >= cls.MAX_SESSIONS_PER_USER:
                oldest = active.order_by('last_used_at').first()
                if oldest:
                    oldest.delete()

            return cls.objects.create(
                user=user,
                refresh_token_hash=cls._hash_token(raw_token),
                device_name=device_name[:300],
                ip_address=ip_address,
                expires_at=timezone.now() + timedelta(days=lifetime_days),
                trusted_device=trusted_device,
            )

    def rotate(self, new_raw_token, lifetime_days):
        """Called on token refresh — same row, new hash, new expiry."""
        self.refresh_token_hash = self._hash_token(new_raw_token)
        self.last_used_at = timezone.now()
        self.expires_at = timezone.now() + timedelta(days=lifetime_days)
        self.save(update_fields=['refresh_token_hash', 'last_used_at', 'expires_at'])

    def touch(self):
        self.last_used_at = timezone.now()
        self.save(update_fields=['last_used_at'])

    @classmethod
    def cleanup_expired(cls):
        return cls.objects.filter(expires_at__lt=timezone.now()).delete()[0]


# ══════════════════════════════════════════════════════════════════
# SOCIAL ACCOUNT — Google / Facebook links
# ══════════════════════════════════════════════════════════════════

class UserSocialAccount(models.Model):
    PROVIDER_CHOICES = [('google', 'Google'), ('facebook', 'Facebook')]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='social_accounts',
    )
    provider = models.CharField(max_length=20, choices=PROVIDER_CHOICES)
    provider_uid = models.CharField(max_length=200)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'user_social_accounts'
        unique_together = [('provider', 'provider_uid')]

    def __str__(self):
        return f'{self.user.email} via {self.provider}'


# ══════════════════════════════════════════════════════════════════
# TRUSTED DEVICE — "don't ask again" for 2FA, 30 days
# ══════════════════════════════════════════════════════════════════

class TrustedDevice(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='trusted_devices',
    )
    token_hash = models.CharField(max_length=64, unique=True)
    device_name = models.CharField(max_length=300, blank=True)
    custom_name = models.CharField(
        max_length=100, blank=True,
        help_text='User-editable label (e.g. "My MacBook"), shown instead of '
                   'device_name when set. Set via Settings > Sessions.',
    )
    skip_2fa = models.BooleanField(
        default=False,
        help_text='Whether this device may bypass the 2FA prompt — set only '
                   'via the explicit "don\'t ask again" checkbox at 2FA-verify '
                   'time. Distinct from the device simply being recognized: '
                   'every login creates/matches a TrustedDevice row now, but '
                   'only this flag grants 2FA-skipping specifically.',
    )
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    last_used_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = 'trusted_devices'
        indexes = [models.Index(fields=['token_hash'])]

    def __str__(self):
        return f'{self.user.email} — {self.device_name[:40]}'

    @staticmethod
    def _hash_token(raw_token):
        return hashlib.sha256(raw_token.encode()).hexdigest()

    @classmethod
    def get_valid(cls, raw_token, user):
        return cls.objects.filter(
            token_hash=cls._hash_token(raw_token),
            user=user,
            expires_at__gt=timezone.now(),
        ).first()

    @classmethod
    def create_for_user(cls, user, raw_token, device_name, ip_address, skip_2fa=False):
        return cls.objects.create(
            user=user,
            token_hash=cls._hash_token(raw_token),
            device_name=device_name[:300],
            ip_address=ip_address,
            expires_at=timezone.now() + timedelta(days=30),
            skip_2fa=skip_2fa,
        )

    @classmethod
    def cleanup_expired(cls):
        return cls.objects.filter(expires_at__lt=timezone.now()).delete()[0]


# ══════════════════════════════════════════════════════════════════
# EMAIL CHANGE REQUEST — two-step (current inbox + new inbox) flow
# ══════════════════════════════════════════════════════════════════

class EmailChangeRequest(models.Model):
    STEP_CHOICES = [
        ('step1_pending', 'Step 1 — link sent to current email'),
        ('step1_clicked', 'Step 1 — link clicked, awaiting new email + password'),
        ('step2_pending', 'Step 2 — activation link sent to new email'),
        ('completed', 'Completed'),
        ('cancelled', 'Cancelled'),
        ('expired', 'Expired'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='email_change_requests',
    )
    new_email = models.EmailField(blank=True)
    step1_token = models.CharField(max_length=128)
    step2_token = models.CharField(max_length=128, blank=True)
    step = models.CharField(max_length=20, choices=STEP_CHOICES, default='step1_pending')
    step1_expires_at = models.DateTimeField()
    step2_expires_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = 'email_change_requests'
        indexes = [
            models.Index(fields=['user', 'step']),
            models.Index(fields=['step1_token']),
            models.Index(fields=['step2_token']),
        ]

    def __str__(self):
        return f'{self.user.email} -> {self.new_email or "?"} [{self.step}]'

    def is_step1_valid(self):
        return self.step in ('step1_pending', 'step1_clicked') and timezone.now() < self.step1_expires_at

    def is_step2_valid(self):
        return (
            self.step == 'step2_pending'
            and self.step2_expires_at
            and timezone.now() < self.step2_expires_at
        )