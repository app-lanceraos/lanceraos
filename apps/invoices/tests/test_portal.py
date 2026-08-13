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

from django.core.cache import cache
from django.middleware.csrf import get_token
from django.test import Client as DjangoTestClient
from django.test import RequestFactory, TestCase
from django.urls import reverse

from apps.clients.cookies import PORTAL_SESSION_COOKIE_NAME
from apps.clients.models import Client as ClientModel
from apps.clients.models import ClientPortalSession
from apps.invoices.models import Invoice, InvoiceItem, InvoiceViewEvent
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
    def test_unknown_token_is_a_real_404(self):
        resp = self._get(reverse('invoices:portal_invoice_view_html', kwargs={'view_token': 'never-issued'}))
        self.assertEqual(resp.status_code, 404)

    def test_renders_real_html_with_browser_fetchable_font_urls_not_file(self):
        invoice = self._invoice_for(self.portal_client)
        resp = self._get(reverse('invoices:portal_invoice_view_html', kwargs={'view_token': invoice.view_token}))
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp['Content-Type'].startswith('text/html'))
        html = resp.content.decode()
        self.assertIn('/static/invoices/fonts/', html)
        # A bare 'file://' substring check would false-positive on the
        # templates' own CSS comment text explaining WHY the PDF path
        # uses file:// — the real assertion is that no @font-face src
        # actually uses one.
        import re
        self.assertEqual(re.findall(r"url\([^)]*file://[^)]*\)", html), [])

    def test_saved_clients_invoice_mints_a_real_session(self):
        invoice = self._invoice_for(self.portal_client)
        self.assertEqual(ClientPortalSession.objects.filter(client=self.portal_client).count(), 0)

        resp = self._get(reverse('invoices:portal_invoice_view_html', kwargs={'view_token': invoice.view_token}))
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(ClientPortalSession.objects.filter(client=self.portal_client).count(), 1)
        self.assertIn(PORTAL_SESSION_COOKIE_NAME, resp.cookies)

    def test_one_time_clients_invoice_creates_no_session(self):
        invoice = self._invoice_for(client_obj=None, client_name='One-Timer', client_email='onetime@example.com', is_one_time_client=True)
        self.assertIsNone(invoice.client_id)

        resp = self._get(reverse('invoices:portal_invoice_view_html', kwargs={'view_token': invoice.view_token}))
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(ClientPortalSession.objects.count(), 0)
        self.assertNotIn(PORTAL_SESSION_COOKIE_NAME, resp.cookies)

    def test_a_second_one_time_invoice_for_the_same_email_is_not_reachable_via_the_first_ones_visit(self):
        """No Client row, no session — a one-time client's access never generalizes beyond its own view_token."""
        invoice_a = self._invoice_for(client_obj=None, client_name='Repeat Buyer', client_email='repeat@example.com', is_one_time_client=True)
        invoice_b = self._invoice_for(client_obj=None, client_name='Repeat Buyer', client_email='repeat@example.com', is_one_time_client=True)

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

    def _sent_invoice(self):
        invoice = make_invoice(self.user, status='sent', sent_at='2026-01-01T00:00:00Z', client=self.portal_client)
        InvoiceItem.objects.create(invoice=invoice, description='Work', quantity=Decimal('1'), unit_price=Decimal('100'))
        return invoice

    def test_a_real_client_view_transitions_sent_to_viewed_and_logs_an_event(self):
        invoice = self._sent_invoice()
        resp = self.client.get(reverse('invoices:portal_invoice_view_html', kwargs={'view_token': invoice.view_token}))
        self.assertEqual(resp.status_code, 200)

        invoice.refresh_from_db()
        self.assertEqual(invoice.status, 'viewed')
        self.assertEqual(InvoiceViewEvent.objects.filter(invoice=invoice).count(), 1)
        event = InvoiceViewEvent.objects.get(invoice=invoice)
        self.assertEqual(event.source, 'platform_view')

    def test_freelancer_previewing_with_both_cookies_present_suppresses_both_side_effects(self):
        invoice = self._sent_invoice()
        self._login_as_freelancer()  # a real, valid apps.users session cookie
        ClientPortalSession.create_for_client(self.portal_client, 'preview-raw-tok', device_name='', ip_address=None, user_agent='')
        self.client.cookies[PORTAL_SESSION_COOKIE_NAME] = 'preview-raw-tok'  # ALSO a valid portal session

        resp = self.client.get(reverse('invoices:portal_invoice_view_html', kwargs={'view_token': invoice.view_token}))
        self.assertEqual(resp.status_code, 200)

        invoice.refresh_from_db()
        self.assertEqual(invoice.status, 'sent')  # unchanged — not advanced to 'viewed'
        self.assertEqual(InvoiceViewEvent.objects.filter(invoice=invoice).count(), 0)

    def test_freelancer_session_alone_with_no_portal_session_still_tracks_normally(self):
        """A freelancer's OWN session with no portal-session cookie at all is not the preview scenario — matches an ordinary anonymous client view since is_freelancer_previewing_portal requires BOTH."""
        invoice = self._sent_invoice()
        self._login_as_freelancer()

        resp = self.client.get(reverse('invoices:portal_invoice_view_html', kwargs={'view_token': invoice.view_token}))
        self.assertEqual(resp.status_code, 200)

        invoice.refresh_from_db()
        self.assertEqual(invoice.status, 'viewed')
        self.assertEqual(InvoiceViewEvent.objects.filter(invoice=invoice).count(), 1)

    def test_view_on_a_non_sent_status_still_logs_the_event_but_does_not_change_status(self):
        invoice = make_invoice(self.user, status='paid', sent_at='2026-01-01T00:00:00Z', client=self.portal_client, amount_paid=Decimal('100.00'))
        InvoiceItem.objects.create(invoice=invoice, description='Work', quantity=Decimal('1'), unit_price=Decimal('100'))

        self.client.get(reverse('invoices:portal_invoice_view_html', kwargs={'view_token': invoice.view_token}))

        invoice.refresh_from_db()
        self.assertEqual(invoice.status, 'paid')
        self.assertEqual(InvoiceViewEvent.objects.filter(invoice=invoice).count(), 1)


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
        self.assertIn('/api/invoices/portal/view/', invoice.portal_view_url)
        self.assertIn(invoice.view_token, invoice.portal_view_url)

    def test_every_reminder_tier_includes_the_link(self):
        from apps.invoices.email_service import build_reminder_email
        invoice = make_invoice(self.user, client=self.client_obj, due_date=date(2026, 1, 1))
        for reminder_number in (1, 2, 3, 4):
            with self.subTest(reminder_number=reminder_number):
                subject, html, plain = build_reminder_email(invoice, reminder_number)
                self.assertIn(invoice.portal_view_url, html)
                self.assertIn(invoice.portal_view_url, plain)

    def test_portal_view_url_uses_backend_url_not_frontend_url(self):
        from django.conf import settings
        invoice = make_invoice(self.user, client=self.client_obj)
        self.assertTrue(invoice.portal_view_url.startswith(settings.BACKEND_URL))
        self.assertFalse(invoice.portal_view_url.startswith(settings.FRONTEND_URL))
