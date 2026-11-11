# apps/help/apps.py
"""AppConfig for the Help assistant: a guide library, search and an optional AI answer layer (no models, no migration)."""
from django.apps import AppConfig


class HelpConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.help'
    label = 'help'

    def ready(self):
        # Registers the library's system check. It runs with `manage.py check` and with `migrate`, which the deploy runs
        # before the new web service starts: a content mistake fails the release, not the users (see checks.py).
        from . import checks  # noqa: F401
