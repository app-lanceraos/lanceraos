# apps/invoices/migrations/0016_remove_invoice_design_model.py
# Post-Reversion Polish (12 September 2026), Part 2 — step 3 of 3, the
# actual removal. Depends explicitly on apps.users' 0011 (which reads
# every user's current default InvoiceDesign to seed
# FreelancerProfile.invoice_template) and this app's own 0015 (which
# copies each Invoice's real base_template across) — both must have
# already run before InvoiceDesign disappears out from under them.
#
# `Invoice.rendered_design_snapshot` is also removed here — its entire
# purpose (protecting a finalized invoice's render from a LATER edit to
# its design's free-canvas content) no longer applies to anything: there
# is no free-canvas content left, anywhere, for a design to be edited
# INTO. Confirmed unused by any code path before removal (see
# DECISIONS.md's 12 September 2026 "Post-Reversion Polish" entry).
#
# Reversible via `migrate invoices 0015` for the schema (Django replays
# the removed fields/model back in from migration state) — but, as with
# the original reversion's own 0013, this is a SCHEMA-only reversal: the
# real per-user default/per-invoice InvoiceDesign content itself is gone
# for good the moment this runs.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('invoices', '0015_copy_design_base_template_to_invoice'),
        ('users', '0011_add_invoice_template_preference'),
    ]

    operations = [
        migrations.RemoveField(
            model_name='invoice',
            name='design',
        ),
        migrations.RemoveField(
            model_name='invoice',
            name='rendered_design_snapshot',
        ),
        migrations.DeleteModel(
            name='InvoiceDesign',
        ),
    ]
