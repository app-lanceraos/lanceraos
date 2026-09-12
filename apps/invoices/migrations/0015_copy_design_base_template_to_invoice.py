# apps/invoices/migrations/0015_copy_design_base_template_to_invoice.py
# Post-Reversion Polish (12 September 2026), Part 2 — step 2 of 3. Copies
# each Invoice's real base_template across from its (still-live at this
# point) InvoiceDesign FK, before 0016 removes both. An invoice with no
# design_id at all is left with base_template=None here — the real
# behavior for that case is unchanged either way: _effective_base_template
# already falls back to the user's current preference for a still-draft
# invoice, or DEFAULT_TEMPLATE otherwise, exactly as the old FK-based
# _effective_design did for a design_id=None invoice.

from django.db import migrations


def copy_design_base_template_onto_invoice(apps, schema_editor):
    Invoice = apps.get_model('invoices', 'Invoice')
    InvoiceDesign = apps.get_model('invoices', 'InvoiceDesign')

    designs_by_id = dict(InvoiceDesign.objects.values_list('id', 'base_template'))
    invoices_with_design = Invoice.objects.exclude(design_id__isnull=True)
    updated = 0
    for invoice in invoices_with_design.only('id', 'design_id'):
        base_template = designs_by_id.get(invoice.design_id)
        if base_template:
            Invoice.objects.filter(pk=invoice.pk).update(base_template=base_template)
            updated += 1
    print(f'\n[invoices migration 0015] Copied base_template onto {updated} real invoice(s) from their InvoiceDesign.')


def noop_reverse(apps, schema_editor):
    # The paired forward step is read-only against InvoiceDesign and
    # additive on Invoice.base_template — reversing it would mean
    # blanking base_template back to null, which the schema-level
    # reversal of 0014 already does for us implicitly once base_template
    # itself is removed. Nothing further to do here.
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('invoices', '0014_invoice_base_template'),
    ]

    operations = [
        migrations.RunPython(copy_design_base_template_onto_invoice, noop_reverse),
    ]
