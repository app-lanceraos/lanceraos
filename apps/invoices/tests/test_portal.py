# apps/invoices/tests/test_portal.py
"""
Step 12 — Client Portal invoice content. Covers: portal-list scoping
(only the resolved client's own invoices), one-time-client single-
invoice access (no session minted, scoped to just that invoice), the
Sent->Viewed guard (fires normally, suppressed when a freelancer session
is also present), InvoiceViewEvent logging under the same guard, the
portal-view HTML endpoint rendering with real browser-fetchable font
URLs (never file://), Preview-as-Client never creating a
ClientPortalSession, and the new "View Invoice Online" email link.
"""
import json
from datetime import date
from decimal import Decimal
from unittest.mock import patch

from django.core.cache import cache
from django.middleware.csrf import get_token
from django.test import Client as DjangoTestClient
from django.test import RequestFactory, TestCase
from django.urls import reverse

from apps.clients.cookies import PORTAL_SESSION_COOKIE_NAME
from apps.clients.models import Client as ClientModel
from apps.clients.models import ClientPortalSession
from apps.invoices.models import Invoice, InvoiceComment, InvoiceItem, InvoiceViewEvent
from apps.invoices.tests.test_models import make_invoice
from apps.users.models import User


def make_client(user, **overrides):
    data = {'name': 'Acme Co', 'email': 'acme@example.com'}
    data.update(overrides)
    return ClientModel.objects.create(user=user, **data)


class PortalContentAPITestCase(TestCase):
    """
    No freelancer login at all — a real client visiting the portal has
    no apps.users session. CSRF plumbing kept for parity with the
    project's other API test bases, even though every endpoint under
    test here is a GET.
    """
    def setUp(self):
        cache.clear()
        self.rf = RequestFactory()
        self.client = DjangoTestClient(enforce_csrf_checks=True)
        self.user = User.objects.create_user(email='freelancer@example.com', password='Sup3r$ecret1')
        self.portal_client = make_client(self.user)

    def _get(self, url):
        return self.client.get(url)

    def _set_portal_session_cookie(self, client_obj, raw_token='real-raw-token'):
        ClientPortalSession.create_for_client(client_obj, raw_token, device_name='', ip_address=None, user_agent='')
        self.client.cookies[PORTAL_SESSION_COOKIE_NAME] = raw_token
        return raw_token

    def _invoice_for(self, client_obj=None, **overrides):
        defaults = {'status': 'sent', 'sent_at': '2026-01-01T00:00:00Z'}
        defaults.update(overrides)
        if client_obj is not None:
            defaults['client'] = client_obj
        invoice = make_invoice(self.user, **defaults)
        InvoiceItem.objects.create(invoice=invoice, description='Work', quantity=Decimal('1'), unit_price=Decimal('100'))
        return invoice


# ══════════════════════════════════════════════════════════════════
# Portal list — scoping
# ══════════════════════════════════════════════════════════════════

class PortalInvoiceListTests(PortalContentAPITestCase):
    def test_requires_a_valid_session(self):
        resp = self._get(reverse('invoices:portal_invoice_list'))
        self.assertEqual(resp.status_code, 401)

    def test_returns_only_the_resolved_clients_own_invoices(self):
        other_client = make_client(self.user, name='Beta Co', email='beta@example.com')
        mine = self._invoice_for(self.portal_client, client_name='Acme Co')
        self._invoice_for(other_client, client_name='Beta Co')  # a different client, same freelancer
        self._set_portal_session_cookie(self.portal_client)

        resp = self._get(reverse('invoices:portal_invoice_list'))
        self.assertEqual(resp.status_code, 200)
        ids = [row['id'] for row in resp.json()]
        self.assertEqual(ids, [str(mine.pk)])

    def test_never_returns_another_freelancers_client_invoices(self):
        other_user = User.objects.create_user(email='other-freelancer@example.com', password='Sup3r$ecret1')
        other_client = make_client(other_user, name='Someone Else', email='else@example.com')
        self._invoice_for(other_client, client_name='Someone Else')
        self._set_portal_session_cookie(self.portal_client)  # session for MY client, not other_client

        resp = self._get(reverse('invoices:portal_invoice_list'))
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json(), [])

    def test_response_shape_omits_freelancer_only_fields(self):
        self._invoice_for(self.portal_client)
        self._set_portal_session_cookie(self.portal_client)

        resp = self._get(reverse('invoices:portal_invoice_list'))
        row = resp.json()[0]
        for field in ('reminder_count', 'last_reminder_sent_at', 'escalation_required', 'sent_via_platform', 'view_token'):
            self.assertNotIn(field, row)
        for field in ('id', 'invoice_number', 'status', 'total', 'due_date', 'days_overdue', 'currency', 'portal_view_url'):
            self.assertIn(field, row)

    def test_excludes_draft_and_finalised_unsent_invoices_from_the_same_freelancer(self):
        """
        Real, confirmed bug fix (see DECISIONS.md): a client who already
        has portal access via one real sent invoice could previously see
        every OTHER invoice from that same freelancer too, including
        drafts and invoices that were finalised but never actually sent
        by any real means. A client should never see or know about an
        invoice that hasn't actually reached them — status only ever
        advances past 'created' via a real mark-sent or /send/.
        """
        sent = self._invoice_for(self.portal_client, status='sent', invoice_number='INV-SENT-0001')
        self._invoice_for(self.portal_client, status='draft', invoice_number=None)
        self._invoice_for(self.portal_client, status='created', invoice_number='INV-CREATED-0001')
        self._set_portal_session_cookie(self.portal_client)

        resp = self._get(reverse('invoices:portal_invoice_list'))
        self.assertEqual(resp.status_code, 200)
        ids = [row['id'] for row in resp.json()]
        self.assertEqual(ids, [str(sent.pk)])

    def test_includes_every_other_real_status_once_actually_delivered(self):
        """The exclusion is narrowly draft/created only — every status reachable past that point (however it got there) still shows."""
        statuses = ['sent', 'viewed', 'partially_paid', 'paid', 'cancelled', 'refunded', 'bad_debt']
        for i, real_status in enumerate(statuses):
            self._invoice_for(self.portal_client, status=real_status, invoice_number=f'INV-{i}', sent_at='2026-01-01T00:00:00Z')
        self._set_portal_session_cookie(self.portal_client)

        resp = self._get(reverse('invoices:portal_invoice_list'))
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.json()), len(statuses))


