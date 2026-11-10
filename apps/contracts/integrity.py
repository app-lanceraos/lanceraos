# apps/contracts/integrity.py
"""
The fingerprint of a contract (Prompt 22, decision K5). Pure functions: no database access and no Django models
imported at module level. A contract's text is frozen when it is sent; `compute_hash` is the SHA-256 of a canonical
JSON form of everything the client is asked to agree to, and `verify_integrity` recomputes it from the stored row.

What is in the fingerprint: the title, the template key and version, the frozen parties (names only), every section's
id, title and text in order, the currency, the fee (always two decimals), the payment terms, and the three dates.
What is NOT: the contract number (it does not exist yet when the text is frozen), the status, any signature and any
timestamp.

Text is normalised at WRITE time (services.normalise_text) so the hash is stable.
"""
import hashlib
import json
import re
from decimal import Decimal

from core.email import sender_display_name

HASH_VERSION = 1
_CONTROL = re.compile(r'[\x00-\x08\x0b-\x1f\x7f]')


def _clean(value):
    """A plain string with control characters removed (jsonb cannot store NUL)."""
    return _CONTROL.sub('', str(value or '')).strip()


def parties_snapshot(contract):
    """
    The parties as they are RIGHT NOW, names only: {"freelancer": {name, business_name, city, country},
    "client": {name, company}}. No email address of either side. The freelancer's name is the profile display name,
    falling back to the same name the platform's emails use.
    """
    user = contract.user
    profile = getattr(user, 'profile', None)
    name = (profile.display_name if profile is not None else '') or sender_display_name(user, profile)
    return {
        'freelancer': {
            'name': _clean(name),
            'business_name': _clean(profile.business_name if profile is not None else ''),
            'city': _clean(profile.city if profile is not None else ''),
            'country': _clean(profile.country if profile is not None else ''),
        },
        'client': {
            'name': _clean(contract.client_name),
            'company': _clean(contract.client_company),
        },
    }


def _fee_text(value):
    """'1500.00' always, so Decimal('1500') and Decimal('1500.00') fingerprint the same."""
    return format(Decimal(value).quantize(Decimal('0.01')), 'f')


def _iso(value):
    return value.isoformat() if value is not None else None


def canonical_bytes(contract, parties):
    """The exact bytes that are hashed. Keys sorted, no spaces, real UTF-8 (not \\u escapes)."""
    document = {
        'v': HASH_VERSION,
        'title': contract.title,
        'template_key': contract.template_key,
        'template_version': contract.template_version,
        'parties': parties,
        'sections': [
            {'id': s.get('id', ''), 'title': s.get('title', ''), 'text': s.get('text', '')}
            for s in (contract.sections or [])
        ],
        'currency': contract.currency,
        'fee_amount': _fee_text(contract.fee_amount),
        'payment_terms': contract.payment_terms,
        'start_date': _iso(contract.start_date),
        'end_date': _iso(contract.end_date),
        'valid_until': _iso(contract.valid_until),
    }
    return json.dumps(document, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode('utf-8')


def compute_hash(contract, parties):
    """SHA-256 hex digest (64 characters) of canonical_bytes."""
    return hashlib.sha256(canonical_bytes(contract, parties)).hexdigest()


def verify_integrity(contract):
    """True when the stored row still produces the stored fingerprint (recomputed from the stored `parties`)."""
    if not contract.content_hash:
        return False
    return compute_hash(contract, contract.parties or {}) == contract.content_hash
