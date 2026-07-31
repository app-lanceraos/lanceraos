# apps/users/serializers.py
import re
from datetime import date

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.validators import RegexValidator
from django.utils import timezone
from rest_framework import serializers

from .constants import CURRENT_TERMS_VERSION
from .models import FreelancerProfile, Session

User = get_user_model()

# Kept in exactly one place (v1 duplicated these constants between
# views.py and serializers.py — a real drift risk, since editing one
# copy and forgetting the other silently reopens a hole). views.py
# imports these from here rather than redefining them.
DISPOSABLE_DOMAINS = {
    'mailinator.com', 'guerrillamail.com', 'tempmail.com', 'throwam.com',
    'sharklasers.com', 'guerrillamailblock.com', 'grr.la', 'guerrillamail.info',
    'spam4.me', 'trashmail.com', 'yopmail.com', 'maildrop.cc', 'dispostable.com',
    'fakeinbox.com', 'mailnull.com', 'spamgourmet.com', 'trashmail.me',
    'discard.email', 'spamgourmet.net', 'spamgourmet.org', 'tempinbox.com',
    'throwaway.email', 'getairmail.com', 'filzmail.com', 'tempr.email',
    'spamherr.com', 'trashmail.net', 'trashmail.at', 'trashmail.io',
    'spambox.us', 'mailnesia.com', 'trbvm.com', 'mailexpire.com',
}

RESERVED_USERNAMES = {
    'admin', 'root', 'superuser', 'staff', 'api', 'static', 'media',
    'support', 'help', 'billing', 'security', 'login', 'logout',
    'register', 'dashboard', 'settings', 'lanceraos', 'info',
    'contact', 'mail', 'email', 'abuse', 'noreply', 'no-reply',
    'webmaster', 'postmaster', 'null', 'undefined', 'test', 'demo',
}

PASSWORD_RULES = [
    (r'.{8,}', 'at least 8 characters'),
    (r'[A-Z]', 'one uppercase letter'),
    (r'[a-z]', 'one lowercase letter'),
    (r'[0-9]', 'one number'),
    (r'[!@#$%^&*()\-_=+\[\]{};:\'",.<>/?\\|`~]', 'one special character'),
]

MIN_AGE_YEARS = 16


def validate_password_strength(value):
    missing = [msg for pattern, msg in PASSWORD_RULES if not re.search(pattern, value)]
    if missing:
        raise serializers.ValidationError(f'Password must contain: {", ".join(missing)}')
    return value


def _calculate_age(dob: date) -> int:
    today = date.today()
    years = today.year - dob.year
    if (today.month, today.day) < (dob.month, dob.day):
        years -= 1
    return years


# ══════════════════════════════════════════════════════════════════
# REGISTRATION
# ══════════════════════════════════════════════════════════════════

class RegisterSerializer(serializers.ModelSerializer):
    """
    Backs the single POST /api/auth/register/ call made after the
    frontend's 3-step wizard completes (name+DOB -> email+username ->
    password). The wizard is a frontend-only UX concern — the backend
    validates the whole payload as one unit, the same way v1 did.
    check_availability() (a separate view, unchanged from v1) is what
    gives the frontend live per-step feedback before this final submit.
    """
    password = serializers.CharField(write_only=True, min_length=8)
    confirm_password = serializers.CharField(write_only=True)
    username = serializers.CharField(
        min_length=3, max_length=30,
        validators=[RegexValidator(
            regex=r'^[a-zA-Z0-9_]+$',
            message='Username can only contain letters, numbers, and underscores.',
        )],
    )
    date_of_birth = serializers.DateField(required=True)
    agreed_to_terms = serializers.BooleanField(write_only=True)

    class Meta:
        model = User
        fields = ['email', 'username', 'password', 'confirm_password',
                  'first_name', 'last_name', 'date_of_birth', 'agreed_to_terms']

    def validate_email(self, value):
        value = value.lower().strip()
        domain = value.split('@')[-1].lower()
        if domain in DISPOSABLE_DOMAINS:
            raise serializers.ValidationError(
                'Please use a permanent email address. Temporary email services are not allowed.'
            )
        if User.objects.filter(email=value).exists():
            raise serializers.ValidationError('An account with this email address already exists.')
        return value

    def validate_username(self, value):
        value = value.lower().strip()
        if value in RESERVED_USERNAMES:
            raise serializers.ValidationError('This username is not available.')
        if User.objects.filter(username=value).exists():
            raise serializers.ValidationError('This username is already taken.')
        return value

    def validate_first_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError('First name is required.')
        if len(value) < 2:
            raise serializers.ValidationError('First name must be at least 2 characters.')
        if not re.match(r'^[a-zA-Z\s\-]+$', value):
            raise serializers.ValidationError('First name can only contain letters, spaces, and hyphens.')
        return value

    def validate_last_name(self, value):
        value = value.strip()
        if value and not re.match(r'^[a-zA-Z\s\-]+$', value):
            raise serializers.ValidationError('Last name can only contain letters, spaces, and hyphens.')
        return value

    def validate_date_of_birth(self, value):
        age = _calculate_age(value)
        if age < MIN_AGE_YEARS:
            raise serializers.ValidationError(f'You must be at least {MIN_AGE_YEARS} years old to register.')
        if age > 120:
            raise serializers.ValidationError('Please enter a valid date of birth.')
        return value

    def validate_password(self, value):
        return validate_password_strength(value)

    def validate_agreed_to_terms(self, value):
        if not value:
            raise serializers.ValidationError('You must agree to the Terms of Service and Privacy Policy.')
        return value

    def validate(self, data):
        if data.get('password') != data.get('confirm_password'):
            raise serializers.ValidationError({'confirm_password': 'Passwords do not match.'})
        return data

    def create(self, validated_data):
        validated_data.pop('confirm_password')
        validated_data.pop('agreed_to_terms')
        dob = validated_data.pop('date_of_birth')
        user = User.objects.create_user(
            username=validated_data['username'],
            email=validated_data['email'],
            password=validated_data['password'],
            first_name=validated_data.get('first_name', ''),
            last_name=validated_data.get('last_name', ''),
        )
        user.date_of_birth = dob
        user.terms_accepted_at = timezone.now()
        user.terms_version = CURRENT_TERMS_VERSION
        user.save(update_fields=['date_of_birth', 'terms_accepted_at', 'terms_version'])
        user.add_to_password_history(user.password)
        return user


