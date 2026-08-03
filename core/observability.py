# core/observability.py
"""
Logging helpers used by every app. Centralized here so that:
  - get_client_ip / get_user_agent / normalize_user_agent aren't
    reimplemented per-app (v1 only needed these in apps/users, but
    Session.device_name and TrustedDevice.device_name need the exact
    same UA-parsing logic, and future modules will too).
  - log_event() is the one place that writes to AuditLog, so every
    caller gets the same "never raise, always log the failure instead
    of crashing the request" behavior for free for free.
"""
import logging
import re

from .models import AuditLog

logger = logging.getLogger(__name__)


# ══════════════════════════════════════════════════════════════════
# REQUEST METADATA
# ══════════════════════════════════════════════════════════════════

def get_client_ip(request):
    """
    Only trusts X-Forwarded-For's LAST entry (the one closest to Django —
    i.e. the one the trusted reverse proxy itself appended), never the
    first entry, which is fully client-controlled and trivially spoofed
    to defeat IP-based rate limiting and poison the audit trail. This
    assumes exactly one trusted reverse proxy sits in front of Django
    (Railway's edge) — if that topology ever changes (e.g. a CDN added
    in front of Railway), this needs revisiting, since "last entry" only
    reflects "closest proxy," not "the one you trust," once there's more
    than one hop.
    """
    forwarded = request.META.get('HTTP_X_FORWARDED_FOR')
    if forwarded:
        return forwarded.split(',')[-1].strip()
    return request.META.get('REMOTE_ADDR', '') or None


def get_user_agent(request):
    return request.META.get('HTTP_USER_AGENT', '')[:500]


def normalize_user_agent(ua):
    """
    Strips version numbers, returns 'Browser on OS'. Used for:
      - Session.device_name / TrustedDevice.device_name (human-readable
        device list in the Sessions UI)
      - new-device login detection (comparing normalized UA prevents a
        false "new device" alert every time a browser auto-updates)
    """
    if not ua:
        return 'Unknown device'

    browser = 'Unknown browser'
    for pattern, name in [
        (r'Edg(?:e|/)', 'Edge'),
        (r'Firefox/', 'Firefox'),
        (r'OPR/', 'Opera'),
        (r'Chrome/', 'Chrome'),
        (r'Safari/', 'Safari'),
    ]:
        if re.search(pattern, ua):
            browser = name
            break

    os_name = 'Unknown OS'
    for pattern, name in [
        (r'Windows NT', 'Windows'),
        (r'Mac OS X', 'macOS'),
        (r'Linux', 'Linux'),
        (r'Android', 'Android'),
        (r'iPhone|iPad', 'iOS'),
    ]:
        if re.search(pattern, ua):
            os_name = name
            break

    return f'{browser} on {os_name}'


# ══════════════════════════════════════════════════════════════════
# REDACTION — for ApiRequestLog.request_body (core.middleware)
# ══════════════════════════════════════════════════════════════════

# Matched case-insensitively against dict keys at any nesting depth.
SENSITIVE_KEYS = {
    'password', 'old_password', 'new_password', 'confirm_password',
    'token', 'access', 'refresh', 'credential', 'otp', 'otp_code',
    'session_id', 'trusted_device_token', 'secret', 'api_key',
    'smtp_password', 'custom_smtp_password',
    'cnic', 'ntn', 'pseb', 'cnic_number', 'ntn_number',
    'authorization', 'cookie',
}
REDACTED_PLACEHOLDER = '***REDACTED***'

# Key-based redaction (below) only catches sensitive values that arrive
# under a sensitive KEY NAME. It does nothing for a secret typed into an
# otherwise-innocuous free-text field — e.g. an admin's search query, or
# a suspension reason, both logged verbatim into AuditLog.metadata by
# core.observability.log_event. This pattern catches the common
# "key=value" / "key: value" shape of an accidentally-pasted credential
# inside such a string, independent of which dict key it's nested under.
_SENSITIVE_VALUE_PATTERN = re.compile(
    r'(?i)\b(' + '|'.join(re.escape(k) for k in SENSITIVE_KEYS) + r')\s*[:=]\s*\S+'
)


def _redact_value_content(value):
    if isinstance(value, str):
        return _SENSITIVE_VALUE_PATTERN.sub(
            lambda m: f'{m.group(1)}={REDACTED_PLACEHOLDER}', value,
        )
    return value


def redact_sensitive_fields(data):
    """
    Recursively redacts sensitive dict keys (at any nesting depth) AND
    sensitive-looking content inside string values (see
    _redact_value_content) from a dict/list/string structure — used both
    for ApiRequestLog.request_body (core.middleware) and AuditLog.metadata
    (log_event, below). Returns a new structure — never mutates the
    input, since request-body callers still need the original,
    un-redacted data to actually process the request.
    """
    if isinstance(data, dict):
        return {
            key: (REDACTED_PLACEHOLDER if key.lower() in SENSITIVE_KEYS
                  else redact_sensitive_fields(value))
            for key, value in data.items()
        }
    if isinstance(data, list):
        return [redact_sensitive_fields(item) for item in data]
    return _redact_value_content(data)


# ══════════════════════════════════════════════════════════════════
# AUDIT LOG WRITER
# ══════════════════════════════════════════════════════════════════

def log_event(event, user=None, actor=None, request=None, ip_address=None, user_agent=None, metadata=None):
    """
    Writes a row to AuditLog. Never raises — an audit-logging failure
    must not take down the request that triggered it. Logs the failure
    via the standard logging module instead (STANDARDS.md: no print()
    statements anywhere).

    Pass `request` when available and it supplies ip/user_agent/request_id
    automatically; pass ip_address/user_agent directly for the cases with
    no request object (e.g. a Celery task running the deletion sweep).

    Pass `actor` only when someone other than `user` performed the
    action — an admin acting on someone else's account. Leave it unset
    for every self-service event, where the actor and the subject are
    already the same person captured in `user`.
    """
    request_id = None
    if request is not None:
        ip_address = ip_address or get_client_ip(request)
        user_agent = user_agent or get_user_agent(request)
        request_id = getattr(request, 'request_id', None)

    try:
        return AuditLog.objects.create(
            user=user,
            actor=actor,
            event=event,
            request_id=request_id,
            ip_address=ip_address or None,
            user_agent=(user_agent or '')[:500],
            metadata=redact_sensitive_fields(metadata or {}),
        )
    except Exception:
        logger.exception('Failed to write AuditLog entry for event=%s user=%s actor=%s', event, user, actor)
        return None