class PortalInvoiceDetailTests(PortalContentAPITestCase):
    def test_requires_a_valid_session(self):
        invoice = self._invoice_for(self.portal_client)
        resp = self._get(reverse('invoices:portal_invoice_detail', kwargs={'pk': invoice.pk}))
        self.assertEqual(resp.status_code, 401)

    def test_returns_the_clients_own_invoice(self):
        invoice = self._invoice_for(self.portal_client)
        self._set_portal_session_cookie(self.portal_client)

        resp = self._get(reverse('invoices:portal_invoice_detail', kwargs={'pk': invoice.pk}))
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['id'], str(invoice.pk))
        self.assertIn('items', resp.json())

    def test_another_clients_invoice_is_a_real_404_not_403(self):
        """Must not confirm the invoice even exists to an unauthorized viewer."""
        other_client = make_client(self.user, name='Beta Co', email='beta@example.com')
        their_invoice = self._invoice_for(other_client, client_name='Beta Co')
        self._set_portal_session_cookie(self.portal_client)

        resp = self._get(reverse('invoices:portal_invoice_detail', kwargs={'pk': their_invoice.pk}))
        self.assertEqual(resp.status_code, 404)


# ══════════════════════════════════════════════════════════════════
# Portal-view HTML — two entry semantics
# ══════════════════════════════════════════════════════════════════

class PortalViewHtmlTests(PortalContentAPITestCase):
    """
    REWORKED (see DECISIONS.md's frozen-PDF-vs-live-render entry):
    portal_invoice_view_html no longer renders live HTML from current
    invoice+profile data at all — it serves the ACTUAL FROZEN PDF inline
    once one exists, and a real 503 (never a live-render fallback) when
    it doesn't. The old font-URL/CSS-wrapper tests that used to live here
    tested render_invoice_portal_html's OWN output — that generator
    function is unchanged and still real, still tested (its remaining
    real consumer, invoice_preview_as_client, is covered directly by
    PreviewAsClientTests below), it's just no longer what this specific
    endpoint calls.

    A real stored pdf_url plus a mocked fetch_invoice_pdf_bytes (this
    endpoint's own patch point, apps.invoices.views_portal) stands in for
    "a real frozen PDF exists" throughout this class — the self-heal
    chain's OWN behavior is fetch_invoice_pdf_bytes' own responsibility
    to test (apps/invoices/tests/test_pdf_pipeline.py,
    apps/invoices/tests/test_send.py), not re-tested here.
    """
    FAKE_PDF_URL = 'https://res.cloudinary.com/demo/raw/upload/frozen.pdf'

    def test_unknown_token_is_a_real_404(self):
        resp = self._get(reverse('invoices:portal_invoice_view_html', kwargs={'view_token': 'never-issued'}))
        self.assertEqual(resp.status_code, 404)

    @patch('apps.invoices.views_portal.fetch_invoice_pdf_bytes')
    def test_serves_the_actual_frozen_pdf_inline_once_one_exists(self, mock_fetch):
        mock_fetch.return_value = b'%PDF-frozen-content'
        invoice = self._invoice_for(self.portal_client, pdf_url=self.FAKE_PDF_URL)

        resp = self._get(reverse('invoices:portal_invoice_view_html', kwargs={'view_token': invoice.view_token}))
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp['Content-Type'], 'application/pdf')
        self.assertEqual(resp.content, b'%PDF-frozen-content')
        self.assertIn('inline', resp['Content-Disposition'])
        mock_fetch.assert_called_once_with(invoice)

    def test_view_and_download_stay_identical_after_a_profile_edit_when_the_stored_pdf_is_actually_reachable(self):
        """
        The real, explicit before/after drift proof — mirrors the actual
        bug report exactly: an invoice is sent, the freelancer edits
        their profile afterward, then View Invoice and Download must
        still show IDENTICAL content, unaffected by that edit. Real,
        important scoping note (found via live testing against the real
        dev Cloudinary account while building this, not assumed — see
        DECISIONS.md's own honest note on it): this holds whenever the
        ORIGINAL stored pdf_url is actually reachable, i.e. fetch_invoice_
        pdf_bytes' own happy path (mocked here, matching this whole
        class's own convention). If that original fetch fails and
        fetch_invoice_pdf_bytes falls all the way through to ITS OWN
        live-render self-heal fallback (a separate, pre-existing,
        already-documented function with its own real infrastructure-
        failure-recovery purpose — not touched by this pass), that
        specific fallback path still re-renders from current profile
        data, same as it always has; closing THAT residual case would
        mean redesigning fetch_invoice_pdf_bytes' own self-heal chain
        (e.g. snapshotting profile fields at freeze time) — a materially
        larger, separate change, out of this task's own scope. What this
        test proves is the actual, explicitly-named bug: portal_invoice_
        view_html itself no longer pulls current profile data
        UNCONDITIONALLY on every view — the dominant, always-active drift
        source — regardless of whether self-heal's own narrower,
        infrastructure-failure-only risk is ever separately addressed.
        """
        invoice = self._invoice_for(self.portal_client, pdf_url=self.FAKE_PDF_URL)

        with patch('apps.invoices.views_portal.fetch_invoice_pdf_bytes', return_value=b'%PDF-truly-frozen-bytes') as mock_fetch:
            before = self._get(reverse('invoices:portal_invoice_view_html', kwargs={'view_token': invoice.view_token}))
        self.assertEqual(before.content, b'%PDF-truly-frozen-bytes')

        # A real, later profile edit — the exact scenario the bug report
        # named (business name, logo, payment methods, signature all live
        # on FreelancerProfile, never on the invoice itself).
        profile = self.user.profile
        profile.business_name = 'A Totally Different Business Name LLC'
        profile.save(update_fields=['business_name'])

        with patch('apps.invoices.views_portal.fetch_invoice_pdf_bytes', return_value=b'%PDF-truly-frozen-bytes') as mock_fetch:
            after = self._get(reverse('invoices:portal_invoice_view_html', kwargs={'view_token': invoice.view_token}))
        self.assertEqual(after.content, b'%PDF-truly-frozen-bytes')

        self.assertEqual(before.content, after.content)  # identical, unaffected by the profile edit in between

    def test_returns_a_real_503_not_a_live_render_when_no_pdf_url_exists_yet(self):
        """
        The real fix this pass makes: a client-reachable invoice with
        nothing frozen yet (e.g. the background render+store task hasn't
        landed) gets an honest "not ready" response — never the OLD
        behavior of live-rendering the shared template from CURRENT
        invoice+profile data as a silent substitute.
        """
        invoice = self._invoice_for(self.portal_client)
        self.assertEqual(invoice.pdf_url, '')

        resp = self._get(reverse('invoices:portal_invoice_view_html', kwargs={'view_token': invoice.view_token}))
        self.assertEqual(resp.status_code, 503)
        self.assertIn("isn't ready", resp.json()['error'].lower())

    @patch('apps.invoices.views_portal.fetch_invoice_pdf_bytes', return_value=None)
    def test_returns_a_real_503_when_a_stored_pdf_url_exists_but_every_fetch_path_fails(self, mock_fetch):
        """A genuine total-infrastructure-failure case — still never falls back to a live render."""
        invoice = self._invoice_for(self.portal_client, pdf_url=self.FAKE_PDF_URL)
        resp = self._get(reverse('invoices:portal_invoice_view_html', kwargs={'view_token': invoice.view_token}))
        self.assertEqual(resp.status_code, 503)

    @patch('apps.invoices.views_portal.fetch_invoice_pdf_bytes')
    def test_saved_clients_invoice_mints_a_real_session(self, mock_fetch):
        mock_fetch.return_value = b'%PDF-fake'
        invoice = self._invoice_for(self.portal_client, pdf_url=self.FAKE_PDF_URL)
        self.assertEqual(ClientPortalSession.objects.filter(client=self.portal_client).count(), 0)

        resp = self._get(reverse('invoices:portal_invoice_view_html', kwargs={'view_token': invoice.view_token}))
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(ClientPortalSession.objects.filter(client=self.portal_client).count(), 1)
        self.assertIn(PORTAL_SESSION_COOKIE_NAME, resp.cookies)

    def test_session_still_mints_even_on_the_not_yet_available_503(self):
        """
        A client who followed a real link should still be tracked as
        having visited, even in the rare case the PDF isn't ready yet —
        session-minting is unconditional, independent of which branch
        produced the response.
        """
        invoice = self._invoice_for(self.portal_client)
        self.assertEqual(invoice.pdf_url, '')

        resp = self._get(reverse('invoices:portal_invoice_view_html', kwargs={'view_token': invoice.view_token}))
        self.assertEqual(resp.status_code, 503)
        self.assertEqual(ClientPortalSession.objects.filter(client=self.portal_client).count(), 1)
        self.assertIn(PORTAL_SESSION_COOKIE_NAME, resp.cookies)

    @patch('apps.invoices.views_portal.fetch_invoice_pdf_bytes')
    def test_one_time_clients_invoice_creates_no_session(self, mock_fetch):
        mock_fetch.return_value = b'%PDF-fake'
        invoice = self._invoice_for(
            client_obj=None, client_name='One-Timer', client_email='onetime@example.com',
            is_one_time_client=True, pdf_url=self.FAKE_PDF_URL,
        )
        self.assertIsNone(invoice.client_id)

        resp = self._get(reverse('invoices:portal_invoice_view_html', kwargs={'view_token': invoice.view_token}))
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(ClientPortalSession.objects.count(), 0)
        self.assertNotIn(PORTAL_SESSION_COOKIE_NAME, resp.cookies)

    @patch('apps.invoices.views_portal.fetch_invoice_pdf_bytes')
    def test_a_second_one_time_invoice_for_the_same_email_is_not_reachable_via_the_first_ones_visit(self, mock_fetch):
        """No Client row, no session — a one-time client's access never generalizes beyond its own view_token."""
        mock_fetch.return_value = b'%PDF-fake'
        invoice_a = self._invoice_for(
            client_obj=None, client_name='Repeat Buyer', client_email='repeat@example.com',
            is_one_time_client=True, pdf_url=self.FAKE_PDF_URL,
        )
        invoice_b = self._invoice_for(
            client_obj=None, client_name='Repeat Buyer', client_email='repeat@example.com',
            is_one_time_client=True, pdf_url=self.FAKE_PDF_URL,
        )

        self._get(reverse('invoices:portal_invoice_view_html', kwargs={'view_token': invoice_a.view_token}))
        # Visiting invoice_a created no session at all, so a request carrying
        # whatever cookie jar resulted (none) must still not reach invoice_b
        # through anything but its own separate view_token.
        resp = self._get(reverse('invoices:portal_invoice_view_html', kwargs={'view_token': invoice_b.view_token}))
        self.assertEqual(resp.status_code, 200)  # reachable only via ITS OWN token
        self.assertEqual(ClientPortalSession.objects.count(), 0)

        # And there is no portal list access at all for a one-time client —
        # confirm no session exists to even attempt portal_invoice_list with.
        self.assertEqual(ClientPortalSession.objects.count(), 0)


