# core/middleware.py
"""
One middleware class doing two jobs on purpose. CLAUDE.md's observability
rules ask for (a) a request_id assigned per request and attached to
everything that request touches, and (b) every request logged to
api_request_logs. Splitting these into two separate middleware classes
would create an ordering dependency in the MIDDLEWARE setting (the ID
must be assigned before the logger can use it) that's one settings.py
edit away from silently breaking — installing them in the wrong order
wouldn't error, it would just log every request with request_id=None.
Keeping them as one class removes that failure mode entirely.
"""
import json
import logging
import time
import uuid

from core.models import ApiRequestLog
from core.observability import get_client_ip, get_user_agent, redact_sensitive_fields

logger = logging.getLogger(__name__)


class RequestLoggingMiddleware:
    # Don't try to log multi-MB bodies (file uploads, PDF payloads, etc.) —
    # not useful for debugging and wasteful to store.
    MAX_BODY_BYTES = 20_000

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        request.request_id = str(uuid.uuid4())
        request_body = self._extract_request_body(request)
        started_at = time.perf_counter()

        response = self.get_response(request)

        duration_ms = int((time.perf_counter() - started_at) * 1000)
        response['X-Request-ID'] = request.request_id
        self._log(request, response, request_body, duration_ms)
        return response

    def _extract_request_body(self, request):
        content_type = request.META.get('CONTENT_TYPE', '')
        if not content_type.startswith('application/json'):
            return None  # multipart/form-data (file uploads) etc. — never captured
        body = request.body
        if not body or len(body) > self.MAX_BODY_BYTES:
            return None
        try:
            return redact_sensitive_fields(json.loads(body))
        except (ValueError, UnicodeDecodeError):
            return None

    def _extract_response_body(self, response):
        if getattr(response, 'streaming', False):
            return None
        if 'application/json' not in response.get('Content-Type', ''):
            return None
        content = getattr(response, 'content', b'')
        if not content or len(content) > self.MAX_BODY_BYTES:
            return None
        try:
            return redact_sensitive_fields(json.loads(content))
        except (ValueError, UnicodeDecodeError):
            return None

    def _log(self, request, response, request_body, duration_ms):
        try:
            user = getattr(request, 'user', None)
            if user is not None and not getattr(user, 'is_authenticated', False):
                user = None

            response_body = None
            if response.status_code >= 500:
                response_body = self._extract_response_body(response)

            ApiRequestLog.objects.create(
                request_id=request.request_id,
                user=user,
                method=request.method,
                path=request.path[:500],
                status_code=response.status_code,
                ip_address=get_client_ip(request),
                user_agent=get_user_agent(request),
                request_body=request_body,
                response_body=response_body,
                duration_ms=duration_ms,
            )
        except Exception:
            logger.exception(
                'Failed to write ApiRequestLog for request_id=%s',
                getattr(request, 'request_id', None),
            )