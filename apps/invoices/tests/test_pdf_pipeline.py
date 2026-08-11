# apps/invoices/tests/test_pdf_pipeline.py
"""
Step 7b — tests for the actual render pipeline (apps/invoices/
pdf_generator.py), the GET .../pdf/ endpoint, and mark-sent's one-time
render+store wiring. Uses real WeasyPrint renders throughout (unlike
Step 7a's test_pdf_templates.py, WeasyPrint is now a real project
dependency, not something to avoid in the committed suite) and PyMuPDF to
actually open the resulting PDF and inspect it — "WeasyPrint didn't log a
font warning" is not proof a font embedded; this opens the real output
and checks its font table directly.

Cloudinary itself is mocked (unittest.mock.patch on cloudinary.uploader.
upload) — this dev environment happens to have real credentials
configured, but a test suite shouldn't depend on network access to a
third-party service to pass.
"""
import base64
from decimal import Decimal
from unittest.mock import patch

import fitz  # PyMuPDF
from django.template.loader import render_to_string
from django.test import TestCase
from django.urls import reverse
from weasyprint import HTML

from apps.clients.models import Client
from apps.invoices.models import Invoice, InvoiceItem
from apps.invoices.pdf_generator import build_pdf_context, render_invoice_pdf, store_invoice_pdf

from .test_pdf_templates import make_freelancer, make_invoice_with_items, make_snapshot
from .test_views import InvoicesAPITestCase


