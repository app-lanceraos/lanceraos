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

**The library grows during the 20-template import pass**, not this one.
The 3 existing static templates were written independently, never from
shared primitives — force-extracting a full partial library out of them
now would mean designing that abstraction before it's been validated
against the incoming templates, which were themselves already built from
shared primitives (`brandLockup`, `docBlock`, `metaStrip`, `partiesRow`,
`totalsHtml`, `paymentHtml`, `signatureHtml`). The right order: build the
partial library from those proven primitives during the import pass, then
retrofit `professional.html`/`minimal.html`/`modern.html` onto it. Until
then, only `footer.html` lives here.
