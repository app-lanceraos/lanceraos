# apps/invoices/apps.py
from django.apps import AppConfig


class InvoicesConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.invoices'
    label = 'invoices'

    def ready(self):
        # Registers this app's @on(...) event handlers (core/events.py) —
        # notifications.py is otherwise never imported by anything, so
        # its decorators would never run and every emit('InvoiceSent'/
        # 'CustomSmtpFailed'/...) would silently call zero handlers.
        from . import notifications  # noqa: F401
