# core/management/commands/check_ai_models.py
"""
Checks that the configured Groq models still work. Run it after deploying
and after any Groq deprecation notice (`docker compose exec web python
manage.py check_ai_models`) — GROQ_MODEL_QUALITY sat dead for three weeks
before anyone noticed (DECISIONS.md, 06 September 2026); this makes that
failure a one-command check.

For each of GROQ_MODEL_FAST and GROQ_MODEL_QUALITY it (a) looks the id up in
Groq's live model catalog and (b) makes one tiny real completion through
run_ai_task(system=True, feature='model_check'), so the call is logged like
any other. GROQ_MODEL_VISION is configured but used by no feature: it is
printed, never called. Exits non-zero if any checked model fails. Never
prints the API key or any request header.
"""
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from core.ai import AiError, list_groq_models, run_ai_task

CHECK_PROMPT = 'Return only {"ok": true} as JSON.'
# Generous because the reasoning models spend tokens thinking before the
# answer (measured: ~80 of ~90 completion tokens on this exact prompt).
CHECK_MAX_TOKENS = 400


class Command(BaseCommand):
    help = 'Verifies the configured Groq FAST and QUALITY models are in the live catalog and answer a tiny request.'

    def handle(self, *args, **options):
        try:
            catalog = list_groq_models()
        except AiError as exc:
            catalog = None
            self.stdout.write(f'Model catalog: unavailable ({exc.reason}); skipping the catalog check.')

        failures = 0
        for label, model in (('FAST', settings.GROQ_MODEL_FAST), ('QUALITY', settings.GROQ_MODEL_QUALITY)):
            in_catalog = None if catalog is None else model in catalog
            result = run_ai_task(
                feature='model_check', system=True, model=model, max_tokens=CHECK_MAX_TOKENS,
                messages=[{'role': 'user', 'content': CHECK_PROMPT}],
            )
            listed = {None: 'catalog n/a', True: 'in catalog', False: 'NOT in catalog'}[in_catalog]
            if result.ok and in_catalog is not False:
                tokens = result.usage.get('total_tokens', '?')
                self.stdout.write(self.style.SUCCESS(
                    f'OK   {label:<8} {model}  ({listed}, {result.latency_ms} ms, {tokens} tokens)'))
            else:
                failures += 1
                why = result.failure_reason or 'missing from the live catalog'
                self.stdout.write(self.style.ERROR(f'FAIL {label:<8} {model}  ({listed}; {why})'))

        self.stdout.write(f'VISION   {settings.GROQ_MODEL_VISION}  (configured, used by no feature — not called)')
        if failures:
            raise CommandError(f'{failures} model check(s) failed.')
