# apps/proposals/serializers.py
"""
Every text field a proposal carries is PLAIN TEXT — never HTML. These
serializers do not sanitise or strip markup because nothing downstream ever
treats the text as markup: the frontend displays it escaped (React JSX does by
default), the PDF/email/public-page work of part 2 must do the same, and
nothing may mark it safe or render it with dangerouslySetInnerHTML.

The server enforces every limit below; the UI is never trusted alone.

Limits:
  title 1-200 | job_description <= 6000 | my_experience <= 1500 | body <= 8000
  payment_terms <= 1000 | scope_sections <= 10 (title <= 120, text <= 2000)
  items <= 50 (description <= 300, quantity > 0, unit_price >= 0)
  tax_rate 0-100 | discount_amount >= 0 | valid_until not in the past
  every line total, the subtotal and subtotal + tax <= MAX_AMOUNT (the column limit)
  currency via validate_currency_code | tone one of three
"""
from decimal import Decimal

from django.db import transaction
from rest_framework import serializers

from apps.clients.models import Client
from apps.clients.serializers import validate_currency_code

from . import scoring
from .models import MAX_AMOUNT, TONE_CHOICES, Proposal, ProposalItem, _today

TITLE_MAX = 200
JOB_DESCRIPTION_MAX = 6000
JOB_DESCRIPTION_MIN_FOR_AI = 50
MY_EXPERIENCE_MAX = 1500
BODY_MAX = 8000
PAYMENT_TERMS_MAX = 1000
MAX_SCOPE_SECTIONS = 10
SCOPE_TITLE_MAX = 120
SCOPE_TEXT_MAX = 2000
MAX_ITEMS = 50


class ProposalItemSerializer(serializers.ModelSerializer):
    """quantity > 0 and unit_price >= 0 are enforced here (InvoiceItemSerializer relies on the UI for both)."""
    quantity = serializers.DecimalField(max_digits=8, decimal_places=2, min_value=Decimal('0.01'))
    unit_price = serializers.DecimalField(max_digits=10, decimal_places=2, min_value=Decimal('0'))

    class Meta:
        model = ProposalItem
        fields = ['id', 'description', 'quantity', 'unit_price', 'total', 'sort_order']
        read_only_fields = ['id', 'total']  # total is computed on save(), never client-supplied


class ScopeSectionSerializer(serializers.Serializer):
    title = serializers.CharField(max_length=SCOPE_TITLE_MAX)
    text = serializers.CharField(max_length=SCOPE_TEXT_MAX, allow_blank=True)


