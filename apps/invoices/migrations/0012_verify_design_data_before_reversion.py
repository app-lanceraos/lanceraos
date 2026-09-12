# apps/invoices/migrations/0012_verify_design_data_before_reversion.py
# Full Reversion Plan (back to 3 static templates only), Part 1, step 1 of
# 2. A real safety GATE, not a transform: every InvoiceDesign row is
# already stored with a real, separately-tracked `base_template` column
# (never derived from `design_data` at read time) — the free-canvas
# system this reversion removes was layered on top of that column, never
# a replacement for it. So there is no actual data to migrate INTO
# base_template; this migration's only job is to prove that claim against
# the real, current database before the next migration (0013) drops
# design_data/source/color_variant and the InvoiceDesignVersion table out
# from under it. If any row were found with a blank/invalid
# base_template, this raises loudly here — before the columns that could
# have told us how to fix it are gone — rather than silently letting 0013
# proceed and leaving a design_id-referencing invoice pointed at an
# under-specified row.
#
# Also verifies the other real risk named in this plan: that no
# Invoice.rendered_design_snapshot depends on live design_data. As of
# this writing every row in the dev database has this field null (never
# populated by any code path — see models.py's own docstring), but this
# runs the real check rather than trusting that observation.
#
# Pure verification — no field is written, so the reverse is a genuine
# no-op, not a stub.

from django.db import migrations

VALID_BASE_TEMPLATES = {'professional', 'minimal', 'modern'}


def verify_before_reversion(apps, schema_editor):
    InvoiceDesign = apps.get_model('invoices', 'InvoiceDesign')
    Invoice = apps.get_model('invoices', 'Invoice')

    bad_designs = [
        (d.pk, d.base_template)
        for d in InvoiceDesign.objects.all()
        if not d.base_template or d.base_template not in VALID_BASE_TEMPLATES
    ]
    if bad_designs:
        raise RuntimeError(
            'Full Reversion Plan Part 1 aborted: found InvoiceDesign row(s) with a blank or '
            'unrecognized base_template, which the next migration (0013) cannot safely normalize '
            'from: %r. Fix these rows (or decide what they should become) before proceeding.'
            % bad_designs
        )

    orphaned_design_fks = Invoice.objects.exclude(design__isnull=True).exclude(
        design_id__in=InvoiceDesign.objects.values_list('pk', flat=True)
    ).count()
    if orphaned_design_fks:
        raise RuntimeError(
            'Full Reversion Plan Part 1 aborted: found %d Invoice row(s) whose design_id does not '
            'resolve to any real InvoiceDesign row.' % orphaned_design_fks
        )

    designs_with_snapshot_dependent_invoices = Invoice.objects.exclude(
        rendered_design_snapshot__isnull=True
    ).count()
    if designs_with_snapshot_dependent_invoices:
        # Not fatal — rendered_design_snapshot is a COPY that lives on the
        # Invoice itself and is untouched by anything this plan does to
        # InvoiceDesign. Recorded here only so a real occurrence is
        # visible in migration output rather than silently assumed away.
        print(
            '\nFull Reversion Plan Part 1 note: %d Invoice row(s) have a real '
            'rendered_design_snapshot. This field is not touched by this migration or the next '
            'one — confirming its presence here for the record, not blocking on it.'
            % designs_with_snapshot_dependent_invoices
        )


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('invoices', '0011_phase0_design_versioning_and_snapshot_foundation'),
    ]

    operations = [
        migrations.RunPython(verify_before_reversion, noop_reverse),
    ]