class PortalPdfDownloadTests(PortalContentAPITestCase):
    """
    GET /api/invoices/portal/view/<token>/pdf/ — real frontend-domain
    invoice view page follow-up (see DECISIONS.md). Added because the
    shared invoice templates have no Download link of their own
    (confirmed directly), and the freelancer-facing GET
    /api/invoices/<pk>/pdf/ is IsAuthenticated/owner-scoped, unreachable
    by an actual client. Same view_token-is-the-credential trust model as
    portal_invoice_view_html — AllowAny, real 404 for an unknown token —
    but read-only/side-effect-free: no session minting, no view-tracking.
    """
    def test_unknown_token_is_a_real_404(self):
        resp = self._get(reverse('invoices:portal_invoice_pdf_download', kwargs={'view_token': 'never-issued'}))
        self.assertEqual(resp.status_code, 404)

    @patch('apps.invoices.views_portal.fetch_invoice_pdf_bytes')
    def test_proxies_real_bytes_with_a_real_download_disposition(self, mock_fetch):
        mock_fetch.return_value = b'%PDF-portal-download'
        invoice = self._invoice_for(self.portal_client)
        resp = self._get(reverse('invoices:portal_invoice_pdf_download', kwargs={'view_token': invoice.view_token}))
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp['Content-Type'], 'application/pdf')
        self.assertEqual(resp.content, b'%PDF-portal-download')
        self.assertIn('attachment', resp['Content-Disposition'])
        self.assertIn(invoice.invoice_number, resp['Content-Disposition'])
        mock_fetch.assert_called_once_with(invoice)

    @patch('apps.invoices.views_portal.fetch_invoice_pdf_bytes', return_value=None)
    def test_returns_502_when_every_fetch_render_path_fails(self, mock_fetch):
        invoice = self._invoice_for(self.portal_client)
        resp = self._get(reverse('invoices:portal_invoice_pdf_download', kwargs={'view_token': invoice.view_token}))
        self.assertEqual(resp.status_code, 502)

    @patch('apps.invoices.email_service.requests.get')
    def test_download_still_works_end_to_end_under_the_real_cloudinary_401_condition(self, mock_get):
        """
        Real, end-to-end proof (nothing mocked at this view's own level,
        unlike this class's other tests) that a client's public download
        still works even when this account's real, confirmed raw/PDF
        delivery ACL restriction blocks a direct unauthenticated fetch of
        the stored asset — the actual point of building this endpoint on
        fetch_invoice_pdf_bytes rather than a redirect. Mirrors
        apps/invoices/tests/test_pdf_pipeline.py's identical proof for
        the freelancer-facing GET /api/invoices/<pk>/pdf/ — same
        underlying chain, same real failure condition, different caller.
        """
        import requests
        mock_get.side_effect = requests.RequestException('401 unauthorized — deny or ACL failure')
        invoice = self._invoice_for(self.portal_client)
        invoice.pdf_url = 'https://res.cloudinary.com/demo/raw/upload/invoice_401.pdf'
        invoice.save(update_fields=['pdf_url'])

        with patch('apps.invoices.email_service.upload_pdf_bytes') as mock_upload:
            mock_upload.return_value = {
                'secure_url': 'https://res.cloudinary.com/demo/raw/upload/invoice_healed.pdf',
                'public_id': 'lanceraos/invoices/invoice_healed.pdf',
            }
            resp = self._get(reverse('invoices:portal_invoice_pdf_download', kwargs={'view_token': invoice.view_token}))

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp['Content-Type'], 'application/pdf')
        self.assertTrue(resp.content.startswith(b'%PDF'))
        mock_upload.assert_called_once()

    @patch('apps.invoices.views_portal.fetch_invoice_pdf_bytes')
    def test_never_mints_a_session_or_logs_a_view_unlike_the_html_view(self, mock_fetch):
        """
        A real, deliberate difference from portal_invoice_view_html right
        above it — downloading the PDF is a read-only action with none of
        that endpoint's side effects. A client visiting the real HTML
        page first (which does mint a session / log a view) is the actual
        real-world sequence; this download endpoint on its own must never
        duplicate either side effect.
        """
        mock_fetch.return_value = b'%PDF-no-side-effects'
        invoice = self._invoice_for(self.portal_client)
        self.assertEqual(invoice.status, 'sent')

        resp = self._get(reverse('invoices:portal_invoice_pdf_download', kwargs={'view_token': invoice.view_token}))
        self.assertEqual(resp.status_code, 200)

        invoice.refresh_from_db()
        self.assertEqual(invoice.status, 'sent')  # NOT advanced to 'viewed'
        self.assertEqual(InvoiceViewEvent.objects.filter(invoice=invoice).count(), 0)
        self.assertEqual(ClientPortalSession.objects.filter(client=self.portal_client).count(), 0)


