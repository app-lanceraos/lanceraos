# core/models.py
"""
Shared, cross-module tables used by every app, not just users/.

AuditLog replaces v1's three overlapping, app-specific tables
(AccountEvent, LoginEvent, RegistrationAttempt) with one table every
module writes to. 'event' is a free-form string, not a fixed choices
list — this table is used by invoices/payments/contracts/etc. later,
so hardcoding an auth-specific choices list here would mean either
constantly editing core/models.py for every future module's events, or
every module inventing its own event log again (the exact duplication
this table exists to avoid). Each app documents its own event-name
constants near its own audit-log call sites instead.
"""
import uuid

from django.conf import settings
from django.db import models


class AuditLog(models.Model):
    """
    Immutable, append-only. Never updated after creation — if a security
    review needs to know what happened, this table needs to say what
    the system believed was true *at the time*, not the current state.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name='audit_logs',
        help_text='Null when the event has no authenticated actor yet '
                   '(e.g. a failed login attempt against an unknown email).',
    )
    event = models.CharField(max_length=60)
    request_id = models.CharField(
        max_length=36, blank=True, null=True,
        help_text='Ties this event to the HTTP request that caused it '
                   '(core.middleware assigns one UUID per request).',
    )
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.CharField(max_length=500, blank=True)
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'audit_log'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['user', 'created_at']),
            models.Index(fields=['event', 'created_at']),
            models.Index(fields=['ip_address', 'created_at']),
            models.Index(fields=['request_id']),
        ]

    def __str__(self):
        return f'[{self.event}] {self.user or "anonymous"} @ {self.ip_address}'


class ApiRequestLog(models.Model):
    """
    One row per HTTP request, written by core.middleware. Per CLAUDE.md's
    observability rules: request bodies are logged with sensitive fields
    redacted (see core.observability.redact_sensitive_fields); response
    bodies are only captured when status_code >= 500, since logging every
    response body at scale is mostly noise and mostly PII, and the cases
    that actually need the response body for debugging are the 5xx ones.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    request_id = models.CharField(max_length=36, unique=True)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name='api_request_logs',
    )
    method = models.CharField(max_length=10)
    path = models.CharField(max_length=500)
    status_code = models.PositiveSmallIntegerField()
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.CharField(max_length=500, blank=True)
    request_body = models.JSONField(null=True, blank=True, help_text='Sensitive fields redacted before storage.')
    response_body = models.JSONField(null=True, blank=True, help_text='Only populated when status_code >= 500.')
    duration_ms = models.PositiveIntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'api_request_logs'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['user', 'created_at']),
            models.Index(fields=['status_code', 'created_at']),
            models.Index(fields=['created_at']),
        ]

    def __str__(self):
        return f'{self.method} {self.path} -> {self.status_code} [{self.request_id}]'