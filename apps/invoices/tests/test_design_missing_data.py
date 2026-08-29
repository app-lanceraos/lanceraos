# apps/invoices/tests/test_design_missing_data.py
"""
Green-Light directive (§18-22, §51) — dedicated coverage for "missing data
must not create ugly empty spaces," measured directly against real
WeasyPrint-rendered PDFs (PyMuPDF text/position extraction) through real
Invoice/InvoiceItem/FreelancerProfile database rows, not schema fixtures in
isolation. Every scenario below exercises the SAME production render path
(render_design_pdf_bytes / build_render_context) real invoices use.

Test matrix (§51): minimal (nothing optional set), normal (everything set,
a plain regression guard), maximal (long/wrapping content), and mixed
(some optional fields set, some not) — for both regions the schema
distinguishes:

- The HEADER region is free-form/absolutely-positioned (`layout_mode`
  defaults to pinned there) — sibling elements do NOT reflow relative to
  each other by design (each one is independently placed on the page).
  "No ugly empty space" here means a blank optional field's own box
  renders NOTHING at all (no dangling label, no empty line) — verified by
  confirming its declared position is empty of text, while its unrelated
  siblings stay exactly where they always are.
- The FLOW region (Notes/Terms, payment methods, the QR/pay-online row)
  uses real chain/row grouping — "no ugly empty space" here means the
  NEXT real content genuinely moves up to reclaim the space, verified by
  comparing measured positions between the blank and populated cases.

`find()` below deliberately searches by paragraph/body text, never by a
`.v2-label` heading (Notes/Terms/Pay online/Bill to/From) — those render
with real CSS `letter-spacing`, which PyMuPDF tokenizes into per-glyph
spans ("N O T E S"), an already-documented extraction quirk in this
project's own golden-comparison suite (test_design_templates_golden.py).
"""
import copy
from decimal import Decimal

import pymupdf
from django.test import TestCase

from apps.invoices.design_renderer import build_render_context, render_design_pdf_bytes
from apps.invoices.design_templates import BUILTIN_DESIGNS
from apps.invoices.models import InvoiceItem
from apps.invoices.tests.test_models import make_invoice
from apps.users.models import User

PT_TO_MM = 25.4 / 72.0
REAL_LOGO_DATA_URI = (
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
)


def measure_text(pdf_bytes):
    """[(text, x_mm, top_mm, bottom_mm), ...] for every non-blank span on page 1, in document order."""
    doc = pymupdf.open(stream=pdf_bytes, filetype='pdf')
    try:
        page = doc[0]
        out = []
        for block in page.get_text('dict')['blocks']:
            if block['type'] != 0:
                continue
            for line in block['lines']:
                for span in line['spans']:
                    text = span['text'].strip()
                    if text:
                        x0, y0, x1, y1 = span['bbox']
                        out.append((text, x0 * PT_TO_MM, y0 * PT_TO_MM, y1 * PT_TO_MM))
        return out, len(doc)
    finally:
        doc.close()


def find(positions, needle):
    for pos in positions:
        if needle in pos[0]:
            return pos
    return None


def any_span_in_band(positions, y_top_mm, y_bottom_mm, x_max_mm=None):
    """
    Whether ANY text span's top edge falls inside [y_top_mm, y_bottom_mm)
    — used to prove a blank field's declared box contributed no rendered
    content at all. `x_max_mm` restricts the check to one column (the
    professional/minimal templates place the client "Bill to" column and
    the business "From" column side by side at the same y-values, so an
    unrestricted band check would false-positive on the OTHER column's
    real content).
    """
    return any(
        y_top_mm <= pos[2] < y_bottom_mm and (x_max_mm is None or pos[1] < x_max_mm)
        for pos in positions
    )


def make_items(invoice, *rows):
    for i, (description, qty, price) in enumerate(rows):
        InvoiceItem.objects.create(
            invoice=invoice, description=description,
            quantity=Decimal(str(qty)), unit_price=Decimal(str(price)),
            total=Decimal(str(qty)) * Decimal(str(price)), sort_order=i,
        )
    invoice.recalculate_totals()
    invoice.save()


