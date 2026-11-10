# apps/contracts/serializers.py
"""
Contracts serializers (Prompt 22). Every text field is PLAIN TEXT, never HTML: nothing here sanitises markup because
nothing downstream treats the text as markup (the frontend, the emails and the PDF all display it escaped).

* Write side: ContractCreateSerializer, ContractUpdateSerializer, SendRequestSerializer, ConfirmSerializer and the two
  public request bodies (SignRequestSerializer, DeclineRequestSerializer).
* Read side, owner: ContractListSerializer, ContractDetailSerializer.
* Read side, public: an ALLOWLIST. Explicit `serializers.Serializer` classes with every field declared by name -
  never a ModelSerializer and never `exclude` (decision K10). A field added to Contract later is invisible to the
  public page until someone adds it here on purpose.
"""
import re
from decimal import Decimal

from rest_framework import serializers

from apps.clients.models import Client
from apps.clients.serializers import validate_currency_code
from apps.invoices.models import Invoice
from apps.proposals.models import MAX_AMOUNT, Proposal

from . import copy as words
from .clauses import template_summaries  # noqa: F401  (re-exported for the templates view)
from .constants import (
    MESSAGE_MAX, NAME_MAX, NAME_MIN, PAYMENT_TERMS_MAX, SECTION_MAX, SECTION_TEXT_MAX, SECTION_TITLE_MAX,
    TEMPLATE_KEYS, TITLE_MAX, TOTAL_TEXT_MAX,
)
from .integrity import parties_snapshot
from .models import Contract, _today
from .services import normalise_line, normalise_sections, normalise_text


# -- Shared helpers ------------------------------------------------------------------------------------------------

def apply_client_snapshot(attrs, instance):
    """
    The Proposals rule: client_name / client_email / client_company are SNAPSHOTTED from the client on create and
    whenever `client` changes to a different one (the client wins over any inline values sent alongside it). Sending
    the same client again does not re-snapshot, so inline edits survive. Unlinking (client=null) leaves the snapshot.
    """
    client = attrs.get('client')
    if client is not None and (instance is None or instance.client_id != client.pk):
        attrs['client_name'] = client.name
        attrs['client_email'] = client.email
        attrs['client_company'] = client.company
    return attrs


def clean_signer_name(raw):
    """
    The typed name, as stored: control characters removed, runs of whitespace collapsed to one space, trimmed.
    Raises serializers.ValidationError with one of the module's sentences.
    """
    name = normalise_line(raw)
    if not name:
        raise serializers.ValidationError(words.NAME_REQUIRED)
    if not (NAME_MIN <= len(name) <= NAME_MAX):
        raise serializers.ValidationError(words.NAME_LENGTH)
    if not any(ch.isalpha() for ch in name):
        raise serializers.ValidationError(words.NAME_NEEDS_LETTERS)
    return name


class SectionSerializer(serializers.Serializer):
    id = serializers.CharField(max_length=40, required=False, allow_blank=True)
    title = serializers.CharField(max_length=SECTION_TITLE_MAX, allow_blank=True)
    text = serializers.CharField(max_length=SECTION_TEXT_MAX, allow_blank=True, trim_whitespace=False)


# -- Create --------------------------------------------------------------------------------------------------------

class ContractCreateSerializer(serializers.Serializer):
    """
    POST /api/contracts/. `client`, `proposal` and `invoice` are scoped to the requesting user in __init__, so a
    foreign id gets DRF's own "does not exist" 400, indistinguishable from a nonexistent one.
    """
    template_key = serializers.ChoiceField(choices=TEMPLATE_KEYS)
    title = serializers.CharField(max_length=TITLE_MAX, required=False, allow_blank=True)
    client = serializers.PrimaryKeyRelatedField(queryset=Client.objects.none(), required=False, allow_null=True)
    client_name = serializers.CharField(max_length=200, required=False, allow_blank=True)
    client_email = serializers.EmailField(max_length=254, required=False, allow_blank=True)
    client_company = serializers.CharField(max_length=200, required=False, allow_blank=True)
    proposal = serializers.PrimaryKeyRelatedField(queryset=Proposal.objects.none(), required=False, allow_null=True)
    invoice = serializers.PrimaryKeyRelatedField(queryset=Invoice.objects.none(), required=False, allow_null=True)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get('request')
        if request is not None:
            self.fields['client'].queryset = Client.objects.filter(user=request.user)
            self.fields['proposal'].queryset = Proposal.objects.filter(user=request.user)
            self.fields['invoice'].queryset = Invoice.objects.filter(user=request.user)

    def validate(self, attrs):
        apply_client_snapshot(attrs, None)
        return attrs