class ProposalSerializer(serializers.ModelSerializer):
    """
    Write representation — create/edit. The view enforces draft-only editing
    before an update ever reaches this serializer.

    `title` is required on create; on update the view passes partial=True
    (autosave-friendly: send only what changed), and a title that IS sent must
    still be non-blank.

    `client` is scoped to the requesting user's own clients in __init__, so a
    foreign client id gets DRF's own "does not exist" 400, indistinguishable
    from a nonexistent one (same approach as InvoiceSerializer). An archived
    client is allowed. client_name/client_email/client_company are SNAPSHOTTED
    from the client on create and whenever `client` changes to a different
    one (the client wins over any inline values sent alongside it); sending
    the same client again does not re-snapshot, so inline edits survive.
    Unlinking (client=null) leaves the snapshot as it is.

    `valid_until` must not be in the past — checked only when the value is
    new or changed, so an old draft whose date has since passed can still have
    its other fields edited.
    """
    title = serializers.CharField(min_length=1, max_length=TITLE_MAX)
    client_name = serializers.CharField(max_length=200, required=False, allow_blank=True)
    client_email = serializers.EmailField(max_length=254, required=False, allow_blank=True)
    client_company = serializers.CharField(max_length=200, required=False, allow_blank=True)
    tone = serializers.ChoiceField(choices=TONE_CHOICES, required=False)
    job_description = serializers.CharField(max_length=JOB_DESCRIPTION_MAX, required=False, allow_blank=True)
    my_experience = serializers.CharField(max_length=MY_EXPERIENCE_MAX, required=False, allow_blank=True)
    body = serializers.CharField(max_length=BODY_MAX, required=False, allow_blank=True)
    payment_terms = serializers.CharField(max_length=PAYMENT_TERMS_MAX, required=False, allow_blank=True)
    currency = serializers.CharField(max_length=3, required=False)
    scope_sections = ScopeSectionSerializer(many=True, required=False, max_length=MAX_SCOPE_SECTIONS)
    tax_rate = serializers.DecimalField(
        max_digits=5, decimal_places=2, min_value=Decimal('0'), max_value=Decimal('100'), required=False)
    discount_amount = serializers.DecimalField(
        max_digits=12, decimal_places=2, min_value=Decimal('0'), required=False)
    items = ProposalItemSerializer(many=True, required=False, max_length=MAX_ITEMS)

    class Meta:
        model = Proposal
        fields = [
            'client', 'client_name', 'client_email', 'client_company', 'title', 'tone', 'job_description',
            'my_experience', 'body', 'currency', 'scope_sections', 'payment_terms', 'tax_rate',
            'discount_amount', 'valid_until', 'items',
        ]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get('request')
        if request is not None:
            self.fields['client'].queryset = Client.objects.filter(user=request.user)

    def validate_currency(self, value):
        return validate_currency_code(value)

    def validate_scope_sections(self, value):
        return [{'title': s['title'].strip(), 'text': s['text'].strip()} for s in value]

    def validate_valid_until(self, value):
        unchanged = self.instance is not None and self.instance.valid_until == value
        if value is not None and value < _today() and not unchanged:
            raise serializers.ValidationError('The valid-until date cannot be in the past.')
        return value

    def validate(self, attrs):
        client = attrs.get('client')
        if client is not None and (self.instance is None or self.instance.client_id != client.pk):
            attrs['client_name'] = client.name
            attrs['client_email'] = client.email
            attrs['client_company'] = client.company
        self._validate_amounts(attrs)
        return attrs

    def _validate_amounts(self, attrs):
        """
        Rejects, as a clean 400 before anything is written, any amount the money
        columns cannot store (max_digits=12, decimal_places=2 -> MAX_AMOUNT): each
        line total, the subtotal, and subtotal + tax. (The final total can never
        exceed subtotal + tax — the discount is >= 0 — so that check covers it.)
        On a partial update the stored items / rates fill in whatever was not
        sent; when none of items, tax_rate or discount_amount is in the request
        there is nothing new to check. Without this a huge line crashed with
        decimal.InvalidOperation / DataError AFTER the proposal was created.
        """
        if not ({'items', 'tax_rate', 'discount_amount'} & set(attrs)):
            return
        limit = f'{MAX_AMOUNT:,.2f}'
        if 'items' in attrs:
            line_totals = [(i['quantity'] * i['unit_price']).quantize(Decimal('0.01')) for i in attrs['items']]
        elif self.instance is not None:
            line_totals = [item.total for item in self.instance.items.all()]
        else:
            line_totals = []
        for number, line_total in enumerate(line_totals, start=1):
            if line_total > MAX_AMOUNT:
                raise serializers.ValidationError({'items': [f'Line {number} is too large (the maximum is {limit}).']})
        subtotal = sum(line_totals, Decimal('0'))
        if subtotal > MAX_AMOUNT:
            raise serializers.ValidationError({'items': [f'The subtotal is too large (the maximum is {limit}).']})
        stored = self.instance
        tax_rate = attrs.get('tax_rate', stored.tax_rate if stored is not None else Decimal('0'))
        tax_amount, _total = Proposal.compute_amounts(subtotal, tax_rate, Decimal('0'))
        if subtotal + tax_amount > MAX_AMOUNT:
            raise serializers.ValidationError(
                {'tax_rate': [f'The subtotal plus tax is too large (the maximum is {limit}).']})

    def _replace_items(self, proposal, items_data):
        proposal.items.all().delete()
        for index, item_data in enumerate(items_data, start=1):
            item_data.setdefault('sort_order', index)
            ProposalItem.objects.create(proposal=proposal, **item_data)

    def create(self, validated_data):
        """One transaction: a failure on any row leaves no proposal and no half-written items behind."""
        items_data = validated_data.pop('items', [])
        if 'currency' not in validated_data:
            validated_data['currency'] = self.context['request'].user.profile.default_currency
        with transaction.atomic():
            proposal = Proposal.objects.create(**validated_data)
            self._replace_items(proposal, items_data)
            proposal.recalculate_totals()
            proposal.save(update_fields=['subtotal', 'tax_amount', 'total', 'updated_at'])
        return proposal

    def update(self, instance, validated_data):
        """One transaction: a failure part-way leaves the ORIGINAL fields, items and totals untouched."""
        items_data = validated_data.pop('items', None)
        with transaction.atomic():
            for attr, value in validated_data.items():
                setattr(instance, attr, value)
            instance.save()
            if items_data is not None:
                self._replace_items(instance, items_data)
            instance.recalculate_totals()
            instance.save(update_fields=['subtotal', 'tax_amount', 'total', 'updated_at'])
        return instance


