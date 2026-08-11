# apps/invoices/tasks.py
"""
Reminder scheduling — day 3/7/14/30 overdue, escalating tone. Ported
from v1-reference/apps/invoices/tasks.py's send_invoice_reminders, but
adapted for two real v2 differences, not copied verbatim:

  1. v2 has no stored 'overdue' status (a real v1 bug this project fixes
     on purpose — see NON_OVERDUE_STATUSES' own module comment in
     models.py). Eligibility here is derived the same way
     Invoice.days_overdue itself is: exclude NON_OVERDUE_STATUSES,
     require due_date in the past.
  2. sent_via_platform must be True — this is what Step 10 (the real
     /send/ action) finally makes possible for a real invoice, since
     invoice_mark_sent (the manual self-report flip) never sets it. A
     manually-marked-sent invoice, however overdue, is never reminded by
     this task — reminders were never really "on" for it to begin with,
     matching sent_via_platform's own field help_text ("Gates reminders
     only").

Calls apps.invoices.email_service.send_invoice_related_email() — the
SAME shared custom-SMTP-vs-Resend routing function invoice_send (views.py)
uses — rather than re-implementing that decision chain a second time
here.
"""
import logging

from celery import shared_task
from django.utils import timezone

from core.events import emit

from .email_service import build_reminder_email, send_invoice_related_email
from .models import NON_OVERDUE_STATUSES, Invoice, InvoiceReminder

logger = logging.getLogger(__name__)

# day-overdue threshold -> (reminder_number, template key) — matches
# InvoiceReminder.TEMPLATE_CHOICES exactly (models.py) and
# email_service.REMINDER_SCHEDULE (content-builder side).
REMINDER_SCHEDULE = [
    (3, 1, 'reminder_1'),
    (7, 2, 'reminder_2'),
    (14, 3, 'reminder_3'),
    (30, 4, 'reminder_4'),
]


@shared_task(name='apps.invoices.tasks.send_invoice_reminders')
def send_invoice_reminders():
    """
    Runs daily (see config/celery.py's beat_schedule). Sends exactly one
    reminder level per eligible invoice per run — InvoiceReminder's own
    unique_together(invoice, reminder_number) makes a duplicate
    impossible even if this task were ever triggered twice for the same
    day, but the `already_sent` check below (and the `break` after the
    first match) avoids relying on that constraint alone to decide when
    to stop, matching v1's own "one level per invoice per run" behavior.
    """
    today = timezone.now().date()
    sent_count = 0

    eligible = Invoice.objects.filter(
        sent_via_platform=True,
        reminders_enabled=True,
        due_date__lt=today,
    ).exclude(status__in=NON_OVERDUE_STATUSES).select_related('user', 'user__profile')

    for invoice in eligible:
        try:
            days_overdue = invoice.days_overdue
            if days_overdue <= 0:
                continue  # defensive — the queryset filter above should already guarantee this

            for min_days, reminder_number, template_key in REMINDER_SCHEDULE:
                if days_overdue < min_days:
                    continue

                already_sent = InvoiceReminder.objects.filter(
                    invoice=invoice, reminder_number=reminder_number,
                ).exists()
                if already_sent:
                    continue

                subject, html_body, plain_body = build_reminder_email(invoice, reminder_number)
                result = send_invoice_related_email(invoice, subject, html_body, plain_body)

                InvoiceReminder.objects.create(
                    invoice=invoice, reminder_number=reminder_number, template_used=template_key,
                    delivered=result['sent'], days_overdue_at_send=days_overdue,
                )
                invoice.reminder_count += 1
                invoice.last_reminder_sent_at = timezone.now()
                invoice.save(update_fields=['reminder_count', 'last_reminder_sent_at'])

                emit(
                    'ReminderSent', invoice_id=str(invoice.pk), user_id=str(invoice.user_id),
                    reminder_number=reminder_number, delivered=result['sent'],
                )

                if reminder_number == 4:
                    invoice.escalation_required = True
                    invoice.save(update_fields=['escalation_required'])
                    emit('EscalationRequired', invoice_id=str(invoice.pk), user_id=str(invoice.user_id))

                sent_count += 1
                logger.info(
                    '[INVOICES] Reminder %s sent for %s (%sd overdue).',
                    reminder_number, invoice.invoice_number, days_overdue,
                )
                break  # only one reminder level per invoice per run, matching v1

        except Exception:
            logger.exception('[INVOICES] Error processing reminders for invoice_id=%s.', invoice.pk)
            continue

    logger.info('[INVOICES] send_invoice_reminders: sent %s reminder(s) for %s.', sent_count, today)
    return {'sent': sent_count, 'date': str(today)}
