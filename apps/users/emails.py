# apps/users/emails.py
"""
Templated platform-security emails. Every function here calls
core.email.send_email() directly — never Django's email backend, never
custom SMTP — because everything sent from this module falls under
CLAUDE.md's "always from lanceraos.com" category (verification,
password reset, 2FA, security alerts), regardless of whether the
recipient has their own custom SMTP configured for client-facing mail.
"""
from django.conf import settings

from core.email import send_email

BRAND_ACCENT = '#00c896'
BRAND_NAVY = '#1e3a5f'


def _frontend_url(path: str) -> str:
    base = getattr(settings, 'FRONTEND_URL', 'http://localhost:5173').rstrip('/')
    return f'{base}{path}'


def _name(user) -> str:
    return user.first_name or user.username or 'there'


def _html(body_html: str, title: str = 'LanceraOS') -> str:
    return f"""
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>{title}</title></head>
<body style="margin:0;padding:0;background:#f4f4f8;font-family:-apple-system,Segoe UI,Roboto,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f8;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:480px;background:#ffffff;border-radius:12px;overflow:hidden;">
        <tr><td style="background:{BRAND_NAVY};padding:24px 32px;">
          <span style="color:#ffffff;font-size:18px;font-weight:700;">LanceraOS</span>
        </td></tr>
        <tr><td style="padding:32px;">
          {body_html}
        </td></tr>
        <tr><td style="padding:20px 32px;background:#f8fafc;color:#94a3b8;font-size:12px;">
          LanceraOS &middot; lanceraos.com
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
"""


def _button(url: str, label: str, color: str = BRAND_ACCENT, text_color: str = '#000000') -> str:
    return (
        f'<a href="{url}" style="display:inline-block;padding:12px 28px;background:{color};'
        f'color:{text_color};text-decoration:none;border-radius:8px;font-weight:600;font-size:14px;">'
        f'{label}</a>'
    )


def _code_box(code: str) -> str:
    return (
        f'<div style="background:#f0f0f6;border-radius:10px;padding:20px;text-align:center;'
        f'font-size:32px;font-weight:700;letter-spacing:8px;color:{BRAND_NAVY};margin:16px 0;">{code}</div>'
    )


def _alert_box(text: str) -> str:
    return (
        f'<div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;'
        f'padding:14px 16px;color:#92400e;font-size:14px;margin:16px 0;">{text}</div>'
    )


def _heading(text: str) -> str:
    return f'<h2 style="margin:0 0 12px;color:#0e0e1a;font-size:20px;">{text}</h2>'


def _paragraph(text: str) -> str:
    return f'<p style="margin:0 0 16px;color:#4a4a65;font-size:14px;line-height:1.6;">{text}</p>'


# ══════════════════════════════════════════════════════════════════
# REGISTRATION / VERIFICATION
# ══════════════════════════════════════════════════════════════════

def send_verification_email(user, token, uid) -> bool:
    url = _frontend_url(f'/verify-email/{uid}/{token}/')
    body = (
        _heading(f'Welcome to LanceraOS, {_name(user)}')
        + _paragraph('Please verify your email address to activate your account.')
        + f'<div style="text-align:center;margin:24px 0;">{_button(url, "Verify Email Address")}</div>'
        + _paragraph('This link expires in 24 hours. If you didn\'t create this account, you can ignore this email.')
    )
    return send_email(user.email, 'Verify your LanceraOS account', _html(body))


def send_welcome_email(user) -> bool:
    url = _frontend_url('/login')
    body = (
        _heading(f'You\'re all set, {_name(user)}!')
        + _paragraph('Your email is verified and your LanceraOS account is ready to go.')
        + f'<div style="text-align:center;margin:24px 0;">{_button(url, "Sign In")}</div>'
    )
    return send_email(user.email, 'Welcome to LanceraOS', _html(body))


# ══════════════════════════════════════════════════════════════════
# PASSWORD RESET / CHANGE
# ══════════════════════════════════════════════════════════════════

def send_password_reset_email(user, token, uid) -> bool:
    url = _frontend_url(f'/reset-password/{uid}/{token}/')
    body = (
        _heading('Reset your password')
        + _paragraph(f'Hi {_name(user)}, we received a request to reset your LanceraOS password.')
        + f'<div style="text-align:center;margin:24px 0;">{_button(url, "Reset Password")}</div>'
        + _paragraph('This link expires in 1 hour. If you didn\'t request this, you can safely ignore this email — your password will not change.')
    )
    return send_email(user.email, 'Reset your LanceraOS password', _html(body))


def send_password_changed_email(user) -> bool:
    body = (
        _heading('Your password was changed')
        + _paragraph(f'Hi {_name(user)}, this confirms your LanceraOS password was just changed. '
                     'All other devices have been signed out.')
        + _alert_box('If you did not make this change, reset your password immediately and contact support.')
    )
    return send_email(user.email, 'Your LanceraOS password was changed', _html(body))


def send_account_locked_email(user, duration_minutes: int) -> bool:
    body = (
        _heading('Your account has been temporarily locked')
        + _paragraph(f'Hi {_name(user)}, too many incorrect login attempts were made on your account. '
                     f'It has been locked for {duration_minutes} minutes as a security precaution.')
        + _paragraph('You can also reset your password now to unlock your account immediately.')
    )
    return send_email(user.email, 'LanceraOS account locked', _html(body))


