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
from collections import namedtuple
from datetime import timedelta
from itertools import groupby

from celery import shared_task
from dateutil.relativedelta import relativedelta
from django.utils import timezone

from core.email import send_client_facing_email, send_email
from core.events import emit

from .email_service import (
    build_reminder_email, build_unread_comments_email_for_client, build_unread_comments_email_for_freelancer,
    send_invoice_related_email,
)
from .models import NON_OVERDUE_STATUSES, Invoice, InvoiceComment, InvoiceReminder

logger = logging.getLogger(__name__)

# A minimal duck-typed stand-in for the HTTP request object
# _send_invoice_now (views.py) reads .user/.request_id from — there is no
# real request in a Celery task's execution context. Mirrors the
# _CookieOnlyRequest shim apps/invoices/consumers.py already established
# for the identical "reuse an HTTP-shaped function outside an HTTP
# request" problem (see DECISIONS.md).
_TaskRequest = namedtuple('_TaskRequest', ['user', 'request_id'])

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


@shared_task(name='apps.invoices.tasks.notify_unread_comments')
def notify_unread_comments():
    """
    Runs every 15 minutes (see config/celery.py's beat_schedule) —
    CLAUDE.md's Client Messaging spec: "If unread after exactly 1 hour:
    one reminder email... No further reminders." ONE email per invoice,
    covering everything unread at the threshold (batched, not one email
    per comment) — grouped in Python via itertools.groupby over a
    queryset already ordered by (invoice_id, created_at), not a separate
    aggregation query.

    InvoiceComment.unread_reminder_sent_at (Step 13 migration) is the
    real "already notified" marker this needs: without it, a comment
    still unread on the NEXT run (15 min later) would generate a second
    email, then a third, etc. Set once, on every comment included in a
    batch, right after that batch's email is sent — never cleared, never
    re-checked.

    Symmetric by direction, per this step's own explicit instruction —
    the original spec prose only describes client-authored comments
    notifying the freelancer, but a real two-way thread means the
    freelancer's own unread replies should notify the client identically:
      - author_type='client', unread by freelancer -> notify the
        freelancer via plain core.email.send_email (never the custom-
        SMTP-vs-Resend chain — a platform notification TO the freelancer
        about their own account can't route "as" their own business
        identity to themselves; that chain is structurally for
        CLIENT-facing sends only, confirmed against how CustomSmtpFailed/
        every other freelancer-facing notification already works).
      - author_type='freelancer', unread by client -> notify the client
        via send_client_facing_email (core/email.py), the standard
        client-facing routing chain, per CLAUDE.md's Custom Email Rule 2
        ("Client messages" is explicitly one of the listed categories).
    """
    cutoff = timezone.now() - timedelta(hours=1)
    notified_count = 0

    freelancer_pending = InvoiceComment.objects.filter(
        author_type='client', created_at__lte=cutoff,
        read_by_freelancer_at__isnull=True, unread_reminder_sent_at__isnull=True,
    ).select_related('invoice', 'invoice__user').order_by('invoice_id', 'created_at')

    for _invoice_id, group in groupby(freelancer_pending, key=lambda c: c.invoice_id):
        comments = list(group)
        invoice = comments[0].invoice
        try:
            subject, html_body, plain_body = build_unread_comments_email_for_freelancer(invoice, comments)
            send_email(invoice.user.email, subject, html_body, plain_body)
            InvoiceComment.objects.filter(pk__in=[c.pk for c in comments]).update(unread_reminder_sent_at=timezone.now())
            notified_count += len(comments)
            logger.info(
                '[INVOICES] Unread-comment batch email sent to freelancer for invoice %s (%d comment(s)).',
                invoice.invoice_number, len(comments),
            )
        except Exception:
            logger.exception('[INVOICES] Error notifying freelancer of unread comments for invoice_id=%s.', invoice.pk)

    client_pending = InvoiceComment.objects.filter(
        author_type='freelancer', created_at__lte=cutoff,
        read_by_client_at__isnull=True, unread_reminder_sent_at__isnull=True,
    ).select_related('invoice', 'invoice__user').order_by('invoice_id', 'created_at')

    for _invoice_id, group in groupby(client_pending, key=lambda c: c.invoice_id):
        comments = list(group)
        invoice = comments[0].invoice
        if not invoice.client_email:
            continue  # a one-time client with no email on record — nothing to notify
        try:
            subject, html_body, plain_body = build_unread_comments_email_for_client(invoice, comments)
            send_client_facing_email(
                invoice.user, invoice.client_email, subject, html_body, plain_body,
                recipient_name=invoice.client_name, context_type='invoice', context_id=str(invoice.pk),
            )
            InvoiceComment.objects.filter(pk__in=[c.pk for c in comments]).update(unread_reminder_sent_at=timezone.now())
            notified_count += len(comments)
            logger.info(
                '[INVOICES] Unread-comment batch email sent to client for invoice %s (%d comment(s)).',
                invoice.invoice_number, len(comments),
            )
        except Exception:
            logger.exception('[INVOICES] Error notifying client of unread comments for invoice_id=%s.', invoice.pk)

    logger.info('[INVOICES] notify_unread_comments: notified for %d comment(s) across both directions.', notified_count)
    return {'notified': notified_count}