class RenderPipelineTests(TestCase):
    """apps/invoices/pdf_generator.py's own functions, no HTTP involved."""

    def setUp(self):
        self.user = make_freelancer()

    def test_render_invoice_pdf_returns_real_pdf_bytes(self):
        invoice = make_invoice_with_items(self.user, n_items=3)
        pdf_bytes = render_invoice_pdf(invoice)
        self.assertTrue(pdf_bytes.startswith(b'%PDF'))
        doc = fitz.open(stream=pdf_bytes, filetype='pdf')
        self.assertGreaterEqual(len(doc), 1)
        doc.close()

    def test_default_template_is_professional_when_no_design_set(self):
        """Interim behavior per this step's instruction — invoice.design is null for every real invoice today (Step 8/9 not built), superseded once Step 8 wires real design selection."""
        from apps.invoices.pdf_generator import _select_template_name
        invoice = make_invoice_with_items(self.user, n_items=1)
        self.assertIsNone(invoice.design_id)
        self.assertEqual(_select_template_name(invoice), 'invoices/professional.html')

    def test_template_selection_honors_a_real_design_when_one_exists(self):
        """The other half of _select_template_name — not exercised by any real invoice yet, but the branch exists and should be checked."""
        from apps.invoices.models import InvoiceDesign
        from apps.invoices.pdf_generator import _select_template_name
        design = InvoiceDesign.objects.create(user=self.user, name='My Modern', base_template='modern')
        invoice = make_invoice_with_items(self.user, n_items=1, design=design)
        self.assertEqual(_select_template_name(invoice), 'invoices/modern.html')

    def test_qr_code_data_uri_present_and_well_formed(self):
        invoice = make_invoice_with_items(self.user, n_items=1)
        context = build_pdf_context(invoice)
        uri = context['qr_code_data_uri']
        self.assertIsNotNone(uri)
        self.assertTrue(uri.startswith('data:image/png;base64,'))
        payload = base64.b64decode(uri.split(',', 1)[1])
        self.assertTrue(payload.startswith(b'\x89PNG'))  # real PNG magic bytes, not garbage

    def test_qr_encodes_the_real_payment_page_url(self):
        """
        Confirms the QR is built from invoice.payment_page_url specifically
        (not some other URL) by intercepting what actually gets handed to
        qrcode.QRCode.add_data — decoding a real rendered QR image back to
        text would need the native zbar shared library, unavailable on
        this machine without a Homebrew install; this is a dependency-free
        way to get the same real assurance without adding one.
        """
        invoice = make_invoice_with_items(self.user, n_items=1)
        with patch('qrcode.QRCode.add_data') as mock_add_data:
            build_pdf_context(invoice)
        mock_add_data.assert_called_once_with(invoice.payment_page_url)

    def test_signature_url_included_when_set(self):
        self.user.profile.signature_url = 'https://res.cloudinary.com/demo/image/upload/sig.png'
        self.user.profile.save()
        invoice = make_invoice_with_items(self.user, n_items=1)
        context = build_pdf_context(invoice)
        self.assertEqual(context['signature_url'], 'https://res.cloudinary.com/demo/image/upload/sig.png')
        html = render_invoice_pdf(invoice)
        doc = fitz.open(stream=html, filetype='pdf')
        doc.close()  # just confirming it still renders with a signature present

    def test_signature_url_none_when_blank(self):
        self.assertEqual(self.user.profile.signature_url, '')
        invoice = make_invoice_with_items(self.user, n_items=1)
        context = build_pdf_context(invoice)
        self.assertIsNone(context['signature_url'])

    def test_fonts_actually_embedded_professional(self):
        """Not "no warning logged" — opens the real PDF and checks its font table directly."""
        invoice = make_invoice_with_items(self.user, n_items=1)
        pdf_bytes = render_invoice_pdf(invoice)
        doc = fitz.open(stream=pdf_bytes, filetype='pdf')
        font_names = {f[3] for page in doc for f in page.get_fonts()}
        doc.close()
        # Real, subsetted, embedded font names, e.g. "XHSHVD+IBM-Plex-Sans" /
        # "OCJJSI+Source-Serif-4-Semi-Bold" — the random prefix + "+" is
        # PDF's standard font-subsetting marker, itself further proof this
        # is a genuinely embedded/subsetted font, not a name collision
        # with some system-installed fallback of the same family.
        self.assertTrue(any('+IBM-Plex-Sans' in n for n in font_names), font_names)
        self.assertTrue(any('+Source-Serif-4' in n for n in font_names), font_names)

    def test_fonts_actually_embedded_modern_space_grotesk(self):
        invoice = make_invoice_with_items(self.user, n_items=1)
        html_string = render_to_string('invoices/modern.html', build_pdf_context(invoice))
        pdf_bytes = HTML(string=html_string).write_pdf()
        doc = fitz.open(stream=pdf_bytes, filetype='pdf')
        font_names = {f[3] for page in doc for f in page.get_fonts()}
        doc.close()
        self.assertTrue(any('+Space-Grotesk' in n for n in font_names), font_names)

    def test_currency_line_appears_for_usd_invoice_through_real_pipeline(self):
        """Closes the gap Step 7a found and Step 7b fixed (capture_issue_rate) — exercised end to end, not just the isolated property."""
        snapshot = make_snapshot(PKR=Decimal('0.0036'))
        client = Client.objects.create(user=self.user, name='Callahan', email='c@example.com', default_currency='PKR')
        invoice = make_invoice_with_items(self.user, n_items=1, client=client, currency='USD')
        invoice.capture_issue_rate()
        invoice.save()
        html_string = render_to_string('invoices/professional.html', build_pdf_context(invoice))
        self.assertIn('at rate', html_string)

    def test_store_invoice_pdf_uploads_to_cloudinary_and_returns_url_and_public_id(self):
        invoice = make_invoice_with_items(self.user, n_items=1)
        with patch('cloudinary.uploader.upload') as mock_upload:
            mock_upload.return_value = {
                'secure_url': 'https://res.cloudinary.com/demo/raw/upload/invoice_x.pdf',
                'public_id': 'lanceraos/invoices/invoice_x.pdf',
            }
            result = store_invoice_pdf(invoice)
        self.assertEqual(result, {
            'secure_url': 'https://res.cloudinary.com/demo/raw/upload/invoice_x.pdf',
            'public_id': 'lanceraos/invoices/invoice_x.pdf',
        })
        mock_upload.assert_called_once()
        _, kwargs = mock_upload.call_args
        self.assertEqual(kwargs['resource_type'], 'raw')
        self.assertEqual(kwargs['folder'], 'lanceraos/invoices')
        self.assertEqual(kwargs['access_mode'], 'public')


class InvoicePdfEndpointTests(InvoicesAPITestCase):
    """GET /api/invoices/<pk>/pdf/ — the spec's exact draft/created-live-render vs sent-or-beyond-stored-redirect rule."""

    def test_live_renders_for_draft(self):
        invoice = self._invoice(status='draft')
        InvoiceItem.objects.create(invoice=invoice, description='Work', quantity=Decimal('1'), unit_price=Decimal('100'))
        resp = self._get(reverse('invoices:invoice_pdf', kwargs={'pk': invoice.pk}))
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp['Content-Type'], 'application/pdf')
        self.assertTrue(resp.content.startswith(b'%PDF'))

    def test_live_renders_for_created(self):
        invoice = self._invoice(status='created')
        resp = self._get(reverse('invoices:invoice_pdf', kwargs={'pk': invoice.pk}))
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.content.startswith(b'%PDF'))

    def test_redirects_to_stored_url_when_sent_with_pdf_url(self):
        invoice = self._invoice(status='sent', sent_at='2026-08-01T00:00:00Z')
        invoice.pdf_url = 'https://res.cloudinary.com/demo/raw/upload/invoice_stored.pdf'
        invoice.save(update_fields=['pdf_url'])
        resp = self._get(reverse('invoices:invoice_pdf', kwargs={'pk': invoice.pk}))
        self.assertEqual(resp.status_code, 302)
        self.assertEqual(resp['Location'], 'https://res.cloudinary.com/demo/raw/upload/invoice_stored.pdf')

    def test_falls_back_to_live_render_when_sent_but_pdf_url_blank(self):
        """A genuine anomaly (mark-sent's render+store failed) — must not 404, falls back to a live render."""
        invoice = self._invoice(status='sent', sent_at='2026-08-01T00:00:00Z')
        self.assertEqual(invoice.pdf_url, '')
        resp = self._get(reverse('invoices:invoice_pdf', kwargs={'pk': invoice.pk}))
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.content.startswith(b'%PDF'))

    def test_never_reached_for_another_users_invoice(self):
        from apps.users.models import User
        other = User.objects.create_user(email='other-pdf@example.com', password='Sup3r$ecret1')
        their_invoice = self._invoice()
        their_invoice.user = other
        their_invoice.save(update_fields=['user'])
        resp = self._get(reverse('invoices:invoice_pdf', kwargs={'pk': their_invoice.pk}))
        self.assertEqual(resp.status_code, 404)