# ══════════════════════════════════════════════════════════════════
# Sent->Viewed transition + InvoiceViewEvent — the shared guard
# ══════════════════════════════════════════════════════════════════

class ViewTrackingGuardTests(TestCase):
    """
    Uses a real freelancer login (InvoicesAPITestCase-style) for the
    "both cookies present" cases, and a bare client for the "client-only"
    cases — exactly the two real scenarios the guard has to distinguish.
    """
    def setUp(self):
        cache.clear()
        self.rf = RequestFactory()
        self.client = DjangoTestClient(enforce_csrf_checks=True)
        self.user = User.objects.create_user(email='freelancer@example.com', password='Sup3r$ecret1')
        self.user.is_email_verified = True
        self.user.is_active = True
        self.user.save()
        self.portal_client = make_client(self.user)

    def _csrf_token(self):
        dummy = self.rf.get('/')
        token = get_token(dummy)
        self.client.cookies['csrftoken'] = dummy.META['CSRF_COOKIE']
        return token

    def _login_as_freelancer(self):
        csrf_token = self._csrf_token()
        resp = self.client.post(reverse('users:login'), data=json.dumps({
            'login': self.user.email, 'password': 'Sup3r$ecret1',
        }), content_type='application/json', HTTP_X_CSRFTOKEN=csrf_token)
        assert resp.status_code == 200, resp.content

    # A real stored pdf_url — every real test below hits
    # portal_invoice_view_html directly and, per this pass's own rework
    # (see DECISIONS.md), that endpoint now needs one to return 200 at
    # all (a blank pdf_url is a real 503 "not ready yet", never a live
    # HTML re-render — see PortalViewHtmlTests for that behavior's own
    # dedicated coverage). fetch_invoice_pdf_bytes is mocked per-test
    # below (this class's own patch point,
    # apps.invoices.views_portal.fetch_invoice_pdf_bytes) rather than
    # hitting a real network fetch of this fake URL.
    FAKE_PDF_URL = 'https://res.cloudinary.com/demo/raw/upload/frozen.pdf'

    def _sent_invoice(self):
        invoice = make_invoice(self.user, status='sent', sent_at='2026-01-01T00:00:00Z', client=self.portal_client, pdf_url=self.FAKE_PDF_URL)
        InvoiceItem.objects.create(invoice=invoice, description='Work', quantity=Decimal('1'), unit_price=Decimal('100'))
        return invoice

    @patch('apps.invoices.views_portal.fetch_invoice_pdf_bytes', return_value=b'%PDF-fake')
    def test_a_real_client_view_transitions_sent_to_viewed_and_logs_an_event(self, mock_fetch):
        invoice = self._sent_invoice()
        resp = self.client.get(reverse('invoices:portal_invoice_view_html', kwargs={'view_token': invoice.view_token}))
        self.assertEqual(resp.status_code, 200)

        invoice.refresh_from_db()
        self.assertEqual(invoice.status, 'viewed')
        self.assertEqual(InvoiceViewEvent.objects.filter(invoice=invoice).count(), 1)
        event = InvoiceViewEvent.objects.get(invoice=invoice)
        self.assertEqual(event.source, 'platform_view')

    @patch('apps.invoices.views_portal.fetch_invoice_pdf_bytes', return_value=b'%PDF-fake')
    def test_view_invoice_button_target_still_suppresses_side_effects_after_preview_as_client_removal(self, mock_fetch):
        """
        Mandatory regression test (bug-hardening round — InvoiceDetailPanel
        redesign): "Preview as Client" (the old iframe/modal, backed by
        the SEPARATE invoice_preview_as_client endpoint, which never
        called _record_invoice_view_if_appropriate at all) is removed
        from the frontend entirely — "View Invoice" now opens the real
        portal_invoice_view_html page directly instead. This guard
        (is_freelancer_previewing_portal) protects THIS endpoint, not the
        removed feature, so removing the feature must not silently
        regress it. Explicit, current-dated proof that opening the real
        "View Invoice" destination as the freelancer (both their own
        apps.users session AND a portal session live in the same browser
        — the exact scenario a freelancer clicking their own client's
        real link produces) still does not flip Sent->Viewed, still does
        not log a real InvoiceViewEvent, and (via the sibling assertion
        below) still does not mark comments seen-by-client.
        """
        invoice = self._sent_invoice()
        self._login_as_freelancer()
        ClientPortalSession.create_for_client(self.portal_client, 'view-invoice-btn-tok', device_name='', ip_address=None, user_agent='')
        self.client.cookies[PORTAL_SESSION_COOKIE_NAME] = 'view-invoice-btn-tok'

        # The exact URL InvoiceDetailPanel's "View Invoice" button opens —
        # invoice.portal_view_url, built from this same view_token.
        resp = self.client.get(reverse('invoices:portal_invoice_view_html', kwargs={'view_token': invoice.view_token}))
        self.assertEqual(resp.status_code, 200)

        invoice.refresh_from_db()
        self.assertEqual(invoice.status, 'sent')  # NOT advanced to 'viewed'
        self.assertEqual(InvoiceViewEvent.objects.filter(invoice=invoice).count(), 0)  # no real view logged

        comment = InvoiceComment.objects.create(invoice=invoice, author_type='freelancer', body_text='Hi', source='app')
        self.client.get(reverse('invoices:portal_invoice_comments', kwargs={'pk': invoice.pk}))
        comment.refresh_from_db()
        self.assertIsNone(comment.read_by_client_at)  # not falsely marked seen-by-client either

    @patch('apps.invoices.views_portal.fetch_invoice_pdf_bytes', return_value=b'%PDF-fake')
    def test_freelancer_previewing_with_both_cookies_present_suppresses_both_side_effects(self, mock_fetch):
        invoice = self._sent_invoice()
        self._login_as_freelancer()  # a real, valid apps.users session cookie
        ClientPortalSession.create_for_client(self.portal_client, 'preview-raw-tok', device_name='', ip_address=None, user_agent='')
        self.client.cookies[PORTAL_SESSION_COOKIE_NAME] = 'preview-raw-tok'  # ALSO a valid portal session

        resp = self.client.get(reverse('invoices:portal_invoice_view_html', kwargs={'view_token': invoice.view_token}))
        self.assertEqual(resp.status_code, 200)

        invoice.refresh_from_db()
        self.assertEqual(invoice.status, 'sent')  # unchanged — not advanced to 'viewed'
        self.assertEqual(InvoiceViewEvent.objects.filter(invoice=invoice).count(), 0)

    @patch('apps.invoices.views_portal.fetch_invoice_pdf_bytes', return_value=b'%PDF-fake')
    def test_freelancer_session_alone_with_no_portal_session_still_tracks_normally(self, mock_fetch):
        """A freelancer's OWN session with no portal-session cookie at all is not the preview scenario — matches an ordinary anonymous client view since is_freelancer_previewing_portal requires BOTH."""
        invoice = self._sent_invoice()
        self._login_as_freelancer()

        resp = self.client.get(reverse('invoices:portal_invoice_view_html', kwargs={'view_token': invoice.view_token}))
        self.assertEqual(resp.status_code, 200)

        invoice.refresh_from_db()
        self.assertEqual(invoice.status, 'viewed')
        self.assertEqual(InvoiceViewEvent.objects.filter(invoice=invoice).count(), 1)

    def test_freelancer_previewing_does_not_mark_comments_seen_by_client(self):
        """
        Item 9 of the verification pass — real, confirmed gap:
        is_freelancer_previewing_portal was already wired into
        portal_invoice_comments' POST path, but never into GET's own
        read-marking. A freelancer who visits their own client's real
        portal link (both cookies present) must not falsely mark their
        own message as "seen by the client" just by looking at it.
        """
        from apps.invoices.models import InvoiceComment
        invoice = self._sent_invoice()
        comment = InvoiceComment.objects.create(
            invoice=invoice, author_type='freelancer', body_text='Hi there', source='app',
        )
        self.assertIsNone(comment.read_by_client_at)

        self._login_as_freelancer()
        ClientPortalSession.create_for_client(self.portal_client, 'preview-comments-tok', device_name='', ip_address=None, user_agent='')
        self.client.cookies[PORTAL_SESSION_COOKIE_NAME] = 'preview-comments-tok'

        resp = self.client.get(reverse('invoices:portal_invoice_comments', kwargs={'pk': invoice.pk}))
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.json()), 1)  # comments themselves still return normally

        comment.refresh_from_db()
        self.assertIsNone(comment.read_by_client_at)  # NOT marked seen — this was a preview, not a real client read

    def test_a_real_client_read_does_mark_comments_seen(self):
        """Control case — the exact same GET, but with only a real portal session (no freelancer cookie) — must still mark read_by_client_at normally."""
        from apps.invoices.models import InvoiceComment
        invoice = self._sent_invoice()
        comment = InvoiceComment.objects.create(
            invoice=invoice, author_type='freelancer', body_text='Hi there', source='app',
        )
        ClientPortalSession.create_for_client(self.portal_client, 'real-client-tok', device_name='', ip_address=None, user_agent='')
        self.client.cookies[PORTAL_SESSION_COOKIE_NAME] = 'real-client-tok'

        resp = self.client.get(reverse('invoices:portal_invoice_comments', kwargs={'pk': invoice.pk}))
        self.assertEqual(resp.status_code, 200)

        comment.refresh_from_db()
        self.assertIsNotNone(comment.read_by_client_at)

    @patch('apps.invoices.views_portal.fetch_invoice_pdf_bytes', return_value=b'%PDF-fake')
    def test_view_on_a_non_sent_status_still_logs_the_event_but_does_not_change_status(self, mock_fetch):
        invoice = make_invoice(self.user, status='paid', sent_at='2026-01-01T00:00:00Z', client=self.portal_client, amount_paid=Decimal('100.00'), pdf_url=self.FAKE_PDF_URL)
        InvoiceItem.objects.create(invoice=invoice, description='Work', quantity=Decimal('1'), unit_price=Decimal('100'))

        self.client.get(reverse('invoices:portal_invoice_view_html', kwargs={'view_token': invoice.view_token}))

        invoice.refresh_from_db()
        self.assertEqual(invoice.status, 'paid')
        self.assertEqual(InvoiceViewEvent.objects.filter(invoice=invoice).count(), 1)

    def test_comment_posting_guard_gap_from_step_13_is_now_closed(self):
        """
        Regression test — Step 13 wired is_freelancer_previewing_portal
        into the Sent->Viewed transition and InvoiceViewEvent logging
        only; portal_invoice_comments never got it (confirmed against
        DECISIONS.md's own Step 13 entry, which doesn't mention it). Step
        14 closes this gap alongside building it fresh for claims.
        """
        invoice = self._sent_invoice()
        self._login_as_freelancer()
        ClientPortalSession.create_for_client(self.portal_client, 'preview-comment-tok', device_name='', ip_address=None, user_agent='')
        self.client.cookies[PORTAL_SESSION_COOKIE_NAME] = 'preview-comment-tok'

        csrf_token = self._csrf_token()
        resp = self.client.post(
            reverse('invoices:portal_invoice_comments', kwargs={'pk': invoice.pk}),
            data=json.dumps({'body_text': 'am I really the client?'}), content_type='application/json', HTTP_X_CSRFTOKEN=csrf_token,
        )
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(InvoiceComment.objects.filter(invoice=invoice).count(), 0)


