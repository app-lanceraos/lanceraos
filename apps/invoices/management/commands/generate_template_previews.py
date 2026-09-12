# apps/invoices/management/commands/generate_template_previews.py
"""
Post-Reversion Polish (12 September 2026) — regenerates the 3 static
gallery preview images (frontend/public/design-previews/{template}.png)
DesignGallery.jsx shows for "Professional"/"Minimal"/"Modern". These are
one-time, pre-generated assets — nothing renders them live on a gallery
page load, since there's no per-user variation left to justify that
(every invoice on a given template looks identical now that per-design
customization is gone). Re-run this only if the templates themselves are
ever edited.

Renders each template through the real production path (render_invoice_pdf,
apps/invoices/pdf_generator.py — real WeasyPrint, the exact same pipeline a
client's actual invoice goes through, not an approximation), with
realistic, fully-populated sample data (reusing the same "everything is
filled in" convention the old design_preview.py's SAMPLE_ITEMS/
_build_sample_invoice established, back when it existed — see DECISIONS.md's
12 September 2026 entry for why porting that shape forward here, rather
than reinventing sample content, was the right call). Converts the
resulting PDF's first page to a PNG via PyMuPDF (already a real project
dependency, used throughout the test suite to inspect real rendered
output) — chosen over a browser-based HTML-to-image capture because it's
one fewer moving part (no headless-browser dependency this backend
doesn't otherwise need) and guarantees pixel-for-pixel fidelity with the
actual PDF a client receives, not a second, separately-rendered
approximation of it.

A real, throwaway user/invoice is created for each template, rendered,
then deleted — this command leaves no residue in the database on a
normal run.
"""
import logging
from datetime import date
from decimal import Decimal
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils.crypto import get_random_string

logger = logging.getLogger(__name__)

SAMPLE_ITEMS = [
    {'description': 'Homepage redesign', 'quantity': Decimal('1'), 'unit_price': Decimal('1200.00')},
    {'description': 'Design system components', 'quantity': Decimal('1'), 'unit_price': Decimal('860.00')},
    {'description': 'Revisions round 1', 'quantity': Decimal('1'), 'unit_price': Decimal('240.00')},
]

OUTPUT_DIR = Path(settings.BASE_DIR) / 'frontend' / 'public' / 'design-previews'

# 2x zoom for a crisp preview at real display sizes (gallery cards render
# these at a few hundred px wide, well under this render's own real
# pixel dimensions) — matches this project's own PyMuPDF-for-inspection
# convention (apps/invoices/tests/test_pdf_pipeline.py and others), just
# used to produce a real asset instead of a test assertion this time.
ZOOM = 2.0


class Command(BaseCommand):
    help = "Regenerates the 3 static-template gallery preview PNGs from real sample data through the real PDF pipeline."

    def handle(self, *args, **options):
        import fitz
        from apps.invoices.models import Invoice, InvoiceItem
        from apps.invoices.pdf_generator import render_invoice_pdf
        from apps.users.models import User

        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

        for base_template in ('professional', 'minimal', 'modern'):
            with transaction.atomic():
                # The same email/username every iteration, on purpose — a
                # clean, presentable sample identity (never a technical
                # placeholder that would leak into the "FROM" block a
                # real preview shows) reused across templates, safe since
                # each iteration deletes its own row before the next one
                # creates it fresh.
                user = User.objects.create_user(
                    email='hello@horizonstudio.example',
                    username='previewgenerator',
                    password=get_random_string(32),
                )
                profile = user.profile
                profile.business_name = 'Horizon Studio'
                profile.display_name = 'Horizon Studio'
                profile.address_line1 = '88 Distillery Lane'
                profile.city = 'Austin'
                profile.country = 'United States'
                profile.save()

                invoice = Invoice.objects.create(
                    user=user, base_template=base_template, status='created',
                    invoice_number='INV-2026-0042',
                    client_name='Callahan & Reyes LLP', client_company='Callahan & Reyes LLP',
                    client_email='accounts@callahanreyes.com', client_phone='+1 512 555 0148',
                    client_address='412 Marlowe Ave, Austin, TX, United States',
                    currency='USD', issue_date=date(2026, 8, 9), due_date=date(2026, 8, 23),
                    notes='Thanks for the business.', terms='Due within 14 days.',
                )
                for item in SAMPLE_ITEMS:
                    InvoiceItem.objects.create(invoice=invoice, **item)
                invoice.recalculate_totals()
                invoice.save()

                pdf_bytes = render_invoice_pdf(invoice)

                invoice.delete()
                user.delete()

            doc = fitz.open(stream=pdf_bytes, filetype='pdf')
            pixmap = doc[0].get_pixmap(matrix=fitz.Matrix(ZOOM, ZOOM))
            out_path = OUTPUT_DIR / f'{base_template}.png'
            pixmap.save(str(out_path))
            doc.close()

            self.stdout.write(self.style.SUCCESS(f'Generated {out_path} ({out_path.stat().st_size} bytes)'))
