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
  currency via validate_currency_code | tone one of three
"""
from decimal import Decimal

from rest_framework import serializers

from apps.clients.models import Client
from apps.clients.serializers import validate_currency_code

from . import scoring
from .models import TONE_CHOICES, Proposal, ProposalItem, _today

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
        return attrs

    def _replace_items(self, proposal, items_data):
        proposal.items.all().delete()
        for index, item_data in enumerate(items_data, start=1):
            item_data.setdefault('sort_order', index)
            ProposalItem.objects.create(proposal=proposal, **item_data)

    def create(self, validated_data):
        items_data = validated_data.pop('items', [])
        if 'currency' not in validated_data:
            validated_data['currency'] = self.context['request'].user.profile.default_currency
        proposal = Proposal.objects.create(**validated_data)
        self._replace_items(proposal, items_data)
        proposal.recalculate_totals()
        proposal.save(update_fields=['subtotal', 'tax_amount', 'total', 'updated_at'])
        return proposal

    def update(self, instance, validated_data):
        items_data = validated_data.pop('items', None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        if items_data is not None:
            self._replace_items(instance, items_data)
        instance.recalculate_totals()
        instance.save(update_fields=['subtotal', 'tax_amount', 'total', 'updated_at'])
        return instance


class ProposalListSerializer(serializers.ModelSerializer):
    """Light list row. view_token is never exposed (part 2 puts it on the public link, not in the app's own API)."""
    is_expired = serializers.BooleanField(read_only=True)
    ai_generated = serializers.BooleanField(read_only=True)

    class Meta:
        model = Proposal
        fields = ['id', 'title', 'client_name', 'status', 'total', 'currency', 'valid_until',
                  'is_expired', 'ai_generated', 'updated_at']


class ProposalDetailSerializer(serializers.ModelSerializer):
    """
    Full read representation, including the code-computed quality score
    (apps/proposals/scoring.py) — computed on every read, never stored, so it
    can never go stale against an edited body.
    """
    items = ProposalItemSerializer(many=True, read_only=True)
    is_editable = serializers.BooleanField(read_only=True)
    is_expired = serializers.BooleanField(read_only=True)
    ai_generated = serializers.BooleanField(read_only=True)
    word_count = serializers.IntegerField(read_only=True)
    quality = serializers.SerializerMethodField()

    class Meta:
        model = Proposal
        fields = [
            'id', 'client', 'client_name', 'client_email', 'client_company', 'title', 'tone',
            'job_description', 'my_experience', 'body', 'ai_tips', 'ai_generated', 'ai_generated_at', 'ai_model',
            'currency', 'scope_sections', 'payment_terms', 'tax_rate', 'discount_amount', 'subtotal',
            'tax_amount', 'total', 'valid_until', 'status', 'is_editable', 'is_expired', 'items',
            'word_count', 'quality', 'created_at', 'updated_at',
        ]
        read_only_fields = fields

    def get_quality(self, obj):
        return scoring.score_proposal(obj.body, obj.job_description)


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