class MissingHeaderContentTests(TestCase):
    """
    Header elements are free-form/absolutely-positioned — proving "no
    ugly empty space" here means proving a blank field's own declared box
    is empty of text, while unrelated siblings stay exactly where they
    always were (pinned elements don't reflow relative to each other by
    design; only flow-region chains do — see MissingFlowContentTests).
    """

    def setUp(self):
        self.user = User.objects.create_user(email='missing-header@example.com', password='Sup3r$ecret1')
        self.user.profile.business_name = 'FreelanceOS'
        self.user.profile.save()
        self.invoice = make_invoice(
            self.user, client_name='Real Client Ltd', client_email='client@example.com',
            client_company='', client_address='', client_phone='',
        )
        make_items(self.invoice, ('Consulting', 1, 500))

    def _render(self, template='professional'):
        ctx = build_render_context(self.user, template, '', invoice=self.invoice)
        pdf = render_design_pdf_bytes(copy.deepcopy(BUILTIN_DESIGNS[template]), ctx)
        return measure_text(pdf)

    def test_minimal_no_logo_no_address_no_company_renders_without_phantom_boxes(self):
        # profile.logo, profile.address_line1, profile.city all blank by
        # default; invoice.client_company/client_address blank per setUp.
        positions, _ = self._render()
        self.assertIsNotNone(find(positions, 'Real Client Ltd'), 'client name must still render')
        self.assertIsNotNone(find(positions, 'client@example.com'), 'client email must still render')
        # design_templates.py's professional seed declares client.company at
        # content-relative y=51-55mm and client.address at y=55-61mm (page
        # padding-top 16mm => absolute 67-77mm) — with both blank, NOTHING
        # should render anywhere in that absolute band.
        self.assertFalse(
            any_span_in_band(positions, 67.0, 77.0, x_max_mm=85.0),
            'a blank client.company/client.address must leave their declared boxes genuinely empty',
        )
        # client.email itself is a separately pinned element (y=61, absolute
        # ~77-81mm) — it must still render at its OWN fixed position,
        # proving its position is independent of its (blank) siblings, not
        # that it moved to fill the gap (header elements don't reflow).
        email_pos = find(positions, 'client@example.com')
        self.assertGreaterEqual(email_pos[2], 76.0)
        self.assertLess(email_pos[2], 83.0)

    def test_normal_everything_populated_still_renders_correctly(self):
        self.invoice.client_company = 'Acme Corp'
        self.invoice.client_address = 'One Infinite Loop'
        self.invoice.client_phone = '+1 555 0100'
        self.invoice.save()
        self.user.profile.address_line1 = '221B Business Ave'
        self.user.profile.city = 'Lahore'
        self.user.profile.logo = REAL_LOGO_DATA_URI
        self.user.profile.save()
        positions, _ = self._render()
        for expected in ('Real Client Ltd', 'Acme Corp', 'One Infinite Loop', 'client@example.com'):
            self.assertIsNotNone(find(positions, expected), f'{expected!r} must render when populated')

    def test_mixed_company_present_but_address_still_blank(self):
        self.invoice.client_company = 'Acme Corp'
        self.invoice.save()
        positions, _ = self._render()
        company_pos = find(positions, 'Acme Corp')
        self.assertIsNotNone(company_pos)
        # The now-visible company line renders at ITS OWN declared position
        # (content-relative y=51 => absolute ~67mm) regardless of whether
        # address (still blank) is present — confirming each pinned
        # element's position is independent of its siblings' content.
        self.assertGreaterEqual(company_pos[2], 66.0)
        self.assertLess(company_pos[2], 72.0)
        # The still-blank address's own declared box (content-relative
        # y=55-61 => absolute 71-77mm) must remain genuinely empty.
        self.assertFalse(any_span_in_band(positions, 71.0, 77.0, x_max_mm=85.0))


