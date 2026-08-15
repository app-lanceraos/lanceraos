# config/celery.py
import os

from celery import Celery
from celery.schedules import crontab

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')

app = Celery('lanceraos')
app.config_from_object('django.conf:settings', namespace='CELERY')
app.autodiscover_tasks()

# apps.users and apps.payments exist so far in the v2 rebuild. Each future
# module (invoices, tax, etc.) adds its own entries to this dict when it's
# built — this file gets edited in that module's own chat, not reinvented;
# don't add schedule entries here for tasks that don't exist yet, since
# Celery Beat resolves the task string at execution time and a dangling
# reference would only surface as a runtime error far from whichever
# commit introduced it.
app.conf.beat_schedule = {
    'anonymize-expired-accounts-daily': {
        'task': 'apps.users.tasks.anonymize_expired_accounts',
        'schedule': crontab(hour=2, minute=0),
    },
    'cleanup-trusted-devices-weekly': {
        'task': 'apps.users.tasks.cleanup_trusted_devices',
        'schedule': crontab(hour=3, minute=0, day_of_week='sunday'),
    },
    'cleanup-expired-sessions-daily': {
        'task': 'apps.users.tasks.cleanup_expired_sessions',
        'schedule': crontab(hour=2, minute=15),
    },
    'cleanup-email-change-requests-daily': {
        'task': 'apps.users.tasks.cleanup_email_change_requests',
        'schedule': crontab(hour=2, minute=30),
    },
    'fetch-exchange-rates-daily': {
        'task': 'apps.payments.tasks.fetch_exchange_rates',
        'schedule': crontab(hour=8, minute=0),
    },
    # 8:30 — deliberately between the exchange-rate fetch (8:00) and
    # reminders (9:00): a freshly auto-generated-and-sent recurring
    # invoice should exist before that same day's reminder pass runs,
    # not after (no functional collision either way today, since a
    # brand-new invoice's due_date is always in the future, but this is
    # the more sensible ordering going forward).
    'generate-recurring-invoices-daily': {
        'task': 'apps.invoices.tasks.generate_recurring_invoices',
        'schedule': crontab(hour=8, minute=30),
    },
    'send-invoice-reminders-daily': {
        'task': 'apps.invoices.tasks.send_invoice_reminders',
        'schedule': crontab(hour=9, minute=0),
    },
    'notify-unread-comments-every-15-minutes': {
        'task': 'apps.invoices.tasks.notify_unread_comments',
        'schedule': crontab(minute='*/15'),
    },
    # Monday morning, after the day's own 9:00 reminder run — a weekly
    # (not daily) nudge, so it deliberately doesn't collide with any
    # daily-scheduled task's own slot.
    'notify-stale-drafts-weekly': {
        'task': 'apps.invoices.tasks.notify_stale_drafts',
        'schedule': crontab(hour=9, minute=30, day_of_week='monday'),
    },
}

app.conf.timezone = 'Asia/Karachi'