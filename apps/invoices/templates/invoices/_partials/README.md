# apps/invoices/templates/invoices/_partials/README.md

Convention for this directory (Template Gallery Foundation, 13 September 2026):

**Partials own shared structure. Templates own skin.**

`footer.html` is the first partial, extracted now because it is (a) genuinely
identical content/structure across all 3 static templates apart from one
per-template color value, and (b) it was being rewritten in this same pass
regardless (see DECISIONS.md's 13 September 2026 entry for the full footer
rule). It is included inside each template's own `@page { ... }` block via
`{% include "invoices/_partials/footer.html" with footer_text_color="#..." %}`
— the color is passed in per-template rather than hardcoded in the partial,
since each of the 3 templates keeps its own existing muted footer-text hue
(`#a09a89` / `#a3a099` / `#a8a5b8`).

A template with its own extra footer positioning needs (modern.html's 3
footer boxes need explicit `margin`/`width` to avoid colliding with the
full-bleed sidebar) declares those as additional `@bottom-left { margin:
...; width: ...; }` etc. rules directly AFTER the `{% include %}`, in its
own `<style>` block. CSS cascade rules make this safe: a later declaration
of the same at-rule only adds/overrides the specific properties it names,
it does not replace the partial's own `content`/`font-family`/`color`
declarations.

**The library grew during the 20-template import pass** (Batch 1,
14 September 2026), as planned below. The 9 shared HTML partials plus
`base_components.css` (a shared CSS-custom-property component stylesheet
— Part 0b of Batch 1 confirmed the prototype's own component CSS is
written once, generically, against 4 custom properties
`--ink`/`--accent`/`--muted`/`--rule`, byte-identical across both
`freeTemplates.html` and `proTemplates.html`) now live here:

- `brand_lockup.html`, `doc_block.html`, `meta_strip.html`,
  `parties_row.html` (optional `bill_to_only`/`wrap_class`),
  `items_table.html` (optional `show_sku`, structurally preserved but
  nothing sets it today — `InvoiceItem` has no real SKU field),
  `totals.html`, `notes_terms.html` — net-new, using the prototype's own
  class naming (no legacy CSS to match).
- `payment_block.html` (optional `class_name`, default `pay-block`) and
  `signature_block.html` — retrofitted verbatim onto
  `professional.html`/`minimal.html`/`modern.html`'s own EXISTING CSS,
  so these two deliberately use the LEGACY class names (`.pay-block
  .label .method`, `.sign-block .sig .line`) instead of the prototype's
  own naming. `modern.html`'s own sidebar already owns the class
  `.pay-block` for its unrelated QR box, hence the `class_name` override
  (`{% include ... with class_name="pay-block2" %}`).

**Tier-prefixed key convention**: every template from Batch 1 onward
uses a tier-prefixed key (`free_essential`, later `pro_atelier`, etc.)
and a matching filename (`free_essential.html`) — resolves the name
collision between the prototype's own `minimal`/`modern`/`professional`/
`statement` pool designs, the 3 legacy keys, and the existing
`statement.html` account-statement generator, without a special case per
collision. See `apps/invoices/template_manifest.py`'s own module
docstring and DECISIONS.md's 14 September 2026 entry for the full
reasoning, including two real corrections that pass made to its own
starting assumptions.

The QR/"Pay online" block is deliberately NOT one of the shared
partials — it stays inline per-template, matching the pre-existing
`professional`/`minimal`/`modern` convention of keeping it structurally
separate from the payment-methods list (the prototype's own
`paymentHtml()` bundles both; production doesn't).

Batches 2-5 of the 20-template import will keep extending this same
library — see DECISIONS.md's 14 September 2026 entry for the confirmed
batch groupings.