# ══════════════════════════════════════════════════════════════════
# Audit fix (LANCERAOS_CLIENTS_INVOICES_PRODUCTION_AUDIT.md, 19 August
# 2026, finding PORTAL-001) — the guard must check OWNERSHIP, not just
# "does a freelancer session and a portal session both exist." Two
# genuinely distinct real accounts: Account A (self.user) owns the
# client/invoice under test; Account B (self.other_user) is a completely
# unrelated freelancer who is ALSO, in this same browser, carrying a
# valid portal-session cookie for Account A's client (the exact scenario
# the audit identified as plausible and live-unverified — a forwarded
# link, another tab, genuinely being someone else's client). None of
# these actions should be suppressed/403'd; they must behave exactly
# like an ordinary, unrelated client action.
# ══════════════════════════════════════════════════════════════════

class CrossAccountFreelancerPreviewGuardTests(TestCase):
    def setUp(self):
        cache.clear()
        self.rf = RequestFactory()
        self.client = DjangoTestClient(enforce_csrf_checks=True)

        self.user = User.objects.create_user(email='owner@example.com', password='Sup3r$ecret1')
        self.user.is_email_verified = True
        self.user.is_active = True
        self.user.save()
        self.portal_client = make_client(self.user)

        self.other_user = User.objects.create_user(email='unrelated-freelancer@example.com', password='Sup3r$ecret1')
        self.other_user.is_email_verified = True
        self.other_user.is_active = True
        self.other_user.save()

    def _csrf_token(self):
        dummy = self.rf.get('/')
        token = get_token(dummy)
        self.client.cookies['csrftoken'] = dummy.META['CSRF_COOKIE']
        return token

    def _login_as(self, user):
        csrf_token = self._csrf_token()
        resp = self.client.post(reverse('users:login'), data=json.dumps({
            'login': user.email, 'password': 'Sup3r$ecret1',
        }), content_type='application/json', HTTP_X_CSRFTOKEN=csrf_token)
        assert resp.status_code == 200, resp.content

    FAKE_PDF_URL = 'https://res.cloudinary.com/demo/raw/upload/frozen.pdf'

    def _sent_invoice(self):
        invoice = make_invoice(self.user, status='sent', sent_at='2026-01-01T00:00:00Z', client=self.portal_client, pdf_url=self.FAKE_PDF_URL)
        InvoiceItem.objects.create(invoice=invoice, description='Work', quantity=Decimal('1'), unit_price=Decimal('100'))
        return invoice

    def _carry_unrelated_freelancer_plus_portal_session(self, portal_token):
        """
        Account B's real JWT cookie + a real portal session for Account
        A's client, both present on the same test client instance — the
        exact cross-account browser state under test.
        """
        self._login_as(self.other_user)
        ClientPortalSession.create_for_client(self.portal_client, portal_token, device_name='', ip_address=None, user_agent='')
        self.client.cookies[PORTAL_SESSION_COOKIE_NAME] = portal_token

    @patch('apps.invoices.views_portal.fetch_invoice_pdf_bytes', return_value=b'%PDF-fake')
    def test_unrelated_freelancers_session_does_not_suppress_a_real_client_view(self, mock_fetch):
        invoice = self._sent_invoice()
        self._carry_unrelated_freelancer_plus_portal_session('cross-account-view-tok')

        resp = self.client.get(reverse('invoices:portal_invoice_view_html', kwargs={'view_token': invoice.view_token}))
        self.assertEqual(resp.status_code, 200)

        invoice.refresh_from_db()
        # Genuinely treated as a real client view — Sent->Viewed fires,
        # a real InvoiceViewEvent is logged. Before the fix, Account B's
        # own unrelated freelancer session was enough to suppress this.
        self.assertEqual(invoice.status, 'viewed')
        self.assertEqual(InvoiceViewEvent.objects.filter(invoice=invoice).count(), 1)

    def test_unrelated_freelancers_session_does_not_suppress_a_real_comment(self):
        invoice = self._sent_invoice()
        self._carry_unrelated_freelancer_plus_portal_session('cross-account-comment-tok')

        csrf_token = self._csrf_token()
        resp = self.client.post(
            reverse('invoices:portal_invoice_comments', kwargs={'pk': invoice.pk}),
            data=json.dumps({'body_text': 'a genuine question from the real client'}),
            content_type='application/json', HTTP_X_CSRFTOKEN=csrf_token,
        )
        # Before the fix: 403, "You're previewing this portal as its own
        # freelancer" — even though Account B owns neither the invoice
        # nor the client. Now a real, successful client comment.
        self.assertEqual(resp.status_code, 201, resp.content)
        comment = InvoiceComment.objects.get(invoice=invoice)
        self.assertEqual(comment.author_type, 'client')
        self.assertEqual(comment.body_text, 'a genuine question from the real client')

    def test_unrelated_freelancers_session_does_not_suppress_a_real_claim(self):
        invoice = self._sent_invoice()
        self._carry_unrelated_freelancer_plus_portal_session('cross-account-claim-tok')

        csrf_token = self._csrf_token()
        resp = self.client.post(
            reverse('invoices:portal_invoice_claims', kwargs={'pk': invoice.pk}),
            data=json.dumps({
                'payment_source': 'wise', 'amount_claimed': '100.00', 'currency': 'USD', 'payment_date': '2026-01-15',
            }),
            content_type='application/json', HTTP_X_CSRFTOKEN=csrf_token,
        )
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertEqual(invoice.payment_claims.count(), 1)

    def test_unrelated_freelancers_session_does_not_suppress_a_real_acknowledgment(self):
        invoice = self._sent_invoice()
        self._carry_unrelated_freelancer_plus_portal_session('cross-account-ack-tok')

        csrf_token = self._csrf_token()
        resp = self.client.post(
            reverse('invoices:portal_invoice_acknowledge', kwargs={'pk': invoice.pk}),
            data=json.dumps({}), content_type='application/json', HTTP_X_CSRFTOKEN=csrf_token,
        )
        self.assertIn(resp.status_code, (200, 201), resp.content)
        invoice.refresh_from_db()
        self.assertTrue(invoice.client_acknowledged)

    @patch('apps.invoices.views_portal.fetch_invoice_pdf_bytes', return_value=b'%PDF-fake')
    def test_the_real_owner_previewing_their_own_client_is_still_correctly_suppressed(self, mock_fetch):
        """
        Control — proves the fix didn't just make the guard always
        return False. The SAME client/invoice, but this time the
        freelancer session genuinely belongs to self.user (the real
        owner) — still correctly suppressed, exactly as before this fix.
        """
        invoice = self._sent_invoice()
        self._login_as(self.user)
        ClientPortalSession.create_for_client(self.portal_client, 'genuine-owner-preview-tok', device_name='', ip_address=None, user_agent='')
        self.client.cookies[PORTAL_SESSION_COOKIE_NAME] = 'genuine-owner-preview-tok'

        resp = self.client.get(reverse('invoices:portal_invoice_view_html', kwargs={'view_token': invoice.view_token}))
        self.assertEqual(resp.status_code, 200)

        invoice.refresh_from_db()
        self.assertEqual(invoice.status, 'sent')
        self.assertEqual(InvoiceViewEvent.objects.filter(invoice=invoice).count(), 0)


