# apps/payments/validators.py
"""
Currency validation shared by every serializer that accepts a currency code.

Promoted here from apps.clients.serializers (Payments core, 07 November 2026): apps.payments
is the bottom of the dependency tree and its own Payment serializers need this rule, so it
cannot live in a module that sits above it. apps.clients.serializers still re-exports it,
because four modules import it from there.
"""
from rest_framework import serializers

from .models import ExchangeRateSnapshot


def validate_currency_code(value):
    """
    'USD' is always valid, even before a single ExchangeRateSnapshot
    exists. Every other currency must appear in the most recent
    snapshot's rates_to_usd keys — this is what makes adding a new
    currency a data change (tomorrow's fetch includes it) rather than a
    migration (no choices= list to edit here).
    """
    code = (value or '').strip().upper()
    if code == 'USD':
        return code
    latest = ExchangeRateSnapshot.objects.order_by('-date').first()
    if latest is None or code not in latest.rates_to_usd:
        raise serializers.ValidationError(f'"{code}" is not a supported currency.')
    return code