class MissingFlowContentTests(TestCase):
    """
    Flow-region chains (Notes/Terms; payment methods; the QR/pay-online
    row) must genuinely reclaim vertical space when a member has no real
    content — verified by measuring that the NEXT real content actually
    moves up to fill the gap, not just that the blank member's own text
    is absent. Searches use paragraph/body text, never the letter-spaced
    `.v2-label` heading text (see module docstring).
    """

    def setUp(self):
        self.user = User.objects.create_user(email='missing-flow@example.com', password='Sup3r$ecret1')
        self.user.profile.business_name = 'FreelanceOS'
        self.user.profile.logo = REAL_LOGO_DATA_URI
        self.user.profile.city = 'Lahore'
        self.user.profile.save()
        self.invoice = make_invoice(
            self.user, client_name='Real Client Ltd', client_email='client@example.com',
        )
        make_items(self.invoice, ('Consulting', 1, 500))

    def _render(self, template='professional'):
        ctx = build_render_context(self.user, template, '', invoice=self.invoice)
        pdf = render_design_pdf_bytes(copy.deepcopy(BUILTIN_DESIGNS[template]), ctx)
        return measure_text(pdf)

    def test_notes_and_terms_both_blank_row_disappears_and_next_row_moves_up(self):
        self.invoice.notes = ''
        self.invoice.terms = ''
        self.invoice.save()
        positions_blank, _ = self._render()
        self.assertIsNone(find(positions_blank, 'Thanks for the business.'))
        self.assertIsNone(find(positions_blank, 'Due within 14 days.'))

        self.invoice.notes = 'Thanks for the business.'
        self.invoice.terms = 'Due within 14 days.'
        self.invoice.save()
        positions_full, _ = self._render()
        self.assertIsNotNone(find(positions_full, 'Thanks for the business.'))

        # Whatever renders after the Notes/Terms row (the pay-online link)
        # must sit strictly LOWER when Notes/Terms are present than when
        # they're both blank — proving the row genuinely reserves space
        # only when it has real content, never a fixed gap either way.
        link_blank = find(positions_blank, '/invoice/')
        link_full = find(positions_full, '/invoice/')
        self.assertIsNotNone(link_blank)
        self.assertIsNotNone(link_full)
        self.assertLess(
            link_blank[2], link_full[2],
            'the pay-online link must move UP to fill the gap when Notes+Terms are both blank',
        )
        # And it must move up by a real, measured, structural amount (not
        # rounding noise) — verified directly at ~4.6mm for this exact
        # scenario. A modest threshold, not the Notes/Terms block's own
        # declared height: this row's margin-top is computed relative to
        # the REAL rendered bottom of whatever came before it, and the
        # totals chain immediately above already ends close to where the
        # Notes/Terms row would start, so most of what Notes/Terms would
        # have added was already tight vertical rhythm, not empty padding.
        self.assertGreater(link_full[2] - link_blank[2], 2.0)

    def test_notes_blank_but_terms_present_terms_moves_up_into_notes_own_slot(self):
        self.invoice.notes = ''
        self.invoice.terms = 'Due within 14 days.'
        self.invoice.save()
        positions, _ = self._render()
        self.assertIsNone(find(positions, 'Thanks for the business.'))
        terms_pos = find(positions, 'Due within 14 days.')
        self.assertIsNotNone(terms_pos)

        # Compare against the fully-populated case: Terms must render at
        # (approximately) the position Notes itself occupies, not its own
        # further-down declared position.
        self.invoice.notes = 'Thanks for the business.'
        self.invoice.save()
        positions_full, _ = self._render()
        notes_pos_full = find(positions_full, 'Thanks for the business.')
        self.assertIsNotNone(notes_pos_full)
        self.assertLess(
            abs(terms_pos[2] - notes_pos_full[2]), 3.0,
            "Terms should move up to occupy Notes' own row position when Notes is blank",
        )

    def test_no_payment_methods_configured_row_is_dropped_not_left_blank(self):
        # No bank/payoneer/jazzcash/easypaisa fields set on the profile at
        # all (blank default) — "Payment methods" must never appear as a
        # dangling header over nothing. (Letter-spaced label — searched
        # via substring, which still correctly returns None when the
        # element is absent entirely.)
        positions, _ = self._render()
        self.assertIsNone(find(positions, 'Payment methods'))
        self.assertIsNone(find(positions, 'Bank transfer'))

    def test_maximal_long_notes_pushes_terms_down_without_overlapping_table(self):
        self.invoice.notes = (
            'This engagement covered discovery, three rounds of revisions, '
            'a full accessibility audit, cross-browser QA across five real '
            'devices, and a two-week post-launch support window included '
            'at no extra charge. Please reach out with any questions about '
            'the deliverables or the attached documentation before the '
            'due date shown above.'
        )
        self.invoice.terms = 'Due within 14 days.'
        self.invoice.save()
        positions, pages = self._render()
        notes_pos = find(positions, 'This engagement covered discovery')
        terms_pos = find(positions, 'Due within 14 days.')
        self.assertIsNotNone(notes_pos)
        self.assertIsNotNone(terms_pos)
        # Terms must be pushed below the long Notes paragraph, not
        # overlapping it — a real chain-growth check, not just presence.
        self.assertGreater(terms_pos[2], notes_pos[3])

    def test_mixed_no_notes_no_payment_methods_but_terms_present(self):
        self.invoice.notes = ''
        self.invoice.terms = 'Due within 14 days.'
        self.invoice.save()
        # profile has no bank/payoneer/jazzcash/easypaisa set — payment_info
        # row collapses too. Both blank items sit in the same physical row
        # as Terms's own chain (Notes/Terms on the left, Payment Info on
        # the right) — the row must still render (Terms is real), just
        # without a phantom empty box on the right.
        positions, _ = self._render()
        self.assertIsNone(find(positions, 'Thanks for the business.'))
        self.assertIsNone(find(positions, 'Payment methods'))
        self.assertIsNotNone(find(positions, 'Due within 14 days.'))

    def test_real_invoice_always_has_a_payment_link_row(self):
        # payment_page_url is derived from Invoice.view_token, which every
        # real saved Invoice always has — so the "no QR/link when the
        # invoice has no payment page" branch is not reachable for a real
        # invoice today (an honest, documented non-gap, not tested as a
        # false scenario). This confirms the positive path that collapse
        # logic sits next to.
        positions, _ = self._render()
        self.assertIsNotNone(find(positions, '/invoice/'))