# ══════════════════════════════════════════════════════════════════
# RECURRING GENERATION — Step 16
# ══════════════════════════════════════════════════════════════════
# Some of Invoice.RECURRING_INTERVAL_CHOICES' day-counts are really
# calendar-month approximations (60 = "every 2 months", 90 =
# "quarterly", 365 = "annually") — advancing those by a naive
# days-multiplication drifts against real month length over a year.
# Advanced via dateutil.relativedelta instead. 7/14 (weekly/fortnightly)
# are genuinely day-based and advance by timedelta directly.
MONTH_BASED_RECURRING_INTERVALS = {30: 1, 60: 2, 90: 3, 365: 12}

# After this many CONSECUTIVE failed generation attempts for the same
# triggering invoice, the series auto-pauses rather than retrying
# forever — see generate_recurring_invoices' own docstring.
MAX_RECURRING_FAILURES = 3


def _advance_recurring_date(base_date, interval_days):
    """Anchored from base_date (the invoice's own PREVIOUS next_recurring_date), never from today — so a late-running task doesn't compound drift into the schedule itself."""
    months = MONTH_BASED_RECURRING_INTERVALS.get(interval_days)
    if months:
        return base_date + relativedelta(months=months)
    return base_date + timedelta(days=interval_days)


@shared_task(name='apps.invoices.tasks.generate_recurring_invoices')
def generate_recurring_invoices():
    """
    Runs daily (see config/celery.py's beat_schedule). For every invoice
    with is_recurring=True, recurring_paused=False, and
    next_recurring_date<=today, processed independently — one invoice's
    failure never blocks the others in the same run (each iteration has
    its own try/except, same pattern send_invoice_reminders already
    established above).

    Series settings (recurring_interval_days/recurring_auto_send/design)
    are read LIVE from the invoice's own recurring root
    (Invoice.get_recurring_root()) at generation time, never copied or
    frozen onto a generated child — DECISIONS.md's own Step 16 design
    decision. In practice the triggering invoice here IS always the
    root: a generated child never gets its own next_recurring_date set
    (see the is_recurring=False/recurring_interval_days=None override
    below), so it can never independently satisfy this query's filter —
    only the root ever does. parent_invoice on each generated child is
    still written generically as "the invoice that triggered this
    generation" rather than hand-coded to Invoice.pk-of-root, so the
    mechanism stays correct even if that ever changes.

    Reuses _duplicate_invoice_core/_finalise_invoice/_send_invoice_now
    from views.py — the exact same duplication and finalise-and-send
    mechanics invoice_duplicate/invoice_finalise_and_send already use,
    never a third, parallel implementation. Imported locally (not at
    module level) purely to keep this file's own top-level import list
    reminder/comment-task-focused; there is no real circular-import risk
    either way (views.py has no dependency on tasks.py).

    due_date on the new child is recomputed from the SAME (due_date -
    issue_date) offset the triggering invoice already had, applied to
    today's date — invoice_duplicate's own existing behavior (copying
    due_date verbatim) is correct for a manually-reviewed one-off
    duplicate, but would make every auto-generated recurring invoice
    instantly overdue, so this task computes its own due_date instead of
    relying on _duplicate_invoice_core's copied default.

    Failure handling: an exception raised by the actual generation step
    (_duplicate_invoice_core itself — no child row created at all) is
    what counts as a real failure: next_recurring_date is left UNCHANGED
    so the next run retries the same cycle, recurring_failure_count
    increments, and at MAX_RECURRING_FAILURES the series auto-pauses
    with a distinctly-worded notification. A failure AFTER the child
    invoice already exists (auto-send's own finalise/send hiccup) is
    deliberately NOT treated as a generation failure — the occurrence
    was genuinely generated (a real draft invoice exists for the
    freelancer to review/send manually), so treating it as a retry-able
    failure would create a SECOND duplicate child for the same cycle on
    the next run. That case is only logged, never raises out of this
    task's outer try/except.
    """
    from .views import _duplicate_invoice_core, _finalise_invoice, _send_invoice_now

    today = timezone.now().date()
    generated_count = 0
    failed_count = 0

    due = Invoice.objects.filter(
        is_recurring=True, recurring_paused=False, next_recurring_date__lte=today,
    ).select_related('user', 'user__profile', 'parent_invoice')

    for invoice in due:
        try:
            root = invoice.get_recurring_root()
            interval_days = root.recurring_interval_days
            if not interval_days:
                logger.warning('[INVOICES] Recurring invoice %s has no recurring_interval_days on its root — skipping.', invoice.pk)
                continue

            if invoice.due_date and invoice.issue_date:
                terms_days = max((invoice.due_date - invoice.issue_date).days, 0)
                new_due_date = today + timedelta(days=terms_days)
            else:
                new_due_date = None

            new_invoice = _duplicate_invoice_core(
                invoice,
                parent_invoice=invoice,
                design=root.design,
                due_date=new_due_date,
                # Series-level settings, deliberately NOT copied onto the
                # occurrence — always read live from the root instead.
                is_recurring=False, recurring_interval_days=None, recurring_auto_send=False,
            )

            if root.recurring_auto_send:
                try:
                    _finalise_invoice(new_invoice, force_reminders_off=False)
                    send_response = _send_invoice_now(new_invoice, _TaskRequest(user=new_invoice.user, request_id=None))
                    if send_response.status_code != 200:
                        logger.error(
                            '[INVOICES] Recurring auto-send failed for generated invoice %s (from %s): %s',
                            new_invoice.pk, invoice.invoice_number, getattr(send_response, 'data', None),
                        )
                except Exception:
                    logger.exception(
                        '[INVOICES] Recurring auto-finalise/send raised for generated invoice %s (from %s) — '
                        'the draft was created and needs manual finalise/send.',
                        new_invoice.pk, invoice.invoice_number,
                    )
            else:
                emit(
                    'RecurringInvoiceGenerated', invoice_id=str(new_invoice.pk), user_id=str(invoice.user_id),
                    generated_from=str(invoice.pk),
                )

            invoice.next_recurring_date = _advance_recurring_date(invoice.next_recurring_date, interval_days)
            invoice.recurring_failure_count = 0
            invoice.save(update_fields=['next_recurring_date', 'recurring_failure_count'])

            generated_count += 1
            logger.info('[INVOICES] Generated recurring invoice %s from %s.', new_invoice.pk, invoice.invoice_number)

        except Exception:
            logger.exception('[INVOICES] Error generating recurring invoice for invoice_id=%s.', invoice.pk)
            failed_count += 1
            invoice.recurring_failure_count += 1
            if invoice.recurring_failure_count >= MAX_RECURRING_FAILURES:
                invoice.recurring_paused = True
                invoice.save(update_fields=['recurring_failure_count', 'recurring_paused'])
                emit(
                    'RecurringGenerationPaused', invoice_id=str(invoice.pk), user_id=str(invoice.user_id),
                    failure_count=invoice.recurring_failure_count,
                )
            else:
                invoice.save(update_fields=['recurring_failure_count'])
                emit(
                    'RecurringGenerationFailed', invoice_id=str(invoice.pk), user_id=str(invoice.user_id),
                    failure_count=invoice.recurring_failure_count,
                )
            continue

    logger.info('[INVOICES] generate_recurring_invoices: generated %d, failed %d.', generated_count, failed_count)
    return {'generated': generated_count, 'failed': failed_count}
