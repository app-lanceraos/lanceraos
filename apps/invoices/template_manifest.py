# apps/invoices/template_manifest.py
"""
Template Gallery Foundation (13 September 2026) — the single authoritative
list of invoice templates. Before this file, "which templates exist" was
duplicated across three places that would each need editing by hand for
every one of the 20 templates a later pass imports:
  - apps/users/models.py -> FreelancerProfile.INVOICE_TEMPLATE_CHOICES
  - apps/invoices/models.py -> Invoice.base_template's own choices tuple
  - frontend/src/pages/DesignGallery.jsx -> the hardcoded BASE_TEMPLATES array

This module is now that one place for the BACKEND. The frontend gallery
fetches it live via GET /api/invoices/templates/ rather than hardcoding a
second copy.

apps.users CANNOT import this module — apps.invoices depends on apps.users,
never the reverse (both model files' own comments already say so; verified
directly against apps/users/models.py's own INVOICE_TEMPLATE_CHOICES
comment). FreelancerProfile.INVOICE_TEMPLATE_CHOICES therefore stays a
locally-defined mirror tuple, not a derived one. test_manifest_drift.py
(apps/invoices/tests/) asserts the two key lists are identical byte-for-byte,
so drift between them is a hard test failure rather than a "someone forgot"
risk — this is the exact accepted-duplication pattern this repo already
used for design_seeds.COLOR_VARIANTS before the free-canvas system was
removed.

`tier` is real, developer-authored data (every entry is 'free' today,
since Module 8/Subscriptions doesn't exist yet) but is NOT enforced
anywhere in this pass — declaring it now means the 20-template import can
carry each template's real free/pro split as data rather than needing a
schema change later. When tier gating is built, it goes through the exact
same single-hook-function pattern this pass wires
FreelancerProfile.show_lanceraos_branding through
(pdf_generator._is_premium_branding_enabled) — never a second, parallel
premium concept.

`selectable=False` is how a template is retired from the gallery without
ever deleting it — Minimal isn't going anywhere in this pass (real
Invoice rows already carry base_template='minimal', frozen at creation by
design; deleting the choice value or the template file would break their
renders permanently), but the mechanism exists now for the import pass to
use on whichever templates it retires.

20-Template Import, Batch 1 (14 September 2026) — two real changes to the
above, both verified against the actual repo state before being made
(this prompt's own premise about that state was checked, not trusted —
see DECISIONS.md's 14 September 2026 entry for the full discrepancy):

1. LEGACY RENAME (label/tier metadata only — the stored `key` values
   'professional'/'modern' are UNTOUCHED, and so is every real
   Invoice.base_template / FreelancerProfile.invoice_template row that
   already references them; a real DB query confirmed all 113 real
   invoices currently have base_template=None anyway, falling back to
   'professional' at render time, so this rename changes zero real
   output). 'professional' becomes "Ledger" (tier 'pro' — real,
   developer-authored data, still NOT enforced anywhere, per this
   module's own docstring above); 'modern' becomes "Nova" (tier stays
   'free'). Minimal is genuinely UNCHANGED here (still `selectable: True`)
   — contrary to this exact import pass's own prompt, which incorrectly
   assumed it was already retired; DECISIONS.md's own entry already on
   record (13 September 2026) says retiring it is "the import pass's
   decision to make", without naming which batch, so it is left
   selectable in Batch 1 rather than retired with no replacement yet
   visible in the gallery (free_minimal doesn't exist until Batch 3).

2. TIER-PREFIXED KEY CONVENTION — every template added from Batch 1
   onward uses a tier-prefixed key (`free_essential`, later `pro_atelier`,
   etc.) and a matching filename (`free_essential.html`). This is what
   resolves the name collision between the incoming prototype's own
   'minimal'/'modern'/'professional' pool designs and these 3 legacy keys
   (and, in a later batch, the 'statement' collision with the existing
   account-statement generator) without a special case per collision.

20-Template Import, Batch 2 (14 September 2026) — legacy 'minimal' is now
retired (`selectable: False`), landing in this batch specifically because
Batch 3 introduces a new free-pool template also named "Minimal" — having
both selectable at once would show two different, identically-labeled
cards in the gallery. Metadata-only, same as the Ledger/Nova rename: the
`key` and every other field are untouched, and so is every real
Invoice.base_template/FreelancerProfile.invoice_template row already
referencing it (a real DB query before this change found 0 of either —
see DECISIONS.md's 14 September 2026 Batch 2 entry). Real, selectable
count is now 8 (was 7 before this batch: all 7 Batch-0/1 entries were
selectable, including Minimal) — Ledger, Nova, Essential, Clean, Classic,
Simple, Compact, Freelancer. Minimal no longer offered as a NEW selection
but still fully renderable for any historical row.

20-Template Import, Batch 3 (14 September 2026) — 4 more free-pool
templates: free_minimal, free_modern, free_professional, free_business.
Same tier-prefixed convention; real, selectable count is now 12 (was 8).
See DECISIONS.md's 14 September 2026 Batch 3 entry for the real per-
template structural classification (none of the 4 needed the same
mechanism — free_minimal uses a `position:fixed` persistent rail,
matching production modern.html's own proven sidebar technique; the
other 3 use one plain nested content wrapper, no special mechanism at
all) and for why the prototype's own `wrapsBody` flag (or, for
free_minimal, the identical un-flagged wrinkle) turned out to have zero
real implication for the ported templates once pagination-string-
concatenation — the only reason that flag/wrinkle exists in the
prototype at all — is out of the picture.

20-Template Import, Batch 4 (14 September 2026) — 7 pro-tier templates:
pro_executive, pro_studio, pro_signature, pro_editorial, pro_grid,
pro_commerce, pro_prestige (ported from proTemplates.html's own plain-
composition designs — the 3 persistent-rail/sidebar designs there,
atelier/consulting/statement, are Batch 5, not this one). Real, selectable
count is now 19 (was 12). `tier: 'pro'` is real, developer-authored data
here for the first time since the Ledger rename (Batch 1) — still not
enforced anywhere (Module 8/Subscriptions doesn't exist). See
DECISIONS.md's 14 September 2026 Batch 4 entry for the real per-template
structural classification (all 7 use the prototype's own plain generic
renderHeader/renderIntro/renderFooter composition — none is flagged
`wrapsBody`, and Pro's own `assembleTemplate` has no such concept at all
— but 3 of the 7 rename one or both party labels, one splits its totals
block, and one bakes the seller identity directly into its header rather
than using a separate "From" party) and the 2 new shared `parties_row.html`/
`meta_strip.html` parameters this batch added to cover those real,
repeated deviations.
"""