class ProposalListSerializer(serializers.ModelSerializer):
    """Light list row. `view_token` is never a key here; the sanctioned exposure is the detail's `public_url`."""
    is_expired = serializers.BooleanField(read_only=True)
    ai_generated = serializers.BooleanField(read_only=True)
    has_invoice = serializers.SerializerMethodField()

    class Meta:
        model = Proposal
        fields = ['id', 'proposal_number', 'title', 'client_name', 'status', 'total', 'currency', 'valid_until',
                  'is_expired', 'ai_generated', 'sent_at', 'viewed_at', 'responded_at', 'has_invoice', 'updated_at']

    def get_has_invoice(self, obj):
        return obj.converted_invoice_id is not None


class ProposalDetailSerializer(serializers.ModelSerializer):
    """
    Full read representation, including the code-computed quality score
    (apps/proposals/scoring.py) — computed on every read, never stored, so it
    can never go stale against an edited body.

    Owner-only. `view_token` itself is never a key; the client link is exposed
    as `public_url` (None for a draft, which has no public page). The client's
    IP address and user agent (`response_ip`, `response_user_agent`) are never
    exposed by any serializer.
    """
    items = ProposalItemSerializer(many=True, read_only=True)
    is_editable = serializers.BooleanField(read_only=True)
    is_expired = serializers.BooleanField(read_only=True)
    ai_generated = serializers.BooleanField(read_only=True)
    word_count = serializers.IntegerField(read_only=True)
    quality = serializers.SerializerMethodField()
    converted_invoice = serializers.UUIDField(source='converted_invoice_id', read_only=True)
    public_url = serializers.SerializerMethodField()

    class Meta:
        model = Proposal
        fields = [
            'id', 'proposal_number', 'client', 'client_name', 'client_email', 'client_company', 'title', 'tone',
            'job_description', 'my_experience', 'body', 'ai_tips', 'ai_generated', 'ai_generated_at', 'ai_model',
            'currency', 'scope_sections', 'payment_terms', 'tax_rate', 'discount_amount', 'subtotal',
            'tax_amount', 'total', 'valid_until', 'status', 'is_editable', 'is_expired', 'items',
            'word_count', 'quality', 'sent_via', 'sent_at', 'viewed_at', 'responded_at', 'withdrawn_at',
            'response_message', 'converted_invoice', 'public_url', 'created_at', 'updated_at',
        ]
        read_only_fields = fields

    def get_quality(self, obj):
        return scoring.score_proposal(obj.body, obj.job_description)

    def get_public_url(self, obj):
        return None if obj.status == 'draft' else obj.public_url


class GenerateRequestSerializer(serializers.Serializer):
    """
    Input to both generate-ai endpoints. job_description is 50-6000 chars when
    given; the create form requires it (the view checks), the {id} form falls
    back to the stored one. `client` exists only on the create form.
    """
    job_description = serializers.CharField(
        min_length=JOB_DESCRIPTION_MIN_FOR_AI, max_length=JOB_DESCRIPTION_MAX, required=False)
    tone = serializers.ChoiceField(choices=TONE_CHOICES, required=False)
    my_experience = serializers.CharField(max_length=MY_EXPERIENCE_MAX, required=False, allow_blank=True)
    title = serializers.CharField(max_length=TITLE_MAX, required=False, allow_blank=True)
    confirm_overwrite = serializers.BooleanField(default=False)

    def __init__(self, *args, **kwargs):
        include_client = kwargs.pop('include_client', False)
        super().__init__(*args, **kwargs)
        if include_client:
            request = self.context['request']
            self.fields['client'] = serializers.PrimaryKeyRelatedField(
                queryset=Client.objects.filter(user=request.user), required=False, allow_null=True)


# ══════════════════════════════════════════════════════════════════
# Part 2: request bodies
# ══════════════════════════════════════════════════════════════════

RESPONSE_MESSAGE_MAX = 1000


class SendRequestSerializer(serializers.Serializer):
    method = serializers.ChoiceField(choices=['email', 'link'])
    confirm = serializers.BooleanField(default=False)