# -- Update --------------------------------------------------------------------------------------------------------

class ContractUpdateSerializer(serializers.ModelSerializer):
    """
    PATCH /api/contracts/<id>/ (partial; the view enforces draft-only before this runs). `template_key` cannot change
    and is refused if sent. `valid_until` must not be in the past - checked only when the value is new or changed, so
    an old draft whose date has since passed can still have its other fields edited.
    """
    title = serializers.CharField(min_length=1, max_length=TITLE_MAX)
    client_name = serializers.CharField(max_length=200, required=False, allow_blank=True)
    client_email = serializers.EmailField(max_length=254, required=False, allow_blank=True)
    client_company = serializers.CharField(max_length=200, required=False, allow_blank=True)
    currency = serializers.CharField(max_length=3, required=False)
    fee_amount = serializers.DecimalField(
        max_digits=12, decimal_places=2, min_value=Decimal('0'), max_value=MAX_AMOUNT, required=False)
    payment_terms = serializers.CharField(max_length=PAYMENT_TERMS_MAX, required=False, allow_blank=True)
    # A ListField (not a nested serializer): the JSON column is written as a plain list, so DRF's nested-write guard must not apply.
    sections = serializers.ListField(child=SectionSerializer(), required=False, max_length=SECTION_MAX)

    class Meta:
        model = Contract
        fields = [
            'title', 'client', 'client_name', 'client_email', 'client_company', 'proposal', 'invoice', 'currency',
            'fee_amount', 'payment_terms', 'start_date', 'end_date', 'valid_until', 'sections',
        ]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get('request')
        if request is not None:
            self.fields['client'].queryset = Client.objects.filter(user=request.user)
            self.fields['proposal'].queryset = Proposal.objects.filter(user=request.user)
            self.fields['invoice'].queryset = Invoice.objects.filter(user=request.user)

    def to_internal_value(self, data):
        if hasattr(data, 'keys') and 'template_key' in data:
            raise serializers.ValidationError({'template_key': [words.TEMPLATE_CANNOT_CHANGE]})
        return super().to_internal_value(data)

    def validate_title(self, value):
        title = normalise_line(value)
        if not title:
            raise serializers.ValidationError('This field may not be blank.')
        return title

    def validate_client_name(self, value):
        return normalise_line(value)

    def validate_client_company(self, value):
        return normalise_line(value)

    def validate_payment_terms(self, value):
        return normalise_text(value)

    def validate_currency(self, value):
        return validate_currency_code(value)

    def validate_sections(self, value):
        total = sum(len(s.get('text') or '') for s in value)
        if total > TOTAL_TEXT_MAX:
            raise serializers.ValidationError(f'The sections are too long together (the limit is {TOTAL_TEXT_MAX} characters).')
        try:
            sections = normalise_sections(value)
        except ValueError:
            raise serializers.ValidationError('Two sections have the same id.')
        # Normalising can only shorten a text, but a title that was all control characters becomes empty: allowed in a
        # draft (sending refuses it), exactly like an empty text.
        return sections

    def validate_valid_until(self, value):
        unchanged = self.instance is not None and self.instance.valid_until == value
        if value is not None and value < _today() and not unchanged:
            raise serializers.ValidationError('The sign-by date cannot be in the past.')
        return value

    def validate(self, attrs):
        apply_client_snapshot(attrs, self.instance)
        instance = self.instance
        start = attrs.get('start_date', instance.start_date if instance is not None else None)
        end = attrs.get('end_date', instance.end_date if instance is not None else None)
        if start is not None and end is not None and end < start:
            raise serializers.ValidationError({'end_date': ['The end date cannot be before the start date.']})
        return attrs


# -- Requests ------------------------------------------------------------------------------------------------------

class SendRequestSerializer(serializers.Serializer):
    method = serializers.ChoiceField(choices=['email', 'link'])
    confirm = serializers.BooleanField(default=False)
    # JSONField so a stray NUL or a number reaches clean_signer_name and gets the module's own sentence.
    signer_name = serializers.JSONField(required=False, allow_null=True, default=None)

    def validate_signer_name(self, value):
        try:
            return clean_signer_name(value)
        except serializers.ValidationError:
            # The owner's own sentence, not the client's: they are signing at send.
            if not normalise_line(value):
                raise serializers.ValidationError(words.SIGNER_NAME_REQUIRED)
            raise