# ══════════════════════════════════════════════════════════════════
# ACCOUNT UPDATE — Profile page's "Account" tab
# ══════════════════════════════════════════════════════════════════

class AccountUpdateSerializer(serializers.ModelSerializer):
    """
    Distinct from RegisterSerializer even though the field-level rules
    look similar: uniqueness/reserved-name checks here must exclude the
    user's OWN current value (self.instance), not just check for any
    existing match — RegisterSerializer's validators would incorrectly
    reject a user re-submitting their own unchanged username.
    """
    username = serializers.CharField(
        min_length=3, max_length=30, required=False,
        validators=[RegexValidator(
            regex=r'^[a-zA-Z0-9_]+$',
            message='Username can only contain letters, numbers, and underscores.',
        )],
    )
    date_of_birth = serializers.DateField(required=False, allow_null=True)

    class Meta:
        model = User
        fields = ['first_name', 'last_name', 'username', 'date_of_birth']

    def validate_first_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError('First name is required.')
        if not re.match(r'^[a-zA-Z\s\-]+$', value):
            raise serializers.ValidationError('First name can only contain letters, spaces, and hyphens.')
        return value

    def validate_last_name(self, value):
        value = value.strip()
        if value and not re.match(r'^[a-zA-Z\s\-]+$', value):
            raise serializers.ValidationError('Last name can only contain letters, spaces, and hyphens.')
        return value

    def validate_username(self, value):
        value = value.strip().lower()
        if value in RESERVED_USERNAMES:
            raise serializers.ValidationError('This username is not available.')
        qs = User.objects.filter(username=value)
        if self.instance is not None:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError('This username is already taken.')
        return value

    def validate_date_of_birth(self, value):
        if value is None:
            return value
        age = _calculate_age(value)
        if age < MIN_AGE_YEARS:
            raise serializers.ValidationError(f'You must be at least {MIN_AGE_YEARS} years old.')
        if age > 120:
            raise serializers.ValidationError('Please enter a valid date of birth.')
        return value


# ══════════════════════════════════════════════════════════════════
# USER — read-only representation
# ══════════════════════════════════════════════════════════════════

class UserSerializer(serializers.ModelSerializer):
    is_oauth_only = serializers.SerializerMethodField()
    onboarding_completed = serializers.SerializerMethodField()
    linked_providers = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            'id', 'email', 'username', 'first_name', 'last_name',
            'is_email_verified', 'two_fa_enabled', 'date_of_birth',
            'last_login', 'last_login_ip', 'last_login_device',
            'is_deleted',
            'is_oauth_only',
            # Required by Onboarding.jsx to decide whether to show the
            # terms-acceptance checkbox (OAuth signups only — email/
            # password users already accepted this at registration).
            'terms_accepted_at',
            # Required by ChangeEmail.jsx / Profile.jsx to show the pending-change banner.
            'pending_email',
            # Required by the Login deletion modal and the Dashboard deletion banner.
            'deletion_requested_at',
            'deletion_scheduled_at',
            # Required by PrivateRoute.jsx to redirect to /onboarding until this is true.
            'onboarding_completed',
            'linked_providers',
        ]
        read_only_fields = fields

    def get_is_oauth_only(self, obj):
        try:
            return obj.is_oauth_only()
        except Exception:
            return False

    def get_onboarding_completed(self, obj):
        try:
            return obj.profile.onboarding_completed
        except FreelancerProfile.DoesNotExist:
            return False

    def get_linked_providers(self, obj):
        return list(obj.social_accounts.values_list('provider', flat=True))