# ══════════════════════════════════════════════════════════════════
# Audit fix (LANCERAOS_CLIENTS_INVOICES_PRODUCTION_AUDIT.md, 19 August
# 2026, finding PORTAL-002) — portal_invoice_comments (POST)/
# portal_invoice_claims (POST)/portal_invoice_acknowledge never called
# enforce_csrf_standalone, unlike apps/clients/views_portal.py's
# portal_logout/portal_logout_everywhere, which already did for the
# identical reason (CookieJWTAuthentication.authenticate()'s own
# enforce_csrf call never fires here — there's no JWT cookie on a real
# portal-only request for it to run against). This class proves both
# directions: no CSRF token -> real 403, and the token the real frontend
# already sends via its shared Axios instance (src/lib/api.js's
# X-CSRFToken header) -> unaffected, still a real 200/201.
# ══════════════════════════════════════════════════════════════════

class PortalWriteEndpointsCSRFEnforcementTests(TestCase):
    def setUp(self):
        cache.clear()
        self.rf = RequestFactory()
        self.client = DjangoTestClient(enforce_csrf_checks=True)
        self.user = User.objects.create_user(email='csrf-owner@example.com', password='Sup3r$ecret1')
        self.user.is_email_verified = True
        self.user.is_active = True
        self.user.save()
        self.portal_client = make_client(self.user)

        invoice = make_invoice(self.user, status='sent', sent_at='2026-01-01T00:00:00Z', client=self.portal_client)
        InvoiceItem.objects.create(invoice=invoice, description='Work', quantity=Decimal('1'), unit_price=Decimal('100'))
        self.invoice = invoice

        ClientPortalSession.create_for_client(self.portal_client, 'csrf-test-portal-tok', device_name='', ip_address=None, user_agent='')
        self.client.cookies[PORTAL_SESSION_COOKIE_NAME] = 'csrf-test-portal-tok'

    def _csrf_token(self):
        dummy = self.rf.get('/')
        token = get_token(dummy)
        self.client.cookies['csrftoken'] = dummy.META['CSRF_COOKIE']
        return token

    def _post(self, url, data, with_csrf):
        headers = {}
        if with_csrf:
            headers['HTTP_X_CSRFTOKEN'] = self._csrf_token()
        else:
            # A csrftoken cookie can legitimately exist client-side (any
            # earlier GET may have set one) without the matching header
            # being sent — the real attack shape enforce_csrf_standalone
            # defends against is a cross-site POST that never had a
            # chance to read the header value at all.
            self._csrf_token()
        return self.client.post(url, data=json.dumps(data), content_type='application/json', **headers)

    def test_comment_post_without_csrf_token_is_rejected(self):
        resp = self._post(
            reverse('invoices:portal_invoice_comments', kwargs={'pk': self.invoice.pk}),
            {'body_text': 'no csrf token here'}, with_csrf=False,
        )
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(InvoiceComment.objects.filter(invoice=self.invoice).count(), 0)

    def test_comment_post_with_a_real_csrf_token_still_works(self):
        resp = self._post(
            reverse('invoices:portal_invoice_comments', kwargs={'pk': self.invoice.pk}),
            {'body_text': 'a real message, real token'}, with_csrf=True,
        )
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertEqual(InvoiceComment.objects.filter(invoice=self.invoice).count(), 1)

    def test_comment_get_is_unaffected_by_csrf_enforcement(self):
        """Safe methods are a real no-op inside enforce_csrf_standalone — GET must never 403 regardless of any token."""
        resp = self.client.get(reverse('invoices:portal_invoice_comments', kwargs={'pk': self.invoice.pk}))
        self.assertEqual(resp.status_code, 200)

    def test_claim_post_without_csrf_token_is_rejected(self):
        resp = self._post(
            reverse('invoices:portal_invoice_claims', kwargs={'pk': self.invoice.pk}),
            {'payment_source': 'wise', 'amount_claimed': '50.00', 'currency': 'USD', 'payment_date': '2026-01-15'},
            with_csrf=False,
        )
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(self.invoice.payment_claims.count(), 0)

    def test_claim_post_with_a_real_csrf_token_still_works(self):
        resp = self._post(
            reverse('invoices:portal_invoice_claims', kwargs={'pk': self.invoice.pk}),
            {'payment_source': 'wise', 'amount_claimed': '50.00', 'currency': 'USD', 'payment_date': '2026-01-15'},
            with_csrf=True,
        )
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertEqual(self.invoice.payment_claims.count(), 1)

    def test_acknowledge_without_csrf_token_is_rejected(self):
        resp = self._post(
            reverse('invoices:portal_invoice_acknowledge', kwargs={'pk': self.invoice.pk}), {}, with_csrf=False,
        )
        self.assertEqual(resp.status_code, 403)
        self.invoice.refresh_from_db()
        self.assertFalse(self.invoice.client_acknowledged)

    def test_acknowledge_with_a_real_csrf_token_still_works(self):
        resp = self._post(
            reverse('invoices:portal_invoice_acknowledge', kwargs={'pk': self.invoice.pk}), {}, with_csrf=True,
        )
        self.assertIn(resp.status_code, (200, 201), resp.content)
        self.invoice.refresh_from_db()
        self.assertTrue(self.invoice.client_acknowledged)


