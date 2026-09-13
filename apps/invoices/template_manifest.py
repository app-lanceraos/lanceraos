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
"""

TEMPLATES = [
    {
        'key': 'professional',
        'label': 'Professional',
        'tier': 'free',
        'tag': 'Traditional business',
        'selectable': True,
    },
    {
        'key': 'minimal',
        'label': 'Minimal',
        'tier': 'free',
        'tag': 'Clean and understated',
        'selectable': True,
    },
    {
        'key': 'modern',
        'label': 'Modern',
        'tier': 'free',
        'tag': 'Bold sidebar layout',
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