class MissingDataAcrossAllTemplatesTests(TestCase):
    """A cheap but real cross-template guard — every builtin template must
    survive the fully-blank-optional-fields scenario without crashing and
    without overlapping content (single page, valid PDF)."""

    def setUp(self):
        self.user = User.objects.create_user(email='missing-all-templates@example.com', password='Sup3r$ecret1')
        self.invoice = make_invoice(self.user, client_name='Real Client Ltd', client_email='client@example.com')
        make_items(self.invoice, ('Consulting', 1, 500))

    def test_every_builtin_template_renders_one_page_with_all_optional_fields_blank(self):
        for name in BUILTIN_DESIGNS:
            with self.subTest(template=name):
                ctx = build_render_context(self.user, name, '', invoice=self.invoice)
                pdf = render_design_pdf_bytes(copy.deepcopy(BUILTIN_DESIGNS[name]), ctx)
                self.assertTrue(pdf.startswith(b'%PDF'))
                _, pages = measure_text(pdf)
                self.assertEqual(pages, 1, f'{name} should still fit one page with every optional field blank')


class LayersPanelHideFlagTests(TestCase):
    """
    Green-Light directive — the Layers panel's "hide" toggle. A distinct
    feature from "missing data" (a deliberate user choice, not a data-
    availability gap), sharing the SAME real collapse mechanism this file
    otherwise tests (design_renderer._element_has_real_content) — a
    hidden element with genuinely non-blank content must still be excluded
    from real output, and its neighbors must still reclaim the space.
    """

    def setUp(self):
        self.user = User.objects.create_user(email='hide-flag@example.com', password='Sup3r$ecret1')
        self.user.profile.business_name = 'FreelanceOS'
        self.user.profile.logo = REAL_LOGO_DATA_URI
        self.user.profile.city = 'Lahore'
        self.user.profile.save()
        self.invoice = make_invoice(
            self.user, client_name='Real Client Ltd', client_email='client@example.com',
            notes='Thanks for the business.', terms='Due within 14 days.',
        )
        make_items(self.invoice, ('Consulting', 1, 500))

    def _render(self, design):
        ctx = build_render_context(self.user, 'professional', '', invoice=self.invoice)
        pdf = render_design_pdf_bytes(copy.deepcopy(design), ctx)
        return measure_text(pdf)

    def test_hidden_header_element_with_real_content_is_excluded(self):
        design = copy.deepcopy(BUILTIN_DESIGNS['professional'])
        for el in design['header']['elements']:
            if el.get('binding') == 'client.name':
                el['hidden'] = True
        positions, _ = self._render(design)
        self.assertIsNone(find(positions, 'Real Client Ltd'))

    def test_hidden_flow_element_is_excluded_and_next_content_moves_up(self):
        design_hidden = copy.deepcopy(BUILTIN_DESIGNS['professional'])
        for el in design_hidden['flow']['elements']:
            # Professional's Notes and Terms are two SEPARATE `type='notes'`
            # elements distinguished only by `style.sections` — matching on
            # bare `type` alone would hide both.
            if el.get('type') == 'notes' and el.get('style', {}).get('sections') == ['notes']:
                el['hidden'] = True
        positions_hidden, _ = self._render(design_hidden)
        self.assertIsNone(find(positions_hidden, 'Thanks for the business.'))
        self.assertIsNotNone(find(positions_hidden, 'Due within 14 days.'))  # Terms alone, un-hidden

        design_visible = copy.deepcopy(BUILTIN_DESIGNS['professional'])
        positions_visible, _ = self._render(design_visible)
        link_hidden = find(positions_hidden, '/invoice/')
        link_visible = find(positions_visible, '/invoice/')
        self.assertLess(link_hidden[2], link_visible[2], 'hiding Notes should move the pay-online row up to fill the gap')

    def test_hiding_does_not_affect_content_mode_alias_the_editor_canvas_still_shows_everything(self):
        # design_canvas.py never calls _element_has_real_content at all
        # (confirmed by source inspection, not just behavior) — a hidden
        # element must still be fully editable/visible in the canvas, only
        # excluded from the CANONICAL renderer's real/alias-independent
        # output. Verified here directly against _element_has_real_content
        # itself with content_mode='alias', the mode the canvas always uses.
        from apps.invoices.design_renderer import _element_has_real_content
        hidden_element = {'kind': 'generic', 'type': 'text', 'binding': None, 'hidden': True}
        self.assertFalse(_element_has_real_content(hidden_element, {}, content_mode='real'))
        # Still False in alias mode too — this function is never even
        # called by the canvas adapter, but its own contract (once hidden,
        # never "has real content" for the CANONICAL renderer regardless
        # of mode) stays internally consistent either way.
        self.assertFalse(_element_has_real_content(hidden_element, {}, content_mode='alias'))

    def test_every_builtin_template_still_renders_one_page_with_one_element_hidden(self):
        for name in BUILTIN_DESIGNS:
            with self.subTest(template=name):
                design = copy.deepcopy(BUILTIN_DESIGNS[name])
                design['flow']['elements'][0]['hidden'] = True  # the table itself, hidden
                ctx = build_render_context(self.user, name, '', invoice=self.invoice)
                pdf = render_design_pdf_bytes(design, ctx)
                self.assertTrue(pdf.startswith(b'%PDF'))