# ══════════════════════════════════════════════════════════════════
# Preview-as-Client — freelancer-only, never mints a session
# ══════════════════════════════════════════════════════════════════

class PreviewAsClientTests(TestCase):
    def setUp(self):
        cache.clear()
        self.rf = RequestFactory()
        self.client = DjangoTestClient(enforce_csrf_checks=True)
        self.user = User.objects.create_user(email='freelancer@example.com', password='Sup3r$ecret1')
        self.user.is_email_verified = True
        self.user.is_active = True
        self.user.save()
        self.portal_client = make_client(self.user)
        self._login()

    def _csrf_token(self):
        dummy = self.rf.get('/')
        token = get_token(dummy)
        self.client.cookies['csrftoken'] = dummy.META['CSRF_COOKIE']
        return token

    def _login(self):
        csrf_token = self._csrf_token()
        resp = self.client.post(reverse('users:login'), data=json.dumps({
            'login': self.user.email, 'password': 'Sup3r$ecret1',
        }), content_type='application/json', HTTP_X_CSRFTOKEN=csrf_token)
        assert resp.status_code == 200, resp.content

    def test_requires_authentication(self):
        anon = DjangoTestClient()
        invoice = make_invoice(self.user, client=self.portal_client)
        resp = anon.get(reverse('invoices:invoice_preview_as_client', kwargs={'pk': invoice.pk}))
        self.assertEqual(resp.status_code, 401)

    def test_renders_the_same_html_a_real_client_would_see(self):
        invoice = make_invoice(self.user, client=self.portal_client)
        InvoiceItem.objects.create(invoice=invoice, description='Work', quantity=Decimal('1'), unit_price=Decimal('100'))
        resp = self.client.get(reverse('invoices:invoice_preview_as_client', kwargs={'pk': invoice.pk}))
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp['Content-Type'].startswith('text/html'))
        self.assertIn(invoice.client_name, resp.content.decode())

    def test_response_is_exempt_from_x_frame_options_so_the_iframe_actually_renders(self):
        """
        Item 14 of the verification pass — the real, confirmed root cause
        of "Preview-as-Client not working": Django's own clickjacking
        protection (X_FRAME_OPTIONS='DENY' in production,
        config/settings.py, plus Django's own framework default of
        'DENY' in DEBUG — never overridden either way for this specific
        view before this fix) silently blocked every browser from
        rendering this response inside InvoiceDetailPanel's iframe, in
        BOTH environments. @xframe_options_exempt on this one view is
        the fix; every other endpoint in the app keeps the default
        protection untouched.
        """
        invoice = make_invoice(self.user, client=self.portal_client)
        InvoiceItem.objects.create(invoice=invoice, description='Work', quantity=Decimal('1'), unit_price=Decimal('100'))
        resp = self.client.get(reverse('invoices:invoice_preview_as_client', kwargs={'pk': invoice.pk}))
        self.assertEqual(resp.status_code, 200)
        self.assertNotIn('X-Frame-Options', resp)

    def test_never_creates_a_client_portal_session(self):
        invoice = make_invoice(self.user, client=self.portal_client)
        InvoiceItem.objects.create(invoice=invoice, description='Work', quantity=Decimal('1'), unit_price=Decimal('100'))
        self.assertEqual(ClientPortalSession.objects.count(), 0)

        resp = self.client.get(reverse('invoices:invoice_preview_as_client', kwargs={'pk': invoice.pk}))
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(ClientPortalSession.objects.count(), 0)
        self.assertNotIn(PORTAL_SESSION_COOKIE_NAME, resp.cookies)

    def test_never_logs_a_view_event_or_changes_status(self):
        invoice = make_invoice(self.user, client=self.portal_client, status='sent', sent_at='2026-01-01T00:00:00Z')
        InvoiceItem.objects.create(invoice=invoice, description='Work', quantity=Decimal('1'), unit_price=Decimal('100'))

        self.client.get(reverse('invoices:invoice_preview_as_client', kwargs={'pk': invoice.pk}))

        invoice.refresh_from_db()
        self.assertEqual(invoice.status, 'sent')
        self.assertEqual(InvoiceViewEvent.objects.filter(invoice=invoice).count(), 0)

    def test_rejects_a_one_time_client_invoice_with_a_clear_error(self):
        invoice = make_invoice(self.user, client=None, is_one_time_client=True)
        resp = self.client.get(reverse('invoices:invoice_preview_as_client', kwargs={'pk': invoice.pk}))
        self.assertEqual(resp.status_code, 400)
        self.assertIn('one-time', resp.json()['error'].lower())

    def test_never_reachable_for_another_freelancers_invoice(self):
        other_user = User.objects.create_user(email='other@example.com', password='Sup3r$ecret1')
        their_invoice = make_invoice(other_user)
        resp = self.client.get(reverse('invoices:invoice_preview_as_client', kwargs={'pk': their_invoice.pk}))
        self.assertEqual(resp.status_code, 404)

    def test_uses_real_browser_fetchable_font_urls_not_file(self):
        """
        MOVED here (frozen-PDF-vs-live-render rework, see DECISIONS.md):
        render_invoice_portal_html/build_portal_context's own real,
        browser-fetchable font URLs (never file://, WeasyPrint's own
        scheme) are only exercised by invoice_preview_as_client now —
        portal_invoice_view_html no longer calls this generator at all.
        The generator function itself is unchanged; only which endpoint
        reaches it changed.
        """
        invoice = make_invoice(self.user, client=self.portal_client)
        InvoiceItem.objects.create(invoice=invoice, description='Work', quantity=Decimal('1'), unit_price=Decimal('100'))
        resp = self.client.get(reverse('invoices:invoice_preview_as_client', kwargs={'pk': invoice.pk}))
        html = resp.content.decode()
        self.assertIn('/static/invoices/fonts/', html)
        import re
        self.assertEqual(re.findall(r"url\([^)]*file://[^)]*\)", html), [])

    def test_page_is_centered_with_a_pdf_viewer_style_wrapper(self):
        """MOVED here — see test_uses_real_browser_fetchable_font_urls_not_file's own comment above for why."""
        invoice = make_invoice(self.user, client=self.portal_client)
        InvoiceItem.objects.create(invoice=invoice, description='Work', quantity=Decimal('1'), unit_price=Decimal('100'))
        resp = self.client.get(reverse('invoices:invoice_preview_as_client', kwargs={'pk': invoice.pk}))
        html = resp.content.decode()
        self.assertIn('max-width: 210mm', html)
        self.assertIn('margin: 32px auto', html)
        self.assertEqual(html.count('</head>'), 1)


