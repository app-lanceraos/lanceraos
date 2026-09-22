# apps/clients/apps.py
from django.apps import AppConfig


class ClientsConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.clients'
    label = 'clients'

    def ready(self):
        # Registers this app's first-ever @on(...) event handler
        # (core/events.py) — Client Portal Redesign, Phase 1b. Mirrors
        # apps.invoices.apps.InvoicesConfig.ready()'s exact pattern:
        # notifications.py is otherwise never imported by anything, so
        # its decorator would never run and
        # emit('ClientDetailsChangeRequested', ...) would silently call
        # zero handlers.
        from . import notifications  # noqa: F401
