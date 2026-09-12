# apps/invoices/management/commands/export_invoice_designs_backup.py
"""
Template Builder 2.0 — Phase 0. A READ-ONLY, deterministic export of
every InvoiceDesign row's full field set to a single JSON file, so a
recoverable snapshot exists before any future real migration touches
this table. Reads the database; never writes to it. See
LANCERAOS_TEMPLATE_BUILDER_2_ARCHITECTURE_PLAN.md's Section 20 (Migration
Strategy) — this command is the "backup" half of that section's safety
requirements; audit_template_design_migration.py is the separate "what
would change" half. Neither performs any real migration.

Output is a single JSON object: an envelope (export timestamp, row
count, source model) wrapping a list of every InvoiceDesign row's fields
(including design_data verbatim, unmigrated) — self-describing, so the
file can be understood without this codebase to interpret it.
"""
import json
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand
from django.core.serializers.json import DjangoJSONEncoder
from django.utils import timezone

from apps.invoices.models import InvoiceDesign

DEFAULT_BACKUP_DIR = Path(settings.BASE_DIR) / 'backups' / 'invoice_designs'


class Command(BaseCommand):
    help = 'READ-ONLY export of every InvoiceDesign row to a timestamped JSON backup file. Modifies nothing.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--output', type=str, default=None,
            help=f'Destination file path. Defaults to a timestamped file under {DEFAULT_BACKUP_DIR}/.',
        )

    def handle(self, *args, **options):
        rows = [
            {
                'id': str(design.id),
                'user_id': str(design.user_id),
                'name': design.name,
                'base_template': design.base_template,
                'source': design.source,
                'color_variant': design.color_variant,
                'design_data': design.design_data,
                'is_default': design.is_default,
                'created_at': design.created_at,
                'updated_at': design.updated_at,
            }
            for design in InvoiceDesign.objects.all().order_by('created_at')
        ]

        envelope = {
            'exported_at': timezone.now(),
            'row_count': len(rows),
            'model': 'apps.invoices.InvoiceDesign',
            'designs': rows,
        }

        if options['output']:
            output_path = Path(options['output'])
        else:
            timestamp = timezone.now().strftime('%Y%m%d_%H%M%S')
            output_path = DEFAULT_BACKUP_DIR / f'invoice_designs_backup_{timestamp}.json'

        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps(envelope, cls=DjangoJSONEncoder, indent=2))

        self.stdout.write(self.style.SUCCESS(
            f'Exported {len(rows)} InvoiceDesign record(s) to {output_path}. '
            'No database records were modified.'
        ))
