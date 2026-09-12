# apps/invoices/migrations/0014_invoice_base_template.py
# Post-Reversion Polish (12 September 2026), Part 2 — schema-only step 1
# of 3. Adds the new plain field alongside the still-live `design` FK so
# the next migration (0015) can copy real data across before anything is
# removed.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('invoices', '0013_reversion_drop_design_editor_schema'),
    ]

    operations = [
        migrations.AddField(
            model_name='invoice',
            name='base_template',
            field=models.CharField(
                blank=True, null=True, max_length=20,
                choices=[('professional', 'Professional'), ('minimal', 'Minimal'), ('modern', 'Modern')],
                help_text="Which of the 3 static templates renders this invoice's PDF.",
            ),
        ),
    ]