# ══════════════════════════════════════════════════════════════════
# FREELANCER PROFILE
# ══════════════════════════════════════════════════════════════════

class FreelancerProfileSerializer(serializers.ModelSerializer):
    """
    CNIC/NTN/PSEB are never read from or written to *_encrypted/*_hash
    directly through this serializer. Reads go through the model's
    decrypted properties (cnic/ntn/pseb); writes go through write-only
    "_input" fields that route through set_cnic()/set_ntn()/set_pseb()
    in update(), which is where validation + the cross-account
    uniqueness check actually happen. This is the only path by which
    these three fields may change — there is no field on this
    serializer that touches *_encrypted or *_hash directly.
    """
    email = serializers.EmailField(source='user.email', read_only=True)
    username = serializers.CharField(source='user.username', read_only=True)
    first_name = serializers.CharField(source='user.first_name', read_only=True)
    last_name = serializers.CharField(source='user.last_name', read_only=True)
    date_of_birth = serializers.DateField(source='user.date_of_birth', read_only=True)
    completion_percentage = serializers.IntegerField(read_only=True)

    cnic = serializers.SerializerMethodField()
    ntn = serializers.SerializerMethodField()
    pseb = serializers.SerializerMethodField()
    cnic_input = serializers.CharField(write_only=True, required=False, allow_blank=True)
    ntn_input = serializers.CharField(write_only=True, required=False, allow_blank=True)
    pseb_input = serializers.CharField(write_only=True, required=False, allow_blank=True)

    class Meta:
        model = FreelancerProfile
        exclude = [
            'cnic_encrypted', 'cnic_hash', 'ntn_encrypted', 'ntn_hash',
            'pseb_encrypted', 'pseb_hash',
            'custom_smtp_password',
            'wise_access_token', 'wise_refresh_token',
            'user',
        ]
        # These fields must only ever change via their own dedicated,
        # validated endpoints (complete_onboarding; save_custom_smtp /
        # disable_custom_smtp) — never through this general-purpose
        # profile PUT. Without this, any authenticated user could
        # PUT {"onboarding_completed": true} directly, skipping the
        # mandatory 16+ age check entirely (the only place age is
        # verified for OAuth signups, which never collect a birthday
        # at registration). Still readable via GET — just not writable
        # through this serializer.
        read_only_fields = [
            'onboarding_completed',
            'custom_smtp_enabled', 'custom_smtp_host', 'custom_smtp_port',
            'custom_smtp_username', 'custom_smtp_use_tls', 'custom_smtp_use_ssl',
            'custom_smtp_from_name', 'custom_smtp_verified', 'custom_smtp_verified_at',
        ]

    # Mirrors Meta.read_only_fields above. read_only_fields silently
    # strips these from validated_data before validate() ever sees
    # them, so an attempted write here would otherwise 200 as a
    # no-op — indistinguishable in logs from a client that just
    # didn't send the field. Checking self.initial_data (the raw
    # incoming dict) is the only way to detect the attempt and turn
    # it into a visible 400.
    LOCKED_FIELDS = {
        'onboarding_completed', 'custom_smtp_enabled', 'custom_smtp_host',
        'custom_smtp_port', 'custom_smtp_username', 'custom_smtp_use_tls',
        'custom_smtp_use_ssl', 'custom_smtp_from_name', 'custom_smtp_verified',
        'custom_smtp_verified_at',
    }

    def get_cnic(self, obj):
        return obj.cnic

    def get_ntn(self, obj):
        return obj.ntn

    def get_pseb(self, obj):
        return obj.pseb

    def validate(self, data):
        attempted = self.LOCKED_FIELDS & set(self.initial_data.keys())
        if attempted:
            raise serializers.ValidationError(
                {field: 'This field can only be changed via its own dedicated endpoint.' for field in attempted}
            )
        return data

    def update(self, instance, validated_data):
        cnic_input = validated_data.pop('cnic_input', None)
        ntn_input = validated_data.pop('ntn_input', None)
        pseb_input = validated_data.pop('pseb_input', None)

        # Apply the plain fields first via the normal ModelSerializer path...
        instance = super().update(instance, validated_data)

        # ...then the three validated/encrypted fields, translating the
        # model layer's ValidationError (raised by set_cnic/set_ntn/set_pseb
        # on bad format or a cross-account collision) into a DRF
        # ValidationError so it surfaces as a normal 400 field error
        # instead of leaking a Django-level exception out of the view.
        errors = {}
        for field_name, raw_value, setter in (
            ('cnic', cnic_input, instance.set_cnic),
            ('ntn', ntn_input, instance.set_ntn),
            ('pseb', pseb_input, instance.set_pseb),
        ):
            if raw_value is None:
                continue
            try:
                setter(raw_value)
            except DjangoValidationError as exc:
                errors[field_name] = exc.messages if hasattr(exc, 'messages') else [str(exc)]

        if errors:
            raise serializers.ValidationError(errors)

        instance.save()
        return instance

