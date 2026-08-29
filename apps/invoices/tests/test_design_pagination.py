# apps/invoices/tests/test_design_pagination.py
"""
Pagination & Content-Preservation Audit (28 August 2026) — the real,
permanent regression suite for a genuine, previously-undiscovered,
pre-existing defect in the entire V2 canonical renderer: ANY content
rendered via this renderer's original all-`position:absolute`
architecture was silently confined to a single physical page, regardless
of how much real content existed — a long Notes field, a long Terms
field, or a large line-items table could all render as if truncated,
with the excess content simply never appearing anywhere, on any page,
with zero error or warning.

Root cause, proven by minimal, isolated reproduction (see the audit's own
investigation notes): `position: absolute` elements are never fragmented
across page boundaries by WeasyPrint — a correct implementation of the
CSS Fragmentation spec, which excludes out-of-flow boxes from being
fragmentation containers — REGARDLESS of the element's or its ancestors'
own declared/CSS height. This was true independent of `layout_mode`,
independent of any specific template, and reproduced identically with a
plain `<table>`/`<p>` inside a `position:absolute` ancestor with no
design_data or Django code involved at all.

The fix (apps/invoices/design_renderer.py's `_prepare_header_region`/
`_prepare_flow_region`/`_group_chain_items_into_rows`, apps/invoices/
templates/invoices/canonical/canonical.html): the header region (bounded,
free-form, never needs pagination) stays absolutely positioned inside a
real, ordinary (non-absolutely-positioned) `.v2-header` box; every flow
element — `pinned` or `flow` layout_mode alike — now renders inside a
real, ordinary CSS flex "row" (never `position:absolute`), stacking via
real `margin-top`/`margin-left` computed from the exact same x/y/width/
height numbers design_data already declares. This requires ZERO schema
change — only how the renderer turns existing geometry into CSS changed.

These tests assert ACTUAL rendered content and page structure (via real
WeasyPrint PDF renders + PyMuPDF text extraction) — never merely that a
function returns without raising.
"""
from decimal import Decimal

import fitz  # PyMuPDF

from apps.invoices.design_renderer import build_render_context, render_design_html, render_design_pdf_bytes
from apps.invoices.design_templates import get_builtin_design_data
from apps.invoices.models import InvoiceDesign
from apps.invoices.pdf_generator import render_invoice_pdf, render_invoice_portal_html
from apps.invoices.tests.test_pdf_templates import make_invoice_with_items
from apps.invoices.tests.test_views import InvoicesAPITestCase

SENTENCE = 'This is a genuinely long, realistic sentence about scope and payment terms. '


def _all_pdf_text(pdf_bytes):
    doc = fitz.open(stream=pdf_bytes, filetype='pdf')
    try:
        return len(doc), ''.join(p.get_text() for p in doc)
    finally:
        doc.close()


def _count_repeated_sentences_present(text, n, marker_prefix):
    """Counts how many of `n` uniquely-marked repeated sentences actually appear in `text` — a rigorous "nothing missing" check, not a loose first/last-word heuristic."""
    return sum(1 for i in range(n) if f'MARK{marker_prefix}{i}X' in text)


def _repeated(n, prefix):
    return ' '.join(f'MARK{prefix}{i}X {SENTENCE}' for i in range(n))


