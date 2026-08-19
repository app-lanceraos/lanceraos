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
from datetime import date
from decimal import Decimal
from unittest.mock import MagicMock, patch

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

    def test_pkr_invoice_to_usd_client_shows_a_real_nonzero_converted_total_in_the_rendered_pdf(self):
        """
        Real, found, client-facing bug (see DECISIONS.md) —
        Invoice.client_currency_conversion used to quantize the
        conversion RATE to 2 decimal places BEFORE multiplying it
        against `total`. PKR-to-USD is ≈0.0036, which rounds to 0.00 at
        2dp, silently zeroing the entire displayed converted total on a
        real invoice PDF for exactly this project's own target
        currency pair (a Pakistani freelancer's PKR invoice, a
        USD/EUR/GBP client). Verified here against the REAL rendered PDF
        via PyMuPDF text extraction — not just the isolated property in
        Python, and not just "no exception raised."
        """
        snapshot = make_snapshot(PKR=Decimal('0.0036'))
        client = Client.objects.create(user=self.user, name='Zainab Traders', email='z@example.com', default_currency='USD')
        invoice = Invoice.objects.create(
            user=self.user, invoice_number=None, status='created', client=client,
            client_name=client.name, client_email=client.email,
            currency='PKR', due_date=date(2026, 8, 19), tax_rate=Decimal('0'),
            rate_to_usd_at_issue=Decimal('0.0036'), exchange_rate_snapshot=snapshot,
        )
        InvoiceItem.objects.create(invoice=invoice, description='Design work', quantity=Decimal('1'), unit_price=Decimal('28000.00'), sort_order=1)
        invoice.recalculate_totals()
        invoice.save()

        conversion = invoice.client_currency_conversion
        self.assertIsNotNone(conversion)
        self.assertEqual(conversion['converted_total'], Decimal('100.80'))  # 28000 * 0.0036 — real bug used to make this 0.00
        self.assertNotEqual(conversion['rate'], Decimal('0.00'))
        self.assertEqual(conversion['rate'], Decimal('0.003600'))

        pdf_bytes = render_invoice_pdf(invoice)
        doc = fitz.open(stream=pdf_bytes, filetype='pdf')
        page_text = ''.join(page.get_text() for page in doc)
        doc.close()

        self.assertIn('100.80', page_text)  # the real, non-zero converted total
        self.assertIn('0.003600', page_text)  # the real-precision rate, not the old "0.00"
        self.assertNotIn('$0.00 at rate', page_text)  # the old bug's exact symptom

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
    """
    GET /api/invoices/<pk>/pdf/ — draft still live-renders inline
    (nothing frozen yet). REWORKED (Cloudinary-ACL-401 follow-up — see
    DECISIONS.md): created-or-beyond used to 302-redirect straight to the
    stored Cloudinary secure_url, surfacing that account's real ACL 401
    directly to the browser; it now proxies the actual bytes through this
    endpoint via fetch_invoice_pdf_bytes (mocked here at the same
    apps.invoices.views.fetch_invoice_pdf_bytes patch point
    ResendInvoiceTests already established — the real self-heal chain
    itself, including its Cloudinary-401 resilience, is covered directly
    by email_service's own tests, not re-tested here), with a real
    Content-Disposition: attachment (the "Download Invoice" button's own
    name, and the only real consumer of this branch — "View Invoice"
    never touches this endpoint at all, it's the separate HTML
    portal_invoice_view_html route).
    """

    def test_live_renders_for_draft(self):
        invoice = self._invoice(status='draft')
        InvoiceItem.objects.create(invoice=invoice, description='Work', quantity=Decimal('1'), unit_price=Decimal('100'))
        resp = self._get(reverse('invoices:invoice_pdf', kwargs={'pk': invoice.pk}))
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp['Content-Type'], 'application/pdf')
        self.assertTrue(resp.content.startswith(b'%PDF'))
        self.assertNotIn('Content-Disposition', resp)  # inline preview, not a forced download

    @patch('apps.invoices.views.fetch_invoice_pdf_bytes')
    def test_proxies_real_bytes_for_created(self, mock_fetch):
        mock_fetch.return_value = b'%PDF-fake-bytes'
        invoice = self._invoice(status='created')
        resp = self._get(reverse('invoices:invoice_pdf', kwargs={'pk': invoice.pk}))
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.content, b'%PDF-fake-bytes')
        mock_fetch.assert_called_once_with(invoice)

    @patch('apps.invoices.views.fetch_invoice_pdf_bytes')
    def test_proxies_stored_pdf_bytes_when_sent(self, mock_fetch):
        mock_fetch.return_value = b'%PDF-real-invoice-bytes'
        invoice = self._invoice(status='sent', sent_at='2026-08-01T00:00:00Z')
        invoice.pdf_url = 'https://res.cloudinary.com/demo/raw/upload/invoice_stored.pdf'
        invoice.save(update_fields=['pdf_url'])
        resp = self._get(reverse('invoices:invoice_pdf', kwargs={'pk': invoice.pk}))
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp['Content-Type'], 'application/pdf')
        self.assertEqual(resp.content, b'%PDF-real-invoice-bytes')
        self.assertIn('attachment', resp['Content-Disposition'])
        self.assertIn(invoice.invoice_number, resp['Content-Disposition'])
        # Never a redirect — this is the whole point of the fix: even if
        # Cloudinary's stored URL itself is unreachable from a raw
        # unauthenticated browser GET, this endpoint's own backend
        # credentials (inside fetch_invoice_pdf_bytes) can still reach it,
        # so the browser is never handed a broken redirect to follow.
        self.assertNotEqual(resp.status_code, 302)

    @patch('apps.invoices.views.fetch_invoice_pdf_bytes')
    def test_falls_back_to_live_render_when_sent_but_pdf_url_blank(self, mock_fetch):
        """
        A genuine anomaly (mark-sent's render+store failed) — must not
        404. fetch_invoice_pdf_bytes' own self-heal chain (a blank
        pdf_url is treated like a failed fetch) is what actually produces
        a real fallback render in production; here it's mocked at the
        view's own patch point like every other case in this class, since
        that chain's real behavior is this function's own responsibility
        to test, not invoice_pdf's.
        """
        mock_fetch.return_value = b'%PDF-live-fallback'
        invoice = self._invoice(status='sent', sent_at='2026-08-01T00:00:00Z')
        self.assertEqual(invoice.pdf_url, '')
        resp = self._get(reverse('invoices:invoice_pdf', kwargs={'pk': invoice.pk}))
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.content, b'%PDF-live-fallback')

    @patch('apps.invoices.views.fetch_invoice_pdf_bytes', return_value=None)
    def test_returns_502_when_every_fetch_render_path_fails(self, mock_fetch):
        invoice = self._invoice(status='sent', sent_at='2026-08-01T00:00:00Z')
        resp = self._get(reverse('invoices:invoice_pdf', kwargs={'pk': invoice.pk}))
        self.assertEqual(resp.status_code, 502)

    def test_never_reached_for_another_users_invoice(self):
        from apps.users.models import User
        other = User.objects.create_user(email='other-pdf@example.com', password='Sup3r$ecret1')
        their_invoice = self._invoice()
        their_invoice.user = other
        their_invoice.save(update_fields=['user'])
        resp = self._get(reverse('invoices:invoice_pdf', kwargs={'pk': their_invoice.pk}))
        self.assertEqual(resp.status_code, 404)

    @patch('apps.invoices.email_service._pdf_fetch_session.get')
    def test_download_still_works_end_to_end_under_the_real_cloudinary_401_condition(self, mock_get):
        """
        The actual point of this whole rework: this account's stored raw/
        PDF assets genuinely 401 on a direct unauthenticated GET (see
        upload_pdf_bytes's own docstring — a real, confirmed Cloudinary
        Console ACL restriction, not hypothetical). This proves the
        fix holds under THAT real condition specifically, exercising the
        real fetch_invoice_pdf_bytes self-heal chain end to end through
        this actual view (nothing mocked at the view's own level, unlike
        this class's other tests above) — not just that the view
        correctly delegates to an already-mocked function. Mirrors
        test_send.py's own test_pdf_fetch_failure_self_heals_via_reupload_
        and_still_sends, which proves the identical thing for /send/ — the
        exact same underlying chain now backs both consumers.
        """
        import requests
        mock_get.side_effect = requests.RequestException('401 unauthorized — deny or ACL failure')
        invoice = self._invoice(status='sent', sent_at='2026-08-01T00:00:00Z')
        invoice.pdf_url = 'https://res.cloudinary.com/demo/raw/upload/invoice_401.pdf'
        invoice.save(update_fields=['pdf_url'])

        with patch('apps.invoices.email_service.upload_pdf_bytes') as mock_upload:
            mock_upload.return_value = {
                'secure_url': 'https://res.cloudinary.com/demo/raw/upload/invoice_healed.pdf',
                'public_id': 'lanceraos/invoices/invoice_healed.pdf',
            }
            resp = self._get(reverse('invoices:invoice_pdf', kwargs={'pk': invoice.pk}))

        # A real, valid PDF — never a 302 to the still-401 URL, never a
        # Cloudinary error page reaching the browser.
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp['Content-Type'], 'application/pdf')
        self.assertTrue(resp.content.startswith(b'%PDF'))
        self.assertIn('attachment', resp['Content-Disposition'])
        mock_upload.assert_called_once()  # the self-heal re-upload attempt actually ran


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
        with patch('apps.invoices.pdf_generator.store_invoice_pdf') as mock_store:
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
        """
        Once stored, GET .../pdf/ must fetch the SAME frozen pdf_url
        forever (never re-render/re-store it) — per the frozen-artifact
        guarantee. store_invoice_pdf (finalise's own one-time render+
        upload) stays mocked as before; fetch_invoice_pdf_bytes (this
        endpoint's own fetch, proxying real bytes rather than redirecting
        since the Cloudinary-ACL-401 follow-up) is mocked separately so
        this test proves the real, distinct thing each call is
        responsible for: finalise stores once, GET fetches (not
        re-renders) every time after.
        """
        invoice = self._invoice(status='draft')
        InvoiceItem.objects.create(invoice=invoice, description='Work', quantity=Decimal('1'), unit_price=Decimal('100'))
        with patch('apps.invoices.pdf_generator.store_invoice_pdf') as mock_store:
            mock_store.return_value = {
                'secure_url': 'https://res.cloudinary.com/demo/raw/upload/invoice_frozen.pdf',
                'public_id': 'lanceraos/invoices/invoice_frozen.pdf',
            }
            self._post(reverse('invoices:invoice_finalise', kwargs={'pk': invoice.pk}), {})
        mock_store.assert_called_once()  # finalise's own one-time render+store

        with patch('apps.invoices.views.fetch_invoice_pdf_bytes') as mock_fetch:
            mock_fetch.return_value = b'%PDF-frozen-bytes'
            for _ in range(3):
                resp = self._get(reverse('invoices:invoice_pdf', kwargs={'pk': invoice.pk}))
                self.assertEqual(resp.status_code, 200)
                self.assertEqual(resp.content, b'%PDF-frozen-bytes')
            self.assertEqual(mock_fetch.call_count, 3)  # called every GET — fetching, not caching in-process

    def test_finalise_pdf_failure_does_not_block_status_transition(self):
        invoice = self._invoice(status='draft')
        InvoiceItem.objects.create(invoice=invoice, description='Work', quantity=Decimal('1'), unit_price=Decimal('100'))
        with patch('apps.invoices.pdf_generator.store_invoice_pdf') as mock_store:
            mock_store.side_effect = RuntimeError('WeasyPrint blew up')
            resp = self._post(reverse('invoices:invoice_finalise', kwargs={'pk': invoice.pk}), {})
        self.assertEqual(resp.status_code, 200)
        invoice.refresh_from_db()
        self.assertEqual(invoice.status, 'created')
        self.assertEqual(invoice.pdf_url, '')

    def test_finalise_fires_the_pdf_render_as_a_background_task_not_inline(self):
        """
        Item 15 of the verification pass — real, profiled fix: Finalise
        used to render+upload the PDF SYNCHRONOUSLY inside the request
        (a real, measured ~1-1.5s WeasyPrint render locally, ~6s against
        the real dev Cloudinary account per email_service.
        fetch_invoice_pdf_bytes' own docstring, plus the upload itself —
        all blocking the HTTP response). It now fires
        apps.invoices.tasks.render_and_store_invoice_pdf via .delay()
        instead of calling store_invoice_pdf directly from the view —
        proven here by patching Celery's own dispatch method (not the
        underlying render function, which eager-mode test settings would
        otherwise execute synchronously and mask this exact regression)
        and confirming the view returns without ever touching
        store_invoice_pdf itself.
        """
        invoice = self._invoice(status='draft')
        InvoiceItem.objects.create(invoice=invoice, description='Work', quantity=Decimal('1'), unit_price=Decimal('100'))
        with patch('apps.invoices.tasks.render_and_store_invoice_pdf.delay') as mock_delay, \
             patch('apps.invoices.pdf_generator.store_invoice_pdf') as mock_store:
            resp = self._post(reverse('invoices:invoice_finalise', kwargs={'pk': invoice.pk}), {})
        self.assertEqual(resp.status_code, 200)
        mock_delay.assert_called_once_with(str(invoice.pk))
        mock_store.assert_not_called()  # never invoked directly/synchronously from the view

    def test_finalise_response_time_is_not_dominated_by_pdf_rendering(self):
        """
        Real, measured before/after: with the render+store genuinely
        moved off the request path, a slow (artificially delayed) render
        function must NOT show up in Finalise's own response time at
        all — the background dispatch (mocked here to skip actually
        enqueuing/running it, isolating this test to the request path
        itself) returns immediately regardless of how slow the real
        render eventually turns out to be.
        """
        import time
        invoice = self._invoice(status='draft')
        InvoiceItem.objects.create(invoice=invoice, description='Work', quantity=Decimal('1'), unit_price=Decimal('100'))

        def slow_render(*args, **kwargs):
            time.sleep(1.5)  # stands in for the real ~1-1.5s local / ~6s Cloudinary-account WeasyPrint render this fix removes from the request path
            return {'secure_url': 'https://res.cloudinary.com/demo/raw/upload/slow.pdf', 'public_id': 'lanceraos/invoices/slow.pdf'}

        with patch('apps.invoices.tasks.render_and_store_invoice_pdf.delay') as mock_delay, \
             patch('apps.invoices.pdf_generator.store_invoice_pdf', side_effect=slow_render):
            started = time.monotonic()
            resp = self._post(reverse('invoices:invoice_finalise', kwargs={'pk': invoice.pk}), {})
            elapsed = time.monotonic() - started

        self.assertEqual(resp.status_code, 200)
        mock_delay.assert_called_once()
        # Comfortably under the 1.5s the mocked render would have cost if
        # it were still inline — a generous margin for CI/local variance,
        # not a tight timing assertion.
        self.assertLess(elapsed, 0.5)

    def test_mark_sent_from_draft_finalises_and_stores_exactly_once(self):
        """
        Mark as Sent is reachable directly from 'draft' (a parallel choice
        to Finalise, not a strict sequence) — when that happens, it must
        finalise (and therefore freeze the PDF) on the way to 'sent',
        exactly once, the same as an explicit Finalise click would.
        """
        invoice = self._invoice(status='draft')
        InvoiceItem.objects.create(invoice=invoice, description='Work', quantity=Decimal('1'), unit_price=Decimal('100'))
        with patch('apps.invoices.pdf_generator.store_invoice_pdf') as mock_store:
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
        with patch('apps.invoices.pdf_generator.store_invoice_pdf') as mock_store:
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