TEMPLATES = [
    {
        'key': 'professional',
        'label': 'Ledger',
        'tier': 'pro',
        'tag': 'Traditional business',
        'selectable': True,
    },
    {
        'key': 'minimal',
        'label': 'Minimal',
        'tier': 'free',
        'tag': 'Clean and understated',
        # Retired from the gallery, 20-Template Import Batch 2
        # (14 September 2026) — see this module's own docstring above.
        # Metadata only; the key/template file/render path are untouched.
        'selectable': False,
    },
    {
        'key': 'modern',
        'label': 'Nova',
        'tier': 'free',
        'tag': 'Bold sidebar layout',
        'selectable': True,
    },
    {
        'key': 'free_essential',
        'label': 'Essential',
        'tier': 'free',
        'tag': 'Universal starter',
        'selectable': True,
    },
    {
        'key': 'free_clean',
        'label': 'Clean',
        'tier': 'free',
        'tag': 'Modern SaaS invoice',
        'selectable': True,
    },
    {
        'key': 'free_classic',
        'label': 'Classic',
        'tier': 'free',
        'tag': 'Traditional business',
        'selectable': True,
    },
    {
        'key': 'free_simple',
        'label': 'Simple',
        'tier': 'free',
        'tag': 'Maximum clarity',
        'selectable': True,
    },
    {
        'key': 'free_compact',
        'label': 'Compact',
        'tier': 'free',
        'tag': 'Dense, many items',
        'selectable': True,
    },
    {
        'key': 'free_freelancer',
        'label': 'Freelancer',
        'tier': 'free',
        'tag': 'Independent professionals',
        'selectable': True,
    },
    {
        'key': 'free_minimal',
        'label': 'Minimal',
        'tier': 'free',
        'tag': 'Premium minimalism',
        'selectable': True,
    },
    {
        'key': 'free_modern',
        'label': 'Modern',
        'tier': 'free',
        'tag': 'Contemporary startup',
        'selectable': True,
    },
    {
        'key': 'free_professional',
        'label': 'Professional',
        'tier': 'free',
        'tag': 'High-end corporate',
        'selectable': True,
    },
    {
        'key': 'free_business',
        'label': 'Business',
        'tier': 'free',
        'tag': 'General small/medium business',
        'selectable': True,
    },
    {
        'key': 'pro_executive',
        'label': 'Executive',
        'tier': 'pro',
        'tag': 'High-end corporate',
        'selectable': True,
    },
    {
        'key': 'pro_studio',
        'label': 'Studio',
        'tier': 'pro',
        'tag': 'Creative studio',
        'selectable': True,
    },
    {
        'key': 'pro_signature',
        'label': 'Signature',
        'tier': 'pro',
        'tag': 'Personal luxury',
        'selectable': True,
    },
    {
        'key': 'pro_editorial',
        'label': 'Editorial',
        'tier': 'pro',
        'tag': 'Magazine grid',
        'selectable': True,
    },
    {
        'key': 'pro_grid',
        'label': 'Grid',
        'tier': 'pro',
        'tag': 'Precision minimal',
        'selectable': True,
    },
    {
        'key': 'pro_commerce',
        'label': 'Commerce',
        'tier': 'pro',
        'tag': 'Product & business',
        'selectable': True,
    },
    {
        'key': 'pro_prestige',
        'label': 'Prestige',
        'tier': 'pro',
        'tag': 'Luxury',
        'selectable': True,
    },
]

_BY_KEY = {t['key']: t for t in TEMPLATES}


def get_template(key):
    """A single manifest entry by key, or None — never raises on an unknown key."""
    return _BY_KEY.get(key)


def selectable_templates():
    """Manifest entries offered in the gallery — excludes any retired (selectable=False) template."""
    return [t for t in TEMPLATES if t['selectable']]


def template_keys():
    """Every real template key, selectable or not — the full, still-renderable set."""
    return [t['key'] for t in TEMPLATES]