class ConfirmSerializer(serializers.Serializer):
    confirm = serializers.BooleanField(default=False)


class ConvertRequestSerializer(serializers.Serializer):
    save_client = serializers.BooleanField(default=False)


class RespondRequestSerializer(serializers.Serializer):
    """
    The client's answer. CharField already refuses NUL characters (PostgreSQL
    text columns cannot store one), and trims surrounding whitespace.
    """
    decision = serializers.ChoiceField(choices=['accept', 'decline'])
    message = serializers.CharField(max_length=RESPONSE_MESSAGE_MAX, required=False, allow_blank=True, default='')


# ══════════════════════════════════════════════════════════════════
# Part 2: the public (client-facing) payload — an ALLOWLIST
# ══════════════════════════════════════════════════════════════════
#
# Explicit serializers.Serializer classes with every field declared by name —
# NOT a ModelSerializer and never `exclude`. A field added to Proposal later
# is invisible to the public page until someone adds it here on purpose.
# Never present (tested by sentinel values): job_description, my_experience,
# ai_tips, ai_model, tone, id, view_token, client_email, client_company,
# response_ip, response_user_agent, any user id/email, any profile field other
# than the two in `sender`.

class PublicItemSerializer(serializers.Serializer):
    description = serializers.CharField(read_only=True)
    quantity = serializers.DecimalField(max_digits=8, decimal_places=2, read_only=True)
    unit_price = serializers.DecimalField(max_digits=10, decimal_places=2, read_only=True)
    total = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)


class PublicScopeSectionSerializer(serializers.Serializer):
    title = serializers.CharField(read_only=True)
    text = serializers.CharField(read_only=True)


def public_state(proposal):
    """'open' | 'expired' | 'accepted' | 'declined' | 'withdrawn' (a draft never reaches the public page)."""
    if proposal.status in ('accepted', 'declined', 'withdrawn'):
        return proposal.status
    return 'expired' if proposal.is_expired else 'open'


def public_sender(proposal):
    """The ONLY two profile-derived values the public page may show: a display name and the logo URL."""
    from core.email import sender_display_name

    user = proposal.user
    profile = getattr(user, 'profile', None)
    return {
        'name': sender_display_name(user, profile),
        'logo_url': (profile.logo if profile is not None else '') or '',
    }


class PublicProposalSerializer(serializers.Serializer):
    """
    What a client may see of an open/expired/answered proposal. Context:
    `preview` (bool) — True only for the owner opening their own link.
    """
    state = serializers.SerializerMethodField()
    can_respond = serializers.SerializerMethodField()
    preview = serializers.SerializerMethodField()
    proposal_number = serializers.CharField(read_only=True)
    title = serializers.CharField(read_only=True)
    client_name = serializers.CharField(read_only=True)
    body = serializers.CharField(read_only=True)
    scope_sections = PublicScopeSectionSerializer(many=True, read_only=True)
    items = PublicItemSerializer(many=True, read_only=True)
    currency = serializers.CharField(read_only=True)
    subtotal = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    tax_rate = serializers.DecimalField(max_digits=5, decimal_places=2, read_only=True)
    tax_amount = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    discount_amount = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    total = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    payment_terms = serializers.CharField(read_only=True)
    valid_until = serializers.DateField(read_only=True)
    responded_at = serializers.DateTimeField(read_only=True)
    response_message = serializers.CharField(read_only=True)
    sender = serializers.SerializerMethodField()

    def get_state(self, obj):
        return public_state(obj)

    def get_preview(self, obj):
        return bool(self.context.get('preview', False))

    def get_can_respond(self, obj):
        return public_state(obj) == 'open' and not self.get_preview(obj)

    def get_sender(self, obj):
        return public_sender(obj)


class PublicWithdrawnSerializer(serializers.Serializer):
    """A withdrawn proposal shows the client nothing but that fact."""
    state = serializers.SerializerMethodField()
    title = serializers.CharField(read_only=True)
    sender = serializers.SerializerMethodField()

    def get_state(self, obj):
        return 'withdrawn'

    def get_sender(self, obj):
        return public_sender(obj)


def public_payload(proposal, preview=False):
    """The one place that picks the public representation for a proposal."""
    if proposal.status == 'withdrawn':
        return PublicWithdrawnSerializer(proposal).data
    return PublicProposalSerializer(proposal, context={'preview': preview}).data