class FinalisePdfStoreTests(InvoicesAPITestCase):
    """
    The freeze point moved to invoice_finalise this pass (see DECISIONS.md):
    is_editable already only permits edits at status='draft', so a
    'created' invoice was already fully immutable — freezing at
    mark-sent/send pointlessly live-rendered it on every GET in between.
    """

    def test_finalise_populates_pdf_url_exactly_once(self):
        invoice = self._invoice(status='draft')
        InvoiceItem.objects.create(invoice=invoice, description='Work', quantity=Decimal('1'), unit_price=Decimal('100'))
        with patch('apps.invoices.views.store_invoice_pdf') as mock_store:
            mock_store.return_value = {
                'secure_url': 'https://res.cloudinary.com/demo/raw/upload/invoice_once.pdf',
                'public_id': 'lanceraos/invoices/invoice_once.pdf',
            }
            resp = self._post(reverse('invoices:invoice_finalise', kwargs={'pk': invoice.pk}), {})
        self.assertEqual(resp.status_code, 200)
        mock_store.assert_called_once()
        invoice.refresh_from_db()
        self.assertEqual(invoice.pdf_url, 'https://res.cloudinary.com/demo/raw/upload/invoice_once.pdf')
        self.assertEqual(invoice.pdf_public_id, 'lanceraos/invoices/invoice_once.pdf')
        self.assertIsNotNone(invoice.pdf_generated_at)
        self.assertIsNotNone(invoice.finalised_at)

    def test_pdf_never_rerendered_on_subsequent_gets(self):
        """Once stored, GET .../pdf/ must redirect to the SAME url forever — never re-render, per the frozen-artifact guarantee."""
        invoice = self._invoice(status='draft')
        InvoiceItem.objects.create(invoice=invoice, description='Work', quantity=Decimal('1'), unit_price=Decimal('100'))
        with patch('apps.invoices.views.store_invoice_pdf') as mock_store:
            mock_store.return_value = {
                'secure_url': 'https://res.cloudinary.com/demo/raw/upload/invoice_frozen.pdf',
                'public_id': 'lanceraos/invoices/invoice_frozen.pdf',
            }
            self._post(reverse('invoices:invoice_finalise', kwargs={'pk': invoice.pk}), {})

            for _ in range(3):
                resp = self._get(reverse('invoices:invoice_pdf', kwargs={'pk': invoice.pk}))
                self.assertEqual(resp.status_code, 302)
                self.assertEqual(resp['Location'], 'https://res.cloudinary.com/demo/raw/upload/invoice_frozen.pdf')
            mock_store.assert_called_once()  # still exactly once, across every subsequent GET

    def test_finalise_pdf_failure_does_not_block_status_transition(self):
        invoice = self._invoice(status='draft')
        InvoiceItem.objects.create(invoice=invoice, description='Work', quantity=Decimal('1'), unit_price=Decimal('100'))
        with patch('apps.invoices.views.store_invoice_pdf') as mock_store:
            mock_store.side_effect = RuntimeError('WeasyPrint blew up')
            resp = self._post(reverse('invoices:invoice_finalise', kwargs={'pk': invoice.pk}), {})
        self.assertEqual(resp.status_code, 200)
        invoice.refresh_from_db()
        self.assertEqual(invoice.status, 'created')
        self.assertEqual(invoice.pdf_url, '')

    def test_mark_sent_from_draft_finalises_and_stores_exactly_once(self):
        """
        Mark as Sent is reachable directly from 'draft' (a parallel choice
        to Finalise, not a strict sequence) — when that happens, it must
        finalise (and therefore freeze the PDF) on the way to 'sent',
        exactly once, the same as an explicit Finalise click would.
        """
        invoice = self._invoice(status='draft')
        InvoiceItem.objects.create(invoice=invoice, description='Work', quantity=Decimal('1'), unit_price=Decimal('100'))
        with patch('apps.invoices.views.store_invoice_pdf') as mock_store:
            mock_store.return_value = {
                'secure_url': 'https://res.cloudinary.com/demo/raw/upload/invoice_direct_sent.pdf',
                'public_id': 'lanceraos/invoices/invoice_direct_sent.pdf',
            }
            resp = self._post(reverse('invoices:invoice_mark_sent', kwargs={'pk': invoice.pk}), {'confirm': True})
        self.assertEqual(resp.status_code, 200)
        mock_store.assert_called_once()
        invoice.refresh_from_db()
        self.assertEqual(invoice.status, 'sent')
        self.assertIsNotNone(invoice.invoice_number)
        self.assertIsNotNone(invoice.finalised_at)
        self.assertEqual(invoice.pdf_url, 'https://res.cloudinary.com/demo/raw/upload/invoice_direct_sent.pdf')
        self.assertEqual(invoice.pdf_public_id, 'lanceraos/invoices/invoice_direct_sent.pdf')

    def test_mark_sent_on_already_finalised_invoice_does_not_rerender(self):
        """The PDF is already frozen by the time a real finalise happened separately — mark-sent must not render again."""
        invoice = self._invoice(status='draft')
        InvoiceItem.objects.create(invoice=invoice, description='Work', quantity=Decimal('1'), unit_price=Decimal('100'))
        with patch('apps.invoices.views.store_invoice_pdf') as mock_store:
            mock_store.return_value = {
                'secure_url': 'https://res.cloudinary.com/demo/raw/upload/invoice_finalised.pdf',
                'public_id': 'lanceraos/invoices/invoice_finalised.pdf',
            }
            self._post(reverse('invoices:invoice_finalise', kwargs={'pk': invoice.pk}), {})
            mock_store.assert_called_once()

            resp = self._post(reverse('invoices:invoice_mark_sent', kwargs={'pk': invoice.pk}), {'confirm': True})
            self.assertEqual(resp.status_code, 200)
            mock_store.assert_called_once()  # still exactly once — mark-sent did not re-render

        invoice.refresh_from_db()
        self.assertEqual(invoice.status, 'sent')
        self.assertEqual(invoice.pdf_url, 'https://res.cloudinary.com/demo/raw/upload/invoice_finalised.pdf')

    def test_mark_sent_from_draft_requires_a_line_item(self):
        """The same defensive check invoice_finalise already had, now mirrored here since mark-sent can finalise implicitly."""
        invoice = self._invoice(status='draft')
        resp = self._post(reverse('invoices:invoice_mark_sent', kwargs={'pk': invoice.pk}), {'confirm': True})
        self.assertEqual(resp.status_code, 400)
        invoice.refresh_from_db()
        self.assertEqual(invoice.status, 'draft')


