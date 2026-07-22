# config/celery.py
import os

from celery import Celery
from celery.schedules import crontab

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')

app = Celery('lanceraos')
app.config_from_object('django.conf:settings', namespace='CELERY')
app.autodiscover_tasks()

# Only apps.users exists so far in the v2 rebuild. Each future module
# (invoices, payments, tax, etc.) adds its own entries to this dict when
# it's built — this file gets edited in that module's own chat, not
# reinvented; don't add schedule entries here for tasks that don't exist
# yet, since Celery Beat resolves the task string at execution time and
# a dangling reference would only surface as a runtime error far from
# whichever commit introduced it.
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
}

app.conf.timezone = 'Asia/Karachi'