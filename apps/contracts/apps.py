# apps/contracts/apps.py
from django.apps import AppConfig


class ContractsConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.contracts'
    label = 'contracts'

    def ready(self):
        # Registers this app's @on(...) event handlers (core/events.py) - notifications.py is otherwise never
        # imported by anything, so its decorators would never run and every emit('ContractSigned'/...) would
        # silently call zero handlers (the same trap apps.proposals' own apps.py documents).
        from . import notifications  # noqa: F401
