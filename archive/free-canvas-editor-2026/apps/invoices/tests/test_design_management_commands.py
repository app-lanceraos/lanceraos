# apps/invoices/tests/test_design_management_commands.py
"""
Template Builder — tests for the read-only design-audit management
commands. The single most important property both share:
running them must never modify any InvoiceDesign row.
"""
import copy
import json
import tempfile
from io import StringIO
from pathlib import Path

from django.core.management import call_command
from django.test import TestCase

from apps.invoices.design_seeds import PROFESSIONAL_DESIGN_DATA
from apps.invoices.models import InvoiceDesign


def _clean_professional_design_data():
    """
    Phase 5.1: real, unmodified PROFESSIONAL_DESIGN_DATA no longer
    migrates cleanly — the new v2 page-boundary validation surfaced a
    real, pre-existing bug in design_migration.py's paired-element width
    math (see test_design_migration.py's own MigrateV1ToV2RealSeedTests
    for the full explanation; not fixed here, out of scope). This is the
    same minimal, 2-field correction that file's own
    `_professional_with_valid_widths()` applies, duplicated here rather
    than imported across test modules for a one-fixture need.
    """
    d = copy.deepcopy(PROFESSIONAL_DESIGN_DATA)
    for el in d['zone_1']['elements']:
        if el['type'] == 'dates':
            el['width'] = 41
        elif el['type'] == 'business_info' and el['x'] == 115:
            el['width'] = 59
    for el in d['zone_2']['elements']:
        if el.get('paired_side_by_side'):
            el['style']['width'] = 85
    return d


class AuditTemplateDesignMigrationCommandTests(TestCase):
    def setUp(self):
        from apps.users.models import User
        self.user = User.objects.create_user(email='audit-cmd@example.com', password='Sup3r$ecret1')

    def test_reports_a_clean_legacy_design_as_migratable(self):
        InvoiceDesign.objects.create(
            user=self.user, name='Clean Legacy', base_template='professional', source='custom',
            design_data=_clean_professional_design_data(),
        )
        out = StringIO()
        call_command('audit_template_design_migration', stdout=out)
        output = out.getvalue()
        self.assertIn('Migratable (legacy, clean):        1', output)

    def test_reports_a_malformed_design_as_needing_manual_intervention(self):
        InvoiceDesign.objects.create(
            user=self.user, name='Broken', base_template='professional', source='custom',
            design_data={'zone_1': {'elements': []}},  # missing zone_2 entirely
        )
        out = StringIO()
        call_command('audit_template_design_migration', stdout=out)
        output = out.getvalue()
        self.assertIn('Needs manual intervention:         1', output)

    def test_verbose_flag_lists_each_design_individually(self):
        design = InvoiceDesign.objects.create(
            user=self.user, name='Verbose Target', base_template='professional', source='custom',
            design_data=PROFESSIONAL_DESIGN_DATA,
        )
        out = StringIO()
        call_command('audit_template_design_migration', '--verbose', stdout=out)
        self.assertIn(str(design.id), out.getvalue())
        self.assertIn('Verbose Target', out.getvalue())

    def test_running_the_command_does_not_modify_any_design_row(self):
        design = InvoiceDesign.objects.create(
            user=self.user, name='Must Stay Untouched', base_template='professional', source='custom',
            design_data=PROFESSIONAL_DESIGN_DATA,
        )
        design_data_before = dict(design.design_data)
        updated_at_before = design.updated_at

        call_command('audit_template_design_migration', '--verbose', stdout=StringIO())

        design.refresh_from_db()
        self.assertEqual(design.design_data, design_data_before)
        self.assertEqual(design.updated_at, updated_at_before)

    def test_running_the_command_creates_no_new_rows_of_any_kind(self):
        InvoiceDesign.objects.create(
            user=self.user, name='Count Check', base_template='professional', source='custom',
            design_data=PROFESSIONAL_DESIGN_DATA,
        )
        count_before = InvoiceDesign.objects.count()
        call_command('audit_template_design_migration', stdout=StringIO())
        self.assertEqual(InvoiceDesign.objects.count(), count_before)


class ExportInvoiceDesignsBackupCommandTests(TestCase):
    def setUp(self):
        from apps.users.models import User
        self.user = User.objects.create_user(email='backup-cmd@example.com', password='Sup3r$ecret1')

    def test_exports_every_design_to_the_given_output_path(self):
        InvoiceDesign.objects.create(
            user=self.user, name='Backup Me', base_template='professional', source='custom',
            design_data=PROFESSIONAL_DESIGN_DATA,
        )
        with tempfile.TemporaryDirectory() as tmp_dir:
            output_path = Path(tmp_dir) / 'backup.json'
            call_command('export_invoice_designs_backup', f'--output={output_path}', stdout=StringIO())

            self.assertTrue(output_path.exists())
            envelope = json.loads(output_path.read_text())
            self.assertEqual(envelope['row_count'], 1)
            self.assertEqual(envelope['designs'][0]['name'], 'Backup Me')
            self.assertEqual(envelope['designs'][0]['design_data'], PROFESSIONAL_DESIGN_DATA)

    def test_running_the_command_does_not_modify_any_design_row(self):
        design = InvoiceDesign.objects.create(
            user=self.user, name='Must Stay Untouched', base_template='professional', source='custom',
            design_data=PROFESSIONAL_DESIGN_DATA,
        )
        updated_at_before = design.updated_at

        with tempfile.TemporaryDirectory() as tmp_dir:
            output_path = Path(tmp_dir) / 'backup.json'
            call_command('export_invoice_designs_backup', f'--output={output_path}', stdout=StringIO())

        design.refresh_from_db()
        self.assertEqual(design.updated_at, updated_at_before)

    def test_output_is_valid_json_even_with_zero_designs(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            output_path = Path(tmp_dir) / 'backup.json'
            call_command('export_invoice_designs_backup', f'--output={output_path}', stdout=StringIO())
            envelope = json.loads(output_path.read_text())
            self.assertEqual(envelope['row_count'], 0)
            self.assertEqual(envelope['designs'], [])
