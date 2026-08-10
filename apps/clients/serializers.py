# apps/clients/serializers.py
"""
Every serializer here uses an explicit `fields` allowlist, never
`Meta.exclude` — the exact pattern that let `onboarding_completed` and
every `custom_smtp_*` field become mass-assignable through
FreelancerProfileSerializer in Users/Auth (see DECISIONS.md's security
audit entry). `user`/`portal_token`/`is_active`/flag fields are never
listed as writable here; ownership and moderation state are always set
by the view from `request.user` or a dedicated action endpoint, never
from client-supplied payload data.
"""
from rest_framework import serializers

from apps.payments.models import ExchangeRateSnapshot

from .models import Client, ClientNote, ClientTag


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


class ClientTagSerializer(serializers.ModelSerializer):
    class Meta:
        model = ClientTag
        fields = ['id', 'name', 'color']

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError('Tag name is required.')
        user = self.context['request'].user
        qs = ClientTag.objects.filter(user=user, name=value)
        if self.instance is not None:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError('You already have a tag with this name.')
        return value


class ClientNoteSerializer(serializers.ModelSerializer):
    author_email = serializers.EmailField(source='author.email', read_only=True)

    class Meta:
        model = ClientNote
        fields = ['id', 'content', 'author_email', 'created_at', 'updated_at']

    def validate_content(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError('Note content cannot be empty.')
        return value


class ClientSerializer(serializers.ModelSerializer):
    """
    Write representation for create/update — POST /api/clients/ and
    PUT /api/clients/<pk>/. Archive state, flag state, and portal_token
    are deliberately absent from `fields` entirely; they only ever change
    via their own dedicated endpoints (client_archive/client_restore/
    client_flag), never through this general-purpose create/update path.
    """
    class Meta:
        model = Client
        fields = [
            'id', 'name', 'email', 'company', 'address', 'phone', 'country',
            'default_currency', 'default_payment_terms', 'notes',
        ]
        read_only_fields = ['id']

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError('Client name is required.')
        return value

    def validate_email(self, value):
        """
        Real, server-side duplicate-prevention — added for the invoice
        wizard's "save this as a new client" flow (a user typing a
        one-time client's details that happen to match a client they
        already have saved), but applies to every caller of this
        serializer, including the plain "Add Client" modal, since the
        underlying problem (silently creating a second Client record for
        the same person) is identical either way. Checked case-
        insensitively and across archived clients too — re-adding an
        already-known email should surface as "you already have this
        client," not create a parallel row (the existing one, if
        archived, is what `restore` is for).
        """
        value = value.strip()
        user = self.context['request'].user
        qs = Client.objects.filter(user=user, email__iexact=value)
        if self.instance is not None:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError(
                'A client with this email already exists — search for them instead of creating a duplicate.'
            )
        return value

    def validate_default_currency(self, value):
        return validate_currency_code(value)


class ClientListSerializer(serializers.ModelSerializer):
    """
    Read representation for list/detail GET responses — includes
    computed payment_stats (which returns real numbers only once
    apps/invoices exists, see Client._invoices_for_scoring) and the
    client's tags, neither of which belong on the write serializer above.
    """
    tags = ClientTagSerializer(many=True, read_only=True)
    payment_stats = serializers.SerializerMethodField()

    class Meta:
        model = Client
        fields = [
            'id', 'name', 'email', 'company', 'address', 'phone', 'country',
            'default_currency', 'default_payment_terms', 'notes',
            'is_active', 'is_flagged', 'flag_reason', 'flag_type', 'flagged_at', 'auto_flagged',
            'portal_token', 'tags', 'payment_stats', 'created_at', 'updated_at',
        ]

    def get_payment_stats(self, obj):
        return obj.payment_stats