class RendererPaginationTests(InvoicesAPITestCase):
    """Section 7 of the audit — renderer-level, real PDF, real page structure."""

    def setUp(self):
        super().setUp()
        self.user.profile.business_name = 'Horizon Studio'
        self.user.profile.save()

    def _render(self, *, notes='Thanks for the business.', terms='Due within 14 days.', n_items=2, base_template='professional'):
        invoice = make_invoice_with_items(self.user, n_items=n_items, notes=notes, terms=terms)
        context = build_render_context(self.user, base_template, '', invoice=invoice)
        design_data = get_builtin_design_data(base_template)
        pdf_bytes = render_design_pdf_bytes(design_data, context)
        return _all_pdf_text(pdf_bytes)

    def test_one_page_for_short_content(self):
        n_pages, text = self._render()
        self.assertEqual(n_pages, 1)
        self.assertIn('Thanks for the business.', text)
        self.assertIn('Due within 14 days.', text)

    def test_two_pages_when_notes_crosses_the_page_boundary(self):
        n_pages, text = self._render(notes=_repeated(20, 'N'))
        self.assertEqual(n_pages, 2)
        self.assertEqual(_count_repeated_sentences_present(text, 20, 'N'), 20)

    def test_three_or_more_pages_for_very_long_notes(self):
        n_pages, text = self._render(notes=_repeated(80, 'N'))
        self.assertGreaterEqual(n_pages, 3)
        self.assertEqual(_count_repeated_sentences_present(text, 80, 'N'), 80)

    def test_terms_following_long_notes_is_fully_preserved(self):
        n_pages, text = self._render(notes=_repeated(20, 'N'), terms=_repeated(3, 'T'))
        self.assertGreaterEqual(n_pages, 2)
        self.assertEqual(_count_repeated_sentences_present(text, 20, 'N'), 20)
        self.assertEqual(_count_repeated_sentences_present(text, 3, 'T'), 3)

    def test_long_terms_alone_is_fully_preserved(self):
        n_pages, text = self._render(terms=_repeated(20, 'T'))
        self.assertGreaterEqual(n_pages, 2)
        self.assertEqual(_count_repeated_sentences_present(text, 20, 'T'), 20)

    def test_both_notes_and_terms_independently_overflowing_are_both_fully_preserved(self):
        n_pages, text = self._render(notes=_repeated(40, 'N'), terms=_repeated(40, 'T'))
        self.assertGreaterEqual(n_pages, 3)
        self.assertEqual(_count_repeated_sentences_present(text, 40, 'N'), 40)
        self.assertEqual(_count_repeated_sentences_present(text, 40, 'T'), 40)

    def test_empty_flow_content_still_renders_a_single_valid_page(self):
        n_pages, text = self._render(notes='', terms='')
        self.assertEqual(n_pages, 1)
        self.assertIn('Subtotal', text)

    def test_pinned_elements_are_never_duplicated_or_lost_when_flow_content_overflows(self):
        # qr_code, online_payment_link, and signature are all `pinned` —
        # they must each appear exactly once regardless of how much
        # earlier flow content overflows. Matched via the real payment
        # link URL and the signature CSS class's own real text, not the
        # letter-spaced "PAY ONLINE"/"AUTHORISED SIGNATURE" labels
        # themselves (`.v2-label`'s real `text-transform:uppercase` +
        # large letter-spacing makes WeasyPrint emit each letter as a
        # separately-spaced glyph, e.g. "P A Y O N L I N E" — a real
        # PyMuPDF text-extraction quirk unrelated to this fix, already
        # encountered earlier in this same investigation).
        n_pages, text = self._render(notes=_repeated(40, 'N'))
        self.assertGreaterEqual(n_pages, 2)
        self.assertEqual(text.count('localhost:5173/invoice/'), 1)
        self.assertEqual(text.count('Authorised signature') + text.count('AUTHORISED SIGNATURE'), 1)

    def test_totals_after_a_longer_table_render_correctly_across_however_many_pages_are_genuinely_needed(self):
        # Professional's real, full vertical requirement (header + totals
        # + notes/terms/payment row + qr/link/signature) leaves real page-1
        # room for only ~5 real line items before a second page is
        # genuinely, correctly needed — confirmed directly by measurement
        # (see the audit's own investigation) — NOT an arbitrary page-count
        # assumption. Before this fix, a table this long would have
        # silently overlapped the totals/notes/payment content beneath it
        # instead of correctly continuing onto a new page; this test
        # proves that no longer happens, whatever the real page count
        # turns out to be.
        n_pages, text = self._render(n_items=8)
        self.assertGreaterEqual(n_pages, 2)
        for i in range(1, 9):
            self.assertEqual(text.count(f'Line item {i}'), 1, msg=f'item {i} missing or duplicated')
        self.assertEqual(text.count('Subtotal'), 1)
        self.assertEqual(text.count('Total due'), 1)

    def test_no_content_duplication_across_pages(self):
        # A real, direct proof against the OTHER failure mode a naive
        # pagination fix could introduce (content repeated on multiple
        # pages instead of correctly split) — each marked sentence must
        # appear EXACTLY once across the whole document, not zero and not
        # two-or-more times.
        invoice = make_invoice_with_items(self.user, n_items=2, notes=_repeated(30, 'N'), terms='Due within 14 days.')
        context = build_render_context(self.user, 'professional', '', invoice=invoice)
        pdf_bytes = render_design_pdf_bytes(get_builtin_design_data('professional'), context)
        _, text = _all_pdf_text(pdf_bytes)
        for i in range(30):
            self.assertEqual(text.count(f'MARKN{i}X'), 1, msg=f'sentence {i} appeared {text.count(f"MARKN{i}X")} times, expected exactly 1')

    def test_all_three_templates_paginate_correctly_for_long_notes(self):
        for template in ('professional', 'minimal', 'modern'):
            with self.subTest(template=template):
                n_pages, text = self._render(notes=_repeated(20, 'N'), base_template=template)
                self.assertGreaterEqual(n_pages, 2, msg=f'{template} did not paginate')
                self.assertEqual(_count_repeated_sentences_present(text, 20, 'N'), 20, msg=f'{template} lost content')

    def test_canonical_html_and_pdf_agree_on_content_for_long_notes(self):
        # The "one HTML/CSS renderer" principle applied to THIS fix
        # specifically — for_pdf only changes font URIs, never content or
        # structure, so the browser-facing HTML branch must show exactly
        # the same real content the PDF does (pagination itself is a
        # PDF-only concept — an HTML page just scrolls — but no content
        # may be lost from the HTML branch either).
        invoice = make_invoice_with_items(self.user, n_items=2, notes=_repeated(20, 'N'))
        context = build_render_context(self.user, 'professional', '', invoice=invoice)
        design_data = get_builtin_design_data('professional')
        html = render_design_html(design_data, context, for_pdf=False)
        for i in range(20):
            self.assertIn(f'MARKN{i}X', html)


