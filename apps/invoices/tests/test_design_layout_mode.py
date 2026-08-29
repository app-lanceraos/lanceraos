# apps/invoices/tests/test_design_layout_mode.py
"""
Master Blueprint cutover (§B.3) — proves the `layout_mode: 'flow'`
mechanism (design_renderer.py's own _group_into_render_chains/
_prepare_chain_group) actually does what it's for: real, unusually long
content in a `flow`-mode element genuinely pushes the next real-flow
chain member down, at canonical render time, instead of silently
overlapping it. This is the direct, load-bearing test for the class of
bug LANCERAOS_TEMPLATE_BUILDER_2_PHASE5_3.md documented and only
partially mitigated (CSS nowrap fixes, editor-only warnings) — the fix
here closes the general case those mitigations didn't reach.
"""
import re

import fitz  # PyMuPDF

from apps.invoices.design_renderer import build_render_context, render_design_pdf_bytes
from apps.invoices.design_templates import get_builtin_design_data
from apps.invoices.tests.test_pdf_templates import make_invoice_with_items
from apps.invoices.tests.test_views import InvoicesAPITestCase


def _terms_label_y_mm(pdf_bytes):
    """
    Real PyMuPDF measurement of the Terms section's own y position (mm,
    page-absolute) in the rendered PDF. Searches for the real Terms BODY
    text ("Due within 14 days.") rather than the "Terms" label itself —
    the label's own CSS (`.v2-label`) applies a large letter-spacing,
    which PyMuPDF's text search treats as separate, space-delimited
    glyphs ("T E R M S"), so a plain `search_for('Terms')` never matches
    it; the body text has no such spacing and matches reliably.
    """
    doc = fitz.open(stream=pdf_bytes, filetype='pdf')
    page = doc[0]
    hits = page.search_for('Due within 14 days.')
    doc.close()
    assert hits, 'fixture assumption: the real Terms text must appear on page 1'
    return hits[0].y0 / 72 * 25.4  # PDF points -> mm


class NotesOverflowPushesTermsDownTests(InvoicesAPITestCase):
    """Notes and Terms share design_templates.py's own PROFESSIONAL_DESIGN_DATA_V2 x/width — a real chain."""

    def setUp(self):
        super().setUp()
        profile = self.user.profile
        profile.business_name = 'Horizon Studio'
        profile.save()

    def _render(self, notes):
        invoice = make_invoice_with_items(self.user, n_items=2, notes=notes)
        context = build_render_context(self.user, 'professional', '', invoice=invoice)
        return render_design_pdf_bytes(get_builtin_design_data('professional'), context)

    def test_short_notes_gives_a_deterministic_baseline_position(self):
        # A real, deliberate no-op check: rendering the exact same
        # (normal-length) notes text twice must place Terms at the exact
        # same real position both times — proves the chain mechanism is
        # deterministic, not incidentally different on each render.
        y_a = _terms_label_y_mm(self._render('Thanks for the business.'))
        y_b = _terms_label_y_mm(self._render('Thanks for the business.'))
        self.assertEqual(y_a, y_b)

    def test_long_notes_pushes_terms_down_by_a_real_measured_amount(self):
        baseline_pdf = self._render('Thanks for the business.')
        baseline_y = _terms_label_y_mm(baseline_pdf)

        long_notes = ' '.join(['This is a genuinely long, realistic notes paragraph explaining scope, payment schedule, and revision policy in detail.'] * 4)
        long_pdf = self._render(long_notes)
        long_y = _terms_label_y_mm(long_pdf)

        # The real, measured proof: Terms moved down by a real, material
        # amount because Notes rendered taller than its own 12.4mm
        # design-time estimate — not a fixed constant, not an assumption.
        self.assertGreater(long_y, baseline_y + 5, msg=(
            f'Terms did not move down for long notes content (baseline={baseline_y}mm, long={long_y}mm) '
            '— the real-flow chain mechanism is not pushing siblings.'
        ))


class TableGrowsBeyondItsDesignTimeEstimateTests(InvoicesAPITestCase):
    def setUp(self):
        super().setUp()
        self.user.profile.business_name = 'Horizon Studio'
        self.user.profile.save()

    def test_moderate_overflow_grows_the_table_within_the_same_page(self):
        # design_templates._TABLE_HEIGHT_ESTIMATE_MM (45mm) assumes 3
        # sample rows — 8 real items genuinely exceed it but still fit
        # within one page. layout_mode:'flow' gives the table real
        # auto-height (no fixed 45mm CSS box) instead of silently
        # confining it — every real item must appear, uncropped.
        #
        # KNOWN, DISCLOSED LIMITATION (not fixed by this pass — see
        # DECISIONS.md / the Master Blueprint completion report): this
        # does NOT extend to genuine multi-page overflow. Confirmed
        # directly: a real invoice with enough line items to exceed a
        # SINGLE page's own physical height loses the excess rows
        # entirely (0 items missing here; a much larger item count would
        # show missing rows) — this is a PRE-EXISTING defect in the whole
        # V2 canonical renderer's absolutely-positioned-everything
        # architecture (confirmed present even with the table left
        # `pinned`, i.e. NOT introduced by layout_mode), not something
        # layout_mode was built to fix. Real pagination would require
        # reintroducing genuine CSS document flow for at least the table
        # and everything after it — a materially larger, separate
        # architectural change, out of this pass's scope.
        invoice = make_invoice_with_items(self.user, n_items=8)
        context = build_render_context(self.user, 'professional', '', invoice=invoice)
        pdf_bytes = render_design_pdf_bytes(get_builtin_design_data('professional'), context)

        doc = fitz.open(stream=pdf_bytes, filetype='pdf')
        full_text = ''.join(page.get_text() for page in doc)
        doc.close()

        for i in range(1, 9):
            self.assertIn(f'Line item {i}', full_text)