# ══════════════════════════════════════════════════════════════════
# 2FA
# ══════════════════════════════════════════════════════════════════

def send_2fa_code_email(user, otp_code: str) -> bool:
    body = (
        _heading('Your verification code')
        + _paragraph(f'Hi {_name(user)}, enter this code to finish signing in:')
        + _code_box(otp_code)
        + _paragraph('This code expires in 10 minutes. If you didn\'t request this, someone may have your password — consider changing it.')
    )
    return send_email(user.email, f'Your LanceraOS verification code: {otp_code}', _html(body))


def send_2fa_enabled_email(user) -> bool:
    body = (
        _heading('Two-factor authentication enabled')
        + _paragraph(f'Hi {_name(user)}, two-factor authentication is now active on your account.')
    )
    return send_email(user.email, 'Two-factor authentication enabled', _html(body))


def send_2fa_disabled_email(user) -> bool:
    body = (
        _heading('Two-factor authentication disabled')
        + _paragraph(f'Hi {_name(user)}, two-factor authentication has been turned off for your account.')
        + _alert_box('If you didn\'t make this change, secure your account immediately.')
    )
    return send_email(user.email, 'Two-factor authentication disabled', _html(body))


# ══════════════════════════════════════════════════════════════════
# EMAIL CHANGE FLOW
# ══════════════════════════════════════════════════════════════════

def send_email_change_step1_email(user, token, uid) -> bool:
    url = _frontend_url(f'/change-email/{uid}/{token}/')
    body = (
        _heading('Change your email address')
        + _paragraph(f'Hi {_name(user)}, we received a request to change the email address on your LanceraOS account.')
        + f'<div style="text-align:center;margin:24px 0;">{_button(url, "Continue")}</div>'
        + _paragraph('This link expires in 24 hours. If you did not request this, you can safely ignore this email.')
    )
    return send_email(user.email, 'Confirm your email change request', _html(body))


def send_email_change_step2_email(user, token, uid, new_email) -> bool:
    url = _frontend_url(f'/activate-email/{uid}/{token}/')
    body = (
        _heading('Confirm your new email address')
        + _paragraph(f'Hi {_name(user)}, click below to confirm this address as your new LanceraOS login email.')
        + f'<div style="text-align:center;margin:24px 0;">{_button(url, "Confirm New Email")}</div>'
        + _paragraph('This link expires in 24 hours.')
    )
    return send_email(new_email, 'Confirm your new LanceraOS email address', _html(body))


def send_email_changed_notification_to_old(user, old_email, new_email) -> bool:
    body = (
        _heading('Your email address was changed')
        + _paragraph(f'This confirms your LanceraOS account email was changed from {old_email} to {new_email}.')
        + _alert_box('If you did not make this change, contact support immediately.')
    )
    return send_email(old_email, 'Your LanceraOS email address was changed', _html(body))


# ══════════════════════════════════════════════════════════════════
# ACCOUNT DELETION
# ══════════════════════════════════════════════════════════════════

def send_account_deletion_otp_email(user, otp_code: str) -> bool:
    body = (
        _heading('Confirm account deletion')
        + _paragraph(f'Hi {_name(user)}, enter this code to confirm you want to delete your LanceraOS account:')
        + _code_box(otp_code)
        + _paragraph('This code expires in 10 minutes. If you didn\'t request this, you can safely ignore this email — your account is safe.')
    )
    return send_email(user.email, f'Confirm account deletion: {otp_code}', _html(body))


def send_account_deletion_confirmed_email(user) -> bool:
    body = (
        _heading('Your account is scheduled for deletion')
        + _paragraph(f'Hi {_name(user)}, your LanceraOS account has been scheduled for permanent deletion in 30 days.')
        + _paragraph('You can cancel this at any time within the next 30 days by simply logging back in.')
        + _alert_box('After 30 days, your account and personal information will be permanently removed. This cannot be undone.')
    )
    return send_email(user.email, 'Your LanceraOS account is scheduled for deletion', _html(body))


# ══════════════════════════════════════════════════════════════════
# LOGIN SECURITY
# ══════════════════════════════════════════════════════════════════

def send_new_device_login_email(user, ip_address, user_agent, timestamp) -> bool:
    when = timestamp.strftime('%B %d, %Y at %I:%M %p').replace(' 0', ' ')
    body = (
        _heading('New sign-in to your account')
        + _paragraph(f'Hi {_name(user)}, your account was just signed into from a new device or location:')
        + f'<p style="margin:0 0 4px;color:#0e0e1a;font-size:14px;"><strong>When:</strong> {when}</p>'
        + f'<p style="margin:0 0 4px;color:#0e0e1a;font-size:14px;"><strong>IP address:</strong> {ip_address or "unknown"}</p>'
        + f'<p style="margin:0 0 16px;color:#0e0e1a;font-size:14px;"><strong>Device:</strong> {user_agent or "unknown"}</p>'
        + _alert_box('If this wasn\'t you, change your password immediately.')
    )
    return send_email(user.email, 'New sign-in to your LanceraOS account', _html(body))