class DuplicateResetsPdfFieldsTests(InvoicesAPITestCase):
    def test_duplicate_resets_pdf_url_and_generated_at(self):
        """Step 7a's comment claimed this already worked by omission — actually checked here, not just assumed to still hold."""
        from django.utils import timezone
        original = self._invoice(status='sent', sent_at=timezone.now())
        original.pdf_url = 'https://res.cloudinary.com/demo/raw/upload/original.pdf'
        original.pdf_generated_at = timezone.now()
        original.save(update_fields=['pdf_url', 'pdf_generated_at'])

        resp = self._post(reverse('invoices:invoice_duplicate', kwargs={'pk': original.pk}))
        self.assertEqual(resp.status_code, 201)
        new_invoice = Invoice.objects.get(pk=resp.json()['id'])
        self.assertEqual(new_invoice.pdf_url, '')
        self.assertIsNone(new_invoice.pdf_generated_at)
        # and the original is untouched
        original.refresh_from_db()
        self.assertEqual(original.pdf_url, 'https://res.cloudinary.com/demo/raw/upload/original.pdf')

    def test_duplicate_resets_finalised_at(self):
        """finalised_at is new this pass — confirmed with a real test that invoice_duplicate resets it too, not just assumed by omission from the explicit create() kwargs."""
        from django.utils import timezone
        original = self._invoice(status='created')
        original.finalised_at = timezone.now()
        original.save(update_fields=['finalised_at'])

        resp = self._post(reverse('invoices:invoice_duplicate', kwargs={'pk': original.pk}))
        new_invoice = Invoice.objects.get(pk=resp.json()['id'])
        self.assertIsNone(new_invoice.finalised_at)
        original.refresh_from_db()
        self.assertIsNotNone(original.finalised_at)