# ══════════════════════════════════════════════════════════════════
# ONBOARDING — new for v2, did not exist in v1
# ══════════════════════════════════════════════════════════════════

class UnderageOnboardingError(Exception):
    """
    Raised by OnboardingSerializer.validate() when a submitted date of
    birth reveals the user is under MIN_AGE_YEARS. Distinct from a
    normal serializers.ValidationError because the correct response
    isn't "fix this field and resubmit" — it's closing the account
    (see the onboarding view), the same outcome registration already
    enforces upfront. OAuth signups can't know age until this point,
    since neither provider supplies a birthday today.
    """
    def __init__(self, message):
        self.message = message
        super().__init__(message)


class OnboardingSerializer(serializers.Serializer):
    username = serializers.CharField(
        min_length=3, max_length=30,
        validators=[RegexValidator(
            regex=r'^[a-zA-Z0-9_]+$',
            message='Username can only contain letters, numbers, and underscores.',
        )],
    )
    # Only required for users who don't already have one (OAuth signups —
    # neither Google nor Facebook's current integration supplies a
    # birthday). Enforced conditionally in validate(), not here, since
    # whether it's required depends on the user in context.
    date_of_birth = serializers.DateField(required=False)
    profession = serializers.CharField(max_length=100, min_length=2)
    income_source = serializers.ChoiceField(choices=FreelancerProfile.INCOME_SOURCE_CHOICES)
    platform_used = serializers.ChoiceField(choices=FreelancerProfile.PLATFORM_CHOICES)
    # Only required for users who haven't already accepted (OAuth signups —
    # they skip the registration wizard entirely, so onboarding is the
    # first and only chance to record this). Enforced conditionally in
    # validate(), same pattern as date_of_birth above.
    agreed_to_terms = serializers.BooleanField(required=False)

    def validate_username(self, value):
        value = value.strip().lower()
        if value in RESERVED_USERNAMES:
            raise serializers.ValidationError('This username is not available.')
        user = self.context['user']
        if User.objects.filter(username=value).exclude(pk=user.pk).exists():
            raise serializers.ValidationError('This username is already taken.')
        return value

    def validate(self, data):
        user = self.context['user']
        if not user.date_of_birth:
            dob = data.get('date_of_birth')
            if not dob:
                raise serializers.ValidationError({'date_of_birth': 'Date of birth is required.'})
            age = _calculate_age(dob)
            if age > 120:
                raise serializers.ValidationError({'date_of_birth': 'Enter a valid date of birth.'})
            if age < MIN_AGE_YEARS:
                raise UnderageOnboardingError(
                    f'Your account has been closed because you do not meet the '
                    f'minimum age requirement ({MIN_AGE_YEARS}+).'
                )
        else:
            # Already has a verified DOB from registration — onboarding is
            # not the place to change it (that's Settings' job, with its
            # own validation). Ignored even if a client sends one, as
            # defense in depth against silently overwriting it here.
            data.pop('date_of_birth', None)

        if not user.terms_accepted_at and not data.get('agreed_to_terms'):
            raise serializers.ValidationError(
                {'agreed_to_terms': 'You must agree to the Terms of Service and Privacy Policy.'}
            )
        return data

# ══════════════════════════════════════════════════════════════════
# SESSION — for GET /api/auth/sessions/
# ══════════════════════════════════════════════════════════════════

class SessionSerializer(serializers.ModelSerializer):
    is_current = serializers.SerializerMethodField()
    custom_name = serializers.SerializerMethodField()
    can_rename = serializers.SerializerMethodField()

    class Meta:
        model = Session
        fields = ['id', 'device_name', 'custom_name', 'can_rename', 'ip_address', 'created_at', 'last_used_at', 'expires_at', 'is_current']
        read_only_fields = fields

    def get_is_current(self, obj):
        current_session_id = self.context.get('current_session_id')
        return current_session_id is not None and obj.pk == current_session_id

    def get_custom_name(self, obj):
        return obj.trusted_device.custom_name if obj.trusted_device and obj.trusted_device.custom_name else None

    def get_can_rename(self, obj):
        # Only sessions linked to a recognized device can be renamed —
        # legacy sessions created before this link existed have nowhere
        # to durably store a nickname.
        return obj.trusted_device is not None