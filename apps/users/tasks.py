# apps/users/tasks.py
import logging

from celery import shared_task
from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone

from core.observability import log_event

logger = logging.getLogger(__name__)


@shared_task(bind=True, max_retries=3, default_retry_delay=300)
def anonymize_expired_accounts(self):
    """
    Runs daily at 2 AM Karachi time. Anonymizes (never hard-deletes)
    every account whose deletion_scheduled_at has passed — see
    User.anonymize() for exactly what gets stripped and what survives.

    This replaces v1's delete_expired_accounts, which called user.delete()
    and relied on CASCADE to remove every related row, including
    financial records. That's wrong for a product that generates FBR
    tax documents: invoices/payments need a PROTECT relationship to
    User and must survive account deletion in anonymized form, which is
    exactly what anonymize() is for.
    """
    User = get_user_model()
    now = timezone.now()

    to_process = User.objects.filter(
        is_deleted=True,
        anonymized_at__isnull=True,
        deletion_scheduled_at__lte=now,
    )

    processed, failed = 0, 0
    for user in to_process:
        try:
            with transaction.atomic():
                email = user.email  # capture before it's overwritten
                user_id = user.pk
                user.anonymize()
                processed += 1
                logger.info('[ANONYMIZE] Anonymized account: %s (id=%s)', email, user_id)
                # Distinct from 'deletion_confirmed' (the earlier, user-initiated step 30
                # days prior) — this is the final, system-triggered completion. No `request`
                # object exists in this scheduled-task context, so ip_address/user_agent are
                # left unset; `original_email` is kept in metadata specifically so a support
                # question like "was this email actually deleted, and when?" has a real,
                # searchable answer even after the User row itself no longer shows it.
                log_event(
                    'account_anonymized',
                    user=user,
                    metadata={'original_email': email},
                )

            from .emails import send_account_deleted_email
            send_account_deleted_email(email)
        except Exception as exc:
            failed += 1
            logger.error('[ANONYMIZE ERROR] Failed for user pk=%s: %s', user.pk, exc)
            try:
                raise self.retry(exc=exc)
            except self.MaxRetriesExceededError:
                logger.critical('[ANONYMIZE CRITICAL] Max retries exceeded for user pk=%s', user.pk)

    logger.info('[ANONYMIZE TASK] Completed: %s anonymized, %s failed. Run at %s', processed, failed, now.isoformat())
    return {'anonymized': processed, 'failed': failed}


@shared_task
def cleanup_trusted_devices():
    """Removes expired TrustedDevice rows. Runs weekly."""
    from .models import TrustedDevice
    deleted_count = TrustedDevice.cleanup_expired()
    logger.info('[CLEANUP] Removed %s expired trusted devices.', deleted_count)
    return deleted_count


@shared_task
def cleanup_expired_sessions():
    """Removes expired Session rows. Runs daily — these are also cleaned lazily on refresh, this is the safety net for abandoned sessions nobody ever tried to refresh."""
    from .models import Session
    deleted_count = Session.cleanup_expired()
    logger.info('[CLEANUP] Removed %s expired sessions.', deleted_count)
    return deleted_count


@shared_task
def send_password_reset_email_task(user_id, token, uid):
    """
    Offloads the outbound Resend HTTPS call in forgot_password() (views/auth.py)
    onto a worker so the HTTP response doesn't wait on it — otherwise the
    "account exists" branch takes measurably longer than the "account
    doesn't exist" branch (a cache write only), defeating the endpoint's
    own uniform-response timing claim.
    """
    from .emails import send_password_reset_email
    User = get_user_model()
    try:
        user = User.objects.get(pk=user_id)
    except User.DoesNotExist:
        return
    send_password_reset_email(user, token, uid)


@shared_task
def send_verification_email_task(user_id, token, uid):
    """Same timing-parity reasoning as send_password_reset_email_task, for forgot_password()'s unverified-user branch and resend_verification()."""
    from .emails import send_verification_email
    User = get_user_model()
    try:
        user = User.objects.get(pk=user_id)
    except User.DoesNotExist:
        return
    send_verification_email(user, token, uid)


@shared_task
def cleanup_email_change_requests():
    """
    Marks expired EmailChangeRequest rows as 'expired' and clears
    pending_email from the affected users. Runs daily.
    """
    from django.contrib.auth import get_user_model
    from .models import EmailChangeRequest
    User = get_user_model()
    now = timezone.now()

    step1_expired = EmailChangeRequest.objects.filter(step='step1_pending', step1_expires_at__lt=now)
    step1_count = step1_expired.count()
    step1_expired.update(step='expired')

    step2_expired = EmailChangeRequest.objects.filter(step='step2_pending', step2_expires_at__lt=now)
    user_ids = list(step2_expired.values_list('user_id', flat=True))
    step2_count = step2_expired.count()
    step2_expired.update(step='expired')

    if user_ids:
        User.objects.filter(pk__in=user_ids).update(pending_email='', pending_email_expires_at=None)

    logger.info(
        '[CLEANUP] Email change requests expired: step1=%s, step2=%s, pending_email cleared for %s users.',
        step1_count, step2_count, len(user_ids),
    )
    return {'step1_expired': step1_count, 'step2_expired': step2_count}