# ══════════════════════════════════════════════════════════════════
# "View Invoice Online" email link
# ══════════════════════════════════════════════════════════════════

class ViewOnlineLinkTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(email='freelancer@example.com', password='Sup3r$ecret1')
        self.client_obj = make_client(self.user)

    def test_send_email_includes_the_real_portal_view_url(self):
        from apps.invoices.email_service import build_invoice_send_email
        invoice = make_invoice(self.user, client=self.client_obj)
        subject, html, plain = build_invoice_send_email(invoice)
        self.assertIn(invoice.portal_view_url, html)
        self.assertIn(invoice.portal_view_url, plain)
        self.assertIn('/invoice/', invoice.portal_view_url)
        self.assertIn(invoice.view_token, invoice.portal_view_url)

    def test_every_reminder_tier_includes_the_link(self):
        from apps.invoices.email_service import build_reminder_email
        invoice = make_invoice(self.user, client=self.client_obj, due_date=date(2026, 1, 1))
        for reminder_number in (1, 2, 3, 4):
            with self.subTest(reminder_number=reminder_number):
                subject, html, plain = build_reminder_email(invoice, reminder_number)
                self.assertIn(invoice.portal_view_url, html)
                self.assertIn(invoice.portal_view_url, plain)

    def test_portal_view_url_uses_frontend_url_not_the_raw_api_host(self):
        """
        REVERSED (real frontend-domain invoice view page — see
        DECISIONS.md): this used to pin down the OPPOSITE, deliberately —
        the raw backend/API host was the correct destination back when
        the invoice VIEW had no React route of its own at all. Now that
        InvoiceView.jsx (/invoice/:token) exists as a real frontend page,
        a client should see the actual product domain in their address
        bar, never api.lanceraos.com. settings.BACKEND_URL itself was
        removed entirely (this was its only real consumer) rather than
        left defined-but-unused — see DECISIONS.md.
        """
        from django.conf import settings
        invoice = make_invoice(self.user, client=self.client_obj)
        self.assertTrue(invoice.portal_view_url.startswith(settings.FRONTEND_URL))
        self.assertNotIn('/api/', invoice.portal_view_url)
        self.assertIn(f'/invoice/{invoice.view_token}/', invoice.portal_view_url)