class ConfirmSerializer(serializers.Serializer):
    confirm = serializers.BooleanField(default=False)


class SignRequestSerializer(serializers.Serializer):
    """
    The client signs. `agree` must be exactly boolean true (the string "true", 1 and null are refused). Both fields
    are taken raw (JSONField) and checked by the view so every failure uses the module's own sentence rather than
    DRF's generic one.
    """
    signer_name = serializers.JSONField(required=False, allow_null=True, default=None)
    agree = serializers.JSONField(required=False, allow_null=True, default=None)


class DeclineRequestSerializer(serializers.Serializer):
    reason = serializers.JSONField(required=False, allow_null=True, default=None)


# -- Owner read side -----------------------------------------------------------------------------------------------

class ContractListSerializer(serializers.ModelSerializer):
    """Light list row. `view_token` is never a key here; the sanctioned exposure is the detail's `public_url`."""
    is_expired = serializers.BooleanField(read_only=True)
    proposal_id = serializers.UUIDField(read_only=True)
    invoice_id = serializers.UUIDField(read_only=True)

    class Meta:
        model = Contract
        fields = [
            'id', 'title', 'contract_number', 'status', 'is_expired', 'client_name', 'client_company', 'currency',
            'fee_amount', 'valid_until', 'sent_at', 'responded_at', 'template_key', 'proposal_id', 'invoice_id',
            'created_at', 'updated_at',
        ]
        read_only_fields = fields


class ContractDetailSerializer(serializers.ModelSerializer):
    """
    Full owner representation. `view_token` itself is never a key; the client link is exposed as `public_url`
    (None for a draft, which has no public page). `signature_record` (decision K12) carries the evidence once the
    contract is signed or declined and is NEVER part of any public payload.
    """
    is_editable = serializers.BooleanField(read_only=True)
    is_expired = serializers.BooleanField(read_only=True)
    parties = serializers.SerializerMethodField()
    public_url = serializers.SerializerMethodField()
    proposal = serializers.SerializerMethodField()
    invoice = serializers.SerializerMethodField()
    signature_record = serializers.SerializerMethodField()

    class Meta:
        model = Contract
        fields = [
            'id', 'contract_number', 'status', 'is_editable', 'is_expired', 'title', 'template_key', 'template_version',
            'client', 'client_name', 'client_email', 'client_company', 'proposal', 'invoice', 'sections', 'currency',
            'fee_amount', 'payment_terms', 'start_date', 'end_date', 'valid_until', 'parties', 'sent_via', 'sent_at',
            'viewed_at', 'responded_at', 'withdrawn_at', 'owner_signed_name', 'owner_signed_at', 'signed_name',
            'response_message', 'content_hash', 'public_url', 'signature_record', 'created_at', 'updated_at',
        ]
        read_only_fields = fields

    def get_parties(self, obj):
        return obj.parties if obj.status != 'draft' and obj.parties else parties_snapshot(obj)

    def get_public_url(self, obj):
        return None if obj.status == 'draft' else obj.public_url

    def get_proposal(self, obj):
        return {'id': str(obj.proposal_id), 'title': obj.proposal.title} if obj.proposal_id else None

    def get_invoice(self, obj):
        return {'id': str(obj.invoice_id), 'invoice_number': obj.invoice.invoice_number} if obj.invoice_id else None

    def get_signature_record(self, obj):
        if obj.status not in ('signed', 'declined'):
            return None
        client = {
            'responded_at': obj.responded_at, 'ip': obj.response_ip, 'user_agent': obj.response_user_agent,
        }
        if obj.status == 'signed':
            client = {'name': obj.signed_name, **client}
        return {
            'owner': {
                'name': obj.owner_signed_name, 'signed_at': obj.owner_signed_at,
                'ip': obj.owner_signed_ip, 'user_agent': obj.owner_signed_user_agent,
            },
            'client': client,
            'content_hash': obj.content_hash,
            'signed_hash': obj.signed_hash,
        }


# -- Public read side: an ALLOWLIST --------------------------------------------------------------------------------
#
# Never present (tested by sentinel values): client_email, any email address, any id, view_token, response_ip,
# response_user_agent, owner_signed_ip, owner_signed_user_agent, user/profile fields other than the sender's name and
# logo and the NAMES in `parties`, proposal/invoice links, template_key, internal timestamps.

class PublicSectionSerializer(serializers.Serializer):
    id = serializers.CharField(read_only=True)
    title = serializers.CharField(read_only=True)
    text = serializers.CharField(read_only=True)


