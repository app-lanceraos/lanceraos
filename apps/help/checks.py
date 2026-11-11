# apps/help/checks.py
"""
The guide library as a Django system check (Prompt 24, Part 2). `manage.py check` and `manage.py migrate` both run the
system checks, and the deploy runs `migrate` as a pre-deploy step - so a structural mistake in a guide (a bad slug, a digit,
a banned word, a link that is not allowed, quoted words that are not in ui_labels, a missing guide) fails the RELEASE before
the new web service starts, instead of failing for users. Only the structural checks run here: the repo checks (are the
quoted labels really on screen, do the links hit real routes) need frontend/, which the Docker image does not carry, so
they are `manage.py check_help_library` (run before each release, DEPLOYMENT.md section 7m).
"""
from django.core.checks import Error, register

from . import library


@register()
def check_help_library(app_configs, **kwargs):
    """One Error per problem found by library.problems() (no repo_root)."""
    return [Error(problem, hint='Fix the guide in apps/help/guides/, then run `python manage.py check_help_library`.', id='help.E001')
            for problem in library.problems()]
