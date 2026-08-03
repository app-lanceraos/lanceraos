# apps/admin_panel/token_service.py
"""
Admin equivalent of apps.users.token_service — mints a token pair and
creates the corresponding AdminSession, embedding admin_sid (not sid)
on the access token so AdminCookieJWTAuthentication can distinguish
this from a regular access token. Also embeds pca — an admin whose
password changes must have every existing admin session invalidated
too, same reasoning as the regular flow.
"""
from datetime import timedelta

from django.utils import timezone
from rest_framework_simplejwt.tokens import RefreshToken

from core.observability import get_client_ip, get_user_agent, normalize_user_agent

from .models import AdminSession

ADMIN_REFRESH_DAYS = 1  # matches AdminSession's short-lived-by-design lifetime


def _build_admin_refresh_token(user):
    refresh = RefreshToken.for_user(user)
    refresh.set_exp(lifetime=timedelta(days=ADMIN_REFRESH_DAYS))
    refresh['pca'] = int(user.password_changed_at.timestamp()) if user.password_changed_at else None
    return refresh


def issue_admin_tokens_and_session(user, request):
    refresh = _build_admin_refresh_token(user)
    refresh_str = str(refresh)

    admin_session = AdminSession.create_for_user(
        user=user,
        raw_token=refresh_str,
        device_name=normalize_user_agent(get_user_agent(request)),
        ip_address=get_client_ip(request),
        lifetime_days=ADMIN_REFRESH_DAYS,
    )

    access = refresh.access_token
    access['admin_sid'] = str(admin_session.pk)
    return str(access), refresh_str, admin_session


def rotate_admin_session(user, admin_session, request):
    refresh = _build_admin_refresh_token(user)
    refresh_str = str(refresh)

    admin_session.rotate(refresh_str, lifetime_days=ADMIN_REFRESH_DAYS)
    admin_session.ip_address = get_client_ip(request) or admin_session.ip_address
    admin_session.save(update_fields=['ip_address'])

    access = refresh.access_token
    access['admin_sid'] = str(admin_session.pk)
    return str(access), refresh_str
