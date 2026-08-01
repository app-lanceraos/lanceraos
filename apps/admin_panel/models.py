# apps/admin_panel/models.py
"""
Genuinely independent from apps.users.Session — an admin login must
never compete for the regular app's 3-concurrent-session cap (logging
into admin.lanceraos.com evicting a legitimate regular-app session
would be a real, undesirable side effect of sharing a model). Same
reasoning that gave TrustedDevice its own table rather than overloading
Session with a second purpose.
"""
import hashlib
import uuid
from datetime import timedelta

from django.conf import settings
from django.db import models, transaction
from django.utils import timezone


class AdminSession(models.Model):
    # Deliberately tighter than the regular app's 3-device cap — this is
    # the highest-privilege surface in the system. Adjust if genuinely
    # too restrictive in practice — starting conservative is the safer
    # direction to err in.
    MAX_ADMIN_SESSIONS_PER_USER = 2

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='admin_sessions',
    )
    refresh_token_hash = models.CharField(max_length=64, unique=True)
    device_name = models.CharField(max_length=300, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    last_used_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()

    class Meta:
        db_table = 'admin_sessions'
        indexes = [
            models.Index(fields=['user', 'last_used_at']),
            models.Index(fields=['refresh_token_hash']),
            models.Index(fields=['expires_at']),
        ]

    def __str__(self):
        return f'admin session — {self.user.email} — {self.device_name[:40]}'

    @staticmethod
    def _hash_token(raw_token):
        return hashlib.sha256(raw_token.encode()).hexdigest()

    @classmethod
    def get_valid(cls, raw_token):
        return cls.objects.filter(
            refresh_token_hash=cls._hash_token(raw_token),
            expires_at__gt=timezone.now(),
        ).first()

    @classmethod
    def create_for_user(cls, user, raw_token, device_name, ip_address, lifetime_days=1):
        """
        Same concurrency-safe pattern as apps.users.models.Session —
        locks the user row for the duration of the check-evict-create
        sequence so concurrent admin logins can't both read the same
        under-cap count and race past the limit. Short default lifetime
        (1 day) relative to the regular app's 30/90 — an admin session
        being forced to re-authenticate more often is the right tradeoff
        for this privilege level.
        """
        with transaction.atomic():
            type(user).objects.select_for_update().get(pk=user.pk)
            active = cls.objects.select_for_update().filter(user=user, expires_at__gt=timezone.now())
            if active.count() >= cls.MAX_ADMIN_SESSIONS_PER_USER:
                oldest = active.order_by('last_used_at').first()
                if oldest:
                    oldest.delete()
            return cls.objects.create(
                user=user,
                refresh_token_hash=cls._hash_token(raw_token),
                device_name=device_name[:300],
                ip_address=ip_address,
                expires_at=timezone.now() + timedelta(days=lifetime_days),
            )

    def touch(self):
        self.last_used_at = timezone.now()
        self.save(update_fields=['last_used_at'])

    def rotate(self, new_raw_token, lifetime_days):
        self.refresh_token_hash = self._hash_token(new_raw_token)
        self.expires_at = timezone.now() + timedelta(days=lifetime_days)
        self.last_used_at = timezone.now()
        self.save(update_fields=['refresh_token_hash', 'expires_at', 'last_used_at'])

    @classmethod
    def cleanup_expired(cls):
        return cls.objects.filter(expires_at__lt=timezone.now()).delete()[0]
