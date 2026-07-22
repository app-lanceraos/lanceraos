import hashlib
import hmac
import re

from cryptography.fernet import Fernet, InvalidToken
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured, ValidationError


# ══════════════════════════════════════════════════════════════════
# FERNET — reversible encryption
# ══════════════════════════════════════════════════════════════════

_fernet_instance = None


def _get_fernet():
    """
    Lazily builds and caches a single Fernet instance for the process.
    Cached at module level (not per-call) since Fernet() construction
    validates and parses the key every time it's instantiated — no
    reason to pay that cost on every encrypt/decrypt call.
    """
    global _fernet_instance
    if _fernet_instance is not None:
        return _fernet_instance

    key = getattr(settings, 'ENCRYPTION_KEY', '') or ''
    if not key:
        raise ImproperlyConfigured(
            'ENCRYPTION_KEY is not set. Generate one with: '
            'python -c "from cryptography.fernet import Fernet; '
            'print(Fernet.generate_key().decode())"'
        )

    key_bytes = key.encode() if isinstance(key, str) else key
    try:
        _fernet_instance = Fernet(key_bytes)
    except (ValueError, TypeError) as exc:
        raise ImproperlyConfigured(
            f'ENCRYPTION_KEY is not a valid Fernet key: {exc}'
        ) from exc

    return _fernet_instance


def encrypt_field(plaintext: str) -> str:
    """
    Encrypts a string for storage. Returns '' for falsy input so that
    optional fields (blank=True) round-trip cleanly without needing
    special-casing at every call site.
    """
    if not plaintext:
        return ''
    return _get_fernet().encrypt(plaintext.encode()).decode()


def decrypt_field(ciphertext: str) -> str:
    """
    Decrypts a value previously produced by encrypt_field().
    Returns '' for falsy input (mirrors encrypt_field's empty-string convention).

    Raises ValueError (not InvalidToken directly) if the ciphertext is
    corrupt or was encrypted under a different key — this is almost
    always an ENCRYPTION_KEY rotation that wasn't handled with a
    re-encryption migration, and callers should treat it as a data
    problem worth surfacing, not silently swallow it into an empty string.
    """
    if not ciphertext:
        return ''
    try:
        return _get_fernet().decrypt(ciphertext.encode()).decode()
    except InvalidToken as exc:
        raise ValueError(
            'Failed to decrypt field — ciphertext is corrupt or was '
            'encrypted under a different ENCRYPTION_KEY.'
        ) from exc


# ══════════════════════════════════════════════════════════════════
# BLIND INDEX — one-way HMAC for uniqueness/lookup on encrypted fields
# ══════════════════════════════════════════════════════════════════

def _get_blind_index_key() -> bytes:
    key = getattr(settings, 'BLIND_INDEX_KEY', '') or ''
    if not key:
        raise ImproperlyConfigured(
            'BLIND_INDEX_KEY is not set. Generate one with: '
            'python -c "import secrets; print(secrets.token_hex(32))"'
        )
    try:
        key_bytes = bytes.fromhex(key)
    except ValueError as exc:
        raise ImproperlyConfigured(
            'BLIND_INDEX_KEY must be a hex string '
            '(python -c "import secrets; print(secrets.token_hex(32))").'
        ) from exc

    if len(key_bytes) < 32:
        raise ImproperlyConfigured(
            'BLIND_INDEX_KEY must decode to at least 32 bytes of entropy.'
        )
    return key_bytes


def blind_index(normalized_value: str) -> str:
    """
    Deterministic HMAC-SHA256 of an already-normalized plaintext value,
    returned as a hex digest suitable for a unique, indexed CharField.

    Callers MUST normalize the value (see normalize_digits below) before
    calling this — this function does not normalize on its own, because
    the normalization rule is field-specific (CNIC/NTN digit-stripping
    is not necessarily the right rule for every future blind-indexed
    field) and silently normalizing here would hide that decision.
    """
    if not normalized_value:
        return ''
    return hmac.new(
        _get_blind_index_key(),
        normalized_value.encode(),
        hashlib.sha256,
    ).hexdigest()


# ══════════════════════════════════════════════════════════════════
# NORMALIZATION + VALIDATION — CNIC / NTN / PSEB
# ══════════════════════════════════════════════════════════════════
#
# Storage rule: only the digit-stripped canonical form is ever encrypted,
# indexed, or persisted. Dashes are a display-only concern handled on the
# frontend (formatCNIC / formatNTN helpers) — the backend never sees or
# stores a dashed value, so there is exactly one canonical representation
# per value and no risk of two differently-formatted inputs being treated
# as distinct.

def normalize_digits(value: str) -> str:
    """Strips everything except digits. '12345-1234567-1' -> '1234512345671'."""
    if not value:
        return ''
    return re.sub(r'\D', '', value)


def validate_cnic(value: str) -> str:
    """
    Validates and normalizes a Pakistani CNIC.
    CNIC is exactly 13 digits (5 + 7 + 1, dashes stripped).
    Returns the normalized (digits-only) value on success.
    """
    digits = normalize_digits(value)
    if len(digits) != 13:
        raise ValidationError('CNIC must be 13 digits (e.g. 12345-1234567-1).')
    return digits


def validate_ntn(value: str) -> str:
    """
    Validates and normalizes an FBR National Tax Number.
    Base NTN is 7 digits; some users have seen it displayed with a
    trailing check digit (7-1 format) on the FBR portal, so 7 or 8
    digits are both accepted rather than assuming a single fixed
    length and locking out real users over a display quirk.
    Returns the normalized (digits-only) value on success.
    """
    digits = normalize_digits(value)
    if len(digits) not in (7, 8):
        raise ValidationError('NTN must be 7 or 8 digits.')
    return digits


def validate_pseb(value: str) -> str:
    """
    Validates and normalizes a PSEB registration number.
    No fixed public format standard is assumed here — only that it is
    digits-only and within a reasonable length. Tighten this if/when
    the actual PSEB registration number format is confirmed.
    Returns the normalized (digits-only) value on success.
    """
    digits = normalize_digits(value)
    if not (4 <= len(digits) <= 12):
        raise ValidationError('PSEB registration number must be between 4 and 12 digits.')
    return digits


def encrypt_and_index(value: str, validator) -> tuple[str, str]:
    """
    Convenience wrapper for the CNIC/NTN/PSEB pattern: validate + normalize,
    then return (encrypted_value, blind_index_hash) ready to assign to a
    model's *_encrypted and *_hash fields in one call.

    Usage:
        profile.cnic_encrypted, profile.cnic_hash = encrypt_and_index(
            raw_cnic, validate_cnic
        )

    Pass an empty string through untouched (both outputs '') so optional
    fields don't require special-casing at call sites.
    """
    if not value:
        return '', ''
    normalized = validator(value)
    return encrypt_field(normalized), blind_index(normalized)