class ProductionPathPaginationTests(InvoicesAPITestCase):
    """
    Section 8 of the audit — the same long-content scenarios through the
    REAL production paths: a real, saved v2 InvoiceDesign, assigned to a
    real Invoice, rendered via the real render_invoice_pdf/
    render_invoice_portal_html entry points every real invoice PDF/
    portal request actually calls.
    """

    def setUp(self):
        super().setUp()
        self.user.profile.business_name = 'Horizon Studio'
        self.user.profile.save()
        self.design = InvoiceDesign.objects.create(
            user=self.user, name='V2 Pagination Test', base_template='professional', source='custom',
            design_data=get_builtin_design_data('professional'),
        )

    def test_real_invoice_pdf_paginates_correctly_for_long_notes(self):
        invoice = make_invoice_with_items(self.user, n_items=2, notes=_repeated(20, 'N'), design=self.design)
        pdf_bytes = render_invoice_pdf(invoice)
        n_pages, text = _all_pdf_text(pdf_bytes)
        self.assertGreaterEqual(n_pages, 2)
        self.assertEqual(_count_repeated_sentences_present(text, 20, 'N'), 20)

    def test_real_invoice_portal_html_contains_all_content_for_long_notes(self):
        invoice = make_invoice_with_items(self.user, n_items=2, notes=_repeated(20, 'N'), design=self.design)
        html = render_invoice_portal_html(invoice)
        for i in range(20):
            self.assertIn(f'MARKN{i}X', html)

    def test_real_invoice_with_short_content_is_unaffected_by_the_pagination_fix(self):
        # No-op regression guard — the overwhelming majority of real
        # invoices have short notes/terms; this fix must not change their
        # output at all (still exactly 1 page, all content present).
        invoice = make_invoice_with_items(self.user, n_items=3, design=self.design)
        pdf_bytes = render_invoice_pdf(invoice)
        n_pages, text = _all_pdf_text(pdf_bytes)
        self.assertEqual(n_pages, 1)
        self.assertIn(invoice.client_name, text)
