# apps/invoices/management/commands/migrate_invoice_designs_to_production_schema.py
"""
Template Builder production cutover — the real, one-time migration this
codebase's own `audit_template_design_migration.py` (Phase 0) explicitly
deferred: "Real migration of these rows is a deliberately separate,
future, explicitly-approved step." That approval is this task.

Explicit, deterministic, safe:
  - Dry-run by default. Nothing is written unless `--apply` is passed.
  - Every legacy (schema_version 1/absent) InvoiceDesign row is migrated
    via `design_migration.migrate_v1_to_v2` (the same pure, deterministic,
    already-tested mapper this codebase has used since Phase 0) inside a
    single atomic transaction per row.
  - A row that fails migration is left completely untouched — logged
    clearly, never silently dropped or corrupted. It remains readable/
    deletable through the existing unified CRUD (InvoiceDesignSerializer
    accepts either schema shape), and still renders correctly through
    `pdf_generator.render_html_for_design`'s legacy-compatibility branch
    (apps/invoices/legacy_design_renderer.py) — this command's job is to
    UPGRADE what it safely can, never to force every row into the new
    shape at the cost of losing one.
  - `InvoiceDesign.save()`'s own existing `_create_version_if_content_changed`
    creates a real InvoiceDesignVersion row for the migrated content, same
    as any other real content-changing save — so a design's own version
    history keeps growing, never resets.

Run `python manage.py export_invoice_designs_backup` first (this command
does not do that itself) — a real, separate, already-existing safety net,
per this project's own established convention of one command per
distinct responsibility (audit / backup / migrate).
"""
import logging

from django.core.management.base import BaseCommand
from django.db import transaction

from apps.invoices.design_migration import migrate_v1_to_v2
from apps.invoices.design_schema import SCHEMA_VERSION_LEGACY, SCHEMA_VERSION_V2, get_schema_version
from apps.invoices.models import InvoiceDesign

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = (
        'Migrates every legacy-schema InvoiceDesign row to the production v2 schema, in place. '
        'Dry-run by default — pass --apply to actually write. Rows that fail migration are left '
        'untouched, never corrupted or deleted.'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--apply', action='store_true',
            help='Actually write the migrated design_data. Without this flag, only reports what would happen.',
        )

    def handle(self, *args, **options):
        apply_changes = options['apply']
        mode_label = 'APPLYING' if apply_changes else 'DRY RUN (pass --apply to write)'
        self.stdout.write(self.style.MIGRATE_HEADING(
            f'Template Builder production cutover — InvoiceDesign migration ({mode_label})',
        ))

        migrated, skipped_already_v2, failed, unsupported = 0, 0, 0, 0

        for design in InvoiceDesign.objects.all().order_by('created_at'):
            try:
                version = get_schema_version(design.design_data)
            except ValueError as exc:
                unsupported += 1
                self.stdout.write(self.style.ERROR(
                    f'  [UNSUPPORTED] {design.id} "{design.name}" (user={design.user_id}): {exc}',
                ))
                continue

            if version == SCHEMA_VERSION_V2:
                skipped_already_v2 += 1
                continue

            if version != SCHEMA_VERSION_LEGACY:
                unsupported += 1
                self.stdout.write(self.style.ERROR(
                    f'  [UNSUPPORTED] {design.id} "{design.name}" (user={design.user_id}): '
                    f'unrecognized schema_version {version}.',
                ))
                continue

            result = migrate_v1_to_v2(design.design_data)
            if not result['success']:
                failed += 1
                self.stdout.write(self.style.WARNING(
                    f'  [SKIPPED — left in legacy shape] {design.id} "{design.name}" '
                    f'(user={design.user_id}):',
                ))
                for err in result['errors']:
                    self.stdout.write(self.style.WARNING(f'      {err}'))
                continue

            migrated += 1
            self.stdout.write(self.style.SUCCESS(
                f'  [MIGRATED] {design.id} "{design.name}" (user={design.user_id})',
            ))
            for warning in result['warnings']:
                self.stdout.write(f'      note: {warning}')

            if apply_changes:
                with transaction.atomic():
                    design.design_data = result['design_data']
                    design.save()
                    logger.info(
                        '[INVOICES] Production cutover: migrated InvoiceDesign %s to v2 schema.',
                        design.id,
                    )

        self.stdout.write('')
        self.stdout.write(f'Migrated:              {migrated}')
        self.stdout.write(f'Already v2 (skipped):  {skipped_already_v2}')
        self.stdout.write(f'Failed (left as-is):   {failed}')
        self.stdout.write(f'Unsupported version:   {unsupported}')

        if not apply_changes:
            self.stdout.write('')
            self.stdout.write(self.style.WARNING(
                'This was a DRY RUN. No database records were modified. Re-run with --apply to write.',
            ))
        else:
            self.stdout.write('')
            self.stdout.write(self.style.SUCCESS('Migration applied. See the log lines above for exactly what changed.'))
