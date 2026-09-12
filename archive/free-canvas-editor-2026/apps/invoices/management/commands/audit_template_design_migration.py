# apps/invoices/management/commands/audit_template_design_migration.py
"""
Template Builder 2.0 — Phase 0. A READ-ONLY report on how every real
InvoiceDesign row in the database would fare under the legacy-to-v2
migration mapper (apps/invoices/design_migration.py). Never calls
.save()/.update()/.delete() on anything it reads — this command exists
to answer "what would happen" before any real migration is attempted,
per LANCERAOS_TEMPLATE_BUILDER_2_ARCHITECTURE_PLAN.md's Section 20 safety
requirements. Real migration of these rows is a deliberately separate,
future, explicitly-approved step — not part of this command or this phase.
"""
import logging

from django.core.management.base import BaseCommand

from apps.invoices.design_migration import migrate_v1_to_v2
from apps.invoices.design_schema import SCHEMA_VERSION_LEGACY, SCHEMA_VERSION_V2, get_schema_version
from apps.invoices.models import InvoiceDesign

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = (
        'READ-ONLY report on every InvoiceDesign row\'s migration readiness '
        '(legacy schema -> Template Builder 2.0 v2 canonical schema). Modifies nothing.'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--verbose', action='store_true',
            help='List every design individually (id, name, owner, status), not just aggregate counts.',
        )

    def handle(self, *args, **options):
        verbose = options['verbose']

        already_v2 = 0
        migratable = 0
        needs_manual_intervention = 0
        unsupported_version = 0
        per_design = []

        queryset = InvoiceDesign.objects.all().order_by('created_at')
        total = queryset.count()

        for design in queryset:
            try:
                version = get_schema_version(design.design_data)
            except ValueError as exc:
                unsupported_version += 1
                per_design.append((design, 'UNSUPPORTED', [str(exc)], []))
                continue

            if version == SCHEMA_VERSION_V2:
                already_v2 += 1
                per_design.append((design, 'ALREADY_V2', [], []))
                continue

            if version != SCHEMA_VERSION_LEGACY:
                unsupported_version += 1
                per_design.append((design, 'UNSUPPORTED', [f'Unrecognized schema_version {version}.'], []))
                continue

            result = migrate_v1_to_v2(design.design_data)
            if result['success']:
                migratable += 1
                per_design.append((design, 'MIGRATABLE', result['errors'], result['warnings']))
            else:
                needs_manual_intervention += 1
                per_design.append((design, 'NEEDS_MANUAL_INTERVENTION', result['errors'], result['warnings']))

        self.stdout.write(self.style.MIGRATE_HEADING(
            'Template Builder 2.0 — Design Migration Readiness Report (READ-ONLY)'
        ))
        self.stdout.write(f'Total InvoiceDesign records: {total}')
        self.stdout.write(f'  Already schema_version 2:          {already_v2}')
        self.stdout.write(f'  Migratable (legacy, clean):        {migratable}')
        self.stdout.write(f'  Needs manual intervention:         {needs_manual_intervention}')
        self.stdout.write(f'  Unsupported/unrecognized version:  {unsupported_version}')

        if verbose:
            self.stdout.write('')
            self.stdout.write('Per-design detail:')
            for design, status, errors, warnings in per_design:
                self.stdout.write(f'  [{status}] {design.id} — "{design.name}" (user={design.user_id})')
                for err in errors:
                    self.stdout.write(self.style.ERROR(f'      error:   {err}'))
                for warn in warnings:
                    self.stdout.write(self.style.WARNING(f'      warning: {warn}'))

        self.stdout.write('')
        self.stdout.write(self.style.SUCCESS(
            'This command made NO changes to any record. No real migration has occurred.'
        ))
