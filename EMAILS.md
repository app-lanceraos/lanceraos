# EMAILS.md — Email Registry

Every email LanceraOS sends: what triggers it, whether it blocks the request or runs async, and
whether it's backed by an `AuditLog` entry (and therefore shows up in the notification bell — see
`core/notifications.py`'s `NOTIFICATION_EVENTS` allowlist).

"Async" here means genuinely dispatched through Celery (`.delay()`), not just "the request doesn't
wait for Resend's HTTP response" — a synchronous call to `send_email()` still blocks the request
thread on that outbound call (see `DECISIONS.md`'s note on why `forgot_password`/
`resend_verification` were specifically moved off the request thread — this was a real, closed
timing-oracle finding, not just a performance nicety).

| Email | Function | Trigger | Async? | Audit event | Notification bell? |
|---|---|---|---|---|---|
| Verify your account | `send_verification_email` | Registration; also re-sent automatically if login is attempted on an unverified account | No (register, login-redirect); **yes** via `send_verification_email_task` (explicit resend, and forgot-password-for-unverified-user) | `registered` / `resend_verification` | No |
| Welcome to LanceraOS | `send_welcome_email` | The moment `GET /verify-email/<uid>/<token>/` succeeds | No | `email_verified` | No |
| Reset your password | `send_password_reset_email` | `POST /auth/forgot-password/` for an existing, verified, non-OAuth account | **Yes**, via `send_password_reset_email_task` | `password_reset_request` | No |
| Your password was changed | `send_password_changed_email` | Authenticated `POST /auth/change-password/` | No | `password_changed` | **Yes** |
| Your password was reset | `send_password_reset_completed_email` | Token-based `POST /auth/reset-password/<uid>/<token>/` — deliberately distinct wording/function from the one above | No | `password_reset_done` | **Yes** |
| LanceraOS account locked | `send_account_locked_email` | Only the exact login attempt that newly triggers a lockout, not every subsequent attempt while already locked | No | `account_locked` | No — informational, but not on the notification allowlist; worth a decision if that should change |
| Your verification code | `send_2fa_code_email` | Every login needing a 2FA code, and every explicit "resend code" | No | `login_2fa_required` | No |
| Two-factor authentication enabled | `send_2fa_enabled_email` | `POST /auth/2fa/toggle/` (enable) — includes device/time/IP | No | `2fa_enabled` | **Yes** |
| Two-factor authentication disabled | `send_2fa_disabled_email` | `POST /auth/2fa/toggle/` (disable) — includes device/time/IP | No | `2fa_disabled` | **Yes** |
| Confirm your email change request | `send_email_change_step1_email` | `POST /auth/email-change/request/` — sent to the *current* email | No | `email_change_requested` | No |
| Confirm your new email address | `send_email_change_step2_email` | After clicking the step-1 link and submitting the new address | No | `email_change_step1` | No |
| Your email address was changed | `send_email_changed_notification_to_old` | The moment the new-email confirmation completes — sent to the *old* address | No | `email_change_done` | **Yes** |
| Confirm account deletion | `send_account_deletion_otp_email` | `POST /auth/deletion/initiate/` (after password confirmation) | No | `deletion_requested` *(unconfirmed exact event name — verify against the actual `log_event()` call before treating this as final)* | No |
| Your account is scheduled for deletion | `send_account_deletion_confirmed_email` | OTP verified, deletion confirmed | No | `deletion_confirmed` | **Yes** |
| Your account has been deleted | `send_account_deleted_email` | The daily `anonymize_expired_accounts` Celery Beat task — sent to the *original* email, captured before `anonymize()` overwrites it | Runs inside an already-async Celery task, but the send call itself is a plain synchronous call within that task | **None currently** — only a `logger.info()` call, not `log_event()`/`AuditLog` | No (correctly — the account no longer has a working login by this point) |
| New sign-in to your account | `send_new_device_login_email` | Any login (regular, 2FA-verified, or OAuth) where the device isn't already recognized via `TrustedDevice` | No | `new_device_login` | **Yes** |

## Two real gaps this table surfaces, worth a decision rather than silently leaving as-is

1. **`send_account_deletion_otp_email` doesn't have a confirmed audit event name.** Every other row
   in this table was checked against a real `log_event()` call in the code; this one wasn't
   directly re-verified while writing this document, and shouldn't be treated as settled until it
   is.
2. **`anonymize_expired_accounts` never writes to `AuditLog` at all** — only to the application log
   (`logger.info`), which isn't queryable, isn't part of the security audit trail, and isn't the
   same guarantee every other account lifecycle event gets. Worth deciding whether final account
   anonymization deserves a real audit-log entry (it arguably should — "this account was
   anonymized, on this date, per its own schedule" seems like exactly the kind of thing the audit
   trail exists for), even though it can't show up as a notification to the user themselves for the
   reason already noted above.

## Not yet built

Every email for Invoices, Payments, Proposals, Contracts, Subscriptions — none of those modules
exist yet. This registry only covers what's real today.
