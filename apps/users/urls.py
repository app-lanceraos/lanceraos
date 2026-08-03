# apps/users/urls.py
from django.urls import path

from .views import add_password, auth, deletion, oauth, profile, security, sessions, smtp

app_name = 'users'

urlpatterns = [
    # ── CSRF ─────────────────────────────────────────────────────
    path('csrf/', auth.get_csrf_token, name='csrf'),

    # ── Registration ─────────────────────────────────────────────
    path('register/', auth.register, name='register'),
    path('check-availability/', auth.check_availability, name='check_availability'),

    # ── Login / session lifecycle ───────────────────────────────
    path('login/', auth.login, name='login'),
    path('logout/', auth.logout, name='logout'),
    path('token/refresh/', auth.refresh, name='token_refresh'),
    path('me/', profile.me, name='me'),

    # ── 2FA ──────────────────────────────────────────────────────
    path('2fa/verify/', auth.verify_2fa, name='2fa_verify'),
    path('2fa/resend/', auth.resend_2fa, name='2fa_resend'),
    path('2fa/toggle/', security.toggle_2fa, name='2fa_toggle'),

    # ── OAuth ────────────────────────────────────────────────────
    path('google/', oauth.google_login, name='google_login'),
    path('facebook/', oauth.facebook_login, name='facebook_login'),

    # ── Email verification ──────────────────────────────────────
    path('verify-email/<str:uid>/<str:token>/', auth.verify_email, name='verify_email'),
    path('resend-verification/', auth.resend_verification, name='resend_verification'),
    path('check-verification-status/', auth.check_verification_status, name='check_verification_status'),

    # ── Password ─────────────────────────────────────────────────
    path('forgot-password/', auth.forgot_password, name='forgot_password'),
    path('reset-password/<str:uid>/<str:token>/', auth.reset_password, name='reset_password'),
    path('change-password/', security.change_password, name='change_password'),

    # ── Add password (OAuth-only accounts) ──────────────────────────
    path('security/add-password/request/', add_password.request_add_password, name='request_add_password'),
    path('security/add-password/validate/<str:uidb64>/<str:token>/', add_password.validate_add_password_token, name='validate_add_password_token'),
    path('security/add-password/complete/<str:uidb64>/<str:token>/', add_password.complete_add_password, name='complete_add_password'),

    # ── Profile / account ────────────────────────────────────────
    path('profile/', profile.profile, name='profile'),
    path('profile/upload-logo/', profile.upload_logo, name='upload_logo'),
    path('settings/notifications/', profile.notification_settings, name='notification_settings'),
    path('account/', profile.update_account, name='update_account'),
    path('onboarding/complete/', profile.complete_onboarding, name='onboarding_complete'),

    # ── Sessions ─────────────────────────────────────────────────
    path('sessions/', sessions.list_sessions, name='sessions_list'),
    path('sessions/<uuid:session_id>/', sessions.revoke_session, name='session_revoke'),
    path('sessions/<uuid:session_id>/rename/', sessions.rename_session_device, name='session_rename'),

    # ── Email change (3-step: current inbox -> new email + password -> new inbox) ──
    path('email-change/request/', security.request_email_change, name='email_change_request'),
    path('email-change/validate/<str:ecr_uid>/<str:token>/', security.validate_email_change_token, name='email_change_validate'),
    path('email-change/complete/<str:ecr_uid>/<str:token>/', security.complete_email_change_step1, name='email_change_complete'),
    path('email-change/activate/<str:ecr_uid>/<str:token>/', security.activate_new_email, name='email_change_activate'),
    path('email-change/cancel/', security.cancel_email_change, name='email_change_cancel'),

    # ── Account deletion (password -> OTP -> confirm, 30-day recovery window) ──
    path('deletion/initiate/', deletion.initiate_deletion, name='deletion_initiate'),
    path('deletion/initiate-oauth/', deletion.initiate_deletion_oauth, name='deletion_initiate_oauth'),
    path('deletion/verify-otp/', deletion.verify_deletion_otp, name='deletion_verify_otp'),
    path('deletion/confirm/', deletion.confirm_deletion, name='deletion_confirm'),
    path('deletion/cancel/', deletion.cancel_deletion, name='deletion_cancel'),

    # ── Custom SMTP (Pro feature — client-facing email delivery, not platform emails) ──
    path('smtp/save/', smtp.save_custom_smtp, name='smtp_save'),
    path('smtp/disable/', smtp.disable_custom_smtp, name='smtp_disable'),
    path('smtp/status/', smtp.smtp_status, name='smtp_status'),
]