class PublicFreelancerPartySerializer(serializers.Serializer):
    name = serializers.CharField(read_only=True)
    business_name = serializers.CharField(read_only=True)
    city = serializers.CharField(read_only=True)
    country = serializers.CharField(read_only=True)


class PublicClientPartySerializer(serializers.Serializer):
    name = serializers.CharField(read_only=True)
    company = serializers.CharField(read_only=True)


def public_state(contract):
    """'open' | 'expired' | 'signed' | 'declined' | 'withdrawn' (a draft never reaches the public page)."""
    if contract.status in ('signed', 'declined', 'withdrawn'):
        return contract.status
    return 'expired' if contract.is_expired else 'open'


def public_sender(contract):
    """The ONLY two profile-derived values the public page may show beside the party names: a display name and the logo URL."""
    from core.email import sender_display_name

    user = contract.user
    profile = getattr(user, 'profile', None)
    return {
        'name': sender_display_name(user, profile),
        'logo_url': (profile.logo if profile is not None else '') or '',
    }


def _party_names(contract):
    """The frozen parties (names only). They are present from the moment of sending; the fallback is defensive."""
    parties = contract.parties or parties_snapshot(contract)
    freelancer = parties.get('freelancer') or {}
    client = parties.get('client') or {}
    return {
        'freelancer': PublicFreelancerPartySerializer({
            key: freelancer.get(key, '') for key in ('name', 'business_name', 'city', 'country')}).data,
        'client': PublicClientPartySerializer({key: client.get(key, '') for key in ('name', 'company')}).data,
    }


class PublicContractSerializer(serializers.Serializer):
    """What a client may see of an open, expired, signed or declined contract. Context: `preview` (owner only)."""
    state = serializers.SerializerMethodField()
    can_respond = serializers.SerializerMethodField()
    preview = serializers.SerializerMethodField()
    title = serializers.CharField(read_only=True)
    contract_number = serializers.CharField(read_only=True)
    currency = serializers.CharField(read_only=True)
    fee_amount = serializers.SerializerMethodField()
    payment_terms = serializers.CharField(read_only=True)
    start_date = serializers.DateField(read_only=True)
    end_date = serializers.DateField(read_only=True)
    valid_until = serializers.DateField(read_only=True)
    sent_at = serializers.DateTimeField(read_only=True)
    sections = serializers.SerializerMethodField()
    parties = serializers.SerializerMethodField()
    owner_signature = serializers.SerializerMethodField()
    client_signature = serializers.SerializerMethodField()
    declined_at = serializers.SerializerMethodField()
    response_message = serializers.CharField(read_only=True)
    content_hash = serializers.CharField(read_only=True)
    can_download_pdf = serializers.SerializerMethodField()
    sender = serializers.SerializerMethodField()

    def get_state(self, obj):
        return public_state(obj)

    def get_preview(self, obj):
        return bool(self.context.get('preview', False))

    def get_can_respond(self, obj):
        return public_state(obj) == 'open' and not self.get_preview(obj)

    def get_fee_amount(self, obj):
        return format(Decimal(obj.fee_amount).quantize(Decimal('0.01')), 'f')

    def get_sections(self, obj):
        return PublicSectionSerializer(obj.sections or [], many=True).data

    def get_parties(self, obj):
        return _party_names(obj)

    def get_owner_signature(self, obj):
        return {'name': obj.owner_signed_name, 'signed_at': obj.owner_signed_at}

    def get_client_signature(self, obj):
        if obj.status != 'signed':
            return None
        return {'name': obj.signed_name, 'signed_at': obj.responded_at}

    def get_declined_at(self, obj):
        return obj.responded_at if obj.status == 'declined' else None

    def get_can_download_pdf(self, obj):
        return obj.status == 'signed'

    def get_sender(self, obj):
        return public_sender(obj)


class PublicWithdrawnSerializer(serializers.Serializer):
    """A withdrawn contract shows the client nothing but that fact."""
    state = serializers.SerializerMethodField()
    title = serializers.CharField(read_only=True)
    sender = serializers.SerializerMethodField()

    def get_state(self, obj):
        return 'withdrawn'

    def get_sender(self, obj):
        return public_sender(obj)


def public_payload(contract, preview=False):
    """The one place that picks the public representation for a contract."""
    if contract.status == 'withdrawn':
        return PublicWithdrawnSerializer(contract).data
    return PublicContractSerializer(contract, context={'preview': preview}).data
